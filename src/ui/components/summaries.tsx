// Summaries panel (FR-012, FR-021, FR-049, FR-051, FR-005, EC-08): the PR summary, one summary per
// changed file, and functional and technical impact, as labelled claims; the streamed raw text while
// a generation is in progress; the files left out of the prompt; a marker when the summary shown was
// produced for an earlier snapshot; the provider's unavailable reason; and, when the latest snapshot
// has no isolated workspace, the repository row's reason. All text is rendered as text nodes (R7).

import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { ProviderStatus, SessionDetail, Summary } from '../../contracts/http.ts';
import { getProvider, listSummaries } from '../api.ts';
import { ReviewContext } from '../state/review-context.ts';
import { AsyncRegion } from './async-region.tsx';
import { Badge } from './badge.tsx';
import { AnswerWarning, ClaimsList, ContextVersion, RestrictionsNotEnforced } from './claims.tsx';

/** The summary to show: the latest snapshot's newest, else the newest of an earlier snapshot. */
async function loadShown(sessionId: string, detail: SessionDetail): Promise<Summary | null> {
  for (const snapshot of [...detail.snapshots].reverse()) {
    const list = await listSummaries(sessionId, snapshot.snapshotId);
    const newest = list[list.length - 1];
    if (newest !== undefined) return newest;
  }
  return null;
}

type SummaryState = { summary: Summary | null; provider: ProviderStatus | null; error: string | null; loading: boolean; retry: () => void };
const SummaryContext = createContext<SummaryState>({ summary: null, provider: null, error: null, loading: false, retry: () => undefined });

/** Loads and live-updates the summary once for the page, so the panel and every file's explanation share it. */
export function SummariesProvider(props: { sessionId: string; detail: SessionDetail; children: ComponentChildren }) {
  const { sessionId, detail } = props;
  const ctx = useContext(ReviewContext);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const reload = (): void => {
      loadShown(sessionId, detail)
        .then((s) => {
          if (!live) return;
          setSummary(s);
          setError(null);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setError(e instanceof Error ? e.message : 'Could not load the summaries.');
          setLoading(false);
        });
    };
    setLoading(true);
    reload();
    getProvider()
      .then((p) => live && setProvider(p))
      .catch(() => undefined);
    const unsubscribe = ctx.subscribe({
      summary: () => reload(),
      'summary-delta': (delta) =>
        setSummary((current) => (current !== null && current.summaryId === delta.summaryId ? { ...current, rawText: `${current.rawText ?? ''}${delta.text}` } : current)),
      onSummaries: () => reload(),
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId, detail, attempt]);

  return <SummaryContext.Provider value={{ summary, provider, error, loading, retry: () => setAttempt((n) => n + 1) }}>{props.children}</SummaryContext.Provider>;
}

/** One file's explanation, disclosed from the file list (FR-025). */
export function FileExplanation(props: { sessionId: string; path: string }) {
  const { summary } = useContext(SummaryContext);
  const file = summary?.files.find((f) => f.path === props.path);
  return (
    <div data-testid={`file-summary-${props.path}`}>
      {file === undefined || summary === null ? <p class="muted">No explanation for this file yet.</p> : <ClaimsList sessionId={props.sessionId} snapshotId={summary.snapshotId} claims={file.claims} />}
    </div>
  );
}

export function SummariesPanel(props: { sessionId: string; detail: SessionDetail }) {
  const { sessionId, detail } = props;
  const { summary, provider, error, loading, retry } = useContext(SummaryContext);
  const latest = detail.snapshots[detail.snapshots.length - 1];
  const repository = detail.completeness.find((row) => row.source === 'repository');
  const state =
    error !== null
      ? ({ state: 'failed', reason: error, retry } as const)
      : loading && summary === null
        ? ({ state: 'loading' } as const)
        : summary === null
          ? ({ state: 'empty', explanation: 'No summary yet.' } as const)
          : ({ state: 'loaded' } as const);

  return (
    <section class="panel stack" data-testid="summaries">
      <h2>Summary</h2>
      {repository !== undefined && repository.status === 'missing' && (
        <p data-testid="workspace-unavailable" class="warning">{`No isolated workspace, so no summaries: ${repository.reason ?? 'repository not available'}`}</p>
      )}
      {provider !== null && !provider.available && (
        <p data-testid="provider-unavailable" class="warning">{`AI provider unavailable: ${provider.unavailableReason ?? 'unknown reason'}`}</p>
      )}
      <AsyncRegion region="summaries" label="the summary" {...state}>
        {summary !== null && (
          <div data-testid={`summary-${summary.summaryId}`} data-state={summary.state} data-head-commit={summary.headCommit}>
            {latest !== undefined && summary.snapshotId !== latest.snapshotId && (
              <p data-testid="older-snapshot-marker">
                <Badge kind="older-head" commit={summary.headCommit} />
              </p>
            )}
            <p class="muted">
              <span>{`State: ${summary.state.replace('_', ' ')} · ${summary.provider} `}</span>
              <ContextVersion value={summary.contextVersion} />
            </p>
            {summary.state === 'failed' && <p class="error">{`Failed: ${summary.failureReason ?? 'the provider failed'}`}</p>}
            {summary.state === 'in_progress' && (
              <pre data-testid="answer-raw-text" class="text-block in-progress">
                {`In progress, not yet checked:\n${summary.rawText ?? ''}`}
              </pre>
            )}
            <AnswerWarning warning={summary.warning} />
            <RestrictionsNotEnforced ids={summary.restrictionsNotEnforced} />
            <section data-testid="pr-summary">
              <h3>Pull request</h3>
              <ClaimsList sessionId={sessionId} snapshotId={summary.snapshotId} claims={summary.prSummary} />
            </section>
            <section data-testid="functional-impact">
              <h3>Functional impact</h3>
              <ClaimsList sessionId={sessionId} snapshotId={summary.snapshotId} claims={summary.functionalImpact} />
            </section>
            <section data-testid="technical-impact">
              <h3>Technical impact</h3>
              <ClaimsList sessionId={sessionId} snapshotId={summary.snapshotId} claims={summary.technicalImpact} />
            </section>
            {summary.skippedFiles.length > 0 && (
              <section>
                <h3>Files left out of the prompt</h3>
                <ul class="list">
                  {summary.skippedFiles.map((f) => (
                    <li key={f.path} data-testid={`skipped-file-${f.path}`} data-reason={f.reason}>
                      <span class="mono">{f.path}</span> <Badge kind="skipped" reason={f.reason} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </AsyncRegion>
    </section>
  );
}
