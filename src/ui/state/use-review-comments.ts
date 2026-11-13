// The pull request's comments with whether each may be edited (feature 005, FR-010, FR-011). Read from the
// platform through the server; re-read after any change so what is shown is what the platform holds.

import { useEffect, useState } from 'preact/hooks';
import type { ReviewCommentItem } from '../../contracts/http.ts';
import { getReviewComments } from '../api.ts';

export type ReviewCommentsHook = { comments: ReviewCommentItem[]; error: string | null; reload(): Promise<void> };

/** Groups comments into threads: the root first, replies after it in time order. Threads keep the root's order. */
export function threadsOf(comments: readonly ReviewCommentItem[]): ReviewCommentItem[][] {
  const byThread = new Map<string, ReviewCommentItem[]>();
  for (const c of comments) byThread.set(c.threadId, [...(byThread.get(c.threadId) ?? []), c]);
  return [...byThread.values()].map((thread) =>
    [...thread].sort((a, b) => (a.id === a.threadId ? -1 : b.id === b.threadId ? 1 : a.createdAt.localeCompare(b.createdAt))),
  );
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
