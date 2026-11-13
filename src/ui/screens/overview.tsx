// Review session overview (`#/sessions/:sessionId`, FR-025, FR-027, FR-045): the summary, the completeness rows, the
// Specification panel (feature 006; the file list lives on the Diff screen), referenced pull requests and the review-focus
// placeholder. The review shell owns the PR header, Close, Delete and the `POST /open` call. Every PR and issue
// string is rendered as text.

import { useContext } from 'preact/hooks';
import { CommentThread } from '../components/comment-thread.tsx';
import { CompletenessList } from '../components/completeness.tsx';
import { DecisionPanel } from '../components/decision-panel.tsx';
import { SpecContext } from '../components/spec-context.tsx';
import { SummariesPanel, SummariesProvider } from '../components/summaries.tsx';
import { ReviewFocus } from '../components/review-focus.tsx';
import { ReviewContext } from '../state/review-context.ts';
import { threadsOf, useReviewComments } from '../state/use-review-comments.ts';
import { useReviewDecision } from '../state/use-review-decision.ts';
import { useRisk } from '../state/use-risk.ts';
import { useSpecContext } from '../state/use-spec-context.ts';

export function OverviewScreen(props: { sessionId: string }) {
  const { sessionId } = props;
  const { session: detail } = useContext(ReviewContext);
  const latestId = detail?.snapshots.at(-1)?.snapshotId;
  const risk = useRisk(sessionId, latestId, { announceAi: true });
  const reviewComments = useReviewComments(sessionId);
  const decision = useReviewDecision(sessionId);
  const spec = useSpecContext(sessionId, latestId);

  if (detail === undefined) return <p class="muted">Opening the session…</p>;

  const referenced = detail.issues.some((i) => i.kind === 'pull-request') && (
        <section class="panel">
          <h2>Referenced pull requests</h2>
          <ul class="list">
            {detail.issues
              .filter((i) => i.kind === 'pull-request')
              .map((i) => (
                <li key={i.key} class="mono">
                  {i.key}
                </li>
              ))}
          </ul>
        </section>
    );

  return (
    <div class="stack" data-testid="overview">
      <h1>Overview</h1>
      <SummariesProvider sessionId={sessionId} detail={detail}>
        <SummariesPanel sessionId={sessionId} detail={detail} />
        <CompletenessList rows={detail.completeness} sessionId={sessionId} />
        <SpecContext sessionId={sessionId} snapshotId={latestId} spec={spec} />
        {referenced}
        <ReviewFocus sessionId={sessionId} risk={risk} />
        {latestId !== undefined && (
          <>
            <DecisionPanel sessionId={sessionId} expectedHead={detail.snapshots.at(-1)?.headCommit ?? ''} onCommented={() => void reviewComments.reload()} />
            <section class="panel" aria-labelledby="pr-comments-heading">
              <h2 id="pr-comments-heading">Pull request comments</h2>
              {reviewComments.error !== null && <p class="muted">{reviewComments.error}</p>}
              {threadsOf(reviewComments.comments.filter((c) => c.anchor === null)).map((thread) => (
                <CommentThread
                  key={thread[0]?.id}
                  sessionId={sessionId}
                  expectedHead={detail.snapshots.at(-1)?.headCommit ?? ''}
                  comments={thread}
                  {...(decision.state?.capability.reply.allowed === false ? { disabledReason: decision.state.capability.reply.reason ?? '' } : {})}
                  onChanged={() => void reviewComments.reload()}
                />
              ))}
            </section>
          </>
        )}
      </SummariesProvider>
    </div>
  );
}
