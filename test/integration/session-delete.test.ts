// VO-055 (FR-044): deleting a session after confirmation removes every record under it, its worktree
// and every refs/prwb/<sessionId>/ ref in the clone, and nothing of another session; without
// `confirm: true` the delete is refused and nothing is removed.

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

const resolvingTracker: IssueTracker = {
  id: 'tracker-a',
  async verifySignIn() {
    return { ok: true, account: 'reviewer' };
  },
  extractReferences: (text) =>
    [...text.matchAll(/\bABC-\d+\b/g)].map((m) => ({ platform: 'tracker-a', key: m[0], form: 'project-key' as const, text: m[0] })),
  async lookup(ref) {
    return { status: 'resolved', kind: 'issue', title: `Title of ${ref.key}`, descriptionText: 'Text.' };
  },
};

function question(sessionId: string, snapshotId: string, id: string) {
  return {
    id,
    sessionId,
    snapshotId,
    seq: 1,
    askedAt: '2026-11-07T00:00:00.000Z',
    text: 'What changed?',
    category: 'what' as const,
    audience: 'technical' as const,
    scope: { type: 'pr' as const, path: null, side: null, startLine: null, endLine: null, label: null },
    followsQuestionId: null,
    origin: 'typed' as const,
    provider: 'ai-a',
  };
}

async function twoSessions(t: { after(fn: () => unknown): void }) {
  const h = await harness(t, { tracker: resolvingTracker });
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  await h.sandbox.openPr({ number: 2, branch: 'docs/readme', files: { 'README.md': '# widgets\n\nMore.\n' } });
  h.platform.publish(1, { description: 'Fixes ABC-12.' });
  h.platform.publish(2, { description: 'Fixes ABC-13.' });
  const doomed = (await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1)).detail;
  // A second snapshot, so the delete covers more than one.
  await h.sandbox.pushCommit(1, { 'src/util.js': UTIL_V3 });
  h.platform.publish(1);
  const refreshed = await h.sessions.refresh(doomed.sessionId);
  const kept = (await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 2)).detail;
  h.store.appendQuestion(question(doomed.sessionId, refreshed.snapshots[1]?.snapshotId ?? '', '00000000-0000-4000-8000-0000000000d1'));
  h.store.appendQuestion(question(kept.sessionId, kept.snapshots[0]?.snapshotId ?? '', '00000000-0000-4000-8000-0000000000d2'));
  return { h, doomed: refreshed, kept };
}

test('VO-055 a delete without confirm: true is refused and removes nothing', async (t) => {
  const { SessionError } = await import('../../src/core/sessions.ts');
  const { h, doomed } = await twoSessions(t);
  const refs = await h.prwbRefs();
  const worktrees = await h.worktrees();

  for (const options of [{}, { confirm: false }, { confirm: 'yes' }]) {
    await assert.rejects(h.sessions.delete(doomed.sessionId, options), (error: unknown) => {
      assert.ok(error instanceof SessionError);
      assert.equal(error.code, 'confirmation_required');
      return true;
    });
  }
  assert.ok(h.store.readSession(doomed.sessionId));
  assert.equal(h.store.listSnapshots(doomed.sessionId).length, 2);
  assert.deepEqual(await h.prwbRefs(), refs);
  assert.deepEqual(await h.worktrees(), worktrees);
});

test('VO-055 a confirmed delete removes every record, the worktree and every refs/prwb/<sessionId>/ ref, and nothing of another session', async (t) => {
  const { h, doomed, kept } = await twoSessions(t);
  const id = doomed.sessionId;
  const snapshotIds = doomed.snapshots.map((s) => s.snapshotId);
  const workspace = h.manager.workspacePath(id, snapshotIds[1] ?? '');
  assert.ok(existsSync(workspace));
  assert.ok(h.store.listEvidence(id).length > 0, 'the session has Evidence');
  assert.equal((await h.prwbRefs(`refs/prwb/${id}/`)).length, 4, 'head and target refs of both snapshots');
  const keptRefs = await h.prwbRefs(`refs/prwb/${kept.sessionId}/`);
  const keptWorkspace = h.manager.workspacePath(kept.sessionId, kept.snapshots[0]?.snapshotId ?? '');

  await h.sessions.delete(id, { confirm: true });

  assert.equal(h.store.readSession(id), null);
  assert.equal(h.store.readSessionStatus(id), null);
  assert.deepEqual(h.store.listSnapshots(id), []);
  for (const snapshotId of snapshotIds) {
    assert.deepEqual(h.store.listChangedFiles(snapshotId), []);
    assert.deepEqual(h.store.listCommits(snapshotId), []);
    assert.deepEqual(h.store.listIssueReferences(snapshotId), []);
  }
  assert.deepEqual(h.store.listEvidence(id), []);
  assert.deepEqual(h.store.listQuestions(id), []);
  assert.deepEqual(h.store.findSessionsByIssue({ platform: 'tracker-a', key: 'ABC-12' }), []);
  assert.deepEqual(await h.prwbRefs(`refs/prwb/${id}/`), [], 'every app-owned ref of the session is gone');
  assert.equal((await h.worktrees()).includes(workspace), false);
  assert.equal(existsSync(join(h.paths.workspaces, id)), false, 'the workspace directory is gone');
  assert.throws(() => h.sessions.detail(id));

  assert.ok(h.store.readSession(kept.sessionId), 'the other session is kept');
  assert.equal(h.store.listQuestions(kept.sessionId).length, 1);
  assert.deepEqual(await h.prwbRefs(`refs/prwb/${kept.sessionId}/`), keptRefs);
  assert.ok((await h.worktrees()).includes(keptWorkspace));
});
