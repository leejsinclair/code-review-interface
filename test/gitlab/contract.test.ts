// T023 (US1 AS1-AS4; FR-001 to FR-015, FR-029, FR-031, FR-045; SC-001, SC-004, SC-005): the shared
// source-control and issue-tracker contract suites, run against the local GitLab with data this file
// seeds moments before. The suites are the same ones the recorded-fixture targets pass; everything
// GitLab-specific is expected values here, never a branch in a suite.
//
// The adapters are built through the registry with the run's reviewer token (Developer, read-only
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
import { adapterDeps, createIssueTracker, createSourceControl, createSourceControlWriter, writerDeps } from '../../src/adapters/registry.ts';
import { AdapterError } from '../../src/contracts/shared.ts';
import type { Authorize } from '../../src/contracts/shared.ts';
import type { ChangedFileInfo, CommitInfo, RepoRef } from '../../src/contracts/source-control.ts';
import { runIssueTrackerContract, type IssueTrackerTarget } from '../contract/issue-tracker.suite.ts';
import { runSourceControlContract, type SourceControlTarget } from '../contract/source-control.suite.ts';
import { loggedFetch, type LoggedFetch } from '../helpers/logged-fetch.ts';
import { loggedWriteFetch } from '../helpers/logged-write-fetch.ts';
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
  // The runner counts the file as finished (and runs `after`, which deletes the run's projects) as soon as it
  // has no pending test. Seeding awaits at the top level, so this test keeps the file open until it is done.
  let seedingDone: () => void = () => {};
  const seeding = new Promise<void>((resolve) => {
    seedingDone = resolve;
  });
  test('seeded data is ready before any case runs', async () => {
    await seeding;
  });
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
      // GitLab's web page is the project's HTTP clone address without `.git`, then the merge request path.
      webPage: { number: pull.number, url: `${review.httpUrl.replace(/\.git$/, '')}/-/merge_requests/${pull.number}` },
      account: run.reviewer.username,
      currentUser: { handle: run.reviewer.username },
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

  // ------------------------------------------------------------------ writes (T064; US7, FR-031, FR-029, VO-048)
  // The reviewer acts on a merge request AUTHORED BY ANOTHER account (the seeded author), with a Developer
  // role and an `api` token. Everything is written to one run-owned project (`ownedBy`) and nowhere else;
  // the project goes away with the run's cleanup. Writes use their own logged network, so the read-only
  // check below still sees only the read-side adapters.
  const writeRepoSeed = await (async () => {
    const project = await seeder.createRepository('write');
    await seeder.pushCommit(project, 'main', [
      { kind: 'add', path: 'src/reset.js', content: 'export const reset = () => false;\n' },
    ]);
    await seeder.pushCommit(project, 'feature/write', [
      { kind: 'edit', path: 'src/reset.js', content: 'export const reset = () => true;\n' },
      { kind: 'add', path: 'docs/reset.md', content: '# Reset\n\nReset tokens\nare reusable.\n' },
    ]);
    const mr = await seeder.openPullRequest(project, { source: 'feature/write', target: 'main', title: 'Authored by the other account', asAuthor: true });
    return { project, mr, writeToken: await seeder.createReviewerWriteToken() };
  })();
  seedingDone();
  const writeRepo: RepoRef = { platform: SC_ID, id: writeRepoSeed.project.id };
  const writeMr = writeRepoSeed.mr;
  const writeNet = loggedWriteFetch();
  const writeSettings = { repository: writeRepo, baseUrl: GITLAB_URL };
  const writer = createSourceControlWriter(SC_ID, writerDeps(writeNet.fetch, bearer(writeRepoSeed.writeToken)), writeSettings);
  const reader = createSourceControl(SC_ID, adapterDeps(SC_ID, writeNet.fetch, bearer(writeRepoSeed.writeToken)), writeSettings);
  const projectPath = `/api/v4/projects/${encodeURIComponent(writeRepoSeed.project.id)}/merge_requests/${writeMr.number}`;
  const commentsNow = () => reader.listComments(writeRepo, writeMr.number);
  const live: { lineComment?: string; wholeComment?: string } = {};
  const head = writeMr.headCommit;

  test('US7 gitlab write: the reviewer is not the merge request author, and the token carries write access', async () => {
    assert.notEqual(writeMr.author, run.reviewer.username, 'the author is another account');
    assert.equal(writeMr.author, seeder.author.username);
    assert.equal((await reader.currentUser()).handle, run.reviewer.username);
    assert.ok(ownedBy(run.name, writeRepoSeed.project.id.split('/').pop() ?? ''), 'the target project is owned by this run');
  });

  test('US7 gitlab write: postComment posts on the whole merge request and the read side lists it as the reviewer', async () => {
    const out = await writer.postComment(writeRepo, writeMr.number, 'live whole-request comment');
    assert.equal(out.kind, 'comment');
    live.wholeComment = out.kind === 'comment' ? out.commentId : undefined;
    const found = (await commentsNow()).find((c) => c.id === live.wholeComment);
    assert.equal(found?.body, 'live whole-request comment');
    assert.equal(found?.anchor, null);
    assert.equal(found?.author.handle, run.reviewer.username);
  });

  test('US7 gitlab write: postLineComment anchors a single line on the head, replyToThread joins that thread', async () => {
    const out = await writer.postLineComment(writeRepo, writeMr.number, { path: 'src/reset.js', side: 'head', startLine: 1, endLine: 1, commit: head }, 'live line comment');
    assert.equal(out.kind, 'comment');
    if (out.kind !== 'comment') return;
    assert.ok(out.threadId !== undefined && out.threadId !== '', 'a thread id comes back');
    live.lineComment = out.commentId;
    const root = (await commentsNow()).find((c) => c.id === out.commentId);
    assert.equal(root?.anchor?.path, 'src/reset.js');
    assert.equal(root?.anchor?.startLine, 1);

    const reply = await writer.replyToThread(writeRepo, writeMr.number, out.threadId as string, 'live reply');
    assert.equal(reply.kind === 'comment' && reply.threadId, out.threadId);
    const listed = await commentsNow();
    const replied = listed.find((c) => c.body === 'live reply');
    assert.equal(replied?.threadId, listed.find((c) => c.id === out.commentId)?.threadId);
    assert.equal(replied?.startsThread, false);
  });

  test('US7 gitlab write: postLineComment accepts a multi-line range on the head', async () => {
    const out = await writer.postLineComment(writeRepo, writeMr.number, { path: 'docs/reset.md', side: 'head', startLine: 3, endLine: 4, commit: head }, 'live range comment');
    assert.equal(out.kind, 'comment');
    const found = (await commentsNow()).find((c) => c.body === 'live range comment');
    assert.equal(found?.anchor?.path, 'docs/reset.md');
    assert.equal(found?.anchor?.endLine, 4);
  });

  test("US7 gitlab write: editComment changes the text of the reviewer's own comment", async () => {
    await writer.editComment(writeRepo, writeMr.number, live.lineComment as string, 'live line comment, edited');
    const found = (await commentsNow()).find((c) => c.id === live.lineComment);
    assert.equal(found?.body, 'live line comment, edited');
  });

  test('US7 gitlab write: deleteComment removes that comment and no other', async () => {
    const before = (await commentsNow()).map((c) => c.id);
    await writer.deleteComment(writeRepo, writeMr.number, live.wholeComment as string);
    const after = (await commentsNow()).map((c) => c.id);
    assert.ok(!after.includes(live.wholeComment as string), 'the deleted comment is gone');
    assert.deepEqual(after, before.filter((id) => id !== live.wholeComment), 'every other comment remains');
  });

  test("US7 gitlab write: approve on the head is the reviewer's decision; withdraw clears it; a second withdraw is a conflict", async () => {
    assert.equal(await reader.myDecision(writeRepo, writeMr.number), null, 'no decision yet');
    const approved = await writer.approve(writeRepo, writeMr.number, head, 'live approval note');
    assert.equal(approved.kind === 'decision' && approved.decision, 'approved');
    assert.equal(approved.kind === 'decision' && approved.message?.posted, true, 'the message is posted after the decision');
    const mine = await reader.myDecision(writeRepo, writeMr.number);
    assert.equal(mine?.kind, 'approved');

    const withdrawn = await writer.withdrawDecision(writeRepo, writeMr.number);
    assert.equal(withdrawn.kind === 'decision' && withdrawn.decision, 'withdrawn');
    assert.equal(await reader.myDecision(writeRepo, writeMr.number), null);

    const before = writeNet.writes.length;
    await assert.rejects(writer.withdrawDecision(writeRepo, writeMr.number), (e: unknown) => e instanceof AdapterError && e.code === 'conflict');
    assert.equal(writeNet.writes.length, before, 'a withdraw with nothing to withdraw sends no write');
  });

  test('US7 gitlab write: requestChanges is refused (no REST request-changes) and sends no write', async () => {
    const before = writeNet.writes.length;
    await assert.rejects(writer.requestChanges(writeRepo, writeMr.number, head, 'please change'), (e: unknown) => e instanceof AdapterError && e.code === 'rejected');
    assert.equal(writeNet.writes.length, before);
  });

  test('US7 gitlab write: a line comment on a commit the merge request has moved past is a conflict and posts nothing (FR-019)', async () => {
    const newHead = await seeder.pushCommit(writeRepoSeed.project, 'feature/write', [{ kind: 'edit', path: 'docs/reset.md', content: '# Reset\n\nReset tokens\nare reusable, twice.\n' }]);
    assert.notEqual(newHead, head);
    const before = writeNet.writes.length;
    await assert.rejects(
      writer.postLineComment(writeRepo, writeMr.number, { path: 'src/reset.js', side: 'head', startLine: 1, endLine: 1, commit: head }, 'too late'),
      (e: unknown) => e instanceof AdapterError && e.code === 'conflict',
    );
    assert.equal(writeNet.writes.length, before, 'the refusal happens before any write');
    assert.ok(!(await commentsNow()).some((c) => c.body === 'too late'));
    const fresh = await writer.postLineComment(writeRepo, writeMr.number, { path: 'src/reset.js', side: 'head', startLine: 1, endLine: 1, commit: newHead }, 'on the new head');
    assert.equal(fresh.kind, 'comment');
  });

  test("US7 gitlab write: every write went to the one owned project's merge request and only the allowed endpoints", () => {
    assert.ok(writeNet.writes.length >= 8, 'writes were exercised, not only reads');
    for (const w of writeNet.writes) {
      const url = new URL(w.url);
      assert.equal(url.host, host);
      assert.ok(url.pathname.startsWith(projectPath), `write outside the owned merge request: ${w.method} ${url.pathname}`);
    }
    writeNet.assertOnlyAllowedWrites([
      { method: 'POST', pattern: /\/notes$/ },
      { method: 'POST', pattern: /\/discussions$/ },
      { method: 'POST', pattern: /\/discussions\/[^/]+\/notes$/ },
      { method: 'PUT', pattern: /\/notes\/\d+$/ },
      { method: 'DELETE', pattern: /\/notes\/\d+$/ },
      { method: 'POST', pattern: /\/(approve|unapprove)$/ },
    ]);
  });

  // ------------------------------------------------------------------ read-only (SC-005, FR-029)
  test('SC-005 gitlab: every adapter request in this file was a GET to the GitLab host', () => {
    assert.ok(networks.some((n) => n.requests.length > 0));
    for (const logged of networks) {
      logged.assertOnlyGets();
      logged.assertHosts([host]);
    }
  });
}
