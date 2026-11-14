// Neutral source-control WRITE contract (specs/005-review-actions/contracts/writer.md).
// Kept apart from SourceControlProvider, which stays read-only. No method merges, declines
// or closes a pull request (constitution II.1, FR-012).

import type { RepoRef } from './source-control.ts';

/** A pull request is identified by its number within the repository, as in the read contract. */
export type PullRequestRef = number;

/** Neutral comment position. `endLine` equals `startLine` for a single line. */
export interface Anchor {
  path: string;
  side: 'base' | 'head';
  startLine: number;
  endLine: number;
  /** Head commit the comment is made on. */
  commit: string;
}

export type WriteOutcome =
  | { kind: 'comment'; commentId: string; threadId?: string; createdAt: string; commit: string }
  | {
      kind: 'decision';
      decision: 'approved' | 'changes_requested' | 'withdrawn';
      platformId?: string;
      /**
       * Outcome of the optional message sent with the decision. The decision is written first;
       * a failed message leaves the decision made and resolves with `posted: false` (FR-011).
       */
      message?: { posted: true; commentId: string } | { posted: false; reason: string };
      createdAt: string;
      commit: string;
    };

export interface ActionCapability {
  allowed: boolean;
  /** Required when `allowed` is false; shown as is. */
  reason?: string;
}

export interface ReviewCapability {
  comment: ActionCapability;
  line_comment: ActionCapability;
  reply: ActionCapability;
  edit_comment: ActionCapability;
  delete_comment: ActionCapability;
  approve: ActionCapability;
  request_changes: ActionCapability;
  withdraw_decision: ActionCapability;
}

/** Read model returned by SourceControlProvider.listComments (data-model.md). */
export interface Comment {
  id: string;
  /** Id of the thread root; equals `id` for a root comment. */
  threadId: string;
  /** True for the comment that opens its thread; a thread whose opener was deleted has none (FR-012). */
  startsThread: boolean;
  /** `id` is the platform id, `name` the display name, `handle` the form of `CurrentUser.handle` (FR-001). */
  author: { id: string; name: string; handle: string };
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Null means a comment on the whole pull request. */
  anchor: Anchor | null;
  /** True when the anchored line is gone at the latest head. */
  outdated: boolean;
  /** Derived by core from write_record and the signed-in user; adapters set false. */
  postedByTool: boolean;
}

/** The signed-in reviewer's own current decision (data-model.md). Not readiness. */
export interface ReviewDecision {
  kind: 'approved' | 'changes_requested';
  message: string | null;
  commit: string;
  decidedAt: string;
  /** True when `commit` is not the current head. */
  stale: boolean;
  platformId: string | null;
}

/**
 * Decisions: where a platform records no commit for a decision, the decision stands on the
 * current head at the time it is made (FR-020); core ties it to the viewed commit through the
 * `expectedHead` refusal and the commit stored on the write record.
 */
export interface SourceControlWriter {
  postComment(repo: RepoRef, pr: PullRequestRef, body: string): Promise<WriteOutcome>;
  postLineComment(repo: RepoRef, pr: PullRequestRef, anchor: Anchor, body: string): Promise<WriteOutcome>;
  replyToThread(repo: RepoRef, pr: PullRequestRef, threadId: string, body: string): Promise<WriteOutcome>;
  editComment(repo: RepoRef, pr: PullRequestRef, commentId: string, body: string): Promise<WriteOutcome>;
  deleteComment(repo: RepoRef, pr: PullRequestRef, commentId: string): Promise<void>;
  approve(repo: RepoRef, pr: PullRequestRef, commit: string, body?: string): Promise<WriteOutcome>;
  requestChanges(repo: RepoRef, pr: PullRequestRef, commit: string, body: string): Promise<WriteOutcome>;
  /**
   * Withdraws the signed-in reviewer's decision. When there is none to withdraw, rejects with
   * `conflict` on every platform and sends no write (FR-012).
   */
  withdrawDecision(repo: RepoRef, pr: PullRequestRef): Promise<WriteOutcome>;
}
