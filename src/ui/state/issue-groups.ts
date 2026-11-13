// Dashboard grouping by issue key. A pull request belongs to the first issue key found in its title,
// or failing that its source branch. When project keys are configured only those projects count, so a
// branch such as `fix/utf-8` is not taken for a ticket. Pull requests with no key form a last group.

import type { PullSummary } from '../../contracts/http.ts';

// Same shape as the issue tracker adapter's reference pattern (src/adapters/).
const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]+)-(\d+)(?![A-Za-z0-9])/g;

/** The id used for the group with no issue key, in test ids and in the remembered collapsed list. */
export const NO_ISSUE_GROUP = 'none';

export type IssueGroup = { key: string | null; pulls: PullSummary[] };

function firstKey(text: string, allowed: ReadonlySet<string>): string | null {
  for (const m of text.matchAll(KEY)) {
    const project = (m[1] ?? '').toUpperCase();
    if (allowed.size === 0 || allowed.has(project)) return `${project}-${Number(m[2])}`;
  }
  return null;
}

/** The issue key of a pull request, uppercased, or null when its title and branch name none. */
export function issueKeyOf(pr: PullSummary, projectKeys: readonly string[] = []): string | null {
  const allowed = new Set(projectKeys.map((k) => k.toUpperCase()));
  return firstKey(pr.title, allowed) ?? firstKey(pr.sourceBranch, allowed);
}

/** The group's id: the issue key, or NO_ISSUE_GROUP. */
export const groupId = (g: IssueGroup): string => g.key ?? NO_ISSUE_GROUP;

/**
 * Groups an already ordered (newest first) list. Groups run newest first by their latest update, the group with
 * no key last. Inside a group the incoming order is kept, with pull requests you approved at the bottom.
 */
export function groupPullsByIssue(sorted: readonly PullSummary[], projectKeys: readonly string[] = []): IssueGroup[] {
  const byKey = new Map<string | null, PullSummary[]>();
  for (const pr of sorted) {
    const key = issueKeyOf(pr, projectKeys);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [pr]);
    else list.push(pr);
  }
  const groups: IssueGroup[] = [...byKey].map(([key, pulls]) => ({
    key,
    pulls: [...pulls.filter((p) => p.approvedByMe !== true), ...pulls.filter((p) => p.approvedByMe === true)],
  }));
  const newest = (g: IssueGroup): string => g.pulls.reduce((latest, p) => (p.updatedAt > latest ? p.updatedAt : latest), '');
  return groups.sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? 0 : 1) : -1;
    const x = newest(a);
    const y = newest(b);
    return x < y ? 1 : x > y ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
