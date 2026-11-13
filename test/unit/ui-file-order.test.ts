// T036 (VO-027, FR-029, FR-030): the one ordering function the file list and the Files view share.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RiskClass } from '../../src/contracts/http.ts';
import { arrangeFiles, neighbours } from '../../src/ui/state/file-order.ts';

type F = { path: string; previousPath?: string };
const files: F[] = [
  { path: 'src/z-normal.ts' },
  { path: 'src/B-critical.ts' },
  { path: 'docs/low.md' },
  { path: 'src/a-critical.ts' },
  { path: 'src/e-elevated.ts' },
  { path: 'README.md', previousPath: 'docs/old-readme.md' },
];
const classes: Record<string, RiskClass> = {
  'src/z-normal.ts': 'normal',
  'src/B-critical.ts': 'critical',
  'docs/low.md': 'low',
  'src/a-critical.ts': 'critical',
  'src/e-elevated.ts': 'elevated',
  'README.md': 'normal',
};
const classOf = (f: F): RiskClass | undefined => classes[f.path];
const none = { classes: [] as RiskClass[], text: '' };

test('diff order is the default and keeps the order given', () => {
  assert.deepEqual(arrangeFiles(files, classOf, { order: 'diff', ...none }).map((f) => f.path), files.map((f) => f.path));
});

test('risk order is Critical, Elevated, Normal, Low with ties by path, ascending and case-insensitive', () => {
  assert.deepEqual(arrangeFiles(files, classOf, { order: 'risk', ...none }).map((f) => f.path), [
    'src/a-critical.ts',
    'src/B-critical.ts',
    'src/e-elevated.ts',
    'README.md',
    'src/z-normal.ts',
    'docs/low.md',
  ]);
});

test('the class filter uses the effective class; none chosen means all', () => {
  const only = arrangeFiles(files, classOf, { order: 'diff', classes: ['critical', 'elevated'], text: '' });
  assert.deepEqual(only.map((f) => f.path), ['src/B-critical.ts', 'src/a-critical.ts', 'src/e-elevated.ts']);
  assert.equal(arrangeFiles(files, classOf, { order: 'diff', ...none }).length, files.length);
});

test('a file with no known class is shown with no class filter and hidden when one is chosen', () => {
  const unknown = (f: F): RiskClass | undefined => (f.path === 'docs/low.md' ? undefined : classes[f.path]);
  assert.ok(arrangeFiles(files, unknown, { order: 'risk', ...none }).some((f) => f.path === 'docs/low.md'));
  assert.equal(arrangeFiles(files, unknown, { order: 'diff', classes: ['low'], text: '' }).length, 0);
});

test('the text filter must also be satisfied, against the path and the previous path', () => {
  assert.deepEqual(arrangeFiles(files, classOf, { order: 'risk', classes: ['critical', 'elevated'], text: 'CRITICAL' }).map((f) => f.path), ['src/a-critical.ts', 'src/B-critical.ts']);
  assert.deepEqual(arrangeFiles(files, classOf, { order: 'diff', classes: [], text: 'old-readme' }).map((f) => f.path), ['README.md']);
  assert.deepEqual(arrangeFiles(files, classOf, { order: 'diff', classes: ['low'], text: 'src' }), []);
});

test('Next and Previous follow the arranged list and report no neighbour at either end, without wrapping', () => {
  const arranged = arrangeFiles(files, classOf, { order: 'risk', ...none });
  assert.deepEqual(neighbours(arranged, 'src/a-critical.ts'), { prev: undefined, next: arranged[1] });
  assert.deepEqual(neighbours(arranged, 'src/e-elevated.ts'), { prev: arranged[1], next: arranged[3] });
  assert.deepEqual(neighbours(arranged, 'docs/low.md'), { prev: arranged[4], next: undefined });
  assert.deepEqual(neighbours(arranged, 'not-listed.ts'), { prev: undefined, next: undefined });
});
