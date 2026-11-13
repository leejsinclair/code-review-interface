// Feature 005 (T012; FR-004, FR-006, FR-007, FR-011, FR-016, FR-018; SC-004, SC-007): the review-actions
// core, over in-memory fakes for the provider, the writer and the write_record store. Written first
// (constitution XI): it fails until src/core/review-actions.ts (T021) exists. The module is loaded inside
// each test body so this file runs before it does.
//
// ASSUMED API of src/core/review-actions.ts (the T021 builder must match, or tell the test owner):
//
//   export type WriteRecordRow = {                    // data-model.md write_record, camelCase
//     intentId: string; sessionId: string; state: 'pending' | 'posted' | 'failed';
//     action: 'comment' | 'reply_comment' | 'edit_comment' | 'delete_comment' | 'approve' | 'request_changes' | 'withdraw_decision';
//     actor: string; destination: unknown; headSha: string; body: string | null; platformId: string | null;
//     errorCode: string | null; errorMessage: string | null; createdAt: string;
//   };
//   export interface WriteRecordStore {               // satisfied by ReviewStore (T015); append and read only
//     insertWriteRecord(row: WriteRecordRow): void;
//     listWriteRecords(sessionId: string): WriteRecordRow[];   // oldest first
//   }
//   export type ReviewActionsDeps = {
//     sc: SourceControlProvider; writer: SourceControlWriter; store: WriteRecordStore;
//     repo: RepoRef; pr: number; sessionId: string;
//     now?: () => Date; newId?: () => string;
//   };
//   export type ReviewActionErrorCode =
//     'invalid_body' | 'unauthorized' | 'forbidden' | 'conflict' | 'in_flight' | 'rejected' | 'rate_limited' | 'unavailable';
//   export class ReviewActionError extends Error { code: ReviewActionErrorCode; platformMessage?: string }
//   export interface ReviewActions {
//     perform(body: ReviewActionBody): Promise<ReviewActionResult>;     // rejects with ReviewActionError
//     comments(): Promise<ReviewCommentItem[]>;                         // postedByTool and editable derived here
//     decision(): Promise<ReviewDecisionState>;                         // decision (stale derived), canReview, capability
//   }
//   export function createReviewActions(deps: ReviewActionsDeps): ReviewActions;
//
// Behaviour fixed by these tests: a refusal before the platform (invalid text, head moved, not open, anchor,
// not eligible, not the tool's comment) never calls the writer and writes no pending row; a platform call is
// bracketed by a `pending` row and exactly one terminal row sharing `intentId === requestId`; a platform
// error becomes the ReviewActionError of the same code carrying the platform's message as `platformMessage`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdapterError } from '../../src/contracts/shared.ts';
import type { ReviewActionBody } from '../../src/contracts/http.ts';
import type { RepoRef, SourceControlProvider } from '../../src/contracts/source-control.ts';
import type {
  Anchor,
  Comment,
  ReviewCapability,
  ReviewDecision,
  SourceControlWriter,
  WriteOutcome,
} from '../../src/contracts/source-control-writer.ts';

const HEAD = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';
const MOVED = 'b8d6f4e2a0c9e7b5d3f1a8c6e4b2d0f9e7c5a3b1';
const REPO: RepoRef = { platform: 'github', id: 'acme/widgets' };
const SESSION = 'session-1';
const PR = 7;
const ME = 'alice-dev';

// One file changed: old lines 1-3 (base), new lines 1-4 (head), one hunk.
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-old2',
  '+new2',
  '+new2b',
  ' line3',
  '',
].join('\n');

const ALLOWED = { allowed: true };
const ALL_ALLOWED: ReviewCapability = {
  comment: ALLOWED, line_comment: ALLOWED, reply: ALLOWED, edit_comment: ALLOWED,
  delete_comment: ALLOWED, approve: ALLOWED, request_changes: ALLOWED, withdraw_decision: ALLOWED,
};

type RowLike = {
  intentId: string; sessionId: string; state: 'pending' | 'posted' | 'failed'; action: string; actor: string;
  destination: unknown; headSha: string; body: string | null; platformId: string | null;
  errorCode: string | null; errorMessage: string | null; createdAt: string;
};

function platformComment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id, threadId: id, author: { id: ME, name: ME }, body: `body ${id}`, createdAt: '2026-03-02T10:00:00.000Z',
    editedAt: null, anchor: null, outdated: false, postedByTool: false, ...over,
  };
}

type Fakes = ReturnType<typeof fakes>;

function fakes(opts: { state?: 'open' | 'closed' | 'merged'; author?: string; head?: string } = {}) {
  const state = { head: opts.head ?? HEAD, state: opts.state ?? 'open', author: opts.author ?? 'bob-dev' };
  const comments: Comment[] = [];
  let decision: ReviewDecision | null = null;
  let capability: ReviewCapability = ALL_ALLOWED;
  const calls: string[] = [];
  const reads: string[] = [];
  let nextId = 100;
  let gate: Promise<void> | null = null;
  let failNext: unknown = null;
  let failAfterStoring = false;

  const sc = {
    id: 'github',
    async currentUser() { return { handle: ME, displayName: 'Alice Developer' }; },
    async getPullRequest() {
      return { number: PR, title: 't', description: '', author: state.author, sourceBranch: 's', targetBranch: 'main', headCommit: state.head, state: state.state, updatedAt: '2026-03-02T09:00:00.000Z' };
    },
    async listChangedFiles() {
      return [{ path: 'src/a.ts', status: 'modified', linesAdded: 2, linesRemoved: 1, binary: false }];
    },
    async getUnifiedDiff() { return DIFF; },
    async listComments() { reads.push('listComments'); calls.push('read:listComments'); return comments.map((c) => ({ ...c })); },
    async myDecision() { reads.push('myDecision'); calls.push('read:myDecision'); return decision; },
    async reviewCapability() { return capability; },
  } as unknown as SourceControlProvider;

  async function enter(name: string): Promise<void> {
    calls.push(name);
    if (gate) await gate;
    if (failNext !== null) {
      const err = failNext;
      failNext = null;
      throw err;
    }
  }
  function store(body: string, parent?: string): WriteOutcome {
    nextId += 1;
    const id = String(nextId);
    comments.push(platformComment(id, { body, threadId: parent ?? id }));
    return { kind: 'comment', commentId: id, threadId: parent ?? id, createdAt: '2026-03-02T10:05:00.000Z', commit: state.head };
  }
  const writer = {
    async postComment(_r: RepoRef, _p: number, body: string) {
      const storeFirst = failAfterStoring;
      if (storeFirst) store(body);
      await enter('postComment');
      return storeFirst ? ({ kind: 'comment', commentId: 'x', createdAt: '', commit: '' } as WriteOutcome) : store(body);
    },
    async postLineComment(_r: RepoRef, _p: number, anchor: Anchor, body: string) {
      await enter('postLineComment');
      const out = store(body);
      comments[comments.length - 1]!.anchor = anchor;
      return out;
    },
    async replyToThread(_r: RepoRef, _p: number, threadId: string, body: string) { await enter('replyToThread'); return store(body, threadId); },
    async editComment(_r: RepoRef, _p: number, commentId: string, body: string) {
      await enter('editComment');
      const c = comments.find((x) => x.id === commentId);
      if (c) c.body = body;
      return { kind: 'comment', commentId, createdAt: '2026-03-02T10:00:00.000Z', commit: state.head } as WriteOutcome;
    },
    async deleteComment(_r: RepoRef, _p: number, commentId: string) {
      await enter('deleteComment');
      const i = comments.findIndex((x) => x.id === commentId);
      if (i >= 0) comments.splice(i, 1);
    },
    async approve(_r: RepoRef, _p: number, commit: string, body?: string) {
      await enter('approve');
      decision = { kind: 'approved', message: body ?? null, commit, decidedAt: '2026-03-02T12:00:00.000Z', stale: false, platformId: '7001' };
      return { kind: 'decision', decision: 'approved', platformId: '7001', createdAt: '2026-03-02T12:00:00.000Z', commit } as WriteOutcome;
    },
    async requestChanges(_r: RepoRef, _p: number, commit: string, body: string) {
      await enter('requestChanges');
      decision = { kind: 'changes_requested', message: body, commit, decidedAt: '2026-03-02T12:00:00.000Z', stale: false, platformId: '7002' };
      return { kind: 'decision', decision: 'changes_requested', platformId: '7002', createdAt: '2026-03-02T12:00:00.000Z', commit } as WriteOutcome;
    },
    async withdrawDecision() {
      await enter('withdrawDecision');
      decision = null;
      return { kind: 'decision', decision: 'withdrawn', createdAt: '2026-03-02T12:30:00.000Z', commit: state.head } as WriteOutcome;
    },
  } as SourceControlWriter;

  const rows: RowLike[] = [];
  const recordStore = {
    insertWriteRecord(row: RowLike) { rows.push({ ...row }); },
    listWriteRecords() { return rows.map((r) => ({ ...r })); },
  };

  return {
    sc, writer, recordStore, rows, calls, reads, comments, state,
    writes: () => calls.filter((c) => !c.startsWith('read:')),
    setDecision(d: ReviewDecision | null) { decision = d; },
    setCapability(c: ReviewCapability) { capability = c; },
    hold() { let release = (): void => {}; gate = new Promise<void>((r) => { release = r; }); return () => { gate = null; release(); }; },
    failWith(err: unknown) { failNext = err; },
    failAfterStoring(err: unknown) { failAfterStoring = true; failNext = err; },
    seed(c: Comment) { comments.push(c); },
  };
}

let counter = 0;
async function make(f: Fakes) {
  const mod = await import('../../src/core/review-actions.ts');
  counter = 0;
  const actions = mod.createReviewActions({
    sc: f.sc, writer: f.writer, store: f.recordStore, repo: REPO, pr: PR, sessionId: SESSION,
    now: () => new Date('2026-03-02T10:05:00.000Z'), newId: () => `id-${(counter += 1)}`,
  });
  return { actions, ReviewActionError: mod.ReviewActionError };
}

const body = (action: ReviewActionBody['action'], over: Partial<ReviewActionBody> = {}): ReviewActionBody => ({
  action, expectedHead: HEAD, requestId: 'req-1', ...over,
});
const prComment = (text: string) => ({ kind: 'comment' as const, destination: 'pull_request' as const, body: text });
const lineComment = (anchor: Anchor, text = 'note') => ({ kind: 'comment' as const, destination: 'line' as const, body: text, anchor });
const anchor = (over: Partial<Anchor> = {}): Anchor => ({ path: 'src/a.ts', side: 'head', startLine: 2, endLine: 3, commit: HEAD, ...over });

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
}

function refusedWith(code: string) {
  return (err: unknown): boolean => {
    assert.ok(err instanceof Error, 'an Error');
    assert.equal((err as { code?: string }).code, code);
    return true;
  };
}

// ---------------------------------------------------------------- head moved (FR-007)

test('feature 005: a head that moved returns conflict and posts nothing', async () => {
  const f = fakes({ head: MOVED });
  const { actions } = await make(f);
  for (const action of [prComment('hello'), { kind: 'approve' as const }, { kind: 'withdraw_decision' as const }]) {
    await assert.rejects(actions.perform(body(action)), refusedWith('conflict'));
  }
  assert.deepEqual(f.writes(), [], 'the writer was never called');
  assert.equal(f.rows.length, 0, 'nothing was recorded as pending');
});

test('feature 005: head-moved conflict also covers edit, delete and reply (every action)', async () => {
  const f = fakes({ head: MOVED });
  f.seed(platformComment('55'));
  const { actions } = await make(f);
  const cases = [
    { kind: 'comment' as const, destination: 'edit' as const, commentId: '55', body: 'x' },
    { kind: 'comment' as const, destination: 'delete' as const, commentId: '55' },
    { kind: 'comment' as const, destination: 'reply' as const, threadId: '55', body: 'x' },
  ];
  for (const c of cases) await assert.rejects(actions.perform(body(c)), refusedWith('conflict'));
  assert.deepEqual(f.writes(), []);
});

// ---------------------------------------------------------------- request id (FR-016, SC-007)

test('feature 005: a repeated requestId posts once and returns the earlier result', async () => {
  const f = fakes();
  const { actions } = await make(f);
  const first = await actions.perform(body(prComment('hello')));
  const again = await actions.perform(body(prComment('hello')));
  assert.equal(f.writes().length, 1, 'one platform write');
  assert.equal(again.record.id, first.record.id);
  assert.equal(again.comment?.id, first.comment?.id);
  assert.equal(f.comments.length, 1);
});

test('feature 005: a new requestId is a new action', async () => {
  const f = fakes();
  const { actions } = await make(f);
  await actions.perform(body(prComment('one'), { requestId: 'req-1' }));
  await actions.perform(body(prComment('two'), { requestId: 'req-2' }));
  assert.equal(f.writes().length, 2);
});

test('feature 005: the same requestId clicked twice at once posts once', async () => {
  const f = fakes();
  const release = f.hold();
  const { actions } = await make(f);
  const a = actions.perform(body(prComment('hello')));
  const b = actions.perform(body(prComment('hello')));
  await settle();
  release();
  const results = await Promise.allSettled([a, b]);
  assert.equal(f.writes().length, 1, 'one platform write');
  assert.equal(results.filter((r) => r.status === 'fulfilled').length >= 1, true, 'the click that posted succeeded');
  for (const r of results) {
    if (r.status === 'rejected') refusedWith('in_flight')(r.reason);
  }
});

// ---------------------------------------------------------------- per-PR lock (R3)

test('feature 005: concurrent clicks with different requestIds post once and the other is in_flight', async () => {
  const f = fakes();
  const release = f.hold();
  const { actions } = await make(f);
  const first = actions.perform(body(prComment('one'), { requestId: 'req-1' }));
  await settle();
  await assert.rejects(actions.perform(body(prComment('two'), { requestId: 'req-2' })), refusedWith('in_flight'));
  release();
  await first;
  assert.equal(f.writes().length, 1);
  assert.equal(f.comments.length, 1);
  assert.equal(f.comments[0]?.body, 'one');
});

test('feature 005: the lock is released after a failure, so the next action can run', async () => {
  const f = fakes();
  f.failWith(new AdapterError('rejected', 'github', 'body is too long'));
  const { actions } = await make(f);
  await assert.rejects(actions.perform(body(prComment('one'), { requestId: 'req-1' })), refusedWith('rejected'));
  await actions.perform(body(prComment('two'), { requestId: 'req-2' }));
  assert.equal(f.writes().length, 2);
});

// ---------------------------------------------------------------- ambiguous failure (FR-016)

test('feature 005: after an ambiguous failure the next attempt reads back and does not post twice', async () => {
  const f = fakes();
  f.failAfterStoring(new AdapterError('unavailable', 'github', 'timed out'));
  const { actions } = await make(f);
  await assert.rejects(actions.perform(body(prComment('hello'), { requestId: 'req-1' })), refusedWith('unavailable'));
  assert.equal(f.comments.length, 1, 'the platform did store it');

  const retry = await actions.perform(body(prComment('hello'), { requestId: 'req-2' }));
  assert.equal(f.writes().filter((c) => c === 'postComment').length, 1, 'the writer was not called again');
  assert.ok(f.reads.includes('listComments'), 'the comments were read back');
  assert.equal(retry.comment?.body, 'hello', 'the result is the comment found on the platform');
  assert.equal(f.comments.length, 1);
});

test('feature 005: after an ambiguous failure that stored nothing the retry posts, after the read-back', async () => {
  const f = fakes();
  f.failWith(new AdapterError('unavailable', 'github', 'timed out'));
  const { actions } = await make(f);
  await assert.rejects(actions.perform(body(prComment('hello'), { requestId: 'req-1' })), refusedWith('unavailable'));
  assert.equal(f.comments.length, 0);

  await actions.perform(body(prComment('hello'), { requestId: 'req-2' }));
  const order = f.calls.filter((c) => c === 'postComment' || c === 'read:listComments');
  assert.deepEqual(order, ['postComment', 'read:listComments', 'postComment'], 'read back between the two attempts');
  assert.equal(f.comments.length, 1);
});

test('feature 005: an ambiguous decision failure is read back through myDecision', async () => {
  const f = fakes();
  f.failWith(new AdapterError('unavailable', 'github', 'timed out'));
  const { actions } = await make(f);
  await assert.rejects(actions.perform(body({ kind: 'approve' }, { requestId: 'req-1' })), refusedWith('unavailable'));
  await actions.perform(body({ kind: 'approve' }, { requestId: 'req-2' }));
  assert.ok(f.reads.includes('myDecision'));
  assert.deepEqual(f.calls.filter((c) => c === 'approve' || c === 'read:myDecision'), ['approve', 'read:myDecision', 'approve']);
});

// ---------------------------------------------------------------- text rules (FR-004)

test('feature 005: empty or whitespace-only text is refused for every text action and posts nothing', async () => {
  const f = fakes();
  f.seed(platformComment('55'));
  const { actions } = await make(f);
  const cases: ReviewActionBody['action'][] = [
    prComment(''),
    prComment('   \n\t'),
    lineComment(anchor(), '  '),
    { kind: 'comment', destination: 'reply', threadId: '55', body: ' ' },
    { kind: 'comment', destination: 'edit', commentId: '55', body: '' },
  ];
  for (const [i, action] of cases.entries()) {
    await assert.rejects(actions.perform(body(action, { requestId: `req-${i}` })), refusedWith('invalid_body'));
  }
  assert.deepEqual(f.writes(), []);
  assert.equal(f.rows.length, 0);
});

test('feature 005: request changes needs a message; approve does not', async () => {
  const f = fakes();
  const { actions } = await make(f);
  await assert.rejects(actions.perform(body({ kind: 'request_changes', body: '' }, { requestId: 'a' })), refusedWith('invalid_body'));
  await assert.rejects(actions.perform(body({ kind: 'request_changes', body: '  ' }, { requestId: 'b' })), refusedWith('invalid_body'));
  assert.deepEqual(f.writes(), []);

  const approved = await actions.perform(body({ kind: 'approve' }, { requestId: 'c' }));
  assert.equal(approved.decision?.kind, 'approved');
  assert.equal(f.writes().length, 1);
});

test('feature 005: approve and request changes go to the platform on the expected head commit', async () => {
  const f = fakes();
  const seen: unknown[][] = [];
  const realApprove = f.writer.approve.bind(f.writer);
  const realChanges = f.writer.requestChanges.bind(f.writer);
  f.writer.approve = async (...args) => { seen.push(['approve', ...args]); return realApprove(...args); };
  f.writer.requestChanges = async (...args) => { seen.push(['requestChanges', ...args]); return realChanges(...args); };
  const { actions } = await make(f);
  await actions.perform(body({ kind: 'approve' }, { requestId: 'a' }));
  const changed = await actions.perform(body({ kind: 'request_changes', body: 'Please add a test.' }, { requestId: 'b' }));
  assert.deepEqual(seen[0], ['approve', REPO, PR, HEAD, undefined]);
  assert.deepEqual(seen[1], ['requestChanges', REPO, PR, HEAD, 'Please add a test.']);
  assert.equal(changed.decision?.kind, 'changes_requested');
  assert.equal(changed.decision?.message, 'Please add a test.');
});

test('feature 005: withdraw returns a null decision', async () => {
  const f = fakes();
  const { actions } = await make(f);
  await actions.perform(body({ kind: 'approve' }, { requestId: 'a' }));
  const out = await actions.perform(body({ kind: 'withdraw_decision' }, { requestId: 'b' }));
  assert.equal(out.decision, null);
  assert.equal((await actions.decision()).decision, null);
});

// ---------------------------------------------------------------- eligibility (FR-018)

test('feature 005: a pull request that is not open is refused with a conflict and a reason', async () => {
  for (const state of ['closed', 'merged'] as const) {
    const f = fakes({ state });
    const { actions } = await make(f);
    await assert.rejects(actions.perform(body(prComment('hello'))), (err: unknown) => {
      refusedWith('conflict')(err);
      assert.match((err as Error).message, /not open/i);
      return true;
    });
    assert.deepEqual(f.writes(), []);
  }
});

test('feature 005: canReview is disabled with a reason when the pull request is not open', async () => {
  const f = fakes({ state: 'closed' });
  const { actions } = await make(f);
  const d = await actions.decision();
  assert.equal(d.canReview.allowed, false);
  assert.match(d.canReview.reason ?? '', /not open|closed/i);
  for (const a of Object.values(d.capability)) {
    assert.equal(a.allowed, false, 'canReview false disables every action');
    assert.equal(a.reason, d.canReview.reason, 'with the same reason');
  }
});

test('feature 005: canReview is disabled with a reason when the signed-in account is the author, and actions are refused', async () => {
  const f = fakes({ author: ME });
  const { actions } = await make(f);
  const d = await actions.decision();
  assert.equal(d.canReview.allowed, false);
  assert.match(d.canReview.reason ?? '', /author/i);
  await assert.rejects(actions.perform(body({ kind: 'approve' })), refusedWith('forbidden'));
  assert.deepEqual(f.writes(), []);
});

test('feature 005: an open pull request by someone else is reviewable and the platform capability is passed through', async () => {
  const f = fakes();
  f.setCapability({ ...ALL_ALLOWED, request_changes: { allowed: false, reason: 'This GitLab version has no request changes' } });
  const { actions } = await make(f);
  const d = await actions.decision();
  assert.deepEqual(d.canReview, { allowed: true });
  assert.equal(d.capability.request_changes.allowed, false);
  assert.equal(d.capability.request_changes.reason, 'This GitLab version has no request changes');
  await assert.rejects(actions.perform(body({ kind: 'request_changes', body: 'no' })), refusedWith('forbidden'));
  assert.deepEqual(f.writes(), []);
});

test('feature 005: a decision made on an earlier commit is reported stale', async () => {
  const f = fakes();
  f.setDecision({ kind: 'approved', message: null, commit: MOVED, decidedAt: '2026-03-01T10:00:00.000Z', stale: false, platformId: '7001' });
  const { actions } = await make(f);
  assert.equal((await actions.decision()).decision?.stale, true);
  f.setDecision({ kind: 'approved', message: null, commit: HEAD, decidedAt: '2026-03-01T10:00:00.000Z', stale: true, platformId: '7001' });
  assert.equal((await actions.decision()).decision?.stale, false);
});

// ---------------------------------------------------------------- anchors (FR-001)

test('feature 005: a line comment inside the diff on the head side is posted', async () => {
  const f = fakes();
  const { actions } = await make(f);
  for (const [i, a] of [anchor({ startLine: 2, endLine: 2 }), anchor({ startLine: 1, endLine: 4 }), anchor({ side: 'base', startLine: 1, endLine: 3 })].entries()) {
    const out = await actions.perform(body(lineComment(a), { requestId: `ok-${i}` }));
    assert.ok(out.comment, 'a comment came back');
  }
  assert.equal(f.writes().length, 3);
});

test('feature 005: an anchor on a path that is not a changed file is refused and nothing is posted', async () => {
  const f = fakes();
  const { actions } = await make(f);
  await assert.rejects(actions.perform(body(lineComment(anchor({ path: 'src/other.ts' })))), refusedWith('invalid_body'));
  assert.deepEqual(f.writes(), []);
  assert.equal(f.rows.length, 0);
});

test('feature 005: an anchor whose range is outside that file diff on that side is refused', async () => {
  const f = fakes();
  const { actions } = await make(f);
  const outside = [
    anchor({ startLine: 9, endLine: 9 }), // beyond the head side (1-4)
    anchor({ startLine: 3, endLine: 9 }), // starts inside, ends outside
    anchor({ side: 'base', startLine: 4, endLine: 4 }), // base side has lines 1-3 only
    anchor({ startLine: 0, endLine: 1 }), // lines are 1-based
    anchor({ startLine: 4, endLine: 2 }), // end before start
  ];
  for (const [i, a] of outside.entries()) {
    await assert.rejects(actions.perform(body(lineComment(a), { requestId: `bad-${i}` })), refusedWith('invalid_body'));
  }
  assert.deepEqual(f.writes(), []);
});

// ---------------------------------------------------------------- edit and delete only the tool's own comments (FR-011)

test('feature 005: only a comment this tool posted, by the signed-in user, is editable and can be edited or deleted', async () => {
  const f = fakes();
  f.seed(platformComment('900', { body: 'someone else wrote this on the platform' }));
  const { actions } = await make(f);
  const posted = await actions.perform(body(prComment('mine'), { requestId: 'req-1' }));
  const mineId = posted.comment!.id;

  const list = await actions.comments();
  const mine = list.find((c) => c.id === mineId);
  const other = list.find((c) => c.id === '900');
  assert.equal(mine?.postedByTool, true);
  assert.equal(mine?.editable, true);
  assert.equal(other?.postedByTool, false);
  assert.equal(other?.editable, false);

  await assert.rejects(
    actions.perform(body({ kind: 'comment', destination: 'edit', commentId: '900', body: 'x' }, { requestId: 'req-2' })),
    refusedWith('forbidden'),
  );
  await assert.rejects(
    actions.perform(body({ kind: 'comment', destination: 'delete', commentId: '900' }, { requestId: 'req-3' })),
    refusedWith('forbidden'),
  );
  assert.deepEqual(f.writes(), ['postComment'], 'no edit or delete reached the platform');

  await actions.perform(body({ kind: 'comment', destination: 'edit', commentId: mineId, body: 'mine, edited' }, { requestId: 'req-4' }));
  await actions.perform(body({ kind: 'comment', destination: 'delete', commentId: mineId }, { requestId: 'req-5' }));
  assert.deepEqual(f.writes(), ['postComment', 'editComment', 'deleteComment']);
  assert.equal((await actions.comments()).some((c) => c.id === mineId), false, 'a deleted comment is gone from the read');
});

test('feature 005: a comment this tool posted but another account wrote is not editable', async () => {
  const f = fakes();
  const { actions } = await make(f);
  const posted = await actions.perform(body(prComment('mine'), { requestId: 'req-1' }));
  f.comments.find((c) => c.id === posted.comment!.id)!.author = { id: 'carol', name: 'carol' };
  const item = (await actions.comments()).find((c) => c.id === posted.comment!.id);
  assert.equal(item?.postedByTool, false);
  assert.equal(item?.editable, false);
});

// ---------------------------------------------------------------- records (SC-004, FR-015)

test('feature 005: a write is a pending row then one posted row with actor, head, exact text and platform id', async () => {
  const f = fakes();
  const { actions } = await make(f);
  const out = await actions.perform(body(prComment('  keep my spacing  '), { requestId: 'req-9' }));
  const rows = f.rows.filter((r) => r.intentId === 'req-9');
  assert.deepEqual(rows.map((r) => r.state), ['pending', 'posted']);
  const posted = rows[1]!;
  assert.equal(posted.sessionId, SESSION);
  assert.equal(posted.action, 'comment');
  assert.equal(posted.actor, ME);
  assert.equal(posted.headSha, HEAD);
  assert.equal(posted.body, '  keep my spacing  ', 'the exact text sent');
  assert.equal(posted.platformId, out.comment?.id);
  assert.ok(posted.destination !== undefined && posted.destination !== null);
  assert.ok(posted.createdAt.length > 0);
  assert.equal(out.record.headSha, HEAD);
  assert.equal(typeof out.record.id, 'string');
});

test('feature 005: the pending row is written before the platform is called', async () => {
  const f = fakes();
  const release = f.hold();
  const { actions } = await make(f);
  const p = actions.perform(body(prComment('hello'), { requestId: 'req-1' }));
  await settle();
  assert.deepEqual(f.writes(), ['postComment'], 'the platform call is in flight');
  assert.deepEqual(f.rows.map((r) => r.state), ['pending']);
  release();
  await p;
  assert.deepEqual(f.rows.map((r) => r.state), ['pending', 'posted']);
});

// ---------------------------------------------------------------- platform errors

test('feature 005: a platform refusal keeps its code and message and leaves one failed row', async () => {
  for (const code of ['forbidden', 'conflict', 'rejected', 'rate_limited'] as const) {
    const f = fakes();
    f.failWith(new AdapterError(code, 'github', `platform says ${code}`));
    const { actions } = await make(f);
    await assert.rejects(actions.perform(body(prComment('hello'), { requestId: 'req-1' })), (err: unknown) => {
      refusedWith(code)(err);
      assert.ok(String((err as { platformMessage?: string }).platformMessage).includes(`platform says ${code}`));
      return true;
    });
    const rows = f.rows.filter((r) => r.intentId === 'req-1');
    assert.deepEqual(rows.map((r) => r.state), ['pending', 'failed']);
    assert.equal(rows[1]?.errorCode, code);
    assert.ok(rows[1]?.errorMessage?.includes(`platform says ${code}`));
  }
});
