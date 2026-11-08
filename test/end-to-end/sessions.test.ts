// VO-001 (FR-001), VO-003 (FR-007), VO-004 (FR-004, FR-027), VO-006 (FR-006), VO-008 (FR-041), VO-010
// (FR-052), VO-061 (FR-041, EC-03) and VO-076 (FR-041): sessions over HTTP against the recorded
// platforms and a real clone (contracts/http-api.md section 5).

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { registerSecret } from '../../src/log.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { createFakeKeyring, type FakeKeyring } from '../helpers/fake-keyring.ts';
import { createGitSandbox, type GitSandbox } from '../helpers/git-sandbox.ts';
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

type Clone = 'sandbox' | 'missing' | 'elsewhere';

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
  const { createContextRoutes } = await import('../../src/server/routes/context.ts');
  const { registeredPlatforms } = await import('../../src/adapters/registry.ts');
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
  if (clone !== 'missing') {
    const s = await createGitSandbox();
    sandbox = s;
    t.after(() => s.cleanup());
    clonePath = s.clone;
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
    repository: { platform: 'github', id: 'acme/widgets', clonePath },
    issueTracker: { platform: 'jira-cloud', site: JIRA_SITE, projectKeys: ['ABC'] },
  };
  if (options.configured !== false) await saveConfig(appData.dir, configBody, registeredPlatforms());

  const db = openDatabase(paths.db);
  t.after(() => db.close());
  const store = createReviewStore(db);
  const events = createEventHub({ heartbeatMs: 0 });
  const snapshotsAnnounced: string[] = [];
  const routes = createContextRoutes({
    appDataDir: appData.dir,
    store,
    credentials,
    network,
    git: createGit({ hooksPath: paths.emptyHooks }),
    events,
    aiProviders: ['ai-a'],
    onSnapshot: (_sessionId: string, snapshotId: string) => snapshotsAnnounced.push(snapshotId),
  });
  const client: TestClient = await startTestServer({ routes: [routes], serverOptions: { events } });
  t.after(() => client.close());

  const platformRequests = (host: string) => recorded.requests.filter((r) => r.host === host);
  return { appData, paths, sandbox, clonePath, live, recorded, keyring, credentials, store, client, snapshotsAnnounced, configBody, platformRequests };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function completenessRow(detail: Json, source: string): Json {
  const row = (detail.completeness as Json[]).find((r) => r.source === source);
  assert.ok(row, `a ${source} row`);
  return row;
}

// ---------------------------------------------------------------- tests

const NEXT_HEAD = '0123456789abcdef0123456789abcdef01234567';

test('VO-001 the three open PRs are listed and any one of them starts a session', async (t) => {
  const h = await e2e(t, { configured: false });
  assert.equal((await h.client.get('/api/config')).json, null, 'nothing configured yet');
  const saved = await h.client.put('/api/config', h.configBody);
  assert.equal(saved.status, 200, saved.text);

  const pulls = await h.client.get('/api/pulls');
  assert.equal(pulls.status, 200, pulls.text);
  const list = pulls.json as Json[];
  assert.deepEqual(list.map((p) => p.number).sort(), [1, 2, 3]);
  const one = list.find((p) => p.number === 1);
  assert.equal(one?.title, 'Allow password reset more than once');
  assert.equal(one?.author, 'alice-dev');
  assert.equal(one?.sourceBranch, 'feature/ABC-12-reset');
  assert.equal(one?.targetBranch, 'main');
  assert.equal(one?.sessionId, undefined);

  for (const prNumber of [3, 2]) {
    const started = await h.client.post('/api/sessions', { prNumber });
    assert.equal(started.status, 201, started.text);
    const detail = started.json as Json;
    assert.equal(detail.prNumber, prNumber);
    assert.equal(detail.prStatus, 'open');
    assert.equal(detail.readOnly, false);
    assert.equal(completenessRow(detail, 'repository').status, 'found');
  }
  const after = (await h.client.get('/api/pulls')).json as Json[];
  assert.ok(after.find((p) => p.number === 2)?.sessionId);
  assert.ok(after.find((p) => p.number === 3)?.sessionId);
  assert.equal(after.find((p) => p.number === 1)?.sessionId, undefined);
  h.recorded.assertAllRecorded();
});

test('VO-003 a PR with no issue reference opens with the issue row missing', async (t) => {
  const h = await e2e(t);
  const started = await h.client.post('/api/sessions', { prNumber: 2 });
  assert.equal(started.status, 201, started.text);
  const detail = started.json as Json;
  assert.equal(detail.title, 'Fix typo in README');
  const issueRow = completenessRow(detail, 'issue');
  assert.equal(issueRow.status, 'missing');
  assert.deepEqual(issueRow.issues, []);
  assert.deepEqual(detail.issues, []);
  assert.equal((await h.client.get(`/api/sessions/${detail.sessionId}`)).status, 200, 'the session opens');
});

test('VO-004 a referenced issue title and plain-text description are returned, and only GETs reach the tracker', async (t) => {
  const h = await e2e(t);
  const started = await h.client.post('/api/sessions', { prNumber: 1 });
  assert.equal(started.status, 201, started.text);
  const detail = started.json as Json;
  const issue = (detail.issues as Json[]).find((i) => i.key === 'ABC-12');
  assert.ok(issue, 'ABC-12 is referenced');
  assert.equal(issue.platform, 'jira-cloud');
  assert.equal(issue.status, 'found');
  assert.equal(issue.title, 'Customers cannot reset a password twice');
  assert.ok((issue.descriptionText as string).startsWith('Customers cannot reset a password a second time.\n\nSteps'));
  assert.deepEqual([...issue.origins].sort(), ['branch', 'description']);
  assert.equal(completenessRow(detail, 'issue').status, 'found');

  const tracker = h.platformRequests('acme.atlassian.net');
  assert.equal(tracker.length, 1, 'one lookup for the one issue');
  for (const request of h.recorded.requests) assert.equal(request.method, 'GET');
  h.recorded.assertAllRecorded();
});

test('VO-006 opening a PR that has a session returns the same session, with its history and no new snapshot', async (t) => {
  const h = await e2e(t);
  const first = await h.client.post('/api/sessions', { prNumber: 1 });
  assert.equal(first.status, 201, first.text);
  const detail = first.json as Json;
  h.store.appendQuestion({
    id: '00000000-0000-4000-8000-00000000a5c1',
    sessionId: detail.sessionId,
    snapshotId: detail.snapshots[0].snapshotId,
    seq: 1,
    askedAt: '2026-11-07T00:00:00.000Z',
    text: 'Why allow a second reset?',
    category: 'why',
    audience: 'technical',
    scope: { type: 'pr', path: null, side: null, startLine: null, endLine: null, label: null },
    followsQuestionId: null,
    origin: 'typed',
    provider: 'ai-a',
  });

  const again = await h.client.post('/api/sessions', { prNumber: 1 });
  assert.equal(again.status, 200, again.text);
  assert.equal((again.json as Json).sessionId, detail.sessionId);
  assert.equal((again.json as Json).snapshots.length, 1, 'no new snapshot');
  assert.equal(((await h.client.get('/api/sessions')).json as Json[]).length, 1);
  assert.equal(h.store.listQuestions(detail.sessionId).length, 1, 'the history is intact and not duplicated');
});

test('VO-008 a merged PR lists as merged, opens read-only with its history, and refresh is refused with read_only', async (t) => {
  const h = await e2e(t, { pulls: { 1: [respond(prBody(1)), respond(merged(prBody(1)))] } });
  const detail = (await h.client.post('/api/sessions', { prNumber: 1 })).json as Json;
  const opened = await h.client.post(`/api/sessions/${detail.sessionId}/open`);
  assert.equal(opened.status, 200, opened.text);

  const sessions = (await h.client.get('/api/sessions')).json as Json[];
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.prStatus, 'merged');
  assert.equal(sessions[0]?.readOnly, true);

  const read = (await h.client.get(`/api/sessions/${detail.sessionId}`)).json as Json;
  assert.equal(read.readOnly, true);
  assert.equal(read.snapshots.length, 1, 'its snapshots stay readable');
  const snapshot = await h.client.get(`/api/sessions/${detail.sessionId}/snapshots/${read.snapshots[0].snapshotId}`);
  assert.equal(snapshot.status, 200);

  const refresh = await h.client.post(`/api/sessions/${detail.sessionId}/refresh`);
  assert.equal(refresh.status, 409);
  assert.equal((refresh.json as Json).error.code, 'read_only');
});

test('VO-010 a moved head on open shows the PR row stale and headMoved, with no new snapshot and no platform call between opens', async (t) => {
  const h = await e2e(t, { pulls: { 1: [respond(prBody(1)), respond(withHead(prBody(1), NEXT_HEAD))] } });
  const detail = (await h.client.post('/api/sessions', { prNumber: 1 })).json as Json;
  assert.equal(completenessRow(detail, 'pr').status, 'found');
  const pushed = await h.sandbox?.pushCommit(1, { 'docs/more.md': '# more\n' });
  assert.ok(pushed);
  h.live.set(NEXT_HEAD, pushed.head);

  const before = h.recorded.requests.length;
  const read = (await h.client.get(`/api/sessions/${detail.sessionId}`)).json as Json;
  assert.equal(read.headMoved, false, 'reading from the store does not check the platform');
  assert.equal(h.recorded.requests.length, before, 'no platform call');

  const opened = (await h.client.post(`/api/sessions/${detail.sessionId}/open`)).json as Json;
  assert.equal(opened.headMoved, true);
  assert.equal(opened.platformHeadCommit, pushed.head);
  assert.equal(completenessRow(opened, 'pr').status, 'stale');
  assert.equal(opened.snapshots.length, 1, 'no snapshot until the reviewer refreshes');
  assert.equal(h.recorded.requests.length, before + 1, 'one platform check on open');

  const reread = (await h.client.get(`/api/sessions/${detail.sessionId}`)).json as Json;
  assert.equal(reread.headMoved, true);
  assert.equal(h.recorded.requests.length, before + 1, 'still no platform call between opens');
});

test('VO-061 a PR merged during a session: refresh reports the status, the session becomes read-only and stays readable', async (t) => {
  const h = await e2e(t, { pulls: { 1: [respond(prBody(1)), respond(merged(prBody(1)))] } });
  const detail = (await h.client.post('/api/sessions', { prNumber: 1 })).json as Json;

  const refresh = await h.client.post(`/api/sessions/${detail.sessionId}/refresh`);
  assert.equal(refresh.status, 409);
  const error = (refresh.json as Json).error;
  assert.equal(error.code, 'read_only');
  assert.match(error.message, /merged/);

  const read = (await h.client.get(`/api/sessions/${detail.sessionId}`)).json as Json;
  assert.equal(read.prStatus, 'merged');
  assert.equal(read.readOnly, true);
  assert.equal(read.snapshots.length, 1);
  assert.equal(read.title, 'Allow password reset more than once');
});

test('VO-076 a PR closed and then reopened on the platform stays read-only with the note, and refresh is refused', async (t) => {
  // The recordings for PR 6 are served in order: open, closed, reopened.
  const h = await e2e(t);
  const detail = (await h.client.post('/api/sessions', { prNumber: 6 })).json as Json;
  assert.equal(detail.readOnly, false);

  const closed = (await h.client.post(`/api/sessions/${detail.sessionId}/open`)).json as Json;
  assert.equal(closed.prStatus, 'closed');
  assert.equal(closed.readOnly, true);

  const reopened = await h.client.post(`/api/sessions/${detail.sessionId}/open`);
  assert.equal(reopened.status, 200, reopened.text);
  const body = reopened.json as Json;
  assert.equal(body.readOnly, true);
  assert.equal(body.prStatus, 'closed');
  assert.equal(body.statusNote, 'reopened on platform');
  const listed = ((await h.client.get('/api/sessions')).json as Json[])[0];
  assert.equal(listed?.statusNote, 'reopened on platform');

  const refresh = await h.client.post(`/api/sessions/${detail.sessionId}/refresh`);
  assert.equal(refresh.status, 409);
  assert.equal((refresh.json as Json).error.code, 'read_only');
});
