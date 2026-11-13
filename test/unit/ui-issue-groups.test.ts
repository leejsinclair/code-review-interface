// Dashboard grouping by issue key: where the key is read from, project filtering, group order, counts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PullSummary } from '../../src/contracts/http.ts';
import { groupId, groupPullsByIssue, issueKeyOf, NO_ISSUE_GROUP } from '../../src/ui/state/issue-groups.ts';

const pr = (number: number, title: string, sourceBranch = 'main-x', updatedAt = `2026-11-0${number}T00:00:00Z`, approvedByMe?: boolean): PullSummary => ({
  repository: 'acme/widgets',
  number,
  title,
  author: 'sam',
  sourceBranch,
  targetBranch: 'main',
  updatedAt,
  ...(approvedByMe === undefined ? {} : { approvedByMe }),
});

test('the key comes from the title before the branch, uppercased, with leading zeros dropped', () => {
  assert.equal(issueKeyOf(pr(1, 'ABC-12 fix', 'feature/XYZ-9-other')), 'ABC-12');
  assert.equal(issueKeyOf(pr(1, 'No key here', 'feature/abc-007-thing')), 'ABC-7');
  assert.equal(issueKeyOf(pr(1, 'No key here', 'plain')), null);
});

test('configured projects narrow what counts; with none configured any key counts', () => {
  assert.equal(issueKeyOf(pr(1, 'Support utf-8', 'fix/utf-8'), ['ABC']), null);
  assert.equal(issueKeyOf(pr(1, 'Support utf-8', 'fix/utf-8'), []), 'UTF-8');
  assert.equal(issueKeyOf(pr(1, 'utf-8 and abc-5', 'x'), ['abc']), 'ABC-5', 'the first allowed key, project matched case-insensitively');
});

test('pull requests sharing a key group together; groups run newest first and the no-key group last', () => {
  const sorted = [pr(5, 'No key'), pr(4, 'ABC-2 b'), pr(3, 'XYZ-1 a'), pr(2, 'ABC-2 c'), pr(1, 'Also none')];
  const groups = groupPullsByIssue(sorted);
  assert.deepEqual(groups.map((g) => g.key), ['ABC-2', 'XYZ-1', null]);
  assert.deepEqual(groups.map((g) => g.pulls.length), [2, 1, 2]);
  assert.deepEqual(groups[0]!.pulls.map((p) => p.number), [4, 2]);
  assert.deepEqual(groups.map(groupId), ['ABC-2', 'XYZ-1', NO_ISSUE_GROUP]);
});

test('inside a group approved pull requests come last and the incoming order is otherwise kept', () => {
  const sorted = [pr(4, 'ABC-1 a', 'x', undefined, true), pr(3, 'ABC-1 b'), pr(2, 'ABC-1 c', 'x', undefined, true), pr(1, 'ABC-1 d', 'x', undefined, false)];
  assert.deepEqual(groupPullsByIssue(sorted)[0]!.pulls.map((p) => p.number), [3, 1, 4, 2]);
});

test('no pull requests means no groups', () => {
  assert.deepEqual(groupPullsByIssue([]), []);
});
