// Home's review queue: the reviewer's open sessions, joined to the open pull request list and sorted so the
// next one to look at is at the top. Pure, so the order is unit-tested.
//
// Lanes, in order:
// - new-commits: the pull request's head moved past the session's latest snapshot (the author has answered);
// - in-progress: not approved by you and nothing new;
// - approved: you approved it and nothing new since; it waits on someone else.
// Within a lane: the riskiest first, then the one waiting longest, then repository and number (stable).

import type { PullSummary, RiskClass, SessionSummary } from '../../contracts/http.ts';
import { ageDays, isStale } from './pull-buckets.ts';

export type LaneId = 'new-commits' | 'in-progress' | 'approved';
export const LANE_ORDER: readonly LaneId[] = ['new-commits', 'in-progress', 'approved'];

export type QueueRow = {
  session: SessionSummary;
  /** The matching open pull request, when the list has loaded and still holds it. */
  pull?: PullSummary;
  lane: LaneId;
  newCommits: boolean;
  approved: boolean;
  /** Whole days since the pull request's last activity; absent without `pull`. */
  ageDays?: number;
  stale: boolean;
};

export type ReviewQueue = {
  lanes: { id: LaneId; rows: QueueRow[] }[];
  /** Read-only reasons shared by two or more rows: shown once above the lanes, not on every row. */
  sharedReasons: string[];
};

const RISK_RANK: Record<RiskClass, number> = { critical: 0, elevated: 1, normal: 2, low: 3 };
const UNCLASSIFIED = 4;

const key = (repository: string, number: number): string => `${repository.toLowerCase()}#${number}`;

/** Bitbucket list rows carry an abbreviated head, so one commit id may be a prefix of the other. */
export function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length < 7 || y.length < 7) return x === y;
  return x.startsWith(y) || y.startsWith(x);
}

const compare = (a: QueueRow, b: QueueRow): number => {
  const risk = (a.session.highestRisk === undefined ? UNCLASSIFIED : RISK_RANK[a.session.highestRisk]) - (b.session.highestRisk === undefined ? UNCLASSIFIED : RISK_RANK[b.session.highestRisk]);
  if (risk !== 0) return risk;
  // Oldest activity first; a row with no pull request (not loaded, or gone from the list) goes after those with one.
  const at = a.pull?.updatedAt;
  const bt = b.pull?.updatedAt;
  if (at !== bt) {
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    return at < bt ? -1 : 1;
  }
  const repo = a.session.repository.localeCompare(b.session.repository);
  return repo !== 0 ? repo : a.session.prNumber - b.session.prNumber;
};

/** `sessions` should already be the open ones; `pulls` is every loaded open pull request. */
export function buildQueue(sessions: readonly SessionSummary[], pulls: readonly PullSummary[], now: number): ReviewQueue {
  const byPr = new Map(pulls.map((p) => [key(p.repository, p.number), p]));
  const rows = sessions.map((session): QueueRow => {
    const pull = byPr.get(key(session.repository, session.prNumber));
    const newCommits = pull?.headCommit !== undefined && pull.headCommit !== '' && !sameCommit(pull.headCommit, session.latestHeadCommit);
    const approved = pull?.approvedByMe === true;
    const lane: LaneId = newCommits ? 'new-commits' : approved ? 'approved' : 'in-progress';
    const row: QueueRow = { session, lane, newCommits, approved, stale: pull !== undefined && isStale(pull, now) };
    if (pull !== undefined) {
      row.pull = pull;
      row.ageDays = ageDays(pull, now);
    }
    return row;
  });

  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.session.repositoryAvailable && r.session.repositoryReason !== undefined) counts.set(r.session.repositoryReason, (counts.get(r.session.repositoryReason) ?? 0) + 1);
  }

  return {
    lanes: LANE_ORDER.map((id) => ({ id, rows: rows.filter((r) => r.lane === id).sort(compare) })),
    sharedReasons: [...counts].filter(([, n]) => n >= 2).map(([reason]) => reason),
  };
}

/** "today", "1 day", "12 days": how long the pull request has had no activity. */
export const ageText = (days: number): string => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);
