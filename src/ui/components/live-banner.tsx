// Live-updates banner (FR-030): shown only while the stream is dropped, with a Reconnect button.

import type { LiveState } from '../state/live-stream.ts';

export function LiveBanner(props: { state: LiveState; onReconnect: () => void }) {
  if (props.state !== 'dropped') return null;
  return (
    <div class="live-updates-banner" data-testid="live-updates-banner" role="status">
      <span>Live updates paused — </span>
      <button type="button" data-testid="reconnect-button" onClick={props.onReconnect}>
        Reconnect
      </button>
    </div>
  );
}
