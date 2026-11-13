import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PullGroup, PullSummary } from '../../src/contracts/http.ts';
import { applyDecision, createPullCache } from '../../src/core/pull-cache.ts';

const pr = (number: number, extra: Partial<PullSummary> = {}): PullSummary => ({
  repository: 'acme/gadgets',
  number,
  title: `PR ${number}`,
  author: 'a',
  sourceBranch: 's',
  targetBranch: 't',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});
const loaded = (pulls: PullSummary[]): PullGroup => ({ repository: 'acme/gadgets', status: 'loaded', pulls });

test('a loaded group is remembered by repository, ignoring case and dropping session ids', () => {
  const cache = createPullCache(() => new Date('2026-02-02T00:00:00Z'));
  assert.equal(cache.get('acme/gadgets'), null);
  cache.put(loaded([pr(10, { sessionId: 's1' }), pr(11)]));
  const entry = cache.get('ACME/Gadgets');
  assert.equal(entry?.fetchedAt, '2026-02-02T00:00:00.000Z');
  assert.deepEqual(entry?.pulls.map((p) => p.number), [10, 11]);
  assert.equal(entry?.pulls.some((p) => 'sessionId' in p), false);
});

test('a failed group keeps the last good list', () => {
  const cache = createPullCache();
  cache.put(loaded([pr(10)]));
  cache.put({ repository: 'acme/gadgets', status: 'failed', reason: 'x', pulls: [] });
  assert.deepEqual(cache.get('acme/gadgets')?.pulls.map((p) => p.number), [10]);
});

test('setApproved and remove touch only the named pull request', () => {
  const cache = createPullCache();
  cache.put(loaded([pr(10), pr(11, { approvedByMe: true })]));
  cache.setApproved('acme/gadgets', 10, true);
  cache.setApproved('acme/gadgets', 11, false);
  const byNumber = new Map(cache.get('acme/gadgets')?.pulls.map((p) => [p.number, p]));
  assert.equal(byNumber.get(10)?.approvedByMe, true);
  assert.equal('approvedByMe' in (byNumber.get(11) ?? {}), false);
  cache.remove('acme/gadgets', 10);
  assert.deepEqual(cache.get('acme/gadgets')?.pulls.map((p) => p.number), [11]);
  cache.setApproved('other/repo', 1, true);
  cache.remove('other/repo', 1);
  cache.clear();
  assert.equal(cache.get('acme/gadgets'), null);
});

test('approve marks, request changes and withdraw clear, a comment changes nothing', () => {
  const cache = createPullCache();
  cache.put(loaded([pr(10)]));
  const approved = () => cache.get('acme/gadgets')?.pulls[0]?.approvedByMe === true;
  applyDecision(cache, 'acme/gadgets', 10, 'comment');
  assert.equal(approved(), false);
  applyDecision(cache, 'acme/gadgets', 10, 'approve');
  assert.equal(approved(), true);
  applyDecision(cache, 'acme/gadgets', 10, 'comment');
  assert.equal(approved(), true);
  applyDecision(cache, 'acme/gadgets', 10, 'request_changes');
  assert.equal(approved(), false);
  applyDecision(cache, 'acme/gadgets', 10, 'approve');
  applyDecision(cache, 'acme/gadgets', 10, 'withdraw_decision');
  assert.equal(approved(), false);
  applyDecision(undefined, 'acme/gadgets', 10, 'approve');
});
