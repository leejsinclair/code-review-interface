// T072 (VO-013, VO-014, FR-035 to FR-037, contracts/rule-file.md): the optional rule file can add to or tighten the
// built-in rules, never lower or remove them. A bad file or entry is named and the built-ins stay in force.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { classifyFiles } from '../../src/core/risk/classify.ts';
import { loadRuleset, rulesetFromText } from '../../src/core/risk/ruleset.ts';

const builtin = loadRuleset();
const entry = (e: Record<string, unknown>[]): string => JSON.stringify({ version: 1, entries: e });
const rule = (rs: ReturnType<typeof rulesetFromText>, id: string) => rs.rules.find((r) => r.id === id);
const edit = (text: string): string => `@@ -1 +1,2 @@\n keep\n+${text}\n`;
const classify = (rs: ReturnType<typeof rulesetFromText>, path: string, patch: string) =>
  classifyFiles([{ path, oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false, sizeBytes: null, patch, excludedReason: null }], rs)[0]!;

test('a missing file is normal: built-ins only, status absent, no notice', () => {
  const rs = rulesetFromText(null);
  assert.deepEqual([rs.ruleFile, rs.notice, rs.version], ['absent', [], builtin.version]);
  assert.deepEqual(rs.rules, builtin.rules);
});

test('VO-015 an extend entry adds paths and line terms to a built-in and the matching file is classified under its ID', () => {
  const rs = rulesetFromText(entry([{ extend: 'R-FINANCE', paths: ['billing-v2/**', '**/invoicing/**'], lineTerms: ['ledger_entry'] }]));
  assert.equal(rs.ruleFile, 'used');
  assert.deepEqual(rs.notice, []);
  assert.ok(rule(rs, 'R-FINANCE')!.paths.includes('billing-v2/**'));
  assert.ok(rule(rs, 'R-FINANCE')!.paths.length > builtin.rules.find((r) => r.id === 'R-FINANCE')!.paths.length);
  const c = classify(rs, 'billing-v2/total.ts', edit('run();'));
  assert.equal(c.ruleClass, 'critical');
  assert.deepEqual(c.reasons.filter((r) => r.applied).map((r) => r.ruleId), ['R-FINANCE']);
  const term = classify(rs, 'src/util/x.ts', edit('const ledger_entry = 1;'));
  assert.equal(term.ruleClass, 'elevated');
});

test('an extend entry may raise the class but never lower it', () => {
  const raised = rulesetFromText(entry([{ extend: 'R-CONFIG', paths: ['ops/**'], class: 'critical' }]));
  assert.equal(rule(raised, 'R-CONFIG')!.class, 'critical');
  assert.equal(classify(raised, 'ops/deploy.sh', edit('run')).ruleClass, 'critical');
  assert.equal(classify(raised, 'Dockerfile', edit('RUN x')).ruleClass, 'critical', 'a raised class applies to the rule\'s existing paths too');
  const lowered = rulesetFromText(entry([{ extend: 'R-AUTH', paths: ['x/**'], class: 'elevated' }, { extend: 'R-AUTH', class: 'low' }]));
  assert.equal(rule(lowered, 'R-AUTH')!.class, 'critical', 'unchanged');
  assert.equal(lowered.ruleFile, 'partly-ignored');
  assert.equal(lowered.notice.length, 2);
  for (const n of lowered.notice) assert.match(n.reason, /lower/i);
  assert.equal(rule(lowered, 'R-AUTH')!.paths.includes('x/**'), false, 'a rejected entry applies nothing, not even its paths');
});

test('an add entry needs an ID of the form X-NAME, a family and a class of at least Elevated, and applies under its own ID', () => {
  const rs = rulesetFromText(entry([{ add: 'X-PII', family: 'authorisation', class: 'elevated', label: 'Personal data handling', paths: ['**/customer/**'], lineTerms: ['ssn', 'date_of_birth'] }]));
  assert.equal(rs.ruleFile, 'used');
  const added = rule(rs, 'X-PII')!;
  assert.deepEqual([added.family, added.class, added.label], ['authorisation', 'elevated', 'Personal data handling']);
  const c = classify(rs, 'src/customer/profile.ts', edit('save();'));
  assert.equal(c.ruleClass, 'elevated');
  assert.deepEqual(c.reasons.filter((r) => r.applied).map((r) => r.ruleId), ['X-PII']);
  assert.match(c.reasons[0]!.text, /Personal data handling/);
  assert.equal(classify(rs, 'src/util/x.ts', edit('const ssn = 1;')).ruleClass, 'elevated', 'a line term alone');
  const critical = rulesetFromText(entry([{ add: 'X-VAULT', family: 'financial', class: 'critical', paths: ['vault/**'] }]));
  assert.equal(classify(critical, 'vault/keys.ts', edit('x();')).ruleClass, 'critical');
});

test('VO-013 entries that break the rules are rejected with a named reason and the built-ins stay as they were', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['an unknown field', { extend: 'R-AUTH', paths: ['a/**'], colour: 'red' }, /unknown field.*colour/i],
    ['an unknown family', { add: 'X-A', family: 'cooking', class: 'elevated' }, /family/i],
    ['an ID that collides with a built-in', { add: 'R-AUTH', family: 'authentication', class: 'critical' }, /collid|built-in|X-/i],
    ['an ID of the wrong form', { add: 'PII', family: 'authentication', class: 'elevated' }, /X-/],
    ['a low class on an added rule', { add: 'X-LOW', family: 'authentication', class: 'low' }, /Elevated|class/],
    ['a missing class on an added rule', { add: 'X-NC', family: 'authentication' }, /class/i],
    ['a missing family on an added rule', { add: 'X-NF', class: 'elevated' }, /family/i],
    ['a mechanical rule', { extend: 'R-LOCKFILE', paths: ['a/**'] }, /mechanical/i],
    ['an unknown built-in', { extend: 'R-NOPE', paths: ['a/**'] }, /no built-in|unknown/i],
    ['both extend and add', { extend: 'R-AUTH', add: 'X-A', family: 'authentication', class: 'elevated' }, /one of|both/i],
    ['neither extend nor add', { paths: ['a/**'] }, /extend|add/i],
    ['a pattern over 200 characters', { extend: 'R-AUTH', paths: ['a'.repeat(201)] }, /200/],
    ['more than 100 patterns', { extend: 'R-AUTH', paths: Array.from({ length: 101 }, (_, i) => `p${i}/**`) }, /100/],
    ['a malformed glob', { extend: 'R-AUTH', paths: ['a**b'] }, /\*\*|glob|pattern/i],
    ['a line term that is too short', { extend: 'R-AUTH', lineTerms: ['a'] }, /term/i],
    ['more than 100 line terms', { extend: 'R-AUTH', lineTerms: Array.from({ length: 101 }, (_, i) => `term${i}`) }, /100/],
    ['a label that is too long', { add: 'X-L', family: 'deletion', class: 'elevated', label: 'x'.repeat(81) }, /label/i],
    ['a regular expression-looking field', { extend: 'R-AUTH', linePatterns: ['.*'] }, /unknown field/i],
  ];
  for (const [name, bad, reason] of cases) {
    const rs = rulesetFromText(entry([bad]));
    assert.deepEqual(rs.rules, builtin.rules, `${name}: the built-ins are unchanged`);
    assert.equal(rs.ruleFile, 'partly-ignored', name);
    assert.equal(rs.notice.length, 1, name);
    assert.match(rs.notice[0]!.reason, reason, name);
    assert.match(rs.notice[0]!.entry, /^0: /, `${name}: the entry is named by its index`);
    assert.equal(rs.version, builtin.version, `${name}: nothing accepted, so the version is the built-ins'`);
  }
  assert.match(rulesetFromText(entry([{ add: 'X-A', family: 'cooking', class: 'elevated' }])).notice[0]!.entry, /^0: X-A$/);
  assert.match(rulesetFromText(entry([{ paths: ['a/**'] }])).notice[0]!.entry, /^0: \(no id\)$/);
});

test('an ID used twice in one file is rejected the second time', () => {
  const rs = rulesetFromText(entry([{ add: 'X-A', family: 'deletion', class: 'elevated', paths: ['a/**'] }, { add: 'X-A', family: 'deletion', class: 'critical', paths: ['b/**'] }]));
  assert.equal(rs.rules.filter((r) => r.id === 'X-A').length, 1);
  assert.equal(rule(rs, 'X-A')!.class, 'elevated');
  assert.equal(rs.notice.length, 1);
  assert.match(rs.notice[0]!.entry, /^1: X-A$/);
});

test('VO-014 a file that is not JSON, not an object, version other than 1 or entries not a list is ignored whole, with one notice', () => {
  for (const text of ['{ not json', '[]', '"text"', '42', 'null', JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: {} }), JSON.stringify({ entries: [] })]) {
    const rs = rulesetFromText(text);
    assert.equal(rs.ruleFile, 'ignored', text);
    assert.deepEqual(rs.rules, builtin.rules, text);
    assert.equal(rs.notice.length, 1, text);
    assert.equal(rs.notice[0]?.entry, '(file)');
    assert.ok(rs.notice[0]!.reason.length > 0);
    assert.equal(rs.version, builtin.version);
  }
});

test('VO-014 a partly invalid file applies the valid entries and names the rest', () => {
  const rs = rulesetFromText(entry([{ extend: 'R-FINANCE', paths: ['billing-v2/**'] }, { add: 'X-BAD', family: 'cooking', class: 'elevated' }, { add: 'X-OK', family: 'deletion', class: 'elevated', paths: ['trash/**'] }]));
  assert.equal(rs.ruleFile, 'partly-ignored');
  assert.deepEqual(rs.notice.map((n) => n.entry), ['1: X-BAD']);
  assert.ok(rule(rs, 'X-OK'));
  assert.ok(rule(rs, 'R-FINANCE')!.paths.includes('billing-v2/**'));
  assert.equal(rulesetFromText(entry([])).ruleFile, 'used', 'an empty list is a used file with nothing in it');
});

test('FR-037 the version is builtin-N plus the first 12 hex of the sha256 of the canonical JSON of the accepted entries', () => {
  const accepted = { extend: 'R-FINANCE', paths: ['billing-v2/**'] };
  const rs = rulesetFromText(entry([accepted, { add: 'X-BAD', family: 'cooking', class: 'elevated' }]));
  const expected = createHash('sha256').update(JSON.stringify([accepted])).digest('hex').slice(0, 12);
  assert.equal(rs.version, `${builtin.version}+${expected}`);
  // Key order and whitespace in the file do not change it; a different entry does.
  const reordered = rulesetFromText(`{"entries":[{"paths":["billing-v2/**"],"extend":"R-FINANCE"}],"version":1}`);
  assert.equal(reordered.version, rs.version);
  assert.notEqual(rulesetFromText(entry([{ extend: 'R-FINANCE', paths: ['other/**'] }])).version, rs.version);
});

test('no regular expression is built from a rule file', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../src/core/risk/ruleset.ts', import.meta.url), 'utf8');
  assert.equal(/new RegExp|RegExp\(/.test(source), false);
});

test('R-TEST is a fixed rule: it cannot be extended or added, and rule-file paths are recorded on the rule', () => {
  const rs = rulesetFromText(entry([{ extend: 'R-TEST', paths: ['x/**'] }, { add: 'R-TEST', family: 'authentication', class: 'critical' }, { extend: 'R-FINANCE', paths: ['pay/**'] }]));
  assert.equal(rs.notice.length, 2);
  assert.deepEqual(rule(rs, 'R-FINANCE')!.filePaths, ['pay/**']);
  assert.equal(rule(builtin, 'R-FINANCE')!.filePaths, undefined);
});
