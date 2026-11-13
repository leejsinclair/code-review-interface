// T044 (VO-018, VO-019, SC-004): applying the AI's opinion. It can only raise a class, and only with a cited
// line that resolves to a changed line of that file on that side. Everything else is recorded as ignored with a
// reason from a closed set.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { LineRange, RiskClass } from '../../src/contracts/http.ts';
import { assessOutput, isRiskOutput, type AssessFile } from '../../src/core/risk/assess.ts';

// Head lines 11 (added) and base line 11 (removed).
const PATCH = '@@ -10,3 +10,3 @@\n keep\n-old line\n+new line\n tail\n';
const files: AssessFile[] = [
  { path: 'src/normal.ts', ruleClass: 'normal', assessable: true, patch: PATCH },
  { path: 'src/critical.ts', ruleClass: 'critical', assessable: true, patch: PATCH },
  { path: 'src/elevated.ts', ruleClass: 'elevated', assessable: true, patch: PATCH },
  { path: 'package-lock.json', ruleClass: 'low', assessable: false, patch: PATCH },
];
const head = (n: number): LineRange => ({ side: 'head', startLine: n, endLine: n });
const opinion = (path: string, cls: RiskClass, lines: LineRange[] = [head(11)]) => ({ path, class: cls, reasons: [`why ${path}`], lines });
const run = (...entries: ReturnType<typeof opinion>[]) => assessOutput({ files: entries }, files);
const item = (items: ReturnType<typeof run>, path: string) => items.find((i) => i.path === path);

test('a raise with a cited line that is a changed line applies', () => {
  const items = run(opinion('src/normal.ts', 'elevated'));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.applied, true);
  assert.equal(items[0]?.ignoredReason, null);
  assert.equal(items[0]?.proposedClass, 'elevated');
  assert.deepEqual(items[0]?.lines, [{ side: 'head', startLine: 11, endLine: 11, resolved: true }]);
  assert.deepEqual(items[0]?.reasons, ['why src/normal.ts']);
});

test('VO-018 a lower class, an equal class and low give no change and are recorded as not-higher', () => {
  const items = run(opinion('src/critical.ts', 'elevated'), opinion('src/elevated.ts', 'elevated'), opinion('src/normal.ts', 'low'));
  for (const i of items) {
    assert.equal(i.applied, false, i.path);
    assert.equal(i.ignoredReason, 'not-higher', i.path);
  }
  assert.equal(item(items, 'src/normal.ts')?.proposedClass, 'normal', 'a proposed low is kept as the lowest the store accepts, and ignored');
});

test('VO-019 a raise with no cited line, a line outside the changes, or on the wrong side is ignored as no-resolvable-line', () => {
  const none = run(opinion('src/normal.ts', 'critical', []));
  assert.equal(none[0]?.ignoredReason, 'no-resolvable-line');
  const outside = run(opinion('src/normal.ts', 'critical', [head(40)]));
  assert.equal(outside[0]?.applied, false);
  assert.equal(outside[0]?.ignoredReason, 'no-resolvable-line');
  assert.deepEqual(outside[0]?.lines, [{ side: 'head', startLine: 40, endLine: 40, resolved: false }], 'the cited line is kept, unresolved');
  // Line 11 on the base side is the removed line; line 12 on base is context, not a change.
  assert.equal(run(opinion('src/normal.ts', 'critical', [{ side: 'base', startLine: 11, endLine: 11 }]))[0]?.applied, true);
  assert.equal(run(opinion('src/normal.ts', 'critical', [{ side: 'base', startLine: 12, endLine: 12 }]))[0]?.applied, false);
  // One resolvable range among others is enough; the rest are recorded unresolved.
  const mixed = run(opinion('src/normal.ts', 'critical', [head(40), head(11)]));
  assert.equal(mixed[0]?.applied, true);
  assert.deepEqual(mixed[0]?.lines.map((l) => l.resolved), [false, true]);
});

test('VO-019 an unknown file is ignored as unknown-file; an opinion on an unassessable file as not-assessable', () => {
  const items = run(opinion('src/ghost.ts', 'critical'), opinion('package-lock.json', 'critical'));
  assert.equal(item(items, 'src/ghost.ts')?.ignoredReason, 'unknown-file');
  assert.equal(item(items, 'package-lock.json')?.ignoredReason, 'not-assessable');
  assert.equal(items.every((i) => !i.applied), true);
});

test('a path named twice keeps the first opinion', () => {
  const items = run(opinion('src/normal.ts', 'elevated'), opinion('src/normal.ts', 'critical'));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.proposedClass, 'elevated');
});

test('the output guard accepts the schema shape and rejects anything else', () => {
  assert.equal(isRiskOutput({ files: [] }), true);
  assert.equal(isRiskOutput({ files: [opinion('a', 'elevated')] }), true);
  for (const bad of [null, [], { files: 'x' }, { files: [{ path: 'a' }] }, { files: [{ ...opinion('a', 'elevated'), class: 'urgent' }] }, { files: [{ ...opinion('a', 'elevated'), lines: [{ side: 'head', startLine: 0, endLine: 1 }] }] }, { files: [{ ...opinion('a', 'elevated'), reasons: [3] }] }]) {
    assert.equal(isRiskOutput(bad), false, JSON.stringify(bad));
  }
});

test('SC-004 the only comparison that raises a class is isHigher inside assess.ts', () => {
  const source = readFileSync(new URL('../../src/core/risk/assess.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/isHigher\(/g) ?? []).length, 1);
  assert.equal(/applied:\s*true/.test(source.replace(/\/\/.*$/gm, '')), true);
  assert.equal((source.match(/applied:\s*true/g) ?? []).length, 1, 'one place sets an item applied');
});

test('an AI raise on a Normal test file with a cited changed line applies', () => {
  const test = { path: 'test/auth/login.test.ts', ruleClass: 'normal' as const, assessable: true, patch: PATCH };
  const items = assessOutput({ files: [opinion(test.path, 'elevated')] }, [test]);
  assert.equal(items[0]?.applied, true);
});
