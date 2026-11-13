// The rule-based classifier (research RR-1, RR-3). Pure: it reads only each changed file's paths, status,
// counts and stored patch, never the workspace, the network or the pull request's text. Same input, same
// output (FR-011). Precedence, first match wins:
//   0 a test file is capped at Normal: a rule's class is kept as "not applied" unless the rule file added that
//     path to the rule (the AI can still raise it later, with cited lines);
//   1 binary or limit-skipped: path rules only, never below Normal, flagged not fully analysed;
//   2 rename with no changed lines: Elevated into or out of a sensitive path, else Low and mechanical;
//   3 sensitive rules (path + behavioural change = the rule's class; a behavioural line term alone = its floor);
//   4 lockfile or generated: Low and mechanical;
//   5 comment-only or whitespace-only: Low and mechanical, naming the rules that were not applied;
//   6 otherwise Normal with the rule-less default reason.
// Reason text comes from fixed templates and the rule's label; nothing from the pull request is interpolated.

import type { LineRange } from '../../contracts/http.ts';
import type { ChangedFile, RiskReasonRecord } from '../../store/review-store.ts';
import { COMMENT_ONLY_RULE, DEFAULT_RULE_ID, GENERATED_RULE, LOCKFILE_RULE, RENAME_ONLY_RULE, TEST_FILE_RULE, type Rule } from './builtin-rules.ts';
import { maxClass, type RiskClass } from './classes.ts';
import { analyseChange, type AnalysedLine } from './comments.ts';
import { matchGlob } from './glob.ts';
import { changeFingerprint, hunksOf } from './patch.ts';
import type { Ruleset } from './ruleset.ts';

export type ClassifyFile = Pick<
  ChangedFile,
  'path' | 'oldPath' | 'status' | 'additions' | 'deletions' | 'binary' | 'sizeBytes' | 'patch' | 'excludedReason'
>;

export type FileClassification = {
  path: string;
  ruleClass: RiskClass;
  mechanical: boolean;
  notFullyAnalysed: string | null;
  changeFingerprint: string;
  reasons: RiskReasonRecord[];
};

type Draft = Omit<RiskReasonRecord, 'ordinal'>;

const MAX_RANGES = 200;

/** Contiguous lines on one side merged into ranges. */
export function toRanges(lines: ReadonlyArray<{ side: 'head' | 'base'; line: number }>): LineRange[] {
  const sorted = [...lines].sort((a, b) => (a.side === b.side ? a.line - b.line : a.side === 'head' ? -1 : 1));
  const out: LineRange[] = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && last.side === l.side && l.line <= last.endLine + 1) last.endLine = Math.max(last.endLine, l.line);
    else out.push({ side: l.side, startLine: l.line, endLine: l.line });
  }
  return out.slice(0, MAX_RANGES);
}

const hitsPath = (patterns: readonly string[], paths: readonly string[]): boolean =>
  patterns.some((p) => paths.some((path) => matchGlob(p, path)));

const finish = (file: ClassifyFile, drafts: Draft[], ruleClass: RiskClass, mechanical: boolean, notFullyAnalysed: string | null): FileClassification => ({
  path: file.path,
  ruleClass,
  mechanical,
  notFullyAnalysed,
  changeFingerprint: changeFingerprint(file),
  reasons: drafts.map((d, ordinal) => ({ ordinal, ...d })),
});

const highest = (drafts: readonly Draft[], from: RiskClass): RiskClass => drafts.reduce<RiskClass>((c, d) => (d.applied ? maxClass(c, d.ruleClass) : c), from);

/** A rule the rule file pointed at this very path; the only way a rule lifts a test file above Normal. */
const exemptFromTestCap = (rule: Rule | undefined, paths: readonly string[]): boolean => rule !== undefined && hitsPath(rule.filePaths ?? [], paths);

const testDraft = (): Draft => ({
  ruleId: TEST_FILE_RULE.id,
  ruleClass: 'normal',
  applied: true,
  matchedOn: 'path',
  text: `${TEST_FILE_RULE.label}: a test file is held at Normal by the rules, whatever other rules matched. Only the AI, or a rule-file path for this file, can raise it.`,
  lines: [],
});

/** Marks the drafts of a test file that a rule-file path did not point at as not applied, and adds the test-file reason first. */
function capTestDrafts(drafts: Draft[], rules: readonly Rule[], paths: readonly string[]): Draft[] {
  let capped = false;
  const out = drafts.map((d) => {
    const rule = rules.find((r) => r.id === d.ruleId);
    if (!d.applied || (d.matchedOn !== 'lines' && exemptFromTestCap(rule, paths)) || rule === undefined) return d;
    capped = true;
    return { ...d, applied: false, text: `${rule.label} would have applied and was not: the file is a test file, which the rules hold at Normal.` };
  });
  return capped ? [testDraft(), ...out] : out;
}

function isGenerated(file: ClassifyFile, paths: readonly string[]): boolean {
  if (hitsPath(GENERATED_RULE.paths, paths)) return true;
  const head = hunksOf(file.patch)[0]?.lines.filter((l) => l.type !== 'remove').slice(0, 10) ?? [];
  return head.some((l) => GENERATED_RULE.markers.some((m) => l.text.toLowerCase().includes(m)));
}

function classifyOne(file: ClassifyFile, rules: readonly Rule[]): FileClassification {
  const paths = file.oldPath === null ? [file.path] : [file.path, file.oldPath];
  const pathRules = rules.filter((r) => hitsPath(r.paths, paths));
  const isTest = hitsPath(TEST_FILE_RULE.paths, paths);

  // 1. Binary or skipped for a limit: the path is all there is to read.
  if (file.binary || file.excludedReason !== null) {
    const why = file.excludedReason ?? 'binary';
    const unread: Draft[] = pathRules.map((r) => ({
      ruleId: r.id,
      ruleClass: r.class,
      applied: true,
      matchedOn: 'path',
      text: `${r.label}: matched on the path. The file was not read (${why}), so only its path could be checked.`,
      lines: [],
    }));
    const drafts = isTest ? capTestDrafts(unread, rules, paths) : unread;
    if (drafts.length === 0) {
      drafts.push({
        ruleId: DEFAULT_RULE_ID,
        ruleClass: 'normal',
        applied: true,
        matchedOn: 'path',
        text: `No mandatory-scrutiny rule matched on the path. The file was not read (${why}), so it is Normal, not lower.`,
        lines: [],
      });
    }
    return finish(file, drafts, highest(drafts, 'normal'), false, why);
  }

  const noLines = file.additions === 0 && file.deletions === 0 && hunksOf(file.patch).length === 0;

  // 2. A rename with nothing else changed.
  if ((file.status === 'renamed' || file.status === 'copied') && noLines) {
    const renameRules = isTest ? pathRules.filter((r) => exemptFromTestCap(r, paths)) : pathRules;
    if (renameRules.length > 0) {
      const drafts: Draft[] = renameRules.map((r) => ({
        ruleId: r.id,
        ruleClass: 'elevated',
        applied: true,
        matchedOn: 'path',
        text: `${r.label}: the file was renamed into or out of a path this rule covers. No lines changed.`,
        lines: [],
      }));
      return finish(file, drafts, 'elevated', false, null);
    }
    const drafts: Draft[] = [{ ruleId: RENAME_ONLY_RULE.id, ruleClass: 'low', applied: true, matchedOn: 'path', text: 'Renamed with no changed lines.', lines: [] }];
    return finish(file, drafts, 'low', true, null);
  }

  const analysis = analyseChange(file);
  const mechanicalPath = hitsPath(LOCKFILE_RULE.paths, paths) ? 'lockfile' : isGenerated(file, paths) ? 'generated' : null;

  // 3. Sensitive rules.
  const drafts: Draft[] = [];
  if (analysis.hasBehaviouralChange) {
    for (const r of rules) {
      const pathMatch = hitsPath(r.paths, paths);
      // A lockfile or generated file counts a sensitive rule only by its path: a term in tool output means little.
      const termLines: AnalysedLine[] =
        r.floor !== null && mechanicalPath === null
          ? analysis.behaviouralLines.filter((l) => r.lineTerms.some((t) => l.text.toLowerCase().includes(t)))
          : [];
      if (pathMatch) {
        drafts.push({
          ruleId: r.id,
          ruleClass: r.class,
          applied: true,
          matchedOn: termLines.length > 0 ? 'path+lines' : 'path',
          text:
            termLines.length > 0
              ? `${r.label}: the file is in a ${r.family} area (matched on the path) and the change is behavioural; changed lines also mention a rule term.`
              : `${r.label}: the file is in a ${r.family} area (matched on the path) and the change is behavioural.`,
          lines: toRanges(termLines),
        });
      } else if (termLines.length > 0 && r.floor !== null) {
        drafts.push({
          ruleId: r.id,
          ruleClass: r.floor,
          applied: true,
          matchedOn: 'lines',
          text: `${r.label}: a changed line mentions a term this rule watches for; the file's path is not in the area.`,
          lines: toRanges(termLines),
        });
      }
    }
  }
  if (isTest && drafts.length > 0) drafts.splice(0, drafts.length, ...capTestDrafts(drafts, rules, paths));
  if (drafts.length > 0) {
    if (mechanicalPath !== null) {
      const m = mechanicalPath === 'lockfile' ? LOCKFILE_RULE : GENERATED_RULE;
      drafts.push({ ruleId: m.id, ruleClass: 'low', applied: true, matchedOn: 'path', text: `${m.label}: normally mechanical, but a rule for this path applies, so it is not reduced.`, lines: [] });
    }
    return finish(file, drafts, highest(drafts, isTest ? 'normal' : 'low'), false, null);
  }

  // 4. Lockfile or generated.
  if (mechanicalPath !== null) {
    const m = mechanicalPath === 'lockfile' ? LOCKFILE_RULE : GENERATED_RULE;
    const text = mechanicalPath === 'lockfile' ? 'Lockfile: changed by tooling, not written by hand.' : 'Generated file: produced by a tool, not written by hand.';
    return finish(file, [{ ruleId: m.id, ruleClass: 'low', applied: true, matchedOn: 'path', text, lines: [] }], 'low', true, null);
  }

  // 5. Comments and whitespace only.
  if (analysis.hasAnyChange && !analysis.hasBehaviouralChange) {
    const out: Draft[] = [
      {
        ruleId: COMMENT_ONLY_RULE.id,
        ruleClass: 'low',
        applied: true,
        matchedOn: 'lines',
        text: 'Every changed line is a comment, blank, or a whitespace-only reindent.',
        lines: toRanges(analysis.lines),
      },
    ];
    for (const r of rules) {
      if (hitsPath(r.paths, paths)) {
        out.push({
          ruleId: r.id,
          ruleClass: r.class,
          applied: false,
          matchedOn: 'path',
          text: `${r.label} would have applied (matched on the path) and was not: the change is only comments or whitespace.`,
          lines: [],
        });
      }
    }
    return finish(file, out, 'low', true, null);
  }

  // 6. Nothing matched.
  return finish(
    file,
    [{ ruleId: DEFAULT_RULE_ID, ruleClass: 'normal', applied: true, matchedOn: 'path', text: 'No mandatory-scrutiny rule matched.', lines: [] }],
    'normal',
    false,
    null,
  );
}

export function classifyFiles(files: readonly ClassifyFile[], ruleset: Pick<Ruleset, 'rules'>): FileClassification[] {
  return files.map((f) => classifyOne(f, ruleset.rules));
}

