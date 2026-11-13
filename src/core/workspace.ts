// The workspace: the base folder's discovery result, held in memory (FR-049 to FR-051, FR-056,
// research R11, data-model 2). One per running workbench. A run starts at start-up and on every
// config save or Rescan, replaces the previous result, and is never written to disk, so the result
// cannot go stale across restarts. This module names no platform: the caller supplies the remote
// matcher of the chosen platform's adapter.

import { resolve, sep } from 'node:path';
import type { Workspace as WireWorkspace, DiscoveryState } from '../contracts/http.ts';
import type { PlatformId } from '../contracts/shared.ts';
import type { RepoRef } from '../contracts/source-control.ts';
import { discoverRepositories, type DiscoveredEntry } from '../repo/discovery.ts';
import type { RepositoryManager } from '../repo/manager.ts';

export type WorkspaceSettings = { baseFolder: string; platform: PlatformId; baseUrl?: string };

export type WorkspaceDeps = {
  manager: Pick<RepositoryManager, 'readRemotes'>;
  appDataDir: string;
  /** The platform's `repositoryForRemote`, built from the settings. */
  matcherFor(settings: WorkspaceSettings): (normalisedRemote: string) => string | null;
  /** Called when a run ends and its result is in place; not called for a run that was cancelled by a newer one. */
  onSettled?: () => void;
};

export type Availability = { available: true } | { available: false; reason: string };

export interface Workspace {
  /** Sets the configuration and starts a discovery run, cancelling a running one. `null`: not configured. */
  configure(settings: WorkspaceSettings | null): void;
  /** Starts a new run, cancelling a running one. No-op when not configured. */
  rescan(): void;
  /** Cancels a running scan, keeping what it found. Resolves true when a scan was running. */
  cancel(): Promise<boolean>;
  /** The wire shape, or null when not configured. */
  snapshot(): WireWorkspace | null;
  /** One entry per matched repository, from what is found so far. */
  matched(): RepoRef[];
  /** The folder of the matched clone, or null. Case-insensitive on the id. */
  cloneFor(repositoryId: string): string | null;
  /** The matched clone whose folder is the nearest proper path ancestor of the clone of `repositoryId`, or null. Case-insensitive on the id. */
  enclosingOf(repositoryId: string): { repository: RepoRef; folder: string } | null;
  availability(repo: RepoRef): Availability;
  /** Resolves when the current run has ended. */
  settled(): Promise<void>;
}

export const DISCOVERY_RUNNING_REASON = 'Discovery of the base folder is still running; the repository may not be found yet.';
export const NOT_FOUND_REASON = 'The repository is no longer found under the base folder.';

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  let settings: WorkspaceSettings | null = null;
  let state: DiscoveryState = 'idle';
  let foldersScanned = 0;
  let reason: string | undefined;
  let entries: DiscoveredEntry[] = [];
  let controller: AbortController | null = null;
  let running: Promise<void> = Promise.resolve();
  let generation = 0;

  const start = (): void => {
    if (settings === null) return;
    controller?.abort();
    const mine = (generation += 1);
    const abort = new AbortController();
    controller = abort;
    const current = settings;
    state = 'scanning';
    foldersScanned = 0;
    reason = undefined;
    entries = [];
    const previous = running;
    running = (async () => {
      await previous; // the cancelled walk ends before the new one reports
      if (mine !== generation) return;
      const result = await discoverRepositories({
        baseFolder: current.baseFolder,
        appDataDir: deps.appDataDir,
        platform: current.platform,
        manager: deps.manager,
        repositoryForRemote: deps.matcherFor(current),
        signal: abort.signal,
        onProgress: (n) => {
          if (mine === generation) foldersScanned = n;
        },
        onEntries: (found) => {
          if (mine === generation) entries = found;
        },
      }).catch((error: unknown) => ({
        state: 'failed' as const,
        foldersScanned: 0,
        entries: [] as DiscoveredEntry[],
        reason: error instanceof Error ? error.message : String(error),
      }));
      if (mine !== generation) return;
      state = result.state;
      foldersScanned = result.foldersScanned;
      entries = result.entries;
      reason = result.reason;
      try {
        deps.onSettled?.();
      } catch {
        // A listener must not break the run chain: the next run awaits this one.
      }
    })();
  };

  const matchedEntries = () => entries.filter((e): e is Extract<DiscoveredEntry, { status: 'matched' }> => e.status === 'matched');

  const workspace: Workspace = {
    configure(next) {
      settings = next;
      if (next === null) {
        controller?.abort();
        generation += 1;
        state = 'idle';
        entries = [];
        foldersScanned = 0;
        reason = undefined;
        return;
      }
      start();
    },
    rescan: start,
    async cancel() {
      if (state !== 'scanning' || controller === null) return false;
      const mine = generation;
      controller.abort();
      await running;
      return mine === generation;
    },
    snapshot() {
      if (settings === null) return null;
      const out: WireWorkspace = {
        baseFolder: settings.baseFolder,
        platform: settings.platform,
        discovery: { state, foldersScanned, ...(reason === undefined ? {} : { reason }) },
        matched: matchedEntries().map((m) => ({
          repository: m.repository.id,
          folder: m.folder,
          duplicateFolders: entries.flatMap((e) => (e.status === 'duplicate' && e.duplicateOf === m.folder && e.repository.id === m.repository.id ? [e.folder] : [])),
        })),
        skipped: entries.flatMap((e) =>
          e.status === 'skipped' ? [{ folder: e.folder, reason: e.reason, ...(e.detail === undefined ? {} : { detail: e.detail }) }] : [],
        ),
      };
      if (settings.baseUrl !== undefined) out.baseUrl = settings.baseUrl;
      return out;
    },
    matched: () => matchedEntries().map((m) => m.repository),
    cloneFor(id) {
      const wanted = id.toLowerCase();
      return matchedEntries().find((m) => m.repository.id.toLowerCase() === wanted)?.folder ?? null;
    },
    enclosingOf(id) {
      const own = workspace.cloneFor(id);
      if (own === null) return null;
      const child = resolve(own);
      let best: { repository: RepoRef; folder: string } | null = null;
      let bestLength = -1;
      for (const m of matchedEntries()) {
        const folder = resolve(m.folder);
        if (folder === child || !child.startsWith(folder.endsWith(sep) ? folder : folder + sep)) continue;
        if (folder.length > bestLength) {
          best = { repository: m.repository, folder: m.folder };
          bestLength = folder.length;
        }
      }
      return best;
    },
    availability(repo) {
      if (workspace.cloneFor(repo.id) !== null) return { available: true };
      if (state === 'scanning') return { available: false, reason: DISCOVERY_RUNNING_REASON };
      if (state === 'failed') return { available: false, reason: `The base folder could not be read${reason === undefined ? '' : ` (${reason})`}.` };
      if (settings === null) return { available: false, reason: 'No base folder is configured.' };
      return { available: false, reason: NOT_FOUND_REASON };
    },
    settled: () => running,
  };
  return workspace;
}
