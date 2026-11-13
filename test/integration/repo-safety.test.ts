// VO-005, VO-009 (FR-008, FR-036, FR-037, US1-AS5, US1-AS9), VO-068 (FR-008, FR-037) and VO-072
// (FR-008, SC-001): the reviewer's clone is fingerprinted (branch, HEAD, index, status, stash, every
// ref outside refs/prwb/, FETCH_HEAD, the content of modified and untracked files) before and after
// each repository operation of the workbench, and must be identical.

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
    async currentUser() {
      return { handle: 'reviewer', displayName: 'Reviewer' };
    },
    cloneLocations: () => ['code.example.test/acme/widgets'],
    pullRequestUrl: (_repo, number) => `https://code.example.test/acme/widgets/pull/${number}`,
    repositoryForRemote: (remote: string) => (remote === 'code.example.test/acme/widgets' ? 'acme/widgets' : null),
    async approvedByMe() {
      return new Set<number>();
    },
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
    async listComments() {
      return [];
    },
    async myDecision() {
      return null;
    },
    async reviewCapability() {
      const no = { allowed: false, reason: 'not used here' };
      return { comment: no, line_comment: no, reply: no, edit_comment: no, delete_comment: no, approve: no, request_changes: no, withdraw_decision: no };
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
    environmentFor: () => ({
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

/** Hash of every file under `root`, skipping git directories and bare repositories. */
async function filesOutsideGit(root: string, skip: string): Promise<Map<string, string>> {
  const { readdir } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.name === '.git' || entry.name.endsWith('.git') || full === skip) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.set(full, createHash('sha256').update(await readFile(full)).digest('hex'));
    }
  };
  await walk(root);
  return out;
}

test('VO-005 start, refresh and close leave the branch, HEAD, index, working files and stash of a dirty clone unchanged', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const dirty = await h.sandbox.dirtyClone();
  const before = await h.sandbox.fingerprint();
  assert.equal(before.branch, dirty.branch);
  assert.notEqual(before.stash, '', 'the clone has a stash');

  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  assert.equal(detail.workspaceReady, true, 'the session really fetched and made a workspace');
  assert.deepEqual(await h.sandbox.fingerprint(), before, 'unchanged after start');

  await h.sandbox.pushCommit(1, { 'src/util.js': UTIL_V3 });
  h.platform.publish(1);
  const refreshed = await h.sessions.refresh(detail.sessionId);
  assert.equal(refreshed.snapshots.length, 2, 'the refresh took a new snapshot');
  assert.deepEqual(await h.sandbox.fingerprint(), before, 'unchanged after refresh');

  await h.sessions.close(detail.sessionId);
  assert.deepEqual(await h.sandbox.fingerprint(), before, 'unchanged after close');
});

test('VO-009 with the PR branch checked out, the session opens in a detached worktree and the branch, its ref and HEAD are unchanged', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  await h.sandbox.checkoutPrBranch(1);
  const before = await h.sandbox.fingerprint();
  assert.equal(before.branch, 'feature/sub');
  assert.ok(before.refs.includes(`refs/heads/feature/sub ${pr.head}`));

  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  assert.equal(detail.workspaceReady, true);
  const snapshotId = detail.snapshots[0]?.snapshotId ?? '';
  const porcelain = await h.sandbox.git(h.sandbox.clone, 'worktree', 'list', '--porcelain');
  const block = porcelain.split('\n\n').find((b) => b.includes(h.manager.workspacePath(detail.sessionId, snapshotId)));
  assert.ok(block?.includes('detached'), 'the workspace is a detached worktree');
  assert.deepEqual(await h.sandbox.fingerprint(), before);
});

test('VO-068 a post-checkout hook in a tracked hooks directory the clone points at does not run, and no file outside the workspace changes', async (t) => {
  const h = await harness(t);
  const marker = join(h.sandbox.root, 'hook-ran');
  await h.sandbox.openPr({
    number: 1,
    branch: 'feature/hook',
    files: {
      '.githooks/post-checkout': { content: `#!/bin/sh\necho ran > "${marker}"\n`, executable: true },
      'src/util.js': UTIL_V2,
    },
  });
  h.platform.publish(1);
  await h.sandbox.git(h.sandbox.clone, 'config', 'core.hooksPath', '.githooks');
  await h.sandbox.dirtyClone();
  const before = await h.sandbox.fingerprint();
  const filesBefore = await filesOutsideGit(h.sandbox.root, h.paths.workspaces);

  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  assert.equal(detail.workspaceReady, true);
  const workspace = h.manager.workspacePath(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  assert.ok(existsSync(join(workspace, '.githooks/post-checkout')), 'the PR hook is in the workspace');
  assert.equal(existsSync(marker), false, 'the hook did not run');
  assert.deepEqual(await h.sandbox.fingerprint(), before);
  assert.deepEqual(await filesOutsideGit(h.sandbox.root, h.paths.workspaces), filesBefore, 'no file outside the workspace changed');
});

test('VO-072 deleting a session leaves the branch, HEAD, index, working files and stash of a dirty clone unchanged', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  await h.sandbox.dirtyClone();
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  const before = await h.sandbox.fingerprint();

  await h.sessions.delete(detail.sessionId, { confirm: true });
  assert.deepEqual(await h.prwbRefs(), [], 'the delete removed the session refs');
  assert.deepEqual(await h.sandbox.fingerprint(), before);
});

test('VO-072 the start-up sweep of a leftover worktree leaves the branch, HEAD, index, working files and stash of a dirty clone unchanged', async (t) => {
  const { sweepWorkspaces } = await import('../../src/core/recovery.ts');
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  await h.sandbox.dirtyClone();
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  const leftover = h.manager.workspacePath(detail.sessionId, detail.snapshots[0]?.snapshotId ?? '');
  const before = await h.sandbox.fingerprint();

  // The run was killed: a new process sweeps with a fresh manager.
  const removed = await sweepWorkspaces({ manager: h.makeManager(), workspacesDir: h.paths.workspaces });
  assert.deepEqual(removed, [leftover]);
  assert.equal((await h.worktrees()).includes(leftover), false);
  assert.deepEqual(await h.sandbox.fingerprint(), before);
});
