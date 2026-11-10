// Discovery: finds every clone under the base folder and says which repository each one is (FR-049
// to FR-051, research R11, data-model 2.2 and 2.3). Read-only (constitution IX): it opens folders with
// `fs.opendir`, never follows a symbolic link or junction, skips the application-data folder and the
// inside of `.git`, reads remotes only through the Repository manager's `readRemotes` (the existing
// `listRemotes` command) and writes nothing. Nothing here names a platform: the caller supplies the
// remote matcher of the chosen platform's adapter.

import { opendir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { PlatformId } from '../contracts/shared.ts';
import type { RepoRef } from '../contracts/source-control.ts';
import { normaliseRemote, type RepositoryManager } from './manager.ts';

export type SkipReason = 'no-remote' | 'no-matching-remote' | 'remotes-unreadable';

export type DiscoveredEntry =
  | { status: 'matched'; folder: string; repository: RepoRef; remote: string }
  | { status: 'duplicate'; folder: string; repository: RepoRef; remote: string; duplicateOf: string }
  | { status: 'skipped'; folder: string; reason: SkipReason; detail?: string; repository?: undefined };

export type DiscoveryOptions = {
  baseFolder: string;
  /** The application-data folder, skipped when it sits inside the base folder. */
  appDataDir: string;
  platform: PlatformId;
  manager: Pick<RepositoryManager, 'readRemotes'>;
  /** The platform adapter's `repositoryForRemote`. */
  repositoryForRemote(normalisedRemote: string): string | null;
  signal?: AbortSignal;
  /** Called each time a folder is opened, with the number opened so far. */
  onProgress?(foldersScanned: number): void;
  /** Called with the resolved entries so far each time a clone has been read. */
  onEntries?(entries: DiscoveredEntry[]): void;
};

export type DiscoveryResult = {
  state: 'complete' | 'cancelled' | 'failed';
  foldersScanned: number;
  entries: DiscoveredEntry[];
  /** When 'failed'. */
  reason?: string;
};

type Raw = { folder: string; remotes: string[] } | { folder: string; failure: string };

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const depthOf = (folder: string, base: string): number => relative(base, folder).split(sep).length;

/** One entry per (folder, repository), or per folder when nothing matched; duplicates resolved (FR-050, FR-051). */
function resolveEntries(raws: readonly Raw[], options: DiscoveryOptions): DiscoveredEntry[] {
  const candidates: Array<{ folder: string; id: string; remote: string }> = [];
  const out: DiscoveredEntry[] = [];
  for (const raw of raws) {
    if ('failure' in raw) {
      out.push({ status: 'skipped', folder: raw.folder, reason: 'remotes-unreadable', detail: raw.failure });
      continue;
    }
    if (raw.remotes.length === 0) {
      out.push({ status: 'skipped', folder: raw.folder, reason: 'no-remote' });
      continue;
    }
    const seen = new Set<string>();
    for (const remote of raw.remotes) {
      const normalised = normaliseRemote(remote);
      const id = options.repositoryForRemote(normalised);
      if (id === null) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ folder: raw.folder, id: key, remote: normalised });
    }
    if (seen.size === 0) {
      const hosts = [...new Set(raw.remotes.map((r) => normaliseRemote(r).split('/')[0] ?? ''))].filter((h) => h !== '');
      out.push({ status: 'skipped', folder: raw.folder, reason: 'no-matching-remote', detail: `Remotes found on ${hosts.join(', ')}.` });
    }
  }

  const byId = new Map<string, typeof candidates>();
  for (const c of candidates) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  for (const [id, found] of byId) {
    // Fewest path segments below the base folder, then the folder path in code-point order.
    const ordered = [...found].sort(
      (a, b) => depthOf(a.folder, options.baseFolder) - depthOf(b.folder, options.baseFolder) || byCodePoint(a.folder, b.folder),
    );
    const [first, ...rest] = ordered;
    if (first === undefined) continue;
    const repository: RepoRef = { platform: options.platform, id };
    out.push({ status: 'matched', folder: first.folder, repository, remote: first.remote });
    for (const dup of rest) out.push({ status: 'duplicate', folder: dup.folder, repository, remote: dup.remote, duplicateOf: first.folder });
  }
  return out.sort((a, b) => byCodePoint(a.folder, b.folder) || byCodePoint(a.repository?.id ?? '', b.repository?.id ?? ''));
}

export async function discoverRepositories(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const base = resolve(options.baseFolder);
  const appData = resolve(options.appDataDir);
  const raws: Raw[] = [];
  const reads: Promise<void>[] = [];
  let foldersScanned = 0;
  const aborted = (): boolean => options.signal?.aborted === true;

  const readClone = (folder: string): void => {
    reads.push(
      options.manager.readRemotes(folder).then(
        (remotes) => {
          raws.push({ folder, remotes });
        },
        (error: unknown) => {
          raws.push({ folder, failure: error instanceof Error ? error.message.split('\n')[0] ?? 'git could not read the folder' : String(error) });
        },
      ).then(() => options.onEntries?.(resolveEntries(raws, options))),
    );
  };

  const walk = async (folder: string, isRoot: boolean): Promise<string | null> => {
    if (aborted()) return null;
    let dir;
    try {
      dir = await opendir(folder);
    } catch (error) {
      // An unreadable base folder fails the scan; an unreadable subfolder is passed over.
      return isRoot ? (error instanceof Error ? error.message : String(error)) : null;
    }
    foldersScanned += 1;
    options.onProgress?.(foldersScanned);
    const subfolders: string[] = [];
    let isClone = false;
    try {
      for await (const entry of dir) {
        if (entry.name === '.git') {
          isClone = true; // a directory, or a file in a worktree or submodule
          continue;
        }
        if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
        subfolders.push(entry.name);
      }
    } catch (error) {
      return isRoot ? (error instanceof Error ? error.message : String(error)) : null;
    }
    if (isClone) readClone(folder);
    for (const name of subfolders.sort(byCodePoint)) {
      const child = join(folder, name);
      if (child === appData) continue;
      if (aborted()) break;
      await walk(child, false);
    }
    return null;
  };

  const failure = await walk(base, true);
  await Promise.all(reads);
  if (failure !== null) return { state: 'failed', foldersScanned, entries: [], reason: failure };
  return { state: aborted() ? 'cancelled' : 'complete', foldersScanned, entries: resolveEntries(raws, options) };
}
