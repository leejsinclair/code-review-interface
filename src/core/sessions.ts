// Review sessions: start, open, refresh, close and delete (FR-005 to FR-011, FR-036 to FR-038,
// FR-041, FR-042, FR-044, FR-052; plan "Call paths" and "States").
//
// Every source is called on its own and a failure becomes a visible gap (FR-032): commits, the fetch,
// the diff, references and each issue lookup. Only the platform's PR itself is required to start a
// session. A snapshot is appended with everything under it in one transaction, and only at start and
// on a refresh that finds a new head or a previous failed fetch (FR-052). `onSnapshot` is called only
// once the snapshot has an isolated workspace (FR-005), which is what queues its summaries.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  ChangedFile as WireChangedFile,
  PullGroup,
  PullSummary,
  SessionDetail,
  SessionSummary,
  SnapshotDetail,
  SnapshotSummary,
} from '../contracts/http.ts';
import type { IssueLookup, IssueTracker } from '../contracts/issue-tracker.ts';
import { AdapterError } from '../contracts/shared.ts';
import type { PullRequestInfo, RepoRef, SourceControlProvider } from '../contracts/source-control.ts';
import type { RepositoryManager } from '../repo/manager.ts';
import { diffFingerprint, parseUnifiedDiff, type DiffFile } from '../repo/unified-diff.ts';
import type {
  ChangedFile,
  Commit,
  IssueReference,
  PrRef,
  PrSnapshot,
  ReviewStore,
  SessionStatus,
} from '../store/review-store.ts';
import { readCompleteness, readSkippedFiles, skipReason } from './completeness.ts';
import { issueEvidence, issueId, lookupIssues } from './evidence.ts';
import { excludedReason, type Limits } from './limits.ts';
import { collectReferences, type CollectedReference } from './references.ts';

/** One repository's environment (R13): its adapters and the matched clone found under the base folder. */
export type SessionEnvironment = {
  sourceControl: SourceControlProvider;
  /** Created with this repository, so a tracker that reads the repository's own issues uses it (FR-058). */
  tracker: IssueTracker;
  repository: RepoRef;
  /** The matched clone, looked up at use and never stored; null when the repository is not matched now. */
  clonePath: string | null;
  /** Why there is no clone (FR-057); present only when `clonePath` is null. */
  unavailableReason?: string;
  limits: Limits;
};

export type SessionsDeps = {
  store: ReviewStore;
  manager: RepositoryManager;
  /** The configured platforms and the repository's clone; may throw when nothing is configured. */
  environmentFor: (repo: RepoRef) => SessionEnvironment | Promise<SessionEnvironment>;
  /** The repositories matched under the base folder now (for the dashboard); default none. */
  matched?: () => RepoRef[];
  /** Whether the workspace has a clone for the repository now; default available. */
  availability?: (repo: RepoRef) => { available: true } | { available: false; reason: string };
  /** A snapshot with an isolated workspace was taken (its summaries can be queued). */
  onSnapshot?: (sessionId: string, snapshotId: string) => void;
  /** The session was closed or deleted. */
  onClose?: (sessionId: string) => void;
  /** Resolves when the work running for the session now has ended; a refresh keeps older worktrees until then (FR-051). */
  afterRunning?: (sessionId: string) => Promise<void>;
  /** A platform call failed where the failure is a gap (so a rejected sign-in can be noted). */
  onPlatformError?: (error: unknown) => void;
  now?: () => Date;
  newId?: () => string;
};

export type SessionErrorCode = 'not_found' | 'read_only' | 'confirmation_required' | 'repository_unavailable';

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export interface Sessions {
  /** One group per matched repository (or just `repository`); one failing never fails the others (FR-054). */
  listPulls(repository?: string): Promise<PullGroup[]>;
  list(): SessionSummary[];
  detail(sessionId: string): SessionDetail;
  snapshot(sessionId: string, snapshotId: string): SnapshotDetail;
  start(repo: RepoRef, prNumber: number): Promise<{ created: boolean; detail: SessionDetail }>;
  open(sessionId: string): Promise<SessionDetail>;
  refresh(sessionId: string): Promise<SessionDetail>;
  close(sessionId: string): Promise<void>;
  delete(sessionId: string, options: { confirm?: unknown }): Promise<void>;
  changedBetween(sessionId: string, fromSnapshotId: string, toSnapshotId: string): Promise<string[]>;
}

export const REOPENED_NOTE = 'reopened on platform';
export const DELETED_NOTE = 'deleted on platform';

const LANGUAGES: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.json': 'JSON', '.md': 'Markdown', '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin', '.go': 'Go',
  '.rb': 'Ruby', '.rs': 'Rust', '.cs': 'C#', '.php': 'PHP', '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML',
  '.sql': 'SQL', '.yml': 'YAML', '.yaml': 'YAML', '.xml': 'XML', '.sh': 'Shell', '.swift': 'Swift',
};

export const NO_CLONE_MESSAGE = 'The repository is not found under the base folder.';

/** The clone path, or a `repository_unavailable` refusal carrying the reason (FR-057). */
function requireClone(env: SessionEnvironment): string {
  if (env.clonePath === null) throw new SessionError('repository_unavailable', env.unavailableReason ?? NO_CLONE_MESSAGE);
  return env.clonePath;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function checkError(error: unknown): string {
  if (error instanceof AdapterError && error.code === 'unauthorized') return `the platform rejected the sign-in for ${error.platform}`;
  return `the platform could not be reached: ${message(error)}`;
}

type Gathered = {
  snapshot: PrSnapshot;
  commits: Commit[];
  files: ChangedFile[];
  references: IssueReference[];
  lookups: Map<string, IssueLookup>;
};

export function createSessions(deps: SessionsDeps): Sessions {
  const { store, manager } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();
  const gap = (error: unknown): void => deps.onPlatformError?.(error);

  const prRefOf = (repo: RepoRef, number: number): PrRef => ({
    repo: { platform: repo.platform, identifier: repo.id.toLowerCase() },
    number,
  });

  const requireSession = (sessionId: string) => {
    const session = store.readSession(sessionId);
    const status = store.readSessionStatus(sessionId);
    const latest = store.readLatestSnapshot(sessionId);
    if (session === null || status === null || latest === null) throw new SessionError('not_found', 'No such session.');
    return { session, status, latest };
  };

  // ------------------------------------------------------------ snapshot

  const gather = async (env: SessionEnvironment, sessionId: string, snapshotId: string, seq: number, pr: PullRequestInfo): Promise<Gathered> => {
    const { sourceControl: sc, repository: repo } = env;
    const clonePath = requireClone(env);

    let commits: Commit[] = [];
    try {
      commits = (await sc.listCommits(repo, pr.number)).map((c, ordinal) => ({
        snapshotId,
        ordinal,
        sha: c.sha,
        authorName: c.author,
        message: c.message,
        committedAt: c.authoredAt,
      }));
    } catch (error) {
      gap(error);
    }

    // The fetch: only when a clone matches, so no platform call is spent on a missing clone.
    let fetched: Awaited<ReturnType<RepositoryManager['fetchSnapshot']>>;
    const cloneLocations = sc.cloneLocations(repo);
    const match = await manager.matchClone(clonePath, cloneLocations);
    if (!match.ok) {
      fetched = { status: 'missing', reason: match.reason };
    } else {
      try {
        const [head, target] = await Promise.all([sc.headLocation(repo, pr), sc.targetLocation(repo, pr)]);
        fetched = await manager.fetchSnapshot({
          clonePath,
          cloneLocations,
          sessionId,
          snapshotId,
          head,
          target,
          expectedHead: pr.headCommit,
        });
      } catch (error) {
        gap(error);
        fetched = { status: 'missing', reason: `fetch failed: ${message(error)}` };
      }
    }

    let local: { baseCommit: string; targetCommit: string; headRef: string; targetRef: string } | null = null;
    let repositoryReason: string | null = fetched.status === 'missing' ? fetched.reason : null;
    let diffFiles: Array<DiffFile & { sizeBytes: number | null }> = [];
    let fingerprint = '';
    if (fetched.status === 'found') {
      try {
        const diff = await manager.localDiff(clonePath, fetched.targetCommit, fetched.headCommit);
        diffFiles = diff.files;
        fingerprint = diff.fingerprint;
        local = { baseCommit: diff.baseCommit, targetCommit: fetched.targetCommit, headRef: fetched.headRef, targetRef: fetched.targetRef };
      } catch (error) {
        repositoryReason = `diff failed: ${message(error)}`;
      }
    }
    if (local === null) {
      try {
        diffFiles = parseUnifiedDiff(await sc.getUnifiedDiff(repo, pr.number)).map((f) => ({ ...f, sizeBytes: null }));
      } catch (error) {
        gap(error);
        diffFiles = [];
      }
      fingerprint = diffFingerprint(diffFiles);
    }

    const files: ChangedFile[] = diffFiles.map((f, ordinal) => ({
      snapshotId,
      ordinal,
      path: f.path,
      oldPath: f.status === 'renamed' || f.status === 'copied' ? f.oldPath : null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      binary: f.binary,
      sizeBytes: f.sizeBytes,
      language: LANGUAGES[extname(f.path).toLowerCase()] ?? null,
      patch: f.binary ? null : f.patch,
      excludedReason: excludedReason(f, env.limits),
    }));

    let collected: CollectedReference[] = [];
    try {
      collected = await collectReferences(env.tracker, { branch: pr.sourceBranch, title: pr.title, description: pr.description });
    } catch (error) {
      gap(error);
    }

    const repoRef = prRefOf(repo, pr.number).repo;
    const snapshot: PrSnapshot = {
      id: snapshotId,
      sessionId,
      seq,
      takenAt: now(),
      headCommit: pr.headCommit,
      title: pr.title,
      description: pr.description,
      author: pr.author,
      // simplified: the contract's PullRequestInfo does not name a fork, so both branches carry the
      // base repository; when cross-PR grouping needs forks, add the source repository to the contract.
      sourceBranch: { repo: repoRef, name: pr.sourceBranch },
      targetBranch: { repo: repoRef, name: pr.targetBranch },
      targetCommit: local?.targetCommit ?? null,
      baseCommit: local?.baseCommit ?? null,
      diffSource: local === null ? 'platform' : 'local',
      diffFingerprint: fingerprint,
      repositoryStatus: local === null ? 'missing' : 'found',
      repositoryReason: local === null ? (repositoryReason ?? 'repository not available') : null,
      headRef: local?.headRef ?? null,
      targetRef: local?.targetRef ?? null,
    };
    return {
      snapshot,
      commits,
      files,
      references: collected.map((r) => ({ snapshotId, issue: r.issue, kind: r.kind, origins: r.origins })),
      lookups: new Map(collected.map((r) => [issueId(r.issue), r.lookup])),
    };
  };

  /** Appends a gathered snapshot, its children and its issue Evidence in one transaction. */
  const appendSnapshot = async (env: SessionEnvironment, g: Gathered, before?: () => void): Promise<void> => {
    const lookups = await lookupIssues(env.tracker, g.references, g.lookups);
    store.transaction(() => {
      before?.();
      store.appendSnapshot(g.snapshot);
      for (const commit of g.commits) store.appendCommit(commit);
      for (const file of g.files) store.appendChangedFile(file);
      for (const reference of g.references) store.appendIssueReference(reference);
      for (const evidence of issueEvidence(store, {
        sessionId: g.snapshot.sessionId,
        snapshotId: g.snapshot.id,
        commit: g.snapshot.headCommit,
        capturedAt: now(),
        references: g.references,
        lookups,
        newId,
      })) {
        store.appendEvidence(evidence);
      }
    });
  };

  /** Creates the snapshot's workspace when its head was fetched; true when one exists. */
  const ensureWorkspace = async (env: SessionEnvironment, snapshot: PrSnapshot): Promise<boolean> => {
    if (snapshot.repositoryStatus !== 'found' || env.clonePath === null) return false;
    try {
      await manager.createWorkspace(env.clonePath, snapshot.sessionId, snapshot.id, snapshot.headCommit);
      return true;
    } catch {
      return false;
    }
  };

  const workspaceNames = (sessionId: string): Promise<string[]> =>
    readdir(join(manager.workspacesDir, sessionId)).catch(() => [] as string[]);

  // Without a clone (the repository is not found now) a worktree cannot be removed through git, so its
  // folder under the application-data workspaces is deleted instead; the clone's own record of it goes
  // when the clone does.
  const removeNamed = async (clonePath: string | null, sessionId: string, names: string[]): Promise<void> => {
    for (const name of names) {
      const path = join(manager.workspacesDir, sessionId, name);
      if (clonePath === null) await rm(path, { recursive: true, force: true });
      else await manager.removeWorkspace(clonePath, path);
    }
  };

  const removeWorkspaces = async (clonePath: string | null, sessionId: string): Promise<void> =>
    removeNamed(clonePath, sessionId, await workspaceNames(sessionId));

  // Work already running on an older snapshot finishes against its own worktree (FR-051), so the
  // worktrees older at this moment go once that work ends. Close, delete and the start-up sweep
  // remove whatever is left.
  const retireOlderWorkspaces = async (clonePath: string | null, sessionId: string, keep: string): Promise<void> => {
    const older = (await workspaceNames(sessionId)).filter((name) => name !== keep);
    if (deps.afterRunning === undefined) return removeNamed(clonePath, sessionId, older);
    void deps
      .afterRunning(sessionId)
      .then(() => removeNamed(clonePath, sessionId, older))
      .catch(() => undefined);
  };

  // ------------------------------------------------------------ platform check (FR-052)

  const checkPlatform = async (env: SessionEnvironment, sessionId: string, opened: boolean) => {
    const { session, status } = requireSession(sessionId);
    const at = now();
    let next: SessionStatus;
    let pr: PullRequestInfo | null = null;
    try {
      pr = await env.sourceControl.getPullRequest(env.repository, session.pr.number);
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'not_found') {
        next = {
          ...status,
          prStatus: status.prStatus === 'open' ? 'closed' : status.prStatus,
          statusNote: DELETED_NOTE,
          lastCheckedAt: at,
          lastCheckOutcome: 'ok',
          lastCheckError: null,
        };
      } else {
        gap(error);
        next = { ...status, lastCheckedAt: at, lastCheckedHead: null, lastCheckOutcome: 'unreachable', lastCheckError: checkError(error) };
      }
    }
    if (pr !== null) {
      // Once closed or merged a session never returns to open (FR-041).
      const reopened = status.prStatus !== 'open' && pr.state === 'open';
      next = {
        ...status,
        prStatus: status.prStatus === 'open' || pr.state !== 'open' ? pr.state : status.prStatus,
        statusNote: reopened ? REOPENED_NOTE : status.statusNote,
        lastCheckedAt: at,
        lastCheckedHead: pr.headCommit,
        lastCheckOutcome: 'ok',
        lastCheckError: null,
      };
    }
    if (opened) next = { ...next!, lastOpenedAt: at };
    store.upsertSessionStatus(next!);
    return { status: next!, pr };
  };

  // ------------------------------------------------------------ reads

  const summaryOf = (sessionId: string): SessionSummary => {
    const { session, status, latest } = requireSession(sessionId);
    const out: SessionSummary = {
      sessionId,
      platform: session.pr.repo.platform,
      repository: session.pr.repo.identifier,
      prNumber: session.pr.number,
      title: latest.title,
      prStatus: status.prStatus,
      readOnly: status.prStatus !== 'open',
      latestHeadCommit: latest.headCommit,
      createdAt: session.createdAt,
      lastOpenedAt: status.lastOpenedAt,
      repositoryAvailable: true,
    };
    if (status.statusNote !== null) out.statusNote = status.statusNote;
    const availability = deps.availability?.({ platform: session.pr.repo.platform, id: session.pr.repo.identifier }) ?? { available: true as const };
    out.repositoryAvailable = availability.available;
    if (!availability.available) out.repositoryReason = availability.reason;
    return out;
  };

  const snapshotSummary = (s: PrSnapshot): SnapshotSummary => {
    const out: SnapshotSummary = { snapshotId: s.id, headCommit: s.headCommit, diffSource: s.diffSource, diffFingerprint: s.diffFingerprint, takenAt: s.takenAt };
    if (s.baseCommit !== null) out.baseCommit = s.baseCommit;
    return out;
  };

  const detail = (sessionId: string): SessionDetail => {
    const { status, latest } = requireSession(sessionId);
    const completeness = readCompleteness(store, sessionId);
    if (completeness === null) throw new SessionError('not_found', 'No such session.');
    const out: SessionDetail = {
      ...summaryOf(sessionId),
      author: latest.author,
      description: latest.description,
      sourceBranch: latest.sourceBranch.name,
      targetBranch: latest.targetBranch.name,
      headMoved: status.lastCheckOutcome === 'ok' && status.lastCheckedHead !== null && status.lastCheckedHead !== latest.headCommit,
      workspaceReady: latest.repositoryStatus === 'found' && existsSync(join(manager.workspacePath(sessionId, latest.id), '.git')),
      completeness: completeness.completeness,
      issues: completeness.issues,
      snapshots: store.listSnapshots(sessionId).map(snapshotSummary),
    };
    if (status.lastCheckOutcome === 'ok' && status.lastCheckedHead !== null) out.platformHeadCommit = status.lastCheckedHead;
    return out;
  };

  const sessionFor = (repo: RepoRef, prNumber: number) => store.findSessionByPr(prRefOf(repo, prNumber));

  const repoOfSession = (sessionId: string): RepoRef => {
    const { session } = requireSession(sessionId);
    return { platform: session.pr.repo.platform, id: session.pr.repo.identifier };
  };

  // ------------------------------------------------------------ the service

  const open = async (sessionId: string): Promise<SessionDetail> => {
    const env = await deps.environmentFor(repoOfSession(sessionId));
    const { status } = await checkPlatform(env, sessionId, true);
    const latest = store.readLatestSnapshot(sessionId);
    if (status.prStatus === 'open' && latest !== null) await ensureWorkspace(env, latest);
    return detail(sessionId);
  };

  return {
    async listPulls(repository) {
      const matched = deps.matched?.() ?? [];
      const wanted = repository?.toLowerCase();
      const repos = wanted === undefined ? matched : matched.filter((r) => r.id.toLowerCase() === wanted);
      if (wanted !== undefined && repos.length === 0) throw new SessionError('not_found', 'No such repository under the base folder.');
      return Promise.all(
        repos.map(async (repo): Promise<PullGroup> => {
          try {
            const env = await deps.environmentFor(repo);
            const prs = await env.sourceControl.listOpenPullRequests(repo);
            const pulls: PullSummary[] = [];
            for (const pr of prs) {
              const summary: PullSummary = {
                repository: repo.id,
                number: pr.number,
                title: pr.title,
                author: pr.author,
                sourceBranch: pr.sourceBranch,
                targetBranch: pr.targetBranch,
                updatedAt: pr.updatedAt,
              };
              const session = sessionFor(repo, pr.number);
              if (session !== null) summary.sessionId = session.id;
              pulls.push(summary);
            }
            return { repository: repo.id, status: 'loaded', pulls };
          } catch (error) {
            // A rejected sign-in refuses the whole call (signin_required); anything else is this group's failure (V.4).
            if (error instanceof AdapterError && error.code === 'unauthorized') throw error;
            const why = error instanceof AdapterError ? `The platform could not be reached (${error.code}).` : message(error);
            return { repository: repo.id, status: 'failed', reason: why, pulls: [] };
          }
        }),
      );
    },

    list: () => store.listSessions().map((s) => summaryOf(s.id)),

    detail,

    snapshot(sessionId, snapshotId) {
      const s = store.readSnapshot(snapshotId);
      if (s === null || s.sessionId !== sessionId) throw new SessionError('not_found', 'No such snapshot.');
      const files = store.listChangedFiles(snapshotId).map((f): WireChangedFile => {
        const out: WireChangedFile = { path: f.path, status: f.status, linesAdded: f.additions, linesRemoved: f.deletions, binary: f.binary };
        if (f.oldPath !== null) out.previousPath = f.oldPath;
        if (f.language !== null) out.language = f.language;
        const skipped = skipReason(f.excludedReason);
        if (skipped !== undefined) out.skipped = skipped;
        return out;
      });
      return {
        ...snapshotSummary(s),
        commits: store.listCommits(snapshotId).map((c) => ({ sha: c.sha, message: c.message, author: c.authorName, authoredAt: c.committedAt })),
        files,
        skippedFiles: readSkippedFiles(store, snapshotId),
      };
    },

    async start(repo, prNumber) {
      const env = await deps.environmentFor(repo);
      requireClone(env);
      const existing = sessionFor(env.repository, prNumber);
      if (existing !== null) return { created: false, detail: await open(existing.id) };

      const pr = await env.sourceControl.getPullRequest(env.repository, prNumber);
      if (pr.state !== 'open') throw new SessionError('read_only', `PR #${prNumber} is ${pr.state}; a session starts only on an open PR.`);
      const sessionId = newId();
      const gathered = await gather(env, sessionId, newId(), 1, pr);
      const at = now();
      await appendSnapshot(env, gathered, () => {
        store.appendSession({ id: sessionId, pr: prRefOf(env.repository, prNumber), createdAt: at });
        store.upsertSessionStatus({
          sessionId,
          prStatus: 'open',
          statusNote: null,
          lastCheckedAt: at,
          lastCheckedHead: pr.headCommit,
          lastCheckOutcome: 'ok',
          lastCheckError: null,
          lastOpenedAt: at,
        });
      });
      if (await ensureWorkspace(env, gathered.snapshot)) deps.onSnapshot?.(sessionId, gathered.snapshot.id);
      return { created: true, detail: detail(sessionId) };
    },

    open,

    async refresh(sessionId) {
      const env = await deps.environmentFor(repoOfSession(sessionId));
      requireClone(env);
      const { status, pr } = await checkPlatform(env, sessionId, false);
      if (status.prStatus !== 'open') {
        const note = status.statusNote === null ? '' : ` (${status.statusNote})`;
        throw new SessionError('read_only', `The PR is ${status.prStatus}${note}; the session is read-only.`);
      }
      const latest = requireSession(sessionId).latest;
      if (pr !== null && (pr.headCommit !== latest.headCommit || latest.repositoryStatus === 'missing')) {
        const gathered = await gather(env, sessionId, newId(), latest.seq + 1, pr);
        await appendSnapshot(env, gathered);
        await retireOlderWorkspaces(env.clonePath, sessionId, gathered.snapshot.id);
        if (await ensureWorkspace(env, gathered.snapshot)) deps.onSnapshot?.(sessionId, gathered.snapshot.id);
      } else {
        // Same head: no snapshot, but the issues are re-fetched (FR-011).
        const references = store.listIssueReferences(latest.id);
        const lookups = await lookupIssues(env.tracker, references);
        store.transaction(() => {
          for (const evidence of issueEvidence(store, {
            sessionId,
            snapshotId: latest.id,
            commit: latest.headCommit,
            capturedAt: now(),
            references,
            lookups,
            newId,
          })) {
            store.appendEvidence(evidence);
          }
        });
      }
      return detail(sessionId);
    },

    async close(sessionId) {
      const env = await deps.environmentFor(repoOfSession(sessionId));
      await removeWorkspaces(env.clonePath, sessionId);
      deps.onClose?.(sessionId);
    },

    async delete(sessionId, options) {
      if (options.confirm !== true) throw new SessionError('confirmation_required', 'Deleting a session needs confirm: true.');
      const env = await deps.environmentFor(repoOfSession(sessionId));
      store.deleteSession(sessionId);
      await removeWorkspaces(env.clonePath, sessionId);
      try {
        if (env.clonePath !== null) await manager.deleteSessionRefs(env.clonePath, sessionId);
      } catch {
        // No clone (or no refs): nothing to remove.
      }
      deps.onClose?.(sessionId);
    },

    async changedBetween(sessionId, fromSnapshotId, toSnapshotId) {
      const from = store.readSnapshot(fromSnapshotId);
      const to = store.readSnapshot(toSnapshotId);
      if (from === null || to === null || from.sessionId !== sessionId || to.sessionId !== sessionId) {
        throw new SessionError('not_found', 'No such snapshot.');
      }
      if (from.diffSource === 'local' && to.diffSource === 'local') {
        const env = await deps.environmentFor(repoOfSession(sessionId));
        try {
          if (env.clonePath === null) throw new Error('no clone');
          return await manager.changedBetween(env.clonePath, from.headCommit, to.headCommit);
        } catch {
          // The commits are gone from the clone; compare the stored diffs instead.
        }
      }
      const patches = (id: string) => new Map(store.listChangedFiles(id).map((f) => [f.path, f.patch]));
      const a = patches(from.id);
      const b = patches(to.id);
      return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path)).sort();
    },
  };
}
