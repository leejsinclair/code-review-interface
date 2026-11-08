// VO-028 (FR-009, FR-042): closing a session keeps every record and removes only its worktree; a
// worktree left over from a killed run is removed at start-up, from the clone's worktree list and
// from disk, by its path, and the reviewer's own worktrees are never touched (no `worktree prune`).

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

async function withReviewerWorktree(h: Awaited<ReturnType<typeof harness>>): Promise<string> {
  const own = join(h.sandbox.root, 'reviewer-worktree');
  await h.sandbox.git(h.sandbox.clone, 'worktree', 'add', '-q', '-b', 'reviewer-side', own);
  return own;
}

function records(h: Awaited<ReturnType<typeof harness>>, sessionId: string) {
  const snapshots = h.store.listSnapshots(sessionId);
  return {
    session: h.store.readSession(sessionId),
    status: h.store.readSessionStatus(sessionId)?.prStatus,
    snapshots,
    files: snapshots.flatMap((s) => h.store.listChangedFiles(s.id)),
    commits: snapshots.flatMap((s) => h.store.listCommits(s.id)),
    evidence: h.store.listEvidence(sessionId),
  };
}

test('VO-028 close keeps every record and removes only the session worktree', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const own = await withReviewerWorktree(h);
  const { detail } = await h.sessions.start(1);
  const workspace = h.manager.workspacePath(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  assert.ok((await h.worktrees()).includes(workspace));
  const kept = records(h, detail.sessionId);
  const refs = await h.prwbRefs();

  await h.sessions.close(detail.sessionId);

  assert.deepEqual(records(h, detail.sessionId), kept, 'every record is kept');
  assert.equal((await h.worktrees()).includes(workspace), false, 'the worktree is gone from the clone');
  assert.equal(existsSync(workspace), false, 'and from disk');
  assert.ok((await h.worktrees()).includes(own), "the reviewer's own worktree is untouched");
  assert.deepEqual(await h.prwbRefs(), refs, 'app-owned refs are kept so references keep opening');
  assert.deepEqual(h.closed, [detail.sessionId]);
  const after = h.sessions.detail(detail.sessionId);
  assert.equal(after.sessionId, detail.sessionId, 'the closed session still reads from storage');
  assert.equal(after.workspaceReady, false);
});

test('VO-028 opening a closed session recreates its workspace without a new snapshot', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const { detail } = await h.sessions.start(1);
  await h.sessions.close(detail.sessionId);

  const reopened = await h.sessions.open(detail.sessionId);
  assert.equal(reopened.workspaceReady, true);
  assert.equal(reopened.snapshots.length, 1);
  assert.ok(existsSync(h.manager.workspacePath(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '')));
});

test('VO-028 the start-up sweep removes a leftover worktree from a killed run and leaves the reviewer worktrees', async (t) => {
  const { sweepWorkspaces } = await import('../../src/core/recovery.ts');
  const { readdir } = await import('node:fs/promises');
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const own = await withReviewerWorktree(h);
  const before = await h.sandbox.fingerprint();
  const { detail } = await h.sessions.start(1);
  const leftover = h.manager.workspacePath(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  const kept = records(h, detail.sessionId);

  // The process was killed without closing; the next start sweeps with a fresh manager.
  const removed = await sweepWorkspaces({ manager: h.makeManager(), workspacesDir: h.paths.workspaces });

  assert.deepEqual(removed, [leftover]);
  assert.equal((await h.worktrees()).includes(leftover), false, 'removed from the worktree list');
  assert.equal(existsSync(leftover), false, 'removed from disk');
  assert.deepEqual(await readdir(h.paths.workspaces), [], 'nothing is left under workspaces');
  assert.ok((await h.worktrees()).includes(own), "the reviewer's own worktree is still listed");
  assert.ok(existsSync(own));
  assert.deepEqual(records(h, detail.sessionId), kept, 'the session reopens from storage');
  assert.deepEqual(await h.sandbox.fingerprint(), before, "the reviewer's clone is unchanged by the start and the sweep (SC-001)");
});

test('VO-028 the sweep removes a workspace directory whose clone no longer knows it', async (t) => {
  const { sweepWorkspaces } = await import('../../src/core/recovery.ts');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const h = await harness(t);
  const stray = join(h.paths.workspaces, '00000000-0000-4000-8000-00000000dead', '00000000-0000-4000-8000-00000000beef');
  await mkdir(stray, { recursive: true });
  await writeFile(join(stray, 'left.txt'), 'left behind\n');
  const removed = await sweepWorkspaces({ manager: h.makeManager(), workspacesDir: h.paths.workspaces });
  assert.deepEqual(removed, [stray]);
  assert.equal(existsSync(stray), false);
});
