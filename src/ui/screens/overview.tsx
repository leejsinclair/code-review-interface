// Review session overview (`#/sessions/:sessionId`, FR-025, FR-027, FR-045): the summary, the completeness rows, the
// filterable file list with per-file explanations on request, referenced pull requests and the review-focus
// placeholder. The review shell owns the PR header, Close, Delete and the `POST /open` call. Every PR and issue
// string is rendered as text.

import { useContext, useEffect, useState } from 'preact/hooks';
import type { SnapshotDetail } from '../../contracts/http.ts';
import { getSnapshot } from '../api.ts';
import { CompletenessList } from '../components/completeness.tsx';
import { FileList } from '../components/file-list.tsx';
import { FileExplanation, SummariesPanel, SummariesProvider } from '../components/summaries.tsx';
import { REVIEW_FOCUS } from '../labels.ts';
import { ReviewContext } from '../state/review-context.ts';

export function OverviewScreen(props: { sessionId: string }) {
  const { sessionId } = props;
  const { session: detail } = useContext(ReviewContext);
  const [snapshot, setSnapshot] = useState<SnapshotDetail | null>(null);
  const latestId = detail?.snapshots.at(-1)?.snapshotId;

  useEffect(() => {
    if (latestId !== undefined) getSnapshot(sessionId, latestId).then(setSnapshot).catch(() => undefined);
  }, [sessionId, latestId]);

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
        <section class="panel">
          <h2>Changed files</h2>
          <FileList sessionId={sessionId} files={snapshot?.files ?? []} explanation={(f) => <FileExplanation sessionId={sessionId} path={f.path} />} />
        </section>
        {referenced}
        <section class="panel" data-testid="review-focus">
          <h2>{REVIEW_FOCUS.heading}</h2>
          <p>{REVIEW_FOCUS.body}</p>
        </section>
      </SummariesProvider>
    </div>
  );
}
