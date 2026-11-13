// Home's review queue (Your review sessions): the open sessions in lanes, most urgent first, one scannable
// line each. Every row opens the session here and the pull request on its platform in a new tab.

import { CircleCheck, Clock, ExternalLink, GitCommitHorizontal, Lock, StepForward } from 'lucide-preact';
import type { PullSummary, SessionSummary } from '../../contracts/http.ts';
import { ACTION_LABELS, ICON_LABELS, PR_FLAG_LABELS, QUEUE_LANE_LABELS, QUEUE_SUMMARY_LABELS, openOnPlatform } from '../labels.ts';
import { ageText, buildQueue, type QueueRow } from '../state/review-queue.ts';
import { STALE_DAYS } from '../state/pull-buckets.ts';
import { RiskBadge } from './risk-badge.tsx';

const sessionHref = (id: string): string => `#/sessions/${encodeURIComponent(id)}`;

/** "creditsense/hd-job" reads as "hd-job"; the full id stays in the tooltip. */
const shortName = (repository: string): string => repository.slice(repository.lastIndexOf('/') + 1);

function Row(props: { row: QueueRow; platformName: (platform: string) => string; sharedReasons: readonly string[] }) {
  const { row, sharedReasons } = props;
  const s = row.session;
  const readOnly = !s.repositoryAvailable;
  const reason = s.repositoryReason ?? '';
  const updated = row.pull?.updatedAt;
  return (
    <li class="queue-row" data-testid={`session-item-${s.sessionId}`} data-lane={row.lane}>
      <span class="queue-risk">
        {s.highestRisk !== undefined ? (
          <RiskBadge riskClass={s.highestRisk} />
        ) : (
          <span class="muted" role="img" aria-label={ICON_LABELS.notClassified} title={ICON_LABELS.notClassified} data-testid="risk-none">
            –
          </span>
        )}
      </span>
      <span class="queue-title">
        <span class="muted" title={s.repository}>{`${shortName(s.repository)} `}</span>
        <a href={sessionHref(s.sessionId)} title={s.title}>{`#${s.prNumber} ${s.title}`}</a>
      </span>
      <span class="queue-meta muted">
        {row.pull !== undefined && <span>{row.pull.author}</span>}
        {row.pull !== undefined && updated !== undefined && row.ageDays !== undefined && (
          <>
            {' · '}
            <time dateTime={updated} title={`Last activity ${new Date(updated).toLocaleString()}`}>
              {ageText(row.ageDays)}
            </time>
          </>
        )}
      </span>
      <span class="queue-flags">
        {row.newCommits && (
          <span class="badge" data-kind="new-commits" data-testid="session-new-commits">
            <GitCommitHorizontal size={14} aria-hidden="true" focusable="false" />
            {PR_FLAG_LABELS.newCommits}
          </span>
        )}
        {row.approved && (
          <span class="badge" data-kind="approved" data-testid="pr-approved">
            <CircleCheck size={14} aria-hidden="true" focusable="false" />
            {PR_FLAG_LABELS.approved}
          </span>
        )}
        {row.stale && (
          <span class="badge" data-kind="stale" data-testid="pr-stale" title={`No activity for ${row.ageDays ?? 0} days (stale after ${STALE_DAYS})`}>
            <Clock size={14} aria-hidden="true" focusable="false" />
            {PR_FLAG_LABELS.stale}
          </span>
        )}
        {s.statusNote !== undefined && (
          <span class="chip" data-testid="session-status" data-status={s.prStatus}>
            {s.statusNote}
          </span>
        )}
        {readOnly && !sharedReasons.includes(reason) && reason !== '' && (
          <span class="muted queue-reason" data-testid={`session-read-only-reason-${s.sessionId}`}>
            {reason}
          </span>
        )}
      </span>
      <span class="queue-actions">
        {s.webUrl !== undefined && (
          <a
            class="icon-button"
            href={s.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={openOnPlatform(props.platformName(s.platform))}
            title={openOnPlatform(props.platformName(s.platform))}
            data-testid="session-open-on-platform"
          >
            <ExternalLink size={16} aria-hidden="true" focusable="false" />
          </a>
        )}
        {readOnly ? (
          <a
            class="icon-button"
            href={sessionHref(s.sessionId)}
            aria-label={ICON_LABELS.openReadOnly}
            title={reason === '' ? ICON_LABELS.openReadOnly : `${ICON_LABELS.openReadOnly}: ${reason}`}
            data-testid={`session-read-only-${s.sessionId}`}
          >
            <Lock size={16} aria-hidden="true" focusable="false" />
          </a>
        ) : (
          <a class="icon-button in-progress" href={sessionHref(s.sessionId)} aria-label={ACTION_LABELS.resumeReview} title={ACTION_LABELS.resumeReview} data-testid="resume-review">
            <StepForward size={16} aria-hidden="true" focusable="false" />
          </a>
        )}
      </span>
    </li>
  );
}

export function SessionQueue(props: {
  sessions: readonly SessionSummary[];
  pulls: readonly PullSummary[];
  now: number;
  platformName: (platform: string) => string;
  collapsed: readonly string[];
  onCollapsedChange: (next: string[]) => void;
}) {
  const queue = buildQueue(props.sessions, props.pulls, props.now);
  const lanes = queue.lanes.filter((l) => l.rows.length > 0);
  return (
    <div class="stack queue" data-testid="session-list">
      <p class="queue-summary" data-testid="session-queue-summary">
        {queue.lanes.map((l, i) => (
          <span key={l.id} data-testid={`queue-count-${l.id}`}>
            {i > 0 && <span class="muted" aria-hidden="true">{' · '}</span>}
            <strong>{l.rows.length}</strong>
            {` ${QUEUE_SUMMARY_LABELS[l.id]}`}
          </span>
        ))}
      </p>
      {queue.sharedReasons.map((reason) => (
        <p key={reason} class="muted queue-shared-reason" role="note" data-testid="session-shared-reason">
          <Lock size={14} aria-hidden="true" focusable="false" />
          {` Read only for now: ${reason}`}
        </p>
      ))}
      {lanes.map((lane) => {
        const isOpen = !props.collapsed.includes(lane.id);
        return (
          <details
            key={lane.id}
            class="queue-lane"
            data-testid={`queue-lane-${lane.id}`}
            data-lane={lane.id}
            open={isOpen}
            onToggle={(e) => {
              const nowOpen = (e.currentTarget as HTMLDetailsElement).open;
              if (nowOpen === isOpen) return;
              props.onCollapsedChange(nowOpen ? props.collapsed.filter((c) => c !== lane.id) : [...props.collapsed, lane.id]);
            }}
          >
            <summary>
              {QUEUE_LANE_LABELS[lane.id]} <span class="muted">{`(${lane.rows.length})`}</span>
            </summary>
            <ul class="list queue-list">
              {lane.rows.map((row) => (
                <Row key={row.session.sessionId} row={row} platformName={props.platformName} sharedReasons={queue.sharedReasons} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
