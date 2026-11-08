// VO-022 (FR-002, FR-025, XI.2): one SourceControlProvider suite, run against every source-control
// adapter over its recorded fixtures. Both fixture sets record the same PR shape (#1: four changed
// files, two commits, one head commit), so the same expectations apply to each adapter.
//
// API required from src/adapters/registry.ts (T076):
//
//   export function adapterDeps(platform: PlatformId, network: NetworkFetch, authorize: Authorize): AdapterDeps;
//     // the read-only fetch for that platform (src/adapters/read-only-http.ts) plus `authorize`
//   export function createSourceControl(platform: PlatformId, deps: AdapterDeps): SourceControlProvider;
//
// Adapters normalise what differs by platform: commits oldest first with ISO 8601 UTC times, the
// full 40-character head commit, statuses as added | modified | deleted | renamed | copied.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Authorize } from '../../src/contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../../src/contracts/source-control.ts';
import { recordedFetch, type FixtureEntry, type RecordedFetch } from '../helpers/recorded-fetch.ts';

type RegistryModule = typeof import('../../src/adapters/registry.ts');
const loadRegistry = (): Promise<RegistryModule> => import('../../src/adapters/registry.ts');

const HEAD = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';
const FIRST = '5b7e2d9f1a3c4e6b8d0f2a4c6e8b1d3f5a7c9e2b';
const FORK_HEAD = 'b8d6f4e2a0c9e7b5d3f1a8c6e4b2d0f9e7c5a3b1';
const TOKEN_HEADER = 'Bearer contract-test-token';

type Platform = {
  id: string;
  fixtures: string;
  host: string;
  author: string;
  account: string;
  openNumbers: number[];
  forkHead: { remoteUrl: string; ref: string };
  baseRemoteUrl: string;
  cloneLocation: string;
  deletedPr: FixtureEntry[];
  unauthorizedRepo: RepoRef;
};

const PLATFORMS: Platform[] = [
  {
    id: 'github',
    fixtures: 'github',
    host: 'api.github.com',
    author: 'alice-dev',
    account: 'alice-dev',
    openNumbers: [1, 2, 3],
    // The base repository's PR ref covers forks (R10).
    forkHead: { remoteUrl: 'https://github.com/acme/widgets.git', ref: 'refs/pull/3/head' },
    baseRemoteUrl: 'https://github.com/acme/widgets.git',
    cloneLocation: 'github.com/acme/widgets',
    deletedPr: [],
    unauthorizedRepo: { platform: 'github', id: 'acme/private-widgets' },
  },
  {
    id: 'bitbucket-cloud',
    fixtures: 'bitbucket',
    host: 'api.bitbucket.org',
    author: 'Alice Developer',
    account: 'Alice Developer',
    openNumbers: [1, 3],
    // The fork's own repository and its source branch (R10).
    forkHead: { remoteUrl: 'https://bitbucket.org/contrib/widgets.git', ref: 'refs/heads/fix/null-check' },
    baseRemoteUrl: 'https://bitbucket.org/acme/widgets.git',
    cloneLocation: 'bitbucket.org/acme/widgets',
    deletedPr: [
      {
        request: { url: 'https://api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests/404' },
        response: { status: 404, body: { type: 'error', error: { message: 'Resource not found' } } },
      },
    ],
    unauthorizedRepo: { platform: 'bitbucket-cloud', id: 'acme/private-widgets' },
  },
];

const authorize: Authorize = (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', TOKEN_HEADER);
  return new Request(request, { headers });
};

async function adapter(platform: Platform, entries: FixtureEntry[] = []): Promise<{ sc: SourceControlProvider; recorded: RecordedFetch; repo: RepoRef }> {
  const { adapterDeps, createSourceControl } = await loadRegistry();
  const recorded = recordedFetch(platform.fixtures, { entries });
  const sc = createSourceControl(platform.id, adapterDeps(platform.id, recorded.fetch, authorize));
  return { sc, recorded, repo: { platform: platform.id, id: 'acme/widgets' } };
}

function onlyAuthorisedGets(platform: Platform, recorded: RecordedFetch): void {
  recorded.assertAllRecorded();
  assert.ok(recorded.requests.length > 0);
  for (const request of recorded.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.host, platform.host);
    assert.equal(request.headers['authorization'], TOKEN_HEADER, 'every request is authorised by the injected callback');
  }
}

for (const platform of PLATFORMS) {
  test(`VO-022 ${platform.id}: getPullRequest returns title, description, author, branches, full head commit and state`, async () => {
    const { sc, recorded, repo } = await adapter(platform);
    assert.equal(sc.id, platform.id);
    const pr = await sc.getPullRequest(repo, 1);
    assert.equal(pr.number, 1);
    assert.equal(pr.title, 'Allow password reset more than once');
    assert.equal(pr.description.replace(/\r\n/g, '\n'), 'Fixes ABC-12.\n\nReset tokens are no longer single use.');
    assert.equal(pr.author, platform.author);
    assert.equal(pr.sourceBranch, 'feature/ABC-12-reset');
    assert.equal(pr.targetBranch, 'main');
    assert.equal(pr.headCommit, HEAD);
    assert.equal(pr.state, 'open');
    assert.ok(!Number.isNaN(Date.parse(pr.updatedAt)));
    onlyAuthorisedGets(platform, recorded);
  });

  test(`VO-022 ${platform.id}: listOpenPullRequests lists every open PR`, async () => {
    const { sc, recorded, repo } = await adapter(platform);
    const prs = await sc.listOpenPullRequests(repo);
    assert.deepEqual(prs.map((p) => p.number).sort((a, b) => a - b), platform.openNumbers);
    for (const pr of prs) {
      assert.equal(pr.state, 'open');
      assert.ok(pr.title.length > 0);
      assert.ok(pr.sourceBranch.length > 0 && pr.targetBranch.length > 0);
    }
    onlyAuthorisedGets(platform, recorded);
  });

  test(`VO-022 ${platform.id}: listCommits returns the commits oldest first`, async () => {
    const { sc, recorded, repo } = await adapter(platform);
    assert.deepEqual(await sc.listCommits(repo, 1), [
      { sha: FIRST, message: 'Allow repeated password resets\n\nABC-12', author: 'Alice Developer', authoredAt: '2026-11-02T10:15:00.000Z' },
      { sha: HEAD, message: 'Document password reset', author: 'Alice Developer', authoredAt: '2026-11-03T09:00:00.000Z' },
    ]);
    onlyAuthorisedGets(platform, recorded);
  });

  test(`VO-022 ${platform.id}: listChangedFiles returns status and line counts for each file`, async () => {
    const { sc, recorded, repo } = await adapter(platform);
    const files = (await sc.listChangedFiles(repo, 1)).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(files, [
      { path: 'docs/reset.md', status: 'added', linesAdded: 3, linesRemoved: 0, binary: false },
      { path: 'src/auth/reset.js', status: 'modified', linesAdded: 1, linesRemoved: 1, binary: false },
      { path: 'src/auth/token.js', previousPath: 'src/token.js', status: 'renamed', linesAdded: 1, linesRemoved: 1, binary: false },
      { path: 'src/legacy.js', status: 'deleted', linesAdded: 0, linesRemoved: 2, binary: false },
    ]);
    onlyAuthorisedGets(platform, recorded);
  });

  test(`VO-022 ${platform.id}: getUnifiedDiff returns the unified diff the shared parser reads`, async () => {
    const { parseUnifiedDiff } = await import('../../src/repo/unified-diff.ts');
    const { sc, recorded, repo } = await adapter(platform);
    const diff = await sc.getUnifiedDiff(repo, 1);
    const files = parseUnifiedDiff(diff);
    assert.deepEqual(
      files.map((f) => [f.path, f.status, f.additions, f.deletions]),
      [
        ['docs/reset.md', 'added', 3, 0],
        ['src/auth/reset.js', 'modified', 1, 1],
        ['src/auth/token.js', 'renamed', 1, 1],
        ['src/legacy.js', 'deleted', 0, 2],
      ],
    );
    onlyAuthorisedGets(platform, recorded);
  });

  test(`VO-022 ${platform.id}: headLocation for a fork PR names where the platform exposes its head`, async () => {
    const { sc, recorded, repo } = await adapter(platform);
    const pr = await sc.getPullRequest(repo, 3);
    assert.equal(pr.headCommit, FORK_HEAD);
    const head = await sc.headLocation(repo, pr);
    assert.ok(head.remoteUrls.includes(platform.forkHead.remoteUrl), `head URLs include ${platform.forkHead.remoteUrl}`);
    assert.ok(head.remoteUrls.some((url) => !/^https?:/.test(url)), 'an SSH form is offered too');
    assert.equal(head.ref, platform.forkHead.ref);
    const target = await sc.targetLocation(repo, pr);
    assert.ok(target.remoteUrls.includes(platform.baseRemoteUrl));
    assert.equal(target.ref, 'refs/heads/main');
    onlyAuthorisedGets(platform, recorded);
  });

  test(`VO-022 ${platform.id}: cloneLocations gives the normalised host and path of the repository`, async () => {
    const { sc } = await adapter(platform);
    assert.deepEqual(sc.cloneLocations({ platform: platform.id, id: 'Acme/Widgets' }), [platform.cloneLocation]);
  });

  test(`VO-022 ${platform.id}: a deleted PR rejects with not_found`, async () => {
    const { AdapterError } = await import('../../src/contracts/shared.ts');
    const { sc, repo } = await adapter(platform, platform.deletedPr);
    await assert.rejects(sc.getPullRequest(repo, 404), (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.platform, platform.id);
      return true;
    });
  });

  test(`VO-022 ${platform.id}: a rejected credential rejects with unauthorized`, async () => {
    const { AdapterError } = await import('../../src/contracts/shared.ts');
    const entries: FixtureEntry[] =
      platform.id === 'github'
        ? [
            {
              request: { url: 'https://api.github.com/repos/acme/private-widgets/pulls?state=open&per_page=100' },
              response: { status: 401, body: { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' } },
            },
          ]
        : [];
    const { sc } = await adapter(platform, entries);
    await assert.rejects(sc.listOpenPullRequests(platform.unauthorizedRepo), (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.code, 'unauthorized');
      return true;
    });
  });

  test(`VO-022 ${platform.id}: verifySignIn checks the credential with one read-only GET`, async () => {
    const { sc, recorded } = await adapter(platform);
    assert.deepEqual(await sc.verifySignIn(), { ok: true, account: platform.account });
    assert.equal(recorded.requests.length, 1);
    onlyAuthorisedGets(platform, recorded);
  });
}

test('VO-022 github: merged and closed PRs report their state', async () => {
  const { sc, repo } = await adapter(PLATFORMS[0] as Platform);
  assert.equal((await sc.getPullRequest(repo, 4)).state, 'merged');
  assert.equal((await sc.getPullRequest(repo, 5)).state, 'closed');
});
