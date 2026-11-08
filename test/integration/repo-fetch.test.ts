// VO-048 (FR-036, EC-18), VO-049 (FR-036, EC-16), VO-050 (FR-037) and VO-051 (FR-038): fetching the PR
// head and target into the app-owned ref namespace, the fork cases, the detached worktree, and where
// each snapshot's diff came from.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { IssueTracker } from '../../src/contracts/issue-tracker.ts';
import { AdapterError } from '../../src/contracts/shared.ts';
import type { PullRequestInfo, SourceControlProvider } from '../../src/contracts/source-control.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { createGitSandbox, type GitSandbox } from '../helpers/git-sandbox.ts';

// ---------------------------------------------------------------- harness
//
// Real git in a sandbox (test/helpers/git-sandbox.ts), the real store, repository manager and
// session service, and a stand-in source-control platform backed by the sandbox. The reviewer's
// clone names the platform repository by an https URL; the clone's own `url.<path>.insteadOf`
// sends fetches of the adapter's URLs to the sandbox's bare repositories, while `git remote -v`
// still shows the URL as the reviewer wrote it (in another letter case, so no rewrite applies).
//
// APIs required (T064, T075, T078):
//   src/repo/manager.ts   createRepositoryManager({ git, workspacesDir }): RepositoryManager
//                         manager.workspacePath(sessionId, snapshotId): string   // <workspacesDir>/<sessionId>/<snapshotId>
//   src/core/recovery.ts  sweepWorkspaces({ manager, workspacesDir }): Promise<string[]>   // removed paths
//   src/core/sessions.ts  createSessions({ store, manager, environment, onSnapshot?, onClose?, now?, newId? }): Sessions
//                         environment(): { sourceControl, tracker, repository: RepoRef, clonePath, limits }
//                         Sessions: start(prNumber) -> { created, detail: SessionDetail }, open(id), refresh(id),
//                         close(id), delete(id, { confirm }), detail(id), snapshot(id, snapshotId): SnapshotDetail,
//                         changedBetween(id, fromSnapshotId, toSnapshotId): Promise<string[]>
//                         SessionError { code: 'not_found' | 'read_only' | 'confirmation_required' }

const REMOTE = 'https://code.example.test/acme/widgets.git';
const FORK_REMOTE = 'https://code.example.test/contrib/widgets.git';
const SOURCE = 'source-a';

type FakePr = PullRequestInfo & { fromFork: boolean; brokenHead?: boolean };

function fakePlatform(sandbox: GitSandbox) {
  const prs = new Map<number, FakePr>();
  const diffs = new Map<number, string>();
  const calls: string[] = [];
  const strip = (pr: FakePr): PullRequestInfo => {
    const { fromFork: _f, brokenHead: _b, ...info } = pr;
    return info;
  };
  const get = (n: number): FakePr => {
    const pr = prs.get(n);
    if (pr === undefined) throw new AdapterError('not_found', SOURCE);
    return pr;
  };
  const sc: SourceControlProvider = {
    id: SOURCE,
    async verifySignIn() {
      return { ok: true, account: 'reviewer' };
    },
    cloneLocations: () => ['code.example.test/acme/widgets'],
    async listOpenPullRequests() {
      calls.push('list');
      return [...prs.values()].filter((p) => p.state === 'open').map(strip);
    },
    async getPullRequest(_repo, n) {
      calls.push(`get ${n}`);
      return strip(get(n));
    },
    async listCommits(_repo, n) {
      const pr = get(n);
      return [{ sha: pr.headCommit, message: pr.title, author: 'Sandbox Author', authoredAt: '2026-11-07T00:00:00.000Z' }];
    },
    async listChangedFiles() {
      return [];
    },
    async getUnifiedDiff(_repo, n) {
      return diffs.get(n) ?? '';
    },
    async headLocation(_repo, info) {
      const pr = get(info.number);
      if (pr.brokenHead) return { remoteUrls: [REMOTE], ref: 'refs/pull/9999/head' };
      return pr.fromFork
        ? { remoteUrls: [FORK_REMOTE, 'git@code.example.test:contrib/widgets.git'], ref: `refs/heads/${pr.sourceBranch}` }
        : { remoteUrls: [REMOTE, 'git@code.example.test:acme/widgets.git'], ref: `refs/pull/${pr.number}/head` };
    },
    async targetLocation(_repo, info) {
      return { remoteUrls: [REMOTE, 'git@code.example.test:acme/widgets.git'], ref: `refs/heads/${info.targetBranch}` };
    },
  };
  return {
    sc,
    calls,
    /** Publishes the sandbox PR's current head as the platform's view of it. */
    publish(n: number, overrides: Partial<FakePr> = {}): void {
      const s = sandbox.pr(n);
      const previous = prs.get(n);
      prs.set(n, {
        number: n,
        title: `PR ${n}`,
        description: '',
        author: 'alice',
        sourceBranch: s.branch,
        targetBranch: s.targetBranch,
        state: 'open',
        updatedAt: '2026-11-07T00:00:00.000Z',
        fromFork: s.fromFork,
        ...previous,
        headCommit: s.head,
        ...overrides,
      });
    },
    set(n: number, overrides: Partial<FakePr>): void {
      prs.set(n, { ...get(n), ...overrides });
    },
    setDiff(n: number, text: string): void {
      diffs.set(n, text);
    },
  };
}

const noIssues: IssueTracker = {
  id: 'tracker-a',
  async verifySignIn() {
    return { ok: true, account: 'reviewer' };
  },
  extractReferences: () => [],
  async lookup() {
    return { status: 'unresolved', reason: 'not found' };
  },
};

type HarnessOptions = { tracker?: IssueTracker; clonePath?: (sandbox: GitSandbox) => string };

async function harness(t: { after(fn: () => unknown): void }, options: HarnessOptions = {}) {
  const { createSessions } = await import('../../src/core/sessions.ts');
  const { createRepositoryManager } = await import('../../src/repo/manager.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { DEFAULT_LIMITS } = await import('../../src/core/limits.ts');

  const appData = await useTempAppData(t);
  const paths = await ensureAppData({ dir: appData.dir });
  const sandbox = await createGitSandbox();
  t.after(() => sandbox.cleanup());
  // A FETCH_HEAD the reviewer already had, so a test can see it is left alone.
  await sandbox.git(sandbox.clone, 'fetch', '-q', 'origin');
  await sandbox.git(sandbox.clone, 'remote', 'set-url', 'origin', 'https://code.example.test/Acme/Widgets');
  await sandbox.git(sandbox.clone, 'config', `url.${sandbox.platform}.insteadOf`, REMOTE);
  await sandbox.git(sandbox.clone, 'config', `url.${sandbox.fork}.insteadOf`, FORK_REMOTE);

  const db = openDatabase(paths.db);
  t.after(() => db.close());
  const store = createReviewStore(db);
  const git = createGit({ hooksPath: paths.emptyHooks });
  const makeManager = () => createRepositoryManager({ git, workspacesDir: paths.workspaces });
  const manager = makeManager();
  const platform = fakePlatform(sandbox);
  const clonePath = options.clonePath?.(sandbox) ?? sandbox.clone;
  const snapshotsTaken: string[] = [];
  const closed: string[] = [];
  const sessions = createSessions({
    store,
    manager,
    environment: () => ({
      sourceControl: platform.sc,
      tracker: options.tracker ?? noIssues,
      repository: { platform: SOURCE, id: 'acme/widgets' },
      clonePath,
      limits: { ...DEFAULT_LIMITS },
    }),
    onSnapshot: (_sessionId: string, snapshotId: string) => snapshotsTaken.push(snapshotId),
    onClose: (sessionId: string) => closed.push(sessionId),
  });

  const worktrees = async (): Promise<string[]> =>
    (await sandbox.git(sandbox.clone, 'worktree', 'list', '--porcelain'))
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  const prwbRefs = async (prefix = 'refs/prwb/'): Promise<string[]> =>
    (await sandbox.git(sandbox.clone, 'for-each-ref', '--format=%(refname) %(objectname)', prefix))
      .split('\n')
      .filter((line) => line !== '');

  return { appData, paths, sandbox, store, git, manager, makeManager, platform, sessions, snapshotsTaken, closed, worktrees, prwbRefs };
}

const UTIL_V2 = 'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n\nexport const version = 2;\n';
const UTIL_V3 = `${UTIL_V2}export const patch = 3;\n`;

// ---------------------------------------------------------------- tests

const PLATFORM_DIFF =
  'diff --git a/src/util.js b/src/util.js\n' +
  'index 3f4e5d6..7a8b9c0 100644\n' +
  '--- a/src/util.js\n' +
  '+++ b/src/util.js\n' +
  '@@ -1,3 +1,4 @@\n' +
  ' export function add(a, b) {\n' +
  "+  if (a == null) throw new TypeError('missing');\n" +
  '   return a + b;\n' +
  ' }\n';

test('VO-048 a fetch writes only refs/prwb/<session>/<snapshot>/{head,target} and leaves FETCH_HEAD, branches, index and stash as they were', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  await h.sandbox.dirtyClone();
  const before = await h.sandbox.fingerprint();
  assert.notEqual(before.fetchHead, null, 'the reviewer has a FETCH_HEAD');

  const { detail } = await h.sessions.start(1);
  const snapshotId = detail.snapshots[0]?.snapshotId ?? '';
  assert.deepEqual((await h.prwbRefs()).sort(), [
    `refs/prwb/${detail.sessionId}/${snapshotId}/head ${pr.head}`,
    `refs/prwb/${detail.sessionId}/${snapshotId}/target ${pr.target}`,
  ]);
  const after = await h.sandbox.fingerprint();
  assert.equal(after.fetchHead, before.fetchHead, 'FETCH_HEAD unchanged');
  assert.deepEqual(after.refs, before.refs, 'no branch or other ref moved');
  assert.equal(after.indexHash, before.indexHash);
  assert.equal(after.stash, before.stash);
  assert.deepEqual(after, before);
});

test('VO-048 a commit no longer on the remote gives the repository row missing with the reason, and the diff from the platform', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  h.platform.setDiff(1, PLATFORM_DIFF);
  // The head is gone from the platform: its PR ref and branch are deleted and the objects pruned.
  await h.sandbox.git(h.sandbox.platform, 'update-ref', '-d', 'refs/pull/1/head');
  await h.sandbox.git(h.sandbox.platform, 'update-ref', '-d', 'refs/heads/feature/sub');
  await h.sandbox.prune(h.sandbox.platform);

  const { detail } = await h.sessions.start(1);
  const repository = detail.completeness.find((row) => row.source === 'repository');
  assert.equal(repository?.status, 'missing');
  assert.match(repository?.reason ?? '', /^fetch failed/);
  assert.equal(detail.workspaceReady, false);
  const snapshot = h.sessions.snapshot(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  assert.equal(snapshot.diffSource, 'platform');
  assert.equal(snapshot.baseCommit, undefined);
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.linesAdded, f.linesRemoved]), [['src/util.js', 1, 0]]);
  assert.deepEqual(await h.prwbRefs(), [], 'nothing was written under refs/prwb/');
});

test('VO-049 a fork PR is fetched from the fork repository into the app-owned namespace', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 3, branch: 'fix/null-check', files: { 'src/util.js': UTIL_V2 }, fromFork: true });
  h.platform.publish(3);
  const before = await h.sandbox.fingerprint();

  const { detail } = await h.sessions.start(3);
  assert.equal(detail.completeness.find((row) => row.source === 'repository')?.status, 'found');
  const snapshotId = detail.snapshots[0]?.snapshotId ?? '';
  assert.ok((await h.prwbRefs()).includes(`refs/prwb/${detail.sessionId}/${snapshotId}/head ${pr.head}`));
  assert.deepEqual(await h.sandbox.fingerprint(), before);
});

test('VO-049 a fork PR is fetched from the base repository PR ref where the platform exposes one', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 3, branch: 'fix/null-check', files: { 'src/util.js': UTIL_V2 }, fromFork: true });
  // This platform exposes fork heads on the base repository, so the fork itself is never needed.
  h.platform.publish(3, { fromFork: false });
  // The sandbox root is removed after the test, fork included, so it is not restored.
  await h.sandbox.makeForkUnreachable();

  const { detail } = await h.sessions.start(3);
  assert.equal(detail.completeness.find((row) => row.source === 'repository')?.status, 'found');
  const snapshotId = detail.snapshots[0]?.snapshotId ?? '';
  assert.ok((await h.prwbRefs()).includes(`refs/prwb/${detail.sessionId}/${snapshotId}/head ${pr.head}`));
});

test('VO-049 an unreachable fork gives the repository row missing with the reason, and the diff from the platform', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 3, branch: 'fix/null-check', files: { 'src/util.js': UTIL_V2 }, fromFork: true });
  h.platform.publish(3);
  h.platform.setDiff(3, PLATFORM_DIFF);
  // The sandbox root is removed after the test, fork included, so it is not restored.
  await h.sandbox.makeForkUnreachable();

  const { detail } = await h.sessions.start(3);
  const repository = detail.completeness.find((row) => row.source === 'repository');
  assert.equal(repository?.status, 'missing');
  assert.match(repository?.reason ?? '', /^fetch failed/);
  const snapshot = h.sessions.snapshot(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  assert.equal(snapshot.diffSource, 'platform');
  assert.deepEqual(snapshot.files.map((f) => f.path), ['src/util.js']);
});

test('VO-050 the workspace is a detached worktree at the snapshot head under <app-data>/workspaces', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);

  const { detail } = await h.sessions.start(1);
  assert.equal(detail.workspaceReady, true);
  const snapshotId = detail.snapshots[0]?.snapshotId ?? '';
  const path = h.manager.workspacePath(detail.sessionId, snapshotId);
  assert.equal(path, join(h.paths.workspaces, detail.sessionId, snapshotId));
  const block = (await h.sandbox.git(h.sandbox.clone, 'worktree', 'list', '--porcelain'))
    .split('\n\n')
    .find((b) => b.startsWith(`worktree ${path}\n`));
  assert.ok(block, 'the clone lists the workspace as a worktree');
  assert.ok(block.includes(`HEAD ${pr.head}`), 'at the snapshot head');
  assert.ok(block.includes('detached'), 'detached, on no branch');
  assert.equal(await readFile(join(path, 'src/util.js'), 'utf8'), UTIL_V2);
});

test('VO-051 a local diff records source local and its merge-base', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2, 'docs/sub.md': '# sub\n' } });
  // The target moves on after the PR branched, so the merge-base is not the target tip.
  await h.sandbox.advanceTarget({ 'README.md': '# widgets\n\nMoved on.\n' });
  h.platform.publish(1);
  const mergeBase = await h.sandbox.git(h.sandbox.platform, 'merge-base', 'refs/heads/main', pr.head);

  const { detail } = await h.sessions.start(1);
  const snapshot = h.sessions.snapshot(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  assert.equal(snapshot.diffSource, 'local');
  assert.equal(snapshot.baseCommit, mergeBase);
  assert.equal(snapshot.baseCommit, pr.target);
  assert.deepEqual(snapshot.files.map((f) => f.path).sort(), ['docs/sub.md', 'src/util.js'], 'the target-only change is not in the diff');
  assert.equal(detail.snapshots[0]?.diffSource, 'local');
  assert.match(snapshot.diffFingerprint, /^[0-9a-f]{64}$/);
});

test('VO-051 with no clone the snapshot records source platform and no base commit', async (t) => {
  const h = await harness(t, { clonePath: (sandbox) => join(sandbox.root, 'no-clone-here') });
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  h.platform.setDiff(1, PLATFORM_DIFF);

  const { detail } = await h.sessions.start(1);
  const snapshot = h.sessions.snapshot(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  assert.equal(snapshot.diffSource, 'platform');
  assert.equal(snapshot.baseCommit, undefined);
  assert.deepEqual(snapshot.files.map((f) => f.path), ['src/util.js']);
  assert.equal(existsSync(join(h.sandbox.root, 'no-clone-here')), false, 'no clone was created');
});
