// Async region (FR-028, FR-029; data-model 4.8, contracts 4.9): the one wrapper for any area that
// loads data. A failure is never shown as an empty list: it names what failed and offers Retry.

import type { ComponentChildren, JSX } from 'preact';

export type AsyncRegionState =
  | { state: 'loading' }
  | { state: 'loaded' }
  | { state: 'empty'; explanation: string; nextStep?: ComponentChildren }
  | { state: 'failed'; reason: string; retry: () => void }
  | { state: 'unknown'; reason: string }
  | { state: 'stale'; staleAgainst: string };

export type AsyncRegionProps = AsyncRegionState & {
  /** Region name: sessions, pulls, provider, suggestions, summaries, questions, diff, code, workspace, signins. */
  region: string;
  /** Shown in the loading text and the failure message, e.g. "Open pull requests". */
  label: string;
  /** Rendered for `loaded` and `stale`. */
  children?: ComponentChildren;
  /** Distinguishes several regions of one kind, e.g. a repository id: gives `retry-<region>-<suffix>`. */
  retrySuffix?: string;
};

export function AsyncRegion(props: AsyncRegionProps): JSX.Element {
  const { region, label, children } = props;
  const retryId = props.retrySuffix ? `retry-${region}-${props.retrySuffix}` : `retry-${region}`;
  return (
    <section class="async-region" data-testid={`async-${region}`} data-state={props.state} aria-busy={props.state === 'loading' ? 'true' : undefined}>
      {props.state === 'loading' && <p class="async-loading">Loading {label}…</p>}
      {props.state === 'loaded' && children}
      {props.state === 'empty' && (
        <div class="async-empty">
          <p>{props.explanation}</p>
          {props.nextStep !== undefined && <p class="async-next-step">{props.nextStep}</p>}
        </div>
      )}
      {props.state === 'failed' && (
        <div class="async-failed" role="alert">
          <p>
            Could not load {label}: {props.reason}
          </p>
          <button type="button" data-testid={retryId} onClick={props.retry}>
            Retry
          </button>
        </div>
      )}
      {props.state === 'unknown' && (
        <p class="async-unknown">
          Could not check {label}: {props.reason}
        </p>
      )}
      {props.state === 'stale' && (
        <>
          <p class="async-stale">
            <span class="badge" data-kind="completeness" data-status="stale">
              <span aria-hidden="true">⟳</span>Stale
            </span>{' '}
            <span class="async-stale-against">{props.staleAgainst}</span>
          </p>
          {children}
        </>
      )}
    </section>
  );
}
