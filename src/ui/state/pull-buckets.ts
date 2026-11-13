// Pull request age (time since last activity, `updatedAt`): one untouched for more than STALE_DAYS is stale.

import type { PullSummary } from '../../contracts/http.ts';

export const STALE_DAYS = 5;
const DAY = 24 * 60 * 60 * 1000;

/** Whole days since the last update, rounded down; 0 when the date does not parse. */
export function ageDays(pr: PullSummary, now: number): number {
  const time = Date.parse(pr.updatedAt);
  return Number.isNaN(time) ? 0 : Math.max(0, Math.floor((now - time) / DAY));
}

export const isStale = (pr: PullSummary, now: number): boolean => now - Date.parse(pr.updatedAt) > STALE_DAYS * DAY;
