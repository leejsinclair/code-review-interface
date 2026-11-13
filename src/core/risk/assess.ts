// Applying the AI's opinion (research RR-5). Pure. The AI can only raise a class: an item applies when its
// proposed class is higher than the rule class (the one comparison below) and at least one cited line range
// resolves to a changed line of that file on that side. Anything else is kept as an item that was not applied,
// with a reason from a closed set, so a reviewer can see what the AI said and why it did not count.

import type { LineRange } from '../../contracts/http.ts';
import type { RiskAssessmentItem } from '../../store/review-store.ts';
import { isHigher, isRiskClass, type RiskClass } from './classes.ts';
import { changedLines } from './patch.ts';

export type AiFileOpinion = { path: string; class: RiskClass; reasons: string[]; lines: LineRange[] };
export type RiskOutput = { files: AiFileOpinion[] };

/** What assessing needs to know about one changed file. */
export type AssessFile = { path: string; ruleClass: RiskClass; assessable: boolean; patch: string | null };

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1;

function isLineRange(x: unknown): x is LineRange {
  if (x === null || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (r['side'] === 'head' || r['side'] === 'base') && isInt(r['startLine']) && isInt(r['endLine']) && r['startLine'] <= r['endLine'];
}

function isOpinion(x: unknown): x is AiFileOpinion {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o['path'] === 'string' &&
    isRiskClass(o['class']) &&
    Array.isArray(o['reasons']) &&
    o['reasons'].every((r) => typeof r === 'string') &&
    Array.isArray(o['lines']) &&
    o['lines'].every(isLineRange)
  );
}

/** The hand-written guard for the provider's structured output (like `isSummaryOutput`). */
export function isRiskOutput(x: unknown): x is RiskOutput {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const files = (x as Record<string, unknown>)['files'];
  return Array.isArray(files) && files.every(isOpinion);
}

/** One item per distinct path the AI named, in the order it named them. */
export function assessOutput(output: RiskOutput, files: readonly AssessFile[]): RiskAssessmentItem[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const changed = new Map<string, Set<string>>();
  const changedOf = (file: AssessFile): Set<string> => {
    let found = changed.get(file.path);
    if (found === undefined) {
      found = new Set(changedLines(file.patch).map((l) => `${l.side}:${l.line}`));
      changed.set(file.path, found);
    }
    return found;
  };
  const items: RiskAssessmentItem[] = [];
  const seen = new Set<string>();

  for (const opinion of output.files) {
    if (seen.has(opinion.path)) continue;
    seen.add(opinion.path);
    // The store accepts normal, elevated or critical; a stray "low" is kept as normal and is never higher.
    const proposedClass: RiskAssessmentItem['proposedClass'] = opinion.class === 'low' ? 'normal' : opinion.class;
    const base = { path: opinion.path, proposedClass, reasons: opinion.reasons };
    const file = byPath.get(opinion.path);
    if (file === undefined) {
      items.push({ ...base, applied: false, ignoredReason: 'unknown-file', lines: opinion.lines.map((l) => ({ ...l, resolved: false })) });
      continue;
    }
    const resolved = changedOf(file);
    const lines = opinion.lines.map((l) => {
      let hit = false;
      for (let n = l.startLine; n <= l.endLine && !hit; n += 1) hit = resolved.has(`${l.side}:${n}`);
      return { ...l, resolved: hit };
    });
    if (!file.assessable) {
      items.push({ ...base, applied: false, ignoredReason: 'not-assessable', lines });
    } else if (opinion.class === 'low' || !isHigher(proposedClass, file.ruleClass)) {
      items.push({ ...base, applied: false, ignoredReason: 'not-higher', lines });
    } else if (!lines.some((l) => l.resolved)) {
      items.push({ ...base, applied: false, ignoredReason: 'no-resolvable-line', lines });
    } else {
      items.push({ ...base, applied: true, ignoredReason: null, lines });
    }
  }
  return items;
}
