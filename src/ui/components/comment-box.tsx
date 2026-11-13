// One comment box (feature 005, FR-001, FR-019; contracts/ui.md). "Post comment" posts at once with a fresh
// request id: no preview, no confirmation, no draft. It is disabled for empty text and while a post runs, so a
// double click posts once. On any refusal the text stays in the box and the reason is announced. Cancel closes
// the box and posts nothing. Used for line and range comments, replies, edits and the general comment.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReviewAction, ReviewActionResult } from '../../contracts/http.ts';
import { postReviewAction } from '../api.ts';
import { REVIEW_LABELS } from '../labels.ts';
import { ActionNotice, failureOf, type ActionFailure } from './action-notice.tsx';

export function CommentBox(props: {
  sessionId: string;
  /** The head commit the reviewer is viewing; the server refuses the post if it has moved. */
  expectedHead: string;
  /** The action for the typed text. */
  build: (text: string) => ReviewAction;
  initialText?: string;
  submitLabel?: string;
  inputLabel?: string;
  onPosted: (result: ReviewActionResult) => void;
  onCancel: () => void;
}) {
  const { sessionId, expectedHead, build, onPosted, onCancel } = props;
  const [text, setText] = useState(props.initialText ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const running = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  // Opening the box puts the cursor in it, so a keyboard reviewer can type at once.
  useEffect(() => input.current?.focus(), []);

  const submit = async (): Promise<void> => {
    if (running.current || text.trim() === '') return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await postReviewAction(sessionId, { action: build(text), expectedHead, requestId: crypto.randomUUID() });
      onPosted(result);
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div class="comment-box" data-testid="comment-box">
      <label>
        {props.inputLabel ?? 'Comment'}
        <textarea
          ref={input}
          data-testid="comment-input"
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
        />
      </label>
      <ActionNotice failure={failure} />
      <div class="comment-actions">
        <button type="button" class="button" data-testid="comment-submit" disabled={busy || text.trim() === ''} onClick={() => void submit()}>
          {props.submitLabel ?? REVIEW_LABELS.postComment}
        </button>
        <button type="button" data-testid="comment-cancel" onClick={onCancel}>
          {REVIEW_LABELS.cancel}
        </button>
      </div>
    </div>
  );
}
