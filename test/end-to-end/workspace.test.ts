// SC-010 (feature 003 contracts 5.2 to 5.4, FR-052 to FR-058): the workspace and the repository-aware
// pull request and session routes, over HTTP with the real routes, the sandbox clone and the recorded
// development platforms. The base folder holds the sandbox clone of acme/widgets and stub clones of the
// other repositories the multi-repository fixtures describe (acme/gadgets, acme/gizmos, acme/sprockets,
// and acme/broken, whose pull request list answers 500).

import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkspace } from '../../src/core/workspace.ts';
import { startWorkbench, type Workbench } from '../helpers/fake-ai-cli.ts';
import { loadFixtures } from '../helpers/recorded-fetch.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OTHERS = ['acme/gadgets', 'acme/gizmos', 'acme/sprockets', 'acme/broken'];

const putConfig = (bench: Workbench, baseFolder: string, tracker: Json = { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC'] }) =>
  bench.client.put('/api/config', { workspace: { baseFolder, platform: 'github' }, issueTracker: tracker });

test('FR-056 GET /api/workspace is 409 not_configured before set-up, and a save starts a scan', async (t) => {
  const bench = await startWorkbench(t, { awaitDiscovery: false });
  await rm(join(bench.appData.dir, 'config.json'));
  await bench.restart();

  const before = await bench.client.get('/api/workspace');
  assert.equal(before.status, 409);
  assert.equal((before.json as Json).error.code, 'not_configured');
  assert.equal((await bench.client.get('/api/config')).json, null);

  const saved = await putConfig(bench, bench.baseFolder);
  assert.equal(saved.status, 200, saved.text);
  const after = await bench.client.get('/api/workspace');
  assert.equal(after.status, 200);
  assert.ok(['scanning', 'complete'].includes((after.json as Json).discovery.state), 'the save started a scan');
  const done = await bench.discovered();
  assert.equal(done.discovery.state, 'complete');
  assert.deepEqual(done.matched.map((m: Json) => m.repository), ['acme/widgets']);
  assert.equal(done.matched[0].folder, bench.sandbox!.clone);
  assert.equal(done.baseFolder, bench.baseFolder);
  assert.equal(done.platform, 'github');
});

test('FR-056 the old repository config shape is refused with unknown_field, and descriptors carry settingsFields', async (t) => {
  const bench = await startWorkbench(t);
  const old = await bench.client.put('/api/config', {
    repository: { platform: 'github', id: 'acme/widgets', clonePath: bench.sandbox!.clone },
    issueTracker: { platform: 'github-issues' },
  });
  assert.equal(old.status, 400);
  assert.equal((old.json as Json).error.code, 'unknown_field');

  const undeclared = await putConfig(bench, bench.baseFolder, { platform: 'github-issues', projectKeys: ['ABC'] });
  assert.equal(undeclared.status, 400);
  assert.equal((undeclared.json as Json).error.code, 'invalid_request');
  assert.match((undeclared.json as Json).error.message, /projectKeys/);

  const platforms = (await bench.client.get('/api/platforms')).json as Json;
  const fields = Object.fromEntries(platforms.descriptors.map((d: Json) => [d.id, d.settingsFields]));
  assert.deepEqual(fields['jira-cloud'], ['site', 'projectKeys']);
  assert.deepEqual(fields['gitlab-issues'], ['site']);
  assert.deepEqual(fields['github-issues'], []);
});

test('FR-056 rescan answers 202 scanning, cancel keeps what was found, and both need the Origin header', async (t) => {
  const bench = await startWorkbench(t);
  // Enough empty folders that a scan outlasts the requests below.
  for (let batch = 0; batch < 40; batch += 1) {
    await Promise.all(Array.from({ length: 100 }, (_, i) => mkdir(join(bench.baseFolder, 'bulk', `d${batch * 100 + i}`), { recursive: true })));
  }

  assert.equal((await bench.client.post('/api/workspace/rescan', undefined, { origin: null })).status, 403);
  assert.equal((await bench.client.post('/api/workspace/cancel', undefined, { origin: null })).status, 403);

  const idle = await bench.client.post('/api/workspace/cancel');
  assert.equal(idle.status, 200, 'no scan running: unchanged');
  assert.equal((idle.json as Json).discovery.state, 'complete');

  const rescan = await bench.client.post('/api/workspace/rescan');
  assert.equal(rescan.status, 202);
  assert.equal((rescan.json as Json).discovery.state, 'scanning');
  const cancel = await bench.client.post('/api/workspace/cancel');
  assert.equal(cancel.status, 202, cancel.text);
  assert.equal((cancel.json as Json).discovery.state, 'cancelled');
  assert.equal(((await bench.client.get('/api/workspace')).json as Json).discovery.state, 'cancelled', 'it stays cancelled');

  await bench.client.post('/api/workspace/rescan');
  const done = await bench.discovered();
  assert.equal(done.discovery.state, 'complete');
  assert.ok(done.discovery.foldersScanned > 4000);
  assert.deepEqual(done.matched.map((m: Json) => m.repository), ['acme/widgets']);
});

test('FR-056 right after start-up, with no rescan call, GET /api/workspace shows a scan that began at boot', async (t) => {
  const bench = await startWorkbench(t, { composed: true, awaitDiscovery: false, fake: {} });
  const first = await bench.client.get('/api/workspace');
  assert.equal(first.status, 200, first.text);
  assert.ok(['scanning', 'complete'].includes((first.json as Json).discovery.state), `state ${(first.json as Json).discovery.state}`);
  assert.equal((await bench.discovered()).matched[0].repository, 'acme/widgets');
});

test('FR-052 FR-054 GET /api/pulls returns one group per repository, with one failed group and the others loaded', async (t) => {
  const bench = await startWorkbench(t, { extraClones: OTHERS });
  const res = await bench.client.get('/api/pulls');
  assert.equal(res.status, 200, res.text);
  const groups = res.json as Json[];
  assert.deepEqual(groups.map((g) => g.repository).sort(), ['acme/broken', 'acme/gadgets', 'acme/gizmos', 'acme/sprockets', 'acme/widgets']);
  const byRepo = new Map(groups.map((g) => [g.repository, g]));

  const broken = byRepo.get('acme/broken')!;
  assert.equal(broken.status, 'failed');
  assert.equal(typeof broken.reason, 'string');
  assert.deepEqual(broken.pulls, []);

  assert.deepEqual(byRepo.get('acme/gadgets')!.pulls.map((p: Json) => p.number), [10, 11]);
  assert.deepEqual(byRepo.get('acme/gizmos')!.pulls.map((p: Json) => p.number), [20, 21]);
  assert.deepEqual(byRepo.get('acme/sprockets')!.pulls.map((p: Json) => p.number), [30]);
  for (const g of groups.filter((x) => x.status === 'loaded')) {
    assert.ok(g.pulls.length > 0);
    for (const pull of g.pulls) assert.equal(pull.repository, g.repository, 'every pull carries its repository');
  }
});

test('FR-054 GET /api/pulls?repository= returns one group, and an unknown id is 404', async (t) => {
  const bench = await startWorkbench(t, { extraClones: OTHERS });
  const one = await bench.client.get('/api/pulls?repository=acme%2Fgizmos');
  assert.equal(one.status, 200, one.text);
  assert.equal((one.json as Json).repository, 'acme/gizmos');
  assert.equal((one.json as Json).status, 'loaded');
  assert.deepEqual((one.json as Json).pulls.map((p: Json) => p.number), [20, 21]);

  const failed = await bench.client.get('/api/pulls?repository=acme%2Fbroken');
  assert.equal(failed.status, 200);
  assert.equal((failed.json as Json).status, 'failed');

  const unknown = await bench.client.get('/api/pulls?repository=acme%2Fnowhere');
  assert.equal(unknown.status, 404);
  assert.equal((unknown.json as Json).error.code, 'not_found');
});

test('FR-052 POST /api/sessions takes { repository, prNumber }; a body with the number alone is refused', async (t) => {
  const bench = await startWorkbench(t);
  const old = await bench.client.post('/api/sessions', { prNumber: 1 });
  assert.equal(old.status, 400);
  assert.equal((old.json as Json).error.code, 'invalid_request');

  const unknown = await bench.client.post('/api/sessions', { repository: 'acme/nowhere', prNumber: 1 });
  assert.equal(unknown.status, 409);
  assert.equal((unknown.json as Json).error.code, 'repository_unavailable');

  const started = await bench.client.post('/api/sessions', { repository: 'acme/widgets', prNumber: 1 });
  assert.equal(started.status, 201, started.text);
  assert.equal((started.json as Json).repository, 'acme/widgets');
  assert.equal((started.json as Json).repositoryAvailable, true);
  assert.equal((started.json as Json).repositoryReason, undefined);
  const pulls = ((await bench.client.get('/api/pulls?repository=acme%2Fwidgets')).json as Json).pulls as Json[];
  assert.equal(pulls.find((p) => p.number === 1)?.sessionId, (started.json as Json).sessionId, 'the row shows its session');
});

test('FR-057 a session whose repository is no longer found stays readable, and Refresh, Ask and starting give 409 repository_unavailable', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured' } });
  const detail = await bench.startSession();
  const sessionId = detail.sessionId as string;
  const snapshotId = detail.snapshots[0].snapshotId as string;

  // Point the workbench at another, empty base folder: the repository is no longer found.
  const empty = join(bench.appData.root, 'empty-base');
  await mkdir(empty, { recursive: true });
  assert.equal((await putConfig(bench, empty)).status, 200);
  const done = await bench.discovered();
  assert.deepEqual(done.matched, []);

  const read = (await bench.client.get(`/api/sessions/${sessionId}`)).json as Json;
  assert.equal(read.repositoryAvailable, false);
  assert.match(read.repositoryReason, /no longer found/);
  const listed = ((await bench.client.get('/api/sessions')).json as Json[]).find((s) => s.sessionId === sessionId)!;
  assert.equal(listed.repositoryAvailable, false);
  assert.equal(listed.repositoryReason, read.repositoryReason);
  assert.equal((await bench.client.get(`/api/sessions/${sessionId}/snapshots/${snapshotId}`)).status, 200, 'reading works');
  assert.equal((await bench.client.get(`/api/sessions/${sessionId}/questions`)).status, 200);

  const refresh = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refresh.status, 409);
  assert.equal((refresh.json as Json).error.code, 'repository_unavailable');
  assert.equal((refresh.json as Json).error.message, read.repositoryReason);

  const ask = await bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What?' });
  assert.equal(ask.status, 409);
  assert.equal((ask.json as Json).error.code, 'repository_unavailable');
  assert.equal((await bench.fake!.invocations()).length, 0, 'no AI run started');

  const again = await bench.client.post('/api/sessions', { repository: 'acme/widgets', prNumber: 1 });
  assert.equal(again.status, 409);
  assert.equal((again.json as Json).error.code, 'repository_unavailable');

  // Found again: the same session is available again.
  assert.equal((await putConfig(bench, bench.baseFolder)).status, 200);
  await bench.discovered();
  const back = (await bench.client.get(`/api/sessions/${sessionId}`)).json as Json;
  assert.equal(back.repositoryAvailable, true);
});

test('FR-057 while discovery is running the reason says so, not "not found"', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const base = await mkdtemp(join(tmpdir(), 'prwb-ws-'));
  try {
    await mkdir(join(base, 'repo', '.git'), { recursive: true });
    const workspace = createWorkspace({
      manager: { readRemotes: async () => (await gate, ['https://github.com/acme/widgets.git']) },
      appDataDir: join(base, 'app'),
      matcherFor: () => (remote) => (remote === 'github.com/acme/widgets' ? 'acme/widgets' : null),
    });
    workspace.configure({ baseFolder: base, platform: 'github' });
    const reason = workspace.availability({ platform: 'github', id: 'acme/widgets' });
    assert.equal(reason.available, false);
    assert.match(reason.available ? '' : reason.reason, /still running/);
    release();
    await workspace.settled();
    assert.deepEqual(workspace.availability({ platform: 'github', id: 'Acme/Widgets' }), { available: true });
    const missing = workspace.availability({ platform: 'github', id: 'acme/other' });
    assert.match(missing.available ? '' : missing.reason, /no longer found/);
  } finally {
    release();
    await rm(base, { recursive: true, force: true });
  }
});

test('FR-058 a tracker that reads issues from the repository itself fetches the session repository\'s own issue, not another repository\'s', async (t) => {
  // Gadgets PR 40, with a description that names issue #77, which exists in gadgets and in gizmos with different content.
  const pr40 = 'https://api.github.com/repos/acme/gadgets/pulls/40';
  const original = loadFixtures('github').find((e) => e.request.url === pr40 && e.request.headers === undefined)!;
  const body = (original.response as { body: Json }).body;
  const withIssue = { ...original.response, body: { ...body, body: 'Fixes #77' } };
  const bench = await startWorkbench(t, {
    extraClones: ['acme/gadgets', 'acme/gizmos'],
    drop: (url) => url === pr40,
    extra: [{ request: { method: 'GET', url: pr40 }, response: withIssue as never }],
  });
  assert.equal((await putConfig(bench, bench.baseFolder, { platform: 'github-issues' })).status, 200);
  await bench.discovered();

  const detail = await bench.startSession(40, 'acme/gadgets');
  const issues = (detail.completeness as Json[]).find((r) => r.source === 'issue')?.issues as Json[];
  assert.ok(issues?.length > 0, `the issue reference was found: ${JSON.stringify(detail.completeness)}`);
  const urls = bench.recorded.requests.map((r) => r.url);
  assert.ok(urls.includes('https://api.github.com/repos/acme/gadgets/issues/77'), 'the session\'s own repository was asked');
  assert.equal(urls.some((u) => u.includes('/repos/acme/gizmos/issues/')), false, 'no other repository was asked');
});
