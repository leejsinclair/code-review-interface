// VO-026 (FR-005, EC-01): with no clone at the configured path, or a clone whose remotes point at
// another repository, the repository row is missing with the reason, PR metadata and the platform's
// diff are still returned, there is no isolated workspace (so nothing is announced for analysis), and
// the workbench never creates a clone.

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

async function startWithoutWorkspace(h: Awaited<ReturnType<typeof e2e>>): Promise<Json> {
  const started = await h.client.post('/api/sessions', { prNumber: 1 });
  assert.equal(started.status, 201, started.text);
  const detail = started.json as Json;
  assert.equal(detail.title, 'Allow password reset more than once');
  assert.equal(detail.author, 'alice-dev');
  assert.equal(detail.sourceBranch, 'feature/ABC-12-reset');
  assert.equal(detail.targetBranch, 'main');
  assert.equal(detail.description.replace(/\r\n/g, '\n'), 'Fixes ABC-12.\n\nReset tokens are no longer single use.');
  assert.equal(detail.workspaceReady, false);
  assert.deepEqual(h.snapshotsAnnounced, [], 'nothing is queued for analysis without a workspace');

  const snapshot = await h.client.get(`/api/sessions/${detail.sessionId}/snapshots/${detail.snapshots[0].snapshotId}`);
  assert.equal(snapshot.status, 200, snapshot.text);
  const body = snapshot.json as Json;
  assert.equal(body.diffSource, 'platform');
  assert.equal(body.baseCommit, undefined);
  assert.deepEqual(
    (body.files as Json[]).map((f) => [f.path, f.status, f.linesAdded, f.linesRemoved]),
    [
      ['docs/reset.md', 'added', 3, 0],
      ['src/auth/reset.js', 'modified', 1, 1],
      ['src/auth/token.js', 'renamed', 1, 1],
      ['src/legacy.js', 'deleted', 0, 2],
    ],
    "the platform's diff",
  );
  assert.equal(body.commits.length, 2);
  return detail;
}

test('VO-026 no clone at the configured path: repository row missing with the reason, PR and platform diff returned, no clone created', async (t) => {
  const h = await e2e(t, { clone: 'missing' });
  const detail = await startWithoutWorkspace(h);
  const repository = completenessRow(detail, 'repository');
  assert.equal(repository.status, 'missing');
  assert.equal(repository.reason, 'no clone at the configured path');
  assert.equal(existsSync(h.clonePath), false, 'no clone was created');
  h.recorded.assertAllRecorded();
});

test('VO-026 a clone whose remotes point elsewhere: repository row missing with the reason, and the clone is left alone', async (t) => {
  const h = await e2e(t, { clone: 'elsewhere' });
  assert.ok(h.sandbox);
  const before = await h.sandbox.fingerprint();
  const detail = await startWithoutWorkspace(h);
  const repository = completenessRow(detail, 'repository');
  assert.equal(repository.status, 'missing');
  assert.equal(repository.reason, 'no remote of the clone points at the configured repository');
  assert.deepEqual(await h.sandbox.fingerprint(), before);
  assert.equal(await h.sandbox.git(h.sandbox.clone, 'for-each-ref', 'refs/prwb/'), '', 'nothing was fetched');
  const worktrees = await h.sandbox.git(h.sandbox.clone, 'worktree', 'list', '--porcelain');
  assert.equal(worktrees.split('\n').filter((l) => l.startsWith('worktree ')).length, 1, 'no worktree was added');
});
