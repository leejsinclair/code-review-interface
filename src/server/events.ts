// Per-session server-sent events hub (research R2, http-api.md section 9).
//
// `GET /api/sessions/:sessionId/events` hands its response to `subscribe`; the
// rest of the app calls `publish` to push `event:`/`data:` frames to every
// stream open for that session. A shared heartbeat comment keeps idle streams
// alive through proxies and lets dead connections surface; a stream is dropped
// when its connection closes or errors.

import type { ServerResponse } from 'node:http';

export interface EventHub {
  /**
   * Turns `res` into an event stream for `sessionId`: writes the 200
   * `text/event-stream` head and keeps `res` until it closes. Headers already
   * set on `res` (security headers) are kept. Returns an unsubscribe function
   * that ends the stream.
   */
  subscribe(sessionId: string, res: ServerResponse): () => void;
  /** Sends one event to every stream open for `sessionId`; returns how many got it. */
  publish(sessionId: string, event: string, data: unknown): number;
  /** Number of streams open for `sessionId`. */
  subscriberCount(sessionId: string): number;
  /** Ends every stream open for `sessionId` (the session closed). */
  closeSession(sessionId: string): void;
  /** Ends every stream and stops the heartbeat. */
  close(): void;
}

export interface EventHubOptions {
  /** Milliseconds between heartbeat comments; default 15 000. */
  heartbeatMs?: number;
  /** Client reconnect delay sent as `retry:` on subscribe; default 3 000. */
  retryMs?: number;
}

export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_RETRY_MS = 3_000;

const EVENT_NAME = /^[A-Za-z0-9._-]+$/;

/** Frames one server-sent event; multi-line data becomes several `data:` lines. */
export function formatEvent(event: string, data: unknown): string {
  if (!EVENT_NAME.test(event)) throw new Error(`invalid event name: ${JSON.stringify(event)}`);
  const payload = typeof data === 'string' ? data : (JSON.stringify(data) ?? 'null');
  const lines = payload.split(/\r\n|\r|\n/).map((line) => `data: ${line}\n`);
  return `event: ${event}\n${lines.join('')}\n`;
}

export function createEventHub(options: EventHubOptions = {}): EventHub {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const sessions = new Map<string, Set<ServerResponse>>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const total = (): number => {
    let count = 0;
    for (const set of sessions.values()) count += set.size;
    return count;
  };

  const stopHeartbeatIfIdle = (): void => {
    if (heartbeat !== null && total() === 0) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const remove = (sessionId: string, res: ServerResponse): boolean => {
    const set = sessions.get(sessionId);
    if (set === undefined || !set.delete(res)) return false;
    if (set.size === 0) sessions.delete(sessionId);
    stopHeartbeatIfIdle();
    return true;
  };

  const end = (sessionId: string, res: ServerResponse): void => {
    if (remove(sessionId, res) && !res.writableEnded && !res.destroyed) res.end();
  };

  const write = (sessionId: string, res: ServerResponse, chunk: string): boolean => {
    if (res.writableEnded || res.destroyed) {
      remove(sessionId, res);
      return false;
    }
    try {
      res.write(chunk);
      return true;
    } catch {
      end(sessionId, res);
      return false;
    }
  };

  const beat = (): void => {
    for (const [sessionId, set] of sessions) {
      for (const res of [...set]) write(sessionId, res, ': heartbeat\n\n');
    }
  };

  const startHeartbeat = (): void => {
    if (heartbeat !== null || heartbeatMs <= 0) return;
    heartbeat = setInterval(beat, heartbeatMs);
    // The hub must not keep the process alive on its own.
    heartbeat.unref();
  };

  return {
    subscribe(sessionId, res) {
      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
      }
      res.socket?.setNoDelay(true);

      let set = sessions.get(sessionId);
      if (set === undefined) {
        set = new Set();
        sessions.set(sessionId, set);
      }
      set.add(res);

      const onGone = (): void => {
        remove(sessionId, res);
      };
      res.once('close', onGone);
      res.once('error', onGone);

      write(sessionId, res, `retry: ${retryMs}\n\n`);
      startHeartbeat();
      return () => end(sessionId, res);
    },

    publish(sessionId, event, data) {
      const set = sessions.get(sessionId);
      if (set === undefined || set.size === 0) return 0;
      const frame = formatEvent(event, data);
      let delivered = 0;
      for (const res of [...set]) if (write(sessionId, res, frame)) delivered += 1;
      return delivered;
    },

    subscriberCount(sessionId) {
      return sessions.get(sessionId)?.size ?? 0;
    },

    closeSession(sessionId) {
      const set = sessions.get(sessionId);
      if (set === undefined) return;
      for (const res of [...set]) end(sessionId, res);
    },

    close() {
      for (const [sessionId, set] of [...sessions]) {
        for (const res of [...set]) end(sessionId, res);
      }
      sessions.clear();
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  };
}
