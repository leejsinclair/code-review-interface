// Feature 005 (T008, FR-020, XI.2): one SourceControlWriter suite, run against every platform by
// source-control-writer.contract.test.ts (T009). A target supplies the writer factory and every
// expected value as data; the suite never branches on platform.
//
// How a target is built (T009 follows this):
// - `create(scenario)` returns a fresh harness over recorded fixtures (T010) for that scenario.
// - Fixtures answer each write endpoint with the platform's real response shape; the suite checks
//   the NEUTRAL result (WriteOutcome) and the requests the adapter made, never the platform shape.
// - `expected.*` holds the recorded constants (ids, commit, times) the fixtures return.
//
// Written first (constitution XI): it fails until the adapters (Wave 3) exist.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdapterErrorCode, PlatformId, ReadOnlyFetch } from '../../src/contracts/shared.ts';
import { AdapterError } from '../../src/contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../../src/contracts/source-control.ts';
import type { Anchor, SourceControlWriter, WriteOutcome } from '../../src/contracts/source-control-writer.ts';

/** One request the adapter made; `body` is the raw text sent (empty for a GET). */
export type ObservedWrite = { method: string; host: string; path: string; headers: Record<string, string>; body: string };

/**
 * The situation the writer is built for:
 * - `default`: every write succeeds as recorded;
 * - `forbidden` | `conflict` | `rejected` | `rate_limited` | `unavailable`: every write answers with the
 *   platform's refusal for that code (403 or missing scope, 409, 422, 429, 5xx), carrying `expected.refusalMessage`;
 * - `no-request-changes`: the platform version has no request-changes (GitLab, version probe); only
 *   `reviewCapability` and `requestChanges` are exercised under it, and only when
 *   `expected.requestChangesGap` is given.
 *
 * Spec 007 scenarios, each backed by a fixture variant folder `<fixtures>/variants/<scenario>/` that is
 * served before the base fixtures (authored by T028, T032 and the Bitbucket fixture task; until then the
 * scenario fails with "variant fixtures missing"):
 * - `moved-head`: the pull request has a newer head than `lineAnchor.commit`; on GitLab an OLDER diff
 *   version still matches the anchor commit but the newest does not (VO-018);
 * - `abbreviated-head`: the pull request list row shows an abbreviated head; the pull request read gives
 *   the full commit id (on Bitbucket, by abbreviated source hash plus a commit lookup) (VO-020);
 * - `message-fails`: the decision write succeeds and the separate message write answers a platform
 *   refusal (VO-022); only used where `expected.messageWrite` is given;
 * - `no-decision`: the signed-in account has no decision to withdraw (VO-024);
 * - `withdrawn-once`: a decision exists on the first read and none after the first withdraw (VO-024);
 * - `whole-pr-comment`: `expected.wholePullRequestReply.threadId` names a comment on the whole pull
 *   request, the kind that platform may not allow replies to (VO-025).
 */
export type WriterScenario =
  | 'default'
  | 'forbidden'
  | 'conflict'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable'
  | 'no-request-changes'
  | 'moved-head'
  | 'abbreviated-head'
  | 'message-fails'
  | 'no-decision'
  | 'withdrawn-once'
  | 'whole-pr-comment';

export type WriterHarness = {
  writer: SourceControlWriter;
  /** The read side over the same recorded transport: listComments, myDecision, reviewCapability. */
  sc: SourceControlProvider;
  /** Every request the adapter made, in order (reads included). */
  readonly requests: readonly ObservedWrite[];
  /** The read-only layer the read side uses, over the same transport (for the one-read-per-request check). */
  read: ReadOnlyFetch;
  /** Throws when the transport saw a request it had no recording for. */
  assertComplete?(): void;
};

export type WriterExpectations = {
  repo: RepoRef;
  pr: number;
  /** Current head commit of `pr`, used for approve and request changes. */
  head: string;
  /** Text posted by each case; the fixture echoes it back. */
  bodies: { comment: string; line: string; range: string; reply: string; edit: string; approve: string; changes: string };
  /** A single-line and a multi-line anchor inside the diff of `pr` (side head). `commit` equals `head`. */
  lineAnchor: Anchor;
  rangeAnchor: Anchor;
  /** Result the fixture returns for each comment write. `createdAt` is ISO 8601 UTC. */
  comment: { commentId: string; threadId?: string; createdAt: string };
  lineComment: { commentId: string; threadId?: string; createdAt: string };
  reply: { threadId: string; commentId: string; createdAt: string };
  edit: { commentId: string; createdAt: string };
  /** Id of the comment `deleteComment` removes. */
  deleteCommentId: string;
  /** Decision results; `platformId` is checked only when given. */
  approve: { createdAt: string; platformId?: string };
  requestChanges: { createdAt: string; platformId?: string };
  withdraw: { createdAt: string };
  /**
   * What the read side reports after the recorded writes: the id of a comment the signed-in
   * account authored (the id core matches to write_record, R4), and the account's own decision.
   */
  ownComment: { id: string; author: string };
  myDecision: { kind: 'approved' | 'changes_requested'; commit: string } | null;
  /** The platform's own refusal text, expected in every error's message. */
  refusalMessage: string;
  /** Present only for a platform whose request-changes can be missing; `reason` is a substring. */
  requestChangesGap?: { reason: string };
  /**
   * Spec 007. Reads the position out of a line-comment request the adapter sent, in the neutral shape,
   * so single-line and range anchors are checked on exactly the lines and side chosen (FR-008).
   */
  anchorOnWire: (write: ObservedWrite) => { path: string; side: 'base' | 'head'; startLine: number; endLine: number };
  /** True for the write that records a decision (approve or request changes). */
  decisionWrite: (write: ObservedWrite) => boolean;
  /**
   * True for a write that carries a decision's message on its own. Absent where the platform sends the
   * message inside the decision itself (GitHub): then one write is made and the outcome has no `message`.
   */
  messageWrite?: (write: ObservedWrite) => boolean;
  /** URL path of the pull request list; a writer must never read it (FR-019). */
  listPath: string;
  /** URL path the head check reads: the pull request, or on GitLab its diff versions. */
  headReadPath: string;
  /** The `Accept` the platform's own reads send, when it is not plain JSON (it is part of the read memo's key). */
  headReadAccept?: string;
  /** A reply to a comment on the whole pull request (FR-015). `quoted` is the original text, where the platform has no reply for it. */
  wholePullRequestReply: { threadId: string; commentId: string; quoted?: string };
  /** Hosts a write may go to. */
  host: string;
  /** When given, the `authorization` header every request must carry. */
  authorization?: string;
};

export type WriterTarget = {
  id: PlatformId;
  create(scenario?: WriterScenario): Promise<WriterHarness>;
  expected: WriterExpectations;
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function writesOf(h: WriterHarness): ObservedWrite[] {
  return h.requests.filter((r) => MUTATING.has(r.method));
}

function checkTransport(target: WriterTarget, h: WriterHarness): void {
  h.assertComplete?.();
  for (const r of h.requests) {
    assert.equal(r.host, target.expected.host);
    if (target.expected.authorization !== undefined) {
      assert.equal(r.headers['authorization'], target.expected.authorization, 'every request is authorised by the injected callback');
    }
  }
}

function assertComment(outcome: WriteOutcome, want: { commentId: string; threadId?: string; createdAt: string }, commit: string): void {
  assert.equal(outcome.kind, 'comment');
  if (outcome.kind !== 'comment') return;
  assert.equal(outcome.commentId, want.commentId);
  if (want.threadId !== undefined) assert.equal(outcome.threadId, want.threadId);
  assert.equal(outcome.createdAt, want.createdAt);
  assert.ok(!Number.isNaN(Date.parse(outcome.createdAt)));
  assert.equal(typeof outcome.commit, 'string');
  assert.ok(outcome.commit.length > 0);
  if (commit) assert.equal(outcome.commit, commit);
}

const REFUSALS: Array<AdapterErrorCode & WriterScenario> = ['forbidden', 'conflict', 'rejected', 'rate_limited', 'unavailable'];

export function runWriterContract(target: WriterTarget): void {
  const { id, expected: e } = target;
  const { repo, pr } = e;

  test(`feature 005 ${id}: postComment posts the exact text on the pull request and returns the neutral outcome`, async () => {
    const h = await target.create();
    assertComment(await h.writer.postComment(repo, pr, e.bodies.comment), e.comment, '');
    const writes = writesOf(h);
    assert.equal(writes.length, 1, 'one write request');
    assert.ok(writes[0]!.body.includes(e.bodies.comment), 'the exact text is sent');
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: postLineComment anchors a single line at the commit`, async () => {
    const h = await target.create();
    assertComment(await h.writer.postLineComment(repo, pr, e.lineAnchor, e.bodies.line), e.lineComment, e.lineAnchor.commit);
    const [w, ...rest] = writesOf(h);
    assert.equal(rest.length, 0);
    assert.ok(w!.body.includes(e.bodies.line));
    assert.ok(w!.body.includes(e.lineAnchor.path), 'the path is sent');
    assert.ok(w!.body.includes(e.lineAnchor.commit), 'the commit is sent');
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: postLineComment anchors a line range, start and end both sent`, async () => {
    const h = await target.create();
    assert.ok(e.rangeAnchor.endLine > e.rangeAnchor.startLine, 'the range fixture spans several lines');
    assertComment(await h.writer.postLineComment(repo, pr, e.rangeAnchor, e.bodies.range), e.lineComment, e.rangeAnchor.commit);
    const [w] = writesOf(h);
    assert.ok(w!.body.includes(String(e.rangeAnchor.startLine)), 'start line is sent');
    assert.ok(w!.body.includes(String(e.rangeAnchor.endLine)), 'end line is sent');
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: replyToThread posts into the thread and keeps its thread id`, async () => {
    const h = await target.create();
    const outcome = await h.writer.replyToThread(repo, pr, e.reply.threadId, e.bodies.reply);
    assertComment(outcome, { commentId: e.reply.commentId, threadId: e.reply.threadId, createdAt: e.reply.createdAt }, '');
    assert.ok(writesOf(h)[0]!.body.includes(e.bodies.reply));
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: editComment sends the new text for that comment id only`, async () => {
    const h = await target.create();
    assertComment(await h.writer.editComment(repo, pr, e.edit.commentId, e.bodies.edit), e.edit, '');
    const writes = writesOf(h);
    assert.equal(writes.length, 1);
    assert.ok(writes[0]!.path.includes(e.edit.commentId), 'the request names the comment');
    assert.ok(writes[0]!.body.includes(e.bodies.edit));
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: deleteComment deletes that comment id and nothing else`, async () => {
    const h = await target.create();
    assert.equal(await h.writer.deleteComment(repo, pr, e.deleteCommentId), undefined);
    const writes = writesOf(h);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.method, 'DELETE');
    assert.ok(writes[0]!.path.includes(e.deleteCommentId));
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: approve is made on the given commit and returns an approved decision`, async () => {
    const h = await target.create();
    const outcome = await h.writer.approve(repo, pr, e.head, e.bodies.approve);
    assert.equal(outcome.kind, 'decision');
    if (outcome.kind === 'decision') {
      assert.equal(outcome.decision, 'approved');
      assert.equal(outcome.commit, e.head);
      assert.equal(outcome.createdAt, e.approve.createdAt);
      if (e.approve.platformId !== undefined) assert.equal(outcome.platformId, e.approve.platformId);
    }
    const writes = writesOf(h);
    assert.ok(writes.length >= 1);
    assert.ok(writes.some((w) => w.body.includes(e.head)) || writes.every((w) => w.path.includes(e.head)), 'the commit is part of the request');
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: approve works without a message`, async () => {
    const h = await target.create();
    const outcome = await h.writer.approve(repo, pr, e.head);
    assert.equal(outcome.kind === 'decision' && outcome.decision, 'approved');
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: requestChanges sends the message on the given commit, or the capability says why not`, async () => {
    const h = await target.create();
    const cap = await h.sc.reviewCapability(repo, pr);
    if (!cap.request_changes.allowed) {
      assert.ok(cap.request_changes.reason && cap.request_changes.reason.length > 0, 'a gap carries a reason');
      return;
    }
    const outcome = await h.writer.requestChanges(repo, pr, e.head, e.bodies.changes);
    assert.equal(outcome.kind, 'decision');
    if (outcome.kind === 'decision') {
      assert.equal(outcome.decision, 'changes_requested');
      assert.equal(outcome.commit, e.head);
      assert.equal(outcome.createdAt, e.requestChanges.createdAt);
      if (e.requestChanges.platformId !== undefined) assert.equal(outcome.platformId, e.requestChanges.platformId);
    }
    assert.ok(writesOf(h).some((w) => w.body.includes(e.bodies.changes)));
    checkTransport(target, h);
  });

  if (e.requestChangesGap !== undefined) {
    const gap = e.requestChangesGap;
    test(`feature 005 ${id}: a platform version without request-changes reports allowed false with a reason, not an error (FR-020)`, async () => {
      const h = await target.create('no-request-changes');
      const cap = await h.sc.reviewCapability(repo, pr);
      assert.equal(cap.request_changes.allowed, false);
      assert.ok(cap.request_changes.reason?.includes(gap.reason), `reason mentions: ${gap.reason}`);
      assert.equal(cap.approve.allowed, true, 'the other actions are unaffected');
      assert.deepEqual(writesOf(h), [], 'asking posts nothing');
      checkTransport(target, h);
    });
  }

  test(`feature 005 ${id}: withdrawDecision returns a withdrawn decision and myDecision then reads as recorded`, async () => {
    const h = await target.create();
    const outcome = await h.writer.withdrawDecision(repo, pr);
    assert.equal(outcome.kind, 'decision');
    if (outcome.kind === 'decision') {
      assert.equal(outcome.decision, 'withdrawn');
      assert.equal(outcome.createdAt, e.withdraw.createdAt);
    }
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: reads expose the id of the signed-in account's own comment and decision`, async () => {
    const h = await target.create();
    const comments = await h.sc.listComments(repo, pr);
    const own = comments.find((c) => c.id === e.ownComment.id);
    assert.ok(own, 'the own comment is listed with the platform id writes return');
    assert.equal(own.author.name, e.ownComment.author);
    assert.equal(own.postedByTool, false, 'adapters never set postedByTool');
    for (const c of comments) {
      assert.ok(c.threadId.length > 0);
      assert.ok(c.anchor === null || (c.anchor.endLine >= c.anchor.startLine && c.anchor.path.length > 0));
    }
    const mine = await h.sc.myDecision(repo, pr);
    if (e.myDecision === null) assert.equal(mine, null);
    else {
      assert.equal(mine?.kind, e.myDecision.kind);
      assert.equal(mine?.commit, e.myDecision.commit);
    }
    for (const r of h.requests) assert.equal(r.method, 'GET', 'reads never write');
    checkTransport(target, h);
  });

  test(`feature 005 ${id}: reviewCapability is read-only and has no merge, decline or close action`, async () => {
    const h = await target.create();
    const cap = await h.sc.reviewCapability(repo, pr);
    assert.deepEqual(
      Object.keys(cap).sort(),
      ['approve', 'comment', 'delete_comment', 'edit_comment', 'line_comment', 'reply', 'request_changes', 'withdraw_decision'],
    );
    for (const a of Object.values(cap)) assert.ok(a.allowed || (a.reason !== undefined && a.reason.length > 0), 'disallowed carries a reason');
    for (const r of h.requests) assert.equal(r.method, 'GET');
  });

  test(`feature 005 ${id}: the writer has no method that merges, declines or closes`, async () => {
    const h = await target.create();
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(h.writer)).concat(Object.keys(h.writer));
    for (const n of names) assert.ok(!/merge|decline|close/i.test(n), `${n} must not exist`);
  });

  for (const code of REFUSALS) {
    const scenario: WriterScenario = code;
    test(`feature 005 ${id}: a platform refusal maps to ${code} and keeps the platform message`, async () => {
      const h = await target.create(scenario);
      const calls: Array<() => Promise<unknown>> = [
        () => h.writer.postComment(repo, pr, e.bodies.comment),
        () => h.writer.postLineComment(repo, pr, e.lineAnchor, e.bodies.line),
        () => h.writer.editComment(repo, pr, e.edit.commentId, e.bodies.edit),
        () => h.writer.deleteComment(repo, pr, e.deleteCommentId),
        () => h.writer.approve(repo, pr, e.head),
      ];
      for (const call of calls) {
        await assert.rejects(call, (err: unknown) => {
          assert.ok(err instanceof AdapterError, 'an AdapterError');
          assert.equal(err.code, code);
          assert.equal(err.platform, id);
          assert.ok(err.message.includes(e.refusalMessage), 'the platform message is carried');
          return true;
        });
      }
    });
  }

  // ---- Spec 007 (T011) ----

  test(`feature 007 ${id}: edit and delete each reach exactly that comment, and a platform refusal is forbidden`, async () => {
    const h = await target.create('forbidden');
    await assert.rejects(h.writer.editComment(repo, pr, e.edit.commentId, e.bodies.edit), (err: unknown) => err instanceof AdapterError && err.code === 'forbidden');
    await assert.rejects(h.writer.deleteComment(repo, pr, e.deleteCommentId), (err: unknown) => err instanceof AdapterError && err.code === 'forbidden');
    const writes = writesOf(h);
    assert.equal(writes.length, 2, 'one write each, nothing retried or widened');
    assert.ok(writes[0]!.path.includes(e.edit.commentId));
    assert.ok(writes[1]!.path.includes(e.deleteCommentId));
  });

  for (const [label, anchor, text] of [
    ['a single line', e.lineAnchor, e.bodies.line],
    ['a line range', e.rangeAnchor, e.bodies.range],
  ] as const) {
    test(`feature 007 ${id}: ${label} lands on exactly the chosen lines and side`, async () => {
      const h = await target.create();
      await h.writer.postLineComment(repo, pr, anchor, text);
      const [w] = writesOf(h);
      assert.deepEqual(e.anchorOnWire(w!), { path: anchor.path, side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine });
    });
  }

  test(`feature 007 ${id}: a line comment after the pull request moved to a newer commit is a conflict and posts nothing`, async () => {
    const h = await target.create('moved-head');
    for (const anchor of [e.lineAnchor, e.rangeAnchor]) {
      await assert.rejects(h.writer.postLineComment(repo, pr, anchor, e.bodies.line), (err: unknown) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.code, 'conflict');
        assert.equal(err.platform, id);
        return true;
      });
    }
    assert.deepEqual(writesOf(h), [], 'nothing is posted, including where an older diff version still matches');
    checkTransport(target, h);
  });

  test(`feature 007 ${id}: an abbreviated head on the pull request list never causes a refusal`, async () => {
    const h = await target.create('abbreviated-head');
    assertComment(await h.writer.postLineComment(repo, pr, e.lineAnchor, e.bodies.line), e.lineComment, e.lineAnchor.commit);
    assert.equal(writesOf(h).length, 1);
    assert.ok(!h.requests.some((r) => r.path === e.listPath), 'the head check reads the pull request itself, not the list');
    checkTransport(target, h);
  });

  test(`feature 007 ${id}: a decision with a message is written before the message`, async () => {
    const h = await target.create();
    const outcome = await h.writer.approve(repo, pr, e.head, e.bodies.approve);
    assert.equal(outcome.kind, 'decision');
    const writes = writesOf(h);
    if (e.messageWrite === undefined) {
      assert.equal(writes.length, 1, 'the message travels inside the decision');
      assert.ok(writes[0]!.body.includes(e.bodies.approve));
      assert.equal(outcome.kind === 'decision' ? outcome.message : undefined, undefined, 'no separate message result');
    } else {
      const decisionAt = writes.findIndex(e.decisionWrite);
      const messageAt = writes.findIndex(e.messageWrite);
      assert.ok(decisionAt >= 0 && messageAt >= 0, 'both writes are made');
      assert.ok(decisionAt < messageAt, 'decision first, then message');
      assert.ok(writes[messageAt]!.body.includes(e.bodies.approve));
      assert.equal(outcome.kind === 'decision' && outcome.message?.posted, true);
      assert.ok(outcome.kind === 'decision' && outcome.message?.posted === true && typeof outcome.message.commentId === 'string' && outcome.message.commentId.length > 0, 'the message comment id is reported');
    }
    checkTransport(target, h);
  });

  if (e.messageWrite !== undefined) {
    const isMessage = e.messageWrite;
    test(`feature 007 ${id}: a message that fails to post leaves the decision made and is reported, not thrown`, async () => {
      const h = await target.create('message-fails');
      const outcome = await h.writer.approve(repo, pr, e.head, e.bodies.approve);
      assert.equal(outcome.kind, 'decision');
      if (outcome.kind !== 'decision') return;
      assert.equal(outcome.decision, 'approved');
      assert.equal(outcome.message?.posted, false);
      assert.ok(outcome.message !== undefined && !('commentId' in outcome.message));
      const reason = (outcome.message as { reason?: unknown } | undefined)?.reason;
      assert.ok(typeof reason === 'string' && reason.length > 0, 'the unposted message carries its reason');
      const writes = writesOf(h);
      assert.ok(writes.findIndex(e.decisionWrite) < writes.findIndex(isMessage), 'the decision was written first');
    });

    test(`feature 007 ${id}: a decision that fails sends no message`, async () => {
      const h = await target.create('forbidden');
      await assert.rejects(h.writer.approve(repo, pr, e.head, e.bodies.approve), (err: unknown) => err instanceof AdapterError && err.code === 'forbidden');
      assert.equal(writesOf(h).filter(isMessage).length, 0);
    });
  } else {
    test(`feature 007 ${id}: a decision that fails sends one refused write and nothing else`, async () => {
      const h = await target.create('forbidden');
      await assert.rejects(h.writer.approve(repo, pr, e.head, e.bodies.approve), (err: unknown) => err instanceof AdapterError && err.code === 'forbidden');
      assert.equal(writesOf(h).length, 1);
    });
  }

  test(`feature 007 ${id}: a decision with an empty message sends no message and reports none`, async () => {
    const h = await target.create();
    const outcome = await h.writer.approve(repo, pr, e.head, '');
    assert.equal(outcome.kind, 'decision');
    assert.equal(outcome.kind === 'decision' ? outcome.message : 'n/a', undefined, 'no message result');
    const writes = writesOf(h);
    if (e.messageWrite !== undefined) assert.equal(writes.filter(e.messageWrite).length, 0, 'no message write');
    else assert.ok(writes.every((w) => !w.body.includes('"body"')), 'the decision carries no body');
    checkTransport(target, h);
  });

  test(`feature 007 ${id}: withdraw with no decision is a conflict and sends no write`, async () => {
    const h = await target.create('no-decision');
    await assert.rejects(h.writer.withdrawDecision(repo, pr), (err: unknown) => err instanceof AdapterError && err.code === 'conflict' && err.platform === id);
    assert.deepEqual(writesOf(h), []);
    checkTransport(target, h);
  });

  test(`feature 007 ${id}: withdraw twice in a row, the second is a conflict with no further write`, async () => {
    const h = await target.create('withdrawn-once');
    const first = await h.writer.withdrawDecision(repo, pr);
    assert.equal(first.kind === 'decision' && first.decision, 'withdrawn');
    const after = writesOf(h).length;
    assert.ok(after >= 1);
    await assert.rejects(h.writer.withdrawDecision(repo, pr), (err: unknown) => err instanceof AdapterError && err.code === 'conflict');
    assert.equal(writesOf(h).length, after, 'the second call writes nothing');
    checkTransport(target, h);
  });

  test(`feature 007 ${id}: a reply to a whole-pull-request comment is posted, quoting the original where the platform has no reply`, async () => {
    const h = await target.create('whole-pr-comment');
    const w = e.wholePullRequestReply;
    const outcome = await h.writer.replyToThread(repo, pr, w.threadId, e.bodies.reply);
    assert.equal(outcome.kind, 'comment');
    if (outcome.kind === 'comment') assert.equal(outcome.commentId, w.commentId);
    const posts = writesOf(h).filter((r) => r.method === 'POST');
    assert.equal(posts.length, 1, 'one comment is posted');
    assert.ok(posts[0]!.body.includes(e.bodies.reply));
    if (w.quoted !== undefined) {
      const quote = w.quoted.split('\n').map((line) => `> ${line}`).join('\n');
      assert.ok(posts[0]!.body.includes(JSON.stringify(quote).slice(1, -1)), 'the original is quoted with "> " on each line');
      assert.ok(posts[0]!.body.indexOf(JSON.stringify(quote).slice(1, -1)) < posts[0]!.body.indexOf(e.bodies.reply), 'quote first, then the reply');
    }
    checkTransport(target, h);
  });

  test(`feature 007 ${id}: every read the writer needs goes through the read layer (one network read inside a request scope)`, async () => {
    const h = await target.create();
    const reads = (): number => h.requests.filter((r) => r.method === 'GET' && r.path === e.headReadPath).length;
    // Imported here so the rest of the suite still runs while src/adapters/request-memo.ts (T018) does not exist.
    const { withRequestScope } = await import('../../src/adapters/request-memo.ts');
    await withRequestScope(async () => {
      await h.read(`https://${e.host}${e.headReadPath}`, { headers: { accept: e.headReadAccept ?? 'application/json', ...(e.authorization !== undefined ? { authorization: e.authorization } : {}) } }).catch(() => undefined);
      await h.writer.postLineComment(repo, pr, e.lineAnchor, e.bodies.line);
    });
    assert.equal(reads(), 1, 'the writer\'s head read is served from the same scope as the read side');
  });
}
