// Home screen (`#/`, FR-039, FR-052 to FR-055): the dashboard. Your review sessions first, then the open
// pull requests of every repository found under the base folder, merged and sorted newest first. Each
// repository loads and fails on its own; filters work over the loaded rows only, and the filter and
// scroll position come back when the reviewer returns here.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { PullGroup, PullSummary, SessionSummary, Workspace } from '../../contracts/http.ts';
import { createSession, getWorkspace, listPullGroups, listSessions } from '../api.ts';
import { AsyncRegion } from '../components/async-region.tsx';
import { ACTION_LABELS, DASHBOARD_LABELS, homeEmptyState } from '../labels.ts';
import { readDashboard, writeDashboard } from '../state/view-state.ts';

const open = (sessionId: string): void => {
  location.hash = `#/sessions/${encodeURIComponent(sessionId)}`;
};

const reasonOf = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

/** Newest first, then repository, then number, so the order is stable (FR-052). */
export function mergePulls(groups: readonly PullGroup[]): PullSummary[] {
  return groups
    .filter((g) => g.status === 'loaded')
    .flatMap((g) => g.pulls)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) || (a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : 0) || a.number - b.number);
}

const matches = (pr: PullSummary, text: string): boolean =>
  [pr.repository, `#${pr.number}`, String(pr.number), pr.title, pr.author, pr.sourceBranch, pr.targetBranch].some((v) => v.toLowerCase().includes(text));

type Loaded<T> = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'loaded'; value: T };

export function HomeScreen() {
  const saved = useRef(readDashboard());
  const [sessions, setSessions] = useState<Loaded<SessionSummary[]>>({ state: 'loading' });
  const [workspace, setWorkspace] = useState<Loaded<Workspace>>({ state: 'loading' });
  const [groups, setGroups] = useState<PullGroup[] | null>(null);
  const [retrying, setRetrying] = useState<string[]>([]);
  const [text, setText] = useState(saved.current.text);
  const [repository, setRepository] = useState<string | null>(saved.current.repository);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  const loadSessions = (): void => {
    setSessions({ state: 'loading' });
    listSessions().then(
      (value) => setSessions({ state: 'loaded', value }),
      (e: unknown) => setSessions({ state: 'failed', reason: reasonOf(e, 'The session list did not load.') }),
    );
  };

  const loadAll = (): (() => void) => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setWorkspace({ state: 'loading' });
    setGroups(null);
    const tick = (): void => {
      getWorkspace().then(
        (value) => {
          if (cancelled) return;
          setWorkspace({ state: 'loaded', value });
          if (value.discovery.state === 'scanning') {
            timer = setTimeout(tick, 1000);
            return;
          }
          listPullGroups().then(
            (found) => !cancelled && setGroups(found),
            (e: unknown) => !cancelled && setWorkspace({ state: 'failed', reason: reasonOf(e, 'The open pull requests did not load.') }),
          );
        },
        (e: unknown) => !cancelled && setWorkspace({ state: 'failed', reason: reasonOf(e, 'The base folder could not be read.') }),
      );
    };
    tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  };

  useEffect(() => {
    loadSessions();
    return loadAll();
  }, []);

  // A stored repository that is no longer matched resets to "all" (data-model 4.2).
  useEffect(() => {
    if (groups !== null && repository !== null && !groups.some((g) => g.repository === repository)) {
      setRepository(null);
      writeDashboard({ repository: null });
    }
  }, [groups]);

  // Restore the scroll position once the rows have rendered (FR-055); remember it as the reviewer scrolls.
  useEffect(() => {
    if (groups !== null && !restored.current) {
      restored.current = true;
      if (saved.current.scroll > 0) window.scrollTo(0, saved.current.scroll);
    }
  }, [groups]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The last position seen while Home was showing: leaving the page shrinks it, so it is never read at unmount.
    let last = saved.current.scroll;
    const onScroll = (): void => {
      last = Math.round(window.scrollY);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => writeDashboard({ scroll: last }), 100);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer !== undefined) clearTimeout(timer);
      writeDashboard({ scroll: last });
    };
  }, []);

  const retryGroup = (repo: string): void => {
    setRetrying((r) => [...r, repo]);
    listPullGroup(repo)
      .then((group) => setGroups((current) => (current ?? []).map((g) => (g.repository === repo ? group : g))))
      .catch((e: unknown) =>
        setGroups((current) => (current ?? []).map((g) => (g.repository === repo ? { ...g, status: 'failed', reason: reasonOf(e, 'Could not load.') } : g))),
      )
      .finally(() => setRetrying((r) => r.filter((x) => x !== repo)));
  };

  const start = async (pr: PullSummary): Promise<void> => {
    if (pr.sessionId !== undefined) {
      open(pr.sessionId);
      return;
    }
    const key = `${pr.repository}-${pr.number}`;
    setStarting(key);
    setError(null);
    try {
      open((await createSession(pr.repository, pr.number)).sessionId);
    } catch (e) {
      setError(reasonOf(e, 'The session could not be started.'));
    } finally {
      setStarting(null);
    }
  };

  const setTextFilter = (value: string): void => {
    setText(value);
    writeDashboard({ text: value });
  };
  const setRepositoryFilter = (value: string): void => {
    const next = value === '' ? null : value;
    setRepository(next);
    writeDashboard({ repository: next });
  };
  const clearFilters = (): void => {
    setText('');
    setRepository(null);
    writeDashboard({ text: '', repository: null });
  };

  const baseFolder = workspace.state === 'loaded' ? workspace.value.baseFolder : '';
  const all = groups === null ? [] : mergePulls(groups);
  const needle = text.trim().toLowerCase();
  const rows = all.filter((pr) => (repository === null || pr.repository === repository) && (needle === '' || matches(pr, needle)));
  const failedGroups = (groups ?? []).filter((g) => g.status === 'failed');
  const skipped = workspace.state === 'loaded' ? workspace.value.skipped.length : 0;
  const sessionList = sessions.state === 'loaded' ? sessions.value : [];

  return (
    <div class="stack dashboard">
      <h1 class="page-header">Home</h1>

      <section class="panel stack" aria-labelledby="home-sessions">
        <h2 id="home-sessions">{DASHBOARD_LABELS.yourReviewSessions}</h2>
        <AsyncRegion
          region="sessions"
          label="your review sessions"
          {...(sessions.state === 'failed'
            ? { state: 'failed' as const, reason: sessions.reason, retry: loadSessions }
            : sessions.state === 'loading'
              ? { state: 'loading' as const }
              : sessionList.length === 0
                ? { state: 'empty' as const, explanation: 'You have not started a review yet.', nextStep: 'Pick a pull request below.' }
                : { state: 'loaded' as const })}
        >
          <ul class="list" data-testid="session-list">
            {sessionList.map((s) => (
              <li key={s.sessionId} data-testid={`session-item-${s.sessionId}`}>
                <span class="muted">{`${s.repository} `}</span>
                <a href={`#/sessions/${encodeURIComponent(s.sessionId)}`}>{`#${s.prNumber} ${s.title}`}</a>{' '}
                <span class="chip" data-testid="session-status" data-status={s.prStatus}>
                  {s.prStatus}
                </span>
                {s.statusNote !== undefined && <span class="muted">{` ${s.statusNote}`}</span>}{' '}
                {!s.repositoryAvailable && (
                  <span data-testid={`session-read-only-${s.sessionId}`}>
                    <a href={`#/sessions/${encodeURIComponent(s.sessionId)}`}>Open (read only)</a>
                    <span class="muted">{` ${s.repositoryReason ?? ''}`}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </AsyncRegion>
      </section>

      <section class="panel stack" aria-labelledby="home-pulls">
        <h2 id="home-pulls">{DASHBOARD_LABELS.openPullRequests}</h2>
        {error !== null && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {skipped > 0 && (
          <p class="muted">
            <a href="#/setup" data-testid="skipped-repositories">{`${skipped} ${skipped === 1 ? 'folder was' : 'folders were'} skipped`}</a>
          </p>
        )}
        {workspace.state === 'failed' && (
          <AsyncRegion region="workspace" label="the base folder" state="failed" reason={workspace.reason} retry={() => void loadAll()} />
        )}
        {workspace.state !== 'failed' && groups === null && (
          <AsyncRegion region="pulls" label={DASHBOARD_LABELS.openPullRequests.toLowerCase()} state="loading" />
        )}
        {groups !== null && groups.length === 0 && (
          <p data-testid="dashboard-no-repositories">
            {`No repositories were found under ${baseFolder} on the chosen platform. `}
            <a href="#/setup">Check the base folder in Setup</a>
          </p>
        )}
        {failedGroups.map((g) => (
          <div key={g.repository} data-testid={`pr-group-failed-${g.repository}`}>
            <h3 class="muted">{g.repository}</h3>
            <AsyncRegion
              region="pulls"
              retrySuffix={g.repository}
              label={`pull requests of ${g.repository}`}
              {...(retrying.includes(g.repository)
                ? { state: 'loading' as const }
                : { state: 'failed' as const, reason: g.reason ?? 'unknown', retry: () => retryGroup(g.repository) })}
            />
          </div>
        ))}
        {groups !== null && groups.length > 0 && (
          <div class="dashboard-filters" role="search">
            <label>
              Filter
              <input type="search" data-testid="dashboard-filter" value={text} maxLength={200} onInput={(e) => setTextFilter((e.currentTarget as HTMLInputElement).value)} />
            </label>{' '}
            <label>
              Repository
              <select data-testid="dashboard-repository-filter" value={repository ?? ''} onChange={(e) => setRepositoryFilter((e.currentTarget as HTMLSelectElement).value)}>
                <option value="">All repositories</option>
                {groups.map((g) => (
                  <option key={g.repository} value={g.repository}>
                    {g.repository}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {groups !== null && groups.length > 0 && all.length === 0 && failedGroups.length < groups.length && (
          <p data-testid="dashboard-empty">{homeEmptyState(baseFolder)}</p>
        )}
        {all.length > 0 && rows.length === 0 && (
          <p data-testid="dashboard-filter-empty">
            No pull requests match the filter.{' '}
            <button type="button" class="button" data-testid="dashboard-filter-clear" onClick={clearFilters}>
              Clear filters
            </button>
          </p>
        )}
        <ul class="list" data-testid="pr-list">
          {rows.map((pr) => {
            const key = `${pr.repository}-${pr.number}`;
            return (
              <li key={key} data-testid={`pr-item-${key}`} aria-busy={starting === key ? 'true' : undefined}>
                <span class="muted">{`${pr.repository} `}</span>
                <strong>{`#${pr.number} ${pr.title}`}</strong>
                <span class="muted">{` ${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch} · `}</span>
                <time dateTime={pr.updatedAt}>{new Date(pr.updatedAt).toLocaleString()}</time>{' '}
                <button class="button" type="button" data-testid={pr.sessionId === undefined ? 'start-review' : 'resume-review'} disabled={starting !== null} onClick={() => void start(pr)}>
                  {pr.sessionId === undefined ? ACTION_LABELS.startReview : ACTION_LABELS.resumeReview}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const listPullGroup = (repo: string): Promise<PullGroup> => listPullGroups(repo);
