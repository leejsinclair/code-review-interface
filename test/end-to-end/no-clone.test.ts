// VO-026 (FR-005, EC-01, FR-057): a matched clone whose head cannot be fetched gives a missing
// repository row with the reason, PR metadata and the platform's diff, no isolated workspace (so
// nothing is announced for analysis); with no matching clone under the base folder, starting a session
// is refused with `repository_unavailable`; and the workbench never creates or changes a clone.

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

async function startWithoutWorkspace(h: Awaited<ReturnType<typeof e2e>>): Promise<Json> {
  const started = await h.client.post('/api/sessions', { repository: 'acme/widgets', prNumber: 1 });
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

test('VO-026 a matched clone whose head cannot be fetched: repository row missing with the reason, PR and platform diff returned', async (t) => {
  const h = await e2e(t, { clone: 'missing' });
  const detail = await startWithoutWorkspace(h);
  const repository = completenessRow(detail, 'repository');
  assert.equal(repository.status, 'missing');
  assert.match(repository.reason, /^fetch failed/);
  assert.equal(detail.repositoryAvailable, true, 'the clone is found; only its fetch failed');
  h.recorded.assertAllRecorded();
});

// FR-057 (feature 003): a session starts only for a repository with a clone found under the base folder.
test('VO-026 FR-057 no clone under the base folder: starting is 409 repository_unavailable, before any platform call, and no clone is created', async (t) => {
  const h = await e2e(t, { clone: 'none' });
  const started = await h.client.post('/api/sessions', { repository: 'acme/widgets', prNumber: 1 });
  assert.equal(started.status, 409);
  assert.equal((started.json as Json).error.code, 'repository_unavailable');
  assert.equal(typeof (started.json as Json).error.message, 'string');
  assert.equal(h.platformRequests('api.github.com').length, 0, 'no platform call was spent');
  assert.equal(existsSync(h.clonePath), false, 'no clone was created');
  assert.equal(((await h.client.get('/api/sessions')).json as Json[]).length, 0);
});

test('VO-026 FR-057 a clone whose remotes point elsewhere is skipped by discovery: starting is 409, and the clone is left alone', async (t) => {
  const h = await e2e(t, { clone: 'elsewhere' });
  assert.ok(h.sandbox);
  const before = await h.sandbox.fingerprint();
  const started = await h.client.post('/api/sessions', { repository: 'acme/widgets', prNumber: 1 });
  assert.equal(started.status, 409);
  assert.equal((started.json as Json).error.code, 'repository_unavailable');
  const workspace = h.workspace.snapshot();
  assert.ok(workspace?.skipped.some((e) => e.folder === h.sandbox!.clone && e.reason === 'no-matching-remote'), 'the clone is listed as skipped with its reason');
  assert.deepEqual(await h.sandbox.fingerprint(), before);
  assert.equal(await h.sandbox.git(h.sandbox.clone, 'for-each-ref', 'refs/prwb/'), '', 'nothing was fetched');
  const worktrees = await h.sandbox.git(h.sandbox.clone, 'worktree', 'list', '--porcelain');
  assert.equal(worktrees.split('\n').filter((l) => l.startsWith('worktree ')).length, 1, 'no worktree was added');
});
