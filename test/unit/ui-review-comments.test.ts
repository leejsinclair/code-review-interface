// threadsOf() (feature 007, US3, FR-005, FR-006, FR-015): one thread per threadId at any depth; a thread whose
// starting comment is gone gets a "deleted" start; replies by time; canReply follows the reply capability.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReviewCommentItem } from '../../src/contracts/http.ts';
import { threadsOf } from '../../src/ui/state/use-review-comments.ts';

function comment(id: string, threadId: string, createdAt: string, startsThread = false): ReviewCommentItem {
  return {
    id, threadId, startsThread, body: `body ${id}`, createdAt, editedAt: null, anchor: null, outdated: false, postedByTool: false,
    author: { id: 'u1', name: 'Bob', handle: '@bob' }, editable: false,
  };
}
const reply = { reply: { allowed: true } };
const noReply = { reply: { allowed: false, reason: 'Merged' } };

test('one thread per threadId, nested replies included, in first-seen order', () => {
  const threads = threadsOf(
    [comment('a', 'T1', '2026-03-01T10:00:00Z', true), comment('x', 'T2', '2026-03-01T10:30:00Z', true), comment('b', 'T1', '2026-03-01T11:00:00Z'), comment('c', 'T1', '2026-03-01T12:00:00Z')],
    reply,
  );
  assert.deepEqual(threads.map((t) => t.threadId), ['T1', 'T2']);
  assert.equal((threads[0]?.start as ReviewCommentItem).id, 'a');
  assert.deepEqual(threads[0]?.replies.map((c) => c.id), ['b', 'c']);
});

test('the start is found by startsThread, not by id equal to threadId', () => {
  const [thread] = threadsOf([comment('r1', 'disc-9', '2026-03-01T11:00:00Z'), comment('r0', 'disc-9', '2026-03-01T10:00:00Z', true)], reply);
  assert.equal((thread?.start as ReviewCommentItem).id, 'r0');
  assert.deepEqual(thread?.replies.map((c) => c.id), ['r1']);
});

test('a thread with no starting comment has a deleted start and keeps every reply', () => {
  const [thread] = threadsOf([comment('b', 'T1', '2026-03-01T11:00:00Z'), comment('c', 'T1', '2026-03-01T12:00:00Z')], reply);
  assert.equal(thread?.start, 'deleted');
  assert.deepEqual(thread?.replies.map((c) => c.id), ['b', 'c']);
});

test('a deleted root and a deleted middle reply give one thread under one placeholder', () => {
  const threads = threadsOf([comment('d', 'T1', '2026-03-01T13:00:00Z'), comment('b', 'T1', '2026-03-01T11:00:00Z')], reply);
  assert.equal(threads.length, 1);
  assert.equal(threads[0]?.start, 'deleted');
  assert.deepEqual(threads[0]?.replies.map((c) => c.id), ['b', 'd']);
});

test('replies are ordered by createdAt whatever the input order', () => {
  const [thread] = threadsOf([comment('c', 'T1', '2026-03-01T12:00:00Z'), comment('a', 'T1', '2026-03-01T10:00:00Z', true), comment('b', 'T1', '2026-03-01T11:00:00Z')], reply);
  assert.deepEqual(thread?.replies.map((c) => c.id), ['b', 'c']);
});

test('canReply follows the reply capability', () => {
  const input = [comment('a', 'T1', '2026-03-01T10:00:00Z', true)];
  assert.equal(threadsOf(input, reply)[0]?.canReply, true);
  assert.equal(threadsOf(input, noReply)[0]?.canReply, false);
  assert.equal(threadsOf(input, null)[0]?.canReply, false, 'unknown capability does not offer a reply');
});
