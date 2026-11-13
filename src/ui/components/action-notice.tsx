// The result of a refused review action (feature 005, FR-016, FR-019). A refusal shows the platform's own reason
// in a `role="alert"` region so a screen reader announces it, and the caller keeps the typed text. A head that
// moved shows the out-of-date notice instead: nothing was posted. Every string is text.

import { ApiError } from '../api.ts';
import { REVIEW_LABELS } from '../labels.ts';

export type ActionFailure = { kind: 'out-of-date' } | { kind: 'error'; message: string; platformMessage?: string };

export function failureOf(error: unknown): ActionFailure {
  if (error instanceof ApiError) {
    if (error.code === 'conflict' && error.platformMessage === undefined && /new commits|out of date/i.test(error.message)) return { kind: 'out-of-date' };
    return { kind: 'error', message: error.message, ...(error.platformMessage === undefined ? {} : { platformMessage: error.platformMessage }) };
  }
  return { kind: 'error', message: error instanceof Error ? error.message : 'The action could not be completed.' };
}

export function ActionNotice(props: { failure: ActionFailure | null; testId?: string }) {
  const { failure } = props;
  if (failure === null) return null;
  if (failure.kind === 'out-of-date') {
    return (
      <p class="action-notice" role="alert" data-testid="review-out-of-date">
        {REVIEW_LABELS.outOfDate}
      </p>
    );
  }
  return (
    <p class="action-notice error" role="alert" data-testid={props.testId ?? 'comment-error'}>
      {failure.message}
      {failure.platformMessage !== undefined && failure.platformMessage !== failure.message ? ` The platform said: ${failure.platformMessage}` : ''}
    </p>
  );
}
