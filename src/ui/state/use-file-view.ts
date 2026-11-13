// The file list's order, review scope and viewed files, kept in the tab (view-state.ts) and shared by the list and
// the Files view's Next and Previous. Never sent to the server (FR-032).

import { useState } from 'preact/hooks';
import type { RiskClass } from '../../contracts/http.ts';
import type { FileOrder } from './file-order.ts';
import { readSession, writeSession } from './view-state.ts';

export type FileView = {
  order: FileOrder;
  /** 'auto' fits the line budget; otherwise the lowest class in the scope. */
  scope: 'auto' | RiskClass;
  viewed: ReadonlySet<string>;
  setOrder(order: FileOrder): void;
  setScope(scope: 'auto' | RiskClass): void;
  toggleViewed(path: string): void;
};

export function useFileView(sessionId: string): FileView {
  const [state, setState] = useState(() => {
    const s = readSession(sessionId);
    return { order: s.fileOrder, scope: s.riskScope, viewed: s.viewed };
  });
  return {
    order: state.order,
    scope: state.scope,
    viewed: new Set(state.viewed),
    setOrder(order) {
      writeSession(sessionId, { fileOrder: order });
      setState((s) => ({ ...s, order }));
    },
    setScope(scope) {
      writeSession(sessionId, { riskScope: scope });
      setState((s) => ({ ...s, scope }));
    },
    toggleViewed(path) {
      // Read the stored list, not the render's copy, so two quick ticks both land.
      const current = readSession(sessionId).viewed;
      const viewed = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
      writeSession(sessionId, { viewed });
      setState((s) => ({ ...s, viewed }));
    },
  };
}
