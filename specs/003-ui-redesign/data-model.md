# Data Model: PR Review Workbench UI Redesign

**Feature**: `003-ui-redesign` | **Date**: 2026-11-09
**Inputs**: [ui-redesign.spec.md](ui-redesign.spec.md), [plan.md](plan.md), [research.md](research.md), [wireframes/approval.md](wireframes/approval.md), [001 data model](../001-pr-review-workbench/data-model.md), [002 data model](../002-gitlab-integration-tests/data-model.md)

This feature adds no table to the review store and changes no stored entity (constitution III). Sessions already record their platform, repository id and PR number, so a session can name any repository under the base folder without a schema change (R13). The changes fall into four groups:

1. **Configuration and contracts** (`src/config.ts`, `src/contracts/`): the workspace replaces the single repository, trackers declare their settings fields, and source-control adapters gain a read-only remote matcher.
2. **Workspace and discovery** (`src/repo/discovery.ts`, `src/core/workspace.ts`): an in-memory result, rebuilt at start-up, on save and on Rescan. It is never written to disk.
3. **Wire types** (`src/contracts/http.ts`): repository-aware pull requests and sessions, pull groups with per-repository failure, and one new error code.
4. **Browser-only state** (`src/ui/state/`): view state kept in `sessionStorage`, plus in-memory models for selection, panels, width bands, the live-update stream, async regions, badges and the connection checklist. None of it reaches the server.

Names follow the existing code: `RepoRef = { platform, id }`, `Side = 'head' | 'base'` ('head' is the new side), `Scope`, `Ref`, `AnswerFor`, `Category`.

## Overview

```text
Configuration (config.json)
   ├── WorkspaceConfig { baseFolder, platform, baseUrl? }      replaces RepositoryConfig
   ├── IssueTrackerConfig { platform, site?, projectKeys? }    fields gated by settingsFields
   └── limits, logRetentionDays                                unchanged
AdapterDescriptor ── + settingsFields (trackers)               decides which tracker fields Setup shows
SourceControlProvider ── + repositoryForRemote(remote)         turns a remote into a repository id, or null

Workspace (in memory, one per running workbench)
   ├── Discovery run (state machine, below)
   └── Discovered entry (0..n)
          ├── matched   ── RepoRef + folder used              feeds the dashboard
          ├── duplicate ── RepoRef + folder + duplicateOf
          └── skipped   ── folder + reason

Wire (HTTP)
   GET /api/pulls ── PullGroup (1 per matched repository) ── PullSummary (+ repository)
   SessionSummary / SessionDetail ── + repositoryAvailable, repositoryReason?
   POST /api/sessions ── CreateSessionBody { repository, prNumber }
   ErrorCode ── + repository_unavailable (409)

Browser only (one tab)
   sessionStorage
     ├── prwb:view:<sessionId>   Review session view state (1 per session visited in the tab)
     └── prwb:view:dashboard     Dashboard view state (0..1)
   memory
     Diff selection · Panel · Width band · Live-update stream · Async region state ·
     Badge · Connection check · Route · Announcement queue · Focus opener
```

## 1. Configuration and contracts

### 1.1 Workspace configuration (`config.json`, replaces `repository`)

Written by Setup through `PUT /api/config` (FR-048, R10). `Config` becomes `{ workspace, issueTracker, limits, logRetentionDays }`.

| Field | Type | Rules |
|---|---|---|
| `workspace.baseFolder` | string | Required. Absolute path (`node:path` `isAbsolute`, so Windows drive and UNC paths count, P.4). Must exist and be a directory when saved. Must neither contain nor sit inside the application-data folder (`assertOutsideClone` reused); refused with the reason (edge case). |
| `workspace.platform` | `PlatformId` | Required. A registered source-control platform. One per base folder; repositories on other hosts are skipped, not configured (clarification). |
| `workspace.baseUrl` | string? | Required when the platform's descriptor has `needsBaseUrl: true`, optional otherwise (as today). Checked by the existing `validateBaseUrl`: https anywhere, http only on a loopback host, no user info, query or fragment. It is also what recognises that platform's remotes, so one base folder serves one self-hosted instance. |
| `issueTracker.platform` | `PlatformId` | Required. One tracker for every repository (FR-058). |
| `issueTracker.site` | string? | Allowed only when the tracker's `settingsFields` includes `site`; then required. Validated by `validateBaseUrl`. |
| `issueTracker.projectKeys` | string[]? | Allowed only when the tracker's `settingsFields` includes `projectKeys`. Each entry matches `^[A-Z][A-Z0-9]+$`. |
| `limits`, `logRetentionDays` | unchanged | Defaults as today. Setup shows them in human units (section 4.10). |

Validation rules:

- An undeclared tracker field that is sent is refused as `invalid_request` naming the field. Nothing is dropped silently (R14).
- Each refusal names its field path (`workspace.baseFolder`, `issueTracker.site`) so Setup can show it at the field and in the top summary (FR-036).
- A config file still in the old `repository` shape loads as **not configured**: Setup opens and no base folder is guessed (R10). There is no automatic migration.
- `ConfigBody` (the request) mirrors `Config` with `limits` partial and `logRetentionDays` optional, as today.
- A successful save starts a discovery run (section 2.2). A save during a running scan cancels it and starts a new one.

### 1.2 Adapter descriptor: tracker settings fields

| Field | Type | Rules |
|---|---|---|
| `settingsFields` | `readonly ('site' \| 'projectKeys')[]?` | New. Declared by tracker adapters only. Absent means none. Jira Cloud declares `site` and `projectKeys`; GitLab Issues declares `site`; GitHub Issues declares none. Setup renders exactly these fields and never names a platform (FR-034, VIII.2). |
| `needsBaseUrl` | boolean? | Unchanged. Source-control only. |

### 1.3 Source-control contract: `repositoryForRemote`

| Member | Signature | Rules |
|---|---|---|
| `repositoryForRemote` | `(normalisedRemote: string) => string \| null` | New, synchronous, read-only, no network. Input is a remote already passed through `normaliseRemote` (`host/path`, lower-case, no scheme, user or `.git`). Returns the platform repository id when the remote is on this platform (for a self-hosted platform, on its configured `baseUrl` host), otherwise null. It is the inverse of `cloneLocations`: for every repository `r`, `repositoryForRemote(cloneLocations(r)[i])` returns `r.id` (contract suite, XI.2). Nested group paths stay inside the adapter. |

### 1.4 Session environment (internal, per repository)

`SessionEnvironment` is built by `environmentFor(repo: RepoRef)` instead of a single `environment()` (R13).

| Field | Type | Rules |
|---|---|---|
| `sourceControl` | provider | The workspace platform's adapter. |
| `tracker` | tracker | Created with this repository, so a tracker that reads issues from the repository itself uses the PR's own repository (FR-058). |
| `repository` | `RepoRef` | The session's stored repository. |
| `clonePath` | string \| null | The matched folder from the workspace, looked up at use, never stored on the session. Null when the repository is not matched now. |
| `limits` | `Limits` | From config. |

Refresh, Ask and starting a summary run need a non-null `clonePath`; otherwise they refuse with `repository_unavailable`.

## 2. Workspace and discovery (in memory)

### 2.1 Workspace

One per running workbench, created at start-up from the config. Holds the latest discovery result. Rebuilt from scratch on each run, so it cannot go stale across restarts (R11).

| Field | Type | Rules |
|---|---|---|
| `configured` | boolean | False when there is no config or it is in the old shape. Every other field is then absent. |
| `baseFolder` | string | From config. |
| `platform` | `PlatformId` | From config. |
| `baseUrl` | string? | From config. |
| `discovery` | Discovery run | Section 2.2. |
| `entries` | Discovered entry[] | Section 2.3. Sorted by folder path in code-point order for display. Kept when a run is cancelled. |

Derived reads:

- `matched()`: the `matched` entries, one per repository id. Feeds `GET /api/pulls`.
- `cloneFor(repo)`: the folder of the `matched` entry for `repo`, or null.

`GET /api/workspace` returns this shape. `POST /api/workspace/rescan` and `POST /api/workspace/cancel` change it; both are state-changing, so both pass the Origin check (X.5).

### 2.2 Discovery run

| Field | Type | Rules |
|---|---|---|
| `state` | `'idle' \| 'scanning' \| 'complete' \| 'cancelled' \| 'failed'` | See transitions below. |
| `foldersScanned` | integer ≥ 0 | Counts directories opened. Increases while `scanning`; shown as progress (edge case). |
| `startedAt` | ISO 8601? | Set when a run starts. |
| `finishedAt` | ISO 8601? | Set on `complete`, `cancelled` or `failed`. |
| `reason` | string? | Present only on `failed` (for example the base folder is unreadable or gone). |

Walk rules (FR-049, R11, IX):

- Uses `fs.opendir` from the base folder. Never follows a symbolic link or Windows junction (`Dirent.isSymbolicLink()`).
- Skips the application-data folder and the inside of every `.git`.
- A folder is a repository when it holds a `.git` directory or `.git` file (worktrees and submodules count).
- Keeps descending inside a repository, so nested repositories are found too (edge case).
- Reads remotes only through the Repository manager's existing `listRemotes` command (`git remote -v`), at most 8 at once. Runs no other git command and writes nothing. A safety test compares branch, HEAD, index, status and stash of every discovered repository before and after a scan (XI.3).

```text
          start-up / save
  Idle ─────────────────────▶ Scanning ──walk ends──────────▶ Complete
                                 │  ├────cancel──────────────▶ Cancelled
                                 │  └────base folder unreadable▶ Failed
  Complete / Cancelled / Failed ──Rescan or save──▶ Scanning
  Scanning ──save──▶ (running walk cancelled) ──▶ Scanning
```

| From | Event | To | Effect on `entries` |
|---|---|---|---|
| Idle | start-up with a valid config, or save | Scanning | Cleared. |
| Scanning | walk ends | Complete | Final result. |
| Scanning | cancel | Cancelled | Entries found so far are kept (edge case). |
| Scanning | base folder cannot be read | Failed | Empty; `reason` set. |
| Complete, Cancelled, Failed | Rescan or save | Scanning | Cleared at start of the new run. |
| Scanning | save | Scanning | The running walk is cancelled first, then a new run starts. |

While a run is `scanning` after start-up, `matched()` holds what has been found so far, and sessions whose repository is not yet found report a "discovery still running" reason rather than "not found".

### 2.3 Discovered entry

One row per (folder, repository) pair, or per folder when no repository matched. A discriminated union on `status`.

| Field | Type | Present for | Rules |
|---|---|---|---|
| `status` | `'matched' \| 'duplicate' \| 'skipped'` | all | |
| `folder` | string | all | Absolute path of the clone. The UI shows it relative to the base folder. |
| `repository` | `RepoRef` | matched, duplicate | `id` as returned by `repositoryForRemote`, compared case-folded. |
| `remote` | string | matched, duplicate | The normalised remote that matched. |
| `duplicateOf` | string | duplicate | The `folder` of the matched entry for the same repository. |
| `reason` | `'no-remote' \| 'no-matching-remote' \| 'remotes-unreadable'` | skipped | `no-remote`: the clone has no remote. `no-matching-remote`: no remote is on the chosen platform. `remotes-unreadable`: `git remote -v` failed; shown as a gap with its message (V.1). |
| `detail` | string? | skipped | Human text for the reason, such as the hosts found. |

Matching and de-duplication rules (FR-050, FR-051):

- Each remote of a repository is normalised and passed to `repositoryForRemote`. Every non-null id distinct within the clone gives one entry, so a fork clone naming the fork and its upstream lists both (edge case, approved proposal 16).
- A clone with at least one match produces no `skipped` entry.
- When one repository id is found in several folders, the folder with the fewest path segments below the base folder is `matched`. Ties are broken by the folder path in code-point order. Every other folder for that id is a `duplicate` with `duplicateOf` set. The choice is stable between scans.
- Each repository id has at most one `matched` entry.

On the wire (`GET /api/workspace`, contracts §5.2) the entries are grouped: each `matched` entry carries its duplicates as `duplicateFolders`, and `skipped` entries form their own list.

## 3. Wire types (`src/contracts/http.ts`)

### 3.1 PullSummary (changed)

| Field | Change | Rules |
|---|---|---|
| `repository` | **added**, string | The repository id the PR belongs to. With `number`, identifies the row; the testid becomes `pr-item-<repository>-<number>` (the one deliberate testid change, FR-046). |
| all other fields | unchanged | `number`, `title`, `author`, `sourceBranch`, `targetBranch`, `updatedAt`, `sessionId?`. |

### 3.2 PullGroup (new)

`GET /api/pulls` returns `PullGroup[]`, one per matched repository. `GET /api/pulls?repository=<id>` returns one group and is what Retry calls (R12).

| Field | Type | Rules |
|---|---|---|
| `repository` | string | A matched repository id. An unknown id on the single-group form is `404 not_found`. |
| `status` | `'loaded' \| 'failed'` | One repository's failure never fails the call or another group (FR-054, V.4). |
| `reason` | string? | Present only when `failed`, naming what failed. |
| `pulls` | `PullSummary[]` | Empty when `failed`. Each entry's `repository` equals the group's. |

`signin_required` still refuses the whole call, since no group can load without a sign-in. The UI merges loaded groups into one list sorted by `updatedAt` descending (FR-052, approved proposal 17), with ties broken by repository then number so the order is stable.

### 3.3 SessionSummary and SessionDetail (changed)

| Field | Type | Rules |
|---|---|---|
| `repositoryAvailable` | boolean | **Added.** True when the workspace has a matched clone for the session's repository now. |
| `repositoryReason` | string? | **Added.** Present only when `repositoryAvailable` is false: the repository is no longer found under the base folder, the base folder could not be read, or discovery is still running. Shown beside the unavailable Refresh and Ask (FR-057). |

A session with `repositoryAvailable: false` stays readable from the store and appears on the dashboard as "Open (read only)" (approved proposal 18). The existing `readOnly` (closed or merged PR) is independent; either one disables Refresh and Ask, each with its own reason.

### 3.4 CreateSessionBody (changed)

| Field | Type | Rules |
|---|---|---|
| `repository` | string | **Added**, required. Must be a currently matched repository, else `repository_unavailable`. |
| `prNumber` | integer | Unchanged, > 0. |

### 3.5 ErrorCode (changed)

| Code | Status | When |
|---|---|---|
| `repository_unavailable` | 409 | Refresh, Ask, starting a summary run or starting a session names a repository with no matched clone. The message carries the same text as `repositoryReason`. |

## 4. Browser-only state (`src/ui/state/`)

Everything here lives in one browser tab. Nothing is sent to the server, and no field holds a credential (FR-017, X.7). The view-state module imports nothing from `api.ts`.

### 4.1 Review session view state (`sessionStorage`, key `prwb:view:<sessionId>`)

What the reviewer has in progress in one session in this tab (spec Key Entities). Versioned JSON.

| Field | Type | Default | Rules |
|---|---|---|---|
| `v` | `1` | `1` | Any other value is discarded and defaults are used. |
| `draft` | string | `''` | The half-written question. Kept when the head commit moves (edge case). Capped at the server's question length limit; longer input is truncated on write. |
| `category` | `Category` | `'what'` | One of the existing category values. |
| `answerFor` | `AnswerFor` | `'technical'` | Keeps the reviewer's choice for the session (FR-018). |
| `scope` | `Scope` | `{ type: 'pr' }` | The existing `Scope` union. A `range` scope has `path`, `side`, `startLine ≤ endLine` (both ≥ 1) and optional `label`. Set from the diff selection, "Ask about this PR" or a file. |
| `scroll` | `Record<string, number>` | `{}` | Route key (section 4.6) to vertical scroll offset, an integer ≥ 0. Only keys of this session's routes; at most 50 entries, oldest dropped first. |
| `panel` | `null \| { kind: 'ask' } \| { kind: 'evidence'; ref: Ref }` | `null` | Which panel is open. `ref` is the existing `Ref` union. Not in the URL (R6). |
| `lastDiffPath` | string? | absent | The file the Files tab reopens. Absent means the first changed file. |

Validation rules (R3):

- Read: parse, check `v`, keep only the allowlisted fields, check each field's type and values, and fall back to that field's default when it fails. A corrupt or old value never throws.
- Write: only through typed setters, one per field. No setter accepts an arbitrary key.
- Every storage access is wrapped so blocked storage behaves as an empty store; state then lives in memory for the page's life.
- A unit test asserts the stored JSON holds only the allowlisted keys.

Lifecycle:

| From | Event | To |
|---|---|---|
| absent | first visit to a session in the tab | defaults (not written until something changes) |
| stored | any setter | stored, updated |
| stored | page reload in the same tab | restored |
| stored | the session is deleted from this tab | key removed |
| stored | the tab closes | gone (browser) |

Deleting or closing the session in another tab leaves the key; the page then shows the session is no longer available and offers Home (edge case).

### 4.2 Dashboard view state (`sessionStorage`, key `prwb:view:dashboard`)

| Field | Type | Default | Rules |
|---|---|---|---|
| `v` | `1` | `1` | As above. |
| `text` | string | `''` | Free text matched case-insensitively against repository, number, title, author and branches of loaded rows (FR-053). Trimmed, capped at 200 characters. |
| `repository` | string \| null | `null` | One repository id, or null for all. A stored id that is no longer matched resets to null. |
| `scroll` | integer ≥ 0 | `0` | Restored on "Back to dashboard" after the list renders (FR-055). |

Same read, write and storage rules as 4.1. Filters apply to loaded items only and never query the server.

### 4.3 Diff selection (memory, rules in `selection.ts`)

The keyboard and pointer model for choosing a range (FR-006 to FR-008, R7). Its result is written to `scope` in 4.1.

| Field | Type | Rules |
|---|---|---|
| `side` | `Side` | One side per selection. A context line is selectable on `head` only. |
| `anchor` | integer | The line Enter, Space or the first click set. |
| `start`, `end` | integer | `start = min(anchor, focus)`, `end = max(anchor, focus)`. |
| `cursor` | `{ side, line }` | The roving-focus position (one Tab stop for the whole diff). |

```text
  None ──Enter/Space or click on a line──▶ Anchored(side, n)
  Anchored ──Enter/Space or click on line m, same side──▶ Range(side, n..m)
  Anchored | Range ──Shift+↑/↓──▶ Range (extends by one line, same side)
  Anchored | Range ──Enter/Space or click on a line on the other side──▶ Anchored(other side, m)
  Anchored | Range ──Escape──▶ None
```

Rules: ↑/↓ move `cursor` within a side; ←/→ switch side on the same row only when that side has a number. A selection never crosses sides (edge case). Every change produces the scope-bar text `Selected: <path> lines a–b (new side)` (or `old side`) and one announcement (FR-007).

### 4.4 Panel (memory, mirrored in 4.1 `panel`)

| Field | Type | Rules |
|---|---|---|
| `kind` | `'ask' \| 'evidence'` | |
| `ref` | `Ref` | Evidence only. Code refs carry the full `startLine..endLine`. |
| `openerId` | string | Element id of the control that opened it. Memory only, never stored. Focus returns there on close (FR-020). |

State transitions are those in plan.md "contextual panel on a review page": Closed → Ask or Evidence; either → Closed on the close button or Escape; either → FullPage when the band becomes `narrow`, which replaces the hash with the panel's full-page route and keeps the draft; FullPage → Closed on back. In the `narrow` band, actions go straight to FullPage. Opening moves focus to the panel's `h2`.

### 4.5 Width band (memory, `layout.ts`)

| Value | Media query | Panels | File list |
|---|---|---|---|
| `wide` | `(width >= 1200px)` | beside the content | collapsible left region |
| `medium` | `(900px <= width < 1200px)` | non-modal overlay | drawer |
| `narrow` | `(width < 900px)` | full-page routes | `‹ Previous file`, `Next file ›`, `All changed files` |

The same three queries are used in `app.css` (FR-019, FR-024).

### 4.6 Route (memory, `routes.ts`)

The parsed hash. Every existing route keeps working as a deep link (FR-023).

| Route | Parameters | Rules |
|---|---|---|
| `#/` | none | Dashboard. |
| `#/setup` | none | |
| `#/signin` | `return?` | `return` is accepted only when it starts with `#/`, parses to a known route, and is not a sign-in or setup route; anything else returns to `#/` (R15, FR-038). |
| `#/sessions/:id` | none | Overview. |
| `#/sessions/:id/diff` | `path` | |
| `#/sessions/:id/code` | `snapshot`, `side`, `path`, `start?`, `end?`, `line?` | `start` and `end` are integers ≥ 1 with `start ≤ end`; if only `start` is given, `end = start`. A link with only `line` reads as `start = end = line` (FR-010, Verbatim Constraints). Invalid numbers mean no highlight. |
| `#/sessions/:id/description` | none | |
| `#/sessions/:id/issues/:platform/:key` | none | |
| `#/sessions/:id/ask` | existing query | |

The **route key** used for scroll in 4.1 is the route name plus its identifying parameters (for example `diff?path=src/a.ts`), without `return`.

Code view range rendering: every row from `start` to `end` that exists is marked `aria-current="true"` and scrolled so `start` is in view. Lines past the end of the file show the notice "Lines a–b are past the end of this file (it has n lines)."; a commit that is no longer available shows its reason as a state, not an error (R9, edge case).

### 4.7 Live-update stream (memory, owned by the review shell)

One stream per open session, shared by every screen (R5).

| State | Meaning | Banner |
|---|---|---|
| `connecting` | `EventSource` created, not yet open | none |
| `open` | receiving events | none |
| `retrying` | an error was reported; the browser is retrying; inside the 5-second grace period | none |
| `dropped` | not open again within 5 seconds of an error, or `readyState` is `CLOSED` | `Live updates paused — Reconnect` |

Transitions: `connecting → open` on `open`; `open → retrying` on `error`; `retrying → open` on `open` within 5 s; `retrying → dropped` after 5 s; any state `→ dropped` on `CLOSED`; `dropped → connecting` on Reconnect, which closes the old stream, opens a new one, and refetches the session detail and questions. The banner clears on the first `open` (FR-030).

### 4.8 Async region state (memory, `AsyncRegion` component)

The condition of any area that loads data (FR-028, FR-029).

| Value | Carries | Shows |
|---|---|---|
| `loading` | none | a loading indicator with the region's name |
| `loaded` | the data | the content |
| `empty` | an explanation and, where useful, a next step | for example `No open pull requests in <base folder>` |
| `failed` | `reason`, `retry()` | what failed and Retry; never an empty list |
| `unknown` | `reason` | that the workbench could not check (for example an AI provider check that did not answer) |
| `stale` | the data and what it is stale against | the content with a stale badge |

Transitions: `loading → loaded | empty | failed | unknown`; `failed → loading` on Retry; `loaded | empty → loading` on a refetch; `loaded → stale` when newer data is known to exist (for example the head moved). The session list, AI provider check and suggested questions, which today swallow failures, use this state. Each dashboard `PullGroup` maps to its own region (`failed` from the group's `status`).

### 4.9 Badge (presentation)

A semantic label shown as text, an `aria-hidden` glyph and a colour pair meeting AA contrast in both themes (FR-009, FR-044, R8). The kinds, attributes, text and glyphs are fixed in [contracts §4.4](contracts/interfaces.md). Claims carry `data-label` and completeness badges carry `data-status` on the badge element itself. The parent `li` elements keep their 001 attributes. The visible text is the label as written, with no uppercase transform.

### 4.10 Limit display (memory, `units.ts`)

Setup shows limits in human units inside the collapsed `Advanced limits` section, with defaults visible (FR-035).

| Config field | Shown as | Conversion |
|---|---|---|
| `maxFileBytes` | KB | 1 KB = 1024 bytes. Shown rounded to whole KB; the input accepts whole KB ≥ 1 and is sent as bytes. |
| `maxChangedLines` | lines | as is |
| `maxPromptChars` | characters | as is, with thousands separators |

Round-tripping a default value through display and back yields the same stored number.

### 4.11 Connection check (memory, Setup)

One row of the checklist shown after a successful save (FR-037, R18). Built in the browser from `GET /api/workspace`, `GET /api/signins` and `GET /api/provider`; no new server check.

| Field | Type | Rules |
|---|---|---|
| `id` | `'base-folder' \| 'repositories' \| 'signin:<platform>' \| 'ai-provider'` | One `signin:` row per configured platform (source control and tracker separately, approved proposal 12). |
| `status` | `'ok' \| 'failed' \| 'not-checked'` | `not-checked` shows "? not checked yet" with `waitsFor`, never ✓ (approved proposal 11). |
| `detail` | string | What was found, such as "12 repositories found, 2 skipped". |
| `nextStep` | string? | Present when not `ok`, such as "Sign in to <display name>". Uses descriptor display names, never a hard-coded platform. |
| `waitsFor` | string? | Present only when `not-checked`. |

### 4.12 Announcement (memory, `announcer.ts`)

One polite live region per page, the static `#live-region` in `index.html` (FR-031, R17).

| Source | Rule |
|---|---|
| Scope change | Announced at once with the scope-bar text. |
| Streaming answer | At most one announcement every 2 seconds, containing only the text added since the last one, then "Answer complete" when the stream ends. |

## 5. Requirement trace

| Entity | Requirements |
|---|---|
| Workspace configuration | FR-034, FR-036, FR-048, FR-058 |
| `settingsFields`, `repositoryForRemote` | FR-034, FR-050, VIII.2 |
| Workspace, Discovery run, Discovered entry | FR-049, FR-050, FR-051, FR-056, SC-010 |
| PullGroup, PullSummary.repository | FR-052, FR-053, FR-054 |
| `repositoryAvailable`, `repository_unavailable` | FR-057 |
| Review session view state | FR-017, FR-018, FR-055, SC-002 |
| Dashboard view state | FR-053, FR-055 |
| Diff selection | FR-006, FR-007, FR-008, FR-047 |
| Panel, Width band | FR-019, FR-020, FR-021, FR-024 |
| Route | FR-010, FR-023, FR-038, SC-004 |
| Live-update stream | FR-030 |
| Async region state | FR-028, FR-029, FR-054 |
| Badge | FR-009, FR-044 |
| Limit display, Connection check | FR-035, FR-037 |
| Announcement | FR-007, FR-031 |
