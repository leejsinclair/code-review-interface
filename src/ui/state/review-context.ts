// The review context (R4, R6): what the review shell shares with the screens inside it. The defaults work
// without a shell, so a screen opened on its own still subscribes, announces and navigates.

import { createContext } from 'preact';
import type { Scope, Side, SessionDetail } from '../../contracts/http.ts';
import { subscribeSession, type SessionEventHandlers, type SessionStreamOptions } from '../api.ts';
import { createAnnouncer } from './announcer.ts';
import { askHref, codeHref, parseRoute } from './routes.ts';

export type EvidenceTarget = { snapshot: string; side: Side; path: string; start?: number; end?: number };

export interface ReviewContextValue {
  session?: SessionDetail;
  /** Subscribe to the session's events; returns the unsubscribe function. */
  subscribe(handlers: SessionEventHandlers & Pick<SessionStreamOptions, 'onQuestions' | 'onSummaries'>): () => void;
  announce(text: string): void;
  openAsk(scope: Scope, openerId?: string): void;
  openEvidence(target: EvidenceTarget, openerId?: string): void;
}

const currentSessionId = (): string | undefined => {
  const route = parseRoute(location.hash);
  return 'sessionId' in route ? route.sessionId : undefined;
};

let announcer: ReturnType<typeof createAnnouncer> | undefined;
const defaultAnnounce = (text: string): void => {
  announcer ??= createAnnouncer(
    (t) => {
      const region = document.getElementById('live-region');
      if (region !== null) region.textContent = t;
    },
    { intervalMs: 2000 },
  );
  announcer.now(text);
};

export const ReviewContext = createContext<ReviewContextValue>({
  subscribe(handlers) {
    const id = currentSessionId();
    if (id === undefined) return () => undefined;
    const stream = subscribeSession(id, handlers);
    return () => stream.close();
  },
  announce: defaultAnnounce,
  openAsk(scope) {
    const id = currentSessionId();
    if (id !== undefined) location.hash = askHref(id, scope);
  },
  openEvidence(target) {
    const id = currentSessionId();
    if (id !== undefined) location.hash = codeHref(id, target);
  },
});
