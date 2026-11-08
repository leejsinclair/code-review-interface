// Wire types of the local HTTP API (contracts/http-api.md sections 2 to 9), shared by
// src/server/ routes and the browser UI. Platform and provider ids are plain strings here:
// the registry ids live with the adapters, so no core or UI file names a platform (VO-036).

import type { AdapterDescriptor, PlatformId } from './shared.ts';
import type { RestrictionId } from './ai-provider.ts';

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
  | 'provider_unavailable'
  | 'not_cancellable'
  | 'platform_error';

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
  provider_unavailable: 503,
  not_cancellable: 409,
  platform_error: 502,
};

/** Body of every non-2xx response. */
export type ErrorBody = { error: { code: ErrorCode; message: string; platform?: PlatformId } };

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
  /** `id`: the platform's path form, e.g. "owner/repo" or "workspace/repo". */
  repository: { platform: PlatformId; id: string; clonePath: string };
  /** `site` and `projectKeys` apply to project-key trackers. */
  issueTracker: { platform: PlatformId; site?: string; projectKeys?: string[] };
  /** Defaults 1048576, 5000, 400000. */
  limits: ConfigLimits;
  /** Default 7. */
  logRetentionDays: number;
};

/** Body of `PUT /api/config`: `limits` (and each of its keys) and `logRetentionDays` take defaults. */
export type ConfigBody = {
  repository: Config['repository'];
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
export type SignInBody = { account?: string; secret: string };

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

export type PullSummary = {
  number: number;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  /** ISO 8601. */
  updatedAt: string;
  /** Present when a session exists. */
  sessionId?: string;
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
  | { source: 'issue'; status: CompletenessStatus; reason?: string; issues: IssueReference[] };

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
export type CreateSessionBody = { prNumber: number };

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
};

export type SessionEventName = keyof SessionEvents;

export const SESSION_EVENT_NAMES: readonly SessionEventName[] = [
  'session',
  'snapshot',
  'question',
  'answer-delta',
  'summary',
  'summary-delta',
];
