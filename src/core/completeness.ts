// Context completeness, derived on read and never stored (FR-007, FR-049, data-model "Context
// completeness"). The PR row comes from the session status and the latest snapshot, the repository
// row from the latest snapshot, and the issue row from the latest snapshot's issue references and the
// latest issue Evidence for each. Only `issue` Evidence is read, and only for the issue row.

import type {
  CompletenessRow,
  CompletenessStatus,
  IssueReference as WireIssueReference,
  SkipReason,
  SkippedFile,
} from '../contracts/http.ts';
import type {
  ChangedFile,
  Evidence,
  ExcludedFile,
  IssueReference,
  PrSnapshot,
  ReviewStore,
  SessionStatus,
  SpecLookupWithParts,
} from '../store/review-store.ts';

export type CompletenessInput = {
  status: SessionStatus;
  latest: PrSnapshot;
  changedFiles: ChangedFile[];
  references: IssueReference[];
  evidence: Evidence[];
  promptExclusions: ExcludedFile[];
  /** The latest specification lookup: absent leaves the specification rows out, null means none was stored. */
  spec?: SpecLookupWithParts | null;
};

export type Completeness = { completeness: CompletenessRow[]; issues: WireIssueReference[] };

export const HEAD_MOVED_REASON = 'the PR head on the platform has moved past the latest snapshot';
export const NO_ISSUE_REASON = 'the PR references no issue';
const NOT_FETCHED_REASON = 'not fetched yet';

const SKIP_REASON: Record<string, SkipReason> = {
  binary: 'binary',
  'file size': 'file-too-large',
  'changed lines': 'too-many-changed-lines',
  'prompt limit': 'prompt limit',
};

const RANK: Record<CompletenessStatus, number> = { found: 0, stale: 1, missing: 2 };

function prRow(status: SessionStatus, latest: PrSnapshot): CompletenessRow {
  if (status.lastCheckOutcome === 'unreachable') {
    return { source: 'pr', status: 'stale', reason: status.lastCheckError ?? 'the platform could not be reached' };
  }
  if (status.lastCheckedHead !== null && status.lastCheckedHead !== latest.headCommit) {
    return { source: 'pr', status: 'stale', reason: HEAD_MOVED_REASON };
  }
  return { source: 'pr', status: 'found' };
}

function skippedFiles(changedFiles: ChangedFile[], promptExclusions: ExcludedFile[]): SkippedFile[] {
  const cut = new Set(promptExclusions.filter((e) => e.reason === 'prompt limit').map((e) => e.path));
  const out: SkippedFile[] = [];
  for (const file of [...changedFiles].sort((a, b) => a.ordinal - b.ordinal)) {
    const reason = file.excludedReason !== null ? SKIP_REASON[file.excludedReason] : cut.has(file.path) ? 'prompt limit' : undefined;
    if (reason !== undefined) out.push({ path: file.path, reason });
  }
  return out;
}

function issueReference(reference: IssueReference, evidence: Evidence[]): WireIssueReference {
  const base = {
    platform: reference.issue.platform,
    key: reference.issue.key,
    kind: reference.kind,
    origins: [...new Set(reference.origins.map((o) => o.field))],
  };
  if (reference.kind === 'pull-request') return { ...base, status: 'found' };

  const records = evidence.filter(
    (e) => e.kind === 'issue' && e.source.platform === reference.issue.platform && e.source.key === reference.issue.key,
  );
  const latest = records.at(-1);
  if (latest === undefined) return { ...base, status: 'missing', reason: NOT_FETCHED_REASON };

  const shown = latest.status === 'stale' ? (evidence.find((e) => e.id === latest.lastGoodId) ?? null) : latest;
  const out: WireIssueReference = {
    ...base,
    status: latest.status === 'current' ? 'found' : latest.status,
    evidence: { kind: 'issue', status: latest.status, capturedAt: latest.capturedAt, commit: latest.commit },
  };
  if (latest.reason !== null) out.reason = latest.reason;
  if (shown?.payload) {
    out.title = shown.payload.title;
    out.descriptionText = shown.payload.descriptionText;
  }
  return out;
}

/** The `specification` and `tdd-evidence` rows, derived from the latest lookup (FR-009). A missing document is never read as found or stale. */
function specRows(spec: SpecLookupWithParts | null, headMoved: boolean): CompletenessRow[] {
  const kinds = [['specification', 'specification'], ['tdd-evidence', 'tdd-evidence']] as const;
  return kinds.map(([kind, source]): CompletenessRow => {
    if (spec === null) return { source, status: 'missing', reason: 'not looked up yet' };
    if (spec.lookup.keys.length === 0) return { source, status: 'missing', reason: spec.lookup.reason ?? 'no key was found to search with' };
    // Keys are also read from text such as requirement ids (FR-12): a key with no folder at all is noise
    // once another key has one, so it neither marks the row missing nor appears in its reason.
    const hasFolder = (key: string): boolean => spec.documents.some((d) => d.key === key && d.missingReason !== 'no folder');
    const real = spec.lookup.keys.some(hasFolder) ? spec.lookup.keys.filter(hasFolder) : spec.lookup.keys;
    const docs = real.map((key) => spec.documents.find((d) => d.key === key && d.kind === kind));
    const missing = real.flatMap((key, i) => {
      const d = docs[i];
      return d === undefined || d.status === 'missing' ? [`${key}: ${d?.missingReason ?? 'not found'}`] : [];
    });
    if (missing.length > 0) return { source, status: 'missing', reason: missing.join('; ') };
    return headMoved ? { source, status: 'stale', reason: HEAD_MOVED_REASON } : { source, status: 'found' };
  });
}

export function deriveCompleteness(input: CompletenessInput): Completeness {
  const { status, latest } = input;
  const issues = input.references.map((r) => issueReference(r, input.evidence));
  const issueOnly = issues.filter((i) => i.kind === 'issue');

  const repository: CompletenessRow = {
    source: 'repository',
    status: latest.repositoryStatus,
    skippedFiles: skippedFiles(input.changedFiles, input.promptExclusions),
  };
  if (latest.repositoryStatus === 'missing') repository.reason = latest.repositoryReason ?? 'repository not available';

  const issueRow: CompletenessRow =
    issueOnly.length === 0
      ? { source: 'issue', status: 'missing', reason: NO_ISSUE_REASON, issues: [] }
      : {
          source: 'issue',
          status: issueOnly.reduce<CompletenessStatus>((worst, i) => (RANK[i.status] > RANK[worst] ? i.status : worst), 'found'),
          issues: issueOnly,
        };

  const rows = [prRow(status, latest), repository, issueRow];
  if (input.spec !== undefined) {
    const headMoved = status.lastCheckedHead !== null && status.lastCheckedHead !== latest.headCommit;
    rows.push(...specRows(input.spec, headMoved));
  }
  return { completeness: rows, issues };
}

/** The `prompt limit` exclusions of the latest completed summary prompt for a snapshot. */
function latestPromptExclusions(store: ReviewStore, snapshotId: string): ExcludedFile[] {
  for (const run of [...store.listSummaryRuns(snapshotId)].reverse()) {
    if (store.readSummary(run.id)?.outcome !== 'completed') continue;
    return store.readStoredPrompt({ summaryRunId: run.id })?.excludedFiles ?? [];
  }
  return [];
}

/** Reads the inputs from the store; null for an unknown session or one without a snapshot. */
export function readCompleteness(store: ReviewStore, sessionId: string): Completeness | null {
  const status = store.readSessionStatus(sessionId);
  const latest = store.readLatestSnapshot(sessionId);
  if (status === null || latest === null) return null;
  return deriveCompleteness({
    status,
    latest,
    changedFiles: store.listChangedFiles(latest.id),
    references: store.listIssueReferences(latest.id),
    evidence: store.listEvidence(sessionId),
    promptExclusions: latestPromptExclusions(store, latest.id),
    spec: store.readLatestSpecLookup(latest.id),
  });
}

/** Every file of a snapshot left out of prompts, with its reason, in diff order. */
export function readSkippedFiles(store: ReviewStore, snapshotId: string): SkippedFile[] {
  return skippedFiles(store.listChangedFiles(snapshotId), latestPromptExclusions(store, snapshotId));
}

/** The wire reason for a stored per-file exclusion. */
export function skipReason(reason: string | null): SkipReason | undefined {
  return reason === null ? undefined : SKIP_REASON[reason];
}
