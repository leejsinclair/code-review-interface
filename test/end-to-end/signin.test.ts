// VO-053 (FR-040, EC-13): each platform has its own sign-in, checked by one read-only GET before the
// credential is stored; the account-and-token platforms ask for an email and an API token (never an
// app password); a token the platform later rejects marks only that platform expired, and the other
// platforms keep working.
//
// `GET /api/platforms` also returns `descriptors: AdapterDescriptor[]` (id, displayName, signInFields),
// from which the sign-in screen renders one form per platform without naming any platform in UI code.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { registerSecret } from '../../src/log.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { createFakeKeyring, type FakeKeyring } from '../helpers/fake-keyring.ts';
import { createGitSandbox, makeUnfetchableClone, type GitSandbox } from '../helpers/git-sandbox.ts';
import { loadFixtures, recordedFetch, type FixtureEntry, type RecordedFetch } from '../helpers/recorded-fetch.ts';
import { startTestServer, type TestClient } from '../helpers/server.ts';

// ---------------------------------------------------------------- harness
//
// The real server (test/helpers/server.ts) with the context routes, the real store, credentials over
// an in-memory keyring, and the recorded platforms: the development source-control platform and the
// project-key tracker. The reviewer's clone (when there is one) is a git sandbox whose PRs 1, 2, 3
// (from a fork) and 6 match the recordings; recorded head commits are replaced, as responses are
// served, by the sandbox's (`live`), so the fetched head matches what the platform reports.
//
// API required from src/server/routes/context.ts (T079):
//   createContextRoutes({ appDataDir, store, credentials, network, git, events?, aiProviders?,
//                         onSnapshot?(sessionId, snapshotId), onClose?(sessionId) }): RouteModule
// and from src/adapters/registry.ts (T076): registeredPlatforms(): { sourceControl, issueTrackers }.

const PULLS = 'https://api.github.com/repos/acme/widgets/pulls';
const FIXTURE_HEAD: Record<number, string> = {
  1: 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1',
  2: '7c1e3a5b9d2f4e6a8c0b1d3f5e7a9c2b4d6f8e0a',
  3: 'b8d6f4e2a0c9e7b5d3f1a8c6e4b2d0f9e7c5a3b1',
  6: '2a4c6e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a3c',
};
const JIRA_SITE = 'https://acme.atlassian.net';
const UTIL_V2 = 'export function add(a, b) {\n  return a + b;\n}\n\nexport const version = 2;\n';

type Clone = 'sandbox' | 'missing' | 'elsewhere' | 'none';

type E2EOptions = {
  clone?: Clone;
  /** Replaces the recorded responses for these PR numbers' detail URL, served in order. */
  pulls?: Record<number, FixtureEntry['response'][]>;
  /** Entries served instead of the recorded folders (none of the folders are loaded). */
  only?: FixtureEntry[];
  extra?: FixtureEntry[];
  /** Store credentials for the configured platforms before starting (default true). */
  signedIn?: boolean;
  /** Write the configuration before starting (default true). */
  configured?: boolean;
};

function prBody(n: number): Record<string, unknown> {
  const entry = loadFixtures('github').find((e) => e.request.url === `${PULLS}/${n}` && e.request.headers === undefined);
  assert.ok(entry && 'body' in entry.response, `a recorded PR ${n}`);
  return entry.response.body as Record<string, unknown>;
}
const respond = (body: unknown): FixtureEntry['response'] => ({ status: 200, body });
const withHead = (body: Record<string, unknown>, sha: string): Record<string, unknown> => ({
  ...body,
  head: { ...(body.head as Record<string, unknown>), sha },
});
const merged = (body: Record<string, unknown>): Record<string, unknown> => ({
  ...body,
  state: 'closed',
  merged: true,
  merged_at: '2026-11-08T12:00:00Z',
  closed_at: '2026-11-08T12:00:00Z',
});

function platformEntries(options: E2EOptions): FixtureEntry[] {
  if (options.only !== undefined) return options.only;
  const pulls = options.pulls ?? {};
  const out: FixtureEntry[] = [];
  for (const e of [...loadFixtures('github'), ...loadFixtures('jira')]) {
    const n = /\/pulls\/(\d+)$/.exec(e.request.url)?.[1];
    if (n !== undefined && e.request.headers === undefined && pulls[Number(n)] !== undefined) continue;
    out.push({ request: e.request, response: e.response });
  }
  for (const [n, responses] of Object.entries(pulls)) {
    for (const response of responses) out.push({ request: { url: `${PULLS}/${n}` }, response });
  }
  return [...out, ...(options.extra ?? [])];
}

async function e2e(t: { after(fn: () => unknown): void }, options: E2EOptions = {}) {
  const { configPlatforms, createContextRoutes } = await import('../../src/server/routes/context.ts');
  const { adapterDeps, createSourceControl } = await import('../../src/adapters/registry.ts');
  const { createWorkspace } = await import('../../src/core/workspace.ts');
  const { createRepositoryManager } = await import('../../src/repo/manager.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const { saveConfig } = await import('../../src/config.ts');
  const { createCredentials } = await import('../../src/credentials.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { createEventHub } = await import('../../src/server/events.ts');

  const appData = await useTempAppData(t);
  const paths = await ensureAppData({ dir: appData.dir });
  const clone = options.clone ?? 'sandbox';
  const live = new Map<string, string>();
  let sandbox: GitSandbox | null = null;
  let clonePath = join(appData.root, 'no-clone-here');
  // The base folder discovery scans: the sandbox's folder (holding the clone), or an empty one.
  let baseFolder = join(appData.root, 'base');
  await mkdir(baseFolder, { recursive: true });
  if (clone === 'missing') {
    // A matched clone whose head cannot be fetched: the snapshot has no local head and its diff comes from the platform.
    clonePath = join(baseFolder, 'widgets');
    await makeUnfetchableClone(clonePath, 'https://github.com/Acme/Widgets', 'https://github.com/acme/widgets.git', join(appData.root, 'nowhere'));
  }
  if (clone !== 'missing' && clone !== 'none') {
    const s = await createGitSandbox();
    sandbox = s;
    t.after(() => s.cleanup());
    clonePath = s.clone;
    baseFolder = s.root;
    const opened = [
      await s.openPr({ number: 1, branch: 'feature/ABC-12-reset', files: { 'src/util.js': UTIL_V2 } }),
      await s.openPr({ number: 2, branch: 'docs/typo', files: { 'README.md': '# widgets\n\nSandbox repository.\n' } }),
      await s.openPr({ number: 3, branch: 'fix/null-check', files: { 'src/util.js': UTIL_V2 }, fromFork: true }),
      await s.openPr({ number: 6, branch: 'chore/tidy-token', files: { 'src/token.js': 'export const token = 1;\n' } }),
    ];
    for (const pr of opened) live.set(FIXTURE_HEAD[pr.number] ?? '', pr.head);
    if (clone === 'sandbox') {
      await s.git(s.clone, 'remote', 'set-url', 'origin', 'https://github.com/Acme/Widgets');
      await s.git(s.clone, 'config', `url.${s.platform}.insteadOf`, 'https://github.com/acme/widgets.git');
    }
  }

  const recorded = recordedFetch([], { entries: platformEntries(options) });
  const network = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await recorded.fetch(input, init);
    let text = await response.text();
    for (const [from, to] of live) text = text.split(from).join(to);
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const keyring: FakeKeyring = createFakeKeyring();
  const credentials = createCredentials({ keyring, registerSecret });
  if (options.signedIn !== false) {
    await credentials.save('github', { secret: 'test-github-token', scheme: 'bearer' });
    await credentials.save('jira-cloud', { account: 'alice@acme.example', secret: 'test-jira-token', scheme: 'basic' });
  }
  const configBody = {
    workspace: { baseFolder, platform: 'github' },
    issueTracker: { platform: 'jira-cloud', site: JIRA_SITE, projectKeys: ['ABC'] },
  };
  if (options.configured !== false) await saveConfig(appData.dir, configBody, configPlatforms());

  const git = createGit({ hooksPath: paths.emptyHooks });
  const workspace = createWorkspace({
    manager: createRepositoryManager({ git, workspacesDir: paths.workspaces }),
    appDataDir: appData.dir,
    matcherFor: ({ platform, baseUrl }) => {
      const sourceControl = createSourceControl(platform, adapterDeps(platform, network, (request) => request), {
        repository: { platform, id: '' },
        ...(baseUrl === undefined ? {} : { baseUrl }),
      });
      return (remote) => sourceControl.repositoryForRemote(remote);
    },
  });
  workspace.configure(options.configured === false ? null : configBody.workspace);
  t.after(() => workspace.cancel());
  await workspace.settled();

  const db = openDatabase(paths.db);
  t.after(() => db.close());
  const store = createReviewStore(db);
  const events = createEventHub({ heartbeatMs: 0 });
  const snapshotsAnnounced: string[] = [];
  const routes = createContextRoutes({
    appDataDir: appData.dir,
    workspace,
    store,
    credentials,
    network,
    git,
    events,
    aiProviders: ['ai-a'],
    onSnapshot: (_sessionId: string, snapshotId: string) => snapshotsAnnounced.push(snapshotId),
  });
  const client: TestClient = await startTestServer({ routes: [routes], serverOptions: { events } });
  t.after(() => client.close());

  const platformRequests = (host: string) => recorded.requests.filter((r) => r.host === host);
  return { appData, paths, sandbox, clonePath, workspace, live, recorded, keyring, credentials, store, client, snapshotsAnnounced, configBody, platformRequests };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function completenessRow(detail: Json, source: string): Json {
  const row = (detail.completeness as Json[]).find((r) => r.source === source);
  assert.ok(row, `a ${source} row`);
  return row;
}

// ---------------------------------------------------------------- tests

test('VO-053 every platform describes its sign-in fields; Bitbucket Cloud asks for an email and an API token, never an app password', async (t) => {
  const h = await e2e(t, { clone: 'missing', signedIn: false });
  const res = await h.client.get('/api/platforms');
  assert.equal(res.status, 200, res.text);
  const platforms = res.json as Json;
  assert.deepEqual([...platforms.sourceControl].sort(), ['bitbucket-cloud', 'github', 'gitlab']);
  assert.deepEqual([...platforms.issueTrackers].sort(), ['github-issues', 'gitlab-issues', 'jira-cloud']);
  assert.deepEqual(platforms.ai, ['ai-a']);
  const byId = new Map((platforms.descriptors as Json[]).map((d) => [d.id, d]));
  for (const id of ['github', 'bitbucket-cloud', 'gitlab', 'github-issues', 'gitlab-issues', 'jira-cloud']) {
    const descriptor = byId.get(id);
    assert.ok(descriptor, `${id} is described`);
    assert.ok(descriptor.displayName.length > 0);
    const secret = (descriptor.signInFields as Json[]).find((f) => f.name === 'secret');
    assert.equal(secret?.secret, true, 'the token is a secret input');
  }
  const bitbucket = byId.get('bitbucket-cloud');
  assert.deepEqual((bitbucket?.signInFields as Json[]).map((f) => f.name), ['account', 'secret']);
  assert.match((bitbucket?.signInFields as Json[])[0]?.label, /email/i);
  assert.match((bitbucket?.signInFields as Json[])[1]?.label, /API token/i);
  for (const descriptor of byId.values()) {
    for (const field of descriptor.signInFields as Json[]) assert.doesNotMatch(field.label, /app password/i);
  }
  assert.deepEqual((byId.get('github')?.signInFields as Json[]).map((f) => f.name), ['secret']);
  // Only a self-hosted source-control platform asks for a repository base address (FR-016).
  assert.deepEqual([...byId.values()].filter((d) => d.needsBaseUrl === true).map((d) => d.id), ['gitlab']);
});

test('VO-053 each sign-in is checked by one read-only GET before it is stored, and no secret is returned', async (t) => {
  const only = [...loadFixtures('github'), ...loadFixtures('bitbucket'), ...loadFixtures('jira')].map((e) => ({
    request: e.request,
    response: e.response,
  }));
  const h = await e2e(t, { clone: 'missing', signedIn: false, only });
  const initial = (await h.client.get('/api/signins')).json as Json[];
  assert.deepEqual(initial.map((s) => [s.platform, s.state]).sort(), [['github', 'signed-out'], ['jira-cloud', 'signed-out']]);

  const cases = [
    { platform: 'github', body: { secret: 'ghp-secret-value-1' }, url: 'https://api.github.com/user', account: 'alice-dev', header: 'Bearer ghp-secret-value-1' },
    {
      platform: 'bitbucket-cloud',
      body: { account: 'alice@acme.example', secret: 'bb-secret-value-2' },
      url: 'https://api.bitbucket.org/2.0/user',
      account: 'Alice Developer',
      header: `Basic ${Buffer.from('alice@acme.example:bb-secret-value-2').toString('base64')}`,
    },
    {
      platform: 'jira-cloud',
      body: { account: 'alice@acme.example', secret: 'jira-secret-value-3' },
      url: 'https://acme.atlassian.net/rest/api/3/myself',
      account: 'Alice Developer',
      header: `Basic ${Buffer.from('alice@acme.example:jira-secret-value-3').toString('base64')}`,
    },
  ];
  for (const c of cases) {
    const before = h.recorded.requests.length;
    const res = await h.client.put(`/api/signins/${c.platform}`, c.body);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json, { platform: c.platform, state: 'signed-in', account: c.account });
    assert.ok(!res.text.includes(c.body.secret), 'the secret is never returned');
    const sent = h.recorded.requests.slice(before);
    assert.equal(sent.length, 1, 'one check');
    assert.equal(sent[0]?.method, 'GET');
    assert.equal(sent[0]?.url, c.url);
    assert.equal(sent[0]?.headers['authorization'], c.header);
  }
  assert.equal(h.keyring.entries().length, 3, 'each platform has its own keychain entry');
  const after = (await h.client.get('/api/signins')).json as Json[];
  assert.deepEqual(after.map((s) => [s.platform, s.state]).sort(), [['github', 'signed-in'], ['jira-cloud', 'signed-in']]);
  for (const request of h.recorded.requests) assert.equal(request.method, 'GET');
});

test('VO-053 a credential the read-only check rejects is refused with signin_rejected and not stored', async (t) => {
  const h = await e2e(t, {
    clone: 'missing',
    signedIn: false,
    only: [{ request: { url: 'https://api.github.com/user' }, response: { status: 401, body: { message: 'Bad credentials' } } }],
  });
  const res = await h.client.put('/api/signins/github', { secret: 'ghp-wrong-token' });
  assert.equal(res.status, 422);
  assert.equal((res.json as Json).error.code, 'signin_rejected');
  assert.ok(!res.text.includes('ghp-wrong-token'));
  assert.deepEqual(h.keyring.entries(), []);
  const signins = (await h.client.get('/api/signins')).json as Json[];
  assert.equal(signins.find((s) => s.platform === 'github')?.state, 'signed-out');
});

test('VO-053 after GitHub rejects the token only GitHub is expired and asks again, and the issue tracker still answers', async (t) => {
  const unauthorized: FixtureEntry['response'] = { status: 401, body: { message: 'Bad credentials' } };
  const h = await e2e(t, { clone: 'missing', pulls: { 1: [respond(prBody(1)), unauthorized] } });
  const detail = (await h.client.post('/api/sessions', { repository: 'acme/widgets', prNumber: 1 })).json as Json;
  assert.equal(completenessRow(detail, 'issue').status, 'found');

  const refreshed = await h.client.post(`/api/sessions/${detail.sessionId}/refresh`);
  assert.equal(refreshed.status, 200, `a platform failure on refresh is a gap: ${refreshed.text}`);
  const body = refreshed.json as Json;
  assert.equal(completenessRow(body, 'pr').status, 'stale');
  const issue = (body.issues as Json[]).find((i) => i.key === 'ABC-12');
  assert.equal(issue?.status, 'found', 'the issue tracker still answers');
  assert.equal(h.platformRequests('acme.atlassian.net').length, 2, 'the issue was re-fetched');

  const signins = (await h.client.get('/api/signins')).json as Json[];
  assert.deepEqual(signins.map((s) => [s.platform, s.state]).sort(), [['github', 'expired'], ['jira-cloud', 'signed-in']]);

  const pulls = await h.client.get('/api/pulls');
  assert.equal(pulls.status, 409);
  assert.deepEqual([(pulls.json as Json).error.code, (pulls.json as Json).error.platform], ['signin_required', 'github']);

  const again = await h.client.put('/api/signins/github', { secret: 'ghp-new-token' });
  assert.equal(again.status, 200, again.text);
  const final = (await h.client.get('/api/signins')).json as Json[];
  assert.equal(final.find((s) => s.platform === 'github')?.state, 'signed-in');
});
