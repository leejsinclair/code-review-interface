// T023 (US1 AS1-AS4; FR-001 to FR-015, FR-029, FR-031, FR-045; SC-001, SC-004, SC-005): the shared
// source-control and issue-tracker contract suites, run against the local GitLab with data this file
// seeds moments before. The suites are the same ones the recorded-fixture targets pass; everything
// GitLab-specific is expected values here, never a branch in a suite.
//
// The adapters are built through the registry with the run's reviewer token (Reporter, read-only
// scopes), never the root token (FR-029), over `loggedFetch`, so every request can be checked to be
// a GET (SC-005). The root token is used only by the seeder and to read seeded commit times.
//
// Seeded layout (one project with nested groups, `prwb-it/<run>/<run>-review`):
//   main       README.md + src/reset.js, src/token.js, src/legacy.js
//   !pull      feature/reset: two commits; added, modified, renamed (+1/-1), deleted and a binary file
//   !fork      from <run>-review-fork, branch fix/null-check
//   !deleted   opened, then deleted
//   issues     one with a Markdown description; one hidden in a project the reviewer cannot see

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { adapterDeps, createIssueTracker, createSourceControl } from '../../src/adapters/registry.ts';
import type { Authorize } from '../../src/contracts/shared.ts';
import type { ChangedFileInfo, CommitInfo, RepoRef } from '../../src/contracts/source-control.ts';
import { runIssueTrackerContract, type IssueTrackerTarget } from '../contract/issue-tracker.suite.ts';
import { runSourceControlContract, type SourceControlTarget } from '../contract/source-control.suite.ts';
import { loggedFetch, type LoggedFetch } from '../helpers/logged-fetch.ts';
import { GitlabAdmin, GitlabSeeder } from '../seeder/gitlab-seeder.ts';
import { ownedBy } from '../seeder/run-name.ts';
import { GITLAB_TOKEN, GITLAB_URL, gitlabGate } from './env.ts';

const SC_ID = 'gitlab';
const TRACKER_ID = 'gitlab-issues';
const CLEANUP_TIMEOUT_MS = 300_000;

const gate = await gitlabGate();

const bearer = (token: string): Authorize => (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${token}`);
  return new Request(request, { headers });
};

/** `host/path` of a clone URL, lower-cased, without scheme, port or `.git` (the workbench's remote form). */
const cloneLocationOf = (httpUrl: string): string => {
  const url = new URL(httpUrl);
  return `${url.hostname}${url.pathname.replace(/\.git$/, '')}`.toLowerCase();
};

if (gate.skip !== undefined) {
  test('GitLab contract suites', gate, () => {});
} else {
  const seeder = new GitlabSeeder({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const admin = new GitlabAdmin({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const host = new URL(GITLAB_URL).host;
  const networks: LoggedFetch[] = [];
  let runName = '';

  after(
    async () => {
      if (runName === '') return;
      const others = await seeder.listLeftovers().catch(() => null);
      await seeder.cleanup();
      if (others !== null && (others.projects.length > 0 || others.users.length > 0)) {
        console.warn(`[contract] other it-* items, from earlier crashed runs or runs still in progress (not touched; npm run gitlab:clean removes them):\n  ${[...others.projects, ...others.users].join('\n  ')}`);
      }
      const items = await admin.listRunItems();
      const mine = [...items.projects.map((p) => p.path), ...items.groups.map((g) => g.path), ...items.users.map((u) => u.username)].filter(
        (name: string) => ownedBy(runName, name),
      );
      assert.deepEqual(mine, [], `run ${runName} left items behind`);
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  );

  // ------------------------------------------------------------------ seeding
  // A failure while seeding still removes what was created before it.
  const run = await seeder.begin('contract');
  runName = run.name;
  const seed = async () => {
    const review = await seeder.createRepository('review');
    const tokenLines = (n: number): string => ['export function token() {', '  const size = 32;', '  const alphabet = "abc";', `  return make(size, alphabet, ${n});`, '}', ''].join('\n');
    await seeder.pushCommit(review, 'main', [
      { kind: 'add', path: 'src/reset.js', content: 'export const reset = () => false;\n' },
      { kind: 'add', path: 'src/token.js', content: tokenLines(1) },
      { kind: 'add', path: 'src/legacy.js', content: 'old();\nolder();\n' },
    ]);
    const fork = await seeder.forkRepository(review);

    const first = await seeder.pushCommit(review, 'feature/reset', [
      { kind: 'edit', path: 'src/reset.js', content: 'export const reset = () => true;\n' },
      { kind: 'add', path: 'docs/reset.md', content: '# Reset\n\nReset tokens\nare reusable.\n' },
    ]);
    const second = await seeder.pushCommit(review, 'feature/reset', [
      { kind: 'rename', from: 'src/token.js', to: 'src/auth/token.js', content: tokenLines(2) },
      { kind: 'delete', path: 'src/legacy.js' },
      { kind: 'add', path: 'assets/logo.png', content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 1, 2, 3, 0xff, 0]) },
    ]);
    const pull = await seeder.openPullRequest(review, {
      source: 'feature/reset',
      target: 'main',
      title: 'Allow password reset more than once',
      description: 'Fixes #1.\r\n\r\nReset tokens are no longer single use.',
    });

    await seeder.pushCommit(fork, 'fix/null-check', [{ kind: 'edit', path: 'src/reset.js', content: 'export const reset = () => null;\n' }]);
    const forkPull = await seeder.openPullRequest(review, { source: 'fix/null-check', target: 'main', title: 'Null check', sourceRepo: fork });

    await seeder.pushCommit(review, 'doomed', [{ kind: 'add', path: 'doomed.txt', content: 'gone soon\n' }]);
    const doomed = await seeder.openPullRequest(review, { source: 'doomed', target: 'main', title: 'Doomed' });
    await seeder.deletePullRequest(doomed);

    const issue = await seeder.createIssue(review, {
      title: 'Customers cannot reset a password twice',
      description: '**Steps**\n\n1. Request a reset\n2. Request another reset\n\n<b>Expected</b>: both work.',
    });
    const hidden = await seeder.createHiddenIssue({ title: 'Hidden from the reviewer' });
    const revoked = await seeder.createReviewerToken();
    await seeder.revokeReviewerToken(revoked);

    /** The seeded commit as the contract reports it; the time is read back from GitLab with the root token. */
    const seededCommit = async (sha: string, message: string): Promise<CommitInfo> => {
      const raw = await admin.call('GET', `/projects/${review.platformId}/repository/commits/${sha}`);
      return { sha, message, author: 'PRWB Seeder', authoredAt: new Date(raw.authored_date).toISOString() };
    };
    const commits = [
      await seededCommit(first, 'seed: 2 change(s) on feature/reset'),
      await seededCommit(second, 'seed: 3 change(s) on feature/reset'),
    ];
    return { review, fork, first, second, pull, forkPull, doomed, issue, hidden, revoked, commits };
  };
  const seeded = await seed().catch(async (error: unknown) => {
    await seeder.cleanup();
    runName = '';
    throw error;
  });
  const { review, second, pull, forkPull, doomed, issue, hidden, revoked, commits } = seeded;

  const changedFiles: ChangedFileInfo[] = [
    { path: 'assets/logo.png', status: 'added', linesAdded: 0, linesRemoved: 0, binary: true },
    { path: 'docs/reset.md', status: 'added', linesAdded: 4, linesRemoved: 0, binary: false },
    { path: 'src/auth/token.js', previousPath: 'src/token.js', status: 'renamed', linesAdded: 1, linesRemoved: 1, binary: false },
    { path: 'src/legacy.js', status: 'deleted', linesAdded: 0, linesRemoved: 2, binary: false },
    { path: 'src/reset.js', status: 'modified', linesAdded: 1, linesRemoved: 1, binary: false },
  ];

  const repo: RepoRef = { platform: SC_ID, id: review.id };

  /** A logged network for one case; kept so the file can check every request at the end. */
  const network = (): LoggedFetch => {
    const logged = loggedFetch();
    networks.push(logged);
    return logged;
  };

  // ------------------------------------------------------------------ source control (US1 AS1, AS3)
  const sourceControl: SourceControlTarget = {
    id: SC_ID,
    host,
    async create(scenario = 'default') {
      const logged = network();
      const token = scenario === 'unauthorized' ? revoked : run.reviewer.token;
      const sc = createSourceControl(SC_ID, adapterDeps(SC_ID, logged.fetch, bearer(token)), { repository: repo, baseUrl: GITLAB_URL });
      return {
        sc,
        get requests() {
          return logged.requests.map((r) => ({ method: r.method, host: r.host, headers: {} }));
        },
      };
    },
    expected: {
      repo,
      pull: {
        number: pull.number,
        title: pull.title,
        description: 'Fixes #1.\n\nReset tokens are no longer single use.',
        author: pull.author,
        sourceBranch: 'feature/reset',
        targetBranch: 'main',
        headCommit: second,
      },
      openNumbers: [pull.number, forkPull.number].sort((a, b) => a - b),
      commits,
      changedFiles,
      // GitLab exposes every merge request's head, a fork's too, on the base project.
      forkPull: {
        number: forkPull.number,
        headCommit: forkPull.headCommit,
        headRemoteUrl: review.httpUrl,
        headRef: `refs/merge-requests/${forkPull.number}/head`,
        targetRemoteUrl: review.httpUrl,
        targetRef: 'refs/heads/main',
      },
      cloneLocation: { input: { platform: SC_ID, id: review.id.toUpperCase() }, location: cloneLocationOf(review.httpUrl) },
      account: run.reviewer.username,
      deletedPr: doomed.number,
      unauthorizedRepo: repo,
    },
  };
  runSourceControlContract(sourceControl);

  test('US1 AS3 gitlab: changed files carry status, previous path, line counts and the binary flag', async () => {
    const { sc } = await sourceControl.create();
    const files = await sc.listChangedFiles(repo, pull.number);
    const byPath = new Map(files.map((f) => [f.path, f]));
    assert.equal(byPath.get('assets/logo.png')?.binary, true, 'the binary file is marked binary');
    assert.equal(byPath.get('src/auth/token.js')?.previousPath, 'src/token.js');
    assert.deepEqual(files.filter((f) => f.binary).map((f) => f.path), ['assets/logo.png'], 'no text file is marked binary');
  });

  // ------------------------------------------------------------------ issue tracker (US1 AS2)
  const reviewKey = review.id.toLowerCase();
  const tracker: IssueTrackerTarget = {
    platform: TRACKER_ID,
    network() {
      const logged = network();
      return { fetch: logged.fetch, requests: logged.requests, check: () => logged.assertOnlyGets() };
    },
    create: (fetch) =>
      createIssueTracker(TRACKER_ID, adapterDeps(TRACKER_ID, fetch, bearer(run.reviewer.token)), { repository: repo, site: GITLAB_URL }),
    expected: {
      host,
      account: run.reviewer.username,
      sameIssue: {
        text: `Closes #${issue.number}, see also ${review.id.toUpperCase()}#${issue.number}`,
        key: `${reviewKey}#${issue.number}`,
        forms: [`#${issue.number}`, `${review.id.toUpperCase()}#${issue.number}`],
      },
      issue: { key: `${reviewKey}#${issue.number}`, title: issue.title, descriptionText: issue.description },
      wrongKey: `${reviewKey}#999`,
      // GitLab answers 404 for an issue in a project the reviewer cannot see.
      noAccess: { key: `${hidden.repo.id.toLowerCase()}#${hidden.number}`, reason: 'not found' },
      pullRequestRef: {
        text: `Builds on !${pull.number} and fixes ${review.id}#${issue.number}.`,
        pull: { key: `${reviewKey}!${pull.number}`, form: '!123' },
        issue: { key: `${reviewKey}#${issue.number}`, form: 'owner/repo#123', title: issue.title },
      },
    },
  };
  runIssueTrackerContract(tracker);

  // ------------------------------------------------------------------ read-only (SC-005, FR-029)
  test('SC-005 gitlab: every adapter request in this file was a GET to the GitLab host', () => {
    assert.ok(networks.some((n) => n.requests.length > 0));
    for (const logged of networks) {
      logged.assertOnlyGets();
      logged.assertHosts([host]);
    }
  });
}
