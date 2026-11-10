// T013 (FR-023, FR-025): the neutral seeding surface for live tests.
//
// Tests call only this interface to create and tear down platform data. Names
// and arguments mention no platform. `GitlabSeeder` (test/seeder/gitlab-seeder.ts)
// is the only implementation; it uses the root token on plain `fetch` and the
// git CLI, and never imports `src/adapters/` or the read-only layer (FR-024).

/** One file change in a pushed commit. Bytes mark a binary file. */
export type FileChange =
  | { kind: 'add'; path: string; content: string | Uint8Array }
  | { kind: 'edit'; path: string; content: string | Uint8Array }
  | { kind: 'rename'; from: string; to: string; content?: string | Uint8Array }
  | { kind: 'delete'; path: string };

/** A project the run created. `id` is the full path, the adapter's repository id. */
export type SeededRepo = {
  /** Full path, `<namespace>/<run name>-<label>`. */
  id: string;
  /** Platform-side numeric or opaque id, for the seeder's own calls. */
  platformId: number;
  kind: 'review' | 'fork' | 'hidden';
  httpUrl: string;
  sshUrl: string;
  defaultBranch: string;
  /** Paths held before `renameRepository`, oldest first. */
  previousPaths: string[];
};

export type SeededPullState = 'open' | 'closed' | 'merged' | 'deleted';

/** A pull request the run opened; its fields are the contract suite's expected values. */
export type SeededPull = {
  /** The base project. */
  repo: SeededRepo;
  /** The fork for a fork pull request, else `repo`. */
  sourceRepo: SeededRepo;
  /** The pull request number within `repo`. */
  number: number;
  sourceBranch: string;
  targetBranch: string;
  headCommit: string;
  title: string;
  description: string;
  author: string;
  webUrl: string;
  state: SeededPullState;
};

/** An issue the run created. A hidden issue lives where the reviewer cannot see it. */
export type SeededIssue = {
  repo: SeededRepo;
  number: number;
  title: string;
  description: string;
  webUrl: string;
  visibility: 'visible' | 'hidden';
};

/** The unit of cleanup: everything one suite creates. */
export type SeededRun = {
  /** `it-<suite>-<UTC yyyymmddhhmmssSSS>`. */
  name: string;
  /** The platform address, loopback only. */
  baseUrl: string;
  /** The run's non-administrator reviewer user; its username equals `name`. */
  reviewer: { username: string; token: string };
  /** Every project created so far, including forks and the hidden project. */
  repositories: SeededRepo[];
  /** ISO 8601 UTC. */
  startedAt: string;
};

export interface PlatformSeeder {
  /** Creates the run user `it-<suite>-<timestamp>` and its reviewer token. */
  begin(suite: string): Promise<SeededRun>;
  /** Deletes only this run's projects and user; logs leftovers. */
  cleanup(): Promise<void>;
  createRepository(name: string): Promise<SeededRepo>;
  deleteRepository(repo: SeededRepo): Promise<void>;
  renameRepository(repo: SeededRepo, newName: string): Promise<SeededRepo>;
  forkRepository(repo: SeededRepo): Promise<SeededRepo>;
  /** Returns the new commit sha. */
  pushCommit(repo: SeededRepo, branch: string, changes: FileChange[]): Promise<string>;
  openPullRequest(
    repo: SeededRepo,
    input: { source: string; target: string; title: string; description?: string; sourceRepo?: SeededRepo },
  ): Promise<SeededPull>;
  updatePullRequest(pull: SeededPull, input: { title?: string; description?: string }): Promise<SeededPull>;
  closePullRequest(pull: SeededPull): Promise<void>;
  reopenPullRequest(pull: SeededPull): Promise<void>;
  mergePullRequest(pull: SeededPull): Promise<void>;
  deletePullRequest(pull: SeededPull): Promise<void>;
  createIssue(repo: SeededRepo, input: { title: string; description?: string }): Promise<SeededIssue>;
  /** In a run project the reviewer cannot see. */
  createHiddenIssue(input: { title: string }): Promise<SeededIssue>;
  createReviewerToken(): Promise<string>;
  revokeReviewerToken(token: string): Promise<void>;
  /** Other runs' `it-*` items; never deletes (FR-045). */
  listLeftovers(): Promise<{ projects: string[]; users: string[] }>;
}
