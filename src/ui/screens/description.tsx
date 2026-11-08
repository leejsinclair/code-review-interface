// PR description view (`#/sessions/:sessionId/description`), the target of a `pr` reference (FR-016).
// The description is shown as a text node, never rendered as HTML or Markdown (R7).

import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail } from '../../contracts/http.ts';
import { getSession } from '../api.ts';

export function DescriptionScreen(props: { sessionId: string }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession(props.sessionId)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the session.'));
  }, [props.sessionId]);

  if (error !== null) return <p class="error">{error}</p>;
  if (detail === null) return <p class="muted">Loading…</p>;
  return (
    <article class="panel stack" data-testid="pr-description">
      <h1>{`#${detail.prNumber} ${detail.title}`}</h1>
      <pre class="text-block">{detail.description === '' ? 'The PR has no description.' : detail.description}</pre>
      <a href={`#/sessions/${encodeURIComponent(props.sessionId)}`}>Back to the session</a>
    </article>
  );
}
