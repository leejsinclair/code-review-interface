// VO-022 (FR-002, FR-025, FR-031, XI.2): one SourceControlProvider suite, run against every
// source-control adapter. A target supplies the adapter factory and every expected value as data,
// so fixture targets pass recorded constants and live targets pass seeded values. The suite never
// branches on platform.
//
// Adapters normalise what differs by platform: commits oldest first with ISO 8601 UTC times, the
// full 40-character head commit, statuses as added | modified | deleted | renamed | copied.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlatformId } from '../../src/contracts/shared.ts';
import type { ChangedFileInfo, CommitInfo, RepoRef, SourceControlProvider } from '../../src/contracts/source-control.ts';

/** What the suite reads from each request the adapter made. */
export type ObservedRequest = { method: string; host: string; headers: Record<string, string> };

/**
 * The situation the adapter is built for:
 * - `default`: the target's ordinary data;
 * - `deleted-pr`: `expected.deletedPr` names a pull request that no longer exists;
 * - `unauthorized`: the credential is refused for `expected.unauthorizedRepo`;
 * - `comment-threads`, `orphaned-threads`: pull requests whose comments are the data in `expected.threads`
 *   and `expected.orphans`;
 * - `approvals-partial`, `approvals-all-fail`: the approval checks named in `expected.approvals` fail.
 */
export type SourceControlScenario =
  | 'default'
  | 'deleted-pr'
  | 'unauthorized'
  | 'comment-threads'
  | 'orphaned-threads'
  | 'approvals-partial'
  | 'approvals-all-fail';

export type SourceControlHarness = {
  sc: SourceControlProvider;
  /** Every request the adapter made, in order. */
  readonly requests: readonly ObservedRequest[];
  /** Throws when the transport saw something it could not serve (for example an unrecorded request). */
  assertComplete?(): void;
};

export type SourceControlExpectations = {
  /** The repository every case reads. */
  repo: RepoRef;
  /** The pull request read in full. */
  pull: {
    number: number;
    title: string;
    /** Compared after `\r\n` becomes `\n`. */
    description: string;
    author: string;
    sourceBranch: string;
    targetBranch: string;
    headCommit: string;
  };
  /** Numbers of every open pull request, ascending. */
  openNumbers: number[];
  /** `pull`'s commits, oldest first. */
  commits: CommitInfo[];
  /** `pull`'s changed files, sorted by path. The unified diff is expected to parse to the same files. */
  changedFiles: ChangedFileInfo[];
  /** A pull request from a fork, and where its head and target are exposed. */
  forkPull: { number: number; headCommit: string; headRemoteUrl: string; headRef: string; targetRemoteUrl: string; targetRef: string };
  /** `cloneLocations(input)` returns `[location]`. */
  cloneLocation: { input: RepoRef; location: string };
  /** `pullRequestUrl(repo, number)` returns `url`: the page a person opens in a browser. */
  webPage: { number: number; url: string };
  /** `verifySignIn()` reports this account. */
  account: string;
  /** `currentUser()` returns this handle; `displayName`, when given, too (a live target may not know it). */
  currentUser: { handle: string; displayName?: string };
  /** Open pull requests the signed-in account has approved; when omitted the case only checks the shape. */
  approvedNumbers?: number[];
  /** A number that rejects with `not_found` under the `deleted-pr` scenario. */
  deletedPr: number;
  /** A repository read under the `unauthorized` scenario. */
  unauthorizedRepo: RepoRef;
  /** Pull requests in their final states, when the target has them. */
  finishedPulls?: { merged: number; closed: number };
  /**
   * Feature 007 data (FR-028: the suite reads it, never branches on platform). Optional in the type so a
   * target that has not recorded it yet still compiles; a fixture target supplies all of it.
   */
  /** `pull`'s author handle (the form of `CurrentUser.handle`) and the pull request whose author is not the signed-in user (FR-001, FR-029). */
  authors?: { pullAuthorHandle: string; otherAuthorPull: { number: number; authorHandle: string } };
  /** A conversation three replies deep (FR-005, SC-003): every comment of the pull request, with the author handle each carries. */
  threads?: { number: number; comments: { id: string; authorHandle: string; threadId: string; startsThread: boolean }[] };
  /**
   * Threads whose first (and middle) comments were deleted (FR-006, EC-03). `orphanPlaceholder` is false on a
   * platform that promotes the next comment to start the thread; the remaining comments then say so in `startsThread`.
   */
  orphans?: {
    number: number;
    orphanPlaceholder: boolean;
    comments: { id: string; threadId: string; startsThread: boolean }[];
  };
  /** One check fails and the others are still reported; every check fails and the call is `unavailable` (FR-013, FR-014). */
  approvals?: { partial: { numbers: number[]; approved: number[] }; allFail: { numbers: number[] } };
  /** `cloneLocations` for `cloneLocation.input` (FR-021), remotes that are recognised, and remotes that are not. */
  clones?: { locations: string[]; recognised: { remote: string; id: string }[]; unrecognised: string[] };
};

export type SourceControlTarget = {
  /** The adapter's platform id; also names the tests. */
  id: PlatformId;
  /** The API host every request goes to. */
  host: string;
  /** When given, the `authorization` header every request must carry. */
  authorization?: string;
  create(scenario?: SourceControlScenario): Promise<SourceControlHarness>;
  expected: SourceControlExpectations;
};

function onlyAuthorisedGets(target: SourceControlTarget, harness: SourceControlHarness): void {
  harness.assertComplete?.();
  assert.ok(harness.requests.length > 0);
  for (const request of harness.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.host, target.host);
    if (target.authorization !== undefined) {
      assert.equal(request.headers['authorization'], target.authorization, 'every request is authorised by the injected callback');
    }
  }
}

export function runSourceControlContract(target: SourceControlTarget): void {
  const { id, expected } = target;
  const { repo } = expected;

  test(`VO-022 ${id}: getPullRequest returns title, description, author, branches, full head commit and state`, async () => {
    const harness = await target.create();
    const { sc } = harness;
    assert.equal(sc.id, id);
    const pr = await sc.getPullRequest(repo, expected.pull.number);
    assert.equal(pr.number, expected.pull.number);
    assert.equal(pr.title, expected.pull.title);
    assert.equal(pr.description.replace(/\r\n/g, '\n'), expected.pull.description);
    assert.equal(pr.author, expected.pull.author);
    assert.equal(pr.sourceBranch, expected.pull.sourceBranch);
    assert.equal(pr.targetBranch, expected.pull.targetBranch);
    assert.equal(pr.headCommit, expected.pull.headCommit);
    assert.equal(pr.state, 'open');
    assert.ok(!Number.isNaN(Date.parse(pr.updatedAt)));
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: listOpenPullRequests lists every open PR`, async () => {
    const harness = await target.create();
    const prs = await harness.sc.listOpenPullRequests(repo);
    assert.deepEqual(prs.map((p) => p.number).sort((a, b) => a - b), expected.openNumbers);
    for (const pr of prs) {
      assert.equal(pr.state, 'open');
      assert.ok(pr.title.length > 0);
      assert.ok(pr.sourceBranch.length > 0 && pr.targetBranch.length > 0);
    }
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: approvedByMe reports only open PRs the signed-in account approved, with reads only`, async () => {
    const harness = await target.create();
    const approved = await harness.sc.approvedByMe(repo, expected.openNumbers);
    for (const n of approved) assert.ok(expected.openNumbers.includes(n), `${n} was asked about`);
    if (expected.approvedNumbers !== undefined) assert.deepEqual([...approved].sort((a, b) => a - b), expected.approvedNumbers);
    assert.deepEqual([...(await harness.sc.approvedByMe(repo, []))], [], 'nothing asked, nothing approved');
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: listCommits returns the commits oldest first`, async () => {
    const harness = await target.create();
    assert.deepEqual(await harness.sc.listCommits(repo, expected.pull.number), expected.commits);
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: listChangedFiles returns status and line counts for each file`, async () => {
    const harness = await target.create();
    const files = (await harness.sc.listChangedFiles(repo, expected.pull.number)).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(files, expected.changedFiles);
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: getUnifiedDiff returns the unified diff the shared parser reads`, async () => {
    const { parseUnifiedDiff } = await import('../../src/repo/unified-diff.ts');
    const harness = await target.create();
    const diff = await harness.sc.getUnifiedDiff(repo, expected.pull.number);
    const files = parseUnifiedDiff(diff);
    assert.deepEqual(
      files.map((f) => [f.path, f.status, f.additions, f.deletions]),
      expected.changedFiles.map((f) => [f.path, f.status, f.linesAdded, f.linesRemoved]),
    );
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: headLocation for a fork PR names where the platform exposes its head`, async () => {
    const harness = await target.create();
    const { sc } = harness;
    const fork = expected.forkPull;
    const pr = await sc.getPullRequest(repo, fork.number);
    assert.equal(pr.headCommit, fork.headCommit);
    const head = await sc.headLocation(repo, pr);
    assert.ok(head.remoteUrls.includes(fork.headRemoteUrl), `head URLs include ${fork.headRemoteUrl}`);
    assert.ok(head.remoteUrls.some((url) => !/^https?:/.test(url)), 'an SSH form is offered too');
    assert.equal(head.ref, fork.headRef);
    const targetLocation = await sc.targetLocation(repo, pr);
    assert.ok(targetLocation.remoteUrls.includes(fork.targetRemoteUrl));
    assert.equal(targetLocation.ref, fork.targetRef);
    onlyAuthorisedGets(target, harness);
  });

  test(`VO-022 ${id}: cloneLocations gives the normalised host and path of the repository`, async () => {
    const { sc } = await target.create();
    const locations = expected.clones?.locations ?? [expected.cloneLocation.location];
    assert.deepEqual([...sc.cloneLocations(expected.cloneLocation.input)].sort(), [...locations].sort());
  });

  // Contracts 6.1 (XI.2): `repositoryForRemote` is the inverse of `cloneLocations`, pure, and matches
  // only this platform's host (a self-hosted adapter: its configured base address host).
  test(`FR-050 ${id}: every cloneLocations value maps back through repositoryForRemote to the repository id`, async () => {
    const { sc } = await target.create();
    const locations = sc.cloneLocations(expected.cloneLocation.input);
    assert.ok(locations.length > 0);
    for (const location of locations) {
      assert.equal(sc.repositoryForRemote(location), expected.cloneLocation.input.id.toLowerCase(), `${location} maps back`);
    }
  });

  test(`FR-050 ${id}: a remote on another host gives null, whatever its path`, async () => {
    const { sc } = await target.create();
    const location = sc.cloneLocations(expected.cloneLocation.input)[0] ?? '';
    const [host = '', ...path] = location.split('/');
    assert.equal(sc.repositoryForRemote(`other-${host}/${path.join('/')}`), null, 'a different host');
    assert.equal(sc.repositoryForRemote(`${host}.example.invalid/${path.join('/')}`), null, 'the host as a prefix of another');
    assert.equal(sc.repositoryForRemote(`www.${host}/${path.join('/')}`), null, 'a subdomain');
    assert.equal(sc.repositoryForRemote('example.invalid/acme/widgets'), null, 'an unrelated host');
    assert.equal(sc.repositoryForRemote(''), null, 'an empty remote');
  });

  test(`FR-050 ${id}: repositoryForRemote makes no network call`, async () => {
    const harness = await target.create();
    harness.sc.repositoryForRemote(harness.sc.cloneLocations(expected.cloneLocation.input)[0] ?? '');
    assert.equal(harness.requests.length, 0);
  });

  test(`${id}: pullRequestUrl gives the pull request's web page, without a network call`, async () => {
    const harness = await target.create();
    assert.equal(harness.sc.pullRequestUrl(repo, expected.webPage.number), expected.webPage.url);
    assert.equal(harness.requests.length, 0);
  });

  test(`VO-022 ${id}: a deleted PR rejects with not_found`, async () => {
    const { AdapterError } = await import('../../src/contracts/shared.ts');
    const { sc } = await target.create('deleted-pr');
    await assert.rejects(sc.getPullRequest(repo, expected.deletedPr), (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.platform, id);
      return true;
    });
  });

  test(`VO-022 ${id}: a rejected credential rejects with unauthorized`, async () => {
    const { AdapterError } = await import('../../src/contracts/shared.ts');
    const { sc } = await target.create('unauthorized');
    await assert.rejects(sc.listOpenPullRequests(expected.unauthorizedRepo), (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.code, 'unauthorized');
      return true;
    });
  });

  test(`VO-022 ${id}: verifySignIn checks the credential with one read-only GET`, async () => {
    const harness = await target.create();
    assert.deepEqual(await harness.sc.verifySignIn(), { ok: true, account: expected.account });
    assert.equal(harness.requests.length, 1);
    onlyAuthorisedGets(target, harness);
  });

  // Feature 004 (XI.2, XI.3): who the signed-in reviewer is, read once, on the neutral contract. The override
  // that lowers a Critical class records this identity; the suite never branches on platform.
  test(`FR-020 ${id}: currentUser returns the signed-in handle and display name with one read-only GET`, async () => {
    const harness = await target.create();
    const user = await harness.sc.currentUser();
    assert.equal(user.handle, expected.currentUser.handle);
    if (expected.currentUser.displayName === undefined) assert.ok(user.displayName.length > 0, 'a display name, falling back to the handle');
    else assert.equal(user.displayName, expected.currentUser.displayName);
    assert.deepEqual(Object.keys(user).sort(), ['displayName', 'handle'], 'handle and display name only');
    assert.equal(harness.requests.length, 1, 'one GET');
    onlyAuthorisedGets(target, harness);
  });

  test(`FR-020 ${id}: currentUser rejects with unauthorized when the credential is refused`, async () => {
    const { AdapterError } = await import('../../src/contracts/shared.ts');
    const harness = await target.create('unauthorized');
    await assert.rejects(harness.sc.currentUser(), (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.ok(error.code === 'unauthorized' || error.code === 'unavailable', `code ${error.code}`);
      assert.equal(error.code, 'unauthorized');
      return true;
    });
    for (const request of harness.requests) assert.equal(request.method, 'GET', 'the transport saw only reads');
  });

  const authors = expected.authors;
  if (authors !== undefined) {
    // VO-001 (FR-001): author handles are in the form of the signed-in user's handle, never a name or number.
    test(`VO-001 ${id}: the pull request author carries a handle in the form of CurrentUser.handle`, async () => {
      const harness = await target.create();
      const pr = await harness.sc.getPullRequest(repo, expected.pull.number);
      assert.equal(pr.authorHandle, authors.pullAuthorHandle);
      for (const row of await harness.sc.listOpenPullRequests(repo)) assert.equal(typeof row.authorHandle, 'string', `#${row.number} has an authorHandle`);
      onlyAuthorisedGets(target, harness);
    });

    // VO-011 (FR-029): the review-action data has a signed-in user who is not the author.
    test(`VO-011 ${id}: the signed-in handle differs from the author handle of the other pull request`, async () => {
      const harness = await target.create();
      const user = await harness.sc.currentUser();
      const pr = await harness.sc.getPullRequest(repo, authors.otherAuthorPull.number);
      assert.equal(pr.authorHandle, authors.otherAuthorPull.authorHandle);
      assert.notEqual(pr.authorHandle.toLowerCase(), user.handle.toLowerCase());
      onlyAuthorisedGets(target, harness);
    });
  }

  const threads = expected.threads;
  if (threads !== undefined) {
    test(`VO-001 VO-012 ${id}: every comment carries an author handle and the thread of the first comment`, async () => {
      const harness = await target.create('comment-threads');
      const comments = await harness.sc.listComments(repo, threads.number);
      assert.deepEqual(
        comments.map((c) => ({ id: c.id, authorHandle: c.author.handle, threadId: c.threadId, startsThread: c.startsThread })).sort((a, b) => a.id.localeCompare(b.id)),
        [...threads.comments].sort((a, b) => a.id.localeCompare(b.id)),
      );
      const starters = new Map<string, number>();
      for (const c of comments) if (c.startsThread) starters.set(c.threadId, (starters.get(c.threadId) ?? 0) + 1);
      for (const [thread, count] of starters) assert.equal(count, 1, `thread ${thread} has one starting comment`);
      onlyAuthorisedGets(target, harness);
    });
  }

  const orphans = expected.orphans;
  if (orphans !== undefined) {
    test(`VO-013 ${id}: replies of a deleted first comment keep one thread (orphanPlaceholder ${orphans.orphanPlaceholder})`, async () => {
      const harness = await target.create('orphaned-threads');
      const comments = await harness.sc.listComments(repo, orphans.number);
      assert.deepEqual(
        comments.map((c) => ({ id: c.id, threadId: c.threadId, startsThread: c.startsThread })).sort((a, b) => a.id.localeCompare(b.id)),
        [...orphans.comments].sort((a, b) => a.id.localeCompare(b.id)),
      );
      const byThread = new Map<string, boolean[]>();
      for (const c of comments) byThread.set(c.threadId, [...(byThread.get(c.threadId) ?? []), c.startsThread]);
      for (const [thread, starts] of byThread) {
        const startCount = starts.filter(Boolean).length;
        assert.equal(startCount, orphans.orphanPlaceholder ? 0 : 1, `thread ${thread} starting comments`);
      }
      onlyAuthorisedGets(target, harness);
    });
  }

  const approvals = expected.approvals;
  if (approvals !== undefined) {
    test(`VO-014 ${id}: approvedByMe reports the checks that succeeded when one check fails`, async () => {
      const harness = await target.create('approvals-partial');
      const approved = await harness.sc.approvedByMe(repo, approvals.partial.numbers);
      assert.deepEqual([...approved].sort((a, b) => a - b), approvals.partial.approved);
      onlyAuthorisedGets(target, harness);
    });

    test(`VO-014 ${id}: approvedByMe rejects with unavailable when every check fails`, async () => {
      const { AdapterError } = await import('../../src/contracts/shared.ts');
      const harness = await target.create('approvals-all-fail');
      await assert.rejects(harness.sc.approvedByMe(repo, approvals.allFail.numbers), (error: unknown) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.code, 'unavailable');
        assert.equal(error.platform, id);
        return true;
      });
    });
  }

  const clones = expected.clones;
  if (clones !== undefined) {
    // VO-015 (FR-021): every form a clone can take is recognised as its repository; no other host is claimed.
    test(`VO-015 ${id}: cloneLocations lists every host form of the repository`, async () => {
      const { sc } = await target.create();
      assert.deepEqual([...sc.cloneLocations(expected.cloneLocation.input)].sort(), [...clones.locations].sort());
    });

    test(`VO-015 ${id}: remotes on this platform's hosts are recognised and an unrelated host with the same path is not`, async () => {
      const harness = await target.create();
      for (const { remote, id: repoId } of clones.recognised) assert.equal(harness.sc.repositoryForRemote(remote), repoId, `${remote} is recognised`);
      for (const remote of clones.unrecognised) assert.equal(harness.sc.repositoryForRemote(remote), null, `${remote} is not claimed`);
      assert.equal(harness.requests.length, 0, 'no network call');
    });
  }

  const finished = expected.finishedPulls;
  if (finished !== undefined) {
    test(`VO-022 ${id}: merged and closed PRs report their state`, async () => {
      const { sc } = await target.create();
      assert.equal((await sc.getPullRequest(repo, finished.merged)).state, 'merged');
      assert.equal((await sc.getPullRequest(repo, finished.closed)).state, 'closed');
    });
  }
}
