// feature 006 (T004; FR-014, FR-015, SC-004; contracts/ai-output.md "Server checks"): the pure checks applied to
// the AI's alignment output. Citations are resolved against the stored document text and the snapshot's changed
// lines; an unresolved statement is kept as a lower-confidence Inference, never dropped; the model's `verified`
// and extra fields are refused; unparseable output becomes one Inference with a warning.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finaliseAlignment, type AlignmentContext } from '../../src/core/spec-alignment.ts';

const SPEC = '# Spec\n\n- **FR-001**: Tokens expire.\n- **FR-002**: Tokens are single use.\n';
const TDD = '# TDD evidence\n\n- FR-001: test `expires` fails then passes.\n';
// Head lines 11 (added) and base line 11 (removed).
const PATCH = '@@ -10,3 +10,3 @@\n keep\n-old line\n+new line\n tail\n';

const ctx = (overrides: Partial<AlignmentContext> = {}): AlignmentContext => ({
  documents: [
    { documentId: 'doc-spec', kind: 'specification', content: SPEC },
    { documentId: 'doc-tdd', kind: 'tdd-evidence', content: TDD },
  ],
  files: [{ path: 'src/token.ts', patch: PATCH }],
  leftOut: [],
  ...overrides,
});

const specCite = { type: 'spec' as const, documentId: 'doc-spec', startLine: 3, endLine: 3 };
const tddCite = { type: 'tdd' as const, documentId: 'doc-tdd', startLine: 3, endLine: 3 };
const codeCite = { type: 'code' as const, path: 'src/token.ts', side: 'head' as const, startLine: 11, endLine: 11 };
const stmt = (text: string, citations: unknown[] = [specCite]) => ({ text, citations });

function row(overrides: Record<string, unknown> = {}) {
  return {
    criterionId: 'FR-001',
    criterion: 'Tokens expire.',
    state: 'Implementation and test identified',
    test: 'test-shown',
    testMismatch: false,
    reason: stmt('Expiry is set.', [codeCite, tddCite]),
    ...overrides,
  };
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    summaries: { specification: stmt('Tokens expire and are single use.'), tddEvidence: stmt('One test shown.', [tddCite]) },
    rows: [row()],
    verdict: { outcome: 'sufficient', statement: stmt('Covered.'), uncovered: [], mismatched: [] },
    deviations: { implementedNotRequested: [], requestedNotImplemented: [] },
    ...overrides,
  };
}

const run = (out: unknown, c: AlignmentContext = ctx(), raw = '') => finaliseAlignment(out, raw, c);

test('every statement is stamped Inferred by the server and a resolving citation keeps it verified-by-check, not Verified', () => {
  const r = run(output());
  assert.equal(r.warning, null);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]?.reason.label, 'inference');
  assert.equal(r.rows[0]?.reason.citationStatus, 'resolved');
  assert.equal(r.summaries.specification.label, 'inference');
  assert.equal(r.verdict.statement.label, 'inference');
  assert.ok(!JSON.stringify(r).includes('"verified"'), 'no Verified label anywhere');
});

test('spec and tdd citations resolve by line range, or by quote, against the stored text', () => {
  const byQuote = run(output({ summaries: { specification: stmt('x', [{ type: 'spec', documentId: 'doc-spec', quote: 'Tokens are single use.' }]) } }));
  assert.equal(byQuote.summaries.specification.citationStatus, 'resolved');
  const badQuote = run(output({ summaries: { specification: stmt('x', [{ type: 'spec', documentId: 'doc-spec', quote: 'Tokens never expire.' }]) } }));
  assert.equal(badQuote.summaries.specification.citationStatus, 'unverified');
  const outOfRange = run(output({ summaries: { specification: stmt('x', [{ type: 'spec', documentId: 'doc-spec', startLine: 90, endLine: 91 }]) } }));
  assert.equal(outOfRange.summaries.specification.citationStatus, 'unverified');
});

test('code citations resolve only against changed lines on the cited side', () => {
  const at = (side: 'head' | 'base', line: number, path = 'src/token.ts') => run(output({ rows: [row({ reason: stmt('r', [{ type: 'code', path, side, startLine: line, endLine: line }]) })] })).rows[0]?.reason.citationStatus;
  assert.equal(at('head', 11), 'resolved');
  assert.equal(at('base', 11), 'resolved', 'the removed line');
  assert.equal(at('head', 40), 'unverified');
  assert.equal(at('base', 12), 'unverified', 'a context line is not a change');
  assert.equal(at('head', 11, 'src/other.ts'), 'unverified', 'a file that did not change');
});

test('a statement with no resolvable citation is kept as unverified and never dropped (FR-014, V.1)', () => {
  const r = run(
    output({
      rows: [row({ reason: stmt('Unsupported claim.', [{ type: 'code', path: 'src/ghost.ts', side: 'head', startLine: 1, endLine: 1 }]) }), row({ criterionId: 'FR-002', reason: stmt('No cites.', []) })],
      deviations: { implementedNotRequested: [stmt('Extra thing.', [])], requestedNotImplemented: [] },
    }),
  );
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]?.reason.text, 'Unsupported claim.');
  assert.equal(r.rows[0]?.reason.citationStatus, 'unverified');
  assert.equal(r.rows[1]?.reason.citationStatus, 'unverified');
  assert.equal(r.deviations.implementedNotRequested.length, 1);
  assert.equal(r.deviations.implementedNotRequested[0]?.citationStatus, 'unverified');
  assert.equal(r.rows[0]?.reason.label, 'inference', 'still an Inference');
});

test('one resolvable citation among others is enough; the unresolved ones stay recorded as unresolved', () => {
  const r = run(output({ rows: [row({ reason: stmt('r', [{ ...codeCite, startLine: 40, endLine: 40 }, codeCite]) })] }));
  assert.equal(r.rows[0]?.reason.citationStatus, 'resolved');
  assert.deepEqual(r.rows[0]?.reason.citations.map((c) => c.resolved), [false, true]);
});

test('an unknown documentId is kept with unresolved citations (rule 4)', () => {
  const r = run(output({ rows: [row({ reason: stmt('r', [{ type: 'spec', documentId: 'doc-nope', startLine: 3, endLine: 3 }]) })] }));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]?.reason.citationStatus, 'unverified');
  assert.equal(r.rows[0]?.reason.citations[0]?.resolved, false);
});

test('duplicate criterionId values are kept in order and flagged', () => {
  const r = run(output({ rows: [row(), row({ criterion: 'Tokens expire, again.' })] }));
  assert.deepEqual(r.rows.map((x) => x.criterion), ['Tokens expire.', 'Tokens expire, again.']);
  assert.equal(r.rows[0]?.duplicateId, true);
  assert.equal(r.rows[1]?.duplicateId, true);
  assert.equal(run(output()).rows[0]?.duplicateId, false);
});

test('a label of verified, or any field the schema does not name, makes the output unparseable', () => {
  for (const bad of [
    output({ summaries: { specification: { ...stmt('x'), label: 'verified' } } }),
    output({ rows: [row({ verified: true })] }),
    output({ coverage: 0.9 }),
    output({ verdict: { outcome: 'sufficient', statement: stmt('x'), uncovered: [], mismatched: [], percent: 100 } }),
    output({ rows: [row({ state: 'Verified' })] }),
    output({ verdict: { outcome: 'verified', statement: stmt('x'), uncovered: [], mismatched: [] } }),
  ]) {
    const r = run(bad, ctx(), 'raw model text');
    assert.equal(r.warning, 'unparseable-output');
    assert.equal(r.rows.length, 0);
  }
});

test('unparseable output becomes exactly one Inference with the unparseable-output warning (I.3)', () => {
  for (const out of ['plain prose, not JSON', null, undefined, 42, { nothing: true }]) {
    const r = run(out, ctx(), 'The model said some prose.');
    assert.equal(r.warning, 'unparseable-output');
    assert.equal(r.inference.length, 1);
    assert.equal(r.inference[0]?.label, 'inference');
    assert.equal(r.inference[0]?.text, 'The model said some prose.');
    assert.deepEqual(r.rows, []);
    assert.deepEqual(r.deviations, { implementedNotRequested: [], requestedNotImplemented: [] });
  }
  assert.deepEqual(run(output()).inference, [], 'parsed output has no fallback Inference');
});

test('a row claiming implementation and test is downgraded to Requires verification unless a test is shown and matches', () => {
  const noTest = run(output({ rows: [row({ test: 'no-test-shown' })] })).rows[0];
  assert.equal(noTest?.state, 'Requires verification');
  assert.equal(noTest?.test, 'no-test-shown');
  const mismatch = run(output({ rows: [row({ testMismatch: true })] })).rows[0];
  assert.equal(mismatch?.state, 'Requires verification');
  assert.equal(mismatch?.testMismatch, true);
  const fine = run(output()).rows[0];
  assert.equal(fine?.state, 'Implementation and test identified');
  const other = run(output({ rows: [row({ state: 'Implementation identified', test: 'no-test-shown' })] })).rows[0];
  assert.equal(other?.state, 'Implementation identified', 'other states are not touched');
});

test('tests_mismatch is kept only with a test shown', () => {
  const r = run(output({ rows: [row({ state: 'Implementation identified', test: 'no-test-shown', testMismatch: true })] })).rows[0];
  assert.equal(r?.testMismatch, false);
});

test('no evidence document: no-test-shown becomes no-evidence-available and the outcome is cannot-judge (FR-015)', () => {
  const noEvidence = ctx({ documents: [{ documentId: 'doc-spec', kind: 'specification', content: SPEC }] });
  const r = run(
    output({
      summaries: { specification: stmt('s') },
      rows: [row({ state: 'Implementation identified', test: 'no-test-shown' })],
      verdict: { outcome: 'incomplete', statement: stmt('v'), uncovered: ['FR-001'], mismatched: [] },
    }),
    noEvidence,
  );
  assert.equal(r.rows[0]?.test, 'no-evidence-available');
  assert.equal(r.verdict.outcome, 'cannot-judge');
  assert.equal(r.summaries.tddEvidence, null, 'no evidence summary');
  assert.deepEqual(r.verdict.uncovered, [], 'no row says "no test" when there is no evidence');
});

test('uncovered is recomputed as exactly the rows with no-test-shown; the model list is ignored when it differs', () => {
  const rows = [row(), row({ criterionId: 'FR-002', criterion: 'Single use.', state: 'Implementation identified', test: 'no-test-shown' })];
  const wrong = run(output({ rows, verdict: { outcome: 'incomplete', statement: stmt('v'), uncovered: ['FR-001', 'FR-999'], mismatched: [] } }));
  assert.deepEqual(wrong.verdict.uncovered, ['FR-002']);
  const right = run(output({ rows, verdict: { outcome: 'incomplete', statement: stmt('v'), uncovered: ['FR-002'], mismatched: [] } }));
  assert.deepEqual(right.verdict.uncovered, ['FR-002']);
});

test('mismatched statements are kept with their citation status', () => {
  const r = run(output({ rows: [row({ testMismatch: true })], verdict: { outcome: 'incomplete', statement: stmt('v'), uncovered: [], mismatched: [stmt('The test checks a different thing.', [tddCite]), stmt('Unsourced.', [])] } }));
  assert.deepEqual(r.verdict.mismatched.map((m) => m.citationStatus), ['resolved', 'unverified']);
});

test('no coverage figure or percentage is accepted or computed (FR-015)', () => {
  const r = run(output());
  const text = JSON.stringify(r);
  assert.ok(!/coverage|percent|ratio/i.test(Object.keys(r).concat(Object.keys(r.verdict)).join(' ')), text);
});

test('leftOut is the union of what the prompt builder cut and what the model reports', () => {
  const r = run(output({ leftOut: ['tail of the specification', 'src/big.ts'] }), ctx({ leftOut: [{ document: 'src/big.ts', part: 'diff', reason: 'prompt limit' }] }));
  const names = r.leftOut.map((l) => l.part === 'diff' ? l.document : l.document);
  assert.ok(names.includes('src/big.ts'));
  assert.ok(r.leftOut.some((l) => l.document === 'tail of the specification' || l.part === 'tail of the specification'));
  assert.equal(r.leftOut.length, 2, 'the same part named by both is listed once');
});

test('strings are plain text: markup in a statement is carried unchanged, never interpreted', () => {
  const r = run(output({ rows: [row({ reason: stmt('<img src=x onerror=alert(1)> **bold**', [codeCite]) })] }));
  assert.equal(r.rows[0]?.reason.text, '<img src=x onerror=alert(1)> **bold**');
});

// Code review of feature 006: a cited range is the model's, so checking it must not walk the range.
test('a code citation with an enormous line range is checked at once, and a verdict cannot say sufficient over an uncovered criterion', () => {
  const wide = { type: 'code' as const, path: 'src/token.ts', side: 'head' as const, startLine: 1, endLine: Number.MAX_SAFE_INTEGER };
  const miss = { type: 'code' as const, path: 'src/other.ts', side: 'head' as const, startLine: 1, endLine: Number.MAX_SAFE_INTEGER };
  const started = Date.now();
  const result = finaliseAlignment(
    output({ rows: [row({ reason: stmt('Wide.', [wide]) }), row({ criterionId: 'FR-002', test: 'no-test-shown', reason: stmt('No path.', [miss]) })] }),
    '',
    ctx(),
  );
  assert.ok(Date.now() - started < 1000, 'no loop over the cited range');
  assert.equal(result.rows[0]?.reason.citationStatus, 'resolved', 'the range covers a changed line');
  assert.equal(result.rows[1]?.reason.citationStatus, 'unverified', 'the path has no changed line');
  assert.equal(result.verdict.outcome, 'incomplete', 'an uncovered criterion cannot be called sufficient');
});
