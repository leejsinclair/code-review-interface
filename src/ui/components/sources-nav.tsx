// Sources sub-navigation (approved proposal 4): Description, then every linked issue including missing ones.
// The current one carries `aria-current="page"`.

import { useContext, useEffect, useState } from 'preact/hooks';
import type { IssueReference, SessionDetail } from '../../contracts/http.ts';
import { getSession } from '../api.ts';
import { ReviewContext } from '../state/review-context.ts';
import { buildRoute } from '../state/routes.ts';

export type SourceCurrent = 'description' | { platform: string; key: string };

export type SessionDetailState = { detail: SessionDetail | null; error: string | null; retry(): void };

/** The session detail from the review shell when it has one, else fetched. */
export function useSessionDetail(sessionId: string): SessionDetailState {
  const ctx = useContext(ReviewContext);
  const [fetched, setFetched] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const shell = ctx.session ?? null;
  useEffect(() => {
    if (shell !== null && shell.sessionId === sessionId) return;
    let live = true;
    setError(null);
    getSession(sessionId)
      .then((d) => live && setFetched(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the session.'));
    return () => {
      live = false;
    };
  }, [sessionId, attempt, shell === null]);
  const detail = shell !== null && shell.sessionId === sessionId ? shell : fetched;
  return { detail, error, retry: () => setAttempt((n) => n + 1) };
}

export function SourcesNav(props: { sessionId: string; issues: readonly IssueReference[]; current: SourceCurrent }) {
  const { sessionId, issues, current } = props;
  const isDescription = current === 'description';
  return (
    <nav aria-label="Sources" data-testid="sources-nav" class="sources-nav">
      <ul class="list">
        <li>
          <a href={buildRoute({ name: 'description', sessionId })} data-testid="sources-description" {...(isDescription ? { 'aria-current': 'page' } : {})}>
            Description
          </a>
        </li>
        {issues.map((issue) => {
          const here = typeof current === 'object' && current.platform === issue.platform && current.key === issue.key;
          const note = issue.status === 'found' ? '' : ` (${issue.status})`;
          return (
            <li key={`${issue.platform}/${issue.key}`}>
              <a
                href={buildRoute({ name: 'issue', sessionId, platform: issue.platform, key: issue.key })}
                data-testid={`sources-issue-${issue.key}`}
                data-status={issue.status}
                {...(here ? { 'aria-current': 'page' } : {})}
              >
                {`${issue.key}${note}`}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
