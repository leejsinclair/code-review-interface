// VO-058 (FR-049, EC-05): per-file exclusion and the prompt budget.
//
// The module under test is `src/core/limits.ts` (T025). It is loaded inside each
// test body, so this file still loads before the module exists.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Limits } from '../../src/core/limits.ts';

const loadLimits = () => import('../../src/core/limits.ts');

const MB = 1_048_576;

/** The fields `excludedReason` reads (from a changed file) plus the `chars` cost `fillBudget` reads. */
interface PrFile {
  path: string;
  binary: boolean;
  sizeBytes: number | null;
  additions: number;
  deletions: number;
  /** Characters this file's diff adds to the prompt. */
  chars: number;
}

const file = (path: string, over: Partial<PrFile> = {}): PrFile => ({
  path,
  binary: false,
  sizeBytes: 2_000,
  additions: 10,
  deletions: 5,
  chars: 1_000,
  ...over,
});

/** The pipeline FR-049 describes: per-file reasons first, then the budget over what is left, in diff order. */
async function leftOut(files: readonly PrFile[], limits: Limits) {
  const { excludedReason, fillBudget } = await loadLimits();
  const excluded: { path: string; reason: string }[] = [];
  const candidates: PrFile[] = [];
  for (const f of files) {
    const reason = excludedReason(f, limits);
    if (reason === null) candidates.push(f);
    else excluded.push({ path: f.path, reason });
  }
  const budget = fillBudget(candidates, limits.maxPromptChars);
  const all = [...excluded, ...budget.excluded];
  const order = new Map(files.map((f, i) => [f.path, i]));
  all.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
  return { included: budget.included.map((f: PrFile) => f.path), excluded: all };
}

test('VO-058 limits default to 1,048,576 bytes, 5,000 changed lines and 400,000 prompt characters', async () => {
  const { DEFAULT_LIMITS } = await loadLimits();
  assert.deepEqual(DEFAULT_LIMITS, { maxFileBytes: 1_048_576, maxChangedLines: 5_000, maxPromptChars: 400_000 });
});

test('VO-058 per-file exclusion checks binary, then file size, then changed lines', async () => {
  const { excludedReason, DEFAULT_LIMITS } = await loadLimits();
  const limits = DEFAULT_LIMITS;

  assert.equal(excludedReason(file('plain.ts'), limits), null);

  // Binary wins over every other reason.
  assert.equal(excludedReason(file('logo.png', { binary: true }), limits), 'binary');
  assert.equal(
    excludedReason(file('huge.bin', { binary: true, sizeBytes: 10 * MB, additions: 9_000, deletions: 9_000 }), limits),
    'binary',
  );

  // Size wins over changed lines.
  assert.equal(excludedReason(file('big.json', { sizeBytes: MB + 1 }), limits), 'file size');
  assert.equal(
    excludedReason(file('big.sql', { sizeBytes: MB + 1, additions: 6_000, deletions: 0 }), limits),
    'file size',
  );

  // Changed lines are additions plus deletions.
  assert.equal(excludedReason(file('churn.ts', { additions: 2_501, deletions: 2_500 }), limits), 'changed lines');
  assert.equal(excludedReason(file('churn2.ts', { additions: 0, deletions: 5_001 }), limits), 'changed lines');
});

test('VO-058 a file exactly at a limit is kept, and an unknown size is not a size exclusion', async () => {
  const { excludedReason, DEFAULT_LIMITS } = await loadLimits();
  assert.equal(excludedReason(file('edge-size.ts', { sizeBytes: MB }), DEFAULT_LIMITS), null);
  assert.equal(excludedReason(file('edge-lines.ts', { additions: 2_500, deletions: 2_500 }), DEFAULT_LIMITS), null);
  // A deleted file or a platform diff has no size at head.
  assert.equal(excludedReason(file('deleted.ts', { sizeBytes: null }), DEFAULT_LIMITS), null);
  assert.equal(
    excludedReason(file('deleted-churn.ts', { sizeBytes: null, additions: 0, deletions: 6_000 }), DEFAULT_LIMITS),
    'changed lines',
  );
});

test('VO-058 the prompt budget fills in diff order and leaves the rest out with prompt limit', async () => {
  const { fillBudget } = await loadLimits();
  const files = [
    file('a.ts', { chars: 100 }),
    file('b.ts', { chars: 200 }),
    file('c.ts', { chars: 300 }),
    file('d.ts', { chars: 10 }),
  ];

  const result = fillBudget(files, 350);
  assert.deepEqual(
    result.included.map((f: PrFile) => f.path),
    ['a.ts', 'b.ts'],
  );
  // `d.ts` would fit on its own, but the budget fills in diff order and stops at the first file that does not fit.
  assert.deepEqual(result.excluded, [
    { path: 'c.ts', reason: 'prompt limit' },
    { path: 'd.ts', reason: 'prompt limit' },
  ]);
  // The included files are the caller's own objects, in their original order.
  assert.equal(result.included[0], files[0]);
  assert.equal(result.included[1], files[1]);
});

test('VO-058 the prompt budget includes a file that lands exactly on the limit', async () => {
  const { fillBudget } = await loadLimits();
  const files = [file('a.ts', { chars: 150 }), file('b.ts', { chars: 250 }), file('c.ts', { chars: 1 })];
  const result = fillBudget(files, 400);
  assert.deepEqual(
    result.included.map((f: PrFile) => f.path),
    ['a.ts', 'b.ts'],
  );
  assert.deepEqual(result.excluded, [{ path: 'c.ts', reason: 'prompt limit' }]);

  const empty = fillBudget([], 400);
  assert.deepEqual(empty, { included: [], excluded: [] });

  const everything = fillBudget(files, 1_000);
  assert.equal(everything.included.length, 3);
  assert.deepEqual(everything.excluded, []);
});

test('VO-058 a large PR leaves out binary, file size, changed lines and prompt limit files in diff order', async () => {
  const { DEFAULT_LIMITS } = await loadLimits();
  const files = [
    file('src/one.ts', { chars: 150_000 }),
    file('assets/logo.png', { binary: true, sizeBytes: 40_000, additions: 0, deletions: 0, chars: 0 }),
    file('data/dump.json', { sizeBytes: 2 * MB, additions: 100, deletions: 0, chars: 90_000 }),
    file('src/generated.ts', { sizeBytes: 500_000, additions: 5_200, deletions: 300, chars: 300_000 }),
    file('src/two.ts', { chars: 150_000 }),
    file('src/three.ts', { chars: 150_000 }),
    file('src/four.ts', { chars: 20_000 }),
  ];

  const result = await leftOut(files, DEFAULT_LIMITS);
  assert.deepEqual(result.included, ['src/one.ts', 'src/two.ts']);
  assert.deepEqual(result.excluded, [
    { path: 'assets/logo.png', reason: 'binary' },
    { path: 'data/dump.json', reason: 'file size' },
    { path: 'src/generated.ts', reason: 'changed lines' },
    { path: 'src/three.ts', reason: 'prompt limit' },
    { path: 'src/four.ts', reason: 'prompt limit' },
  ]);
});

test('VO-058 lowered limits change which files are left out', async () => {
  const { DEFAULT_LIMITS } = await loadLimits();
  const files = [
    file('a.ts', { sizeBytes: 300_000, additions: 100, deletions: 0, chars: 60_000 }),
    file('b.ts', { sizeBytes: 20_000, additions: 900, deletions: 200, chars: 40_000 }),
    file('c.ts', { sizeBytes: 10_000, additions: 50, deletions: 50, chars: 50_000 }),
    file('d.ts', { sizeBytes: 5_000, additions: 20, deletions: 0, chars: 30_000 }),
  ];

  const atDefaults = await leftOut(files, DEFAULT_LIMITS);
  assert.deepEqual(atDefaults.included, ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  assert.deepEqual(atDefaults.excluded, []);

  const lowered: Limits = { maxFileBytes: 200_000, maxChangedLines: 1_000, maxPromptChars: 60_000 };
  const atLowered = await leftOut(files, lowered);
  assert.deepEqual(atLowered.included, ['c.ts']);
  assert.deepEqual(atLowered.excluded, [
    { path: 'a.ts', reason: 'file size' },
    { path: 'b.ts', reason: 'changed lines' },
    { path: 'd.ts', reason: 'prompt limit' },
  ]);
});
