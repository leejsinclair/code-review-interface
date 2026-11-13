// Where a risk row links to: the diff of the file, at its first marked line when it has marked lines (SC-010).

import type { LineRange, RiskFile } from '../../contracts/http.ts';
import { buildRoute, diffHref } from './routes.ts';

/** The reasons that mark lines: applied ones that raise scrutiny. A reason that was not applied, or that sets Low, marks nothing. */
const markingReasons = (file: RiskFile) => file.reasons.filter((r) => r.applied && r.class !== 'low');

export const markedRanges = (file: RiskFile): LineRange[] => markingReasons(file).flatMap((r) => r.lines);

export type RiskMark = { side: LineRange['side']; line: number; label: string };

const markLabel = (origin: string, ruleId: string | undefined, text: string): string => `${origin === 'ai' ? 'AI' : (ruleId ?? 'Rule')}: ${text}`;

/** One mark per responsible line, keyed `side:line`; a line with several reasons carries all their labels. */
export function riskMarks(file: RiskFile): Map<string, RiskMark> {
  const out = new Map<string, RiskMark>();
  for (const r of markingReasons(file)) {
    for (const range of r.lines) {
      for (let line = range.startLine; line <= range.endLine; line += 1) {
        const key = `${range.side}:${line}`;
        const label = markLabel(r.origin, r.ruleId, r.text);
        const existing = out.get(key);
        out.set(key, { side: range.side, line, label: existing === undefined ? label : `${existing.label}; ${label}` });
      }
    }
  }
  return out;
}

/** The first marked line, head side first, in line order; undefined when the file has none. */
export function firstMark(file: RiskFile): LineRange | undefined {
  const ranges = markedRanges(file);
  const head = ranges.filter((r) => r.side === 'head').sort((a, b) => a.startLine - b.startLine);
  const base = ranges.filter((r) => r.side === 'base').sort((a, b) => a.startLine - b.startLine);
  return head[0] ?? base[0];
}

export function riskFileHref(sessionId: string, snapshotId: string, file: RiskFile): string {
  const mark = firstMark(file);
  if (mark === undefined) return buildRoute({ name: 'diff', sessionId, path: file.path });
  return diffHref(sessionId, { path: file.path, snapshot: snapshotId, side: mark.side, start: mark.startLine, end: mark.endLine });
}
