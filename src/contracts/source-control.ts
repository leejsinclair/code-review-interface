// Neutral source-control contract (contracts/provider-contracts.md, "SourceControlProvider").
// Core code depends only on this interface; each platform's adapter under src/adapters/
// implements it (constitution VIII.1, VIII.2, VO-036). No method writes to the platform (FR-027); writes live in SourceControlWriter (feature 005).

import type { PlatformId, SignInCheck } from './shared.ts';
import type { Comment, ReviewCapability, ReviewDecision } from './source-control-writer.ts';

/** A repository on a source-control platform. `id` is the platform's path form, e.g. "owner/repo" or "workspace/repo". */
export type RepoRef = { platform: PlatformId; id: string };

export type PrState = 'open' | 'closed' | 'merged';

export type PullRequestInfo = {
  number: number;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  headCommit: string;
  state: PrState;
  /** ISO 8601. */
  updatedAt: string;
};

/** Who the signed-in reviewer is on the platform (feature 004, FR-020). Audit data only (constitution VII.2). */
export type CurrentUser = { handle: string; displayName: string };

export type CommitInfo = { sha: string; message: string; author: string; authoredAt: string };

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export type ChangedFileInfo = {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  linesAdded: number;
  linesRemoved: number;
  binary: boolean;
};

/**
 * Where a commit can be fetched from (R10): one remote URL per scheme (ssh, https) and the ref to fetch.
 * The workspace manager picks the URL whose scheme matches the reviewer's clone.
 */
export type HeadLocation = { remoteUrls: string[]; ref: string };

export interface SourceControlProvider {
  readonly id: PlatformId;
  /** Read-only call that confirms the stored credential works. */
  verifySignIn(): Promise<SignInCheck>;
  /**
   * The signed-in reviewer: a stable handle and a display name (the handle when the platform has no name).
   * One read-only GET, never cached. Rejects with an AdapterError `unauthorized` or `unavailable`. Used to
   * record who lowered a Critical class (feature 004) and reused by feature 008.
   */
  currentUser(): Promise<CurrentUser>;
  /** Normalised host/path forms matched against the clone's remotes. */
  cloneLocations(repo: RepoRef): string[];
  /**
   * The platform repository id for a remote already passed through `normaliseRemote` (`host/path`, no
   * scheme, user, port or `.git`, case-folded), or null when the remote is not on this platform (for a
   * self-hosted platform: not on its configured base address host). Pure, no network call. The inverse
   * of `cloneLocations` (feature 003 contracts 6.1).
   */
  repositoryForRemote(normalisedRemote: string): string | null;
  /** The pull request's page on the platform, for a person to open in a browser. Pure, no network call. */
  pullRequestUrl(repo: RepoRef, number: number): string;
  /** FR-001. */
  listOpenPullRequests(repo: RepoRef): Promise<PullRequestInfo[]>;
  /**
   * Which of these open PRs the signed-in reviewer has already approved (an approval later withdrawn,
   * dismissed or overridden by a change request does not count). Read-only.
   */
  approvedByMe(repo: RepoRef, numbers: readonly number[]): Promise<Set<number>>;
  /** FR-002, FR-052. A deleted PR rejects with AdapterError code `not_found`. */
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestInfo>;
  listCommits(repo: RepoRef, number: number): Promise<CommitInfo[]>;
  listChangedFiles(repo: RepoRef, number: number): Promise<ChangedFileInfo[]>;
  /** Used only when the head is not fetched locally (FR-038). */
  getUnifiedDiff(repo: RepoRef, number: number): Promise<string>;
  headLocation(repo: RepoRef, pr: PullRequestInfo): Promise<HeadLocation>;
  targetLocation(repo: RepoRef, pr: PullRequestInfo): Promise<HeadLocation>;
  /** Feature 005: the PR's comments, with thread id, anchor and outdated flag. Read-only. */
  listComments(repo: RepoRef, number: number): Promise<Comment[]>;
  /** Feature 005: the signed-in reviewer's own current decision on the PR, or null. Not readiness. Read-only. */
  myDecision(repo: RepoRef, number: number): Promise<ReviewDecision | null>;
  /** Feature 005: per-action eligibility with a reason, computed server-side. Read-only. */
  reviewCapability(repo: RepoRef, number: number): Promise<ReviewCapability>;
}
