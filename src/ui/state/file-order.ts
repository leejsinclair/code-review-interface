// The one ordering and filtering function for the changed-file list and the Files view (research RR-10), so
// "Next and Previous follow the chosen order" is one tested function, not two copies. Pure.

import type { RiskClass } from '../../contracts/http.ts';

export type FileOrder = 'diff' | 'risk';

export type ArrangeOptions = {
  order: FileOrder;
  /** The classes to show; empty means every class. */
  classes: readonly RiskClass[];
  /** Case-insensitive text the path (or the previous path) must contain. */
  text: string;
};

const RANK: Readonly<Record<RiskClass, number>> = { critical: 0, elevated: 1, normal: 2, low: 3 };
const lower = (s: string): string => s.toLowerCase();

/**
 * The files to show, in the order to show them. Diff order keeps the order given. Risk order is Critical,
 * Elevated, Normal, Low, ties by path ascending and case-insensitive; a file with no known class sorts last.
 * A file with no known class is hidden while a class filter is chosen.
 */
export function arrangeFiles<T extends { path: string; previousPath?: string | undefined }>(
  files: readonly T[],
  classOf: (file: T) => RiskClass | undefined,
  options: ArrangeOptions,
): T[] {
  const needle = lower(options.text.trim());
  const shown = files.filter((f) => {
    if (options.classes.length > 0) {
      const c = classOf(f);
      if (c === undefined || !options.classes.includes(c)) return false;
    }
    return needle === '' || lower(f.path).includes(needle) || lower(f.previousPath ?? '').includes(needle);
  });
  if (options.order === 'diff') return shown;
  const rank = (f: T): number => {
    const c = classOf(f);
    return c === undefined ? 4 : RANK[c];
  };
  return [...shown].sort((a, b) => rank(a) - rank(b) || (lower(a.path) < lower(b.path) ? -1 : lower(a.path) > lower(b.path) ? 1 : 0));
}

/** The neighbours of `path` in an arranged list; nothing before the first or after the last (no wrap). */
export function neighbours<T extends { path: string }>(arranged: readonly T[], path: string): { prev: T | undefined; next: T | undefined } {
  const at = arranged.findIndex((f) => f.path === path);
  if (at === -1) return { prev: undefined, next: undefined };
  return { prev: at > 0 ? arranged[at - 1] : undefined, next: arranged[at + 1] };
}
