import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffLine } from '../../src/contracts/http.ts';
import { anchor, clear, extend, isSelected, move, scopeText, toScope } from '../../src/ui/state/selection.ts';

const rows: DiffLine[] = [
  { type: 'context', oldLine: 9, newLine: 10, text: 'a' },
  { type: 'remove', oldLine: 10, text: 'b' },
  { type: 'add', newLine: 11, text: 'c' },
  { type: 'add', newLine: 12, text: 'd' },
  { type: 'context', oldLine: 11, newLine: 13, text: 'e' },
];

test('anchor, then a second line on the same side extends a single-line selection', () => {
  const a = anchor(null, 'head', 11);
  assert.deepEqual(a, { side: 'head', anchor: 11, focus: 11 });
  const r = anchor(a, 'head', 13);
  assert.equal(scopeText('f.js', r), 'Selected: f.js lines 11–13 (new side)');
  assert.deepEqual(anchor(r, 'head', 10), { side: 'head', anchor: 10, focus: 10 });
});

test('a line on the other side starts a new selection on that side', () => {
  const a = anchor(anchor(null, 'head', 11), 'base', 10);
  assert.deepEqual(a, { side: 'base', anchor: 10, focus: 10 });
  assert.equal(scopeText('f.js', a), 'Selected: f.js lines 10–10 (old side)');
});

test('extend moves the free end within the side and keeps the anchor; reversed ranges normalise', () => {
  let s = extend(null, { side: 'head', line: 12 }, rows, -1);
  assert.deepEqual(s, { side: 'head', anchor: 12, focus: 11 });
  s = extend(s, { side: 'head', line: 11 }, rows, -1);
  assert.equal(scopeText('f.js', s), 'Selected: f.js lines 10–12 (new side)');
  assert.equal(extend(s, { side: 'head', line: 10 }, rows, -1), s);
  assert.deepEqual(toScope('f.js', s, ' m '), { type: 'range', path: 'f.js', side: 'head', startLine: 10, endLine: 12, label: 'm' });
});

test('up/down stay on a side; context lines are not selectable on the old side', () => {
  assert.deepEqual(move(rows, { side: 'head', line: 10 }, 'down'), { side: 'head', line: 11 });
  assert.deepEqual(move(rows, { side: 'head', line: 10 }, 'up'), { side: 'head', line: 10 });
  assert.deepEqual(move(rows, { side: 'base', line: 10 }, 'down'), { side: 'base', line: 10 });
});

test('left/right switch side only where the other side has a number', () => {
  assert.deepEqual(move(rows, { side: 'head', line: 11 }, 'left'), { side: 'head', line: 11 });
  assert.deepEqual(move(rows, { side: 'base', line: 10 }, 'right'), { side: 'base', line: 10 });
  assert.deepEqual(move(rows, { side: 'head', line: 10 }, 'left'), { side: 'head', line: 10 });
});

test('clear, and isSelected honours the side', () => {
  const s = anchor(anchor(null, 'head', 11), 'head', 12);
  assert.ok(isSelected(s, 'head', 12));
  assert.ok(!isSelected(s, 'base', 12));
  assert.equal(clear(), null);
});
