// The Repository manager (constitution IX.2, research R9 to R11, FR-036 to FR-038).
//
// Matches the reviewer's clone by its remotes, fetches a PR's head and target only into
// `refs/prwb/<session>/<snapshot>/{head,target}` (no tags, no FETCH_HEAD, no submodules), checks the
// fetched head is the PR's, computes the diff locally from the merge-base, and keeps the isolated
// workspaces: detached worktrees under `<app-data>/workspaces/<session>/<snapshot>`, removed one by
// one by path (never `worktree prune`). Every git call goes through src/repo/git.ts.

import { mkdir, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HeadLocation } from '../contracts/source-control.ts';
import { PRWB_REF_PREFIX, readFileAtCommit, type Git } from './git.ts';
import { diffFingerprint, parseUnifiedDiff, type DiffFile } from './unified-diff.ts';

export const NO_CLONE_REASON = 'no clone at the configured path';
export const NO_MATCHING_REMOTE_REASON = 'no remote of the clone points at the configured repository';
const MAX_REMOTE_READS = 8;
export const HEAD_MISMATCH_REASON = 'fetched head does not match the PR';

export type CloneMatch = { ok: true; remoteUrl: string } | { ok: false; reason: string };

export type FetchInput = {
  clonePath: string;
  cloneLocations: readonly string[];
  sessionId: string;
  snapshotId: string;
  head: HeadLocation;
  target: HeadLocation;
  /** The head commit the platform reported; the fetched head must equal it (R10). */
  expectedHead: string;
};

export type FetchOutcome =
  | { status: 'found'; headRef: string; targetRef: string; headCommit: string; targetCommit: string }
  | { status: 'missing'; reason: string };

export type LocalDiffFile = DiffFile & { sizeBytes: number | null };

export type LocalDiff = { baseCommit: string; files: LocalDiffFile[]; fingerprint: string };

export interface RepositoryManager {
  readonly workspacesDir: string;
  matchClone(clonePath: string, cloneLocations: readonly string[]): Promise<CloneMatch>;
  /**
   * The remote URLs of the clone in `folder`, as `git remote -v` shows them (fetch URLs first, each URL
   * once). Runs the `listRemotes` command and nothing else; at most 8 reads run at once (R11). Rejects
   * when git cannot read the folder.
   */
  readRemotes(folder: string): Promise<string[]>;
  fetchSnapshot(input: FetchInput): Promise<FetchOutcome>;
  localDiff(clonePath: string, targetCommit: string, headCommit: string): Promise<LocalDiff>;
  /** Paths changed between two commits present in the clone. */
  changedBetween(clonePath: string, fromCommit: string, toCommit: string): Promise<string[]>;
  workspacePath(sessionId: string, snapshotId: string): string;
  /** Adds the detached worktree at `commit`, or returns it when it is already there. */
  createWorkspace(clonePath: string, sessionId: string, snapshotId: string, commit: string): Promise<string>;
  /** Removes one workbench worktree by its path, run from `repoDir` (a clone or its git directory), then its directory. */
  removeWorkspace(repoDir: string, path: string): Promise<void>;
  listWorktrees(clonePath: string): Promise<string[]>;
  /** Deletes every `refs/prwb/<sessionId>/` ref in the clone. */
  deleteSessionRefs(clonePath: string, sessionId: string): Promise<void>;
  /** The remote's branch heads (`ls-remote --heads`); `branch` has no `refs/heads/` prefix. Rejects with the first git error line. */
  listRemoteBranches(clonePath: string, remoteUrl: string): Promise<Array<{ branch: string; commit: string }>>;
  /** Fetches one branch into `refs/prwb/<sessionId>/<snapshotId>/spec-<n>` and returns that ref and the commit it holds. */
  fetchSpecRef(input: { clonePath: string; remoteUrl: string; branch: string; sessionId: string; snapshotId: string; n: number }): Promise<{ ref: string; commit: string }>;
  /** Every path under `specs/` in the commit's tree. */
  listSpecFiles(clonePath: string, commit: string): Promise<string[]>;
  /** Reads a file at the last commit that touched it, refusing a file over `maxBytes`, an unsafe path or an unsafe commit. */
  readSpecFile(input: { clonePath: string; commit: string; path: string; maxBytes: number }): Promise<{ commit: string; committedAt: string; content: string }>;
}

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BRANCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_./+@-]*$/;

function checkCommit(commit: string): void {
  if (!COMMIT_PATTERN.test(commit)) throw new Error('refused: not a full commit id');
}

function checkSpecPath(path: string): void {
  if (!path.startsWith('specs/') || path.split('/').some((part) => part === '' || part === '..')) {
    throw new Error('refused: path is not a file under specs/');
  }
}

/** A remote URL as `host/path`, without scheme, user, port or `.git`, case-folded (R10). */
export function normaliseRemote(url: string): string {
  const text = url.trim();
  let hostPath = text;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      hostPath = parsed.hostname + decodeURIComponent(parsed.pathname);
    } catch {
      hostPath = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    }
  } else {
    // scp-like `user@host:path`; a bare local path has no colon before its first slash.
    const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(text);
    if (scp !== null && (scp[1] ?? '').length > 1) hostPath = `${scp[1]}/${scp[2]}`;
  }
  return hostPath.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function schemeOf(url: string): 'https' | 'ssh' | 'other' {
  if (/^https?:\/\//i.test(url)) return 'https';
  if (/^ssh:\/\//i.test(url) || /^(?:[^@/]+@)?[^:/]{2,}:(?!\/\/)/.test(url)) return 'ssh';
  return 'other';
}

const text = (value: string | Buffer): string => (typeof value === 'string' ? value : value.toString('utf8'));

/** The first line git wrote to stderr, for a reason shown to the reviewer. */
function gitReason(error: unknown): string {
  const stderr = (error as { stderr?: string | Buffer }).stderr;
  const line = (stderr === undefined ? '' : text(stderr))
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  return line ?? (error instanceof Error ? error.message : String(error));
}

async function sameDirectory(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}

/** `--numstat -z` records: `add\tdel\tpath\0`, or `add\tdel\t\0old\0new\0` for a rename or copy. */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const out = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const parts = output.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const record = parts[i] ?? '';
    if (record === '') continue;
    const [added = '', deleted = '', inlinePath = ''] = record.split('\t');
    let path = inlinePath;
    if (path === '') {
      path = parts[i + 2] ?? '';
      i += 2;
    }
    const binary = added === '-' || deleted === '-';
    out.set(path, { additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), binary });
  }
  return out;
}

export function createRepositoryManager(options: { git: Git; workspacesDir: string }): RepositoryManager {
  const { git, workspacesDir } = options;
  const run = async (command: string, params: Record<string, string>, cwd: string): Promise<string> =>
    text((await git.run(command, params, { cwd })).stdout);

  const remoteLines = (output: string): RegExpExecArray[] =>
    output
      .split('\n')
      .map((line) => /^\S+\t(.+?)\s+\((fetch|push)\)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => (a[2] === b[2] ? 0 : a[2] === 'fetch' ? -1 : 1));

  // At most MAX_REMOTE_READS `listRemotes` runs at once, however many folders discovery has queued.
  let reading = 0;
  const waiting: Array<() => void> = [];
  const readRemotes = async (folder: string): Promise<string[]> => {
    if (reading < MAX_REMOTE_READS) reading += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve)); // the finishing read hands its slot over
    try {
      const urls = remoteLines(await run('listRemotes', {}, folder)).map((m) => m[1] ?? '');
      return [...new Set(urls)];
    } finally {
      const next = waiting.shift();
      if (next === undefined) reading -= 1;
      else next();
    }
  };

  const matchClone = async (clonePath: string, cloneLocations: readonly string[]): Promise<CloneMatch> => {
    let topLevel: string;
    try {
      topLevel = (await run('showTopLevel', {}, clonePath)).trim();
    } catch {
      return { ok: false, reason: NO_CLONE_REASON };
    }
    if (!(await sameDirectory(topLevel, clonePath))) return { ok: false, reason: NO_CLONE_REASON };
    const wanted = new Set(cloneLocations.map(normaliseRemote));
    const remotes = remoteLines(await run('listRemotes', {}, clonePath));
    for (const m of remotes) {
      const url = m[1] ?? '';
      if (wanted.has(normaliseRemote(url))) return { ok: true, remoteUrl: url };
    }
    return { ok: false, reason: NO_MATCHING_REMOTE_REASON };
  };

  const resolve = async (clonePath: string, rev: string): Promise<string> => (await run('resolveRevision', { rev }, clonePath)).trim();

  const deleteRef = async (clonePath: string, ref: string): Promise<void> => {
    try {
      await run('deletePrwbRef', { ref: ref.slice(PRWB_REF_PREFIX.length) }, clonePath);
    } catch {
      // The ref was never written.
    }
  };

  return {
    workspacesDir,
    matchClone,
    readRemotes,

    async fetchSnapshot(input) {
      const match = await matchClone(input.clonePath, input.cloneLocations);
      if (!match.ok) return { status: 'missing', reason: match.reason };
      const scheme = schemeOf(match.remoteUrl);
      const pick = (location: HeadLocation): string =>
        location.remoteUrls.find((url) => schemeOf(url) === scheme) ?? location.remoteUrls[0] ?? '';
      const base = `${PRWB_REF_PREFIX}${input.sessionId}/${input.snapshotId}`;
      const headRef = `${base}/head`;
      const targetRef = `${base}/target`;
      const fail = async (reason: string): Promise<FetchOutcome> => {
        await deleteRef(input.clonePath, headRef);
        await deleteRef(input.clonePath, targetRef);
        return { status: 'missing', reason };
      };

      for (const [side, location] of [['head', input.head], ['target', input.target]] as const) {
        try {
          await run(
            'fetchToPrwbRef',
            { url: pick(location), sourceRef: location.ref, sessionId: input.sessionId, snapshotId: input.snapshotId, side },
            input.clonePath,
          );
        } catch (error) {
          return fail(`fetch failed: ${gitReason(error)}`);
        }
      }
      let headCommit: string;
      let targetCommit: string;
      try {
        headCommit = await resolve(input.clonePath, headRef);
        targetCommit = await resolve(input.clonePath, targetRef);
      } catch (error) {
        return fail(`fetch failed: ${gitReason(error)}`);
      }
      if (headCommit !== input.expectedHead.toLowerCase()) return fail(HEAD_MISMATCH_REASON);
      return { status: 'found', headRef, targetRef, headCommit, targetCommit };
    },

    async localDiff(clonePath, targetCommit, headCommit) {
      const baseCommit = (await run('mergeBase', { targetCommit, headCommit }, clonePath)).trim();
      const params = { baseCommit, headCommit };
      const counts = parseNumstat(await run('diffNumstat', params, clonePath));
      const parsed = parseUnifiedDiff(await run('diffPatch', params, clonePath));
      const files: LocalDiffFile[] = [];
      for (const file of parsed) {
        const numstat = counts.get(file.path);
        const merged: DiffFile = numstat === undefined ? file : { ...file, ...numstat, patch: numstat.binary ? null : file.patch };
        let sizeBytes: number | null = null;
        if (merged.status !== 'deleted') {
          try {
            sizeBytes = Number((await run('fileSizeAtCommit', { commit: headCommit, path: merged.path }, clonePath)).trim());
          } catch {
            sizeBytes = null;
          }
        }
        files.push({ ...merged, sizeBytes });
      }
      return { baseCommit, files, fingerprint: diffFingerprint(files) };
    },

    async changedBetween(clonePath, fromCommit, toCommit) {
      return [...parseNumstat(await run('diffNumstat', { baseCommit: fromCommit, headCommit: toCommit }, clonePath)).keys()];
    },

    workspacePath: (sessionId, snapshotId) => join(workspacesDir, sessionId, snapshotId),

    async createWorkspace(clonePath, sessionId, snapshotId, commit) {
      const path = join(workspacesDir, sessionId, snapshotId);
      const existing = await stat(join(path, '.git')).catch(() => null);
      if (existing !== null) return path;
      await mkdir(dirname(path), { recursive: true });
      await run('addWorktree', { worktreePath: path, commit }, clonePath);
      return path;
    },

    async removeWorkspace(repoDir, path) {
      try {
        await run('removeWorktree', { worktreePath: path }, repoDir);
      } catch {
        // Not (or no longer) a worktree of that repository; the directory is still removed below.
      }
      await rm(path, { recursive: true, force: true });
      const parent = dirname(path);
      if (parent !== workspacesDir && (await readdir(parent).catch(() => ['?'])).length === 0) {
        await rmdir(parent).catch(() => undefined);
      }
    },

    async listWorktrees(clonePath) {
      return (await run('listWorktrees', {}, clonePath))
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length));
    },

    async listRemoteBranches(clonePath, remoteUrl) {
      let output: string;
      try {
        output = await run('listRemoteHeads', { url: remoteUrl }, clonePath);
      } catch (error) {
        throw new Error(gitReason(error));
      }
      const heads: Array<{ branch: string; commit: string }> = [];
      for (const line of output.split('\n')) {
        const m = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/(.+)$/.exec(line.trim());
        if (m !== null) heads.push({ commit: m[1] ?? '', branch: m[2] ?? '' });
      }
      return heads;
    },

    async fetchSpecRef({ clonePath, remoteUrl, branch, sessionId, snapshotId, n }) {
      if (!BRANCH_PATTERN.test(branch) || branch.includes('..')) throw new Error('refused: unsafe branch name');
      const side = `spec-${n}`;
      try {
        await run('fetchToPrwbRef', { url: remoteUrl, sourceRef: `refs/heads/${branch}`, sessionId, snapshotId, side }, clonePath);
        const ref = `${PRWB_REF_PREFIX}${sessionId}/${snapshotId}/${side}`;
        return { ref, commit: await resolve(clonePath, ref) };
      } catch (error) {
        throw new Error(gitReason(error));
      }
    },

    async listSpecFiles(clonePath, commit) {
      checkCommit(commit);
      return (await run('listTreePaths', { commit }, clonePath)).split('\n').filter((l) => l !== '');
    },

    async readSpecFile({ clonePath, commit, path, maxBytes }) {
      checkCommit(commit);
      checkSpecPath(path);
      const last = (await run('lastCommitTouching', { commit, path }, clonePath)).trim();
      if (!COMMIT_PATTERN.test(last)) throw new Error('refused: no commit touches that path');
      const size = Number((await run('fileSizeAtCommit', { commit: last, path }, clonePath)).trim());
      if (!Number.isFinite(size) || size > maxBytes) throw new Error(`refused: file is ${size} bytes, over the size limit of ${maxBytes}`);
      const committedAt = (await run('commitTime', { commit: last }, clonePath)).trim();
      return { commit: last, committedAt, content: (await readFileAtCommit(git, clonePath, last, path)).toString('utf8') };
    },

    async deleteSessionRefs(clonePath, sessionId) {
      const lines = (await run('listSessionPrwbRefs', { sessionId }, clonePath)).split('\n').filter((l) => l !== '');
      for (const line of lines) await deleteRef(clonePath, line.split(' ')[0] ?? '');
    },
  };
}
