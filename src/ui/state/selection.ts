// Diff selection (data-model 4.3): the keyboard and pointer model for choosing a line range. Pure; the
// diff screen holds the state. One side per selection; a context line is selectable on the head side only.

import type { DiffLine, Scope, Side } from '../../contracts/http.ts';
import { scopeBarText } from '../labels.ts';

export type Selection = { side: Side; anchor: number; focus: number };
export type Cursor = { side: Side; line: number };
export type Direction = 'up' | 'down' | 'left' | 'right';

/** The number a row offers on a side, or undefined where that side is not selectable. */
export function lineNumber(row: DiffLine, side: Side): number | undefined {
  return side === 'head' ? row.newLine : row.type === 'remove' ? row.oldLine : undefined;
}

const bounds = (s: Selection): { start: number; end: number } => ({ start: Math.min(s.anchor, s.focus), end: Math.max(s.anchor, s.focus) });

/** Enter, Space or a click on a line. */
export function anchor(current: Selection | null, side: Side, line: number): Selection {
  if (current !== null && current.side === side && current.anchor === current.focus && line !== current.anchor) {
    return { side, anchor: current.anchor, focus: line };
  }
  return { side, anchor: line, focus: line };
}

export function clear(): null {
  return null;
}

function numbers(rows: readonly DiffLine[], side: Side): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const n = lineNumber(r, side);
    if (n !== undefined) out.push(n);
  }
  return out;
}

/** Shift+Up/Down: move the free end by one selectable line on the same side. */
export function extend(current: Selection | null, cursor: Cursor, rows: readonly DiffLine[], step: 1 | -1): Selection {
  const base: Selection = current ?? { side: cursor.side, anchor: cursor.line, focus: cursor.line };
  const list = numbers(rows, base.side);
  const i = list.indexOf(base.focus);
  const next = list[i + step];
  return next === undefined ? base : { ...base, focus: next };
}

/** Arrow keys: up/down within the side; left/right to the other side of the same row when it has a number. */
export function move(rows: readonly DiffLine[], cursor: Cursor, direction: Direction): Cursor {
  const list = numbers(rows, cursor.side);
  if (direction === 'up' || direction === 'down') {
    const next = list[list.indexOf(cursor.line) + (direction === 'up' ? -1 : 1)];
    return next === undefined ? cursor : { side: cursor.side, line: next };
  }
  const other: Side = cursor.side === 'head' ? 'base' : 'head';
  const wanted: Side = direction === 'left' ? 'base' : 'head';
  if (other !== wanted) return cursor;
  const row = rows.find((r) => lineNumber(r, cursor.side) === cursor.line);
  const n = row === undefined ? undefined : lineNumber(row, other);
  return n === undefined ? cursor : { side: other, line: n };
}

export function isSelected(current: Selection | null, side: Side, line: number): boolean {
  if (current === null || current.side !== side) return false;
  const { start, end } = bounds(current);
  return line >= start && line <= end;
}

export function scopeText(path: string, current: Selection): string {
  const { start, end } = bounds(current);
  return scopeBarText(path, start, end, current.side === 'head' ? 'new' : 'old');
}

export function toScope(path: string, current: Selection, label?: string): Scope {
  const { start, end } = bounds(current);
  const range: Scope = { type: 'range', path, side: current.side, startLine: start, endLine: end };
  return label !== undefined && label.trim() !== '' ? { ...range, label: label.trim() } : range;
}
