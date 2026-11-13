// Home's review queue: lanes, order and shared read-only reasons. Module under test: src/ui/state/review-queue.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PullSummary, SessionSummary } from '../../src/contracts/http.ts';
import { ageText, buildQueue, sameCommit } from '../../src/ui/state/review-queue.ts';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const HEAD = 'a'.repeat(40);

const session = (repository: string, prNumber: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: `${repository}-${prNumber}`,
  platform: 'bitbucket-cloud',
  repository,
  prNumber,
  title: `PR ${prNumber}`,
  prStatus: 'open',
  readOnly: false,
  latestHeadCommit: HEAD,
  createdAt: '2026-11-01T00:00:00Z',
  lastOpenedAt: '2026-11-01T00:00:00Z',
  repositoryAvailable: true,
  ...extra,
});

const pull = (repository: string, number: number, updatedAt: string, extra: Partial<PullSummary> = {}): PullSummary => ({
  repository,
  number,
  title: `PR ${number}`,
  author: 'dev',
  sourceBranch: 'feature',
  targetBranch: 'main',
  updatedAt,
  headCommit: HEAD.slice(0, 12),
  ...extra,
});

const ids = (q: ReturnType<typeof buildQueue>, lane: string) => q.lanes.find((l) => l.id === lane)!.rows.map((r) => r.session.sessionId);

test('lanes: a moved head is new commits (even when approved), an approval with nothing new is approved, the rest in progress', () => {
  const q = buildQueue(
    [session('ws/a', 1), session('ws/a', 2), session('ws/a', 3), session('ws/a', 4)],
    [
      pull('ws/a', 1, '2026-11-12T00:00:00Z', { headCommit: 'b'.repeat(12) }),
      pull('ws/a', 2, '2026-11-12T00:00:00Z', { approvedByMe: true }),
      pull('ws/a', 3, '2026-11-12T00:00:00Z', { approvedByMe: true, headCommit: 'c'.repeat(12) }),
    ],
    NOW,
  );
  assert.deepEqual(q.lanes.map((l) => l.id), ['new-commits', 'in-progress', 'approved']);
  assert.deepEqual(ids(q, 'new-commits'), ['ws/a-1', 'ws/a-3']);
  assert.deepEqual(ids(q, 'approved'), ['ws/a-2']);
  // #4 is not in the loaded list: it stays in progress, with no age.
  assert.deepEqual(ids(q, 'in-progress'), ['ws/a-4']);
  assert.equal(q.lanes[1]!.rows[0]!.ageDays, undefined);
});

test('order: riskiest first, then the one waiting longest, then repository and number', () => {
  const q = buildQueue(
    [
      session('ws/b', 1, { highestRisk: 'normal' }),
      session('ws/a', 2),
      session('ws/a', 3, { highestRisk: 'critical' }),
      session('ws/a', 4, { highestRisk: 'normal' }),
      session('ws/a', 5, { highestRisk: 'normal' }),
      session('ws/a', 6, { highestRisk: 'elevated' }),
    ],
    [
      pull('ws/b', 1, '2026-11-10T00:00:00Z'),
      pull('ws/a', 2, '2026-11-01T00:00:00Z'),
      pull('ws/a', 3, '2026-11-12T00:00:00Z'),
      pull('ws/a', 4, '2026-11-11T00:00:00Z'),
      pull('ws/a', 5, '2026-11-10T00:00:00Z'),
      pull('ws/a', 6, '2026-11-12T00:00:00Z'),
    ],
    NOW,
  );
  assert.deepEqual(ids(q, 'in-progress'), ['ws/a-3', 'ws/a-6', 'ws/a-5', 'ws/b-1', 'ws/a-4', 'ws/a-2']);
});

test('age and stale come from the pull request', () => {
  const q = buildQueue([session('ws/a', 1)], [pull('ws/a', 1, '2026-11-03T12:00:00Z')], NOW);
  const row = q.lanes[1]!.rows[0]!;
  assert.equal(row.ageDays, 10);
  assert.equal(row.stale, true);
});

test('a read-only reason shared by several rows is listed once; a lone reason is not', () => {
  const RUNNING = 'Discovery is still running.';
  const q = buildQueue(
    [
      session('ws/a', 1, { repositoryAvailable: false, repositoryReason: RUNNING }),
      session('ws/a', 2, { repositoryAvailable: false, repositoryReason: RUNNING }),
      session('ws/a', 3, { repositoryAvailable: false, repositoryReason: 'Not found.' }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(q.sharedReasons, [RUNNING]);
});

test('sameCommit matches an abbreviated head against the full one, case-insensitively', () => {
  assert.equal(sameCommit(HEAD, HEAD.slice(0, 12).toUpperCase()), true);
  assert.equal(sameCommit(HEAD, 'b'.repeat(12)), false);
  assert.equal(sameCommit('abc', 'abcdef0'), false, 'too short to be a prefix match');
});

test('ageText', () => {
  assert.deepEqual([0, 1, 12].map(ageText), ['today', '1 day', '12 days']);
});
