# Data Model: PR Context and Interrogation

**Feature**: `001-pr-review-workbench` | **Date**: 2026-11-07
**Inputs**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), `docs/domain_knowledge/CONTEXT.md`

This feature is the first code in the repository, so every entity here is new. Terms follow `CONTEXT.md`. Stored enum values follow the spec's Verbatim Constraints exactly.

## Overview

```text
Configuration (config.json)          Credential entry (OS keychain, one per platform)
        |
Review session ──1:1── Session status (the only mutable row)
   |
   ├── PR snapshot (1..n, append-only, ordered by seq)
   │      ├── Commit (0..n)
   │      ├── Changed file (0..n, diff order)
   │      ├── Issue reference (0..n, one per platform + key, with its origins)
   │      └── Summary run (0..n)
   │             ├── Stored prompt (0..1)
   │             ├── Stream chunk (0..n)
   │             └── Summary (0..1, terminal) ── Summary section (0..n) ── Claim ── Reference
   │
   ├── Evidence (0..n, kind = issue in this feature; payload = Issue)
   │
   └── Question (0..n, each against one snapshot; may follow another Question)
          ├── Stored prompt (0..1)
          ├── Stream chunk (0..n)
          └── Answer (0..1, terminal) ── Claim ── Reference

Not stored in the review store, derived or transient:
  Context completeness (derived), Isolated workspace (filesystem), App-owned refs (local clone),
  Provider capabilities (in memory), Work lanes (in memory), Log record (log files)
```

Storage is `node:sqlite` (research R5). Table names are the snake_case of the entity names; fields are shown here by their logical camelCase names. Identifiers are random UUIDs (lower-case, hyphenated), which are also valid git ref components because they appear in app-owned ref names. Timestamps are ISO 8601 in UTC.

## Shared value types

These shapes are reused across entities. They carry the platform with every identifier so that later features can group across PRs (FR-026).

| Type | Fields | Rules |
|---|---|---|
| `PlatformId` | string | A registry id, such as `github`, `bitbucket-cloud`, `github-issues`, `jira-cloud`. Only `src/adapters/registry.ts` maps it to an adapter; core never branches on it (VIII.2). |
| `RepoRef` | `platform: PlatformId`, `identifier: string` | `identifier` is the platform's path form (`owner/repo`, `workspace/repo`), case-folded for comparison. |
| `PrRef` | `repo: RepoRef`, `number: integer` | `number` > 0. |
| `BranchRef` | `repo: RepoRef`, `name: string` | For a fork PR, `repo` is the fork. |
| `IssueKey` | `platform: PlatformId`, `key: string` | `key` as the tracker writes it (`ABC-12`, `#123`, `owner/repo#123`), stored normalised: Jira keys upper-cased, GitHub short forms expanded to `owner/repo#n`. |
| `CommitSha` | string | Full 40-character lower-case hex (or 64 for SHA-256 repositories). Abbreviated SHAs are never stored. |
| `ContextVersion` | string | `<headCommit>:<sha256 hex of the data block without its nonce>` (R14). |
| `ProviderId` | string | `claude-code-cli` is the only value in Phase 1. |

## Configuration and credentials

### Configuration (`<app-data>/config.json`)

Written by the setup screen through the API (FR-039, research R4). Not part of the review store.

| Field | Type | Rules |
|---|---|---|
| `repository` | `RepoRef` | Required. `platform` must be a registered source-control adapter. |
| `clonePath` | string | Required. Absolute path. Need not be a valid clone at save time; a mismatch shows as a missing repository row, not a save error (EC-01). Must not lie inside the app-data directory. |
| `tracker.platform` | `PlatformId` | Required. Must be a registered issue-tracker adapter. |
| `tracker.site` | string | Required for `jira-cloud` (an `https://<site>.atlassian.net` origin); absent for `github-issues`. |
| `tracker.projectKeys` | string[] | Jira only. Each matches `[A-Z][A-Z0-9]+`. May be empty, in which case a key is accepted only when lookup confirms it (FR-003). |
| `limits.maxFileBytes` | integer | Default 1,048,576. Must be > 0 (FR-049). |
| `limits.maxChangedLines` | integer | Default 5,000. Must be > 0 (FR-049). |
| `limits.maxPromptChars` | integer | Default 400,000. Must be > 0 (FR-049). |
| `logRetentionDays` | integer | Default 7. Must be ≥ 1 (FR-054). |

Validation: any field not listed is refused, so a token cannot be pasted into the file by mistake. The file holds no credentials (FR-039).

### Credential entry (OS keychain)

One entry per platform, under the service `pr-review-workbench`, read and written only by `src/credentials.ts` (FR-028, FR-040, R6).

| Field | Type | Rules |
|---|---|---|
| account (keychain account) | `PlatformId` | One entry per platform. |
| `account` | string | Atlassian account email for `bitbucket-cloud` and `jira-cloud`; GitHub login (informational) for `github`. |
| `secret` | string | Bitbucket Cloud API token, GitHub personal access token or Jira Cloud API token. Never an app password: the Bitbucket sign-in form offers none. Never returned to the API layer, logged, or passed to git or the AI provider. |

Sign-in state per platform is held in memory, not stored:

```text
SignedOut ──save + read-only check passes──▶ Valid
SignedOut ──check fails──▶ SignedOut (reason shown)
Valid ──a 401 or 403 from that platform──▶ Expired
Expired ──sign in again, check passes──▶ Valid
any ──user removes the entry──▶ SignedOut
```

An `Expired` platform asks for sign-in again and blocks nothing else (EC-13). A Jira tracker in `SignedOut` makes every Jira reference unresolved with `no Jira access configured` (FR-004).

## Review records

### Review session

The review of one PR in one repository; every other record of that review belongs to it. Immutable once created.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key. |
| `pr` | `PrRef` | Required. |
| `createdAt` | timestamp | Set once. |

Validation:

- Unique on `(pr.repo.platform, pr.repo.identifier, pr.number)`. Opening a PR that already has a session returns that session (FR-006, US1-AS6).
- A session is created only for a PR the platform reports as open, and in the same transaction as its first snapshot.

Issue references, branches and the head commit are held per snapshot, because a refresh can change them; the session's current values are those of its latest snapshot.

### Session status

The session's current-status cache. It is the only mutable row in the store, because it is a cache of the platform's state and not review history (research R5). One row per session.

| Field | Type | Rules |
|---|---|---|
| `sessionId` | UUID | Primary key, references the session. |
| `prStatus` | `open` \| `closed` \| `merged` | As last reported by the platform. A PR the platform no longer finds (deleted) is stored as `closed` with `statusNote` set (EC-03). |
| `statusNote` | string \| null | For example `deleted on platform`. |
| `lastCheckedAt` | timestamp | Time of the last head and status check. |
| `lastCheckedHead` | `CommitSha` \| null | The platform's PR head at that check. Null when the check could not reach the platform. |
| `lastCheckOutcome` | `ok` \| `unreachable` | `unreachable` makes the PR row stale (FR-007). |
| `lastCheckError` | string \| null | Reason shown for `unreachable`. |
| `lastOpenedAt` | timestamp | Updated on open. |

Validation:

- Updated only when a session is opened or refreshed; never by background polling (FR-052).
- `prStatus` may move from `open` to `closed` or `merged`, and once `closed` or `merged` it is never written back to `open` by the workbench: a PR reopened on the platform sets `statusNote` to `reopened on platform`, and the session stays read-only (FR-041). (A PR that is reopened on the platform is rare enough that Phase 1 does not resume a read-only session; see Open points.)

### PR snapshot

The fixed state of the PR at one head commit (FR-010, FR-038). Append-only.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key. |
| `sessionId` | UUID | Required. |
| `seq` | integer | 1, 2, 3 … within the session; the latest snapshot has the highest `seq`. |
| `takenAt` | timestamp | |
| `headCommit` | `CommitSha` | The platform's PR head at the time of the snapshot. |
| `title` | string | PR title at that time. |
| `description` | string | PR description as plain text (shown as text, never rendered as HTML or Markdown, research R7). |
| `author` | string | Platform display name or login. Used for display only; never aggregated (FR-031). |
| `sourceBranch` | `BranchRef` | For a fork, `repo` is the fork. |
| `targetBranch` | `BranchRef` | |
| `targetCommit` | `CommitSha` \| null | Target branch tip as fetched; null when the fetch did not happen. |
| `baseCommit` | `CommitSha` \| null | Merge-base of target and head when computed locally; null for a platform diff (FR-038). |
| `diffSource` | `local` \| `platform` | `local` exactly when `repositoryStatus` is `found`. |
| `diffFingerprint` | string | SHA-256 hex of the normalised patch (R11). |
| `repositoryStatus` | `found` \| `missing` | Outcome of clone match, fetch and head check (FR-007, FR-036). |
| `repositoryReason` | string \| null | Required when `missing`, for example `no clone at the configured path`, `no remote of the clone points at the configured repository`, `fetch failed: <reason>`, `fetched head does not match the PR`. |
| `headRef` | string \| null | `refs/prwb/<sessionId>/<snapshotId>/head` when fetched. |
| `targetRef` | string \| null | `refs/prwb/<sessionId>/<snapshotId>/target` when fetched. |

Validation:

- Unique on `(sessionId, seq)`.
- `baseCommit`, `targetCommit`, `headRef` and `targetRef` are non-null exactly when `diffSource` is `local`.
- When `diffSource` is `local`, the commit at `headRef` must equal `headCommit`; otherwise the snapshot is recorded with `repositoryStatus = missing`, reason `fetched head does not match the PR`, and the platform diff (R10).
- A new snapshot is appended only at session start and on a user refresh (FR-052), only while `prStatus` is `open` (FR-041), and only when the platform head differs from the latest snapshot's `headCommit`, or the latest snapshot's repository row was `missing` (so the fetch is retried). A refresh that finds the same head and a found repository appends no snapshot, but still re-fetches issue evidence (FR-011).
- The same head can appear in two snapshots (a force-push back to an earlier commit, EC-04); `headCommit` is not unique within a session.

Comparing two snapshots of one session (US1-AS7) uses their `headCommit`s through the app-owned refs when both are local, and otherwise their changed files and `diffFingerprint`s.

### Commit

One commit of the PR in a snapshot (FR-002). Append-only, written with its snapshot.

| Field | Type | Rules |
|---|---|---|
| `snapshotId` | UUID | |
| `ordinal` | integer | Platform order, from 0. Unique with `snapshotId`. |
| `sha` | `CommitSha` | |
| `authorName` | string | Display only. |
| `message` | string | Full message, plain text. |
| `committedAt` | timestamp | |

### Changed file

One file in a snapshot's diff (FR-002, FR-033). Append-only, written with its snapshot.

| Field | Type | Rules |
|---|---|---|
| `snapshotId` | UUID | |
| `ordinal` | integer | Diff order, from 0. This is the order the prompt budget fills in (FR-049). Unique with `snapshotId`. |
| `path` | string | Path at head; for a deleted file, the path at base. Repository-relative, `/`-separated, no `..` segment. Unique with `snapshotId`. |
| `oldPath` | string \| null | Set for `renamed` and `copied`. |
| `status` | `added` \| `modified` \| `deleted` \| `renamed` \| `copied` | Platform statuses are normalised to these by the adapter. |
| `additions` | integer | ≥ 0. |
| `deletions` | integer | ≥ 0. |
| `binary` | boolean | From `--numstat` `-` markers or the platform's flag. |
| `sizeBytes` | integer \| null | Size at head from `cat-file -s`; null for a deleted file or a platform diff. |
| `language` | string \| null | From the file extension by a fixed table; null when unknown. |
| `patch` | string \| null | The file's unified-diff hunks, kept so the diff can be shown in a read-only session after refs are gone. Null for binary files. |
| `excludedReason` | `binary` \| `file size` \| `changed lines` \| null | The per-file limit that leaves it out of every prompt, checked in this order (R11, FR-049). |

Validation: `excludedReason` is `binary` when `binary`; else `file size` when `sizeBytes > limits.maxFileBytes`; else `changed lines` when `additions + deletions > limits.maxChangedLines`; else null. The limits in force when the snapshot was taken apply. Whether a file is generated is not recorded here; the FR-3 risk feature owns that.

The `prompt limit` reason is not a property of the file; it depends on the prompt, and is recorded on each stored prompt.

### Issue reference

A reference to an issue or PR found in a snapshot's branch name, title or description (FR-003, FR-026, EC-06). Append-only, written with its snapshot.

| Field | Type | Rules |
|---|---|---|
| `snapshotId` | UUID | |
| `issue` | `IssueKey` | Unique with `snapshotId`: each distinct reference appears once (EC-06). |
| `kind` | `issue` \| `pull-request` | `pull-request` when lookup reports that a `#123` number is a PR; shown as a PR reference, not an issue, and not counted in the issue row. |
| `origins` | list of `{field: branch \| title \| description, text: string}` | At least one. Every place the reference was found, with the matched text. |

Validation:

- Candidates come only from the configured tracker's `extractReferences()`; core holds no key pattern (R15).
- A Jira candidate is stored only when its project key is in `tracker.projectKeys` or lookup confirms the issue exists. A candidate that is neither is not a reference and is not stored. A stored reference whose lookup then fails is still shown, as unresolved (EC-07).

### Evidence

A fact captured from a source, in the one shared evidence model (FR-011, constitution V, VI.2). Append-only. In this feature the only kind written is `issue`; the PR and repository rows of the completeness list are derived, never stored as Evidence (FR-007).

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| `sessionId` | UUID | |
| `snapshotId` | UUID | The latest snapshot when captured. |
| `kind` | `coverage` \| `sonar` \| `spec` \| `issue` \| `lint` \| `custom` | Only `issue` in this feature. |
| `source` | `{platform: PlatformId, key: string}` | For `issue`, the `IssueKey`. |
| `capturedAt` | timestamp | |
| `commit` | `CommitSha` | The snapshot's `headCommit` at capture. |
| `commitBound` | boolean | `false` for `issue`: issue text does not change with the code. Later kinds such as coverage are `true`. |
| `status` | `current` \| `stale` \| `missing` | Status as captured (see transitions). |
| `reason` | string \| null | Required for `stale` and `missing`, for example `no Jira access configured`, `not found`, `forbidden`, `tracker unreachable`. |
| `lastGoodId` | UUID \| null | For `stale`: the last `current` record for the same session and source, whose payload is shown. |
| `payload` | Issue \| null | Required for `current`; null otherwise. |

**Issue** (the payload of `issue` Evidence; never edited on the tracker, FR-027):

| Field | Type | Rules |
|---|---|---|
| `platform` | `PlatformId` | |
| `key` | string | |
| `title` | string | |
| `descriptionText` | string | Plain text. Jira ADF is converted by the adapter's node walker; GitHub bodies are kept as text (FR-004, R15). Never rendered as HTML. |
| `webUrl` | string | The tracker's page for the issue, so a reference can open it (FR-016). |

Validation:

- Issue Evidence is captured for every `issue`-kind reference of the latest snapshot at session start and on every refresh, whether or not a new snapshot was taken (FR-011).
- Commit-bound staleness is derived, not written: commit-bound Evidence is stale whenever its `commit` differs from the latest snapshot's `headCommit` (FR-011, V.3). No record is updated or removed.
- The current view of an issue is the most recent record for `(sessionId, source)`.

### Context completeness (derived, not stored)

Computed on read from the session, its status, its latest snapshot and its latest Evidence (FR-007, FR-049). Stored and displayed statuses are `found`, `missing`, `stale`.

| Row | `found` when | `stale` when | `missing` when |
|---|---|---|---|
| PR | `lastCheckOutcome = ok` and `lastCheckedHead` equals the latest snapshot's `headCommit` | the platform head has moved past it, or the platform could not be reached (reason: `lastCheckError`) | never |
| Repository | the latest snapshot's `repositoryStatus = found` | never | `repositoryStatus = missing` (reason: `repositoryReason`) |
| Issue | (per issue) its latest Evidence is `current` | (per issue) its latest Evidence is `stale` | the latest snapshot has no `issue`-kind reference (whole row), or (per issue) its latest Evidence is `missing` |

Under the repository row, every file of the latest snapshot left out of a prompt is listed with its reason: the changed files with an `excludedReason`, plus the files the latest completed summary's stored prompt left out with `prompt limit`. Later features add their own rows.

## AI work

Questions and summary runs share three child records: a stored prompt, stream chunks and claims with references. Every record here is append-only. Their lifecycle state is derived from which records exist plus the in-memory work lanes; no status column is updated (research R17).

Questions and summary runs may be created only when all of these hold:

- the session's `prStatus` is `open` (FR-041);
- the target snapshot is the session's latest (FR-051);
- the latest snapshot's `repositoryStatus` is `found`, since analysis needs the isolated workspace (FR-005, FR-022a, EC-01);
- the provider is available: installed, signed in, and enforcing restrictions (c) and (d) (FR-022, EC-08, EC-09).

When any fails, the API refuses with the reason and nothing is appended.

### Summary run

One generation of the summaries for one snapshot (FR-012, FR-053). Append-only.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| `snapshotId` | UUID | |
| `requestedAt` | timestamp | |
| `provider` | `ProviderId` | Exactly one (FR-023). |

Validation: one run is appended automatically when a snapshot is taken (FR-053). An earlier snapshot's runs and their summaries are kept (FR-012).

### Question

One question in a session (FR-013 to FR-015, FR-048, FR-050). Append-only.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| `sessionId` | UUID | |
| `snapshotId` | UUID | The latest snapshot when asked. |
| `seq` | integer | Order asked within the session; the queue runs in this order (FR-053). Unique with `sessionId`. |
| `askedAt` | timestamp | |
| `text` | string | Non-empty after trimming. |
| `category` | `what` \| `why` \| `how` \| `whatif` \| `risk` \| `requirement` | Displayed as What, Why, How, What-if, Risk, Requirements (FR-014). |
| `audience` | `technical` \| `business` | "Answer for"; default `technical` (FR-048). |
| `scope` | Scope (below) | |
| `followsQuestionId` | UUID \| null | Set for a follow-up (FR-047, FR-050). |
| `origin` | `typed` \| `suggested` \| `follow-up` | How the text was chosen. `follow-up` exactly when `followsQuestionId` is set. |
| `provider` | `ProviderId` | Exactly one (FR-023). |

**Scope**:

| Field | Type | Rules |
|---|---|---|
| `type` | `pr` \| `file` \| `range` | (FR-013) |
| `path` | string \| null | Required for `file` and `range`; must be a changed file's `path` in the question's snapshot. |
| `side` | `new` \| `old` \| null | Required for `range`. `new` reads the snapshot's head commit, `old` its base commit (FR-034). `old` requires a local diff, or at least the file's hunks, and a file that is not `added`. |
| `startLine`, `endLine` | integer \| null | Required for `range`; 1 ≤ `startLine` ≤ `endLine`, and within the lines the diff shows for that side. |
| `label` | string \| null | Optional, `range` only, at most 200 characters, such as a method name. No parser checks it (FR-013, VI.1). |

Validation:

- `followsQuestionId` references a question in the same session that has a `completed` answer, and the new question copies that question's `scope`. Its prompt carries the parent question and the parent answer's claims, and nothing from any other question (FR-050).
- A `requirement` question draws only on the linked issues' text in Phase 1 (FR-014); the prompt builder enforces this, not the store.

### Stored prompt

What was sent to the provider for one question or summary run (FR-020, FR-022e, FR-049). Append-only. Written when the work starts, so a question cancelled while queued has none.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| exactly one of `questionId`, `summaryRunId` | UUID | Unique: one prompt per question or run. |
| `instructions` | string | The fixed system text passed by `--append-system-prompt`. |
| `data` | string | The delimited data block sent on stdin, nonce included (R14). |
| `contextVersion` | `ContextVersion` | Computed from `data` without the nonce. Its head commit is the snapshot's. |
| `excludedFiles` | list of `{path, reason}` | Every changed file left out: the per-file reasons, plus `prompt limit` for files cut when the budget was reached. |
| `dataChars` | integer | ≤ `limits.maxPromptChars` for the diff and context part (FR-049). |
| `restrictionsNotEnforced` | subset of `a`, `b`, `e` | From the provider capabilities at start. Never contains `c` or `d`, since then the work would not start (FR-022). |
| `sentAt` | timestamp | |

### Stream chunk

Raw text as it streamed (FR-021). Append-only. Written as each delta arrives, so a crash leaves the partial text (FR-045, plan note).

| Field | Type | Rules |
|---|---|---|
| exactly one of `questionId`, `summaryRunId` | UUID | |
| `seq` | integer | From 0, unique with the owner. |
| `text` | string | |
| `receivedAt` | timestamp | |

### Answer

The terminal record of a question. Append-only; at most one per question.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| `questionId` | UUID | Unique. |
| `outcome` | `completed` \| `cancelled` \| `failed` | See the Question lifecycle. |
| `cancelReason` | `user` \| `restart` \| `superseded` \| null | Required when `cancelled`. |
| `failureReason` | string \| null | Required when `failed`, for example the provider's error (EC-02). |
| `warning` | `unstructured` \| `cancelled` \| null | `unstructured` when the output did not validate (FR-019); `cancelled` for a cancelled answer (FR-045). |
| `rawText` | string \| null | The concatenated chunks when `warning` is set or the outcome is `failed`. |
| `unsupportedAssumptions` | string[] | From the structured output; empty otherwise (FR-046). |
| `suggestedFollowUps` | string[] | From the structured output; empty otherwise (FR-047). |
| `contextVersion` | `ContextVersion` \| null | Copied from the stored prompt; null when cancelled before it started. |
| `restrictionsNotEnforced` | subset of `a`, `b`, `e` | Copied from the stored prompt; shown with the answer (FR-022). |
| `finishedAt` | timestamp | |

The provider and the time shown with an answer (FR-020) are the question's `provider` and the answer's `finishedAt`.

### Summary

The terminal record of a summary run. Append-only; at most one per run. Same fields as Answer except `questionId` (replaced by a unique `summaryRunId`), `unsupportedAssumptions` and `suggestedFollowUps`.

### Summary section

One part of a completed summary (FR-012, R13). Append-only.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| `summaryId` | UUID | |
| `ordinal` | integer | Unique with `summaryId`. |
| `kind` | `pr` \| `file` \| `functional` \| `technical` | Exactly one `pr`, one `functional` and one `technical` section per completed structured summary. |
| `path` | string \| null | Required for `file`; a changed file of the run's snapshot, at most one section per path. Files the prompt left out have no section, and are listed by the stored prompt's `excludedFiles`. |

An `unstructured` or cancelled summary has one `pr` section holding the single Inference claim.

### Claim

One assertion in an answer or a summary section (FR-016 to FR-019, FR-045). Append-only.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| exactly one of `answerId`, `summarySectionId` | UUID | |
| `ordinal` | integer | Unique with the owner. |
| `text` | string | Non-empty. Shown as text only. |
| `proposedLabel` | `evidence` \| `inference` | As the provider returned it. |
| `label` | `evidence` \| `inference` | Decided by the workbench, never by the model: `evidence` only when `proposedLabel` is `evidence` and at least one reference resolved (FR-018). Displayed as Evidence, Inference. |
| `proposedIntent` | `documented` \| `inferred` \| null | As the provider returned it (the optional `intent` of R13). Null for a claim that is not about what the change is for. |
| `intent` | `documented` \| `inferred` \| null | Decided by the workbench (FR-017): null when `proposedIntent` is null; `documented` only when `proposedIntent` is `documented` and the claim has a resolved `issue` reference or a resolved `pr` reference; otherwise `inferred`. The UI groups `documented` claims apart from `inferred` ones. |

Validation:

- When the answer is `unstructured`, cancelled or failed with partial text, exactly one claim exists, labelled `inference`, with `intent` null, holding the raw text (FR-019, FR-045). All claims of a cancelled answer are `inference`.
- `label` and `intent` are independent: a claim can be `inference` and `documented` (it restates the issue without a code reference that resolves), or `evidence` and `inferred` (it cites code and deduces the purpose from it).

### Reference

One source a claim cites (FR-016, FR-035, R13). Append-only.

| Field | Type | Rules |
|---|---|---|
| `claimId` | UUID | |
| `ordinal` | integer | Unique with `claimId`. |
| `kind` | `code` \| `issue` \| `pr` | `pr` cites the PR description of the claim's snapshot and carries no other field (R13). |
| `path` | string \| null | `code` only. Repository-relative; any file in the commit, not just changed files (FR-035). |
| `side` | `head` \| `base` \| null | `code` only. `base` is for a line the PR removed. |
| `startLine`, `endLine` | integer \| null | `code` only; 1 ≤ `startLine` ≤ `endLine`. |
| `commit` | `CommitSha` \| null | `code` only: the snapshot's `headCommit` or `baseCommit` that the reference was checked against and opens at. |
| `issue` | `IssueKey` \| null | `issue` only. |
| `resolved` | boolean | See below. |
| `unresolvedReason` | string \| null | Required when not resolved: `no such file at commit`, `line outside file`, `no base commit`, `issue not fetched for this session`, `PR has no description`. |

A reference resolves (the Resolvable reference definition, R13) when:

- `code`: the commit for its `side` exists (a `base` reference needs a `baseCommit`), `cat-file -e <commit>:<path>` succeeds, and `endLine` is within the file's line count at that commit;
- `issue`: the session has `current` or `stale` Evidence with a payload for that `IssueKey`;
- `pr`: the claim's snapshot has a non-empty `description`. It opens that description.

Only `code` and `issue` references keep a claim labelled `evidence` (FR-018), since the canonical Resolvable reference covers only those two. A resolved `pr` reference supports `documented` intent and is shown with the claim, but on its own leaves the claim `inference`. See Open points.

References are checked once, when the answer completes, and the result is stored. A reference opens later only while its commit remains in the local clone (FR-041).

## State transitions

### Review session

Derived from Session status and the latest snapshot; deletion removes the rows (plan, States).

| From | To | Trigger | Records written |
|---|---|---|---|
| (none) | Active | user starts a session on an open PR | session, session status, snapshot 1 with its commits, files and references, issue Evidence, summary run |
| Active | HeadMoved | an open finds `lastCheckedHead` ≠ latest `headCommit` | session status only; no snapshot (FR-052) |
| HeadMoved | Active | user refreshes | session status, new snapshot and children, issue Evidence, summary run |
| Active | Active | user refreshes, same head | session status, issue Evidence |
| Active, HeadMoved | ReadOnly | an open or refresh finds the PR closed, merged or gone | session status only (EC-03) |
| any | Deleted | user confirms delete | everything under the session removed in one transaction (FR-044) |

Derived states: `ReadOnly` when `prStatus` ≠ `open`; else `HeadMoved` when `lastCheckOutcome = ok` and `lastCheckedHead` ≠ latest `headCommit`; else `Active`. An `unreachable` check leaves the state as it was and makes the PR row stale.

Whether a session is open (has a workspace and work lanes) is orthogonal to these states. Session close, by the user or server shutdown, removes only the isolated workspace and keeps every record (FR-042).

### Question

Plan, States, extended with `Failed` (see Open points). Derived: a question with an Answer is in that Answer's outcome; without one, it is `Running` if its lane is running it, else `Queued`.

| From | To | Trigger | Records written |
|---|---|---|---|
| (none) | Queued | user asks | question |
| Queued | Running | the question lane is free and this is the lowest `seq` waiting | stored prompt |
| Queued | Cancelled | user cancels; or a refresh appends a newer snapshot (`superseded`); or the workbench restarts (`restart`) | answer, `cancelled`, no claims |
| Running | Running | a text delta arrives | stream chunk |
| Running | Completed | provider finishes | answer `completed` (or `completed` with `warning = unstructured`), claims, references |
| Running | Cancelled | user cancels, or the workbench restarts (`restart`) | answer `cancelled`, one Inference claim from the chunks (if any) |
| Running | Failed | provider error or exit | answer `failed` with reason, one Inference claim from any chunks |

`Completed`, `Cancelled` and `Failed` are final. A question running when a refresh appends a newer snapshot finishes against its own snapshot and is shown marked with its older head commit (FR-051).

### Summary run

The same as Question, on the separate summary lane, with Summary in place of Answer. A newer snapshot cancels an older snapshot's queued run (`superseded`) before its own run is queued.

### Issue Evidence, per session and issue

Each arrow appends a new Evidence record; nothing is updated (FR-011).

| From (latest record) | Fetch result | New record |
|---|---|---|
| none | success | `current` with payload |
| none | failure | `missing` with reason |
| `missing` | success / failure | `current` / `missing` |
| `current` | success | `current` with fresh payload |
| `current` | failure | `stale` with reason, `lastGoodId` = that record |
| `stale` | success / failure | `current` / `stale` (same `lastGoodId`) |

### Isolated workspace (filesystem)

```text
Absent ──session opened or started, repository found──▶ Present (detached worktree of the latest headCommit)
Present ──refresh appends a newer snapshot──▶ Present (old worktree removed, new one at the new head)
Present ──session close, server shutdown or delete──▶ Absent
Present (left over) ──start-up sweep──▶ Absent
```

## Not stored in the review store

| Item | Where | Notes |
|---|---|---|
| Isolated workspace | `<app-data>/workspaces/<sessionId>/<snapshotId>` | A detached worktree (FR-037). Removed by path only, never by `worktree prune` (R9). Its path is derived from the ids, so nothing records it. |
| App-owned refs | `refs/prwb/<sessionId>/<snapshotId>/{head,target}` in the local clone | Written only by fetch (FR-036). Kept across close so references keep opening; removed only by session delete (FR-044). |
| Provider capabilities | memory, from `claude --version` and `--help` at start-up | `installed`, `version`, enforced flags for restrictions `a` to `e`, `available` (false when not installed or `c` or `d` unenforced) and its reason (R12). |
| Work lanes | memory, per open session | One summary lane and one question lane, each running one job (FR-053, R17). Lost on restart, which recovery turns into `restart` cancellations. |
| Suggested questions | code (`suggestions.ts`) | Fixed templates per scope type and category (FR-015). A question records only `origin = suggested`. |
| Open PR list | fetched on demand | Not stored until a session is started (FR-001). |
| Log record | `<app-data>/logs/prwb-YYYY-MM-DD.log` | Fields allowed: `ts`, `op`, `outcome`, `durationMs`, `sessionId?`, `snapshotId?`, `requestId?`, `errorCode?`, `errorMessage?` (scrubbed). No other field can be written (FR-054, R18). Rotated after `logRetentionDays`. |

## Integrity rules

- **Append-only (III.2).** Every table except Session status rejects updates through a `BEFORE UPDATE` trigger that always aborts, and rejects deletes unless a `session_deletion` marker row exists for that session (R5). The review store module exposes only `append*`, `read*` and `deleteSession`.
- **Whole-session delete (FR-044).** `deleteSession` inserts the marker, deletes the session (foreign keys cascade to status, snapshots, commits, changed files, references, Evidence, summary runs, questions, prompts, chunks, answers, summaries, sections, claims and references), removes the marker, all in one transaction; then removes the workspace and the session's `refs/prwb/<sessionId>/` refs. No single question, answer or claim can be edited or deleted.
- **Recovery (EC-11, R17).** At start-up, after removing leftover workspaces, every question and summary run with no terminal record gets one: `cancelled` with `cancelReason = restart`, holding any stored chunks as one Inference.
- **Separation (III).** Evidence and AI output live in separate tables. A claim never becomes Evidence, and Evidence never carries a label.
- **No people metrics (FR-031).** No field scores, ranks or times a person. `author` and commit author names are display values, never aggregated. Durations exist only in logs, per operation.
- **No secrets (FR-028).** No table or log field holds a credential or the launch token.

## Open points

These follow from the requirements but were not settled by the spec, plan or research when the model was written. Points 1 to 5 were confirmed on 2026-11-07 and recorded in the spec (Clarifications, Session 2026-11-07 (analyze); FR-005, FR-041, FR-051, FR-052, Definitions). Point 6 stands as modelled and is built by T107.

1. **`Failed` outcome.** The plan's Question states have no failed state, but EC-02 and FR-032 need a provider error to show as a gap with its reason. The model adds `failed` as a final outcome rather than reusing `cancelled`, which implies a user or restart.
2. **PR-description references and the Evidence label.** R13 adds `{kind: "pr"}` so a claim can cite the PR description for documented intent (FR-017), but neither R13 nor the canonical Resolvable reference (`CONTEXT.md`) says whether a `pr` reference keeps a claim labelled Evidence. The model lets it support `documented` intent only, and keeps FR-018's Evidence rule to `code` and `issue` references. If PR text should count as Evidence, `CONTEXT.md` and the spec's Definitions need the PR description added to Resolvable reference.
3. **Superseded queued work.** FR-051 limits new questions and summaries to the latest snapshot but does not say what happens to work queued against an older snapshot when a refresh lands. The model cancels queued work with `superseded` and lets running work finish against its own snapshot.
4. **Snapshot on unchanged head.** FR-010 and FR-052 allow a refresh to take a snapshot; the model appends one only when the head moved or the previous fetch failed, so identical snapshots are not stacked.
5. **Reopened PRs.** The model never moves a `closed` session back to `open`. If the platform reopens a PR, the session stays read-only with a note.
6. **Follow-ups across snapshots.** A follow-up copies its parent's scope. When the parent was asked on an older snapshot, a `range` scope may not match the latest diff; the model requires the copied scope to pass the usual Scope validation against the latest snapshot, and otherwise widens it to `file` (or `pr` if the file is gone).
