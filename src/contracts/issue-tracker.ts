// Neutral issue-tracker contract (contracts/provider-contracts.md, "IssueTracker").
// Core code depends only on this interface; each tracker's adapter under src/adapters/
// implements it (constitution VIII.1, VIII.2, VO-036). No method writes to the platform (FR-027).

import type { PlatformId, SignInCheck } from './shared.ts';

/**
 * The textual form a reference was written in: a project key such as `ABC-12`,
 * a bare `#123`, or a qualified `owner/repo#123`.
 */
export type IssueRefForm = 'project-key' | '#123' | 'owner/repo#123';

/** A reference found in text, before lookup. `key` is normalised, e.g. "ABC-12" or "owner/repo#123". */
export type RawIssueReference = {
  platform: PlatformId;
  key: string;
  form: IssueRefForm;
  /** The text as it was written where it was found, kept as the reference's origin (data-model "Issue reference"). */
  text: string;
  /**
   * True when the candidate is a reference only if lookup confirms the issue exists, such as a project key
   * whose project is not configured (FR-003). Core drops such a candidate when its lookup does not resolve.
   */
  needsConfirmation?: boolean;
};

export type IssueLookup =
  /** Description already converted to plain text (FR-004). */
  | { status: 'resolved'; kind: 'issue'; title: string; descriptionText: string; webUrl?: string }
  /** A `#123` that turned out to be a pull request (FR-003). */
  | { status: 'resolved'; kind: 'pull-request' }
  /** The adapter's own reason, e.g. that no access is configured for the tracker. */
  | { status: 'unresolved'; reason: string };

export interface IssueTracker {
  readonly id: PlatformId;
  /** Read-only call that confirms the stored credential works. */
  verifySignIn(): Promise<SignInCheck>;
  /**
   * Finds references in a branch name, PR title or description. Project-key trackers accept only
   * configured project keys without lookup; other keys need a lookup to confirm.
   */
  extractReferences(text: string): RawIssueReference[];
  /** One GET per key. Never throws for a missing issue; returns `unresolved` instead. */
  lookup(ref: RawIssueReference): Promise<IssueLookup>;
}
