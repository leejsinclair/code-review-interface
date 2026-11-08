// Claims finaliser (research R13, FR-016 to FR-019, FR-045, FR-046): validates the provider's
// structured output with a hand-written guard at this trust boundary, checks every reference, and
// decides each claim's label and intent; the model only proposes them.
//
// - a `code` ref resolves when the file exists at the snapshot's head commit (base commit for
//   `side: base`) and `endLine` is within its line count;
// - an `issue` ref resolves when that issue was fetched for the session;
// - a `pr` ref resolves when the PR has a description; it supports documented intent but does not
//   on its own keep a claim labelled Evidence (data-model open point 2);
// - Evidence stands only with a resolved `code` or `issue` ref (FR-018); documented intent only with
//   a resolved `issue` or `pr` ref (FR-017);
// - output that fails the guard becomes one Inference holding the raw text, warning `unstructured`
//   (FR-019); cancelled or interrupted text becomes one Inference the same way (FR-045).

import type { Claim as WireClaim, Ref as WireRef } from '../contracts/http.ts';
import type { ClaimLabel, ClaimOwner, ClaimWithReferences, Intent, IssueKey, Reference, ReviewStore, SummarySectionKind } from '../store/review-store.ts';

export type FinalRef = Omit<Reference, 'claimId' | 'ordinal'>;

export type FinalClaim = {
  text: string;
  proposedLabel: ClaimLabel;
  label: ClaimLabel;
  proposedIntent: Intent | null;
  intent: Intent | null;
  refs: FinalRef[];
};

export type CheckContext = {
  headCommit: string;
  baseCommit: string | null;
  /** The snapshot's PR description. */
  description: string;
  /** Issues fetched for the session (Evidence with a payload). */
  fetchedIssues: IssueKey[];
  files: { lineCount(commit: string, path: string): Promise<number | null> };
};

export type FinalAnswer = {
  warning: 'unstructured' | null;
  claims: FinalClaim[];
  unsupportedAssumptions: string[];
  suggestedFollowUps: string[];
};

export type FinalSection = { kind: SummarySectionKind; path: string | null; claims: FinalClaim[] };
export type FinalSummary = { warning: 'unstructured' | null; sections: FinalSection[] };

// ------------------------------------------------------------------------------- the guard

type RawRef =
  | { kind: 'code'; path: string; side: 'head' | 'base'; startLine: number; endLine: number }
  | { kind: 'issue'; platform: string; key: string }
  | { kind: 'pr' };
type RawClaim = { text: string; label: ClaimLabel; intent?: Intent; refs: RawRef[] };
type RawAnswer = { claims: RawClaim[]; unsupportedAssumptions: string[]; suggestedFollowUps: string[] };
type RawSummary = { prSummary: RawClaim[]; files: Array<{ path: string; claims: RawClaim[] }>; functionalImpact: RawClaim[]; technicalImpact: RawClaim[] };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isLine = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

function isRef(v: unknown): v is RawRef {
  if (!isRecord(v)) return false;
  switch (v['kind']) {
    case 'code':
      return onlyKeys(v, ['kind', 'path', 'side', 'startLine', 'endLine']) && typeof v['path'] === 'string' && (v['side'] === 'head' || v['side'] === 'base') && isLine(v['startLine']) && isLine(v['endLine']);
    case 'issue':
      return onlyKeys(v, ['kind', 'platform', 'key']) && typeof v['platform'] === 'string' && typeof v['key'] === 'string';
    case 'pr':
      return onlyKeys(v, ['kind']);
    default:
      return false;
  }
}

function isClaim(v: unknown): v is RawClaim {
  return (
    isRecord(v) &&
    onlyKeys(v, ['text', 'label', 'refs'], ['intent']) &&
    typeof v['text'] === 'string' &&
    (v['label'] === 'evidence' || v['label'] === 'inference') &&
    (v['intent'] === undefined || v['intent'] === 'documented' || v['intent'] === 'inferred') &&
    Array.isArray(v['refs']) &&
    v['refs'].every(isRef)
  );
}

const isClaims = (v: unknown): v is RawClaim[] => Array.isArray(v) && v.every(isClaim);

export function isAnswerOutput(v: unknown): v is RawAnswer {
  return isRecord(v) && onlyKeys(v, ['claims', 'unsupportedAssumptions', 'suggestedFollowUps']) && isClaims(v['claims']) && isStrings(v['unsupportedAssumptions']) && isStrings(v['suggestedFollowUps']);
}

export function isSummaryOutput(v: unknown): v is RawSummary {
  return (
    isRecord(v) &&
    onlyKeys(v, ['prSummary', 'files', 'functionalImpact', 'technicalImpact']) &&
    isClaims(v['prSummary']) &&
    isClaims(v['functionalImpact']) &&
    isClaims(v['technicalImpact']) &&
    Array.isArray(v['files']) &&
    v['files'].every((f) => isRecord(f) && onlyKeys(f, ['path', 'claims']) && typeof f['path'] === 'string' && isClaims(f['claims']))
  );
}

// ------------------------------------------------------------------------------- checking

const issueKey = (platform: string, key: string): string => JSON.stringify([platform, key]);

function checker(ctx: CheckContext) {
  const counts = new Map<string, Promise<number | null>>();
  const fetched = new Set(ctx.fetchedIssues.map((i) => issueKey(i.platform, i.key)));
  const lineCount = (commit: string, path: string): Promise<number | null> => {
    const id = `${commit}\0${path}`;
    let found = counts.get(id);
    if (found === undefined) {
      found = ctx.files.lineCount(commit, path);
      counts.set(id, found);
    }
    return found;
  };

  const ref = async (raw: RawRef): Promise<FinalRef> => {
    const none = { path: null, side: null, startLine: null, endLine: null, commit: null, issue: null } as const;
    if (raw.kind === 'pr') {
      const resolved = ctx.description.trim() !== '';
      return { ...none, kind: 'pr', resolved, unresolvedReason: resolved ? null : 'PR has no description' };
    }
    if (raw.kind === 'issue') {
      const resolved = fetched.has(issueKey(raw.platform, raw.key));
      return { ...none, kind: 'issue', issue: { platform: raw.platform, key: raw.key }, resolved, unresolvedReason: resolved ? null : 'issue not fetched for this session' };
    }
    const startLine = Math.min(raw.startLine, raw.endLine);
    const endLine = Math.max(raw.startLine, raw.endLine);
    const commit = raw.side === 'head' ? ctx.headCommit : ctx.baseCommit;
    const base = { ...none, kind: 'code' as const, path: raw.path, side: raw.side, startLine, endLine, commit };
    if (commit === null) return { ...base, resolved: false, unresolvedReason: 'no base commit' };
    const count = await lineCount(commit, raw.path);
    if (count === null) return { ...base, resolved: false, unresolvedReason: 'no such file at commit' };
    if (endLine > count) return { ...base, resolved: false, unresolvedReason: 'line outside file' };
    return { ...base, resolved: true, unresolvedReason: null };
  };

  const claim = async (raw: RawClaim): Promise<FinalClaim> => {
    const refs = await Promise.all(raw.refs.map(ref));
    const supports = refs.some((r) => r.resolved && (r.kind === 'code' || r.kind === 'issue'));
    const documents = refs.some((r) => r.resolved && (r.kind === 'issue' || r.kind === 'pr'));
    const proposedIntent = raw.intent ?? null;
    return {
      text: raw.text,
      proposedLabel: raw.label,
      label: raw.label === 'evidence' && supports ? 'evidence' : 'inference',
      proposedIntent,
      intent: proposedIntent === null ? null : proposedIntent === 'documented' && documents ? 'documented' : 'inferred',
      refs,
    };
  };

  /** Claims with empty text are dropped: a claim must say something. */
  return (raws: RawClaim[]): Promise<FinalClaim[]> => Promise.all(raws.filter((c) => c.text.trim() !== '').map(claim));
}

/** Text that never became checked claims, as one Inference (none when there is no text). */
export function textAsInference(text: string): FinalClaim[] {
  if (text.trim() === '') return [];
  return [{ text, proposedLabel: 'inference', label: 'inference', proposedIntent: null, intent: null, refs: [] }];
}

function rawTextOf(output: unknown, rawText: string): string {
  if (rawText.trim() !== '') return rawText;
  if (typeof output === 'string') return output;
  return output === undefined || output === null ? '' : JSON.stringify(output);
}

export async function finaliseAnswer(output: unknown, rawText: string, ctx: CheckContext): Promise<FinalAnswer> {
  if (!isAnswerOutput(output)) {
    return { warning: 'unstructured', claims: textAsInference(rawTextOf(output, rawText)), unsupportedAssumptions: [], suggestedFollowUps: [] };
  }
  return {
    warning: null,
    claims: await checker(ctx)(output.claims),
    unsupportedAssumptions: output.unsupportedAssumptions,
    suggestedFollowUps: output.suggestedFollowUps,
  };
}

/** Sections in order: pr, one per changed file the output names (first wins), functional, technical. */
export async function finaliseSummary(output: unknown, rawText: string, ctx: CheckContext, changedPaths: readonly string[]): Promise<FinalSummary> {
  if (!isSummaryOutput(output)) {
    return { warning: 'unstructured', sections: [{ kind: 'pr', path: null, claims: textAsInference(rawTextOf(output, rawText)) }] };
  }
  const check = checker(ctx);
  const changed = new Set(changedPaths);
  const seen = new Set<string>();
  const files: FinalSection[] = [];
  for (const file of output.files) {
    // simplified: claims for a path that is not a changed file, or a repeated path, are dropped; if
    // providers do this often, fold them into the PR section instead.
    if (!changed.has(file.path) || seen.has(file.path)) continue;
    seen.add(file.path);
    files.push({ kind: 'file', path: file.path, claims: await check(file.claims) });
  }
  return {
    warning: null,
    sections: [
      { kind: 'pr', path: null, claims: await check(output.prSummary) },
      ...files,
      { kind: 'functional', path: null, claims: await check(output.functionalImpact) },
      { kind: 'technical', path: null, claims: await check(output.technicalImpact) },
    ],
  };
}

/** Claims split for display: documented intent apart from inferred intent (FR-017). */
export function intentGroups<T extends { intent: Intent | null }>(claims: readonly T[]): { documented: T[]; inferred: T[]; other: T[] } {
  return {
    documented: claims.filter((c) => c.intent === 'documented'),
    inferred: claims.filter((c) => c.intent === 'inferred'),
    other: claims.filter((c) => c.intent === null),
  };
}

// ------------------------------------------------------------------------------- store and wire

/** Appends checked claims and their references under `owner`; call inside a transaction. */
export function appendClaims(store: ReviewStore, owner: ClaimOwner, claims: readonly FinalClaim[], newId: () => string): void {
  claims.forEach((claim, ordinal) => {
    const id = newId();
    const { refs, ...fields } = claim;
    store.appendClaim({ id, ordinal, ...fields, ...owner });
    refs.forEach((ref, refOrdinal) => store.appendReference({ claimId: id, ordinal: refOrdinal, ...ref }));
  });
}

/** Appends a summary's sections and their claims; call inside a transaction. */
export function appendSections(store: ReviewStore, summaryId: string, sections: readonly FinalSection[], newId: () => string): void {
  sections.forEach((section, ordinal) => {
    const id = newId();
    store.appendSummarySection({ id, summaryId, ordinal, kind: section.kind, path: section.path });
    appendClaims(store, { summarySectionId: id }, section.claims, newId);
  });
}

function wireRef(ref: Reference): WireRef {
  const reason = ref.unresolvedReason === null ? {} : { unresolvedReason: ref.unresolvedReason };
  if (ref.kind === 'code') {
    return { kind: 'code', path: ref.path ?? '', side: ref.side ?? 'head', startLine: ref.startLine ?? 1, endLine: ref.endLine ?? 1, resolved: ref.resolved, ...reason };
  }
  if (ref.kind === 'issue') return { kind: 'issue', platform: ref.issue?.platform ?? '', key: ref.issue?.key ?? '', resolved: ref.resolved, ...reason };
  return { kind: 'pr', resolved: ref.resolved, ...reason };
}

export function wireClaim(claim: ClaimWithReferences): WireClaim {
  const out: WireClaim = { text: claim.text, label: claim.label, labelledByProvider: claim.proposedLabel, refs: claim.references.map(wireRef) };
  if (claim.intent !== null) out.intent = claim.intent;
  if (claim.proposedIntent !== null) out.intentByProvider = claim.proposedIntent;
  return out;
}

export function wireClaims(store: ReviewStore, owner: ClaimOwner): WireClaim[] {
  return store.listClaimsWithReferences(owner).map(wireClaim);
}
