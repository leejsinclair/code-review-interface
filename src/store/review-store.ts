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
}

// ---------------------------------------------------------------------------
// Row mapping

type Row = Record<string, SQLInputValue>;

const str = (value: unknown): string => String(value);
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const bool = (value: unknown): boolean => Number(value) === 1;
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
  };

  return store;
}
