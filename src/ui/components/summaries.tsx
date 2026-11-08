// Summaries panel (FR-012, FR-021, FR-049, FR-051, FR-005, EC-08): the PR summary, one summary per
// changed file, and functional and technical impact, as labelled claims; the streamed raw text while
// a generation is in progress; the files left out of the prompt; a marker when the summary shown was
// produced for an earlier snapshot; the provider's unavailable reason; and, when the latest snapshot
// has no isolated workspace, the repository row's reason. All text is rendered as text nodes (R7).

import { useEffect, useState } from 'preact/hooks';
import type { ProviderStatus, SessionDetail, Summary } from '../../contracts/http.ts';
import { getProvider, listSummaries, subscribeSession } from '../api.ts';
import { AnswerWarning, ClaimsList, ContextVersion, RestrictionsNotEnforced } from './claims.tsx';

const SKIP_LABELS: Record<string, string> = {
  binary: 'binary',
  'file-too-large': 'file too large',
  'too-many-changed-lines': 'too many changed lines',
  'prompt limit': 'prompt limit',
};

/** The summary to show: the latest snapshot's newest, else the newest of an earlier snapshot. */
async function loadShown(sessionId: string, detail: SessionDetail): Promise<Summary | null> {
  for (const snapshot of [...detail.snapshots].reverse()) {
    const list = await listSummaries(sessionId, snapshot.snapshotId);
    const newest = list[list.length - 1];
    if (newest !== undefined) return newest;
  }
  return null;
}

export function SummariesPanel(props: { sessionId: string; detail: SessionDetail }) {
  const { sessionId, detail } = props;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = detail.snapshots[detail.snapshots.length - 1];
  const repository = detail.completeness.find((row) => row.source === 'repository');

  useEffect(() => {
    let live = true;
    const reload = (): void => {
      loadShown(sessionId, detail)
        .then((s) => live && setSummary(s))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the summaries.'));
    };
    reload();
    getProvider()
      .then((p) => live && setProvider(p))
      .catch(() => undefined);
    const stream = subscribeSession(sessionId, {
      summary: () => reload(),
      'summary-delta': (delta) =>
        setSummary((current) => (current !== null && current.summaryId === delta.summaryId ? { ...current, rawText: `${current.rawText ?? ''}${delta.text}` } : current)),
      onSummaries: () => reload(),
    });
    return () => {
      live = false;
      stream.close();
    };
  }, [sessionId, detail]);

  return (
    <section class="panel stack" data-testid="summaries">
      <h2>Summaries</h2>
      {repository !== undefined && repository.status === 'missing' && (
        <p data-testid="workspace-unavailable" class="warning">{`No isolated workspace, so no summaries: ${repository.reason ?? 'repository not available'}`}</p>
      )}
      {provider !== null && !provider.available && (
        <p data-testid="provider-unavailable" class="warning">{`AI provider unavailable: ${provider.unavailableReason ?? 'unknown reason'}`}</p>
      )}
      {error !== null && <p class="error">{error}</p>}
      {summary === null ? (
        <p class="muted">No summary yet.</p>
      ) : (
        <div data-testid={`summary-${summary.summaryId}`} data-state={summary.state} data-head-commit={summary.headCommit}>
          {latest !== undefined && summary.snapshotId !== latest.snapshotId && (
            <p data-testid="older-snapshot-marker" class="warning">{`Produced for an earlier head commit ${summary.headCommit}`}</p>
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
          {summary.files.map((file) => (
            <section key={file.path} data-testid={`file-summary-${file.path}`}>
              <h3 class="mono">{file.path}</h3>
              <ClaimsList sessionId={sessionId} snapshotId={summary.snapshotId} claims={file.claims} />
            </section>
          ))}
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
                    <span class="mono">{f.path}</span> <span class="muted">{SKIP_LABELS[f.reason] ?? f.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
