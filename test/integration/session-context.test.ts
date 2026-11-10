// VO-002 (FR-003, US1-AS2), VO-007 (FR-010, US1-AS7), VO-029 (FR-011), VO-038 (FR-026), VO-062
// (FR-010, EC-04) and VO-077 (FR-052, FR-010): issue references and their origins, snapshots across
// refreshes, issue Evidence across re-fetches, and grouping by platform and key.
//
// The issue tracker is the real project-key adapter over recorded fixtures, built through the
// registry (T076): adapterDeps(platform, network, authorize) and createIssueTracker(platform, deps, settings).
// Evidence staleness for commit-bound kinds is derived (T067): effectiveStatus(evidence, latestHeadCommit).

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
import { loadFixtures, recordedFetch, type FixtureEntry, type RecordedFetch } from '../helpers/recorded-fetch.ts';

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
    repositoryForRemote: (remote: string) => (remote === 'code.example.test/acme/widgets' ? 'acme/widgets' : null),
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

const TRACKER = 'jira-cloud';
const ISSUE_URL = (key: string) => `https://acme.atlassian.net/rest/api/3/issue/${key}?fields=summary,description`;

/** The recorded tracker, with ABC-12's responses replaced by `abc12` when given (served in order). */
async function jiraTracker(abc12?: FixtureEntry['response'][]): Promise<{ tracker: IssueTracker; recorded: RecordedFetch }> {
  const { adapterDeps, createIssueTracker } = await import('../../src/adapters/registry.ts');
  let entries: FixtureEntry[] = loadFixtures('jira');
  if (abc12 !== undefined) {
    const recordedBody = entries.find((e) => e.request.url === ISSUE_URL('ABC-12'))?.response;
    entries = entries.filter((e) => e.request.url !== ISSUE_URL('ABC-12'));
    for (const response of abc12) entries.push({ request: { url: ISSUE_URL('ABC-12') }, response: response ?? recordedBody ?? {} });
  }
  const recorded = recordedFetch([], { entries });
  const authorize = (request: Request): Request => {
    const headers = new Headers(request.headers);
    headers.set('authorization', 'Basic dGVzdDp0ZXN0');
    return new Request(request, { headers });
  };
  const tracker = createIssueTracker(TRACKER, adapterDeps(TRACKER, recorded.fetch, authorize), {
    repository: { platform: SOURCE, id: 'acme/widgets' },
    site: 'https://acme.atlassian.net',
    projectKeys: ['ABC'],
  });
  return { tracker, recorded };
}

const OK_ABC12 = (() => {
  const entry = loadFixtures('jira').find((e) => e.request.url === ISSUE_URL('ABC-12'));
  assert.ok(entry);
  return entry.response;
})();
const SERVER_ERROR: FixtureEntry['response'] = { status: 500, body: { errorMessages: ['Internal server error'], errors: {} } };

test('VO-002 a key in the branch name and another in the description are both returned, each with its origin', async (t) => {
  const { tracker, recorded } = await jiraTracker();
  const h = await harness(t, { tracker });
  await h.sandbox.openPr({ number: 1, branch: 'feature/ABC-12-reset', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1, { title: 'Allow a second reset', description: 'Also fixes ABC-13.' });

  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  const byKey = new Map(detail.issues.map((i) => [i.key, i]));
  assert.deepEqual([...byKey.keys()].sort(), ['ABC-12', 'ABC-13']);
  assert.deepEqual(byKey.get('ABC-12')?.origins, ['branch']);
  assert.deepEqual(byKey.get('ABC-13')?.origins, ['description']);
  for (const issue of detail.issues) {
    assert.equal(issue.platform, TRACKER);
    assert.equal(issue.kind, 'issue');
    assert.equal(issue.status, 'found');
  }
  assert.equal(byKey.get('ABC-13')?.title, 'Reset emails are sent twice');
  const stored = h.store.listIssueReferences(detail.snapshots[0]?.snapshotId ?? '');
  assert.deepEqual(
    stored.map((r) => [r.issue.platform, r.issue.key, r.origins]).sort(),
    [
      [TRACKER, 'ABC-12', [{ field: 'branch', text: 'ABC-12' }]],
      [TRACKER, 'ABC-13', [{ field: 'description', text: 'ABC-13' }]],
    ],
  );
  recorded.assertAllRecorded();
  assert.equal(recorded.requests.length, 2, 'one lookup per key');
});

test('VO-007 refresh after a new commit adds snapshot 2, keeps snapshot 1, lists the files changed between heads and shows old-head evidence stale', async (t) => {
  const { effectiveStatus } = await import('../../src/core/evidence.ts');
  const { tracker } = await jiraTracker();
  const h = await harness(t, { tracker });
  const first = await h.sandbox.openPr({ number: 1, branch: 'feature/ABC-12-reset', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  const id = detail.sessionId;
  const snapshot1 = h.store.readSnapshot(detail.snapshots[0]?.snapshotId ?? '');
  assert.ok(snapshot1);
  // Commit-bound evidence captured for the first head (a later feature's kind).
  h.store.appendEvidence({
    id: '00000000-0000-4000-8000-00000000c0de',
    sessionId: id,
    snapshotId: snapshot1.id,
    kind: 'custom',
    source: { platform: 'checker-a', key: 'lint' },
    capturedAt: '2026-11-07T00:00:00.000Z',
    commit: first.head,
    commitBound: true,
    status: 'current',
    reason: null,
    lastGoodId: null,
    payload: { platform: 'checker-a', key: 'lint', title: 'Lint', descriptionText: 'clean', webUrl: '' },
  });

  const second = await h.sandbox.pushCommit(1, { 'src/util.js': UTIL_V3, 'docs/sub.md': '# sub\n' });
  h.platform.publish(1);
  const refreshed = await h.sessions.refresh(id);

  assert.equal(refreshed.snapshots.length, 2);
  assert.equal(refreshed.snapshots[0]?.snapshotId, snapshot1.id);
  assert.equal(refreshed.snapshots[1]?.headCommit, second.head);
  assert.deepEqual(h.store.readSnapshot(snapshot1.id), snapshot1, 'snapshot 1 is unchanged');
  assert.deepEqual(
    (await h.sessions.changedBetween(id, snapshot1.id, refreshed.snapshots[1]?.snapshotId ?? '')).sort(),
    ['docs/sub.md', 'src/util.js'],
  );
  const evidence = h.store.listEvidence(id);
  const custom = evidence.find((e) => e.kind === 'custom');
  assert.ok(custom);
  assert.equal(effectiveStatus(custom, second.head), 'stale', 'commit-bound evidence of the old head shows stale');
  const issue = evidence.filter((e) => e.kind === 'issue').at(-1);
  assert.ok(issue);
  assert.equal(effectiveStatus(issue, second.head), 'current', 'issue evidence is not commit-bound');
  assert.deepEqual(h.snapshotsTaken, refreshed.snapshots.map((s) => s.snapshotId), 'each new snapshot is announced');
});

test('VO-029 an issue re-fetch that succeeds appends current, one that fails appends stale with the reason and keeps the last record', async (t) => {
  const { tracker } = await jiraTracker([OK_ABC12, OK_ABC12, SERVER_ERROR]);
  const h = await harness(t, { tracker });
  await h.sandbox.openPr({ number: 1, branch: 'feature/ABC-12-reset', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  const id = detail.sessionId;
  const source = { platform: TRACKER, key: 'ABC-12' };
  assert.deepEqual(h.store.listEvidenceBySource(id, source).map((e) => e.status), ['current']);

  await h.sessions.refresh(id); // same head: no snapshot, issue re-fetched
  const afterSuccess = h.store.listEvidenceBySource(id, source);
  assert.deepEqual(afterSuccess.map((e) => e.status), ['current', 'current']);

  const refreshed = await h.sessions.refresh(id); // the tracker fails
  const all = h.store.listEvidenceBySource(id, source);
  assert.deepEqual(all.map((e) => e.status), ['current', 'current', 'stale']);
  assert.deepEqual(all.slice(0, 2), afterSuccess, 'no earlier record changed or was deleted');
  const stale = all[2];
  assert.equal(stale?.reason, 'tracker unreachable');
  assert.equal(stale?.lastGoodId, afterSuccess[1]?.id);
  assert.equal(refreshed.snapshots.length, 1, 'the head did not move');

  const issue = refreshed.issues.find((i) => i.key === 'ABC-12');
  assert.equal(issue?.status, 'stale');
  assert.equal(issue?.reason, 'tracker unreachable');
  assert.equal(issue?.title, 'Customers cannot reset a password twice', 'the last fetched record is shown');
  assert.equal(refreshed.completeness.find((r) => r.source === 'issue')?.status, 'stale');
});

test('VO-038 two sessions on the same issue are found by platform and key, and every reference carries its platform', async (t) => {
  const { tracker } = await jiraTracker();
  const h = await harness(t, { tracker });
  await h.sandbox.openPr({ number: 1, branch: 'feature/reset', files: { 'src/util.js': UTIL_V2 } });
  await h.sandbox.openPr({ number: 2, branch: 'feature/reset-docs', files: { 'README.md': '# widgets\n\nReset docs.\n' } });
  h.platform.publish(1, { description: 'Fixes ABC-12.' });
  h.platform.publish(2, { description: 'Documents ABC-12.' });

  const one = (await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1)).detail;
  const two = (await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 2)).detail;

  const found = h.store.findSessionsByIssue({ platform: TRACKER, key: 'ABC-12' }).map((s) => s.id).sort();
  assert.deepEqual(found, [one.sessionId, two.sessionId].sort());
  assert.deepEqual(h.store.findSessionsByIssue({ platform: 'another-tracker', key: 'ABC-12' }), []);
  for (const detail of [one, two]) {
    const session = h.store.readSession(detail.sessionId);
    assert.equal(session?.pr.repo.platform, SOURCE);
    assert.equal(detail.platform, SOURCE);
    const snapshot = h.store.readSnapshot(detail.snapshots[0]?.snapshotId ?? '');
    assert.equal(snapshot?.sourceBranch.repo.platform, SOURCE);
    assert.equal(snapshot?.targetBranch.repo.platform, SOURCE);
    for (const ref of h.store.listIssueReferences(snapshot?.id ?? '')) assert.equal(ref.issue.platform, TRACKER);
  }
});

test('VO-062 a force-push becomes a new snapshot and earlier snapshots with their questions are kept', async (t) => {
  const h = await harness(t);
  const first = await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  const id = detail.sessionId;
  const snapshot1 = detail.snapshots[0]?.snapshotId ?? '';
  h.store.appendQuestion({
    id: '00000000-0000-4000-8000-0000000000a1',
    sessionId: id,
    snapshotId: snapshot1,
    seq: 1,
    askedAt: '2026-11-07T00:00:00.000Z',
    text: 'Why is sub added?',
    category: 'why',
    audience: 'technical',
    scope: { type: 'pr', path: null, side: null, startLine: null, endLine: null, label: null },
    followsQuestionId: null,
    origin: 'typed',
    provider: 'ai-a',
  });

  const rewritten = await h.sandbox.forcePush(1, { 'src/util.js': UTIL_V3 });
  assert.notEqual(rewritten.head, first.head);
  h.platform.publish(1);
  const refreshed = await h.sessions.refresh(id);

  assert.deepEqual(refreshed.snapshots.map((s) => s.headCommit), [first.head, rewritten.head]);
  assert.equal(refreshed.snapshots[0]?.snapshotId, snapshot1);
  assert.deepEqual(h.store.listQuestions(id).map((q) => [q.id, q.snapshotId]), [['00000000-0000-4000-8000-0000000000a1', snapshot1]]);
  assert.ok(
    (await h.prwbRefs(`refs/prwb/${id}/${snapshot1}/`)).some((line) => line.endsWith(` ${first.head}`)),
    'the earlier head stays reachable through its app-owned ref',
  );
  assert.equal(refreshed.workspaceReady, true);
});

test('VO-077 a refresh with the head unchanged after a successful fetch takes no snapshot', async (t) => {
  const h = await harness(t);
  await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1);
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);

  const refreshed = await h.sessions.refresh(detail.sessionId);
  assert.equal(refreshed.snapshots.length, 1);
  assert.deepEqual(h.snapshotsTaken, [detail.snapshots[0]?.snapshotId]);
});

test('VO-077 a refresh with the head unchanged after a failed fetch takes a snapshot for the same head', async (t) => {
  const h = await harness(t);
  const pr = await h.sandbox.openPr({ number: 1, branch: 'feature/sub', files: { 'src/util.js': UTIL_V2 } });
  h.platform.publish(1, { brokenHead: true });
  const { detail } = await h.sessions.start({ platform: SOURCE, id: 'acme/widgets' }, 1);
  assert.equal(detail.completeness.find((r) => r.source === 'repository')?.status, 'missing');
  assert.deepEqual(h.snapshotsTaken, [], 'nothing is announced without a workspace');

  h.platform.set(1, { brokenHead: false });
  const refreshed = await h.sessions.refresh(detail.sessionId);
  assert.deepEqual(refreshed.snapshots.map((s) => s.headCommit), [pr.head, pr.head]);
  assert.deepEqual(refreshed.snapshots.map((s) => s.diffSource), ['platform', 'local']);
  assert.equal(refreshed.completeness.find((r) => r.source === 'repository')?.status, 'found');
  assert.deepEqual(h.snapshotsTaken, [refreshed.snapshots[1]?.snapshotId]);
});
