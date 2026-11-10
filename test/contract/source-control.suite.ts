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
 * - `unauthorized`: the credential is refused for `expected.unauthorizedRepo`.
 */
export type SourceControlScenario = 'default' | 'deleted-pr' | 'unauthorized';

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
  /** `verifySignIn()` reports this account. */
  account: string;
  /** A number that rejects with `not_found` under the `deleted-pr` scenario. */
  deletedPr: number;
  /** A repository read under the `unauthorized` scenario. */
  unauthorizedRepo: RepoRef;
  /** Pull requests in their final states, when the target has them. */
  finishedPulls?: { merged: number; closed: number };
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
    assert.deepEqual(sc.cloneLocations(expected.cloneLocation.input), [expected.cloneLocation.location]);
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

  const finished = expected.finishedPulls;
  if (finished !== undefined) {
    test(`VO-022 ${id}: merged and closed PRs report their state`, async () => {
      const { sc } = await target.create();
      assert.equal((await sc.getPullRequest(repo, finished.merged)).state, 'merged');
      assert.equal((await sc.getPullRequest(repo, finished.closed)).state, 'closed');
    });
  }
}
