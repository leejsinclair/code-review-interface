// Home screen (`#/`, FR-001, FR-041): the configured repository's open PRs, any of which starts a
// session, and every existing session with its PR's current status (closed and merged included).

import { useEffect, useState } from 'preact/hooks';
import type { PullSummary, SessionSummary } from '../../contracts/http.ts';
import { createSession, listPulls, listSessions } from '../api.ts';

const open = (sessionId: string): void => {
  location.hash = `#/sessions/${encodeURIComponent(sessionId)}`;
};

export function HomeScreen() {
  const [pulls, setPulls] = useState<PullSummary[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => undefined);
    listPulls()
      .then(setPulls)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not list the open pull requests.'));
  }, []);

  const start = async (pr: PullSummary): Promise<void> => {
    if (pr.sessionId !== undefined) {
      open(pr.sessionId);
      return;
    }
    setStarting(pr.number);
    setError(null);
    try {
      open((await createSession(pr.number)).sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The session could not be started.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div class="layout-split">
      <section class="panel stack">
        <h1 class="page-header">Open pull requests</h1>
        {error !== null && <p class="error">{error}</p>}
        {pulls === null && error === null && <p class="muted">Loading…</p>}
        <ul class="list" data-testid="pr-list">
          {(pulls ?? []).map((pr) => (
            <li key={pr.number} data-testid={`pr-item-${pr.number}`}>
              <button class="button" type="button" disabled={starting !== null} onClick={() => void start(pr)}>
                {`#${pr.number} ${pr.title}`}
              </button>
              <span class="muted">{` ${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch}`}</span>
              {pr.sessionId !== undefined && <span class="chip">session</span>}
            </li>
          ))}
        </ul>
      </section>
      <section class="panel stack">
        <h2>Review sessions</h2>
        <ul class="list" data-testid="session-list">
          {sessions.map((s) => (
            <li key={s.sessionId} data-testid={`session-item-${s.sessionId}`}>
              <a href={`#/sessions/${encodeURIComponent(s.sessionId)}`}>{`#${s.prNumber} ${s.title}`}</a>{' '}
              <span class="chip" data-testid="session-status" data-status={s.prStatus}>
                {s.prStatus}
              </span>
              {s.statusNote !== undefined && <span class="muted">{` ${s.statusNote}`}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
