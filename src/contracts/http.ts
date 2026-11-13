// Wire types of the local HTTP API (contracts/http-api.md sections 2 to 9), shared by
// src/server/ routes and the browser UI. Platform and provider ids are plain strings here:
// the registry ids live with the adapters, so no core or UI file names a platform (VO-036).

import type { AdapterDescriptor, PlatformId } from './shared.ts';
import type { RestrictionId } from './ai-provider.ts';
import type { Anchor, Comment, ReviewCapability, ReviewDecision } from './source-control-writer.ts';

export type { PlatformId } from './shared.ts';
export type { RestrictionId } from './ai-provider.ts';

/** A registered AI provider id. */
export type ProviderId = string;

// ---------------------------------------------------------------- 2. Errors

export type ErrorCode =
  | 'bad_host'
  | 'unauthenticated'
  | 'bad_origin'
  | 'invalid_request'
  | 'unknown_field'
  | 'confirmation_required'
  | 'not_found'
  | 'not_configured'
  | 'signin_required'
  | 'signin_rejected'
  | 'read_only'
  | 'workspace_unavailable'
  | 'repository_unavailable'
  | 'provider_unavailable'
  | 'not_cancellable'
  | 'platform_error'
  // Review actions (feature 005, contracts/http.md)
  | 'invalid_body'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'in_flight'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable';

/** HTTP status for each error code (http-api.md section 2). */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  bad_host: 421,
  unauthenticated: 401,
  bad_origin: 403,
  invalid_request: 400,
  unknown_field: 400,
  confirmation_required: 400,
  not_found: 404,
  not_configured: 409,
  signin_required: 409,
  signin_rejected: 422,
  read_only: 409,
  workspace_unavailable: 409,
  repository_unavailable: 409,
  provider_unavailable: 503,
  not_cancellable: 409,
  platform_error: 502,
  invalid_body: 400,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  in_flight: 409,
  rejected: 422,
  rate_limited: 429,
  unavailable: 502,
};

/** Body of every non-2xx response. */
/** `platformMessage` is the platform's own reason for a refused review action, shown as stated. */
export type ErrorBody = { error: { code: ErrorCode; message: string; platform?: PlatformId; platformMessage?: string } };

// ---------------------------------------------------------------- 3. Shared types

export type PrStatus = 'open' | 'closed' | 'merged';
export type CompletenessStatus = 'found' | 'missing' | 'stale';
export type EvidenceKind = 'coverage' | 'sonar' | 'spec' | 'issue' | 'lint' | 'custom';
export type EvidenceStatus = 'current' | 'stale' | 'missing';

export type ClaimLabel = 'evidence' | 'inference';
export type Category = 'what' | 'why' | 'how' | 'whatif' | 'risk' | 'requirement';
/** Default 'technical' (FR-048). */
export type AnswerFor = 'technical' | 'business';
/** 'head' = new side, 'base' = old side of the diff. */
export type Side = 'head' | 'base';

export type Scope =
  | { type: 'pr' }
  | { type: 'file'; path: string }
  /** A "method" scope is a range with a label (FR-013). */
  | { type: 'range'; path: string; side: Side; startLine: number; endLine: number; label?: string };

export type ScopeType = Scope['type'];

/** `resolved` is set by the workbench, not the provider (R13). */
export type Ref =
  | { kind: 'code'; path: string; side: Side; startLine: number; endLine: number; resolved: boolean; unresolvedReason?: string }
  | { kind: 'issue'; platform: PlatformId; key: string; resolved: boolean; unresolvedReason?: string }
  /** The PR description of the snapshot's session; resolves when it is non-empty. */
  | { kind: 'pr'; resolved: boolean; unresolvedReason?: string };

export type Intent = 'documented' | 'inferred';

export type Claim = {
  text: string;
  /** Final label after the workbench's check. */
  label: ClaimLabel;
  /** What the provider asked for; differs when downgraded (FR-018). */
  labelledByProvider: ClaimLabel;
  /** On claims about what the change is for (R13); 'documented' only with a resolved issue or pr ref (FR-017). */
  intent?: Intent;
  intentByProvider?: Intent;
  refs: Ref[];
};

/** "<headCommit>:<sha256 hex of the data block without nonce>" (R14). */
export type ContextVersion = string;

/** FR-049; 'prompt limit' is the spec's literal reason. */
export type SkipReason = 'binary' | 'file-too-large' | 'too-many-changed-lines' | 'prompt limit';
export type SkippedFile = { path: string; reason: SkipReason };

// ---------------------------------------------------------------- 4. Configuration and sign-in

export type ConfigLimits = { maxFileBytes: number; maxChangedLines: number; maxPromptChars: number };

/** Never holds a credential (FR-039). Unknown fields are refused with `unknown_field`. */
export type Config = {
  /** The folder holding the clones, and the source-control platform they belong to. */
  workspace: { baseFolder: string; platform: PlatformId; baseUrl?: string };
  /** `site` and `projectKeys` apply to project-key trackers. */
  issueTracker: { platform: PlatformId; site?: string; projectKeys?: string[] };
  /** Defaults 1048576, 5000, 400000. */
  limits: ConfigLimits;
  /** Default 7. */
  logRetentionDays: number;
};

/** Body of `PUT /api/config`: `limits` (and each of its keys) and `logRetentionDays` take defaults. */
export type ConfigBody = {
  workspace: Config['workspace'];
  issueTracker: Config['issueTracker'];
  limits?: Partial<ConfigLimits>;
  logRetentionDays?: number;
};

export type Platforms = {
  sourceControl: PlatformId[];
  issueTrackers: PlatformId[];
  ai: ProviderId[];
  /** Display name and sign-in fields per platform, so the UI renders forms without naming platforms. */
  descriptors: AdapterDescriptor[];
};

export type SignInState = 'signed-in' | 'signed-out' | 'expired';

/** No secret, token or Authorization value ever appears in a response (FR-028). */
export type SignIn = { platform: PlatformId; state: SignInState; account?: string };

/** Body of `PUT /api/signins/:platform`. `account` is the email or user name where the platform needs one. */
export type SignInBody = { account?: string; secret: string; /** 'write' records that the token may post review actions (feature 005). */ scope?: 'read' | 'write' };

export type ProviderStatus = {
  id: ProviderId;
  installed: boolean;
  /** False when not installed, not signed in, or restriction (c) or (d) is unenforced. */
  available: boolean;
  unavailableReason?: string;
  restrictionsNotEnforced: RestrictionId[];
};

/** Body of `POST /api/auth`. */
export type AuthBody = { token: string };

// ---------------------------------------------------------------- 5. Pull requests and sessions

export type DiscoveryState = 'idle' | 'scanning' | 'complete' | 'cancelled' | 'failed';

export type Workspace = {
  baseFolder: string;
  platform: PlatformId;
  baseUrl?: string;
  /** `reason` when the state is 'failed'. */
  discovery: { state: DiscoveryState; foldersScanned: number; reason?: string };
  /** One per platform repository id; `folder` is absolute. */
  matched: { repository: string; folder: string; duplicateFolders: string[] }[];
  skipped: { folder: string; reason: 'no-remote' | 'no-matching-remote' | 'remotes-unreadable'; detail?: string }[];
};

export type PullSummary = {
  /** The platform repository id this pull request belongs to. */
  repository: string;
  number: number;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  /** ISO 8601. */
  updatedAt: string;
  /** True when the signed-in reviewer has approved this pull request and it is not yet merged. */
  approvedByMe?: boolean;
  /** Present when a session exists. */
  sessionId?: string;
  /** The pull request's head commit on the platform (may be abbreviated on Bitbucket list rows). */
  headCommit?: string;
  /** The pull request's page on the platform, opened in a new browser tab. */
  webUrl?: string;
};

export type PullGroup = {
  repository: string;
  status: 'loaded' | 'failed';
  /** When 'failed'. */
  reason?: string;
  /** Empty when 'failed'. */
  pulls: PullSummary[];
  /** Set when the signed-in reviewer's approvals could not be checked, so approved pull requests may be listed as to review. */
  approvalsNote?: string;
  /** ISO 8601. Set only when this group is the last known list, served before a fresh one loads. */
  cachedAt?: string;
};

export type SessionSummary = {
  sessionId: string;
  platform: PlatformId;
  repository: string;
  prNumber: number;
  title: string;
  prStatus: PrStatus;
  readOnly: boolean;
  /** e.g. "reopened on platform", "deleted on platform" (FR-041, EC-03). */
  statusNote?: string;
  latestHeadCommit: string;
  createdAt: string;
  lastOpenedAt: string;
  /** False when no clone is found under the base folder (FR-057). */
  repositoryAvailable: boolean;
  repositoryReason?: string;
  /** The pull request's page on the platform, opened in a new browser tab. */
  webUrl?: string;
  /** The highest risk class of any file in the latest snapshot; absent until the files are classified. */
  highestRisk?: RiskClass;
};

export type IssueOrigin = 'branch' | 'title' | 'description';

export type IssueReference = {
  platform: PlatformId;
  key: string;
  /** A `#123` that is a PR is shown as a PR reference (FR-003). */
  kind: 'issue' | 'pull-request';
  /** Every place it was found, de-duplicated by (platform, key). */
  origins: IssueOrigin[];
  /** found | missing (unresolved) | stale (last re-fetch failed). */
  status: CompletenessStatus;
  reason?: string;
  /** Plain text (FR-004). */
  title?: string;
  descriptionText?: string;
  evidence?: { kind: 'issue'; status: EvidenceStatus; capturedAt: string; commit: string };
};

/** Only these three sources in this feature (FR-007). */
export type CompletenessRow =
  | { source: 'pr'; status: CompletenessStatus; reason?: string }
  | { source: 'repository'; status: 'found' | 'missing'; reason?: string; skippedFiles: SkippedFile[] }
  /** 'missing' when there is no reference; otherwise each issue carries its own status. */
  | { source: 'issue'; status: CompletenessStatus; reason?: string; issues: IssueReference[] }
  | { source: 'specification'; status: CompletenessStatus; reason?: string }
  | { source: 'tdd-evidence'; status: CompletenessStatus; reason?: string };

export type DiffSource = 'local' | 'platform';

export type SnapshotSummary = {
  snapshotId: string;
  headCommit: string;
  baseCommit?: string;
  diffSource: DiffSource;
  diffFingerprint: string;
  takenAt: string;
};

export type SessionDetail = SessionSummary & {
  author: string;
  /** Shown as text, never HTML. */
  description: string;
  sourceBranch: string;
  targetBranch: string;
  /** Last checked; absent if the check failed. */
  platformHeadCommit?: string;
  /** Platform head differs from the latest snapshot: PR row stale, refresh offered. */
  headMoved: boolean;
  workspaceReady: boolean;
  completeness: CompletenessRow[];
  issues: IssueReference[];
  /** Oldest first; the last is the latest. */
  snapshots: SnapshotSummary[];
};

/** Body of `POST /api/sessions`. */
export type CreateSessionBody = { repository: string; prNumber: number };

/** Body of `DELETE /api/sessions/:sessionId`. */
export type DeleteSessionBody = { confirm: true };

// ---------------------------------------------------------------- 6. Snapshots, diff and code

export type CommitSummary = { sha: string; message: string; author: string; authoredAt: string };

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  linesAdded: number;
  linesRemoved: number;
  binary: boolean;
  language?: string;
  skipped?: SkipReason;
};

export type SnapshotDetail = SnapshotSummary & {
  commits: CommitSummary[];
  /** In diff order. */
  files: ChangedFile[];
  skippedFiles: SkippedFile[];
};

export type DiffLineType = 'context' | 'add' | 'remove';
export type DiffLine = { type: DiffLineType; oldLine?: number; newLine?: number; text: string };
export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] };

/** One changed file's diff with its status and counts (FR-033); a binary file has no hunks. */
export type FileDiff = {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  linesAdded: number;
  linesRemoved: number;
  binary: boolean;
  hunks: DiffHunk[];
};

export type FileContent = { path: string; side: Side; commit: string; lines: string[] };

// ---------------------------------------------------------------- 7. Summaries

/** failed: provider error, kept with its reason (FR-032). */
export type GenerationState = 'queued' | 'in_progress' | 'completed' | 'cancelled' | 'failed';

export type GenerationWarning = 'unstructured' | 'cancelled';

export type FileClaims = { path: string; claims: Claim[] };

export type Summary = {
  summaryId: string;
  snapshotId: string;
  headCommit: string;
  state: GenerationState;
  /** While in_progress: streamed, not yet checked. */
  rawText?: string;
  prSummary: Claim[];
  files: FileClaims[];
  functionalImpact: Claim[];
  technicalImpact: Claim[];
  skippedFiles: SkippedFile[];
  warning?: GenerationWarning;
  /** Set when `failed`: the provider's error, shown as a gap (FR-032). */
  failureReason?: string;
  provider: ProviderId;
  contextVersion: ContextVersion;
  createdAt: string;
  completedAt?: string;
  restrictionsNotEnforced: RestrictionId[];
};

// ---------------------------------------------------------------- 8. Interrogation

/** One fixed template from `GET /api/suggestions` (FR-015). */
export type Suggestion = { text: string; category: Category };

export type AskBody = {
  scope: Scope;
  category: Category;
  text: string;
  /** Default 'technical'. */
  answerFor?: AnswerFor;
  /** Set when started from a suggested follow-up (FR-047, FR-050). */
  followsQuestionId?: string;
};

export type Answer = {
  /** in_progress: streamed, not yet checked (FR-021). */
  rawText?: string;
  claims: Claim[];
  /** FR-046. */
  unsupportedAssumptions: string[];
  /** FR-047. */
  suggestedFollowUps: string[];
  /** FR-019, FR-045: all claims shown as inference. */
  warning?: GenerationWarning;
  /** Set when `failed`: the provider's error, shown as a gap (FR-032). */
  failureReason?: string;
  /** FR-020, shown with every answer. */
  provider: ProviderId;
  contextVersion: ContextVersion;
  completedAt?: string;
  /** FR-022: each named in the UI. */
  restrictionsNotEnforced: RestrictionId[];
};

export type Question = {
  questionId: string;
  sessionId: string;
  snapshotId: string;
  headCommit: string;
  /** false: shown marked with its older head commit (FR-051). */
  isLatestSnapshot: boolean;
  scope: Scope;
  category: Category;
  text: string;
  answerFor: AnswerFor;
  followsQuestionId?: string;
  state: GenerationState;
  askedAt: string;
  answer?: Answer;
};

// ---------------------------------------------------------------- 9. Session event stream

export type SessionEventData = {
  prStatus: PrStatus;
  readOnly: boolean;
  headMoved: boolean;
  completeness: CompletenessRow[];
};

export type AnswerDeltaEventData = { questionId: string; text: string };
export type SummaryDeltaEventData = { summaryId: string; text: string };

/** `Question` without `answer.rawText`. */
export type QuestionEventData = Omit<Question, 'answer'> & { answer?: Omit<Answer, 'rawText'> };
/** `Summary` without `rawText`. */
export type SummaryEventData = Omit<Summary, 'rawText'>;

/** Payload of each `event:` name on `GET /api/sessions/:sessionId/events`. */
export type SessionEvents = {
  session: SessionEventData;
  snapshot: SnapshotSummary;
  question: QuestionEventData;
  'answer-delta': AnswerDeltaEventData;
  summary: SummaryEventData;
  'summary-delta': SummaryDeltaEventData;
  risk: RiskEventData;
  'spec-context': SpecContextEventData;
};

export type SessionEventName = keyof SessionEvents;

export const SESSION_EVENT_NAMES: readonly SessionEventName[] = [
  'session',
  'snapshot',
  'question',
  'answer-delta',
  'summary',
  'summary-delta',
  'risk',
  'spec-context',
];

// ---------------------------------------------------------------- 10. Risk-based review focus (feature 004)
// Class names are lower case on the wire; the UI maps them to words in `labels.ts`. No type below carries
// a score, a percentage or a rank (FR-002).

export type RiskClass = 'low' | 'normal' | 'elevated' | 'critical';
export type RiskOrigin = 'rule' | 'ai' | 'override' | 'default';
export type LineRange = { side: Side; startLine: number; endLine: number };

export type RiskReason = {
  origin: 'rule' | 'ai' | 'default';
  /** Present when origin is 'rule'; never for 'ai' or 'default'. */
  ruleId?: string;
  /** The class this reason alone sets. */
  class: RiskClass;
  /** False: a sensitive rule that would have applied and was not (comment-only). */
  applied: boolean;
  matchedOn: 'path' | 'lines' | 'path+lines' | 'ai';
  /** Plain text only. */
  text: string;
  /** Empty when matchedOn is 'path'. */
  lines: LineRange[];
};

export type OverrideRecord = {
  id: string;
  path: string;
  class: RiskClass;
  replacedClass: RiskClass;
  calculatedClass: RiskClass;
  reason: string;
  createdAt: string;
  snapshotId: string;
  /** Present only when it took a Critical-calculated file below Critical. */
  reviewer?: { handle: string; displayName: string };
};

export type MechanicalKind = 'lockfile' | 'generated' | 'comment-only' | 'rename-only';

export type RiskAiFileState =
  | 'applied'
  | 'not-higher'
  | 'no-resolvable-line'
  | 'unknown-file'
  | 'no-opinion'
  | 'not-assessed'
  | 'pending'
  | 'unavailable';

export type RiskFile = {
  path: string;
  ruleClass: RiskClass;
  /** After a valid AI raise. */
  assessedClass: RiskClass;
  /** After an override that applies. */
  effectiveClass: RiskClass;
  effectiveOrigin: RiskOrigin;
  /** Candidate for reduced review; never "approved". */
  mechanical: boolean;
  mechanicalKind?: MechanicalKind;
  /** The reason the file was not fully analysed. */
  notFullyAnalysed?: string;
  /** Rule reasons first, then the AI's applied reason, in display order. */
  reasons: RiskReason[];
  ai: {
    state: RiskAiFileState;
    notAssessedReason?: string;
    proposedClass?: RiskClass;
    reasons?: string[];
    lines?: Array<LineRange & { resolved: boolean }>;
  };
  /** The latest record; applies=false means lapsed. */
  override?: { record: OverrideRecord; applies: boolean };
};

export type RiskRuleFileStatus = 'absent' | 'used' | 'partly-ignored' | 'ignored';

export type RiskReport = {
  snapshotId: string;
  headCommit: string;
  /** Changes whenever any field below can. */
  revision: number;
  ruleset: { version: string; ruleFile: RiskRuleFileStatus; notice: Array<{ entry: string; reason: string }> };
  ai: {
    state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'none';
    provider?: string;
    contextVersion?: string;
    finishedAt?: string;
    /** Why the assessment is missing or failed. */
    reason?: string;
    /** Items with applied=false and a reason. */
    ignoredCount: number;
    /** The run belongs to an older snapshot. */
    olderHead?: boolean;
  };
  /** Counts, never a score. */
  counts: Record<RiskClass, number> & { mechanical: number; notFullyAnalysed: number; overrides: number };
  /** In diff order. */
  files: RiskFile[];
  canOverride: { allowed: boolean; reason?: string };
};

export type RiskReviewer = { ok: true; handle: string; displayName: string } | { ok: false; reason: string; fix: string };

export type OverrideBody = { snapshotId: string; path: string; class: RiskClass; reason: string };
export type OverrideHistory = { records: OverrideRecord[] };

export type RiskCause = 'classified' | 'ai' | 'override';
/** The risk event carries paths and a revision, never a class. */
export type RiskEventData = { snapshotId: string; revision: number; changedPaths: string[]; cause: RiskCause };

// ---------------------------------------------------------------- 11. Review actions (feature 005)
// contracts/http.md: one POST performs one action at once; there is no preview, confirm or drafts route.

export type ReviewAction =
  | {
      kind: 'comment';
      destination: 'pull_request' | 'line' | 'reply' | 'edit' | 'delete';
      body?: string;
      anchor?: Anchor;
      threadId?: string;
      commentId?: string;
    }
  /** The message is optional (FR-003). */
  | { kind: 'approve'; body?: string }
  /** The message is required (FR-004). */
  | { kind: 'request_changes'; body: string }
  /** FR-009. */
  | { kind: 'withdraw_decision' };

/** Body of `POST /api/sessions/:sessionId/review-actions`. `requestId` is a new uuid per click; a repeat posts nothing. */
export type ReviewActionBody = {
  action: ReviewAction;
  /** The head commit the reviewer was viewing. */
  expectedHead: string;
  requestId: string;
};

export type ReviewActionRecord = { id: string; postedAt: string; headSha: string };

export type ReviewActionResult = {
  comment?: Comment;
  decision?: ReviewDecision | null;
  record: ReviewActionRecord;
};

/** Same shape as `RiskReport['canOverride']`. */
export type CanReview = { allowed: boolean; reason?: string };

/** Response of `GET /review-actions/decision`. */
export type ReviewDecisionState = {
  decision: ReviewDecision | null;
  canReview: CanReview;
  capability: ReviewCapability;
};

/** One row of `GET /review-actions/comments`. */
export type ReviewCommentItem = Comment & { editable: boolean };
export type ReviewComments = { comments: ReviewCommentItem[] };

// --- Spec context (specs/006-spec-context, contracts/http-api.md) ---

export type SpecDocumentKind = 'specification' | 'tdd-evidence';
export type SpecDocumentStatus = 'found' | 'missing' | 'stale';
export type SpecRule = 'own-repository-first' | 'matching-branch-over-develop' | 'most-recent-commit' | 'only-candidate';

export type SpecCopy = {
  repository: string;
  branch: string;
  commit: string;
  folder: string;
};

export type SpecSource = {
  /** The issue key that matched, as written on the pull request. */
  key: string;
  used: SpecCopy;
  rule: SpecRule;
  others: SpecCopy[];
};

export type SpecDocument = {
  documentId: string;
  kind: SpecDocumentKind;
  status: SpecDocumentStatus;
  fileName?: string;
  otherSpecFiles: string[];
  source?: SpecSource;
  sha256?: string;
  reason?: string;
};

export type SpecKeyResult = {
  key: string;
  /** One 'specification' and one 'tdd-evidence', in that order. */
  documents: SpecDocument[];
};

export type SpecLookupGap =
  | { kind: 'no-key'; message: string }
  | { kind: 'no-enclosing-repository'; message: string }
  | { kind: 'read-failed'; message: string };

/** The only label on assessment statements (FR-014); never 'verified'. */
export type SpecState = 'inferred';
export type CitationStatus = 'resolved' | 'unverified';

export type SpecCitation =
  | { type: 'spec' | 'tdd'; documentId: string; startLine: number; endLine: number; quote?: string }
  | { type: 'code'; path: string; side: 'head' | 'base'; startLine: number; endLine: number };

export type SpecStatement = {
  label: 'Inferred';
  /** Plain text only. */
  text: string;
  citations: SpecCitation[];
  citationStatus: CitationStatus;
};

export type ImplementationState =
  | 'Implementation and test identified'
  | 'Implementation identified'
  | 'Requires verification'
  | 'Not found';

/** 'no-evidence-available' when tdd-evidence.md is missing, never 'no-test-shown' (US4-AS2). */
export type TestEvidence = 'test-shown' | 'no-test-shown' | 'no-evidence-available';

export type AlignmentRow = {
  criterionId: string;
  criterion: string;
  state: ImplementationState;
  test: TestEvidence;
  testMismatch: boolean;
  statement: SpecStatement;
};

export type SufficiencyVerdict = {
  outcome: 'sufficient' | 'incomplete' | 'cannot-judge';
  statement: SpecStatement;
  uncovered: string[];
  mismatched: SpecStatement[];
  notJudged?: string;
};

export type ScopeDeviations = {
  implementedNotRequested: SpecStatement[];
  requestedNotImplemented: SpecStatement[];
  noneFound: boolean;
};

export type SpecAlignment = {
  runId: string;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  provider?: string;
  contextVersion?: string;
  finishedAt?: string;
  headCommit: string;
  stale: boolean;
  staleReason?: string;
  reason?: string;
  leftOut: string[];
  summaries?: { specification?: string; tddEvidence?: string };
  rows: AlignmentRow[];
  verdict?: SufficiencyVerdict;
  deviations?: ScopeDeviations;
  warning?: 'unparseable-output';
};

/** Response of `GET /api/sessions/:sessionId/snapshots/:snapshotId/spec-context`. No score or percentage (FR-015). */
export type SpecContextReport = {
  snapshotId: string;
  headCommit: string;
  /** Changes whenever any other field can. */
  revision: number;
  status: 'searching' | 'ready' | 'none' | 'failed';
  searched: Array<{ repository: string; branches: string[] }>;
  gaps: SpecLookupGap[];
  keys: SpecKeyResult[];
  stale: boolean;
  staleReason?: string;
  alignment?: SpecAlignment;
  canRetry: { allowed: boolean; reason?: string };
};

/** Response of `POST .../spec-context/retry` (202). */
export type SpecContextRetryResult = { runId: string };

/** Data of the SSE event `spec-context`; carries no document text. */
export type SpecContextEventData = {
  snapshotId: string;
  revision: number;
  cause: 'lookup' | 'documents' | 'alignment' | 'stale';
};
