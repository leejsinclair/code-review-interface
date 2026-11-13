// Review store: the only data access in the workbench (research R5, constitution III.2).
//
// History is append-only: this module exposes `append*` writes and
// `read*` / `list*` / `find*` reads, plus exactly two mutations: `upsertSessionStatus`
// (the session's status cache, which is not history) and `deleteSession` (a whole
// session, in one transaction, through the session_deletion marker that the
// schema's delete triggers require). The triggers in schema.sql enforce the same
// rule for code that bypasses this module.
//
// Records use the data-model.md field names in camelCase; nested value types are
// flattened into snake_case columns (pr.repo.platform -> pr_repo_platform), lists
// and the evidence payload are JSON text, booleans are 0/1. For "exactly one of"
// owners (stored prompt, stream chunk, claim) the input carries only the owner key.

import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type { LineRange, RiskClass } from '../contracts/http.ts';
import type { PlatformId } from '../contracts/shared.ts';

// ---------------------------------------------------------------------------
// Shared value types

export interface RepoRef {
  platform: PlatformId;
  identifier: string;
}

export interface PrRef {
  repo: RepoRef;
  number: number;
}

export interface BranchRef {
  repo: RepoRef;
  name: string;
}

export interface IssueKey {
  platform: PlatformId;
  key: string;
}

// ---------------------------------------------------------------------------
// Records

export interface ReviewSession {
  id: string;
  pr: PrRef;
  createdAt: string;
}

export type PrStatus = 'open' | 'closed' | 'merged';
export type CheckOutcome = 'ok' | 'unreachable';

export interface SessionStatus {
  sessionId: string;
  prStatus: PrStatus;
  statusNote: string | null;
  lastCheckedAt: string;
  lastCheckedHead: string | null;
  lastCheckOutcome: CheckOutcome;
  lastCheckError: string | null;
  lastOpenedAt: string;
}

export type DiffSource = 'local' | 'platform';
export type RepositoryStatus = 'found' | 'missing';

export interface PrSnapshot {
  id: string;
  sessionId: string;
  seq: number;
  takenAt: string;
  headCommit: string;
  title: string;
  description: string;
  author: string;
  sourceBranch: BranchRef;
  targetBranch: BranchRef;
  targetCommit: string | null;
  baseCommit: string | null;
  diffSource: DiffSource;
  diffFingerprint: string;
  repositoryStatus: RepositoryStatus;
  repositoryReason: string | null;
  headRef: string | null;
  targetRef: string | null;
}

export interface Commit {
  snapshotId: string;
  ordinal: number;
  sha: string;
  authorName: string;
  message: string;
  committedAt: string;
}

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
export type ExcludedReason = 'binary' | 'file size' | 'changed lines';

export interface ChangedFile {
  snapshotId: string;
  ordinal: number;
  path: string;
  oldPath: string | null;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  sizeBytes: number | null;
  language: string | null;
  patch: string | null;
  excludedReason: ExcludedReason | null;
}

export type IssueReferenceKind = 'issue' | 'pull-request';

export interface IssueOrigin {
  field: 'branch' | 'title' | 'description';
  text: string;
}

export interface IssueReference {
  snapshotId: string;
  issue: IssueKey;
  kind: IssueReferenceKind;
  origins: IssueOrigin[];
}

export type EvidenceKind = 'coverage' | 'sonar' | 'spec' | 'issue' | 'lint' | 'custom';
export type EvidenceStatus = 'current' | 'stale' | 'missing';

/** The payload of `issue` Evidence. */
export interface IssuePayload {
  platform: PlatformId;
  key: string;
  title: string;
  descriptionText: string;
  webUrl: string;
}

export interface Evidence {
  id: string;
  sessionId: string;
  snapshotId: string;
  kind: EvidenceKind;
  source: IssueKey;
  capturedAt: string;
  commit: string;
  commitBound: boolean;
  status: EvidenceStatus;
  reason: string | null;
  lastGoodId: string | null;
  payload: IssuePayload | null;
}

export interface SummaryRun {
  id: string;
  snapshotId: string;
  requestedAt: string;
  provider: string;
}

export type Category = 'what' | 'why' | 'how' | 'whatif' | 'risk' | 'requirement';
export type Audience = 'technical' | 'business';
export type QuestionOrigin = 'typed' | 'suggested' | 'follow-up';

export interface QuestionScope {
  type: 'pr' | 'file' | 'range';
  path: string | null;
  side: 'new' | 'old' | null;
  startLine: number | null;
  endLine: number | null;
  label: string | null;
}

export interface Question {
  id: string;
  sessionId: string;
  snapshotId: string;
  seq: number;
  askedAt: string;
  text: string;
  category: Category;
  audience: Audience;
  scope: QuestionScope;
  followsQuestionId: string | null;
  origin: QuestionOrigin;
  provider: string;
}

/** The owner of a stored prompt or stream chunk: a question or a summary run, never both. */
export type GenerationOwner =
  | { questionId: string; summaryRunId?: undefined }
  | { summaryRunId: string; questionId?: undefined };

export interface ExcludedFile {
  path: string;
  reason: string;
}

interface StoredPromptFields {
  id: string;
  instructions: string;
  data: string;
  contextVersion: string;
  excludedFiles: ExcludedFile[];
  dataChars: number;
  restrictionsNotEnforced: string[];
  sentAt: string;
}

export type StoredPromptInput = StoredPromptFields & GenerationOwner;

export interface StoredPrompt extends StoredPromptFields {
  questionId: string | null;
  summaryRunId: string | null;
}

interface StreamChunkFields {
  seq: number;
  text: string;
  receivedAt: string;
}

export type StreamChunkInput = StreamChunkFields & GenerationOwner;

export interface StreamChunk extends StreamChunkFields {
  questionId: string | null;
  summaryRunId: string | null;
}

export type Outcome = 'completed' | 'cancelled' | 'failed';
export type CancelReason = 'user' | 'restart' | 'superseded';
export type Warning = 'unstructured' | 'cancelled';

export interface Answer {
  id: string;
  questionId: string;
  outcome: Outcome;
  cancelReason: CancelReason | null;
  failureReason: string | null;
  warning: Warning | null;
  rawText: string | null;
  unsupportedAssumptions: string[];
  suggestedFollowUps: string[];
  contextVersion: string | null;
  restrictionsNotEnforced: string[];
  finishedAt: string;
}

export interface Summary {
  id: string;
  summaryRunId: string;
  outcome: Outcome;
  cancelReason: CancelReason | null;
  failureReason: string | null;
  warning: Warning | null;
  rawText: string | null;
  contextVersion: string | null;
  restrictionsNotEnforced: string[];
  finishedAt: string;
}

export type SummarySectionKind = 'pr' | 'file' | 'functional' | 'technical';

export interface SummarySection {
  id: string;
  summaryId: string;
  ordinal: number;
  kind: SummarySectionKind;
  path: string | null;
}

export type ClaimLabel = 'evidence' | 'inference';
export type Intent = 'documented' | 'inferred';

/** The owner of a claim: an answer or a summary section, never both. */
export type ClaimOwner =
  | { answerId: string; summarySectionId?: undefined }
  | { summarySectionId: string; answerId?: undefined };

interface ClaimFields {
  id: string;
  ordinal: number;
  text: string;
  proposedLabel: ClaimLabel;
  label: ClaimLabel;
  proposedIntent: Intent | null;
  intent: Intent | null;
}

export type ClaimInput = ClaimFields & ClaimOwner;

export interface Claim extends ClaimFields {
  answerId: string | null;
  summarySectionId: string | null;
}

export type ReferenceKind = 'code' | 'issue' | 'pr';

export interface Reference {
  claimId: string;
  ordinal: number;
  kind: ReferenceKind;
  path: string | null;
  side: 'head' | 'base' | null;
  startLine: number | null;
  endLine: number | null;
  commit: string | null;
  issue: IssueKey | null;
  resolved: boolean;
  unresolvedReason: string | null;
}

export interface ClaimWithReferences extends Claim {
  references: Reference[];
}

// ---------------------------------------------------------------------------
// The store

// ---------------------------------------------------------------------------
// Risk records (feature 004; data-model.md). Rule results, AI results and overrides are separate kinds.

export type RiskRuleFileStatus = 'absent' | 'used' | 'partly-ignored' | 'ignored';

export interface RiskRulesetRecord {
  snapshotId: string;
  rulesetVersion: string;
  ruleFileStatus: RiskRuleFileStatus;
  ruleFileNotice: Array<{ entry: string; reason: string }>;
  classifiedAt: string;
}

export interface RiskReasonRecord {
  ordinal: number;
  ruleId: string;
  ruleClass: RiskClass;
  applied: boolean;
  matchedOn: 'path' | 'lines' | 'path+lines';
  text: string;
  lines: LineRange[];
}

export interface RiskClassificationRecord {
  id: string;
  snapshotId: string;
  path: string;
  ruleClass: RiskClass;
  mechanical: boolean;
  notFullyAnalysed: string | null;
  changeFingerprint: string;
  reasons: RiskReasonRecord[];
}

export type RiskIgnoredReason = 'not-higher' | 'no-resolvable-line' | 'unknown-file' | 'not-assessable';

export interface RiskAssessmentItem {
  path: string;
  proposedClass: 'normal' | 'elevated' | 'critical';
  applied: boolean;
  ignoredReason: RiskIgnoredReason | null;
  reasons: string[];
  lines: Array<LineRange & { resolved: boolean }>;
}

export interface RiskRunRecord {
  id: string;
  snapshotId: string;
  requestedAt: string;
  finishedAt: string;
  provider: string;
  outcome: 'completed' | 'cancelled' | 'failed';
  cancelReason: 'user' | 'restart' | 'superseded' | null;
  failureReason: string | null;
  contextVersion: string | null;
  excludedFiles: Array<{ path: string; reason: string }>;
  restrictionsNotEnforced: string[];
  items: RiskAssessmentItem[];
}

export interface ClassOverrideRecord {
  id: string;
  sessionId: string;
  snapshotId: string;
  path: string;
  class: RiskClass;
  replacedClass: RiskClass;
  calculatedClass: RiskClass;
  reason: string;
  changeFingerprint: string;
  /** Set only when a Critical-calculated class was taken below Critical (FR-020); audit data only. */
  reviewer: { handle: string; name: string } | null;
  createdAt: string;
}

export type WriteRecordState = 'pending' | 'posted' | 'failed';
export type WriteRecordAction = 'comment' | 'reply_comment' | 'edit_comment' | 'delete_comment' | 'approve' | 'request_changes' | 'withdraw_decision';

/** One step of a platform write; rows of one action share `intentId`. Append-only. */
export interface WriteRecordRow {
  intentId: string;
  sessionId: string;
  state: WriteRecordState;
  action: WriteRecordAction;
  actor: string | null;
  destination: unknown;
  headSha: string;
  body: string | null;
  platformId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** A specification lookup with the sources and documents it found (feature 006; every record is append-only). */
export type SpecLookupRecord = {
  id: string;
  snapshotId: string;
  lookedAt: string;
  trigger: 'snapshot' | 'refresh';
  keys: string[];
  searched: Array<{ repository: string; role: 'own' | 'enclosing'; heads: string[] }>;
  enclosingNote: 'found' | 'not-inside-project' | null;
  outcome: 'found' | 'partial' | 'not-found' | 'no-key' | 'failed';
  reason: string | null;
};

export type SpecCopyRecord = { repository: string; branch: string; commitSha: string; folder: string };

export type SpecSourceRecord = SpecCopyRecord & {
  id: string;
  key: string;
  ruleUsed: 'own-repository-first' | 'matching-branch' | 'develop' | 'most-recent-commit' | 'only-match';
  otherCopies: SpecCopyRecord[];
  developCopyExists: boolean;
  matchesKey: boolean;
};

export type SpecDocumentRecord = {
  id: string;
  key: string;
  kind: 'specification' | 'tdd-evidence';
  status: 'found' | 'missing';
  sourceId: string | null;
  filePath: string | null;
  commitSha: string | null;
  content: string | null;
  contentSha256: string | null;
  otherFiles: string[];
  missingReason: string | null;
};

export type SpecLookupInput = { lookup: SpecLookupRecord; sources: SpecSourceRecord[]; documents: SpecDocumentRecord[] };
export type SpecLookupWithParts = SpecLookupInput;

export type SpecAlignmentRowRecord = {
  ordinal: number;
  criterionRef: string | null;
  criterionText: string;
  implementationState: 'implementation-and-test' | 'implementation' | 'requires-verification' | 'not-found';
  testShown: 'shown' | 'none' | 'no-evidence-available';
  testMismatch: boolean;
  note: string;
  unverified: boolean;
  citations: unknown[];
};

export type SpecAlignmentItemRecord = {
  ordinal: number;
  kind: 'uncovered-criterion' | 'test-may-not-test-right-thing' | 'implemented-not-requested' | 'requested-not-implemented';
  rowOrdinal: number | null;
  text: string;
  unverified: boolean;
  citations: unknown[];
};

export type SpecAlignmentRunRecord = {
  id: string;
  snapshotId: string;
  lookupId: string;
  specDocumentId: string;
  tddDocumentId: string | null;
  requestedAt: string;
  finishedAt: string;
  provider: string;
  contextVersion: string | null;
  outcome: 'completed' | 'cancelled' | 'failed';
  cancelReason: 'user' | 'restart' | 'superseded' | null;
  failureReason: string | null;
  specSummary: string | null;
  tddSummary: string | null;
  verdict: 'sufficient' | 'incomplete' | 'cannot-judge' | null;
  verdictText: string | null;
  leftOut: Array<{ document: string; part: string; reason: string }>;
  restrictionsNotEnforced: string[];
  warning: string | null;
  rows: SpecAlignmentRowRecord[];
  items: SpecAlignmentItemRecord[];
};


export interface ReviewStore {
  /** Runs `fn` atomically (nested calls use savepoints); `fn` must be synchronous. */
  transaction<T>(fn: () => T): T;

  appendSession(session: ReviewSession): void;
  upsertSessionStatus(status: SessionStatus): void;
  appendSnapshot(snapshot: PrSnapshot): void;
  appendCommit(commit: Commit): void;
  appendChangedFile(file: ChangedFile): void;
  appendIssueReference(reference: IssueReference): void;
  appendEvidence(evidence: Evidence): void;
  appendSummaryRun(run: SummaryRun): void;
  appendQuestion(question: Question): void;
  appendStoredPrompt(prompt: StoredPromptInput): void;
  appendStreamChunk(chunk: StreamChunkInput): void;
  appendAnswer(answer: Answer): void;
  appendSummary(summary: Summary): void;
  appendSummarySection(section: SummarySection): void;
  appendClaim(claim: ClaimInput): void;
  appendReference(reference: Reference): void;
  /** Removes the session and everything under it, in one transaction. */
  deleteSession(id: string): void;

  /** Appends one write_record row (insert only; the table refuses update and delete). */
  insertWriteRecord(row: WriteRecordRow): void;
  /** A session's write records in insert order, optionally for one intent. */
  listWriteRecords(sessionId: string, intentId?: string): WriteRecordRow[];
  /** Closes every pending intent with no result in the session with a failed 'abandoned' row; returns how many. */
  closeAbandonedWrites(sessionId: string, closedAt: string): number;

  readSession(id: string): ReviewSession | null;
  findSessionByPr(pr: PrRef): ReviewSession | null;
  listSessions(): ReviewSession[];
  findSessionsByIssue(issue: IssueKey): ReviewSession[];
  readSessionStatus(sessionId: string): SessionStatus | null;

  readSnapshot(id: string): PrSnapshot | null;
  readLatestSnapshot(sessionId: string): PrSnapshot | null;
  listSnapshots(sessionId: string): PrSnapshot[];
  listCommits(snapshotId: string): Commit[];
  listChangedFiles(snapshotId: string): ChangedFile[];
  readChangedFile(snapshotId: string, path: string): ChangedFile | null;
  listIssueReferences(snapshotId: string): IssueReference[];

  readEvidence(id: string): Evidence | null;
  listEvidence(sessionId: string): Evidence[];
  listEvidenceBySource(sessionId: string, source: IssueKey): Evidence[];
  readLatestEvidence(sessionId: string, source: IssueKey): Evidence | null;
  listLatestEvidence(sessionId: string, kind?: EvidenceKind): Evidence[];

  readQuestion(id: string): Question | null;
  listQuestions(sessionId: string): Question[];
  listUnansweredQuestions(): Question[];
  readStoredPrompt(owner: GenerationOwner): StoredPrompt | null;
  listStreamChunks(owner: GenerationOwner): StreamChunk[];
  readAnswer(questionId: string): Answer | null;

  readSummaryRun(id: string): SummaryRun | null;
  listSummaryRuns(snapshotId: string): SummaryRun[];
  listUnfinishedSummaryRuns(): SummaryRun[];
  readSummary(summaryRunId: string): Summary | null;
  listSummarySections(summaryId: string): SummarySection[];

  listClaims(owner: ClaimOwner): Claim[];
  listReferences(claimId: string): Reference[];
  listClaimsWithReferences(owner: ClaimOwner): ClaimWithReferences[];

  /** One snapshot's rule results: the ruleset row, every file's class and its reasons, in one transaction. */
  appendRiskClassification(input: { ruleset: RiskRulesetRecord; files: RiskClassificationRecord[] }): void;
  readRiskRuleset(snapshotId: string): RiskRulesetRecord | null;
  /** In the order the files were classified (diff order). */
  readRiskClassifications(snapshotId: string): RiskClassificationRecord[];
  /** An AI assessment attempt, once it ends, with its items, in one transaction. */
  appendRiskRun(run: RiskRunRecord): void;
  /** The latest run of any outcome. */
  readLatestRiskRun(snapshotId: string): RiskRunRecord | null;
  readLatestCompletedRiskRun(snapshotId: string): RiskRunRecord | null;
  /** A lookup with its sources and documents, in one transaction; a refused record leaves nothing behind. */
  appendSpecLookup(input: SpecLookupInput): void;
  /** An alignment attempt once it ends, with its rows and items. Its documents must be found rows of its own lookup. */
  appendSpecAlignmentRun(run: SpecAlignmentRunRecord): void;
  readLatestSpecLookup(snapshotId: string): SpecLookupWithParts | null;
  /** One stored document and the snapshot it belongs to, or null. */
  readSpecDocument(documentId: string): (SpecDocumentRecord & { snapshotId: string; lookupId: string }) | null;
  /** The latest run of any outcome, with its rows and items. */
  readLatestSpecAlignmentRun(snapshotId: string): SpecAlignmentRunRecord | null;
  appendClassOverride(record: ClassOverrideRecord): void;
  /** One file's records, oldest first. There is no query by reviewer or across files (FR-025, FR-040). */
  readOverrideHistory(sessionId: string, path: string): ClassOverrideRecord[];
  readLatestOverride(sessionId: string, path: string): ClassOverrideRecord | null;
}

// ---------------------------------------------------------------------------
// Row mapping

type Row = Record<string, SQLInputValue>;

const str = (value: unknown): string => String(value);
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const bool = (value: unknown): boolean => Number(value) === 1;
const toSpecDocument = (x: Record<string, unknown>): SpecDocumentRecord => ({
  id: String(x['id']), key: String(x['key']), kind: String(x['kind']) as SpecDocumentRecord['kind'],
  status: String(x['status']) as SpecDocumentRecord['status'], sourceId: strOrNull(x['source_id']),
  filePath: strOrNull(x['file_path']), commitSha: strOrNull(x['commit_sha']), content: strOrNull(x['content']),
  contentSha256: strOrNull(x['content_sha256']), otherFiles: JSON.parse(String(x['other_files'])) as string[],
  missingReason: strOrNull(x['missing_reason']),
});
const bit = (value: boolean): number => (value ? 1 : 0);
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const jsonOrNull = <T>(value: unknown): T | null => (value === null || value === undefined ? null : json<T>(value));

const toSession = (r: Row): ReviewSession => ({
  id: str(r['id']),
  pr: { repo: { platform: str(r['pr_repo_platform']), identifier: str(r['pr_repo_identifier']) }, number: num(r['pr_number']) },
  createdAt: str(r['created_at']),
});

const toStatus = (r: Row): SessionStatus => ({
  sessionId: str(r['session_id']),
  prStatus: str(r['pr_status']) as PrStatus,
  statusNote: strOrNull(r['status_note']),
  lastCheckedAt: str(r['last_checked_at']),
  lastCheckedHead: strOrNull(r['last_checked_head']),
  lastCheckOutcome: str(r['last_check_outcome']) as CheckOutcome,
  lastCheckError: strOrNull(r['last_check_error']),
  lastOpenedAt: str(r['last_opened_at']),
});

const toSnapshot = (r: Row): PrSnapshot => ({
  id: str(r['id']),
  sessionId: str(r['session_id']),
  seq: num(r['seq']),
  takenAt: str(r['taken_at']),
  headCommit: str(r['head_commit']),
  title: str(r['title']),
  description: str(r['description']),
  author: str(r['author']),
  sourceBranch: {
    repo: { platform: str(r['source_branch_repo_platform']), identifier: str(r['source_branch_repo_identifier']) },
    name: str(r['source_branch_name']),
  },
  targetBranch: {
    repo: { platform: str(r['target_branch_repo_platform']), identifier: str(r['target_branch_repo_identifier']) },
    name: str(r['target_branch_name']),
  },
  targetCommit: strOrNull(r['target_commit']),
  baseCommit: strOrNull(r['base_commit']),
  diffSource: str(r['diff_source']) as DiffSource,
  diffFingerprint: str(r['diff_fingerprint']),
  repositoryStatus: str(r['repository_status']) as RepositoryStatus,
  repositoryReason: strOrNull(r['repository_reason']),
  headRef: strOrNull(r['head_ref']),
  targetRef: strOrNull(r['target_ref']),
});

const toCommit = (r: Row): Commit => ({
  snapshotId: str(r['snapshot_id']),
  ordinal: num(r['ordinal']),
  sha: str(r['sha']),
  authorName: str(r['author_name']),
  message: str(r['message']),
  committedAt: str(r['committed_at']),
});

const toChangedFile = (r: Row): ChangedFile => ({
  snapshotId: str(r['snapshot_id']),
  ordinal: num(r['ordinal']),
  path: str(r['path']),
  oldPath: strOrNull(r['old_path']),
  status: str(r['status']) as ChangedFileStatus,
  additions: num(r['additions']),
  deletions: num(r['deletions']),
  binary: bool(r['binary']),
  sizeBytes: numOrNull(r['size_bytes']),
  language: strOrNull(r['language']),
  patch: strOrNull(r['patch']),
  excludedReason: strOrNull(r['excluded_reason']) as ExcludedReason | null,
});

const toIssueReference = (r: Row): IssueReference => ({
  snapshotId: str(r['snapshot_id']),
  issue: { platform: str(r['issue_platform']), key: str(r['issue_key']) },
  kind: str(r['kind']) as IssueReferenceKind,
  origins: json<IssueOrigin[]>(r['origins']),
});

const toEvidence = (r: Row): Evidence => ({
  id: str(r['id']),
  sessionId: str(r['session_id']),
  snapshotId: str(r['snapshot_id']),
  kind: str(r['kind']) as EvidenceKind,
  source: { platform: str(r['source_platform']), key: str(r['source_key']) },
  capturedAt: str(r['captured_at']),
  commit: str(r['commit']),
  commitBound: bool(r['commit_bound']),
  status: str(r['status']) as EvidenceStatus,
  reason: strOrNull(r['reason']),
  lastGoodId: strOrNull(r['last_good_id']),
  payload: jsonOrNull<IssuePayload>(r['payload']),
});

const toOverride = (r: Row): ClassOverrideRecord => ({
  id: str(r['id']),
  sessionId: str(r['session_id']),
  snapshotId: str(r['snapshot_id']),
  path: str(r['path']),
  class: str(r['class']) as RiskClass,
  replacedClass: str(r['replaced_class']) as RiskClass,
  calculatedClass: str(r['calculated_class']) as RiskClass,
  reason: str(r['reason']),
  changeFingerprint: str(r['change_fingerprint']),
  reviewer: r['reviewer_handle'] === null ? null : { handle: str(r['reviewer_handle']), name: str(r['reviewer_name']) },
  createdAt: str(r['created_at']),
});

const toSummaryRun = (r: Row): SummaryRun => ({
  id: str(r['id']),
  snapshotId: str(r['snapshot_id']),
  requestedAt: str(r['requested_at']),
  provider: str(r['provider']),
});

const toQuestion = (r: Row): Question => ({
  id: str(r['id']),
  sessionId: str(r['session_id']),
  snapshotId: str(r['snapshot_id']),
  seq: num(r['seq']),
  askedAt: str(r['asked_at']),
  text: str(r['text']),
  category: str(r['category']) as Category,
  audience: str(r['audience']) as Audience,
  scope: {
    type: str(r['scope_type']) as QuestionScope['type'],
    path: strOrNull(r['scope_path']),
    side: strOrNull(r['scope_side']) as QuestionScope['side'],
    startLine: numOrNull(r['scope_start_line']),
    endLine: numOrNull(r['scope_end_line']),
    label: strOrNull(r['scope_label']),
  },
  followsQuestionId: strOrNull(r['follows_question_id']),
  origin: str(r['origin']) as QuestionOrigin,
  provider: str(r['provider']),
});

const toStoredPrompt = (r: Row): StoredPrompt => ({
  id: str(r['id']),
  questionId: strOrNull(r['question_id']),
  summaryRunId: strOrNull(r['summary_run_id']),
  instructions: str(r['instructions']),
  data: str(r['data']),
  contextVersion: str(r['context_version']),
  excludedFiles: json<ExcludedFile[]>(r['excluded_files']),
  dataChars: num(r['data_chars']),
  restrictionsNotEnforced: json<string[]>(r['restrictions_not_enforced']),
  sentAt: str(r['sent_at']),
});

const toStreamChunk = (r: Row): StreamChunk => ({
  questionId: strOrNull(r['question_id']),
  summaryRunId: strOrNull(r['summary_run_id']),
  seq: num(r['seq']),
  text: str(r['text']),
  receivedAt: str(r['received_at']),
});

const toAnswer = (r: Row): Answer => ({
  id: str(r['id']),
  questionId: str(r['question_id']),
  outcome: str(r['outcome']) as Outcome,
  cancelReason: strOrNull(r['cancel_reason']) as CancelReason | null,
  failureReason: strOrNull(r['failure_reason']),
  warning: strOrNull(r['warning']) as Warning | null,
  rawText: strOrNull(r['raw_text']),
  unsupportedAssumptions: json<string[]>(r['unsupported_assumptions']),
  suggestedFollowUps: json<string[]>(r['suggested_follow_ups']),
  contextVersion: strOrNull(r['context_version']),
  restrictionsNotEnforced: json<string[]>(r['restrictions_not_enforced']),
  finishedAt: str(r['finished_at']),
});

const toSummary = (r: Row): Summary => ({
  id: str(r['id']),
  summaryRunId: str(r['summary_run_id']),
  outcome: str(r['outcome']) as Outcome,
  cancelReason: strOrNull(r['cancel_reason']) as CancelReason | null,
  failureReason: strOrNull(r['failure_reason']),
  warning: strOrNull(r['warning']) as Warning | null,
  rawText: strOrNull(r['raw_text']),
  contextVersion: strOrNull(r['context_version']),
  restrictionsNotEnforced: json<string[]>(r['restrictions_not_enforced']),
  finishedAt: str(r['finished_at']),
});

const toSummarySection = (r: Row): SummarySection => ({
  id: str(r['id']),
  summaryId: str(r['summary_id']),
  ordinal: num(r['ordinal']),
  kind: str(r['kind']) as SummarySectionKind,
  path: strOrNull(r['path']),
});

const toClaim = (r: Row): Claim => ({
  id: str(r['id']),
  answerId: strOrNull(r['answer_id']),
  summarySectionId: strOrNull(r['summary_section_id']),
  ordinal: num(r['ordinal']),
  text: str(r['text']),
  proposedLabel: str(r['proposed_label']) as ClaimLabel,
  label: str(r['label']) as ClaimLabel,
  proposedIntent: strOrNull(r['proposed_intent']) as Intent | null,
  intent: strOrNull(r['intent']) as Intent | null,
});

const toReference = (r: Row): Reference => {
  const platform = strOrNull(r['issue_platform']);
  const key = strOrNull(r['issue_key']);
  return {
    claimId: str(r['claim_id']),
    ordinal: num(r['ordinal']),
    kind: str(r['kind']) as ReferenceKind,
    path: strOrNull(r['path']),
    side: strOrNull(r['side']) as Reference['side'],
    startLine: numOrNull(r['start_line']),
    endLine: numOrNull(r['end_line']),
    commit: strOrNull(r['commit']),
    issue: platform !== null && key !== null ? { platform, key } : null,
    resolved: bool(r['resolved']),
    unresolvedReason: strOrNull(r['unresolved_reason']),
  };
};

// ---------------------------------------------------------------------------
// SQL

const SNAPSHOT_COLUMNS = `id, session_id, seq, taken_at, head_commit, title, description, author,
  source_branch_repo_platform, source_branch_repo_identifier, source_branch_name,
  target_branch_repo_platform, target_branch_repo_identifier, target_branch_name,
  target_commit, base_commit, diff_source, diff_fingerprint, repository_status, repository_reason,
  head_ref, target_ref`;

/** Latest evidence per (source_platform, source_key) of a session: highest captured_at, then rowid. */
const LATEST_EVIDENCE = `
  SELECT e.* FROM evidence e
  WHERE e.session_id = :sessionId AND (:kind IS NULL OR e.kind = :kind)
    AND NOT EXISTS (
      SELECT 1 FROM evidence later
      WHERE later.session_id = e.session_id
        AND later.source_platform = e.source_platform
        AND later.source_key = e.source_key
        AND later.kind = e.kind
        AND (later.captured_at > e.captured_at
             OR (later.captured_at = e.captured_at AND later.rowid > e.rowid)))
  ORDER BY e.source_platform, e.source_key`;

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function createReviewStore(db: DatabaseSync): ReviewStore {
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const run = (sql: string, params: Record<string, SQLInputValue>): void => {
    prepare(sql).run(params);
  };
  const one = <T>(sql: string, params: Record<string, SQLInputValue>, map: (row: Row) => T): T | null => {
    const row = prepare(sql).get(params) as Row | undefined;
    return row ? map(row) : null;
  };
  const all = <T>(sql: string, params: Record<string, SQLInputValue>, map: (row: Row) => T): T[] =>
    (prepare(sql).all(params) as Row[]).map(map);

  const toRiskRun = (r: Row): RiskRunRecord => ({
    id: str(r['id']),
    snapshotId: str(r['snapshot_id']),
    requestedAt: str(r['requested_at']),
    finishedAt: str(r['finished_at']),
    provider: str(r['provider']),
    outcome: str(r['outcome']) as RiskRunRecord['outcome'],
    cancelReason: strOrNull(r['cancel_reason']) as RiskRunRecord['cancelReason'],
    failureReason: strOrNull(r['failure_reason']),
    contextVersion: strOrNull(r['context_version']),
    excludedFiles: json<Array<{ path: string; reason: string }>>(r['excluded_files']),
    restrictionsNotEnforced: json<string[]>(r['restrictions_not_enforced']),
    items: all('SELECT * FROM risk_assessment_item WHERE run_id = :id ORDER BY rowid', { id: str(r['id']) }, (i) => ({
      path: str(i['path']),
      proposedClass: str(i['proposed_class']) as RiskAssessmentItem['proposedClass'],
      applied: bool(i['applied']),
      ignoredReason: strOrNull(i['ignored_reason']) as RiskIgnoredReason | null,
      reasons: json<string[]>(i['reasons']),
      lines: json<RiskAssessmentItem['lines']>(i['lines']),
    })),
  });

  let savepoints = 0;
  function transaction<T>(fn: () => T): T {
    if (db.isTransaction) {
      const name = `prwb_sp_${(savepoints += 1)}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        if (isThenable(result)) throw new TypeError('transaction() takes a synchronous function');
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw error;
      }
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      if (isThenable(result)) throw new TypeError('transaction() takes a synchronous function');
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  const store: ReviewStore = {
    transaction,

    appendSession(s) {
      run(
        `INSERT INTO review_session (id, pr_repo_platform, pr_repo_identifier, pr_number, created_at)
         VALUES (:id, :platform, :identifier, :number, :createdAt)`,
        { id: s.id, platform: s.pr.repo.platform, identifier: s.pr.repo.identifier, number: s.pr.number, createdAt: s.createdAt },
      );
    },

    upsertSessionStatus(s) {
      run(
        `INSERT INTO session_status (session_id, pr_status, status_note, last_checked_at, last_checked_head,
           last_check_outcome, last_check_error, last_opened_at)
         VALUES (:sessionId, :prStatus, :statusNote, :lastCheckedAt, :lastCheckedHead,
           :lastCheckOutcome, :lastCheckError, :lastOpenedAt)
         ON CONFLICT (session_id) DO UPDATE SET
           pr_status = excluded.pr_status,
           status_note = excluded.status_note,
           last_checked_at = excluded.last_checked_at,
           last_checked_head = excluded.last_checked_head,
           last_check_outcome = excluded.last_check_outcome,
           last_check_error = excluded.last_check_error,
           last_opened_at = excluded.last_opened_at`,
        {
          sessionId: s.sessionId,
          prStatus: s.prStatus,
          statusNote: s.statusNote,
          lastCheckedAt: s.lastCheckedAt,
          lastCheckedHead: s.lastCheckedHead,
          lastCheckOutcome: s.lastCheckOutcome,
          lastCheckError: s.lastCheckError,
          lastOpenedAt: s.lastOpenedAt,
        },
      );
    },

    appendSnapshot(s) {
      run(
        `INSERT INTO pr_snapshot (${SNAPSHOT_COLUMNS})
         VALUES (:id, :sessionId, :seq, :takenAt, :headCommit, :title, :description, :author,
           :sourcePlatform, :sourceIdentifier, :sourceName,
           :targetPlatform, :targetIdentifier, :targetName,
           :targetCommit, :baseCommit, :diffSource, :diffFingerprint, :repositoryStatus, :repositoryReason,
           :headRef, :targetRef)`,
        {
          id: s.id,
          sessionId: s.sessionId,
          seq: s.seq,
          takenAt: s.takenAt,
          headCommit: s.headCommit,
          title: s.title,
          description: s.description,
          author: s.author,
          sourcePlatform: s.sourceBranch.repo.platform,
          sourceIdentifier: s.sourceBranch.repo.identifier,
          sourceName: s.sourceBranch.name,
          targetPlatform: s.targetBranch.repo.platform,
          targetIdentifier: s.targetBranch.repo.identifier,
          targetName: s.targetBranch.name,
          targetCommit: s.targetCommit,
          baseCommit: s.baseCommit,
          diffSource: s.diffSource,
          diffFingerprint: s.diffFingerprint,
          repositoryStatus: s.repositoryStatus,
          repositoryReason: s.repositoryReason,
          headRef: s.headRef,
          targetRef: s.targetRef,
        },
      );
    },

    appendCommit(c) {
      run(
        `INSERT INTO "commit" (snapshot_id, ordinal, sha, author_name, message, committed_at)
         VALUES (:snapshotId, :ordinal, :sha, :authorName, :message, :committedAt)`,
        { snapshotId: c.snapshotId, ordinal: c.ordinal, sha: c.sha, authorName: c.authorName, message: c.message, committedAt: c.committedAt },
      );
    },

    appendChangedFile(f) {
      run(
        `INSERT INTO changed_file (snapshot_id, ordinal, path, old_path, status, additions, deletions, binary,
           size_bytes, language, patch, excluded_reason)
         VALUES (:snapshotId, :ordinal, :path, :oldPath, :status, :additions, :deletions, :binary,
           :sizeBytes, :language, :patch, :excludedReason)`,
        {
          snapshotId: f.snapshotId,
          ordinal: f.ordinal,
          path: f.path,
          oldPath: f.oldPath,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          binary: bit(f.binary),
          sizeBytes: f.sizeBytes,
          language: f.language,
          patch: f.patch,
          excludedReason: f.excludedReason,
        },
      );
    },

    appendIssueReference(r) {
      run(
        `INSERT INTO issue_reference (snapshot_id, issue_platform, issue_key, kind, origins)
         VALUES (:snapshotId, :platform, :key, :kind, :origins)`,
        { snapshotId: r.snapshotId, platform: r.issue.platform, key: r.issue.key, kind: r.kind, origins: JSON.stringify(r.origins) },
      );
    },

    appendEvidence(e) {
      run(
        `INSERT INTO evidence (id, session_id, snapshot_id, kind, source_platform, source_key, captured_at, "commit",
           commit_bound, status, reason, last_good_id, payload)
         VALUES (:id, :sessionId, :snapshotId, :kind, :sourcePlatform, :sourceKey, :capturedAt, :commit,
           :commitBound, :status, :reason, :lastGoodId, :payload)`,
        {
          id: e.id,
          sessionId: e.sessionId,
          snapshotId: e.snapshotId,
          kind: e.kind,
          sourcePlatform: e.source.platform,
          sourceKey: e.source.key,
          capturedAt: e.capturedAt,
          commit: e.commit,
          commitBound: bit(e.commitBound),
          status: e.status,
          reason: e.reason,
          lastGoodId: e.lastGoodId,
          payload: e.payload === null ? null : JSON.stringify(e.payload),
        },
      );
    },

    appendSummaryRun(r) {
      run(
        `INSERT INTO summary_run (id, snapshot_id, requested_at, provider)
         VALUES (:id, :snapshotId, :requestedAt, :provider)`,
        { id: r.id, snapshotId: r.snapshotId, requestedAt: r.requestedAt, provider: r.provider },
      );
    },

    appendQuestion(q) {
      run(
        `INSERT INTO question (id, session_id, snapshot_id, seq, asked_at, text, category, audience,
           scope_type, scope_path, scope_side, scope_start_line, scope_end_line, scope_label,
           follows_question_id, origin, provider)
         VALUES (:id, :sessionId, :snapshotId, :seq, :askedAt, :text, :category, :audience,
           :scopeType, :scopePath, :scopeSide, :scopeStartLine, :scopeEndLine, :scopeLabel,
           :followsQuestionId, :origin, :provider)`,
        {
          id: q.id,
          sessionId: q.sessionId,
          snapshotId: q.snapshotId,
          seq: q.seq,
          askedAt: q.askedAt,
          text: q.text,
          category: q.category,
          audience: q.audience,
          scopeType: q.scope.type,
          scopePath: q.scope.path,
          scopeSide: q.scope.side,
          scopeStartLine: q.scope.startLine,
          scopeEndLine: q.scope.endLine,
          scopeLabel: q.scope.label,
          followsQuestionId: q.followsQuestionId,
          origin: q.origin,
          provider: q.provider,
        },
      );
    },

    appendStoredPrompt(p) {
      run(
        `INSERT INTO stored_prompt (id, question_id, summary_run_id, instructions, data, context_version,
           excluded_files, data_chars, restrictions_not_enforced, sent_at)
         VALUES (:id, :questionId, :summaryRunId, :instructions, :data, :contextVersion,
           :excludedFiles, :dataChars, :restrictionsNotEnforced, :sentAt)`,
        {
          id: p.id,
          questionId: p.questionId ?? null,
          summaryRunId: p.summaryRunId ?? null,
          instructions: p.instructions,
          data: p.data,
          contextVersion: p.contextVersion,
          excludedFiles: JSON.stringify(p.excludedFiles),
          dataChars: p.dataChars,
          restrictionsNotEnforced: JSON.stringify(p.restrictionsNotEnforced),
          sentAt: p.sentAt,
        },
      );
    },

    appendStreamChunk(c) {
      run(
        `INSERT INTO stream_chunk (question_id, summary_run_id, seq, text, received_at)
         VALUES (:questionId, :summaryRunId, :seq, :text, :receivedAt)`,
        { questionId: c.questionId ?? null, summaryRunId: c.summaryRunId ?? null, seq: c.seq, text: c.text, receivedAt: c.receivedAt },
      );
    },

    appendAnswer(a) {
      run(
        `INSERT INTO answer (id, question_id, outcome, cancel_reason, failure_reason, warning, raw_text,
           unsupported_assumptions, suggested_follow_ups, context_version, restrictions_not_enforced, finished_at)
         VALUES (:id, :questionId, :outcome, :cancelReason, :failureReason, :warning, :rawText,
           :unsupportedAssumptions, :suggestedFollowUps, :contextVersion, :restrictionsNotEnforced, :finishedAt)`,
        {
          id: a.id,
          questionId: a.questionId,
          outcome: a.outcome,
          cancelReason: a.cancelReason,
          failureReason: a.failureReason,
          warning: a.warning,
          rawText: a.rawText,
          unsupportedAssumptions: JSON.stringify(a.unsupportedAssumptions),
          suggestedFollowUps: JSON.stringify(a.suggestedFollowUps),
          contextVersion: a.contextVersion,
          restrictionsNotEnforced: JSON.stringify(a.restrictionsNotEnforced),
          finishedAt: a.finishedAt,
        },
      );
    },

    appendSummary(s) {
      run(
        `INSERT INTO summary (id, summary_run_id, outcome, cancel_reason, failure_reason, warning, raw_text,
           context_version, restrictions_not_enforced, finished_at)
         VALUES (:id, :summaryRunId, :outcome, :cancelReason, :failureReason, :warning, :rawText,
           :contextVersion, :restrictionsNotEnforced, :finishedAt)`,
        {
          id: s.id,
          summaryRunId: s.summaryRunId,
          outcome: s.outcome,
          cancelReason: s.cancelReason,
          failureReason: s.failureReason,
          warning: s.warning,
          rawText: s.rawText,
          contextVersion: s.contextVersion,
          restrictionsNotEnforced: JSON.stringify(s.restrictionsNotEnforced),
          finishedAt: s.finishedAt,
        },
      );
    },

    appendSummarySection(s) {
      run(
        `INSERT INTO summary_section (id, summary_id, ordinal, kind, path)
         VALUES (:id, :summaryId, :ordinal, :kind, :path)`,
        { id: s.id, summaryId: s.summaryId, ordinal: s.ordinal, kind: s.kind, path: s.path },
      );
    },

    appendClaim(c) {
      run(
        `INSERT INTO claim (id, answer_id, summary_section_id, ordinal, text, proposed_label, label,
           proposed_intent, intent)
         VALUES (:id, :answerId, :summarySectionId, :ordinal, :text, :proposedLabel, :label,
           :proposedIntent, :intent)`,
        {
          id: c.id,
          answerId: c.answerId ?? null,
          summarySectionId: c.summarySectionId ?? null,
          ordinal: c.ordinal,
          text: c.text,
          proposedLabel: c.proposedLabel,
          label: c.label,
          proposedIntent: c.proposedIntent,
          intent: c.intent,
        },
      );
    },

    appendReference(r) {
      run(
        `INSERT INTO "reference" (claim_id, ordinal, kind, path, side, start_line, end_line, "commit",
           issue_platform, issue_key, resolved, unresolved_reason)
         VALUES (:claimId, :ordinal, :kind, :path, :side, :startLine, :endLine, :commit,
           :issuePlatform, :issueKey, :resolved, :unresolvedReason)`,
        {
          claimId: r.claimId,
          ordinal: r.ordinal,
          kind: r.kind,
          path: r.path,
          side: r.side,
          startLine: r.startLine,
          endLine: r.endLine,
          commit: r.commit,
          issuePlatform: r.issue?.platform ?? null,
          issueKey: r.issue?.key ?? null,
          resolved: bit(r.resolved),
          unresolvedReason: r.unresolvedReason,
        },
      );
    },

    deleteSession(id) {
      transaction(() => {
        run('INSERT OR IGNORE INTO session_deletion (session_id) VALUES (:id)', { id });
        run('DELETE FROM review_session WHERE id = :id', { id });
        run('DELETE FROM session_deletion WHERE session_id = :id', { id });
      });
    },

    insertWriteRecord(r) {
      run(
        `INSERT INTO write_record (intent_id, session_id, state, action, actor, destination, head_sha, body,
           platform_id, error_code, error_message, created_at)
         VALUES (:intentId, :sessionId, :state, :action, :actor, :destination, :headSha, :body,
           :platformId, :errorCode, :errorMessage, :createdAt)`,
        {
          intentId: r.intentId, sessionId: r.sessionId, state: r.state, action: r.action, actor: r.actor,
          destination: JSON.stringify(r.destination), headSha: r.headSha, body: r.body, platformId: r.platformId,
          errorCode: r.errorCode, errorMessage: r.errorMessage, createdAt: r.createdAt,
        },
      );
    },

    listWriteRecords(sessionId, intentId) {
      const map = (w: Row): WriteRecordRow => ({
        intentId: str(w['intent_id']),
        sessionId: str(w['session_id']),
        state: str(w['state']) as WriteRecordState,
        action: str(w['action']) as WriteRecordAction,
        actor: strOrNull(w['actor']),
        destination: JSON.parse(str(w['destination'])) as unknown,
        headSha: str(w['head_sha']),
        body: strOrNull(w['body']),
        platformId: strOrNull(w['platform_id']),
        errorCode: strOrNull(w['error_code']),
        errorMessage: strOrNull(w['error_message']),
        createdAt: str(w['created_at']),
      });
      return intentId === undefined
        ? all('SELECT * FROM write_record WHERE session_id = :sessionId ORDER BY id', { sessionId }, map)
        : all('SELECT * FROM write_record WHERE session_id = :sessionId AND intent_id = :intentId ORDER BY id', { sessionId, intentId }, map);
    },

    closeAbandonedWrites(sessionId, closedAt) {
      return transaction(() => {
        const open = all(
          `SELECT * FROM write_record p WHERE p.session_id = :sessionId AND p.state = 'pending'
             AND NOT EXISTS (SELECT 1 FROM write_record t WHERE t.intent_id = p.intent_id AND t.state IN ('posted', 'failed'))
           GROUP BY p.intent_id HAVING p.id = max(p.id) ORDER BY p.id`,
          { sessionId },
          (w) => w,
        );
        for (const w of open) {
          run(
            `INSERT INTO write_record (intent_id, session_id, state, action, actor, destination, head_sha, body,
               platform_id, error_code, error_message, created_at)
             VALUES (:intentId, :sessionId, 'failed', :action, :actor, :destination, :headSha, :body,
               NULL, 'abandoned', 'The write was interrupted before a result was recorded.', :createdAt)`,
            {
              intentId: str(w['intent_id']), sessionId, action: str(w['action']), actor: strOrNull(w['actor']),
              destination: str(w['destination']), headSha: str(w['head_sha']), body: strOrNull(w['body']), createdAt: closedAt,
            },
          );
        }
        return open.length;
      });
    },

    // -- Sessions

    readSession(id) {
      return one('SELECT * FROM review_session WHERE id = :id', { id }, toSession);
    },

    findSessionByPr(pr) {
      return one(
        `SELECT * FROM review_session
         WHERE pr_repo_platform = :platform AND pr_repo_identifier = :identifier AND pr_number = :number`,
        { platform: pr.repo.platform, identifier: pr.repo.identifier, number: pr.number },
        toSession,
      );
    },

    listSessions() {
      return all('SELECT * FROM review_session ORDER BY created_at, rowid', {}, toSession);
    },

    findSessionsByIssue(issue) {
      return all(
        `SELECT s.* FROM review_session s
         WHERE EXISTS (
           SELECT 1 FROM issue_reference r JOIN pr_snapshot p ON p.id = r.snapshot_id
           WHERE p.session_id = s.id AND r.issue_platform = :platform AND r.issue_key = :key)
         ORDER BY s.created_at, s.rowid`,
        { platform: issue.platform, key: issue.key },
        toSession,
      );
    },

    readSessionStatus(sessionId) {
      return one('SELECT * FROM session_status WHERE session_id = :sessionId', { sessionId }, toStatus);
    },

    // -- Snapshots and their children

    readSnapshot(id) {
      return one('SELECT * FROM pr_snapshot WHERE id = :id', { id }, toSnapshot);
    },

    readLatestSnapshot(sessionId) {
      return one(
        'SELECT * FROM pr_snapshot WHERE session_id = :sessionId ORDER BY seq DESC LIMIT 1',
        { sessionId },
        toSnapshot,
      );
    },

    listSnapshots(sessionId) {
      return all('SELECT * FROM pr_snapshot WHERE session_id = :sessionId ORDER BY seq', { sessionId }, toSnapshot);
    },

    listCommits(snapshotId) {
      return all('SELECT * FROM "commit" WHERE snapshot_id = :snapshotId ORDER BY ordinal', { snapshotId }, toCommit);
    },

    listChangedFiles(snapshotId) {
      return all('SELECT * FROM changed_file WHERE snapshot_id = :snapshotId ORDER BY ordinal', { snapshotId }, toChangedFile);
    },

    readChangedFile(snapshotId, path) {
      return one(
        'SELECT * FROM changed_file WHERE snapshot_id = :snapshotId AND path = :path',
        { snapshotId, path },
        toChangedFile,
      );
    },

    listIssueReferences(snapshotId) {
      return all(
        'SELECT * FROM issue_reference WHERE snapshot_id = :snapshotId ORDER BY rowid',
        { snapshotId },
        toIssueReference,
      );
    },

    // -- Evidence

    readEvidence(id) {
      return one('SELECT * FROM evidence WHERE id = :id', { id }, toEvidence);
    },

    listEvidence(sessionId) {
      return all(
        'SELECT * FROM evidence WHERE session_id = :sessionId ORDER BY captured_at, rowid',
        { sessionId },
        toEvidence,
      );
    },

    listEvidenceBySource(sessionId, source) {
      return all(
        `SELECT * FROM evidence
         WHERE session_id = :sessionId AND source_platform = :platform AND source_key = :key
         ORDER BY captured_at, rowid`,
        { sessionId, platform: source.platform, key: source.key },
        toEvidence,
      );
    },

    readLatestEvidence(sessionId, source) {
      return one(
        `SELECT * FROM evidence
         WHERE session_id = :sessionId AND source_platform = :platform AND source_key = :key
         ORDER BY captured_at DESC, rowid DESC LIMIT 1`,
        { sessionId, platform: source.platform, key: source.key },
        toEvidence,
      );
    },

    listLatestEvidence(sessionId, kind) {
      return all(LATEST_EVIDENCE, { sessionId, kind: kind ?? null }, toEvidence);
    },

    // -- Questions

    readQuestion(id) {
      return one('SELECT * FROM question WHERE id = :id', { id }, toQuestion);
    },

    listQuestions(sessionId) {
      return all('SELECT * FROM question WHERE session_id = :sessionId ORDER BY seq', { sessionId }, toQuestion);
    },

    listUnansweredQuestions() {
      return all(
        `SELECT q.* FROM question q
         WHERE NOT EXISTS (SELECT 1 FROM answer a WHERE a.question_id = q.id)
         ORDER BY q.asked_at, q.rowid`,
        {},
        toQuestion,
      );
    },

    readStoredPrompt(owner) {
      return owner.questionId !== undefined
        ? one('SELECT * FROM stored_prompt WHERE question_id = :id', { id: owner.questionId }, toStoredPrompt)
        : one('SELECT * FROM stored_prompt WHERE summary_run_id = :id', { id: owner.summaryRunId }, toStoredPrompt);
    },

    listStreamChunks(owner) {
      return owner.questionId !== undefined
        ? all('SELECT * FROM stream_chunk WHERE question_id = :id ORDER BY seq', { id: owner.questionId }, toStreamChunk)
        : all('SELECT * FROM stream_chunk WHERE summary_run_id = :id ORDER BY seq', { id: owner.summaryRunId }, toStreamChunk);
    },

    readAnswer(questionId) {
      return one('SELECT * FROM answer WHERE question_id = :questionId', { questionId }, toAnswer);
    },

    // -- Summaries

    readSummaryRun(id) {
      return one('SELECT * FROM summary_run WHERE id = :id', { id }, toSummaryRun);
    },

    listSummaryRuns(snapshotId) {
      return all(
        'SELECT * FROM summary_run WHERE snapshot_id = :snapshotId ORDER BY requested_at, rowid',
        { snapshotId },
        toSummaryRun,
      );
    },

    listUnfinishedSummaryRuns() {
      return all(
        `SELECT r.* FROM summary_run r
         WHERE NOT EXISTS (SELECT 1 FROM summary s WHERE s.summary_run_id = r.id)
         ORDER BY r.requested_at, r.rowid`,
        {},
        toSummaryRun,
      );
    },

    readSummary(summaryRunId) {
      return one('SELECT * FROM summary WHERE summary_run_id = :summaryRunId', { summaryRunId }, toSummary);
    },

    listSummarySections(summaryId) {
      return all(
        'SELECT * FROM summary_section WHERE summary_id = :summaryId ORDER BY ordinal',
        { summaryId },
        toSummarySection,
      );
    },

    // -- Claims and references

    listClaims(owner) {
      return owner.answerId !== undefined
        ? all('SELECT * FROM claim WHERE answer_id = :id ORDER BY ordinal', { id: owner.answerId }, toClaim)
        : all('SELECT * FROM claim WHERE summary_section_id = :id ORDER BY ordinal', { id: owner.summarySectionId }, toClaim);
    },

    listReferences(claimId) {
      return all('SELECT * FROM "reference" WHERE claim_id = :claimId ORDER BY ordinal', { claimId }, toReference);
    },

    listClaimsWithReferences(owner) {
      return store.listClaims(owner).map((claim) => ({ ...claim, references: store.listReferences(claim.id) }));
    },
    // -- Risk records (feature 004)

    appendRiskClassification({ ruleset, files }) {
      transaction(() => {
        run(
          `INSERT INTO risk_ruleset (snapshot_id, ruleset_version, rule_file_status, rule_file_notice, classified_at)
           VALUES (:snapshotId, :version, :status, :notice, :classifiedAt)`,
          {
            snapshotId: ruleset.snapshotId,
            version: ruleset.rulesetVersion,
            status: ruleset.ruleFileStatus,
            notice: JSON.stringify(ruleset.ruleFileNotice),
            classifiedAt: ruleset.classifiedAt,
          },
        );
        for (const f of files) {
          run(
            `INSERT INTO risk_classification (id, snapshot_id, path, rule_class, mechanical, not_fully_analysed, change_fingerprint)
             VALUES (:id, :snapshotId, :path, :ruleClass, :mechanical, :notFullyAnalysed, :fingerprint)`,
            {
              id: f.id,
              snapshotId: f.snapshotId,
              path: f.path,
              ruleClass: f.ruleClass,
              mechanical: bit(f.mechanical),
              notFullyAnalysed: f.notFullyAnalysed,
              fingerprint: f.changeFingerprint,
            },
          );
          for (const r of f.reasons) {
            run(
              `INSERT INTO risk_reason (classification_id, ordinal, rule_id, rule_class, applied, matched_on, text, lines)
               VALUES (:classificationId, :ordinal, :ruleId, :ruleClass, :applied, :matchedOn, :text, :lines)`,
              {
                classificationId: f.id,
                ordinal: r.ordinal,
                ruleId: r.ruleId,
                ruleClass: r.ruleClass,
                applied: bit(r.applied),
                matchedOn: r.matchedOn,
                text: r.text,
                lines: JSON.stringify(r.lines),
              },
            );
          }
        }
      });
    },

    readRiskRuleset(snapshotId) {
      return one('SELECT * FROM risk_ruleset WHERE snapshot_id = :snapshotId', { snapshotId }, (r) => ({
        snapshotId: str(r['snapshot_id']),
        rulesetVersion: str(r['ruleset_version']),
        ruleFileStatus: str(r['rule_file_status']) as RiskRuleFileStatus,
        ruleFileNotice: json<Array<{ entry: string; reason: string }>>(r['rule_file_notice']),
        classifiedAt: str(r['classified_at']),
      }));
    },

    readRiskClassifications(snapshotId) {
      return all('SELECT * FROM risk_classification WHERE snapshot_id = :snapshotId ORDER BY rowid', { snapshotId }, (r) => ({
        id: str(r['id']),
        snapshotId: str(r['snapshot_id']),
        path: str(r['path']),
        ruleClass: str(r['rule_class']) as RiskClass,
        mechanical: bool(r['mechanical']),
        notFullyAnalysed: strOrNull(r['not_fully_analysed']),
        changeFingerprint: str(r['change_fingerprint']),
        reasons: all('SELECT * FROM risk_reason WHERE classification_id = :id ORDER BY ordinal', { id: str(r['id']) }, (q) => ({
          ordinal: num(q['ordinal']),
          ruleId: str(q['rule_id']),
          ruleClass: str(q['rule_class']) as RiskClass,
          applied: bool(q['applied']),
          matchedOn: str(q['matched_on']) as RiskReasonRecord['matchedOn'],
          text: str(q['text']),
          lines: json<LineRange[]>(q['lines']),
        })),
      }));
    },

    appendRiskRun(runRecord) {
      transaction(() => {
        run(
          `INSERT INTO risk_run (id, snapshot_id, requested_at, finished_at, provider, outcome, cancel_reason, failure_reason,
             context_version, excluded_files, restrictions_not_enforced)
           VALUES (:id, :snapshotId, :requestedAt, :finishedAt, :provider, :outcome, :cancelReason, :failureReason,
             :contextVersion, :excludedFiles, :restrictions)`,
          {
            id: runRecord.id,
            snapshotId: runRecord.snapshotId,
            requestedAt: runRecord.requestedAt,
            finishedAt: runRecord.finishedAt,
            provider: runRecord.provider,
            outcome: runRecord.outcome,
            cancelReason: runRecord.cancelReason,
            failureReason: runRecord.failureReason,
            contextVersion: runRecord.contextVersion,
            excludedFiles: JSON.stringify(runRecord.excludedFiles),
            restrictions: JSON.stringify(runRecord.restrictionsNotEnforced),
          },
        );
        for (const item of runRecord.items) {
          run(
            `INSERT INTO risk_assessment_item (run_id, path, proposed_class, applied, ignored_reason, reasons, lines)
             VALUES (:runId, :path, :proposedClass, :applied, :ignoredReason, :reasons, :lines)`,
            {
              runId: runRecord.id,
              path: item.path,
              proposedClass: item.proposedClass,
              applied: bit(item.applied),
              ignoredReason: item.ignoredReason,
              reasons: JSON.stringify(item.reasons),
              lines: JSON.stringify(item.lines),
            },
          );
        }
      });
    },

    readLatestRiskRun(snapshotId) {
      return one('SELECT * FROM risk_run WHERE snapshot_id = :snapshotId ORDER BY finished_at DESC, rowid DESC LIMIT 1', { snapshotId }, toRiskRun);
    },

    readLatestCompletedRiskRun(snapshotId) {
      return one(
        "SELECT * FROM risk_run WHERE snapshot_id = :snapshotId AND outcome = 'completed' ORDER BY finished_at DESC, rowid DESC LIMIT 1",
        { snapshotId },
        toRiskRun,
      );
    },

    appendSpecLookup({ lookup, sources, documents }) {
      transaction(() => {
        run(
          `INSERT INTO spec_lookup (id, snapshot_id, looked_at, trigger, keys, searched, enclosing_note, outcome, reason)
           VALUES (:id, :snapshotId, :lookedAt, :trigger, :keys, :searched, :enclosingNote, :outcome, :reason)`,
          {
            id: lookup.id, snapshotId: lookup.snapshotId, lookedAt: lookup.lookedAt, trigger: lookup.trigger,
            keys: JSON.stringify(lookup.keys), searched: JSON.stringify(lookup.searched),
            enclosingNote: lookup.enclosingNote, outcome: lookup.outcome, reason: lookup.reason,
          },
        );
        for (const src of sources) {
          run(
            `INSERT INTO spec_source (id, lookup_id, key, repository, branch, commit_sha, folder, rule_used, other_copies,
               develop_copy_exists, matches_key)
             VALUES (:id, :lookupId, :key, :repository, :branch, :commitSha, :folder, :ruleUsed, :otherCopies, :develop, :matches)`,
            {
              id: src.id, lookupId: lookup.id, key: src.key, repository: src.repository, branch: src.branch,
              commitSha: src.commitSha, folder: src.folder, ruleUsed: src.ruleUsed, otherCopies: JSON.stringify(src.otherCopies),
              develop: bit(src.developCopyExists), matches: bit(src.matchesKey),
            },
          );
        }
        for (const doc of documents) {
          run(
            `INSERT INTO spec_document (id, lookup_id, key, kind, status, source_id, file_path, commit_sha, content,
               content_sha256, other_files, missing_reason)
             VALUES (:id, :lookupId, :key, :kind, :status, :sourceId, :filePath, :commitSha, :content, :sha, :otherFiles, :missing)`,
            {
              id: doc.id, lookupId: lookup.id, key: doc.key, kind: doc.kind, status: doc.status, sourceId: doc.sourceId,
              filePath: doc.filePath, commitSha: doc.commitSha, content: doc.content, sha: doc.contentSha256,
              otherFiles: JSON.stringify(doc.otherFiles), missing: doc.missingReason,
            },
          );
        }
      });
    },

    appendSpecAlignmentRun(r) {
      transaction(() => {
        const found = (id: string | null, kind: string): void => {
          if (id === null) return;
          const row = one(
            "SELECT 1 AS ok FROM spec_document WHERE id = :id AND lookup_id = :lookupId AND kind = :kind AND status = 'found'",
            { id, lookupId: r.lookupId, kind },
            (x) => x,
          );
          if (row === null) throw new Error(`the ${kind} document is not a found document of lookup ${r.lookupId}`);
        };
        if (one('SELECT 1 AS ok FROM spec_lookup WHERE id = :id AND snapshot_id = :snapshotId', { id: r.lookupId, snapshotId: r.snapshotId }, (x) => x) === null) {
          throw new Error(`lookup ${r.lookupId} does not belong to snapshot ${r.snapshotId}`);
        }
        if (r.outcome !== 'completed' && (r.rows.length > 0 || r.items.length > 0)) throw new Error('only a completed run has rows and items');
        found(r.specDocumentId, 'specification');
        found(r.tddDocumentId, 'tdd-evidence');
        run(
          `INSERT INTO spec_alignment_run (id, snapshot_id, lookup_id, spec_document_id, tdd_document_id, requested_at,
             finished_at, provider, context_version, outcome, cancel_reason, failure_reason, spec_summary, tdd_summary,
             verdict, verdict_text, left_out, restrictions_not_enforced, warning)
           VALUES (:id, :snapshotId, :lookupId, :specDocumentId, :tddDocumentId, :requestedAt, :finishedAt, :provider,
             :contextVersion, :outcome, :cancelReason, :failureReason, :specSummary, :tddSummary, :verdict, :verdictText,
             :leftOut, :restrictions, :warning)`,
          {
            id: r.id, snapshotId: r.snapshotId, lookupId: r.lookupId, specDocumentId: r.specDocumentId,
            tddDocumentId: r.tddDocumentId, requestedAt: r.requestedAt, finishedAt: r.finishedAt, provider: r.provider,
            contextVersion: r.contextVersion, outcome: r.outcome, cancelReason: r.cancelReason, failureReason: r.failureReason,
            specSummary: r.specSummary, tddSummary: r.tddSummary, verdict: r.verdict, verdictText: r.verdictText,
            leftOut: JSON.stringify(r.leftOut), restrictions: JSON.stringify(r.restrictionsNotEnforced), warning: r.warning,
          },
        );
        for (const row of r.rows) {
          run(
            `INSERT INTO spec_alignment_row (run_id, ordinal, criterion_ref, criterion_text, implementation_state, test_shown,
               test_mismatch, note, unverified, citations)
             VALUES (:runId, :ordinal, :ref, :text, :state, :shown, :mismatch, :note, :unverified, :citations)`,
            {
              runId: r.id, ordinal: row.ordinal, ref: row.criterionRef, text: row.criterionText, state: row.implementationState,
              shown: row.testShown, mismatch: bit(row.testMismatch), note: row.note, unverified: bit(row.unverified),
              citations: JSON.stringify(row.citations),
            },
          );
        }
        for (const item of r.items) {
          run(
            `INSERT INTO spec_alignment_item (run_id, ordinal, kind, row_ordinal, text, unverified, citations)
             VALUES (:runId, :ordinal, :kind, :rowOrdinal, :text, :unverified, :citations)`,
            {
              runId: r.id, ordinal: item.ordinal, kind: item.kind, rowOrdinal: item.rowOrdinal, text: item.text,
              unverified: bit(item.unverified), citations: JSON.stringify(item.citations),
            },
          );
        }
      });
    },

    readLatestSpecLookup(snapshotId) {
      const lookup = one(
        'SELECT * FROM spec_lookup WHERE snapshot_id = :snapshotId ORDER BY looked_at DESC, rowid DESC LIMIT 1',
        { snapshotId },
        (x): SpecLookupRecord => ({
          id: str(x['id']), snapshotId: str(x['snapshot_id']), lookedAt: str(x['looked_at']),
          trigger: str(x['trigger']) as SpecLookupRecord['trigger'], keys: json<string[]>(x['keys']),
          searched: json<SpecLookupRecord['searched']>(x['searched']),
          enclosingNote: x['enclosing_note'] === null ? null : (str(x['enclosing_note']) as 'found' | 'not-inside-project'),
          outcome: str(x['outcome']) as SpecLookupRecord['outcome'], reason: x['reason'] === null ? null : str(x['reason']),
        }),
      );
      if (lookup === null) return null;
      const copy = (c: Record<string, string>): SpecCopyRecord => ({ repository: c['repository'] ?? '', branch: c['branch'] ?? '', commitSha: c['commit_sha'] ?? c['commitSha'] ?? '', folder: c['folder'] ?? '' });
      const sources = all('SELECT * FROM spec_source WHERE lookup_id = :id ORDER BY rowid', { id: lookup.id }, (x): SpecSourceRecord => ({
        id: str(x['id']), key: str(x['key']), repository: str(x['repository']), branch: str(x['branch']),
        commitSha: str(x['commit_sha']), folder: str(x['folder']), ruleUsed: str(x['rule_used']) as SpecSourceRecord['ruleUsed'],
        otherCopies: json<Array<Record<string, string>>>(x['other_copies']).map(copy),
        developCopyExists: Number(x['develop_copy_exists']) === 1, matchesKey: Number(x['matches_key']) === 1,
      }));
      const documents = all('SELECT * FROM spec_document WHERE lookup_id = :id ORDER BY rowid', { id: lookup.id }, toSpecDocument);
      return { lookup, sources, documents };
    },

    readSpecDocument(documentId) {
      return one(
        `SELECT d.*, l.snapshot_id AS snapshot_id FROM spec_document d JOIN spec_lookup l ON l.id = d.lookup_id WHERE d.id = :id`,
        { id: documentId },
        (x) => ({ ...toSpecDocument(x), snapshotId: str(x['snapshot_id']), lookupId: str(x['lookup_id']) }),
      );
    },

    readLatestSpecAlignmentRun(snapshotId) {
      const head = one('SELECT * FROM spec_alignment_run WHERE snapshot_id = :snapshotId ORDER BY finished_at DESC, rowid DESC LIMIT 1', { snapshotId }, (x) => x);
      if (head === null) return null;
      const id = str(head['id']);
      const opt = (v: unknown): string | null => (v === null ? null : str(v));
      return {
        id, snapshotId: str(head['snapshot_id']), lookupId: str(head['lookup_id']), specDocumentId: str(head['spec_document_id']),
        tddDocumentId: opt(head['tdd_document_id']), requestedAt: str(head['requested_at']), finishedAt: str(head['finished_at']),
        provider: str(head['provider']), contextVersion: opt(head['context_version']),
        outcome: str(head['outcome']) as SpecAlignmentRunRecord['outcome'],
        cancelReason: opt(head['cancel_reason']) as SpecAlignmentRunRecord['cancelReason'], failureReason: opt(head['failure_reason']),
        specSummary: opt(head['spec_summary']), tddSummary: opt(head['tdd_summary']),
        verdict: opt(head['verdict']) as SpecAlignmentRunRecord['verdict'], verdictText: opt(head['verdict_text']),
        leftOut: json<SpecAlignmentRunRecord['leftOut']>(head['left_out']),
        restrictionsNotEnforced: json<string[]>(head['restrictions_not_enforced']), warning: opt(head['warning']),
        rows: all('SELECT * FROM spec_alignment_row WHERE run_id = :id ORDER BY ordinal', { id }, (x): SpecAlignmentRowRecord => ({
          ordinal: Number(x['ordinal']), criterionRef: opt(x['criterion_ref']), criterionText: str(x['criterion_text']),
          implementationState: str(x['implementation_state']) as SpecAlignmentRowRecord['implementationState'],
          testShown: str(x['test_shown']) as SpecAlignmentRowRecord['testShown'], testMismatch: Number(x['test_mismatch']) === 1,
          note: str(x['note']), unverified: Number(x['unverified']) === 1, citations: json<unknown[]>(x['citations']),
        })),
        items: all('SELECT * FROM spec_alignment_item WHERE run_id = :id ORDER BY ordinal', { id }, (x): SpecAlignmentItemRecord => ({
          ordinal: Number(x['ordinal']), kind: str(x['kind']) as SpecAlignmentItemRecord['kind'],
          rowOrdinal: x['row_ordinal'] === null ? null : Number(x['row_ordinal']), text: str(x['text']),
          unverified: Number(x['unverified']) === 1, citations: json<unknown[]>(x['citations']),
        })),
      };
    },

    appendClassOverride(o) {
      run(
        `INSERT INTO class_override (id, session_id, snapshot_id, path, class, replaced_class, calculated_class, reason,
           change_fingerprint, reviewer_handle, reviewer_name, created_at)
         VALUES (:id, :sessionId, :snapshotId, :path, :class, :replacedClass, :calculatedClass, :reason,
           :fingerprint, :handle, :name, :createdAt)`,
        {
          id: o.id,
          sessionId: o.sessionId,
          snapshotId: o.snapshotId,
          path: o.path,
          class: o.class,
          replacedClass: o.replacedClass,
          calculatedClass: o.calculatedClass,
          reason: o.reason,
          fingerprint: o.changeFingerprint,
          handle: o.reviewer?.handle ?? null,
          name: o.reviewer?.name ?? null,
          createdAt: o.createdAt,
        },
      );
    },

    readOverrideHistory(sessionId, path) {
      return all('SELECT * FROM class_override WHERE session_id = :sessionId AND path = :path ORDER BY created_at, rowid', { sessionId, path }, toOverride);
    },

    readLatestOverride(sessionId, path) {
      return one(
        'SELECT * FROM class_override WHERE session_id = :sessionId AND path = :path ORDER BY created_at DESC, rowid DESC LIMIT 1',
        { sessionId, path },
        toOverride,
      );
    },
  };

  return store;
}