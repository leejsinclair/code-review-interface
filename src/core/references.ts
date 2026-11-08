// Issue reference collection (FR-003, FR-026, EC-06, research R15). Candidates come only from the
// configured tracker's `extractReferences` (core holds no key pattern); they are merged by
// (platform, key) keeping every origin, and each distinct key is looked up once. A candidate that
// needs confirmation is kept only when its lookup resolves. A `#123` that is a pull request is kept
// as a `pull-request` reference.

import type { IssueLookup, IssueTracker, RawIssueReference } from '../contracts/issue-tracker.ts';
import type { PlatformId } from '../contracts/shared.ts';

export type ReferenceSource = { branch: string; title: string; description: string };

export type ReferenceOrigin = { field: 'branch' | 'title' | 'description'; text: string };

export type CollectedReference = {
  issue: { platform: PlatformId; key: string };
  kind: 'issue' | 'pull-request';
  origins: ReferenceOrigin[];
  /** The one lookup made for this key, reused as the first issue Evidence (one GET per key). */
  lookup: IssueLookup;
};

const FIELDS = ['branch', 'title', 'description'] as const;

export async function collectReferences(tracker: IssueTracker, source: ReferenceSource): Promise<CollectedReference[]> {
  const merged = new Map<
    string,
    { raw: RawIssueReference; issue: CollectedReference['issue']; origins: ReferenceOrigin[]; needsConfirmation: boolean }
  >();
  for (const field of FIELDS) {
    for (const raw of tracker.extractReferences(source[field])) {
      const id = JSON.stringify([raw.platform, raw.key]);
      const entry = merged.get(id) ?? { raw, issue: { platform: raw.platform, key: raw.key }, origins: [], needsConfirmation: true };
      if (!entry.origins.some((o) => o.field === field && o.text === raw.text)) entry.origins.push({ field, text: raw.text });
      entry.needsConfirmation &&= raw.needsConfirmation === true;
      merged.set(id, entry);
    }
  }

  const collected = await Promise.all(
    [...merged.values()].map(async (entry): Promise<CollectedReference | null> => {
      let lookup: IssueLookup;
      try {
        lookup = await tracker.lookup(entry.raw);
      } catch (error) {
        // A tracker failure is a gap with its reason, never a lost reference (FR-032).
        lookup = { status: 'unresolved', reason: error instanceof Error ? error.message : 'tracker unreachable' };
      }
      if (entry.needsConfirmation && lookup.status !== 'resolved') return null;
      const kind = lookup.status === 'resolved' && lookup.kind === 'pull-request' ? 'pull-request' : 'issue';
      return { issue: entry.issue, kind, origins: entry.origins, lookup };
    }),
  );
  return collected.filter((ref): ref is CollectedReference => ref !== null);
}
