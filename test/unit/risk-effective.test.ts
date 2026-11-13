// T017 (VO-031): the report derived from stored rows, rule-only. The AI and override steps are appended by
// later tasks to this file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFiles } from '../../src/core/risk/classify.ts';
import { buildReport, type ReportInput } from '../../src/core/risk/effective.ts';
import { loadRuleset } from '../../src/core/risk/ruleset.ts';
import type { ClassifyFile } from '../../src/core/risk/classify.ts';
import type { RiskClassificationRecord, RiskRulesetRecord } from '../../src/store/review-store.ts';

const edit = (text: string): string => `@@ -1 +1,2 @@\n keep\n+${text}\n`;
const file = (path: string, patch: string | null, extra: Partial<ClassifyFile> = {}): ClassifyFile => ({
  path, oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false, sizeBytes: null, patch, excludedReason: null, ...extra,
});

export function rulesOnly(files: ClassifyFile[], overrides: Partial<ReportInput> = {}): ReturnType<typeof buildReport> {
  const ruleset = loadRuleset();
  const records: RiskClassificationRecord[] = classifyFiles(files, ruleset).map((c, i) => ({
    id: `c${i}`, snapshotId: 's1', path: c.path, ruleClass: c.ruleClass, mechanical: c.mechanical,
    notFullyAnalysed: c.notFullyAnalysed, changeFingerprint: c.changeFingerprint, reasons: c.reasons,
  }));
  const rulesetRecord: RiskRulesetRecord = {
    snapshotId: 's1', rulesetVersion: ruleset.version, ruleFileStatus: ruleset.ruleFile, ruleFileNotice: ruleset.notice, classifiedAt: 't',
  };
  return buildReport({
    snapshotId: 's1', headCommit: 'a'.repeat(40), ruleset: rulesetRecord, classifications: records,
    overrides: new Map(), canOverride: { allowed: true }, ...overrides,
  });
}

test('the effective class equals the rule class and every changed file appears once with a reason', () => {
  const report = rulesOnly([
    file('db/migrations/1.sql', edit('ALTER TABLE a;')),
    file('src/auth/a.ts', edit('x();')),
    file('package-lock.json', edit('"a": 1')),
    file('README.md', edit('hello')),
  ]);
  assert.deepEqual(report.files.map((f) => f.path), ['db/migrations/1.sql', 'src/auth/a.ts', 'package-lock.json', 'README.md'], 'diff order');
  for (const f of report.files) {
    assert.equal(f.effectiveClass, f.ruleClass);
    assert.equal(f.assessedClass, f.ruleClass);
    assert.ok(f.reasons.length >= 1);
  }
  assert.equal(report.files[0]?.effectiveOrigin, 'rule');
  assert.equal(report.files[3]?.effectiveOrigin, 'default');
  assert.equal(report.files[2]?.mechanicalKind, 'lockfile');
});

test('counts per class plus mechanical and not fully analysed; nothing else', () => {
  const report = rulesOnly([
    file('db/migrations/1.sql', edit('ALTER TABLE a;')),
    file('src/auth/a.ts', edit('x();')),
    file('Dockerfile', edit('RUN x')),
    file('README.md', edit('hello')),
    file('package-lock.json', edit('"a": 1')),
    file('assets/a.png', null, { binary: true, excludedReason: 'binary' }),
  ]);
  assert.deepEqual(
    { critical: report.counts.critical, elevated: report.counts.elevated, normal: report.counts.normal, low: report.counts.low },
    { critical: 2, elevated: 1, normal: 2, low: 1 },
  );
  assert.equal(report.counts.mechanical, 1);
  assert.equal(report.counts.notFullyAnalysed, 1);
  assert.equal(report.files.find((f) => f.path === 'assets/a.png')?.notFullyAnalysed, 'binary');
});

test('no changed files: files is empty and every count is zero', () => {
  const report = rulesOnly([]);
  assert.deepEqual(report.files, []);
  assert.equal(report.counts.critical + report.counts.elevated + report.counts.normal + report.counts.low + report.counts.mechanical + report.counts.notFullyAnalysed, 0);
});

test('VO-031 the report carries no score, percentage or rank', () => {
  const report = rulesOnly([file('src/auth/a.ts', edit('x();'))]);
  const forbidden = /score|percent|rank|rating|points/i;
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        assert.equal(forbidden.test(k), false, `field ${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(report, 'report');
});

// ---------------------------------------------------------------- AI step (T052, FR-014, FR-016 to FR-018)

import type { RiskAssessmentItem, RiskRunRecord } from '../../src/store/review-store.ts';

const run = (items: RiskAssessmentItem[], extra: Partial<RiskRunRecord> = {}): RiskRunRecord => ({
  id: 'r1', snapshotId: 's1', requestedAt: 't0', finishedAt: 't1', provider: 'claude-code-cli', outcome: 'completed',
  cancelReason: null, failureReason: null, contextVersion: `${'a'.repeat(40)}:${'b'.repeat(64)}`, excludedFiles: [], restrictionsNotEnforced: [], items, ...extra,
});
const raise = (path: string, proposedClass: RiskAssessmentItem['proposedClass'], extra: Partial<RiskAssessmentItem> = {}): RiskAssessmentItem => ({
  path, proposedClass, applied: true, ignoredReason: null, reasons: ['It touches the retry path'], lines: [{ side: 'head', startLine: 2, endLine: 2, resolved: true }], ...extra,
});
const NORMAL = file('src/util/a.ts', edit('const a = 1;'));
const COMMENT = file('README.md', edit('<!-- note -->'), { oldPath: null });

test('a valid raise sets the assessed and effective class, keeps the rule class and says the origin is AI', () => {
  const report = rulesOnly([NORMAL], { completedRun: run([raise('src/util/a.ts', 'elevated')]), latestRun: run([]) });
  const f = report.files[0]!;
  assert.equal(f.ruleClass, 'normal');
  assert.equal(f.assessedClass, 'elevated');
  assert.equal(f.effectiveClass, 'elevated');
  assert.equal(f.effectiveOrigin, 'ai');
  assert.equal(f.ai.state, 'applied');
  assert.equal(f.ai.proposedClass, 'elevated');
  const reason = f.reasons.at(-1)!;
  assert.equal(reason.origin, 'ai');
  assert.equal(reason.ruleId, undefined);
  assert.equal(reason.matchedOn, 'ai');
  assert.equal(reason.text, 'It touches the retry path');
  assert.deepEqual(reason.lines, [{ side: 'head', startLine: 2, endLine: 2 }]);
  assert.equal(report.counts.elevated, 1);
});

test('a raise clears the mechanical label (FR-018)', () => {
  const before = rulesOnly([COMMENT]);
  assert.equal(before.files[0]?.mechanical, true);
  const after = rulesOnly([COMMENT], { completedRun: run([raise('README.md', 'elevated')]), latestRun: run([]) });
  assert.equal(after.files[0]?.mechanical, false);
  assert.equal(after.files[0]?.mechanicalKind, undefined);
  assert.equal(after.counts.mechanical, 0);
  assert.equal(after.files[0]?.ruleClass, 'low');
});

test('an item that was not applied leaves the class and reports its state; the report counts what was ignored', () => {
  const ignored = (path: string, reason: NonNullable<RiskAssessmentItem['ignoredReason']>) => raise(path, 'critical', { applied: false, ignoredReason: reason });
  const report = rulesOnly(
    [file('src/util/a.ts', edit('a')), file('src/util/b.ts', edit('b')), file('src/util/c.ts', edit('c'))],
    {
      completedRun: run([ignored('src/util/a.ts', 'not-higher'), ignored('src/util/b.ts', 'no-resolvable-line'), ignored('src/ghost.ts', 'unknown-file')]),
      latestRun: run([]),
    },
  );
  const by = (p: string) => report.files.find((f) => f.path === p)!;
  assert.equal(by('src/util/a.ts').ai.state, 'not-higher');
  assert.equal(by('src/util/b.ts').ai.state, 'no-resolvable-line');
  assert.equal(by('src/util/c.ts').ai.state, 'no-opinion', 'a file the model did not mention is not agreement');
  for (const f of report.files) assert.equal(f.effectiveClass, 'normal');
  assert.equal(report.ai.ignoredCount, 3, 'including the unknown file the model named');
  assert.equal(by('src/util/a.ts').ai.proposedClass, 'critical', 'what it said is still shown');
});

test('lockfile and generated files are not assessed by AI, with the reason, whatever the run state', () => {
  const report = rulesOnly([file('package-lock.json', edit('"a": 1')), file('src/x.generated.ts', edit('const a = 1;'))]);
  assert.deepEqual(report.files.map((f) => [f.ai.state, f.ai.notAssessedReason]), [['not-assessed', 'lockfile'], ['not-assessed', 'generated file']]);
  const withRun = rulesOnly([NORMAL], { completedRun: run([], { excludedFiles: [{ path: 'src/util/a.ts', reason: 'prompt limit' }] }), latestRun: run([]) });
  assert.deepEqual([withRun.files[0]?.ai.state, withRun.files[0]?.ai.notAssessedReason], ['not-assessed', 'prompt limit']);
});

test('the report says what the AI assessment is: pending, running, completed, failed, cancelled, or missing and why', () => {
  assert.equal(rulesOnly([NORMAL], { aiQueue: 'pending' }).ai.state, 'pending');
  assert.equal(rulesOnly([NORMAL], { aiQueue: 'pending' }).files[0]?.ai.state, 'pending');
  assert.equal(rulesOnly([NORMAL], { aiQueue: 'running' }).ai.state, 'running');
  const done = rulesOnly([NORMAL], { completedRun: run([]), latestRun: run([]) });
  assert.deepEqual([done.ai.state, done.ai.provider, done.ai.contextVersion, done.ai.finishedAt], ['completed', 'claude-code-cli', `${'a'.repeat(40)}:${'b'.repeat(64)}`, 't1']);
  const failed = rulesOnly([NORMAL], { latestRun: run([], { outcome: 'failed', failureReason: 'the provider is not installed' }) });
  assert.deepEqual([failed.ai.state, failed.ai.reason, failed.files[0]?.ai.state], ['failed', 'the provider is not installed', 'unavailable']);
  const cancelled = rulesOnly([NORMAL], { latestRun: run([], { outcome: 'cancelled', cancelReason: 'restart' }) });
  assert.equal(cancelled.ai.state, 'cancelled');
  assert.match(cancelled.ai.reason ?? '', /restart/i);
  const none = rulesOnly([NORMAL], { aiUnavailable: 'No isolated workspace for this snapshot.' });
  assert.deepEqual([none.ai.state, none.ai.reason], ['none', 'No isolated workspace for this snapshot.']);
  assert.equal(rulesOnly([NORMAL], { completedRun: run([]), latestRun: run([]), olderHead: true }).ai.olderHead, true);
});

test('a later failed run does not take back an earlier completed assessment', () => {
  const report = rulesOnly([NORMAL], { completedRun: run([raise('src/util/a.ts', 'critical')]), latestRun: run([], { outcome: 'failed', failureReason: 'boom' }) });
  assert.equal(report.files[0]?.effectiveClass, 'critical');
  assert.equal(report.ai.state, 'failed');
});

test('the revision changes when the AI result does and is stable otherwise', () => {
  const a = rulesOnly([NORMAL]);
  assert.equal(rulesOnly([NORMAL]).revision, a.revision);
  assert.notEqual(rulesOnly([NORMAL], { completedRun: run([raise('src/util/a.ts', 'elevated')]), latestRun: run([]) }).revision, a.revision);
});

// ---------------------------------------------------------------- override step (T062, FR-019 to FR-023)

import type { ClassOverrideRecord } from '../../src/store/review-store.ts';

const fingerprintOf = (f: ClassifyFile): string => classifyFiles([f], loadRuleset())[0]!.changeFingerprint;
const override = (path: string, cls: ClassOverrideRecord['class'], replaced: ClassOverrideRecord['replacedClass'], fingerprint: string, extra: Partial<ClassOverrideRecord> = {}): ClassOverrideRecord => ({
  id: 'o1', sessionId: 'sess', snapshotId: 's0', path, class: cls, replacedClass: replaced, calculatedClass: replaced, reason: 'Only the log line changed.',
  changeFingerprint: fingerprint, reviewer: null, createdAt: '2026-11-07T12:00:00.000Z', ...extra,
});

test('the latest override whose change fingerprint matches applies and becomes the effective class', () => {
  const f = file('src/util/a.ts', edit('const a = 1;'));
  const report = rulesOnly([f], { overrides: new Map([['src/util/a.ts', override('src/util/a.ts', 'elevated', 'normal', fingerprintOf(f))]]) });
  const r = report.files[0]!;
  assert.equal(r.effectiveClass, 'elevated');
  assert.equal(r.effectiveOrigin, 'override');
  assert.equal(r.override?.applies, true);
  assert.equal(r.override?.record.reason, 'Only the log line changed.');
  assert.equal(r.ruleClass, 'normal', 'the original class is kept');
  assert.equal(r.assessedClass, 'normal');
  assert.ok(r.reasons.length >= 1, 'the reasons are kept');
  assert.equal(report.counts.elevated, 1);
  assert.equal(report.counts.normal, 0);
  assert.equal(report.counts.overrides, 1);
});

test('an override of a Critical class carries the recorded reviewer into the report', () => {
  const f = file('src/auth/a.ts', edit('const a = 1;'));
  const record = override('src/auth/a.ts', 'normal', 'critical', fingerprintOf(f), { reviewer: { handle: 'ana', name: 'Ana Lee' } });
  const r = rulesOnly([f], { overrides: new Map([['src/auth/a.ts', record]]) }).files[0]!;
  assert.deepEqual([r.ruleClass, r.effectiveClass, r.effectiveOrigin], ['critical', 'normal', 'override']);
  assert.deepEqual(r.override?.record.reviewer, { handle: 'ana', displayName: 'Ana Lee' });
  assert.equal(r.override?.record.calculatedClass, 'critical');
});

test('a latest override whose fingerprint differs has lapsed: the recalculated class is in force and no older record is used', () => {
  const f = file('src/util/a.ts', edit('const a = 1;'));
  const lapsed = override('src/util/a.ts', 'low', 'normal', 'f'.repeat(64));
  const r = rulesOnly([f], { overrides: new Map([['src/util/a.ts', lapsed]]) }).files[0]!;
  assert.equal(r.override?.applies, false);
  assert.equal(r.effectiveClass, 'normal');
  assert.notEqual(r.effectiveOrigin, 'override');
  assert.equal(r.override?.record.reason, 'Only the log line changed.', 'its reason is still shown');
  assert.equal(rulesOnly([f], { overrides: new Map([['src/util/a.ts', lapsed]]) }).counts.overrides, 0);
});

test('an override for a file that is no longer in the snapshot applies to nothing', () => {
  const f = file('src/util/a.ts', edit('const a = 1;'));
  const report = rulesOnly([f], { overrides: new Map([['src/gone.ts', override('src/gone.ts', 'low', 'normal', fingerprintOf(f))]]) });
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0]?.override, undefined);
});

test('an override applies over an AI raise, and an override of a mechanical file ends the mechanical label', () => {
  const f = file('src/util/a.ts', edit('const a = 1;'));
  const aiRun = run([raise('src/util/a.ts', 'critical')]);
  const report = rulesOnly([f], { completedRun: aiRun, latestRun: aiRun, overrides: new Map([['src/util/a.ts', override('src/util/a.ts', 'normal', 'critical', fingerprintOf(f), { calculatedClass: 'critical', reviewer: { handle: 'ana', name: 'Ana' } })]]) });
  assert.deepEqual([report.files[0]?.assessedClass, report.files[0]?.effectiveClass], ['critical', 'normal']);
  const lock = file('package-lock.json', edit('"a": 1'));
  const mech = rulesOnly([lock], { overrides: new Map([['package-lock.json', override('package-lock.json', 'elevated', 'low', fingerprintOf(lock))]]) });
  assert.equal(mech.files[0]?.mechanical, false);
  assert.equal(mech.counts.mechanical, 0);
});
