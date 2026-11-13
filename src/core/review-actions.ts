// Review actions core (feature 005, T021; FR-001, FR-004, FR-006, FR-007, FR-011, FR-016, FR-018).
//
// One click performs one action at once. The safeguards are here, tested once, so adapters stay thin:
// the head commit the reviewer viewed (`expectedHead`) must still be the head, a repeated `requestId`
// posts once, one write per pull request runs at a time, an ambiguous failure is read back before the
// next attempt, and every write leaves a `pending` row then exactly one terminal row.

import type { ReviewActionBody, ReviewActionResult, ReviewCommentItem, ReviewDecisionState } from '../contracts/http.ts';
import { AdapterError } from '../contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../contracts/source-control.ts';
import type {
  Anchor,
  Comment,
  ReviewCapability,
  ReviewDecision,
  SourceControlWriter,
  WriteOutcome,
} from '../contracts/source-control-writer.ts';
import { parseUnifiedDiff } from '../repo/unified-diff.ts';
import type { WriteRecordAction, WriteRecordRow } from '../store/review-store.ts';

export type ReviewActionErrorCode =
  | 'invalid_body'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'in_flight'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable';

export class ReviewActionError extends Error {
  readonly code: ReviewActionErrorCode;
  readonly platformMessage?: string;
  constructor(code: ReviewActionErrorCode, message: string, platformMessage?: string) {
    super(message);
    this.name = 'ReviewActionError';
    this.code = code;
    if (platformMessage !== undefined) this.platformMessage = platformMessage;
  }
}

/** What core needs from the store: append and read only (constitution III.2). */
export type CoreWriteRecord = WriteRecordRow & { actor: string };
type StoredWrite = Omit<WriteRecordRow, 'action'> & { action: string };
export interface WriteRecordStore {
  insertWriteRecord(row: CoreWriteRecord): void;
  listWriteRecords(sessionId: string): StoredWrite[];
  closeAbandonedWrites?(sessionId: string, closedAt: string): number;
}

export type ReviewActionsDeps = {
  sc: SourceControlProvider;
  writer: SourceControlWriter;
  store: WriteRecordStore;
  repo: RepoRef;
  pr: number;
  sessionId: string;
  now?: () => Date;
  /** Accepted for tests; the request id is the intent id, so core mints none. */
  newId?: () => string;
};

export interface ReviewActions {
  perform(body: ReviewActionBody): Promise<ReviewActionResult>;
  comments(): Promise<ReviewCommentItem[]>;
  decision(): Promise<ReviewDecisionState>;
}

type Cap = keyof ReviewCapability;
type Plan = {
  record: WriteRecordAction;
  cap: Cap;
  text: string | null;
  destination: unknown;
  run: (commit: string) => Promise<WriteOutcome | void>;
};

const COMMENT_ACTIONS: ReadonlySet<WriteRecordAction> = new Set<WriteRecordAction>(['comment', 'reply_comment']);

function isEmpty(text: string | undefined): boolean {
  return text === undefined || text.trim() === '';
}

function toActionError(err: unknown): ReviewActionError {
  if (err instanceof ReviewActionError) return err;
  if (err instanceof AdapterError) {
    const code: ReviewActionErrorCode =
      err.code === 'not_found' ? 'rejected' : err.code === 'truncated' ? 'unavailable' : err.code;
    return new ReviewActionError(code, err.message, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ReviewActionError('unavailable', message, message);
}

/** Lines of `path` that a comment can sit on, on one side of the diff. */
function commentableLines(diff: string, path: string, side: Anchor['side']): Set<number> | null {
  const file = parseUnifiedDiff(diff).find((f) => f.path === path || f.oldPath === path);
  if (file === undefined || file.binary) return null;
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const n = side === 'head' ? line.newLine : line.oldLine;
      if (n !== undefined) lines.add(n);
    }
  }
  return lines;
}

/** The platform may identify an author by a numeric id or a login; the signed-in handle is the login. */
const isAuthor = (c: Comment, handle: string): boolean => c.author.id === handle || c.author.name === handle;

export function createReviewActions(deps: ReviewActionsDeps): ReviewActions {
  const { sc, writer, store, repo, pr, sessionId } = deps;
  const now = deps.now ?? (() => new Date());

  const results = new Map<string, ReviewActionResult>();
  const inFlight = new Map<string, Promise<ReviewActionResult>>();
  let busy = false;

  const insert = (row: Omit<CoreWriteRecord, 'sessionId' | 'createdAt'>): void =>
    store.insertWriteRecord({ ...row, sessionId, createdAt: now().toISOString() });

  const postedCommentIds = (): Set<string> =>
    new Set(
      store
        .listWriteRecords(sessionId)
        .filter((r) => r.state === 'posted' && COMMENT_ACTIONS.has(r.action as WriteRecordAction) && r.platformId !== null)
        .map((r) => r.platformId as string),
    );

  function replayFromStore(requestId: string): ReviewActionResult | null {
    const rows = store.listWriteRecords(sessionId).filter((r) => r.intentId === requestId);
    const terminal = rows.find((r) => r.state !== 'pending');
    if (terminal === undefined) return null;
    if (terminal.state === 'failed') {
      throw new ReviewActionError((terminal.errorCode as ReviewActionErrorCode | null) ?? 'unavailable', terminal.errorMessage ?? 'The action failed earlier.');
    }
    return { record: { id: requestId, postedAt: terminal.createdAt, headSha: terminal.headSha } };
  }

  function planOf(a: ReviewActionBody['action'], expectedHead: string): Plan {
    switch (a.kind) {
      case 'approve':
        return { record: 'approve', cap: 'approve', text: a.body ?? null, destination: { scope: 'pr' }, run: (c) => writer.approve(repo, pr, c, a.body) };
      case 'request_changes':
        return { record: 'request_changes', cap: 'request_changes', text: a.body, destination: { scope: 'pr' }, run: (c) => writer.requestChanges(repo, pr, c, a.body) };
      case 'withdraw_decision':
        return { record: 'withdraw_decision', cap: 'withdraw_decision', text: null, destination: { scope: 'pr' }, run: () => writer.withdrawDecision(repo, pr) };
      case 'comment': {
        const text = a.body ?? '';
        switch (a.destination) {
          case 'pull_request':
            return { record: 'comment', cap: 'comment', text, destination: { scope: 'pr' }, run: () => writer.postComment(repo, pr, text) };
          case 'line': {
            const anchor = a.anchor;
            if (anchor === undefined) throw new ReviewActionError('invalid_body', 'A line comment needs an anchor.');
            return { record: 'comment', cap: 'line_comment', text, destination: { scope: 'line', anchor }, run: () => writer.postLineComment(repo, pr, { ...anchor, commit: expectedHead }, text) };
          }
          case 'reply': {
            const threadId = a.threadId;
            if (threadId === undefined) throw new ReviewActionError('invalid_body', 'A reply needs a thread.');
            return { record: 'reply_comment', cap: 'reply', text, destination: { scope: 'thread', thread_id: threadId }, run: () => writer.replyToThread(repo, pr, threadId, text) };
          }
          case 'edit': {
            const id = a.commentId;
            if (id === undefined) throw new ReviewActionError('invalid_body', 'An edit needs a comment.');
            return { record: 'edit_comment', cap: 'edit_comment', text, destination: { scope: 'comment', comment_id: id }, run: () => writer.editComment(repo, pr, id, text) };
          }
          case 'delete': {
            const id = a.commentId;
            if (id === undefined) throw new ReviewActionError('invalid_body', 'A delete needs a comment.');
            return { record: 'delete_comment', cap: 'delete_comment', text: null, destination: { scope: 'comment', comment_id: id }, run: () => writer.deleteComment(repo, pr, id) };
          }
        }
      }
    }
  }

  function validateText(a: ReviewActionBody['action']): void {
    if (a.kind === 'request_changes' && isEmpty(a.body)) {
      throw new ReviewActionError('invalid_body', 'Request changes needs a message.');
    }
    if (a.kind === 'comment' && a.destination !== 'delete' && isEmpty(a.body)) {
      throw new ReviewActionError('invalid_body', 'The comment is empty.');
    }
  }

  async function validateAnchor(anchor: Anchor, expectedHead: string): Promise<void> {
    if (anchor.commit !== expectedHead) throw new ReviewActionError('invalid_body', 'The comment position is from a different commit.');
    if (!Number.isInteger(anchor.startLine) || !Number.isInteger(anchor.endLine) || anchor.startLine < 1 || anchor.endLine < anchor.startLine) {
      throw new ReviewActionError('invalid_body', 'The line range is not valid.');
    }
    const files = await sc.listChangedFiles(repo, pr);
    if (!files.some((f) => f.path === anchor.path && !f.binary)) {
      throw new ReviewActionError('invalid_body', `${anchor.path} is not a changed file in this pull request.`);
    }
    const lines = commentableLines(await sc.getUnifiedDiff(repo, pr), anchor.path, anchor.side);
    if (lines === null) throw new ReviewActionError('invalid_body', `${anchor.path} has no diff to comment on.`);
    for (let n = anchor.startLine; n <= anchor.endLine; n += 1) {
      if (!lines.has(n)) throw new ReviewActionError('invalid_body', `Line ${n} is not in the diff of ${anchor.path} on the ${anchor.side} side.`);
    }
  }

  /** After an ambiguous failure of the same action: did the platform keep it? Returns the outcome if so. */
  async function readBack(plan: Plan, a: ReviewActionBody['action'], expectedHead: string, me: string): Promise<WriteOutcome | 'done' | null> {
    const rows = store.listWriteRecords(sessionId);
    const lastFailure = [...rows].reverse().find((r) => r.state === 'failed');
    if (lastFailure === undefined || lastFailure.errorCode !== 'unavailable' || lastFailure.action !== plan.record) return null;
    if (rows.some((r) => r.state === 'posted' && r.intentId !== lastFailure.intentId && r.createdAt > lastFailure.createdAt)) return null;

    if (a.kind === 'approve' || a.kind === 'request_changes' || a.kind === 'withdraw_decision') {
      const current = await sc.myDecision(repo, pr);
      const kind = a.kind === 'approve' ? 'approved' : a.kind === 'request_changes' ? 'changes_requested' : null;
      const kept = kind === null ? current === null : current !== null && current.kind === kind && current.commit === expectedHead;
      if (!kept) return null;
      return { kind: 'decision', decision: kind === null ? 'withdrawn' : kind, ...(current?.platformId ? { platformId: current.platformId } : {}), createdAt: current?.decidedAt ?? now().toISOString(), commit: expectedHead };
    }
    const list = await sc.listComments(repo, pr);
    if (a.kind !== 'comment') return null;
    if (a.destination === 'delete') return list.some((c) => c.id === a.commentId) ? null : 'done';
    if (a.destination === 'edit') {
      const c = list.find((x) => x.id === a.commentId);
      return c !== undefined && c.body === a.body ? { kind: 'comment', commentId: c.id, threadId: c.threadId, createdAt: c.createdAt, commit: expectedHead } : null;
    }
    const known = postedCommentIds();
    const found = list.find((c) => isAuthor(c, me) && c.body === a.body && !known.has(c.id));
    return found === undefined ? null : { kind: 'comment', commentId: found.id, threadId: found.threadId, createdAt: found.createdAt, commit: expectedHead };
  }

  function resultOf(plan: Plan, a: ReviewActionBody['action'], out: WriteOutcome | 'done' | void, me: string, expectedHead: string, requestId: string): ReviewActionResult {
    const record = { id: requestId, postedAt: now().toISOString(), headSha: expectedHead };
    if (out === undefined || out === 'done') return { record };
    if (out.kind === 'decision') {
      if (out.decision === 'withdrawn') return { decision: null, record };
      return {
        decision: {
          kind: out.decision,
          message: plan.text,
          commit: out.commit,
          decidedAt: out.createdAt,
          stale: false,
          platformId: out.platformId ?? null,
        },
        record,
      };
    }
    const comment: Comment = {
      id: out.commentId,
      threadId: out.threadId ?? out.commentId,
      author: { id: me, name: me },
      body: plan.text ?? '',
      createdAt: out.createdAt,
      editedAt: plan.record === 'edit_comment' ? out.createdAt : null,
      anchor: a.kind === 'comment' && a.destination === 'line' ? ((plan.destination as { anchor: Anchor }).anchor) : null,
      outdated: false,
      postedByTool: true,
    };
    return { comment, record };
  }

  async function run(request: ReviewActionBody): Promise<ReviewActionResult> {
    const { action, expectedHead, requestId } = request;
    validateText(action);
    const plan = planOf(action, expectedHead);

    if (busy) throw new ReviewActionError('in_flight', 'Another action on this pull request is still running.');
    busy = true;
    try {
      store.closeAbandonedWrites?.(sessionId, now().toISOString());

      const info = await sc.getPullRequest(repo, pr);
      if (info.state !== 'open') throw new ReviewActionError('conflict', 'This pull request is not open.');
      if (info.headCommit !== expectedHead) {
        throw new ReviewActionError('conflict', 'The pull request has new commits since you opened it. Reload to review the latest head. Nothing was posted.');
      }
      const me = (await sc.currentUser()).handle;
      console.error(`[review-action] ${action.kind} pr=${pr} state=${info.state} author=${info.author} me=${me} head=${info.headCommit.slice(0, 12)}`);
      if (info.author === me) throw new ReviewActionError('forbidden', 'You are the author of this pull request, so you cannot review it.');
      const capability = await sc.reviewCapability(repo, pr);
      const allowed = capability[plan.cap];
      console.error(`[review-action] capability ${plan.cap}: ${JSON.stringify(allowed)}`);
      if (!allowed.allowed) throw new ReviewActionError('forbidden', allowed.reason ?? 'This action is not available.');

      if (action.kind === 'comment' && action.destination === 'line' && action.anchor !== undefined) {
        await validateAnchor(action.anchor, expectedHead);
      }
      if (action.kind === 'comment' && (action.destination === 'edit' || action.destination === 'delete')) {
        const target = (await sc.listComments(repo, pr)).find((c) => c.id === action.commentId);
        if (target === undefined || !isAuthor(target, me) || !postedCommentIds().has(target.id)) {
          throw new ReviewActionError('forbidden', 'Only comments posted from this tool can be edited or deleted.');
        }
      }

      const found = await readBack(plan, action, expectedHead, me);
      const base = { intentId: requestId, action: plan.record, actor: me, destination: plan.destination, headSha: expectedHead, body: plan.text, errorCode: null, errorMessage: null };
      insert({ ...base, state: 'pending', platformId: null });

      let outcome: WriteOutcome | 'done' | void;
      try {
        outcome = found ?? (await plan.run(expectedHead));
      } catch (err) {
        const failure = toActionError(err);
        console.error(`[review-action] write failed: code=${failure.code} message=${failure.platformMessage ?? failure.message}`, err);
        insert({ ...base, state: 'failed', platformId: null, errorCode: failure.code, errorMessage: failure.platformMessage ?? failure.message });
        throw failure;
      }
      const platformId =
        outcome === undefined || outcome === 'done'
          ? (plan.destination as { comment_id?: string }).comment_id ?? null
          : outcome.kind === 'comment' ? outcome.commentId : (outcome.platformId ?? null);
      insert({ ...base, state: 'posted', platformId });
      const result = resultOf(plan, action, outcome, me, expectedHead, requestId);
      results.set(requestId, result);
      return result;
    } catch (err) {
      console.error(`[review-action] rejected: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      busy = false;
    }
  }

  async function perform(request: ReviewActionBody): Promise<ReviewActionResult> {
    const earlier = results.get(request.requestId);
    if (earlier !== undefined) return earlier;
    const running = inFlight.get(request.requestId);
    if (running !== undefined) return running;
    const replay = replayFromStore(request.requestId);
    if (replay !== null) return replay;
    const promise = run(request);
    inFlight.set(request.requestId, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(request.requestId);
    }
  }

  async function comments(): Promise<ReviewCommentItem[]> {
    const [list, me] = await Promise.all([sc.listComments(repo, pr), sc.currentUser()]);
    const known = postedCommentIds();
    return list.map((c) => {
      const own = known.has(c.id) && isAuthor(c, me.handle);
      return { ...c, postedByTool: own, editable: own };
    });
  }

  async function decision(): Promise<ReviewDecisionState> {
    const [info, me, current, platformCapability] = await Promise.all([
      sc.getPullRequest(repo, pr),
      sc.currentUser(),
      sc.myDecision(repo, pr),
      sc.reviewCapability(repo, pr),
    ]);
    let reason: string | undefined;
    if (info.state !== 'open') reason = `This pull request is not open (${info.state}).`;
    else if (info.author === me.handle) reason = 'You are the author of this pull request, so you cannot review it.';
    const canReview = reason === undefined ? { allowed: true } : { allowed: false, reason };
    const capability: ReviewCapability =
      reason === undefined
        ? platformCapability
        : Object.fromEntries(Object.keys(platformCapability).map((k) => [k, { allowed: false, reason }])) as unknown as ReviewCapability;
    const shown: ReviewDecision | null = current === null ? null : { ...current, stale: current.commit !== info.headCommit };
    return { decision: shown, canReview, capability };
  }

  return { perform, comments, decision };
}
