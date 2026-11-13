// The reviewer's own decision (feature 005, FR-002 to FR-004, FR-008, FR-009, FR-013, FR-018). Approve, Request
// changes, General comment and Withdraw each post at once on one click: no preview, no confirmation. Request
// changes and General comment need a message; Approve takes an optional one. The panel says plainly that this is
// the reviewer's own decision and never uses readiness wording or styling. A disabled action shows its reason.
// Mounted in the overview and the file view; both read one shared state (use-review-decision.ts).

import { useContext, useRef, useState } from 'preact/hooks';
import type { ReviewAction } from '../../contracts/http.ts';
import type { ReviewCapability } from '../../contracts/source-control-writer.ts';
import { postReviewAction } from '../api.ts';
import { decisionText, REVIEW_LABELS } from '../labels.ts';
import { ReviewContext } from '../state/review-context.ts';
import { useReviewDecision } from '../state/use-review-decision.ts';
import { ActionNotice, failureOf, type ActionFailure } from './action-notice.tsx';

const when = (iso: string): string => iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');

export function DecisionPanel(props: {
  sessionId: string;
  /** The head commit the reviewer is viewing. */
  expectedHead: string;
  /** Called after a general comment is posted, so the pull request comment list can reload. */
  onCommented?: () => void;
}) {
  const { sessionId, expectedHead } = props;
  const ctx = useContext(ReviewContext);
  const { state, error, reload } = useReviewDecision(sessionId);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const running = useRef(false);

  const perform = async (action: ReviewAction, done: string, onOk?: () => void): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await postReviewAction(sessionId, { action, expectedHead, requestId: crypto.randomUUID() });
      setMessage('');
      await reload();
      onOk?.();
      ctx.announce(done);
    } catch (e) {
      setFailure(failureOf(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const text = message.trim();
  const cap = (key: keyof ReviewCapability): { allowed: boolean; reason?: string } => state?.capability[key] ?? { allowed: false, reason: 'Loading…' };
  const reasons = state === null ? [] : [...new Set((Object.keys(state.capability) as (keyof ReviewCapability)[]).filter((k) => !state.capability[k].allowed).map((k) => state.capability[k].reason ?? ''))].filter((r) => r !== '');
  const current = state?.decision ?? null;

  return (
    <section class="decision-panel" data-testid="decision-panel" aria-labelledby="decision-heading">
      <h2 id="decision-heading">{REVIEW_LABELS.panelHeading}</h2>
      <p class="muted">{REVIEW_LABELS.panelNote}</p>
      <p data-testid="decision-state">
        {current === null
          ? REVIEW_LABELS.noDecision
          : `${decisionText(current.kind, current.commit, when(current.decidedAt))}${current.stale ? ` (${REVIEW_LABELS.staleDecision})` : ''}${current.message === null ? '' : `: ${current.message}`}`}
      </p>
      {error !== null && <p class="error" role="alert">{error}</p>}
      {state !== null && !state.canReview.allowed && (
        <p class="disabled-reason" data-testid="review-disabled-reason">{state.canReview.reason}</p>
      )}
      {state !== null && state.canReview.allowed && reasons.length > 0 && (
        <p class="disabled-reason" data-testid="review-disabled-reason">{reasons.join(' ')}</p>
      )}
      <label>
        {REVIEW_LABELS.messageLabel}
        <textarea data-testid="decision-message" value={message} onInput={(e) => setMessage((e.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      <ActionNotice failure={failure} testId="comment-error" />
      <div class="decision-actions">
        <button
          type="button"
          class="button"
          data-testid="decision-approve"
          disabled={busy || !cap('approve').allowed}
          onClick={() => void perform(text === '' ? { kind: 'approve' } : { kind: 'approve', body: message }, REVIEW_LABELS.announceApproved)}
        >
          {REVIEW_LABELS.approve}
        </button>
        <button
          type="button"
          data-testid="decision-request-changes"
          disabled={busy || text === '' || !cap('request_changes').allowed}
          onClick={() => void perform({ kind: 'request_changes', body: message }, 'Changes requested')}
        >
          {REVIEW_LABELS.requestChanges}
        </button>
        <button
          type="button"
          data-testid="decision-comment"
          disabled={busy || text === '' || !cap('comment').allowed}
          onClick={() => void perform({ kind: 'comment', destination: 'pull_request', body: message }, 'Comment posted', props.onCommented)}
        >
          {REVIEW_LABELS.generalComment}
        </button>
        {current !== null && (
          <button
            type="button"
            data-testid="decision-withdraw"
            disabled={busy || !cap('withdraw_decision').allowed}
            onClick={() => void perform({ kind: 'withdraw_decision' }, 'Decision withdrawn')}
          >
            {REVIEW_LABELS.withdraw}
          </button>
        )}
      </div>
    </section>
  );
}
