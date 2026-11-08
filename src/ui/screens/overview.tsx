// Review session overview (`#/sessions/:sessionId`, plan screen `overview`, FR-007, FR-041, FR-049):
// title, branches and status; Refresh only while the PR is open, otherwise the read-only notice with
// any status note; Close; Delete after a confirmation; the completeness rows; issues with reasons;
// skipped files with their reasons; changed files linking to the diff. Summaries are added by US2
// through `children`, a render function given the current detail so they follow a refresh. Every PR and issue string is rendered as text.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CompletenessRow, SessionDetail, SnapshotDetail } from '../../contracts/http.ts';
import { closeSession, deleteSession, getSnapshot, openSession, refreshSession } from '../api.ts';
import { COMPLETENESS_STATUS_LABELS } from '../labels.ts';

const ROW_LABELS: Record<CompletenessRow['source'], string> = { pr: 'PR', repository: 'Repository', issue: 'Issue' };
const SKIP_LABELS: Record<string, string> = {
  binary: 'binary',
  'file-too-large': 'file too large',
  'too-many-changed-lines': 'too many changed lines',
  'prompt limit': 'prompt limit',
};

const sessionHash = (sessionId: string, rest = ''): string => `#/sessions/${encodeURIComponent(sessionId)}${rest}`;

function Row(props: { row: CompletenessRow; sessionId: string }) {
  const { row, sessionId } = props;
  return (
    <li data-testid={`completeness-row-${row.source}`} data-status={row.status}>
      <strong>{ROW_LABELS[row.source]}</strong> <span class="chip">{COMPLETENESS_STATUS_LABELS[row.status]}</span>
      {row.reason !== undefined && <span class="muted">{` ${row.reason}`}</span>}
      {row.source === 'issue' && row.issues.length > 0 && (
        <ul class="list">
          {row.issues.map((issue) => (
            <li key={issue.key} data-testid={`completeness-issue-${issue.platform}-${issue.key}`} data-status={issue.status}>
              <a href={sessionHash(sessionId, `/issues/${encodeURIComponent(issue.platform)}/${encodeURIComponent(issue.key)}`)}>
                {issue.title !== undefined ? `${issue.key} ${issue.title}` : issue.key}
              </a>{' '}
              <span class="chip">{COMPLETENESS_STATUS_LABELS[issue.status]}</span>
              {issue.reason !== undefined && <span class="muted">{` ${issue.reason}`}</span>}
              <span class="muted">{` found in ${issue.origins.join(', ')}`}</span>
            </li>
          ))}
        </ul>
      )}
      {row.source === 'repository' && row.skippedFiles.length > 0 && (
        <ul class="list">
          {row.skippedFiles.map((f) => (
            <li key={f.path} data-testid={`skipped-file-${f.path}`} data-reason={f.reason}>
              <span class="mono">{f.path}</span> <span class="muted">{SKIP_LABELS[f.reason] ?? f.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function OverviewScreen(props: { sessionId: string; children?: (detail: SessionDetail) => ComponentChildren }) {
  const { sessionId } = props;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = async (next: SessionDetail): Promise<void> => {
    setDetail(next);
    const latest = next.snapshots.at(-1);
    if (latest !== undefined) setSnapshot(await getSnapshot(sessionId, latest.snapshotId));
  };

  const act = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void act(async () => show(await openSession(sessionId)));
  }, [sessionId]);

  if (detail === null) return <p class="muted">{error ?? 'Opening the session…'}</p>;

  return (
    <div class="stack" data-testid="overview">
      <header class="page-header">
        <h1>{`#${detail.prNumber} ${detail.title}`}</h1>
        <p class="muted">{`${detail.author} · ${detail.sourceBranch} → ${detail.targetBranch} · `}</p>
        <span class="chip" data-testid="session-status" data-status={detail.prStatus}>
          {detail.prStatus}
        </span>
        <a href={sessionHash(sessionId, '/description')}>Description</a>
      </header>
      <div class="tabs">
        {detail.readOnly ? (
          <p class="notice" data-testid="read-only-notice">
            {`This PR is ${detail.prStatus}; the session is read-only.`}
            {detail.statusNote !== undefined ? ` Note: ${detail.statusNote}.` : ''}
          </p>
        ) : (
          <button class="button" type="button" data-testid="refresh-button" disabled={busy} onClick={() => void act(async () => show(await refreshSession(sessionId)))}>
            {detail.headMoved ? 'Refresh (new commits)' : 'Refresh'}
          </button>
        )}
        <button class="button" type="button" data-testid="close-session-button" disabled={busy} onClick={() => void act(async () => {
          await closeSession(sessionId);
          location.hash = '#/';
        })}>
          Close session
        </button>
        {confirming ? (
          <button class="button" type="button" data-testid="delete-session-confirm" disabled={busy} onClick={() => void act(async () => {
            await deleteSession(sessionId);
            location.hash = '#/';
          })}>
            Delete everything in this session
          </button>
        ) : (
          <button class="button" type="button" data-testid="delete-session-button" onClick={() => setConfirming(true)}>
            Delete session
          </button>
        )}
      </div>
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <section class="panel">
        <h2>Context</h2>
        <ul class="list">
          {detail.completeness.map((row) => (
            <Row key={row.source} row={row} sessionId={sessionId} />
          ))}
        </ul>
      </section>
      {detail.issues.some((i) => i.kind === 'pull-request') && (
        <section class="panel">
          <h2>Referenced pull requests</h2>
          <ul class="list">
            {detail.issues
              .filter((i) => i.kind === 'pull-request')
              .map((i) => (
                <li key={i.key} class="mono">
                  {i.key}
                </li>
              ))}
          </ul>
        </section>
      )}
      {props.children?.(detail)}
      <section class="panel">
        <h2>Changed files</h2>
        <ul class="list">
          {(snapshot?.files ?? []).map((f) => (
            <li key={f.path} data-testid={`changed-file-${f.path}`}>
              <a class="mono" href={sessionHash(sessionId, `/diff?path=${encodeURIComponent(f.path)}`)}>
                {f.previousPath !== undefined ? `${f.previousPath} → ${f.path}` : f.path}
              </a>{' '}
              <span class="muted">{`${f.status} +${f.linesAdded} −${f.linesRemoved}`}</span>
              {f.skipped !== undefined && <span class="chip">{SKIP_LABELS[f.skipped] ?? f.skipped}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
