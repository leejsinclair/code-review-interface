// The reviewer's own decision and what they may do, shared so the overview and the file view agree (feature 005,
// FR-013, US3). One entry per session lives outside the components: any screen that changes the decision pushes
// the new state, and every mounted screen reads it. Always re-read from the server on mount, since the platform
// is the source of truth and the capability is computed there.

import { useEffect, useState } from 'preact/hooks';
import type { ReviewDecisionState } from '../../contracts/http.ts';
import { getReviewDecision } from '../api.ts';

type Entry = { state: ReviewDecisionState | null; error: string | null; listeners: Set<() => void> };
const entries = new Map<string, Entry>();

function entryOf(sessionId: string): Entry {
  let entry = entries.get(sessionId);
  if (entry === undefined) {
    entry = { state: null, error: null, listeners: new Set() };
    entries.set(sessionId, entry);
  }
  return entry;
}

function publish(entry: Entry, patch: Partial<Pick<Entry, 'state' | 'error'>>): void {
  Object.assign(entry, patch);
  for (const listener of [...entry.listeners]) listener();
}

export type ReviewDecisionHook = {
  state: ReviewDecisionState | null;
  error: string | null;
  /** Re-reads the decision and what is allowed from the server. */
  reload(): Promise<void>;
};

export function useReviewDecision(sessionId: string): ReviewDecisionHook {
  const [, rerender] = useState(0);
  const entry = entryOf(sessionId);

  const reload = (): Promise<void> =>
    getReviewDecision(sessionId)
      .then((state) => publish(entry, { state, error: null }))
      .catch((e: unknown) => publish(entry, { error: e instanceof Error ? e.message : 'Could not read your review.' }));

  useEffect(() => {
    const listener = (): void => rerender((n) => n + 1);
    entry.listeners.add(listener);
    void reload();
    return () => {
      entry.listeners.delete(listener);
    };
  }, [sessionId]);

  return { state: entry.state, error: entry.error, reload };
}

/** Test seam: forget every session's cached decision. */
export function resetReviewDecisions(): void {
  entries.clear();
}
