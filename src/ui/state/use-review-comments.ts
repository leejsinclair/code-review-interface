// The pull request's comments with whether each may be edited (feature 005, FR-010, FR-011). Read from the
// platform through the server; re-read after any change so what is shown is what the platform holds.

import { useEffect, useState } from 'preact/hooks';
import type { ReviewCommentItem } from '../../contracts/http.ts';
import { getReviewComments } from '../api.ts';

export type ReviewCommentsHook = { comments: ReviewCommentItem[]; error: string | null; reload(): Promise<void> };

/** One conversation, derived from the flat comment list (feature 007, data-model.md "Comment thread"). */
export type CommentThreadView = {
  threadId: string;
  /** The comment with `startsThread`, or 'deleted' when it is gone (FR-006). */
  start: ReviewCommentItem | 'deleted';
  /** Every other comment in the thread, by `createdAt`. */
  replies: ReviewCommentItem[];
  /** `capability.reply.allowed`; false when the capability is not known yet. */
  canReply: boolean;
};

/** Every comment of a thread in display order, the start first when present. */
export const commentsOf = (thread: CommentThreadView): ReviewCommentItem[] => (thread.start === 'deleted' ? thread.replies : [thread.start, ...thread.replies]);

/** One thread per `threadId`, at any depth, in first-seen order. */
export function threadsOf(comments: readonly ReviewCommentItem[], capability: { reply: { allowed: boolean } } | null): CommentThreadView[] {
  const byThread = new Map<string, ReviewCommentItem[]>();
  for (const c of comments) byThread.set(c.threadId, [...(byThread.get(c.threadId) ?? []), c]);
  return [...byThread].map(([threadId, members]) => {
    const start = members.find((c) => c.startsThread);
    return {
      threadId,
      start: start ?? 'deleted',
      replies: members.filter((c) => c !== start).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      canReply: capability?.reply.allowed === true,
    };
  });
}

export function useReviewComments(sessionId: string): ReviewCommentsHook {
  const [comments, setComments] = useState<ReviewCommentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = (): Promise<void> =>
    getReviewComments(sessionId)
      .then((r) => (setComments(r.comments), setError(null)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read the comments.'));
  useEffect(() => {
    void reload();
  }, [sessionId]);
  return { comments, error, reload };
}
