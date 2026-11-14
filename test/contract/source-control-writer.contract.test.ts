// Feature 005 (T009, FR-020, XI.2): the SourceControlWriter contract suite (T008) run over the
// hand-authored review-actions fixtures (T010) for GitHub, GitLab and Bitbucket Cloud.
//
// Written first (constitution XI): it fails until the adapters (T014, T016-T018) exist.
//
// ASSUMED ADAPTER SHAPES (the Wave 3 builders must match, or tell the test owner):
// - src/adapters/<platform>/source-control-writer.ts exports
//     createGithubSourceControlWriter(deps), createBitbucketCloudSourceControlWriter(deps),
//     createGitlabSourceControlWriter(deps, settings)
//   where deps = { fetch: NetworkFetch, authorize: Authorize } and NetworkFetch is the raw network
//   fetch (same type as read-only-http's NetworkFetch). The writer builds its own write layer from it
//   (createWriteFetch with the adapter's allowlist, T014) and applies `authorize` itself.
//   `settings` is { repository, baseUrl } as for createGitlabSourceControl.
// - The read side stays createXSourceControl(AdapterDeps, ...) over createReadOnlyFetch on the same network.
// - Every request time that a platform response does not carry (GitLab and Bitbucket withdraw, GitLab
//   approve) is stamped from the clock; the harness freezes Date at WRITE_TIME so it is checkable.

import { afterEach, mock } from 'node:test';
import type { AdapterDeps, Authorize, PlatformId } from '../../src/contracts/shared.ts';
import type { RepoRef } from '../../src/contracts/source-control.ts';
import type { Anchor } from '../../src/contracts/source-control-writer.ts';
import { createBitbucketCloudSourceControl } from '../../src/adapters/bitbucket/source-control.ts';
import { createBitbucketCloudSourceControlWriter } from '../../src/adapters/bitbucket/source-control-writer.ts';
import { createGithubSourceControl } from '../../src/adapters/github/source-control.ts';
import { createGithubSourceControlWriter } from '../../src/adapters/github/source-control-writer.ts';
import { createGitlabSourceControl } from '../../src/adapters/gitlab/source-control.ts';
import { createGitlabSourceControlWriter } from '../../src/adapters/gitlab/source-control-writer.ts';
import { createReadOnlyFetch } from '../../src/adapters/read-only-http.ts';
import { recordedFetch, UnrecordedRequestError, type RecordedFetch } from '../helpers/recorded-fetch.ts';
import {
  runWriterContract,
  type ObservedWrite,
  type WriterExpectations,
  type WriterHarness,
  type WriterScenario,
  type WriterTarget,
} from './source-control-writer.suite.ts';

const HEAD = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';
const TOKEN_HEADER = 'Bearer contract-test-token';
const WRITE_TIME = '2026-03-02T12:00:00.000Z';
const REFUSAL = 'Refused by the platform for the contract test';

const REFUSAL_STATUS: Record<string, number> = { forbidden: 403, conflict: 409, rejected: 422, rate_limited: 429, unavailable: 503 };

const authorize: Authorize = (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', TOKEN_HEADER);
  return new Request(request, { headers });
};

// Writes that stamp their own time read the clock; freeze it so the expected value is a constant.
afterEach(() => mock.timers.reset());

const repo = (platform: PlatformId): RepoRef => ({ platform, id: 'acme/widgets' });

const lineAnchor: Anchor = { path: 'src/app.js', side: 'head', startLine: 45, endLine: 45, commit: HEAD };
const rangeAnchor: Anchor = { path: 'src/app.js', side: 'head', startLine: 45, endLine: 50, commit: HEAD };

const BODIES: WriterExpectations['bodies'] = {
  comment: 'Looks reasonable overall.',
  line: 'Why 400 here?',
  range: 'This block repeats the reset.',
  reply: 'Agreed, fixing.',
  edit: 'Why 400 here? (edited)',
  approve: 'Looks good to me.',
  changes: 'Please add a test.',
};

type PlatformSetup = {
  id: PlatformId;
  /** Folder under test/fixtures, self-contained (see the README beside the fixtures). */
  fixtures: string;
  host: string;
  /** The platform's own error body shape for a refusal carrying `message`. */
  refusalBody(message: string): unknown;
  /** GitHub records approve and request changes on one URL, served in order; this skips to the right one. */
  skipFirstWhen?: (request: { method: string; path: string; body: string }) => boolean;
  build(deps: { network: NetworkFetch; read: AdapterDeps; authorize: Authorize }): Pick<WriterHarness, 'writer' | 'sc'>;
  expected: Omit<WriterExpectations, 'repo' | 'pr' | 'head' | 'bodies' | 'lineAnchor' | 'rangeAnchor' | 'host' | 'authorization'>;
};

type NetworkFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Scenarios of spec 007 that are fixture variants rather than a status code. */
const VARIANT_SCENARIOS = new Set<WriterScenario>(['moved-head', 'abbreviated-head', 'message-fails', 'no-decision', 'withdrawn-once', 'whole-pr-comment']);

function variantFetch(fixtures: string, scenario: WriterScenario): RecordedFetch | null {
  if (!VARIANT_SCENARIOS.has(scenario)) return null;
  try {
    return recordedFetch(`${fixtures}/variants/${scenario}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`variant fixtures missing: test/fixtures/${fixtures}/variants/${scenario}/ (authored by the fixture tasks T028, T032 and the Bitbucket equivalent)`);
    }
    throw error;
  }
}

const json = (write: ObservedWrite): Record<string, any> => JSON.parse(write.body) as Record<string, any>;

function target(setup: PlatformSetup): WriterTarget {
  return {
    id: setup.id,
    async create(scenario: WriterScenario = 'default'): Promise<WriterHarness> {
      mock.timers.enable({ apis: ['Date'], now: Date.parse(WRITE_TIME) });
      const recorded = recordedFetch(setup.fixtures);
      const overlay = variantFetch(setup.fixtures, scenario);
      const observed: ObservedWrite[] = [];
      let skipped = false;

      const network: NetworkFetch = async (input, init) => {
        const request = new Request(input, init);
        const method = request.method.toUpperCase();
        const url = new URL(request.url);
        const body = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text();
        const headers: Record<string, string> = {};
        request.headers.forEach((value, name) => { headers[name] = value; });
        observed.push({ method, host: url.host, path: url.pathname, headers, body });

        const mutating = method !== 'GET' && method !== 'HEAD';
        const status = REFUSAL_STATUS[scenario];
        if (mutating && status !== undefined) {
          return new Response(JSON.stringify(setup.refusalBody(REFUSAL)), { status, headers: { 'content-type': 'application/json' } });
        }
        if (mutating && !skipped && setup.skipFirstWhen?.({ method, path: url.pathname, body }) === true) {
          skipped = true;
          await recorded.fetch(request.clone());
        }
        if (overlay !== null) {
          try {
            return await overlay.fetch(request.clone());
          } catch (error) {
            if (!(error instanceof UnrecordedRequestError)) throw error;
          }
        }
        return recorded.fetch(request);
      };

      const read: AdapterDeps = { fetch: createReadOnlyFetch({ platform: setup.id, fetch: network }), authorize };
      const { writer, sc } = setup.build({ network, read, authorize });
      return { writer, sc, read: read.fetch, requests: observed, assertComplete: () => recorded.assertAllRecorded() };
    },
    expected: {
      ...setup.expected,
      repo: repo(setup.id),
      pr: 1,
      head: HEAD,
      bodies: BODIES,
      lineAnchor,
      rangeAnchor,
      host: setup.host,
      authorization: TOKEN_HEADER,
    },
  };
}

runWriterContract(
  target({
    id: 'github',
    fixtures: 'github/review-actions',
    host: 'api.github.com',
    refusalBody: (message) => ({ message, documentation_url: 'https://docs.github.com/rest', status: 'refused' }),
    skipFirstWhen: ({ path, body }) => path.endsWith('/pulls/1/reviews') && body.includes('REQUEST_CHANGES'),
    build: ({ network, read, authorize: auth }) => ({
      writer: createGithubSourceControlWriter({ fetch: network, authorize: auth }),
      sc: createGithubSourceControl(read),
    }),
    expected: {
      comment: { commentId: '9001', createdAt: '2026-03-02T10:00:00.000Z' },
      lineComment: { commentId: '5001', threadId: '5001', createdAt: '2026-03-02T10:05:00.000Z' },
      reply: { threadId: '5001', commentId: '5003', createdAt: '2026-03-02T10:05:00.000Z' },
      edit: { commentId: '5001', createdAt: '2026-03-02T10:05:00.000Z' },
      deleteCommentId: '5001',
      approve: { createdAt: WRITE_TIME, platformId: '7001' },
      requestChanges: { createdAt: WRITE_TIME, platformId: '7002' },
      withdraw: { createdAt: WRITE_TIME },
      ownComment: { id: '5001', author: 'alice-dev' },
      myDecision: { kind: 'changes_requested', commit: HEAD },
      refusalMessage: REFUSAL,
      anchorOnWire: (w) => {
        const b = json(w);
        return { path: b.path, side: b.side === 'RIGHT' ? 'head' : 'base', startLine: b.start_line ?? b.line, endLine: b.line };
      },
      decisionWrite: (w) => w.method === 'POST' && w.path.endsWith('/pulls/1/reviews'),
      listPath: '/repos/acme/widgets/pulls',
      headReadPath: '/repos/acme/widgets/pulls/1',
      headReadAccept: 'application/vnd.github+json',
      // The comment is on the whole pull request (issues/comments/9001); GitHub has no reply for it, so the reply quotes it.
      wholePullRequestReply: { threadId: '9001', commentId: '9002', quoted: 'Looks reasonable overall.' },
    },
  }),
);

runWriterContract(
  target({
    id: 'gitlab',
    fixtures: 'gitlab/review-actions',
    host: 'gitlab.example.test',
    refusalBody: (message) => ({ message }),
    build: ({ network, read, authorize: auth }) => {
      const settings = { repository: repo('gitlab'), baseUrl: 'https://gitlab.example.test' };
      return {
        writer: createGitlabSourceControlWriter({ fetch: network, authorize: auth }, settings),
        sc: createGitlabSourceControl(read, settings),
      };
    },
    expected: {
      comment: { commentId: '8001', createdAt: '2026-03-02T10:00:00.000Z' },
      lineComment: { commentId: '8002', threadId: 'd1a2b3c4', createdAt: '2026-03-02T10:00:00.000Z' },
      reply: { threadId: 'd1a2b3c4', commentId: '8004', createdAt: '2026-03-02T10:00:00.000Z' },
      edit: { commentId: '8002', createdAt: '2026-03-02T10:00:00.000Z' },
      deleteCommentId: '8002',
      // GitLab's approve response carries no time: the adapter stamps it from the clock.
      approve: { createdAt: WRITE_TIME },
      requestChanges: { createdAt: WRITE_TIME },
      withdraw: { createdAt: WRITE_TIME },
      ownComment: { id: '8001', author: 'Alice Developer' },
      myDecision: { kind: 'approved', commit: HEAD },
      refusalMessage: REFUSAL,
      // The recorded instance is 16.11.2 (version.json): no request-changes endpoint.
      requestChangesGap: { reason: 'version' },
      anchorOnWire: (w) => {
        const p = json(w).position;
        const side = p.new_line !== undefined ? 'head' : 'base';
        const key = `${side === 'head' ? 'new' : 'old'}_line`;
        const startOf = (end: Record<string, any>): number => end[key];
        return { path: p.new_path, side, startLine: p.line_range ? startOf(p.line_range.start) : p[key], endLine: p[key] };
      },
      decisionWrite: (w) => w.method === 'POST' && w.path.endsWith('/merge_requests/1/approve'),
      messageWrite: (w) => w.method === 'POST' && w.path.endsWith('/merge_requests/1/notes'),
      listPath: '/api/v4/projects/acme%2Fwidgets/merge_requests',
      // The head check compares the newest diff version only.
      headReadPath: '/api/v4/projects/acme%2Fwidgets/merge_requests/1/versions',
      // A discussion note on the whole merge request takes a reply in its discussion.
      wholePullRequestReply: { threadId: 'd1a2b3c4', commentId: '8004' },
    },
  }),
);

runWriterContract(
  target({
    id: 'bitbucket-cloud',
    fixtures: 'bitbucket/review-actions',
    host: 'api.bitbucket.org',
    refusalBody: (message) => ({ type: 'error', error: { message } }),
    build: ({ network, read, authorize: auth }) => ({
      writer: createBitbucketCloudSourceControlWriter({ fetch: network, authorize: auth }),
      sc: createBitbucketCloudSourceControl(read),
    }),
    expected: {
      comment: { commentId: '3001', createdAt: '2026-03-02T10:00:00.000Z' },
      lineComment: { commentId: '3002', threadId: '3002', createdAt: '2026-03-02T10:00:00.000Z' },
      reply: { threadId: '3002', commentId: '3004', createdAt: '2026-03-02T10:00:00.000Z' },
      edit: { commentId: '3002', createdAt: '2026-03-02T10:00:00.000Z' },
      deleteCommentId: '3002',
      approve: { createdAt: WRITE_TIME },
      requestChanges: { createdAt: WRITE_TIME },
      withdraw: { createdAt: WRITE_TIME },
      ownComment: { id: '3001', author: 'Alice Developer' },
      myDecision: { kind: 'changes_requested', commit: HEAD },
      refusalMessage: REFUSAL,
      anchorOnWire: (w) => {
        const i = json(w).inline;
        const side = i.to !== undefined ? 'head' : 'base';
        const end = side === 'head' ? i.to : i.from;
        return { path: i.path, side, startLine: (side === 'head' ? i.start_to : i.start_from) ?? end, endLine: end };
      },
      decisionWrite: (w) => w.method === 'POST' && w.path.endsWith('/pullrequests/1/approve'),
      messageWrite: (w) => w.method === 'POST' && w.path.endsWith('/pullrequests/1/comments'),
      listPath: '/2.0/repositories/acme/widgets/pullrequests',
      headReadPath: '/2.0/repositories/acme/widgets/pullrequests/1',
      // Bitbucket replies to a whole-pull-request comment through `parent`.
      wholePullRequestReply: { threadId: '3001', commentId: '3004' },
    },
  }),
);
