// The last good pull request list for each repository, kept in memory so Home can show it at once while a
// fresh list loads behind it. Metadata only: it never holds a credential (X.7). It is not persisted, so a
// restart starts empty. A cached entry never carries a session id, since sessions are read live.

import type { PullGroup, PullSummary } from '../contracts/http.ts';

export type CachedPulls = { repository: string; pulls: PullSummary[]; fetchedAt: string };

export interface PullCache {
  get(repository: string): CachedPulls | null;
  /** Remember a loaded group; any other group is ignored, so a failure keeps the last good list. */
  put(group: PullGroup): void;
  /** Patch the approval flag of one cached pull request, when it is cached. */
  setApproved(repository: string, number: number, approved: boolean): void;
  /** Drop one pull request that is no longer open. */
  remove(repository: string, number: number): void;
  clear(): void;
}

export function createPullCache(now: () => Date = () => new Date()): PullCache {
  const entries = new Map<string, CachedPulls>();
  const key = (repository: string): string => repository.toLowerCase();
  const strip = ({ sessionId: _sessionId, ...rest }: PullSummary): PullSummary => rest;
  return {
    get: (repository) => entries.get(key(repository)) ?? null,
    put(group) {
      if (group.status !== 'loaded') return;
      entries.set(key(group.repository), { repository: group.repository, pulls: group.pulls.map(strip), fetchedAt: now().toISOString() });
    },
    setApproved(repository, number, approved) {
      const entry = entries.get(key(repository));
      if (entry === undefined) return;
      entry.pulls = entry.pulls.map((pr) => {
        if (pr.number !== number) return pr;
        const { approvedByMe: _old, ...rest } = pr;
        return approved ? { ...rest, approvedByMe: true } : rest;
      });
    },
    remove(repository, number) {
      const entry = entries.get(key(repository));
      if (entry === undefined) return;
      entry.pulls = entry.pulls.filter((pr) => pr.number !== number);
    },
    clear: () => entries.clear(),
  };
}

/** Keep the cache true after a review action: an approval marks the pull request, a changed or withdrawn decision clears the mark. */
export function applyDecision(cache: PullCache | undefined, repository: string, number: number, kind: string): void {
  if (kind === 'approve') cache?.setApproved(repository, number, true);
  else if (kind === 'request_changes' || kind === 'withdraw_decision') cache?.setApproved(repository, number, false);
}
