// One comment thread (feature 005, FR-010, FR-011). Author, time and body are text nodes. Reply is always offered
// when replying is allowed; Edit and Delete only on a comment this tool posted (`editable`, decided by the server).
// Delete is one click. An outdated comment is marked, never hidden.

import { useState } from 'preact/hooks';
import { postReviewAction } from '../api.ts';
import { REVIEW_LABELS } from '../labels.ts';
import { ActionNotice, failureOf, type ActionFailure } from './action-notice.tsx';
import { commentsOf, type CommentThreadView } from '../state/use-review-comments.ts';
import { CommentBox } from './comment-box.tsx';

const when = (iso: string): string => iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');

export function CommentThread(props: {
  sessionId: string;
  expectedHead: string;
  /** One conversation: its start (or a deleted placeholder) and the replies in time order. */
  thread: CommentThreadView;
  /** Why replying is not possible (the reviewer cannot review); absent when it is. */
  disabledReason?: string;
  /** Called after any change, so the caller re-reads the comments. */
  onChanged: () => void;
}) {
  const { sessionId, expectedHead, thread, onChanged } = props;
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const remove = async (id: string): Promise<void> => {
    setFailure(null);
    try {
      await postReviewAction(sessionId, { action: { kind: 'comment', destination: 'delete', commentId: id }, expectedHead, requestId: crypto.randomUUID() });
      onChanged();
    } catch (error) {
      setFailure(failureOf(error));
    }
  };

  return (
    <div class="comment-thread" data-testid="comment-thread">
      {thread.start === 'deleted' && (
        <p class="comment muted" data-testid="comment-deleted-placeholder">
          {REVIEW_LABELS.deletedComment}
        </p>
      )}
      {commentsOf(thread).map((c) => (
        <div class="comment" data-testid="comment" data-comment-id={c.id} key={c.id}>
          <p class="comment-meta">
            {`${c.author.name} · ${when(c.createdAt)}${c.editedAt === null ? '' : ' · edited'}`}
            {c.outdated && <span data-testid="comment-outdated">{` · ${REVIEW_LABELS.outdated}`}</span>}
          </p>
          {editing === c.id ? (
            <CommentBox
              sessionId={sessionId}
              expectedHead={expectedHead}
              initialText={c.body}
              submitLabel="Save comment"
              build={(text) => ({ kind: 'comment', destination: 'edit', commentId: c.id, body: text })}
              onPosted={() => (setEditing(null), onChanged())}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <p class="comment-body">{c.body}</p>
          )}
          {c.editable && editing !== c.id && (
            <div class="comment-tools">
              <button type="button" data-testid="comment-edit" onClick={() => setEditing(c.id)}>
                {REVIEW_LABELS.edit}
              </button>
              <button type="button" data-testid="comment-delete" onClick={() => void remove(c.id)}>
                {REVIEW_LABELS.deleteComment}
              </button>
            </div>
          )}
        </div>
      ))}
      <ActionNotice failure={failure} />
      {replying ? (
        <CommentBox
          sessionId={sessionId}
          expectedHead={expectedHead}
          inputLabel="Reply"
          build={(text) => ({ kind: 'comment', destination: 'reply', threadId: thread.threadId, body: text })}
          onPosted={() => (setReplying(false), onChanged())}
          onCancel={() => setReplying(false)}
        />
      ) : thread.canReply ? (
        <button type="button" data-testid="comment-reply" onClick={() => setReplying(true)}>
          {REVIEW_LABELS.reply}
        </button>
      ) : (
        props.disabledReason !== undefined && <p class="muted" data-testid="review-disabled-reason">{props.disabledReason}</p>
      )}
    </div>
  );
}
