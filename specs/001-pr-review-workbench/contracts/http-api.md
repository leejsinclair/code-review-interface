# Contract: Local HTTP API

The browser UI and the end-to-end tests code against this API. It is served by `src/server/` on `127.0.0.1` at a random free port (research R2, R3). All bodies are JSON (`Content-Type: application/json`) unless stated. No route changes state on a GET (X.5). No route writes to any platform (FR-027).

Values in `code` font that appear in the spec's Verbatim Constraints are copied exactly and must not be renamed:

| Concept | Stored / wire values |
|---|---|
| Claim label | `evidence`, `inference` (display `Evidence`, `Inference`) |
| Question category | `what`, `why`, `how`, `whatif`, `risk`, `requirement` (display `What`, `Why`, `How`, `What-if`, `Risk`, `Requirements`) |
| Question scope type | `pr`, `file`, `range` |
| Evidence kind | `coverage`, `sonar`, `spec`, `issue`, `lint`, `custom` (this feature writes only `issue`) |
| Evidence status | `current`, `stale`, `missing` |
| Context completeness status | `found`, `missing`, `stale` |
| AI provider id | `claude-code-cli` |
| Missing Jira access reason | `no Jira access configured` |

## 1. Authentication and request guard (X.1 to X.5)

| Rule | Behaviour on failure |
|---|---|
| `Host` header equals `127.0.0.1:<port>` on every request | `421` `bad_host` |
| Cookie `prwb_session` equals the launch token (constant-time compare), on every route except `GET /launch`, `GET /launch.js`, `POST /api/auth` | `401` `unauthenticated` |
| `Origin` header, when present, equals `http://127.0.0.1:<port>` on every request of any method (X.3); every non-GET request must carry it (X.5) | `403` `bad_origin` |

Every response carries:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

and never any `Access-Control-*` header.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/launch` | URL fragment `#<token>` (never sent to the server) | static HTML |
| GET | `/launch.js` | | static script: POSTs the fragment to `/api/auth`, clears it from history, navigates to `/` |
| POST | `/api/auth` | `{ "token": string }` | `204`, `Set-Cookie: prwb_session=<token>; HttpOnly; SameSite=Strict; Path=/`. Wrong token: `401` `unauthenticated` |
| GET | `/`, `/app.js`, `/app.css` | | the bundled UI (`dist/ui/`) |

## 2. Errors

Every non-2xx response has the body:

```ts
type ErrorBody = { error: { code: ErrorCode; message: string; platform?: PlatformId } };
```

| `code` | Status | Meaning |
|---|---|---|
| `bad_host` | 421 | Host check failed |
| `unauthenticated` | 401 | missing or wrong launch-token cookie |
| `bad_origin` | 403 | Origin check failed: a foreign `Origin` on any request, or none on a non-GET |
| `invalid_request` | 400 | body or query fails validation at the boundary |
| `unknown_field` | 400 | config body has a field the schema does not know (R4) |
| `confirmation_required` | 400 | session delete without `confirm: true` |
| `not_found` | 404 | no such session, snapshot, question, file or route |
| `not_configured` | 409 | no repository configured yet |
| `signin_required` | 409 | the named `platform` has no credential, or its credential was rejected or expired (FR-040) |
| `signin_rejected` | 422 | the read-only sign-in check rejected the submitted credential |
| `read_only` | 409 | the session's PR is closed or merged (FR-041) |
| `workspace_unavailable` | 409 | no isolated workspace for the latest snapshot (no matching clone or fetch failed); `message` is the repository row's reason |
| `provider_unavailable` | 503 | AI provider not installed, not signed in, or restriction (c) or (d) not enforceable (FR-022) |
| `not_cancellable` | 409 | question already completed or cancelled |
| `platform_error` | 502 | the platform could not be reached and the request cannot proceed without it (only `GET /api/pulls` and `POST /api/sessions`; everywhere else a platform failure is a gap, FR-032) |

## 3. Shared types

```ts
type PlatformId = 'github' | 'bitbucket-cloud' | 'github-issues' | 'jira-cloud';  // registry ids, only bridge to adapters (R19)
type ProviderId = 'claude-code-cli';

type PrStatus = 'open' | 'closed' | 'merged';
type CompletenessStatus = 'found' | 'missing' | 'stale';
type EvidenceKind = 'coverage' | 'sonar' | 'spec' | 'issue' | 'lint' | 'custom';
type EvidenceStatus = 'current' | 'stale' | 'missing';

type ClaimLabel = 'evidence' | 'inference';
type Category = 'what' | 'why' | 'how' | 'whatif' | 'risk' | 'requirement';
type AnswerFor = 'technical' | 'business';                    // default 'technical' (FR-048)
type Side = 'head' | 'base';                                  // 'head' = new side, 'base' = old side of the diff

type Scope =
  | { type: 'pr' }
  | { type: 'file'; path: string }
  | { type: 'range'; path: string; side: Side; startLine: number; endLine: number; label?: string };  // "method" scope = range + label (FR-013)

type Ref =
  | { kind: 'code'; path: string; side: Side; startLine: number; endLine: number;
      resolved: boolean; unresolvedReason?: string }          // resolved is set by the workbench (R13)
  | { kind: 'issue'; platform: PlatformId; key: string;
      resolved: boolean; unresolvedReason?: string }
  | { kind: 'pr';                                             // the PR description of the snapshot's session
      resolved: boolean; unresolvedReason?: string };         // resolves when the PR has a non-empty description

type Intent = 'documented' | 'inferred';

type Claim = {
  text: string;
  label: ClaimLabel;                                          // final label after the workbench's check
  labelledByProvider: ClaimLabel;                             // what the provider asked for; differs when downgraded (FR-018)
  intent?: Intent;                                            // present on claims about what the change is for (R13).
                                                              // Final value: 'documented' only when a resolved ref has kind
                                                              // 'issue' or 'pr'; any other claim the provider marked
                                                              // 'documented' is returned as 'inferred'
  intentByProvider?: Intent;                                  // what the provider asked for; differs when downgraded
  refs: Ref[];
};
// The UI groups claims with intent 'documented' apart from claims with intent 'inferred' (FR-017).

type RestrictionId =
  | 'workspace-read-search-tools-only'                        // FR-022 (a)
  | 'no-reads-outside-workspace'                              // FR-022 (b)
  | 'no-network-tools'                                        // FR-022 (c)  blocking
  | 'no-repository-configuration'                             // FR-022 (d)  blocking
  | 'untrusted-input-delimited';                              // FR-022 (e)

type ContextVersion = string;                                 // "<headCommit>:<sha256 hex of the data block without nonce>" (R14)

type SkipReason = 'binary' | 'file-too-large' | 'too-many-changed-lines' | 'prompt limit';  // FR-049; 'prompt limit' is the spec's literal reason
type SkippedFile = { path: string; reason: SkipReason };
```

## 4. Configuration and sign-in

```ts
type Config = {
  repository: { platform: PlatformId; id: string; clonePath: string };    // id: "owner/repo" or "workspace/repo"
  issueTracker: { platform: PlatformId; site?: string; projectKeys?: string[] };  // site and projectKeys for jira-cloud
  limits: { maxFileBytes: number; maxChangedLines: number; maxPromptChars: number };  // defaults 1048576, 5000, 400000
};
```

The config never holds a credential (FR-039). Unknown fields are refused with `unknown_field`.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/config` | | `200 Config`, or `200 null` before set-up |
| PUT | `/api/config` | `Config` (`limits` optional; missing values take defaults) | `200 Config` |
| GET | `/api/platforms` | | `200 { sourceControl: PlatformId[]; issueTrackers: PlatformId[]; ai: ProviderId[] }` |
| GET | `/api/signins` | | `200 SignIn[]`, one per configured platform |
| PUT | `/api/signins/:platform` | `{ account?: string; secret: string }` (`account` = email for `bitbucket-cloud` and `jira-cloud`; absent for `github`) | `200 SignIn` after a passing read-only check; `422 signin_rejected` otherwise. The secret is stored only in the OS keychain and never returned |
| GET | `/api/provider` | | `200 ProviderStatus` |

```ts
type SignIn = { platform: PlatformId; state: 'signed-in' | 'signed-out' | 'expired'; account?: string };
// No secret, token or Authorization value ever appears in any response (FR-028).

type ProviderStatus = {
  id: ProviderId;
  installed: boolean;
  available: boolean;                                         // false when not installed, not signed in, or (c)/(d) unenforced
  unavailableReason?: string;
  restrictionsNotEnforced: RestrictionId[];
};
```

Bitbucket Cloud sign-in takes an Atlassian account email and API token; app passwords are not offered (FR-040).

## 5. Pull requests and sessions

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/pulls` | | `200 PullSummary[]` (open PRs of the configured repository, FR-001) |
| GET | `/api/sessions` | | `200 SessionSummary[]`, including closed and merged PRs (FR-041) |
| POST | `/api/sessions` | `{ prNumber: number }` | `201 SessionDetail` when created (first snapshot taken, summaries queued); `200 SessionDetail` when a session already exists for the repository and PR (FR-006) — the existing session is opened as by `/open`, no new snapshot |
| GET | `/api/sessions/:sessionId` | | `200 SessionDetail` from the store; no platform call |
| POST | `/api/sessions/:sessionId/open` | | `200 SessionDetail`. Checks the platform's PR head and status (FR-052), recreates the isolated workspace for the latest snapshot if the PR is open and the head is present in the clone. Never takes a snapshot |
| POST | `/api/sessions/:sessionId/refresh` | | `200 SessionDetail`. Re-checks head and status, re-fetches issues (FR-011), and takes a new snapshot only when the head differs from the latest snapshot or the latest snapshot's fetch failed (FR-010, FR-052); work still queued for the older snapshot is cancelled as `superseded` (FR-051); summaries for a new snapshot are queued (FR-053). Closed or merged: `409 read_only`, with the session now showing the new status |
| POST | `/api/sessions/:sessionId/close` | | `204`. Removes the isolated workspace only (FR-042) |
| DELETE | `/api/sessions/:sessionId` | `{ confirm: true }` | `204`. Removes the session, every record under it, its workspace and its `refs/prwb/<sessionId>/` refs, in one action (FR-044). Without `confirm: true`: `400 confirmation_required` |

There is no route that edits or deletes a single question, answer, summary, snapshot or Evidence record (III.2).

```ts
type PullSummary = {
  number: number; title: string; author: string;
  sourceBranch: string; targetBranch: string; updatedAt: string;   // ISO 8601
  sessionId?: string;                                              // present when a session exists
};

type SessionSummary = {
  sessionId: string;
  platform: PlatformId; repository: string; prNumber: number; title: string;
  prStatus: PrStatus; readOnly: boolean;
  statusNote?: string;                                             // e.g. "reopened on platform", "deleted on platform" (FR-041, EC-03)
  latestHeadCommit: string; createdAt: string; lastOpenedAt: string;
};

type SessionDetail = SessionSummary & {
  author: string; description: string;                             // shown as text, never HTML
  sourceBranch: string; targetBranch: string;
  platformHeadCommit?: string;                                     // last checked; absent if the check failed
  headMoved: boolean;                                              // platform head differs from latest snapshot: PR row stale, refresh offered
  workspaceReady: boolean;
  completeness: CompletenessRow[];
  issues: IssueReference[];
  snapshots: SnapshotSummary[];                                    // oldest first; last is the latest
};

type CompletenessRow =
  | { source: 'pr'; status: CompletenessStatus; reason?: string }
  | { source: 'repository'; status: 'found' | 'missing'; reason?: string; skippedFiles: SkippedFile[] }
  | { source: 'issue'; status: CompletenessStatus; reason?: string; issues: IssueReference[] };
// Only these three sources in this feature (FR-007). The issue row is 'missing' when there is no reference;
// otherwise each issue carries its own status.

type IssueReference = {
  platform: PlatformId; key: string;                               // forms: Jira keys, `#123`, `owner/repo#123`
  kind: 'issue' | 'pull-request';                                  // `#123` that is a PR is shown as a PR reference (FR-003)
  origins: ('branch' | 'title' | 'description')[];                 // every place it was found, de-duplicated by (platform, key)
  status: CompletenessStatus;                                      // found | missing (unresolved) | stale (last re-fetch failed)
  reason?: string;                                                 // e.g. `no Jira access configured`
  title?: string; descriptionText?: string;                        // plain text (FR-004)
  evidence?: { kind: 'issue'; status: EvidenceStatus; capturedAt: string; commit: string };
};

type SnapshotSummary = {
  snapshotId: string; headCommit: string; baseCommit?: string;
  diffSource: 'local' | 'platform'; diffFingerprint: string; takenAt: string;
};
```

## 6. Snapshots, diff and code

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/sessions/:sessionId/snapshots/:snapshotId` | | `200 SnapshotDetail` |
| GET | `/api/sessions/:sessionId/snapshots/:snapshotId/diff` | `?path=<file path>` | `200 FileDiff` |
| GET | `/api/sessions/:sessionId/snapshots/:snapshotId/file` | `?side=head\|base&path=<path>` | `200 FileContent` at the snapshot's head commit, or its base commit for `side=base` (FR-035). Any path, including files outside the diff. `404 not_found` when the commit is no longer in the clone |

A `code` ref opens through `/file`; an `issue` ref opens the issue's stored title and plain text from `SessionDetail.issues`; a `pr` ref opens the PR description from `SessionDetail.description` (FR-016).

```ts
type SnapshotDetail = SnapshotSummary & {
  commits: { sha: string; message: string; author: string; authoredAt: string }[];
  files: ChangedFile[];                                            // in diff order
  skippedFiles: SkippedFile[];
};

type ChangedFile = {
  path: string; previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  linesAdded: number; linesRemoved: number; binary: boolean; language?: string;
  skipped?: SkipReason;
};

type FileDiff = {
  path: string; binary: boolean;
  hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number;
           lines: { type: 'context' | 'add' | 'remove'; oldLine?: number; newLine?: number; text: string }[] }[];
};

type FileContent = { path: string; side: Side; commit: string; lines: string[] };
```

## 7. Summaries

| Method | Path | Response |
|---|---|---|
| GET | `/api/sessions/:sessionId/snapshots/:snapshotId/summaries` | `200 Summary[]`, every generation for that snapshot, newest last (FR-012) |

Summaries are generated automatically when a snapshot is taken (FR-053); there is no route to start one. Without an isolated workspace for the snapshot, no summary run is queued and the summaries panel shows the repository row's reason (FR-005).

```ts
type GenerationState = 'queued' | 'in_progress' | 'completed' | 'cancelled' | 'failed';   // failed: provider error, kept with its reason (FR-032)

type Summary = {
  summaryId: string; snapshotId: string; headCommit: string;
  state: GenerationState;
  rawText?: string;                                                // while in_progress: streamed, not yet checked
  prSummary: Claim[]; files: { path: string; claims: Claim[] }[];
  functionalImpact: Claim[]; technicalImpact: Claim[];
  skippedFiles: SkippedFile[];
  warning?: 'unstructured' | 'cancelled';
  provider: ProviderId; contextVersion: ContextVersion; createdAt: string; completedAt?: string;
  restrictionsNotEnforced: RestrictionId[];
};
```

## 8. Interrogation

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/suggestions` | `?scope=pr\|file\|range&category=<Category>` | `200 { text: string; category: Category }[]` fixed templates (FR-015) |
| GET | `/api/sessions/:sessionId/questions` | | `200 Question[]`, every snapshot, in asked order |
| POST | `/api/sessions/:sessionId/questions` | `AskBody` | `202 Question` (state `queued` or `in_progress`). Always applies to the latest snapshot (FR-051). Errors: `read_only`, `workspace_unavailable`, `provider_unavailable`, `invalid_request` |
| POST | `/api/sessions/:sessionId/questions/:questionId/cancel` | | `202 Question` (state `cancelled`). `409 not_cancellable` when already final |

```ts
type AskBody = {
  scope: Scope;
  category: Category;
  text: string;
  answerFor?: AnswerFor;                                           // default 'technical'
  followsQuestionId?: string;                                      // set when started from a suggested follow-up (FR-047, FR-050)
};

type Question = {
  questionId: string; sessionId: string; snapshotId: string; headCommit: string;
  isLatestSnapshot: boolean;                                       // false: shown marked with its older head commit (FR-051)
  scope: Scope; category: Category; text: string; answerFor: AnswerFor;
  followsQuestionId?: string;
  state: GenerationState;
  askedAt: string;
  answer?: Answer;
};

type Answer = {
  rawText?: string;                                                // in_progress: streamed, not yet checked (FR-021)
  claims: Claim[];
  unsupportedAssumptions: string[];                                // FR-046
  suggestedFollowUps: string[];                                    // FR-047
  warning?: 'unstructured' | 'cancelled';                          // FR-019, FR-045: all claims shown as inference
  provider: ProviderId; contextVersion: ContextVersion;            // FR-020, shown with every answer
  completedAt?: string;
  restrictionsNotEnforced: RestrictionId[];                        // FR-022: each named in the UI
};
```

The stored prompt is kept in the store with the question (FR-020) and is not returned by the API.

## 9. Session event stream

`GET /api/sessions/:sessionId/events` returns `text/event-stream` (one stream per open session; `EventSource` sends the cookie). It only reports progress; all work starts with a POST.

| `event:` | `data:` |
|---|---|
| `session` | `{ prStatus: PrStatus; readOnly: boolean; headMoved: boolean; completeness: CompletenessRow[] }` |
| `snapshot` | `SnapshotSummary` (a new snapshot was taken) |
| `question` | `Question` without `answer.rawText` (queued, started, completed or cancelled) |
| `answer-delta` | `{ questionId: string; text: string }` raw text to append |
| `summary` | `Summary` without `rawText` (queued, started, completed or cancelled) |
| `summary-delta` | `{ summaryId: string; text: string }` |

On reconnect the client re-reads `GET /api/sessions/:sessionId/questions` and the latest snapshot's summaries.
