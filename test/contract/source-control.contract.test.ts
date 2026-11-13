// VO-022 (FR-002, FR-025, FR-031, XI.2): the source-control contract suite run over recorded
// fixtures. Both fixture sets record the same PR shape (#1: four changed files, two commits, one
// head commit), so most expected values are shared; the rest differ per platform as data.
//
// Each target builds its adapter by calling the adapter's own factory over the read-only fetch.

import type { AdapterDeps, Authorize, PlatformId } from '../../src/contracts/shared.ts';
import type { SourceControlProvider } from '../../src/contracts/source-control.ts';
import { createBitbucketCloudSourceControl } from '../../src/adapters/bitbucket/source-control.ts';
import { createGithubSourceControl } from '../../src/adapters/github/source-control.ts';
import { createReadOnlyFetch } from '../../src/adapters/read-only-http.ts';
import { recordedFetch, type FixtureEntry } from '../helpers/recorded-fetch.ts';
import {
  runSourceControlContract,
  type SourceControlExpectations,
  type SourceControlScenario,
  type SourceControlTarget,
} from './source-control.suite.ts';

const HEAD = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';
const FIRST = '5b7e2d9f1a3c4e6b8d0f2a4c6e8b1d3f5a7c9e2b';
const FORK_HEAD = 'b8d6f4e2a0c9e7b5d3f1a8c6e4b2d0f9e7c5a3b1';
const TOKEN_HEADER = 'Bearer contract-test-token';

const authorize: Authorize = (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', TOKEN_HEADER);
  return new Request(request, { headers });
};

type FixtureTargetInput = {
  id: PlatformId;
  fixtures: string;
  host: string;
  factory: (deps: AdapterDeps) => SourceControlProvider;
  /** One-off responses served after the fixture files, per scenario. */
  entries?: Partial<Record<SourceControlScenario, FixtureEntry[]>>;
  expected: Omit<SourceControlExpectations, 'repo' | 'pull' | 'commits' | 'changedFiles'> & { author: string };
};

function fixtureTarget(input: FixtureTargetInput): SourceControlTarget {
  const { author, ...rest } = input.expected;
  return {
    id: input.id,
    host: input.host,
    authorization: TOKEN_HEADER,
    async create(scenario = 'default') {
      const recorded = recordedFetch(input.fixtures, { entries: input.entries?.[scenario] ?? [] });
      // A refused credential is refused on the identity call too: the replayer answers it with a 401.
      const replay: typeof recorded.fetch =
        scenario === 'unauthorized'
          ? async (request, init) => {
              const url = new URL(request instanceof Request ? request.url : String(request));
              if (url.pathname.endsWith('/user')) {
                recorded.requests.push({ method: 'GET', url: url.href, host: url.host, headers: {}, servedFrom: 'unauthorized' });
                return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401, headers: { 'content-type': 'application/json' } });
              }
              return recorded.fetch(request, init);
            }
          : recorded.fetch;
      const sc = input.factory({ fetch: createReadOnlyFetch({ platform: input.id, fetch: replay }), authorize });
      return { sc, requests: recorded.requests, assertComplete: () => recorded.assertAllRecorded() };
    },
    expected: {
      ...rest,
      repo: { platform: input.id, id: 'acme/widgets' },
      pull: {
        number: 1,
        title: 'Allow password reset more than once',
        description: 'Fixes ABC-12.\n\nReset tokens are no longer single use.',
        author,
        sourceBranch: 'feature/ABC-12-reset',
        targetBranch: 'main',
        headCommit: HEAD,
      },
      commits: [
        { sha: FIRST, message: 'Allow repeated password resets\n\nABC-12', author: 'Alice Developer', authoredAt: '2026-11-02T10:15:00.000Z' },
        { sha: HEAD, message: 'Document password reset', author: 'Alice Developer', authoredAt: '2026-11-03T09:00:00.000Z' },
      ],
      changedFiles: [
        { path: 'docs/reset.md', status: 'added', linesAdded: 3, linesRemoved: 0, binary: false },
        { path: 'src/auth/reset.js', status: 'modified', linesAdded: 1, linesRemoved: 1, binary: false },
        { path: 'src/auth/token.js', previousPath: 'src/token.js', status: 'renamed', linesAdded: 1, linesRemoved: 1, binary: false },
        { path: 'src/legacy.js', status: 'deleted', linesAdded: 0, linesRemoved: 2, binary: false },
      ],
    },
  };
}

runSourceControlContract(
  fixtureTarget({
    id: 'github',
    fixtures: 'github',
    host: 'api.github.com',
    factory: createGithubSourceControl,
    entries: {
      unauthorized: [
        {
          request: { url: 'https://api.github.com/repos/acme/private-widgets/pulls?state=open&per_page=100' },
          response: { status: 401, body: { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' } },
        },
      ],
    },
    expected: {
      author: 'alice-dev',
      account: 'alice-dev',
      currentUser: { handle: 'alice-dev', displayName: 'Alice Developer' },
      openNumbers: [1, 2, 3],
      // The base repository's PR ref covers forks (R10).
      forkPull: {
        number: 3,
        headCommit: FORK_HEAD,
        headRemoteUrl: 'https://github.com/acme/widgets.git',
        headRef: 'refs/pull/3/head',
        targetRemoteUrl: 'https://github.com/acme/widgets.git',
        targetRef: 'refs/heads/main',
      },
      cloneLocation: { input: { platform: 'github', id: 'Acme/Widgets' }, location: 'github.com/acme/widgets' },
      webPage: { number: 7, url: 'https://github.com/acme/widgets/pull/7' },
      deletedPr: 404,
      unauthorizedRepo: { platform: 'github', id: 'acme/private-widgets' },
      finishedPulls: { merged: 4, closed: 5 },
    },
  }),
);

runSourceControlContract(
  fixtureTarget({
    id: 'bitbucket-cloud',
    fixtures: 'bitbucket',
    host: 'api.bitbucket.org',
    factory: createBitbucketCloudSourceControl,
    entries: {
      'deleted-pr': [
        {
          request: { url: 'https://api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests/404' },
          response: { status: 404, body: { type: 'error', error: { message: 'Resource not found' } } },
        },
      ],
    },
    expected: {
      author: 'Alice Developer',
      account: 'Alice Developer',
      currentUser: { handle: '712020:aa11c000-0000-4000-8000-000000000001', displayName: 'Alice Developer' },
      openNumbers: [1, 3],
      // The fork's own repository and its source branch (R10).
      forkPull: {
        number: 3,
        headCommit: FORK_HEAD,
        headRemoteUrl: 'https://bitbucket.org/contrib/widgets.git',
        headRef: 'refs/heads/fix/null-check',
        targetRemoteUrl: 'https://bitbucket.org/acme/widgets.git',
        targetRef: 'refs/heads/main',
      },
      cloneLocation: { input: { platform: 'bitbucket-cloud', id: 'Acme/Widgets' }, location: 'bitbucket.org/acme/widgets' },
      webPage: { number: 7, url: 'https://bitbucket.org/acme/widgets/pull-requests/7' },
      deletedPr: 404,
      unauthorizedRepo: { platform: 'bitbucket-cloud', id: 'acme/private-widgets' },
    },
  }),
);
