// PR description page (`#/sessions/:sessionId/description`, FR-028), under Sources. The description is shown
// as a text node, never rendered as HTML or Markdown (FR-042). `DescriptionView` is shared with the Evidence panel.

import { AsyncRegion } from '../components/async-region.tsx';
import { SourcesNav, useSessionDetail } from '../components/sources-nav.tsx';

/** The description text with its heading. `embedded` is for the Evidence panel, where the panel owns the h2. */
export function DescriptionView(props: { sessionId: string; embedded?: boolean }) {
  const { detail, error, retry } = useSessionDetail(props.sessionId);
  const state =
    error !== null && detail === null ? ({ state: 'failed', reason: error, retry } as const) : detail === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const);
  return (
    <AsyncRegion region="description" label="the description" {...state}>
      {detail !== null && (
        <div class="stack" data-testid="pr-description">
          {props.embedded === true ? <h3>{`#${detail.prNumber} ${detail.title}`}</h3> : <p class="muted">{`#${detail.prNumber} ${detail.title}`}</p>}
          <pre class="text-block">{detail.description === '' ? 'The PR has no description.' : detail.description}</pre>
        </div>
      )}
    </AsyncRegion>
  );
}

export function DescriptionScreen(props: { sessionId: string }) {
  const { detail } = useSessionDetail(props.sessionId);
  return (
    <article class="panel stack">
      <h1>Description</h1>
      <SourcesNav sessionId={props.sessionId} issues={detail?.issues ?? []} current="description" />
      <DescriptionView sessionId={props.sessionId} />
    </article>
  );
}
