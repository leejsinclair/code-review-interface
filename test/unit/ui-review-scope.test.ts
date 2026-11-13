// The review scope: which classes of changed file fit a reviewer's line budget. Pure counts, never a score (FR-002).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RiskClass } from '../../src/contracts/http.ts';
import { REVIEW_LINE_BUDGET, autoThreshold, classesFor, resolveScope, scopeStops, type ScopeFile } from '../../src/ui/state/review-scope.ts';

const f = (path: string, riskClass: RiskClass | undefined, lines: number, mechanical = false): ScopeFile => ({ path, riskClass, lines, mechanical });

test('the budget is 400 changed lines', () => {
  assert.equal(REVIEW_LINE_BUDGET, 400);
});

test('classesFor includes every class down to the threshold, most scrutiny first', () => {
  assert.deepEqual(classesFor('critical'), ['critical']);
  assert.deepEqual(classesFor('elevated'), ['critical', 'elevated']);
  assert.deepEqual(classesFor('low'), ['critical', 'elevated', 'normal', 'low']);
});

test('scopeStops counts files and lines cumulatively and per class group', () => {
  const stops = scopeStops([f('a', 'critical', 10), f('b', 'elevated', 20), f('c', 'elevated', 5), f('d', 'normal', 100), f('e', 'low', 1)]);
  assert.deepEqual(stops.cumulative.critical, { files: 1, lines: 10 });
  assert.deepEqual(stops.cumulative.elevated, { files: 3, lines: 35 });
  assert.deepEqual(stops.cumulative.normal, { files: 4, lines: 135 });
  assert.deepEqual(stops.cumulative.low, { files: 5, lines: 136 });
  assert.deepEqual(stops.group.elevated, { files: 2, lines: 25 });
});

test('mechanical files are left out of the budget, unless they are Critical', () => {
  const stops = scopeStops([f('lock', 'normal', 5000, true), f('gen', 'low', 900, true), f('a', 'normal', 50), f('crit-lock', 'critical', 30, true)]);
  assert.deepEqual(stops.mechanical, { files: 2, lines: 5900 });
  assert.deepEqual(stops.cumulative.critical, { files: 1, lines: 30 });
  assert.deepEqual(stops.cumulative.low, { files: 2, lines: 80 });
});

test('files with no known class are outside every stop', () => {
  const stops = scopeStops([f('a', 'critical', 10), f('x', undefined, 999)]);
  assert.deepEqual(stops.cumulative.low, { files: 1, lines: 10 });
  assert.deepEqual(stops.unclassified, { files: 1, lines: 999 });
});

test('auto takes everything when the whole pull request fits the budget', () => {
  const stops = scopeStops([f('a', 'critical', 100), f('b', 'low', 300)]);
  assert.equal(autoThreshold(stops), 'low');
});

test('auto stops at the widest class that still fits', () => {
  const stops = scopeStops([f('a', 'critical', 100), f('b', 'elevated', 200), f('c', 'normal', 150)]);
  assert.equal(autoThreshold(stops), 'elevated');
});

test('auto never goes narrower than Critical, and reports over budget', () => {
  const stops = scopeStops([f('a', 'critical', 1240), f('b', 'elevated', 5)]);
  assert.equal(autoThreshold(stops), 'critical');
  const scope = resolveScope('auto', stops);
  assert.deepEqual(scope, { threshold: 'critical', classes: ['critical'], auto: true, overBudget: true });
});

test('a manual choice wins over auto and is over budget only when its lines exceed it', () => {
  const stops = scopeStops([f('a', 'critical', 100), f('b', 'elevated', 200), f('c', 'normal', 150)]);
  assert.deepEqual(resolveScope('normal', stops), { threshold: 'normal', classes: ['critical', 'elevated', 'normal'], auto: false, overBudget: true });
  assert.deepEqual(resolveScope('elevated', stops), { threshold: 'elevated', classes: ['critical', 'elevated'], auto: false, overBudget: false });
});

test('an empty pull request resolves to everything, within budget', () => {
  assert.deepEqual(resolveScope('auto', scopeStops([])), { threshold: 'low', classes: ['critical', 'elevated', 'normal', 'low'], auto: true, overBudget: false });
});

// ---- fileScope: the same decision for the list and for Next / Previous.

import type { ChangedFile, RiskFile, RiskReport } from '../../src/contracts/http.ts';
import { fileScope } from '../../src/ui/state/review-scope.ts';

const changed = (path: string, added: number, removed = 0): ChangedFile => ({ path, status: 'modified', linesAdded: added, linesRemoved: removed, binary: false });
const risk = (path: string, effectiveClass: RiskClass, mechanical = false): RiskFile => ({ path, effectiveClass, mechanical }) as RiskFile;
const report = (files: RiskFile[]): RiskReport => ({ files }) as RiskReport;

test('fileScope sums added and removed lines and decides membership from the report', () => {
  const files = [changed('a', 100, 50), changed('b', 200), changed('c', 100), changed('lock', 9000)];
  const r = report([risk('a', 'critical'), risk('b', 'elevated'), risk('c', 'normal'), risk('lock', 'low', true)]);
  const s = fileScope(files, r, 'auto');
  assert.equal(s.scope.threshold, 'elevated', 'Normal would take it to 450 lines');
  assert.equal(s.linesOf('a'), 150);
  assert.equal(s.inScope({ path: 'b' }), true);
  assert.equal(s.inScope({ path: 'c' }), false);
  assert.equal(s.inScope({ path: 'lock' }), false, 'mechanical files are grouped apart');
  assert.equal(s.classOf({ path: 'lock' }), undefined);
  assert.equal(s.inScope({ path: 'unknown' }), false);
});

test('fileScope with no report has no class for any file', () => {
  const s = fileScope([changed('a', 10)], null, 'auto');
  assert.equal(s.classOf({ path: 'a' }), undefined);
  assert.equal(s.stops.unclassified.files, 1);
});
