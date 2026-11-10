// Completeness list (FR-009, FR-044): one row per context source with a status badge, reasons shown on request,
// and a stable anchor (`#completeness-<source>`) for the context strip. Rows keep their 001 attributes.

import type { CompletenessRow } from '../../contracts/http.ts';
import { buildRoute } from '../state/routes.ts';
import { Badge } from './badge.tsx';

const ROW_LABELS: Record<CompletenessRow['source'], string> = { pr: 'PR', repository: 'Repository', issue: 'Issue' };

function Row(props: { row: CompletenessRow; sessionId: string }) {
  const { row, sessionId } = props;
  const hasDetail = row.reason !== undefined || (row.source === 'issue' && row.issues.length > 0) || (row.source === 'repository' && row.skippedFiles.length > 0);
  return (
    <li id={`completeness-${row.source}`} data-testid={`completeness-row-${row.source}`} data-status={row.status}>
      <strong>{ROW_LABELS[row.source]}</strong> <Badge kind="completeness" status={row.status} />
      {hasDetail && (
        <details class="completeness-detail">
          <summary>Details</summary>
          {row.reason !== undefined && <p class="muted">{row.reason}</p>}
          {row.source === 'issue' && row.issues.length > 0 && (
            <ul class="list">
              {row.issues.map((issue) => (
                <li key={issue.key} data-testid={`completeness-issue-${issue.platform}-${issue.key}`} data-status={issue.status}>
                  <a href={buildRoute({ name: 'issue', sessionId, platform: issue.platform, key: issue.key })}>{issue.title !== undefined ? `${issue.key} ${issue.title}` : issue.key}</a>{' '}
                  <Badge kind="completeness" status={issue.status} />
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
                  <span class="mono">{f.path}</span> <Badge kind="skipped" reason={f.reason} />
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}

export function CompletenessList(props: { rows: readonly CompletenessRow[]; sessionId: string }) {
  return (
    <section class="panel" data-testid="completeness">
      <h2>Context</h2>
      <ul class="list">
        {props.rows.map((row) => (
          <Row key={row.source} row={row} sessionId={props.sessionId} />
        ))}
      </ul>
    </section>
  );
}
