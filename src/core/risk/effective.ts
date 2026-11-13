// The effective class and the report, derived from stored rows (data-model.md "Derived, never stored"). Pure:
// nothing here reads or writes the store, and nothing is cached in a table, so there is no state to drift. Rule
// results are the base; the AI raises (US4) and a reviewer's override (US5) are layered over them here.

import type { MechanicalKind, OverrideRecord, RiskClass, RiskFile, RiskReason, RiskReport } from '../../contracts/http.ts';
import type { ClassOverrideRecord, RiskClassificationRecord, RiskRulesetRecord, RiskRunRecord } from '../../store/review-store.ts';
import { DEFAULT_RULE_ID } from './builtin-rules.ts';
import { maxClass } from './classes.ts';

export type ReportInput = {
  snapshotId: string;
  headCommit: string;
  ruleset: RiskRulesetRecord;
  /** In diff order. */
  classifications: RiskClassificationRecord[];
  /** The snapshot's latest AI run of any outcome, and the latest completed one. */
  latestRun?: RiskRunRecord | null;
  completedRun?: RiskRunRecord | null;
  /** An AI run waiting or running in the lane now. */
  aiQueue?: 'pending' | 'running' | null;
  /** Why no AI run is expected (no workspace, closed session, provider unavailable). */
  aiUnavailable?: string;
  /** The run belongs to an older snapshot than the session's latest. */
  olderHead?: boolean;
  /** The latest override record of each path in the session (a lapsed one is still returned, never an older one). */
  overrides: Map<string, ClassOverrideRecord>;
  canOverride: { allowed: boolean; reason?: string };
};

/** A stored override as the wire sends it; the reviewer's name becomes `displayName`. */
export const toOverrideRecord = (o: ClassOverrideRecord): OverrideRecord => ({
  id: o.id,
  path: o.path,
  class: o.class,
  replacedClass: o.replacedClass,
  calculatedClass: o.calculatedClass,
  reason: o.reason,
  createdAt: o.createdAt,
  snapshotId: o.snapshotId,
  ...(o.reviewer === null ? {} : { reviewer: { handle: o.reviewer.handle, displayName: o.reviewer.name } }),
});

const MECHANICAL_KIND: Record<string, MechanicalKind> = {
  'R-LOCKFILE': 'lockfile',
  'R-GENERATED': 'generated',
  'R-COMMENT-ONLY': 'comment-only',
  'R-RENAME-ONLY': 'rename-only',
};

const ruleReason = (r: RiskClassificationRecord['reasons'][number]): RiskReason => ({
  origin: r.ruleId === DEFAULT_RULE_ID ? 'default' : 'rule',
  ...(r.ruleId === DEFAULT_RULE_ID ? {} : { ruleId: r.ruleId }),
  class: r.ruleClass,
  applied: r.applied,
  matchedOn: r.matchedOn,
  text: r.text,
  lines: r.lines,
});

const CANCEL_TEXT: Record<string, string> = {
  user: 'the assessment was cancelled',
  restart: 'the workbench was restarted before the assessment finished',
  superseded: 'a newer snapshot replaced this one before the assessment ran',
};

/** What the AI said about one file and whether it counted (FR-014 to FR-018). */
function aiOf(c: RiskClassificationRecord, input: ReportInput): { ai: RiskFile['ai']; raised: RiskClass | null; reason: RiskReason[] } {
  const run = input.completedRun ?? null;
  const mechanicalKind = c.mechanical ? c.reasons.map((r) => MECHANICAL_KIND[r.ruleId]).find((k) => k !== undefined) : undefined;
  // A lockfile or generated file is never sent, whatever the run's state (FR-013).
  if (mechanicalKind === 'lockfile') return { ai: { state: 'not-assessed', notAssessedReason: 'lockfile' }, raised: null, reason: [] };
  if (mechanicalKind === 'generated') return { ai: { state: 'not-assessed', notAssessedReason: 'generated file' }, raised: null, reason: [] };
  if (run === null) {
    const waiting = input.aiQueue === 'pending' || input.aiQueue === 'running';
    return { ai: { state: waiting ? 'pending' : 'unavailable' }, raised: null, reason: [] };
  }
  const excluded = run.excludedFiles.find((f) => f.path === c.path);
  const item = run.items.find((i) => i.path === c.path);
  if (item === undefined) {
    return excluded === undefined
      ? { ai: { state: 'no-opinion' }, raised: null, reason: [] }
      : { ai: { state: 'not-assessed', notAssessedReason: excluded.reason }, raised: null, reason: [] };
  }
  const ai: RiskFile['ai'] = {
    state: item.applied ? 'applied' : item.ignoredReason === 'not-assessable' ? 'not-assessed' : (item.ignoredReason ?? 'not-higher'),
    proposedClass: item.proposedClass,
    reasons: item.reasons,
    lines: item.lines,
    ...(item.ignoredReason === 'not-assessable' ? { notAssessedReason: excluded?.reason ?? 'not assessable' } : {}),
  };
  if (!item.applied) return { ai, raised: null, reason: [] };
  const resolved = item.lines.filter((l) => l.resolved).map(({ side, startLine, endLine }) => ({ side, startLine, endLine }));
  const reasons: RiskReason[] = (item.reasons.length === 0 ? ['The AI judged this file riskier than its rules did.'] : item.reasons).map((text, i) => ({
    origin: 'ai',
    class: item.proposedClass,
    applied: true,
    matchedOn: 'ai',
    text,
    lines: i === 0 ? resolved : [],
  }));
  return { ai, raised: item.proposedClass, reason: reasons };
}

function fileOf(c: RiskClassificationRecord, input: ReportInput): RiskFile {
  const reasons = c.reasons.map(ruleReason);
  const { ai, raised, reason } = aiOf(c, input);
  const assessedClass = raised === null ? c.ruleClass : maxClass(c.ruleClass, raised);
  const aiRaised = assessedClass !== c.ruleClass;
  // The latest override of the file applies only while its change is the same change (RR-7); a lapsed one is
  // shown as lapsed and never replaced by an older record.
  const latest = input.overrides.get(c.path);
  const applies = latest !== undefined && latest.changeFingerprint === c.changeFingerprint;
  const mechanical = c.mechanical && !aiRaised && !applies;
  const mechanicalKind = mechanical ? c.reasons.map((r) => MECHANICAL_KIND[r.ruleId]).find((k) => k !== undefined) : undefined;
  return {
    path: c.path,
    ruleClass: c.ruleClass,
    assessedClass,
    effectiveClass: applies ? latest.class : assessedClass,
    effectiveOrigin: applies ? 'override' : aiRaised ? 'ai' : reasons[0]?.origin === 'default' ? 'default' : 'rule',
    mechanical,
    ...(mechanicalKind === undefined ? {} : { mechanicalKind }),
    ...(c.notFullyAnalysed === null ? {} : { notFullyAnalysed: c.notFullyAnalysed }),
    reasons: aiRaised ? [...reasons, ...reason] : reasons,
    ai,
    ...(latest === undefined ? {} : { override: { record: toOverrideRecord(latest), applies } }),
  };
}

function aiReport(input: ReportInput): RiskReport['ai'] {
  const latest = input.latestRun ?? null;
  const done = input.completedRun ?? null;
  const ignoredCount = (done?.items ?? []).filter((i) => !i.applied).length;
  const out: RiskReport['ai'] = { state: 'none', ignoredCount };
  if (input.aiQueue === 'running' || input.aiQueue === 'pending') {
    out.state = input.aiQueue;
  } else if (latest !== null) {
    out.state = latest.outcome;
    if (latest.outcome === 'failed') out.reason = latest.failureReason ?? 'the assessment failed';
    if (latest.outcome === 'cancelled') out.reason = CANCEL_TEXT[latest.cancelReason ?? 'user'] ?? 'the assessment was cancelled';
  } else if (input.aiUnavailable !== undefined) {
    out.reason = input.aiUnavailable;
  }
  const shown = done ?? latest;
  if (shown !== null) {
    out.provider = shown.provider;
    out.finishedAt = shown.finishedAt;
    if (shown.contextVersion !== null) out.contextVersion = shown.contextVersion;
  }
  if (input.olderHead === true && shown !== null) out.olderHead = true;
  return out;
}

/** A stable 32-bit number that changes whenever any part of the report does (FNV-1a over its JSON). */
function revisionOf(body: Omit<RiskReport, 'revision'>): number {
  const text = JSON.stringify(body);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function buildReport(input: ReportInput): RiskReport {
  const files = input.classifications.map((c) => fileOf(c, input));
  const counts: RiskReport['counts'] = { low: 0, normal: 0, elevated: 0, critical: 0, mechanical: 0, notFullyAnalysed: 0, overrides: 0 };
  for (const f of files) {
    counts[f.effectiveClass as RiskClass] += 1;
    if (f.mechanical) counts.mechanical += 1;
    if (f.notFullyAnalysed !== undefined) counts.notFullyAnalysed += 1;
    if (f.override?.applies === true) counts.overrides += 1;
  }
  const body: Omit<RiskReport, 'revision'> = {
    snapshotId: input.snapshotId,
    headCommit: input.headCommit,
    ruleset: { version: input.ruleset.rulesetVersion, ruleFile: input.ruleset.ruleFileStatus, notice: input.ruleset.ruleFileNotice },
    ai: aiReport(input),
    counts,
    files,
    canOverride: input.canOverride,
  };
  return { ...body, revision: revisionOf(body) };
}
