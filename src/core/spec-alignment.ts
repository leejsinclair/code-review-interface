// feature 006 (T017; contracts/ai-output.md "Server checks"; FR-014, FR-015): the pure checks applied to the AI's
// alignment output. The model proposes text and citations; the server stamps every statement Inference, resolves
// each citation (spec and tdd against the stored document text, code against the snapshot's changed lines),
// downgrades rows that claim more than the evidence shows, and recomputes the verdict's uncovered list.
// A statement whose citations do not resolve is kept as a lower-confidence Inference, never dropped.
// Output that fails the guard (including a `verified` label or any extra field) becomes one Inference.

import type { Side } from '../contracts/http.ts';
import { textAsInference, type FinalClaim } from './claims.ts';
import { changedLines } from './risk/patch.ts';

export type AlignmentDocument = { documentId: string; kind: 'specification' | 'tdd-evidence'; content: string };
export type AlignmentLeftOut = { document: string; part: string; reason: string };
export type AlignmentContext = {
  documents: AlignmentDocument[];
  files: Array<{ path: string; patch: string | null }>;
  /** What the prompt builder cut for size. */
  leftOut: AlignmentLeftOut[];
};

export type RowState = 'Implementation and test identified' | 'Implementation identified' | 'Requires verification' | 'Not found';
export type RowTest = 'test-shown' | 'no-test-shown' | 'no-evidence-available';
export type Outcome = 'sufficient' | 'incomplete' | 'cannot-judge';

type RawCitation = { type: 'spec' | 'tdd' | 'code'; documentId?: string; path?: string; side?: Side; startLine?: number; endLine?: number; quote?: string };
type RawStatement = { text: string; citations: RawCitation[] };
type RawRow = { criterionId: string; criterion: string; state: RowState; test: RowTest; testMismatch: boolean; reason: RawStatement };
type RawAlignment = {
  summaries: { specification: RawStatement; tddEvidence?: RawStatement };
  rows: RawRow[];
  verdict: { outcome: Outcome; statement: RawStatement; uncovered: string[]; mismatched: RawStatement[]; notJudged?: string };
  deviations: { implementedNotRequested: RawStatement[]; requestedNotImplemented: RawStatement[] };
  leftOut?: string[];
};

export type FinalCitation = RawCitation & { resolved: boolean };
export type FinalStatement = { text: string; label: 'inference'; citationStatus: 'resolved' | 'unverified'; citations: FinalCitation[] };
export type FinalRow = Omit<RawRow, 'reason'> & { reason: FinalStatement; duplicateId: boolean };
export type FinalAlignment = {
  warning: 'unparseable-output' | null;
  /** The raw text as one Inference when the output was unparseable; empty otherwise. */
  inference: FinalClaim[];
  summaries: { specification: FinalStatement; tddEvidence: FinalStatement | null };
  rows: FinalRow[];
  verdict: { outcome: Outcome; statement: FinalStatement; uncovered: string[]; mismatched: FinalStatement[]; notJudged: string | null };
  deviations: { implementedNotRequested: FinalStatement[]; requestedNotImplemented: FinalStatement[] };
  leftOut: AlignmentLeftOut[];
};

// ------------------------------------------------------------------------------- the guard

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isLine = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isStr = (v: unknown): v is string => typeof v === 'string';
const optional = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || ok(v);

function isCitation(v: unknown): v is RawCitation {
  return (
    isRecord(v) &&
    onlyKeys(v, ['type'], ['documentId', 'path', 'side', 'startLine', 'endLine', 'quote']) &&
    (v['type'] === 'spec' || v['type'] === 'tdd' || v['type'] === 'code') &&
    optional(v['documentId'], isStr) &&
    optional(v['path'], isStr) &&
    optional(v['side'], (s) => s === 'head' || s === 'base') &&
    optional(v['startLine'], isLine) &&
    optional(v['endLine'], isLine) &&
    optional(v['quote'], isStr)
  );
}

const isStatement = (v: unknown): v is RawStatement =>
  isRecord(v) && onlyKeys(v, ['text', 'citations']) && isStr(v['text']) && Array.isArray(v['citations']) && v['citations'].every(isCitation);
const isStatements = (v: unknown): v is RawStatement[] => Array.isArray(v) && v.every(isStatement);

const STATES: readonly unknown[] = ['Implementation and test identified', 'Implementation identified', 'Requires verification', 'Not found'];
const TESTS: readonly unknown[] = ['test-shown', 'no-test-shown', 'no-evidence-available'];
const OUTCOMES: readonly unknown[] = ['sufficient', 'incomplete', 'cannot-judge'];

function isRow(v: unknown): v is RawRow {
  return (
    isRecord(v) &&
    onlyKeys(v, ['criterionId', 'criterion', 'state', 'test', 'testMismatch', 'reason']) &&
    isStr(v['criterionId']) &&
    isStr(v['criterion']) &&
    STATES.includes(v['state']) &&
    TESTS.includes(v['test']) &&
    typeof v['testMismatch'] === 'boolean' &&
    isStatement(v['reason'])
  );
}

export function isAlignmentOutput(v: unknown): v is RawAlignment {
  if (!isRecord(v) || !onlyKeys(v, ['summaries', 'rows', 'verdict', 'deviations'], ['leftOut'])) return false;
  const { summaries, rows, verdict, deviations } = v;
  return (
    isRecord(summaries) &&
    onlyKeys(summaries, ['specification'], ['tddEvidence']) &&
    isStatement(summaries['specification']) &&
    optional(summaries['tddEvidence'], isStatement) &&
    Array.isArray(rows) &&
    rows.every(isRow) &&
    isRecord(verdict) &&
    onlyKeys(verdict, ['outcome', 'statement', 'uncovered', 'mismatched'], ['notJudged']) &&
    OUTCOMES.includes(verdict['outcome']) &&
    isStatement(verdict['statement']) &&
    isStrings(verdict['uncovered']) &&
    isStatements(verdict['mismatched']) &&
    optional(verdict['notJudged'], isStr) &&
    isRecord(deviations) &&
    onlyKeys(deviations, ['implementedNotRequested', 'requestedNotImplemented']) &&
    isStatements(deviations['implementedNotRequested']) &&
    isStatements(deviations['requestedNotImplemented']) &&
    optional(v['leftOut'], isStrings)
  );
}

// ------------------------------------------------------------------------------- citations

function citationResolver(ctx: AlignmentContext) {
  const docs = new Map(ctx.documents.map((d) => [d.documentId, d.content]));
  const changed = new Map<string, Set<string>>();
  for (const f of ctx.files) {
    const set = new Set<string>();
    for (const l of changedLines(f.patch)) set.add(`${l.side}:${l.line}`);
    changed.set(f.path, set);
  }

  const resolvesCode = (c: RawCitation): boolean => {
    if (c.path === undefined || c.side === undefined || c.startLine === undefined) return false;
    const set = changed.get(c.path);
    if (set === undefined) return false;
    const lo = Math.min(c.startLine, c.endLine ?? c.startLine);
    const hi = Math.max(c.startLine, c.endLine ?? c.startLine);
    // Walk the changed lines, never the cited range: the range is the model's and can be arbitrarily wide.
    const prefix = `${c.side}:`;
    for (const key of set) {
      if (!key.startsWith(prefix)) continue;
      const n = Number(key.slice(prefix.length));
      if (n >= lo && n <= hi) return true;
    }
    return false;
  };

  const resolvesDocument = (c: RawCitation): boolean => {
    const text = c.documentId === undefined ? undefined : docs.get(c.documentId);
    if (text === undefined) return false;
    if (c.startLine === undefined && c.quote === undefined) return false;
    if (c.quote !== undefined && (c.quote.trim() === '' || !text.includes(c.quote))) return false;
    if (c.startLine !== undefined) {
      const total = text.replace(/\n$/, '').split('\n').length;
      const end = c.endLine ?? c.startLine;
      if (Math.max(c.startLine, end) > total) return false;
    }
    return true;
  };

  const statement = (raw: RawStatement): FinalStatement => {
    const citations = raw.citations.map((c) => ({ ...c, resolved: c.type === 'code' ? resolvesCode(c) : resolvesDocument(c) }));
    return { text: raw.text, label: 'inference', citationStatus: citations.some((c) => c.resolved) ? 'resolved' : 'unverified', citations };
  };
  return statement;
}

// ------------------------------------------------------------------------------- finalising

const EMPTY_DEVIATIONS = { implementedNotRequested: [], requestedNotImplemented: [] };

function rawTextOf(output: unknown, rawText: string): string {
  if (rawText.trim() !== '') return rawText;
  if (typeof output === 'string') return output;
  return output === undefined || output === null ? '' : JSON.stringify(output);
}

export function finaliseAlignment(output: unknown, rawText: string, ctx: AlignmentContext): FinalAlignment {
  const statement = citationResolver(ctx);
  if (!isAlignmentOutput(output)) {
    const blank = statement({ text: '', citations: [] });
    return {
      warning: 'unparseable-output',
      inference: textAsInference(rawTextOf(output, rawText)),
      summaries: { specification: blank, tddEvidence: null },
      rows: [],
      verdict: { outcome: 'cannot-judge', statement: blank, uncovered: [], mismatched: [], notJudged: null },
      deviations: { ...EMPTY_DEVIATIONS },
      leftOut: ctx.leftOut.map((l) => ({ ...l })),
    };
  }

  const hasEvidence = ctx.documents.some((d) => d.kind === 'tdd-evidence');
  const idCounts = new Map<string, number>();
  for (const r of output.rows) idCounts.set(r.criterionId, (idCounts.get(r.criterionId) ?? 0) + 1);

  const rows: FinalRow[] = output.rows.map((r) => {
    const test: RowTest = !hasEvidence && r.test === 'no-test-shown' ? 'no-evidence-available' : r.test;
    const testMismatch = test === 'test-shown' && r.testMismatch;
    const state: RowState = r.state === 'Implementation and test identified' && (test !== 'test-shown' || testMismatch) ? 'Requires verification' : r.state;
    return { criterionId: r.criterionId, criterion: r.criterion, state, test, testMismatch, reason: statement(r.reason), duplicateId: (idCounts.get(r.criterionId) ?? 0) > 1 };
  });

  const leftOut: AlignmentLeftOut[] = ctx.leftOut.map((l) => ({ ...l }));
  for (const name of output.leftOut ?? []) {
    if (!leftOut.some((l) => l.document === name || l.part === name)) leftOut.push({ document: name, part: name, reason: 'reported by the model' });
  }

  const { verdict } = output;
  return {
    warning: null,
    inference: [],
    summaries: {
      specification: statement(output.summaries.specification),
      tddEvidence: hasEvidence && output.summaries.tddEvidence !== undefined ? statement(output.summaries.tddEvidence) : null,
    },
    rows,
    verdict: {
      // The verdict cannot call testing sufficient while the rows show an uncovered or mismatched criterion (FR-012).
      outcome: !hasEvidence ? 'cannot-judge' : verdict.outcome === 'sufficient' && (rows.some((r) => r.test === 'no-test-shown' || r.testMismatch) || verdict.mismatched.length > 0) ? 'incomplete' : verdict.outcome,
      statement: statement(verdict.statement),
      uncovered: rows.filter((r) => r.test === 'no-test-shown').map((r) => r.criterionId),
      mismatched: verdict.mismatched.map(statement),
      notJudged: verdict.notJudged ?? null,
    },
    deviations: {
      implementedNotRequested: output.deviations.implementedNotRequested.map(statement),
      requestedNotImplemented: output.deviations.requestedNotImplemented.map(statement),
    },
    leftOut,
  };
}
