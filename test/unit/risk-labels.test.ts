// T077 (VO-030, FR-007, II.2, II.3): the risk surfaces never say or style anything as approved. A mechanical file
// is only a candidate for reduced review; readiness and approval belong to the reviewer and a later feature.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { RISK_LABELS, REVIEW_FOCUS } from '../../src/ui/labels.ts';

const root = new URL('../../', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), 'utf8');

const RISK_FILES = [
  'src/ui/components/risk-badge.tsx',
  'src/ui/components/review-focus.tsx',
  'src/ui/components/risk-reasons.tsx',
  'src/ui/components/scope-slider.tsx',
  'src/ui/components/risk-text.ts',
  'src/ui/components/override-dialog.tsx',
  'src/ui/state/use-risk.ts',
  'src/ui/state/risk-links.ts',
  'src/ui/state/file-order.ts',
];

/** Source text with comments removed: only what can reach the screen or the class names. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the risk label strings are the verbatim ones and none says approved', () => {
  assert.equal(RISK_LABELS.mechanical, 'Mechanical (candidate for reduced review)');
  assert.deepEqual(RISK_LABELS.class, { low: 'Low', normal: 'Normal', elevated: 'Elevated', critical: 'Critical' });
  assert.equal(REVIEW_FOCUS.heading, 'Review focus');
  assert.equal(RISK_LABELS.origin.ai, 'AI');
  assert.equal(RISK_LABELS.origin.override, 'Reviewer override');
  assert.equal(RISK_LABELS.notAssessedLockfile, 'Not assessed by AI: lockfile');
  assert.equal(RISK_LABELS.notAssessedGenerated, 'Not assessed by AI: generated file');
  assert.equal(RISK_LABELS.aiInProgress, 'AI assessment in progress');
  assert.equal(RISK_LABELS.aiMissing, 'AI assessment missing');
  assert.equal(RISK_LABELS.aiIgnored, 'AI opinion ignored');
  assert.equal(RISK_LABELS.notFullyAnalysed, 'Not fully analysed');
  for (const text of JSON.stringify([RISK_LABELS, REVIEW_FOCUS]).split('"')) assert.equal(/approv/i.test(text), false, text);
});

test('labels.ts and every risk component say nothing about approval', async () => {
  const labels = code(await read('src/ui/labels.ts'));
  // The word may appear for the existing PR-approval feature elsewhere in labels.ts; the risk block must not carry it.
  const block = labels.slice(labels.indexOf('export const RISK_LABELS'), labels.indexOf('export const FILE_NAV_LABELS'));
  assert.ok(block.length > 100);
  assert.equal(/approv/i.test(block), false);
  for (const file of RISK_FILES) assert.equal(/approv/i.test(code(await read(file))), false, `${file} names approval`);
});

test('no risk component uses an approval or tick icon', async () => {
  const ICONS = /\b(CircleCheck|CheckCircle|BadgeCheck|ShieldCheck|ThumbsUp|Check|CheckCheck|SquareCheck|ClipboardCheck)\b/;
  for (const file of RISK_FILES) assert.equal(ICONS.test(code(await read(file))), false, `${file} uses a tick icon`);
});

test('the risk styles carry no approval styling', async () => {
  const css = await read('src/ui/app.css');
  const block = css.slice(css.indexOf('/* Risk classes (feature 004)'));
  assert.ok(block.length > 200);
  assert.equal(/approv|--found-|--pr-open/i.test(block), false, 'the risk block borrows no "found" or approved colours');
});

test('a mechanical file is described only as a candidate for reduced review', async () => {
  const source = code(await read('src/ui/components/review-focus.tsx'));
  assert.ok(source.includes('RISK_LABELS.mechanical'));
  assert.equal(/\b(safe|skip|fine|ok|passed?|cleared)\b/i.test(source.replace(/data-testid[^\n]*/g, '').replace(/class=\{?"[^"]*"/g, '')), false);
});
