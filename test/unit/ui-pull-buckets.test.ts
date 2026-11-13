// Pull request age: stale after 5 days.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PullSummary } from '../../src/contracts/http.ts';
import { ageDays, isStale } from '../../src/ui/state/pull-buckets.ts';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const DAY = 86_400_000;
const pr = (number: number, daysAgo: number, approvedByMe?: boolean): PullSummary => ({
  repository: 'acme/widgets',
  number,
  title: `PR ${number}`,
  author: 'sam',
  sourceBranch: 'a',
  targetBranch: 'main',
  updatedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  ...(approvedByMe === undefined ? {} : { approvedByMe }),
});

test('a pull request is stale only after more than 5 days without activity', () => {
  assert.equal(isStale(pr(1, 5), NOW), false, 'exactly 5 days is not yet stale');
  assert.equal(isStale(pr(1, 5.01), NOW), true);
  assert.equal(isStale(pr(1, 0), NOW), false);
});

test('age in whole days; an unparseable date counts as 0 and is never stale', () => {
  assert.equal(ageDays(pr(1, 6.9), NOW), 6);
  const bad = { ...pr(2, 0), updatedAt: 'nope' };
  assert.equal(ageDays(bad, NOW), 0);
});
