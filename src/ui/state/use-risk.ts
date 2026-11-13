// The snapshot's risk report, loaded once and kept live: a `risk` event for the shown snapshot re-reads it, and
// each path whose effective class changed is announced politely (FR-033). The event carries paths and a
// revision, never a class, so the class always comes from the guarded GET.

import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { RiskReport } from '../../contracts/http.ts';
import { getRisk } from '../api.ts';
import { RISK_LABELS } from '../labels.ts';
import { ReviewContext } from './review-context.ts';

export type RiskState = {
  report: RiskReport | null;
  error: string | null;
  /** Re-reads the report; resolves once it is in place. */
  reload(): Promise<void>;
  retry(): void;
};

/** One sentence naming each path whose effective class changed between two reports; empty when none did. */
export function classChangeAnnouncement(before: RiskReport, after: RiskReport): string {
  const was = new Map(before.files.map((f) => [f.path, f.effectiveClass]));
  // An override made here is announced by the override dialog itself.
  const changed = after.files.filter((f) => was.has(f.path) && was.get(f.path) !== f.effectiveClass && f.effectiveOrigin !== 'override');
  if (changed.length === 0) return '';
  return changed.map((f) => `Risk class changed: ${f.path} is now ${RISK_LABELS.class[f.effectiveClass]}.`).join(' ');
}

/** One sentence when the AI assessment went from waiting to finished (or missing) between two reports. */
export function aiAnnouncement(before: RiskReport, after: RiskReport): string {
  const waiting = before.ai.state === 'pending' || before.ai.state === 'running';
  if (!waiting) return '';
  if (after.ai.state === 'completed') return `${RISK_LABELS.aiDone}.`;
  if (after.ai.state === 'failed' || after.ai.state === 'cancelled' || after.ai.state === 'none') return `${RISK_LABELS.aiMissing}.`;
  return '';
}

/**
 * `announceAi`: also announce when the AI assessment finishes. Only the Overview does; on the Files view it would
 * speak over what the reviewer is doing, and a class that changes is still announced there.
 */
export function useRisk(sessionId: string, snapshotId: string | undefined, options: { announceAi?: boolean } = {}): RiskState {
  const ctx = useContext(ReviewContext);
  const [report, setReport] = useState<RiskReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const previous = useRef<RiskReport | null>(null);

  const load = (id: string): Promise<void> =>
    getRisk(sessionId, id)
      .then((next) => {
        const before = previous.current;
        if (before !== null && before.snapshotId === next.snapshotId) {
          const text = [classChangeAnnouncement(before, next), options.announceAi === true ? aiAnnouncement(before, next) : ''].filter((t) => t !== '').join(' ');
          if (text !== '') ctx.announce(text);
        }
        previous.current = next;
        setReport(next);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the risk classes.'));

  useEffect(() => {
    if (snapshotId === undefined) return undefined;
    previous.current = null;
    setReport(null);
    load(snapshotId);
    return ctx.subscribe({
      risk: (event) => {
        if (event.snapshotId === snapshotId) load(snapshotId);
      },
      onSummaries: () => load(snapshotId),
    });
  }, [sessionId, snapshotId, attempt]);

  return {
    report,
    error,
    reload: () => (snapshotId === undefined ? Promise.resolve() : load(snapshotId)),
    retry: () => setAttempt((n) => n + 1),
  };
}
