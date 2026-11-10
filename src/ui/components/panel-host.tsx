// Panel host (FR-019, FR-020, FR-022, R6): wraps the current screen and overrides `openAsk` and `openEvidence`
// from the review context. Wide: the panel sits beside the page. Medium: it overlays the page. Narrow: the
// actions navigate to the existing full pages instead. The open panel is kept in view state, so it survives a
// reload; entering narrow with a panel open replaces the hash with the panel's full-page route.

import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Ref, Scope } from '../../contracts/http.ts';
import { useBand } from '../state/layout.ts';
import { ReviewContext, type EvidenceTarget, type ReviewContextValue } from '../state/review-context.ts';
import { askHref, parseRoute } from '../state/routes.ts';
import { readSession, writeSession, type Panel as PanelState } from '../state/view-state.ts';
import { AskComposer } from './ask-composer.tsx';
import { EvidencePanel, evidenceRoute } from './evidence-panel.tsx';
import { Panel } from './panel.tsx';

type Open = { panel: Exclude<PanelState, null>; snapshot?: string | undefined; openerId?: string | undefined };

/** The control that opened the panel: the given id, else the focused element (given an id when it has none). */
function resolveOpener(openerId: string | undefined): string | undefined {
  if (openerId !== undefined && openerId !== '' && document.getElementById(openerId) !== null) return openerId;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    if (active.id === '') active.id = `panel-opener-${Math.random().toString(36).slice(2, 8)}`;
    return active.id;
  }
  return undefined;
}

export function PanelHost(props: { sessionId: string; children?: ComponentChildren }) {
  const { sessionId } = props;
  const parent = useContext(ReviewContext);
  const band = useBand();
  const bandRef = useRef(band);
  bandRef.current = band;
  const [open, setOpen] = useState<Open | null>(() => {
    const stored = readSession(sessionId).panel;
    return stored === null ? null : { panel: stored };
  });
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = (): void => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const latestSnapshot = parent.session?.snapshots[parent.session.snapshots.length - 1]?.snapshotId;
  const openRef = useRef(open);
  openRef.current = open;

  const close = (): void => {
    writeSession(sessionId, { panel: null });
    setOpen(null);
  };

  const context = useMemo<ReviewContextValue>(
    () => ({
      ...parent,
      openAsk(scope: Scope, openerId?: string) {
        if (bandRef.current === 'narrow') return parent.openAsk(scope, openerId);
        writeSession(sessionId, { scope, panel: { kind: 'ask' } });
        setOpen({ panel: { kind: 'ask' }, openerId: resolveOpener(openerId) });
      },
      openEvidence(target: EvidenceTarget, openerId?: string) {
        if (bandRef.current === 'narrow') return parent.openEvidence(target, openerId);
        const start = target.start ?? 1;
        const ref: Ref = { kind: 'code', path: target.path, side: target.side, startLine: start, endLine: target.end ?? start, resolved: true };
        writeSession(sessionId, { panel: { kind: 'evidence', ref } });
        setOpen({ panel: { kind: 'evidence', ref }, snapshot: target.snapshot, openerId: resolveOpener(openerId) });
      },
    }),
    [parent, sessionId],
  );

  // Entering narrow with a panel open: the panel's full-page route replaces the hash; the draft stays in view state.
  useEffect(() => {
    if (band !== 'narrow' || open === null) return;
    const stored = readSession(sessionId);
    const route = open.panel.kind === 'ask' ? askHref(sessionId, stored.scope) : evidenceRoute(sessionId, open.panel.ref, open.snapshot ?? latestSnapshot);
    close();
    location.replace(route);
  }, [band, open]);

  const route = parseRoute(hash);
  const showing = open !== null && band !== 'narrow' && !(route.name === 'ask' && open.panel.kind === 'ask');
  const overlay = band === 'medium';
  return (
    <ReviewContext.Provider value={context}>
      <div class="panel-host" data-band={band} data-panel={showing ? open.panel.kind : 'none'} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', position: 'relative' }}>
        <div class="panel-host-content" style={{ flex: '1 1 0', minWidth: 0 }}>
          {props.children}
        </div>
        {showing && (
          <div
            class="panel-host-panel"
            style={
              overlay
                ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(30rem, 100vw)', overflowY: 'auto', zIndex: 20, background: 'Canvas', color: 'CanvasText', boxShadow: '-2px 0 8px rgba(0,0,0,.3)' }
                : { flex: '0 0 30rem', maxWidth: '40%', position: 'sticky', top: 0, maxHeight: '100vh', overflowY: 'auto' }
            }
          >
            {open.panel.kind === 'ask' ? (
              <Panel testId="ask-panel" title="Ask about the selection" openerId={open.openerId} onClose={close}>
                <AskComposer sessionId={sessionId} scope={readSession(sessionId).scope} idPrefix="panel-" />
              </Panel>
            ) : (
              <EvidencePanel sessionId={sessionId} reference={open.panel.ref} snapshot={open.snapshot ?? latestSnapshot} openerId={open.openerId} onClose={close} />
            )}
          </div>
        )}
      </div>
    </ReviewContext.Provider>
  );
}
