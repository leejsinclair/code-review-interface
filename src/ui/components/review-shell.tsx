// Review shell (FR-015, FR-016, FR-022, FR-030, FR-032, FR-055, FR-057; R4, R5): wraps every session page. It
// loads the session once, calls `POST /open` once, owns the one live-update stream and shares it, shows the
// review header, navigation and context strip, and keeps scroll per route. Keyed by session id by the app.

import type { ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Question, SessionDetail } from '../../contracts/http.ts';
import { ApiError, getSession, listQuestions, openSession, refreshSession, subscribeSession, type SessionStream, type SessionStreamOptions } from '../api.ts';
import { ACTION_LABELS, REVIEW_NAV_LABELS } from '../labels.ts';
import { createLiveStream, type LiveState, type LiveStream } from '../state/live-stream.ts';
import { ReviewContext, type ReviewContextValue } from '../state/review-context.ts';
import { parseRoute, routeKey, type Route } from '../state/routes.ts';
import { readSession, writeSession } from '../state/view-state.ts';
import { Badge } from './badge.tsx';
import { ContextVersion } from './claims.tsx';
import { LiveBanner } from './live-banner.tsx';
import { PanelHost } from './panel-host.tsx';
import { SessionActions } from './session-actions.tsx';

type Handlers = Parameters<ReviewContextValue['subscribe']>[0];
const overviewHref = (id: string): string => `#/sessions/${encodeURIComponent(id)}`;

/** Restores a saved scroll offset, retrying while the page is still growing. */
function restoreScroll(y: number): void {
  let tries = 0;
  const step = (): void => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 2 && tries++ < 20) setTimeout(step, 50);
  };
  requestAnimationFrame(step);
}

export function ReviewShell(props: { sessionId: string; children?: ComponentChildren }) {
  const { sessionId } = props;
  const outer = useContext(ReviewContext);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [live, setLive] = useState<LiveState>('connecting');
  const [hash, setHash] = useState(location.hash);
  const [busy, setBusy] = useState(false);
  const listeners = useRef(new Set<Handlers>());
  const stream = useRef<SessionStream | null>(null);
  const model = useRef<LiveStream | null>(null);
  const prevHash = useRef(location.hash);

  const fail = (e: unknown): void => {
    if (e instanceof ApiError && e.status === 404) setGone(true);
    else setError(e instanceof Error ? e.message : 'The request failed.');
  };
  const reloadDetail = useCallback(() => getSession(sessionId).then((d) => (setDetail(d), setError(null))).catch(fail), [sessionId]);
  const reloadQuestions = useCallback(() => listQuestions(sessionId).then(setQuestions).catch(() => undefined), [sessionId]);

  const open = useCallback((): void => {
    stream.current?.close();
    const each = (key: keyof Handlers) => (data: unknown): void => {
      for (const l of listeners.current) (l[key] as ((d: unknown) => void) | undefined)?.(data);
    };
    const options: SessionStreamOptions = {
      session: (d) => (each('session')(d), void reloadDetail()),
      snapshot: (d) => (each('snapshot')(d), void reloadDetail()),
      question: (d) => (each('question')(d), void reloadQuestions()),
      'answer-delta': each('answer-delta'),
      summary: each('summary'),
      'summary-delta': each('summary-delta'),
      onQuestions: (q) => {
        setQuestions(q);
        for (const l of listeners.current) l.onQuestions?.(q);
      },
      onSummaries: (id, s) => {
        for (const l of listeners.current) l.onSummaries?.(id, s);
      },
      onOpen: () => model.current?.opened(),
      onError: (rs) => {
        model.current?.errored(rs);
        void getSession(sessionId).catch(fail); // a deleted session answers 404
      },
    };
    stream.current = subscribeSession(sessionId, options);
  }, [sessionId, reloadDetail, reloadQuestions]);

  useEffect(() => {
    model.current = createLiveStream(setLive);
    openSession(sessionId)
      .then((d) => (setDetail(d), void reloadQuestions()))
      .catch(fail);
    open();
    const onHash = (): void => {
      const prev = parseRoute(prevHash.current);
      writeSession(sessionId, { scroll: { [routeKey(prev)]: Math.round(window.scrollY) } });
      prevHash.current = location.hash;
      setHash(location.hash);
    };
    addEventListener('hashchange', onHash);
    return () => {
      removeEventListener('hashchange', onHash);
      stream.current?.close();
      model.current?.dispose();
    };
  }, [sessionId]);

  const route: Route = parseRoute(hash);
  useEffect(() => {
    const y = readSession(sessionId).scroll[routeKey(route)];
    if (y !== undefined && y > 0) restoreScroll(y);
    else window.scrollTo(0, 0);
  }, [hash, sessionId, detail === null]);

  const reconnect = (): void => {
    model.current?.reconnect();
    open();
    void reloadDetail();
    void reloadQuestions().then(() => undefined);
  };

  const value = useMemo<ReviewContextValue>(
    () => ({
      ...(detail === null ? {} : { session: detail }),
      subscribe(handlers) {
        listeners.current.add(handlers);
        return () => void listeners.current.delete(handlers);
      },
      announce: outer.announce,
      openAsk: outer.openAsk,
      openEvidence: outer.openEvidence,
    }),
    [detail, outer.announce, outer.openAsk, outer.openEvidence],
  );

  if (gone) {
    return (
      <p data-testid="session-unavailable" class="notice">
        This session is no longer available; it may have been deleted or closed elsewhere. <a href="#/">Back to the dashboard</a>
      </p>
    );
  }
  if (detail === null) return <p class="muted">{error ?? 'Opening the session…'}</p>;

  const askBlock = detail.readOnly
    ? `This pull request is ${detail.prStatus}, so it cannot be refreshed or asked new questions.`
    : !detail.repositoryAvailable
      ? (detail.repositoryReason ?? 'The repository is no longer found under the base folder.')
      : null;
  const running = questions.some((q) => q.state === 'queued' || q.state === 'in_progress');
  const latest = detail.snapshots[detail.snapshots.length - 1];
  const here = route.name === 'overview' ? 'overview' : route.name === 'diff' || route.name === 'code' ? 'files' : route.name === 'ask' ? 'questions' : route.name === 'description' || route.name === 'issue' ? 'sources' : '';
  const base = overviewHref(sessionId);
  const tab = (id: 'overview' | 'files' | 'questions' | 'sources', href: string, extra: Record<string, string> = {}) => (
    <a key={id} href={href} aria-current={here === id ? 'page' : undefined} {...extra}>
      {REVIEW_NAV_LABELS[id]}
    </a>
  );
  const refresh = (): void => {
    if (askBlock !== null || busy) return;
    setBusy(true);
    refreshSession(sessionId)
      .then(setDetail)
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return (
    <ReviewContext.Provider value={value}>
      <LiveBanner state={live} onReconnect={reconnect} />
      <a class="back-link" data-testid="back-to-dashboard" href="#/">
        ‹ Back to dashboard
      </a>
      <header class="review-header" data-testid="review-header">
        <p class="meta">{detail.repository}</p>
        <p class="pr-title">
          <strong>{`#${detail.prNumber} ${detail.title}`}</strong>
        </p>
        <p class="meta">{`${detail.author} · ${detail.sourceBranch} → ${detail.targetBranch}`}</p>
        <span data-testid="session-status" data-status={detail.prStatus}>
          <Badge kind="pr-status" status={detail.prStatus} />
        </span>
        {latest !== undefined && <span class="meta">{`Head ${latest.headCommit.slice(0, 7)} · snapshot ${latest.takenAt}`}</span>}
        <ContextVersion value={latest?.diffFingerprint ?? ''} />
        <button type="button" data-testid="refresh-button" aria-disabled={askBlock !== null || busy ? 'true' : undefined} onClick={refresh}>
          {detail.headMoved ? ACTION_LABELS.newCommitsRefresh : 'Refresh'}
        </button>
        {detail.readOnly && (
          <p class="notice" data-testid="read-only-notice">
            {`This PR is ${detail.prStatus}; the session is read-only.`}
            {detail.statusNote !== undefined ? ` Note: ${detail.statusNote}.` : ''}
          </p>
        )}
        {askBlock !== null && !detail.readOnly && (
          <p class="muted" data-testid="repository-unavailable">
            {askBlock}
          </p>
        )}
        {askBlock !== null && detail.readOnly && <p class="muted">{askBlock}</p>}
        <SessionActions sessionId={sessionId} />
      </header>
      <PanelHost sessionId={sessionId}>
        <nav aria-label="Review" data-testid="review-nav" class="review-nav">
          {tab('overview', base)}
          {tab('files', `${base}/diff`)}
          <a
            href={`${base}/ask`}
            data-testid="review-nav-questions"
            data-count={String(questions.length)}
            data-running={running ? 'true' : 'false'}
            aria-current={here === 'questions' ? 'page' : undefined}
          >
            {`${REVIEW_NAV_LABELS.questions} (${questions.length})${running ? ' · running' : ''}`}
          </a>
          {tab('sources', `${base}/description`)}
          {here !== 'files' && <AskAboutPr blocked={askBlock !== null} />}
        </nav>
        <p class="context-strip" data-testid="context-strip">
          {detail.completeness.map((row) => (
            <a
              key={row.source}
              href={base}
              onClick={(e) => {
                e.preventDefault();
                const target = () => document.getElementById(`completeness-${row.source}`)?.scrollIntoView({ block: 'center' });
                if (route.name === 'overview') target();
                else {
                  location.hash = base;
                  setTimeout(target, 400);
                }
              }}
            >
              {`${row.source === 'pr' ? 'PR' : row.source === 'repository' ? 'Repository' : 'Issue'}: ${row.status}`}
            </a>
          ))}
        </p>
        {props.children}
      </PanelHost>
    </ReviewContext.Provider>
  );
}

/** Inside the panel host, so `openAsk` opens the panel beside the page rather than navigating. */
function AskAboutPr(props: { blocked: boolean }) {
  const ctx = useContext(ReviewContext);
  return (
    <button
      type="button"
      id="ask-about-pr"
      class="ask-about-pr"
      data-testid="ask-about-pr"
      aria-disabled={props.blocked ? 'true' : undefined}
      onClick={() => !props.blocked && ctx.openAsk({ type: 'pr' }, 'ask-about-pr')}
    >
      {ACTION_LABELS.askAboutPr}
    </button>
  );
}
