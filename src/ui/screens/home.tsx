// Home screen (`#/`, FR-039, FR-052 to FR-055): the dashboard. Your review sessions first, then the open
// pull requests of every repository found under the base folder, merged and sorted newest first. Each
// repository loads and fails on its own; filters work over the loaded rows only, and the filter and
// scroll position come back when the reviewer returns here.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { PullGroup, PullSummary, SessionSummary, Workspace } from '../../contracts/http.ts';
import { createSession, getConfig, getPlatforms, getWorkspace, listCachedPullGroups, listPullGroups, listSessions } from '../api.ts';
import { CircleCheck, Clock, ExternalLink, Play, StepForward } from 'lucide-preact';
import { AsyncRegion } from '../components/async-region.tsx';
import { IconButton } from '../components/icon-button.tsx';
import { SessionQueue } from '../components/session-queue.tsx';
import { ACTION_LABELS, DASHBOARD_LABELS, PR_FLAG_LABELS, homeEmptyState, openOnPlatform } from '../labels.ts';
import { groupId, groupPullsByIssue } from '../state/issue-groups.ts';
import { ageDays, isStale, STALE_DAYS } from '../state/pull-buckets.ts';
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

/** One pull request row, shared by the current, approved and older lists. */
function PullRow(props: { pr: PullSummary; now: number; starting: string | null; platformLabel: string; onStart: (pr: PullSummary) => void }) {
  const { pr, now, starting } = props;
  const key = `${pr.repository}-${pr.number}`;
  const days = ageDays(pr, now);
  const resume = pr.sessionId !== undefined;
  return (
    <li data-testid={`pr-item-${key}`} aria-busy={starting === key ? 'true' : undefined}>
      <span class="muted">{`${pr.repository} `}</span>
      <strong>{`#${pr.number} ${pr.title}`}</strong>
      <span class="muted">{` ${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch} · `}</span>
      <time dateTime={pr.updatedAt}>{new Date(pr.updatedAt).toLocaleString()}</time>
      <span class="pr-flags">
        {pr.approvedByMe === true && (
          <span class="badge" data-kind="approved" data-testid="pr-approved">
            <CircleCheck size={14} aria-hidden="true" focusable="false" />
            {PR_FLAG_LABELS.approved}
          </span>
        )}
        {isStale(pr, now) && (
          <span class="badge" data-kind="stale" data-testid="pr-stale" title={`No activity for ${days} days (stale after ${STALE_DAYS})`}>
            <Clock size={14} aria-hidden="true" focusable="false" />
            {PR_FLAG_LABELS.stale}
          </span>
        )}
      </span>{' '}
      {pr.webUrl !== undefined && (
        <a class="icon-button" href={pr.webUrl} target="_blank" rel="noopener noreferrer" aria-label={props.platformLabel} title={props.platformLabel} data-testid="pr-open-on-platform">
          <ExternalLink size={16} aria-hidden="true" focusable="false" />
        </a>
      )}{' '}
      <IconButton
        icon={resume ? StepForward : Play}
        label={resume ? ACTION_LABELS.resumeReview : ACTION_LABELS.startReview}
        data-testid={resume ? 'resume-review' : 'start-review'}
        {...(resume ? { class: 'in-progress' } : {})}
        disabled={starting !== null}
        onClick={() => props.onStart(pr)}
      />
    </li>
  );
}

type Loaded<T> = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'loaded'; value: T };

export function HomeScreen() {
  const saved = useRef(readDashboard());
  const [sessions, setSessions] = useState<Loaded<SessionSummary[]>>({ state: 'loading' });
  const [workspace, setWorkspace] = useState<Loaded<Workspace>>({ state: 'loading' });
  const [groups, setGroups] = useState<PullGroup[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retrying, setRetrying] = useState<string[]>([]);
  const [text, setText] = useState(saved.current.text);
  const [hideApproved, setHideApproved] = useState(saved.current.hideApproved);
  const [repository, setRepository] = useState<string | null>(saved.current.repository);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(saved.current.collapsedGroups);
  const [projectKeys, setProjectKeys] = useState<string[]>([]);
  const [collapsedLanes, setCollapsedLanes] = useState<string[]>(saved.current.collapsedLanes);
  const [platformNames, setPlatformNames] = useState<Record<string, string>>({});
  const now = useRef(Date.now()).current;
  const restored = useRef(false);

  const loadSessions = (): void => {
    setSessions({ state: 'loading' });
    reloadSessions();
  };
  /** Re-reads the sessions in place (no loading state), so the list does not flash. */
  const reloadSessions = (): void => {
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
    setRefreshing(false);
    setRefreshFailed(false);
    let fresh = false;
    let showingCached = false;
    let scanned = false;
    const tick = (): void => {
      getWorkspace().then(
        (value) => {
          if (cancelled) return;
          setWorkspace({ state: 'loaded', value });
          if (value.discovery.state === 'scanning') {
            scanned = true;
            timer = setTimeout(tick, 1000);
            return;
          }
          // Sessions read while discovery ran were marked read only; read them again now the clones are known.
          if (scanned) reloadSessions();
          // Show the last known list at once while the fresh one loads behind it.
          const cachedShown = listCachedPullGroups().then(
            (cached) => {
              if (cancelled || fresh || cached.length === 0) return;
              showingCached = true;
              setGroups(cached);
              setRefreshing(true);
            },
            () => undefined,
          );
          listPullGroups().then(
            (found) => {
              if (cancelled) return;
              fresh = true;
              setGroups(found);
              setRefreshing(false);
            },
            async (e: unknown) => {
              // The cached answer may still be on its way; settle it first so its rows are kept, not dropped.
              await cachedShown;
              if (cancelled) return;
              fresh = true;
              setRefreshing(false);
              if (showingCached) setRefreshFailed(true);
              else setWorkspace({ state: 'failed', reason: reasonOf(e, 'The open pull requests did not load.') });
            },
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
    // The configured issue tracker projects narrow which keys count; if they cannot be read, any key counts.
    getConfig().then(
      (config) => setProjectKeys(config?.issueTracker.projectKeys ?? []),
      () => undefined,
    );
    // Display names ("Bitbucket") for the external links; without them the platform id is shown.
    getPlatforms().then(
      (p) => setPlatformNames(Object.fromEntries(p.descriptors.map((d) => [d.id, d.displayName]))),
      () => undefined,
    );
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
  const setHideApprovedFilter = (value: boolean): void => {
    setHideApproved(value);
    writeDashboard({ hideApproved: value });
  };
  const clearFilters = (): void => {
    setText('');
    setRepository(null);
    writeDashboard({ text: '', repository: null });
  };

  const baseFolder = workspace.state === 'loaded' ? workspace.value.baseFolder : '';
  const all = groups === null ? [] : mergePulls(groups);
  const needle = text.trim().toLowerCase();
  const matched = all.filter((pr) => (repository === null || pr.repository === repository) && (needle === '' || matches(pr, needle)));
  const rows = hideApproved ? matched.filter((pr) => pr.approvedByMe !== true) : matched;
  const approvedHidden = matched.length - rows.length;
  const issueGroups = groupPullsByIssue(rows, projectKeys);
  const failedGroups = (groups ?? []).filter((g) => g.status === 'failed');
  const skipped = workspace.state === 'loaded' ? workspace.value.skipped.length : 0;
  // Merged or closed pull requests are finished: they drop off the list.
  const sessionList = sessions.state === 'loaded' ? sessions.value.filter((s) => s.prStatus === 'open') : [];
  const platformName = (platform: string): string => platformNames[platform] ?? platform;
  const pullPlatformLabel = openOnPlatform(workspace.state === 'loaded' ? platformName(workspace.value.platform) : 'the platform');

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
          <SessionQueue
            sessions={sessionList}
            pulls={all}
            now={now}
            platformName={platformName}
            collapsed={collapsedLanes}
            onCollapsedChange={(next) => {
              setCollapsedLanes(next);
              writeDashboard({ collapsedLanes: next });
            }}
          />
        </AsyncRegion>
      </section>

      <section class="panel stack" aria-labelledby="home-pulls">
        <h2 id="home-pulls">{DASHBOARD_LABELS.openPullRequests}</h2>
        {refreshing && (
          <p class="muted" role="status" data-testid="pulls-refreshing">{DASHBOARD_LABELS.refreshing}</p>
        )}
        {refreshFailed && (
          <p class="muted" data-testid="pulls-refresh-failed">{DASHBOARD_LABELS.refreshFailed}</p>
        )}
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
            </label>{' '}
            <label>
              <input type="checkbox" data-testid="dashboard-hide-approved" checked={hideApproved} onChange={(e) => setHideApprovedFilter((e.currentTarget as HTMLInputElement).checked)} />{' '}
              {DASHBOARD_LABELS.hideApproved}
            </label>
            {approvedHidden > 0 && (
              <span class="muted" data-testid="dashboard-approved-hidden">{` ${approvedHidden} hidden`}</span>
            )}
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
        {(groups ?? []).filter((g) => g.approvalsNote !== undefined).map((g) => (
          <p key={g.repository} class="muted" data-testid={`approvals-note-${g.repository}`}>{`${g.repository}: ${g.approvalsNote}`}</p>
        ))}
        {issueGroups.map((g) => {
          const id = groupId(g);
          const isOpen = !collapsed.includes(id);
          return (
            <details
              key={id}
              class="pr-group"
              data-testid={`pr-group-${id}`}
              open={isOpen}
              onToggle={(e) => {
                const nowOpen = (e.currentTarget as HTMLDetailsElement).open;
                if (nowOpen === isOpen) return;
                const next = nowOpen ? collapsed.filter((c) => c !== id) : [...collapsed, id];
                setCollapsed(next);
                writeDashboard({ collapsedGroups: next });
              }}
            >
              <summary>{`${g.key ?? DASHBOARD_LABELS.noIssueKey} (${g.pulls.length})`}</summary>
              <ul class="list" data-testid="pr-list">
                {g.pulls.map((pr) => (
                  <PullRow key={`${pr.repository}-${pr.number}`} pr={pr} now={now} starting={starting} platformLabel={pullPlatformLabel} onStart={(p) => void start(p)} />
                ))}
              </ul>
            </details>
          );
        })}
      </section>
    </div>
  );
}

const listPullGroup = (repo: string): Promise<PullGroup> => listPullGroups(repo);
