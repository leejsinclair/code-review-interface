// Live-update stream model (data-model 4.7, R5): connecting -> open -> retrying (5 s grace) -> dropped. Pure
// apart from the grace timer; the review shell feeds it the `subscribeSession` callbacks and shows the banner
// when the state is `dropped`.

export type LiveState = 'connecting' | 'open' | 'retrying' | 'dropped';

export const GRACE_MS = 5000;
const CLOSED = 2;

export interface LiveStream {
  readonly state: LiveState;
  /** The `open` event. */
  opened(): void;
  /** The `error` event, with the `EventSource` readyState. */
  errored(readyState: number): void;
  /** Reconnect: `dropped` goes to `connecting`. The caller opens the new stream. */
  reconnect(): void;
  dispose(): void;
}

export function createLiveStream(onChange: (state: LiveState) => void, graceMs: number = GRACE_MS): LiveStream {
  let state: LiveState = 'connecting';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const set = (next: LiveState): void => {
    if (next === state) return;
    state = next;
    onChange(next);
  };
  return {
    get state() {
      return state;
    },
    opened() {
      stop();
      set('open');
    },
    errored(readyState) {
      if (readyState === CLOSED) {
        stop();
        set('dropped');
        return;
      }
      if (state === 'dropped' || state === 'retrying') return;
      set('retrying');
      timer = setTimeout(() => {
        timer = undefined;
        if (state === 'retrying') set('dropped');
      }, graceMs);
    },
    reconnect() {
      stop();
      set('connecting');
    },
    dispose: stop,
  };
}
