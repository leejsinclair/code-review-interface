// Issue view (`#/sessions/:sessionId/issues/:platform/:key`, FR-016): the stored title and
// plain-text description of an issue fetched for the session, as text nodes only.

import { useEffect, useState } from 'preact/hooks';
import type { IssueReference } from '../../contracts/http.ts';
import { getSession } from '../api.ts';

export function IssueScreen(props: { sessionId: string; platform: string; issueKey: string }) {
  const [issue, setIssue] = useState<IssueReference | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession(props.sessionId)
      .then((detail) => setIssue(detail.issues.find((i) => i.platform === props.platform && i.key === props.issueKey) ?? null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the issue.'));
  }, [props.sessionId, props.platform, props.issueKey]);

  if (error !== null) return <p class="error">{error}</p>;
  if (issue === undefined) return <p class="muted">Loading…</p>;
  if (issue === null) return <p class="error">This issue was not referenced in the session.</p>;
  return (
    <article class="panel stack" data-testid="issue-view">
      <h1>{issue.title !== undefined ? `${issue.key} ${issue.title}` : issue.key}</h1>
      {issue.reason !== undefined && <p class="notice">{`${issue.status}: ${issue.reason}`}</p>}
      <pre class="text-block">{issue.descriptionText ?? ''}</pre>
      <a href={`#/sessions/${encodeURIComponent(props.sessionId)}`}>Back to the session</a>
    </article>
  );
}
