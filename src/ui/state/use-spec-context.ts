// The snapshot's specification report, loaded once and kept live: a `spec-context` event for the shown snapshot
// re-reads it (the event carries a revision, never document text), and the document viewer's state lives here.
// Completion and staleness are announced politely. A failure to load never blocks the overview (FR-018).

import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { SpecContextReport } from '../../contracts/http.ts';
import { getSpecContext, retrySpecContext } from '../api.ts';
import { SPEC_LABELS } from '../labels.ts';
import { ReviewContext } from './review-context.ts';

export type SpecDocumentView = { documentId: string; startLine?: number; endLine?: number };

export type SpecContextState = {
  report: SpecContextReport | null;
  error: string | null;
  /** The document open in the viewer, or null. Kept in the tab, never sent to the server. */
  open: SpecDocumentView | null;
  openDocument(view: SpecDocumentView): void;
  closeDocument(): void;
  /** Queues a new assessment; resolves once the report is re-read. */
  retryAssessment(): Promise<void>;
  reload(): Promise<void>;
};

/** One sentence when the assessment finished, or the documents became stale, between two reports; empty when neither. */
export function specAnnouncement(before: SpecContextReport, after: SpecContextReport): string {
  const parts: string[] = [];
  const was = before.alignment?.state;
  if ((was === 'pending' || was === 'running') && after.alignment?.state === 'completed') parts.push('Specification assessment finished');
  if (!before.stale && after.stale) parts.push('Specification documents are stale');
  return parts.map((p) => `${p}.`).join(' ');
}

export function useSpecContext(sessionId: string, snapshotId: string | undefined): SpecContextState {
  const ctx = useContext(ReviewContext);
  const [report, setReport] = useState<SpecContextReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SpecDocumentView | null>(null);
  const previous = useRef<SpecContextReport | null>(null);
  const latestRequest = useRef(0);

  const load = (id: string): Promise<void> => {
    const mine = (latestRequest.current += 1);
    return getSpecContext(sessionId, id)
      .then((next) => {
        if (mine !== latestRequest.current || next.snapshotId !== id) return; // an older response, or another snapshot's
        const before = previous.current;
        if (before !== null && before.snapshotId === next.snapshotId) {
          const text = specAnnouncement(before, next);
          if (text !== '') ctx.announce(text);
        }
        previous.current = next;
        setReport(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine === latestRequest.current) setError(e instanceof Error ? e.message : SPEC_LABELS.loadFailed);
      });
  };

  useEffect(() => {
    if (snapshotId === undefined) return undefined;
    previous.current = null;
    setReport(null);
    setOpen(null);
    void load(snapshotId);
    return ctx.subscribe({
      'spec-context': (event) => {
        if (event.snapshotId === snapshotId) void load(snapshotId);
      },
    });
  }, [sessionId, snapshotId]);

  return {
    report,
    error,
    open,
    openDocument: setOpen,
    closeDocument: () => setOpen(null),
    retryAssessment: async () => {
      if (snapshotId === undefined) return;
      await retrySpecContext(sessionId, snapshotId);
      await load(snapshotId);
    },
    reload: () => (snapshotId === undefined ? Promise.resolve() : load(snapshotId)),
  };
}
