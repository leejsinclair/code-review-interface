// Neutral source-control contract (contracts/provider-contracts.md, "SourceControlProvider").
// Core code depends only on this interface; each platform's adapter under src/adapters/
// implements it (constitution VIII.1, VIII.2, VO-036). No method writes to the platform (FR-027).

import type { PlatformId, SignInCheck } from './shared.ts';

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
  /** Normalised host/path forms matched against the clone's remotes. */
  cloneLocations(repo: RepoRef): string[];
  /**
   * The platform repository id for a remote already passed through `normaliseRemote` (`host/path`, no
   * scheme, user, port or `.git`, case-folded), or null when the remote is not on this platform (for a
   * self-hosted platform: not on its configured base address host). Pure, no network call. The inverse
   * of `cloneLocations` (feature 003 contracts 6.1).
   */
  repositoryForRemote(normalisedRemote: string): string | null;
  /** FR-001. */
  listOpenPullRequests(repo: RepoRef): Promise<PullRequestInfo[]>;
  /** FR-002, FR-052. A deleted PR rejects with AdapterError code `not_found`. */
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestInfo>;
  listCommits(repo: RepoRef, number: number): Promise<CommitInfo[]>;
  listChangedFiles(repo: RepoRef, number: number): Promise<ChangedFileInfo[]>;
  /** Used only when the head is not fetched locally (FR-038). */
  getUnifiedDiff(repo: RepoRef, number: number): Promise<string>;
  headLocation(repo: RepoRef, pr: PullRequestInfo): Promise<HeadLocation>;
  targetLocation(repo: RepoRef, pr: PullRequestInfo): Promise<HeadLocation>;
}
