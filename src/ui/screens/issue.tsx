// Issue page (`#/sessions/:sessionId/issues/:platform/:key`, FR-028), under Sources: the stored title and
// plain-text description of an issue fetched for the session, as text nodes only (FR-042).
// `IssueView` is an issue's page.

import { AsyncRegion } from '../components/async-region.tsx';
import { SourcesNav, useSessionDetail } from '../components/sources-nav.tsx';

export function IssueView(props: { sessionId: string; platform: string; issueKey: string }) {
  const { detail, error, retry } = useSessionDetail(props.sessionId);
  const issue = detail?.issues.find((i) => i.platform === props.platform && i.key === props.issueKey);
  const state =
    error !== null && detail === null
      ? ({ state: 'failed', reason: error, retry } as const)
      : detail === null
        ? ({ state: 'loading' } as const)
        : issue === undefined
          ? ({ state: 'empty', explanation: 'This issue was not referenced in the session.' } as const)
          : ({ state: 'loaded' } as const);
  return (
    <AsyncRegion region="issue" label="the issue" {...state}>
      {issue !== undefined && (
        <div class="stack" data-testid="issue-view">
          {issue.title !== undefined && <p>{issue.title}</p>}
          {issue.reason !== undefined && <p class="notice">{`${issue.status}: ${issue.reason}`}</p>}
          <pre class="text-block">{issue.descriptionText ?? ''}</pre>
        </div>
      )}
    </AsyncRegion>
  );
}

export function IssueScreen(props: { sessionId: string; platform: string; issueKey: string }) {
  const { detail } = useSessionDetail(props.sessionId);
  return (
    <article class="panel stack">
      <h1>{props.issueKey}</h1>
      <SourcesNav sessionId={props.sessionId} issues={detail?.issues ?? []} current={{ platform: props.platform, key: props.issueKey }} />
      <IssueView sessionId={props.sessionId} platform={props.platform} issueKey={props.issueKey} />
    </article>
  );
}
