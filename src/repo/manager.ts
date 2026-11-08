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
import { PRWB_REF_PREFIX, type Git } from './git.ts';
import { diffFingerprint, parseUnifiedDiff, type DiffFile } from './unified-diff.ts';

export const NO_CLONE_REASON = 'no clone at the configured path';
export const NO_MATCHING_REMOTE_REASON = 'no remote of the clone points at the configured repository';
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

  const matchClone = async (clonePath: string, cloneLocations: readonly string[]): Promise<CloneMatch> => {
    let topLevel: string;
    try {
      topLevel = (await run('showTopLevel', {}, clonePath)).trim();
    } catch {
      return { ok: false, reason: NO_CLONE_REASON };
    }
    if (!(await sameDirectory(topLevel, clonePath))) return { ok: false, reason: NO_CLONE_REASON };
    const wanted = new Set(cloneLocations.map(normaliseRemote));
    const remotes = (await run('listRemotes', {}, clonePath))
      .split('\n')
      .map((line) => /^\S+\t(.+?)\s+\((fetch|push)\)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => (a[2] === b[2] ? 0 : a[2] === 'fetch' ? -1 : 1));
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

    async deleteSessionRefs(clonePath, sessionId) {
      const lines = (await run('listSessionPrwbRefs', { sessionId }, clonePath)).split('\n').filter((l) => l !== '');
      for (const line of lines) await deleteRef(clonePath, line.split(' ')[0] ?? '');
    },
  };
}
