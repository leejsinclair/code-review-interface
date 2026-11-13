// The review scope: the classes of changed file that fit a reviewer's line budget. Counts of files and changed
// lines only; nothing here scores, ranks or approves a file (FR-002). Pure.

import type { ChangedFile, RiskClass, RiskReport } from '../../contracts/http.ts';
import { RISK_CLASSES } from '../../core/risk/classes.ts';

/** About how many changed lines one careful review can hold. */
export const REVIEW_LINE_BUDGET = 400;

export type ScopeChoice = 'auto' | RiskClass;
export type Tally = { files: number; lines: number };

export type ScopeFile = {
  path: string;
  /** The file's effective class; undefined when no risk report knows it. */
  riskClass: RiskClass | undefined;
  /** Lines added plus lines removed. */
  lines: number;
  /** A candidate for reduced review (lockfile, generated, comment-only, rename-only). */
  mechanical: boolean;
};

export type ScopeStops = {
  /** For each class, the files and lines in that class and every class above it. */
  cumulative: Record<RiskClass, Tally>;
  /** For each class, the files and lines in that class alone. */
  group: Record<RiskClass, Tally>;
  /** Mechanical files below Critical; they are not counted against the budget. */
  mechanical: Tally;
  /** Files with no known class. */
  unclassified: Tally;
};

export type ResolvedScope = {
  /** The lowest class included. */
  threshold: RiskClass;
  /** Every class included, most scrutiny first. */
  classes: RiskClass[];
  auto: boolean;
  /** The included files carry more lines than the budget. */
  overBudget: boolean;
};

const empty = (): Tally => ({ files: 0, lines: 0 });
const record = (): Record<RiskClass, Tally> => ({ critical: empty(), elevated: empty(), normal: empty(), low: empty() });

/** The classes from Critical down to `threshold`. */
export const classesFor = (threshold: RiskClass): RiskClass[] => RISK_CLASSES.slice(0, RISK_CLASSES.indexOf(threshold) + 1);

export function scopeStops(files: readonly ScopeFile[]): ScopeStops {
  const group = record();
  const mechanical = empty();
  const unclassified = empty();
  for (const file of files) {
    const into = file.riskClass === undefined ? unclassified : isApart(file.riskClass, file.mechanical) ? mechanical : group[file.riskClass];
    into.files += 1;
    into.lines += file.lines;
  }
  const cumulative = record();
  const running = empty();
  for (const c of RISK_CLASSES) {
    running.files += group[c].files;
    running.lines += group[c].lines;
    cumulative[c] = { ...running };
  }
  return { cumulative, group, mechanical, unclassified };
}

/** The widest class whose cumulative lines fit the budget; never narrower than Critical. */
export function autoThreshold(stops: ScopeStops, budget: number = REVIEW_LINE_BUDGET): RiskClass {
  for (let i = RISK_CLASSES.length - 1; i > 0; i--) {
    const c = RISK_CLASSES[i]!;
    if (stops.cumulative[c].lines <= budget) return c;
  }
  return 'critical';
}

export function resolveScope(choice: ScopeChoice, stops: ScopeStops, budget: number = REVIEW_LINE_BUDGET): ResolvedScope {
  const threshold = choice === 'auto' ? autoThreshold(stops, budget) : choice;
  return { threshold, classes: classesFor(threshold), auto: choice === 'auto', overBudget: stops.cumulative[threshold].lines > budget };
}

/** A mechanical file below Critical is grouped apart and counted against no budget. */
export const isApart = (riskClass: RiskClass | undefined, mechanical: boolean): boolean => mechanical && riskClass !== undefined && riskClass !== 'critical';

export type FileScope = {
  stops: ScopeStops;
  scope: ResolvedScope;
  /** The class used to decide scope membership; undefined for a file with no class or one grouped apart. */
  classOf: (file: { path: string }) => RiskClass | undefined;
  /** Files whose class is in the scope. */
  inScope: (file: { path: string }) => boolean;
  /** The lines of a file, added plus removed. */
  linesOf: (path: string) => number;
};

/** The scope for a file list under a report. With no report there is no class to scope by, so nothing is filtered. */
export function fileScope(files: readonly ChangedFile[], report: RiskReport | null, choice: ScopeChoice): FileScope {
  const riskOf = new Map((report?.files ?? []).map((f) => [f.path, f]));
  const lines = new Map(files.map((f) => [f.path, f.linesAdded + f.linesRemoved]));
  const scopeFiles: ScopeFile[] = files.map((f) => ({
    path: f.path,
    riskClass: riskOf.get(f.path)?.effectiveClass,
    lines: lines.get(f.path) ?? 0,
    mechanical: riskOf.get(f.path)?.mechanical === true,
  }));
  const stops = scopeStops(scopeFiles);
  const scope = resolveScope(choice, stops);
  const classOf = (file: { path: string }): RiskClass | undefined => {
    const r = riskOf.get(file.path);
    return r === undefined || isApart(r.effectiveClass, r.mechanical) ? undefined : r.effectiveClass;
  };
  return {
    stops,
    scope,
    classOf,
    inScope: (file) => {
      const c = classOf(file);
      return c !== undefined && scope.classes.includes(c);
    },
    linesOf: (path) => lines.get(path) ?? 0,
  };
}
