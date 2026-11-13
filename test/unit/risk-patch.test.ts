// T007 (RR-7): parse a stored patch into changed lines with a side and a line number, and fingerprint a file's
// change so an override carries across snapshots only while the change is the same.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeFingerprint, changedLines, type FingerprintInput } from '../../src/core/risk/patch.ts';

const PATCH = '@@ -10,3 +10,3 @@ fn\n keep\n-old line\n+new line\n tail\n';

test('changed lines carry the side and the line number on that side', () => {
  const lines = changedLines(PATCH);
  assert.deepEqual(
    lines.map((l) => [l.side, l.line, l.text]),
    [
      ['base', 11, 'old line'],
      ['head', 11, 'new line'],
    ],
  );
});

test('a null or empty patch has no changed lines', () => {
  assert.deepEqual(changedLines(null), []);
  assert.deepEqual(changedLines(''), []);
});

const base = (patch: string | null, extra: Partial<FingerprintInput> = {}): FingerprintInput => ({
  status: 'modified',
  oldPath: null,
  path: 'src/a.ts',
  patch,
  additions: 1,
  deletions: 1,
  sizeBytes: null,
  ...extra,
});

test('the fingerprint is equal for the same changed lines at shifted positions', () => {
  const shifted = '@@ -200,3 +205,3 @@ other heading\n context a\n-old line\n+new line\n context b\n';
  assert.equal(changeFingerprint(base(PATCH)), changeFingerprint(base(shifted)));
});

test('the fingerprint ignores everything but the file and its changed lines (not the head commit)', () => {
  assert.match(changeFingerprint(base(PATCH)), /^[0-9a-f]{64}$/);
  assert.equal(changeFingerprint(base(PATCH)), changeFingerprint(base(PATCH + '\n')));
});

test('the fingerprint differs when a changed line, the status or a path differs', () => {
  const changed = PATCH.replace('new line', 'newer line');
  assert.notEqual(changeFingerprint(base(PATCH)), changeFingerprint(base(changed)));
  assert.notEqual(changeFingerprint(base(PATCH)), changeFingerprint(base(PATCH, { status: 'added' })));
  assert.notEqual(changeFingerprint(base(PATCH)), changeFingerprint(base(PATCH, { path: 'src/b.ts' })));
  assert.notEqual(changeFingerprint(base(PATCH)), changeFingerprint(base(PATCH, { oldPath: 'src/c.ts', status: 'renamed' })));
});

test('a file with no patch falls back to status, paths, counts and size', () => {
  const skipped = base(null, { additions: 9, deletions: 2, sizeBytes: 5_000_000 });
  assert.equal(changeFingerprint(skipped), changeFingerprint({ ...skipped }));
  assert.notEqual(changeFingerprint(skipped), changeFingerprint({ ...skipped, additions: 10 }));
  assert.notEqual(changeFingerprint(skipped), changeFingerprint({ ...skipped, sizeBytes: 5_000_001 }));
  assert.notEqual(changeFingerprint(skipped), changeFingerprint(base(PATCH)));
});
