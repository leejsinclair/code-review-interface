// Issue Evidence capture and staleness (FR-011, FR-032, constitution V, data-model "Issue Evidence").
// Every issue-kind reference of the latest snapshot is looked up, each lookup isolated so one failure
// is a gap and never stops the others, and one record is appended per issue following the
// transitions: success is `current`; a failure is `missing`, or `stale` pointing at the last good
// record when there was one. Nothing is updated or removed. Staleness of commit-bound Evidence is
// derived on read, never written.

import type { IssueLookup, IssueTracker } from '../contracts/issue-tracker.ts';
import type { Evidence, EvidenceStatus, IssueKey, ReviewStore } from '../store/review-store.ts';

export type IssueToCapture = { issue: IssueKey; kind: 'issue' | 'pull-request' };

export const issueId = (issue: IssueKey): string => JSON.stringify([issue.platform, issue.key]);

/** The status to show: commit-bound Evidence is stale once the latest head is past its commit (V.3). */
export function effectiveStatus(evidence: Evidence, latestHeadCommit: string): EvidenceStatus {
  return evidence.commitBound && evidence.commit !== latestHeadCommit ? 'stale' : evidence.status;
}

/**
 * Looks up every issue-kind reference not already in `known` (lookups already made while collecting
 * references are reused, so each key costs one GET). A thrown lookup becomes an unresolved result.
 */
export async function lookupIssues(
  tracker: IssueTracker,
  references: readonly IssueToCapture[],
  known: ReadonlyMap<string, IssueLookup> = new Map(),
): Promise<Map<string, IssueLookup>> {
  const results = new Map<string, IssueLookup>();
  await Promise.all(
    references
      .filter((r) => r.kind === 'issue')
      .map(async (r) => {
        const id = issueId(r.issue);
        let result = known.get(id);
        if (result === undefined) {
          try {
            result = await tracker.lookup({ platform: r.issue.platform, key: r.issue.key, form: 'project-key', text: r.issue.key });
          } catch (error) {
            result = { status: 'unresolved', reason: error instanceof Error ? error.message : 'tracker unreachable' };
          }
        }
        results.set(id, result);
      }),
  );
  return results;
}

export type EvidenceInput = {
  sessionId: string;
  snapshotId: string;
  /** The latest snapshot's head commit. */
  commit: string;
  capturedAt: string;
  references: readonly IssueToCapture[];
  lookups: ReadonlyMap<string, IssueLookup>;
  newId: () => string;
};

/** The Evidence records to append for these lookups, given what the store already holds. */
export function issueEvidence(store: ReviewStore, input: EvidenceInput): Evidence[] {
  const records: Evidence[] = [];
  for (const reference of input.references) {
    if (reference.kind !== 'issue') continue;
    const result = input.lookups.get(issueId(reference.issue));
    if (result === undefined || (result.status === 'resolved' && result.kind !== 'issue')) continue;
    const base = {
      id: input.newId(),
      sessionId: input.sessionId,
      snapshotId: input.snapshotId,
      kind: 'issue' as const,
      source: { platform: reference.issue.platform, key: reference.issue.key },
      capturedAt: input.capturedAt,
      commit: input.commit,
      commitBound: false,
    };
    if (result.status === 'resolved') {
      records.push({
        ...base,
        status: 'current',
        reason: null,
        lastGoodId: null,
        payload: {
          platform: reference.issue.platform,
          key: reference.issue.key,
          title: result.title,
          descriptionText: result.descriptionText,
          webUrl: result.webUrl ?? '',
        },
      });
      continue;
    }
    const previous = store.readLatestEvidence(input.sessionId, reference.issue);
    const lastGoodId = previous?.status === 'current' ? previous.id : previous?.status === 'stale' ? previous.lastGoodId : null;
    records.push({
      ...base,
      status: lastGoodId === null ? 'missing' : 'stale',
      reason: result.reason,
      lastGoodId,
      payload: null,
    });
  }
  return records;
}
