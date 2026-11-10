# Contracts: PR Review Workbench UI Redesign

What this feature exposes, and what unit, contract, end-to-end and browser tests code against. It amends, and does not replace, `specs/001-pr-review-workbench/contracts/ui.md`, `http-api.md` and `provider-contracts.md`. Anything not named here keeps its 001 contract. Identifiers in backticks are exact. "R" numbers point into [research.md](../research.md).

## 0. Verbatim constraints

Copied exactly from the spec's Verbatim Constraints. Every other section uses these values unchanged.

| Constraint | Value |
|---|---|
| Diff row | `class="diff-line"` with `data-type` (`add`, `remove`, `context`) and `aria-selected` |
| Badge attributes, on the badge element itself | `data-label` (claims), `data-status` (completeness) |
| Code route range | accepts `start` and `end`; a link with only `line` keeps working |
| Ask form labels | `Your question`, `Category`, `Answer for` |
| Answer-for choices | `Technical`, `Business`; default `Technical` |
| Scope bar text | `Selected: <path> lines a–b (new side)` (or `old side`) |
| Actions | `Ask about this PR`, `Ask about selection`, `Start review`, `Resume review`, `Open full page`, `New commits — Refresh` |
| Live-update banner | `Live updates paused — Reconnect` |
| Home empty state | `No open pull requests in <base folder>` |
| Dashboard and workspace copy | `Back to dashboard`, `Rescan`, `Your review sessions`, `Open pull requests`, `Base folder` |
| Review navigation | `Overview`, `Files`, `Questions`, `Sources` |
| Setup section | `Advanced limits` |
| Overview reserved region | `Review focus`, with the line `Not available yet.` |
| Narrow file navigation | `‹ Previous file`, `Next file ›`, `All changed files` |
| New-capability label | `[NEW]` |
| Existing `data-testid` values that stay | every value in `specs/001-pr-review-workbench/contracts/ui.md`, including `delete-session-confirm`, `scope-indicator`, `diff-line-head-<n>`, `diff-line-base-<n>`, `claim`, `claim-ref`, `answer-for-technical`, `answer-for-business` |
| The one deliberate test-id change | `pr-item-<number>` becomes `pr-item-<repository>-<number>` |

The `−` in the diff mark and the `–` in the scope bar are U+2212 and U+2013. The `—` in `New commits — Refresh` and `Live updates paused — Reconnect` is U+2014.

## 1. Browser routes

Hash routes, as in 001. Every 001 route keeps working as a deep link with the same content (FR-023). Panels add no new route; panel state lives in view state (§3, R6).

| Route | Screen | Change |
|---|---|---|
| `#/` | Home dashboard: `Your review sessions`, then `Open pull requests` across every matched repository, most recently updated first (FR-039, FR-052) | changed |
| `#/setup` | Base folder, platform, issue tracker, `Advanced limits`, discovery result with `Rescan`, connection checklist | changed |
| `#/signin?return=<hash>` | Sign-in, one form per configured platform; returns to `return` after success (FR-038, R15) | `return` new |
| `#/sessions/:sessionId` | Overview. Review navigation `Overview` | layout changed |
| `#/sessions/:sessionId/diff?path=<path>` | Files. Review navigation `Files` links here with the last viewed path in this session, else the first changed file | layout changed |
| `#/sessions/:sessionId/code?snapshot=<snapshotId>&side=head\|base&path=<path>&start=<a>&end=<b>` | Code full page; rows `a` to `b` highlighted, `a` scrolled into view (FR-010, R9) | `start`, `end` new |
| `#/sessions/:sessionId/code?…&line=<n>` | Read as `start=n&end=n` (Story 3 #5) | unchanged |
| `#/sessions/:sessionId/ask` | Questions full page; also the narrow-band target of `Ask about selection` and `Ask about this PR`. Review navigation `Questions` | layout changed |
| `#/sessions/:sessionId/description` | Description. Review navigation `Sources` lands here, with a sub-navigation of every linked issue, missing ones included | layout changed |
| `#/sessions/:sessionId/issues/:platform/:key` | Issue, under `Sources` | layout changed |

Route rules (pure functions in `src/ui/state/routes.ts`, R2):

- `start` and `end` are positive integers with `start <= end`. Missing `end` means `end = start`. Invalid values show the file with no highlight.
- `return` is accepted only when it starts with `#/`, parses to a route in this table, and is not a `#/signin` or `#/setup` route. Anything else returns to `#/`.
- A `signin_required` response from any API call navigates to `#/signin?return=<encodeURIComponent(current hash)>`.

## 2. Width bands

One definition, in `src/ui/state/layout.ts` and the same three media queries in `app.css` (R6).

| Band | Query | File list | Ask and Evidence |
|---|---|---|---|
| `wide` | `(width >= 1200px)` | collapsible left region | side panel beside the content |
| `medium` | `(900px <= width < 1200px)` | drawer | non-modal overlay `aside` |
| `narrow` | `(width < 900px)` | `‹ Previous file`, `Next file ›`, `All changed files` above the diff | navigates to the full-page route |

A resize into `narrow` with a panel open replaces the hash with that panel's full-page route and keeps the draft.

## 3. View state in browser storage

Kept only in `sessionStorage` of the current tab, never sent to the server, never holding a credential (FR-017, FR-055, X.7, R3). Read and written only by `src/ui/state/view-state.ts`, which imports nothing from `src/ui/api.ts`.

| Key | Holds |
|---|---|
| `prwb:view:<sessionId>` | one review session's view state |
| `prwb:view:dashboard` | the dashboard's view state |

```ts
type SessionViewState = {
  v: 1;
  draft: string;                                   // question text
  category: Category;                              // default 'what', as today
  answerFor: 'technical' | 'business';             // default 'technical' (FR-018)
  scope: Scope;                                    // 001 Scope: pr | file | range with side, lines, label
  scroll: Record<string, number>;                  // per route key (hash without query noise), pixels
  panel: { kind: 'ask' } | { kind: 'evidence'; ref: Ref } | null;
  lastDiffPath?: string;
};

type DashboardViewState = {
  v: 1;
  text: string;                                    // text filter
  repository: string | null;                       // repository filter; null = all
  scroll: number;
};
```

Any other field is dropped on write and on read. A value that fails validation, or has another `v`, reads as the defaults. Unit tests assert the stored JSON holds only these keys.

## 4. DOM contract

### 4.1 Page frame (every page)

| Element | Contract |
|---|---|
| Skip link | first focusable element, text `Skip to content`, `href="#main"`; `<main id="main" tabindex="-1">` |
| App header | `<header data-testid="app-header">`: product name as a plain link to `#/` (not a heading), `workspace-identity` (`Base folder` value and platform display name), `connection-state` with `data-state` = `signed-in`, `signin-required` or `provider-unavailable`, and the settings disclosure `settings-menu-button` (`aria-expanded`, `aria-controls`) holding links to Setup and Sign-in |
| Headings | exactly one `h1` per page, naming the page (Home, Setup, Sign in, Overview, the file path, Questions, Description, the issue key); panels use `h2` |
| Live region | one static `<div id="live-region" data-testid="live-region" aria-live="polite">` per page, in `index.html`, present with or without the shell; scope changes announced at once, streaming answer text at most every 2 seconds, then `Answer complete` (FR-031, R17) |

### 4.2 Review shell (every `#/sessions/:sessionId…` page)

| Element | Contract |
|---|---|
| Back link | `<a data-testid="back-to-dashboard" href="#/">`, text `‹ Back to dashboard`, above the PR title |
| Review header | `data-testid="review-header"`: repository, `#<number> <title>`, author, source → target branch, `session-status` (unchanged, `data-status` = PR status), short head commit with snapshot time, `context-version` (unchanged), `refresh-button` (unchanged; text `New commits — Refresh` when `headMoved`), `read-only-notice` (unchanged) |
| Unavailable reason | when Refresh or Ask is unavailable (read-only PR, provider unavailable, repository no longer found) the reason is shown beside the control; `repository-unavailable` holds the repository reason (FR-057) |
| Session actions | disclosure `session-actions-button` (`aria-expanded`, `aria-controls`) holding `close-session-button` and `delete-session-button` (both unchanged ids, FR-032) |
| Review navigation | `<nav aria-label="Review" data-testid="review-nav">` with links `Overview`, `Files`, `Questions`, `Sources`; the current one has `aria-current="page"`. `Questions` link: `data-testid="review-nav-questions"` with `data-count` and `data-running="true\|false"`. `ask-about-pr` (`Ask about this PR`) sits here on every tab except Files |
| Context strip | `data-testid="context-strip"`: one link per completeness row to its details on Overview; never contains `ready`, `safe` or `approved` (FR-016) |
| Live-update banner | `data-testid="live-updates-banner"`, `role="status"`, text `Live updates paused — Reconnect`, button `reconnect-button`. Shown when the stream errors and is not open again within 5 seconds, or is `CLOSED` (R5) |
| Session gone | `data-testid="session-unavailable"` with a link to `#/` when the session is deleted or closed elsewhere |

### 4.3 Diff (Files)

```html
<tr class="diff-line" data-type="add|remove|context" aria-selected="true|false">
  <td><button data-testid="diff-line-base-<n>" tabindex="0|-1">n</button></td>   <!-- old number; absent button on add rows -->
  <td><button data-testid="diff-line-head-<n>" tabindex="0|-1">n</button></td>   <!-- new number; absent button on remove rows -->
  <td class="diff-mark" aria-hidden="true">+ | − | (space)</td>
  <td class="diff-text">…</td>                                                   <!-- white-space: pre -->
</tr>
```

- One Tab stop for the whole diff (roving `tabindex`). ↑/↓ move within a side, ←/→ switch side on the same row when that side has a number. Enter or Space sets the anchor, or completes a range on the same side. Shift+↑/↓ extends. Escape clears (FR-006, R7).
- A selection stays on one side; choosing a line on the other side starts a new one. A context line is selectable on the new side only.
- Selected rows: `aria-selected="true"`, a left selection bar and the selected background (FR-008).
- Scope bar: `data-testid="scope-indicator"` (unchanged id) reads `Selected: <path> lines a–b (new side)` or `Selected: <path> lines a–b (old side)` for a range, with `a = b` for one line. PR and file scopes keep their 001 text. `scope-label-input` and `scope-whole-file` are unchanged. `ask-about-selection` (`Ask about selection`) appears when a range is selected (FR-022).
- File list: `data-testid="file-list"`, filter `file-filter` (`<input type="search">` with a visible label), empty result `file-filter-empty` with `file-filter-clear`. Rows keep `changed-file-<path>`. In the wide band, the button `file-list-toggle` (`aria-expanded`) collapses and expands the region and keeps focus.
- Narrow navigation: `prev-file` (`‹ Previous file`), `next-file` (`Next file ›`), `all-changed-files` (`All changed files`).
- Binary, no-textual-change and skipped files show `skipped-file-<path>` (unchanged, `data-reason`) or `diff-no-text` with the reason.

### 4.4 Badges

```html
<span class="badge" data-kind="<kind>" data-label="…" | data-status="…">
  <span aria-hidden="true">glyph</span>Text
</span>
```

| `data-kind` | Attribute and values | Text | Glyph |
|---|---|---|---|
| `claim` | `data-label` = `evidence`, `inference` | `Evidence`, `Inference` | ✓, ≈ |
| `intent` | `data-intent` = `documented`, `inferred` | `Documented intent`, `Inferred intent` | ✎, ≈ |
| `completeness` | `data-status` = `found`, `missing`, `stale` | `found`, `missing`, `stale` (001 display labels) | ✓, ✕, ⟳ |
| `skipped` | `data-reason` = the 001 `SkipReason` | the reason | ⊘ |
| `unresolved` | | `Unresolved` and the reason | ? |
| `older-head` | | `Older head` and the short commit | ⟲ |
| `read-only` | | `Read-only` | 🔒︎ |
| `pr-status` | `data-status` = `open`, `closed`, `merged` | the status word | ● |

The enclosing `claim` and `completeness-row-*` elements keep their 001 attributes as well (R8). Badges are not uppercased by CSS.

### 4.5 Code view

- `data-testid="code-view"` (unchanged) wraps the table in `div.code-scroll` (`overflow-x: auto`); cells use `white-space: pre` (FR-011).
- Each row in `start…end` has `aria-current="true"` and the cited class; `code-line-<n>` is unchanged.
- A range past the end shows `data-testid="code-range-notice"`: `Lines a–b are past the end of this file (it has n lines).` A commit no longer available shows `async-code` with `data-state="unknown"` and its reason, as a state, not an error.

### 4.6 Ask form (full page and panel)

| Element | Contract |
|---|---|
| Question | `<label for>` text `Your question` on `question-input` (unchanged id) |
| Category | `<fieldset>` with `<legend>Category</legend>`; choices keep `category-<value>` |
| Answer for | `<fieldset>` with `<legend>Answer for</legend>`; choices `answer-for-technical` (`Technical`, default) and `answer-for-business` (`Business`). Replaces 001's `Answer for:` label |
| Ask button | `ask-button` (unchanged id). Unavailable: `aria-disabled="true"` (stays focusable) and `aria-describedby` → `ask-unavailable-reason`, which states why (empty question, provider unavailable, read-only, repository unavailable) |
| Submit failure | `data-testid="ask-error"`, `role="alert"`; the field it concerns gets `aria-invalid="true"` and `aria-describedby` → the error |

### 4.7 Panels

| Element | Contract |
|---|---|
| Ask panel | `<aside data-testid="ask-panel" aria-labelledby>` with `<h2 tabindex="-1">`; scope filled in; focus moves to the `h2` on open (FR-020) |
| Evidence panel | `<aside data-testid="evidence-panel">`, `h2` focused on open; shows the cited code (full range highlighted), issue or description, and `open-full-page` (`Open full page`) linking the existing route (FR-021) |
| Close | `panel-close` button and Escape; focus returns to the opener, and the thread keeps its scroll and Answer-for choice |

### 4.8 Delete confirmation

Native `<dialog data-testid="delete-session-dialog">` opened with `showModal()`. It states what is lost (questions, answers, summaries and snapshots of this session). `delete-session-cancel` (`Cancel`) has focus on open. `delete-session-confirm` (unchanged id) is the danger-styled `Delete`. Escape or Cancel deletes nothing and returns focus to `session-actions-button` (FR-033).

### 4.9 Async regions

Every data-loading region is `<section class="async-region" data-testid="async-<region>" data-state="loading|empty|failed|unknown|stale">`. `failed` shows what failed and `retry-<region>`. Region names: `sessions`, `pulls`, `provider`, `suggestions`, `summaries`, `questions`, `diff`, `code`, `workspace`, `signins` (FR-028, FR-029).

### 4.10 Overview

Order: `pr-summary`, `completeness` (expandable rows, unchanged ids), `file-list`, referenced PRs, then `review-focus` with heading `Review focus` and only the line `Not available yet.` (FR-025, FR-027). Per-file summaries `file-summary-<path>` are disclosed by `file-explanation-<path>` (`aria-expanded`).

### 4.11 Home dashboard

| Element | Contract |
|---|---|
| Filters | `dashboard-filter` (text) and `dashboard-repository-filter` (`<select>`, `All repositories` first); over loaded items only; values kept in `prwb:view:dashboard` |
| Sessions | heading `Your review sessions`; `session-list`, `session-item-<sessionId>` (unchanged). A session whose repository is no longer found shows `Open (read only)` |
| Open PRs | heading `Open pull requests`; `pr-list` (unchanged); rows `pr-item-<repository>-<number>`, where `<repository>` is the platform repository id as stored (for example `pr-item-acme/payments-api-482`). Each row shows repository, number, title, author, branches, updated time and `start-review` (`Start review`) or `resume-review` (`Resume review`). Starting busies only that row (`aria-busy="true"`) |
| One repository failing | `pr-group-failed-<repository>` with the reason and `retry-pulls-<repository>`; other rows still show (FR-054) |
| Empty | `dashboard-empty`: `No open pull requests in <base folder>`; filter with no match: `dashboard-filter-empty` with `dashboard-filter-clear`; no repositories under the base folder, or none on the chosen platform: `dashboard-no-repositories` saying so, linking to `#/setup` |
| Skipped | `skipped-repositories`: the count, linking to `#/setup` |

### 4.12 Setup

| Element | Contract |
|---|---|
| Base folder | `setup-base-folder`, label `Base folder` |
| Platform | `setup-platform` (`<select>`); `setup-base-url` (unchanged id) only when the descriptor has `needsBaseUrl` |
| Tracker | `setup-tracker` (`<select>`); `setup-site` and `setup-project-keys` only when the tracker descriptor's `settingsFields` lists `site` or `projectKeys` |
| Limits | `<details data-testid="advanced-limits">` with summary `Advanced limits`, collapsed by default; values in KB and lines with defaults shown |
| Errors | each server error at its field (`aria-invalid`, `aria-describedby`) and in `setup-error` (unchanged id) at the top of the form as a summary with links to the fields |
| Discovery | `discovery-result` with `data-state` = the discovery state (§5.2); `discovery-progress` (folders scanned) and `discovery-cancel` while scanning; `rescan-button` (`Rescan`); rows `discovered-repo-<repository>` (folder used), `duplicate-folder-<folder>`, `skipped-folder-<folder>` with `data-reason` |
| Checklist | `connection-checklist`; rows `check-base-folder`, `check-repositories`, `check-signin-<platform>`, `check-provider`, each with `data-status` = `ok`, `failed` or `not-checked` and its next step (R18) |

### 4.13 Sign-in

`signin` and `signin-form-<platform>` are unchanged. The page states why sign-in is needed, for which platform, and that access is read-only. After success it navigates to the accepted `return` route (§1).

## 5. HTTP API changes

Amends 001 `http-api.md`. Routes not listed are unchanged. New routes pass the existing guard; every non-GET carries the Origin check (X.5).

### 5.1 Configuration

```ts
type Config = {
  workspace: { baseFolder: string; platform: PlatformId; baseUrl?: string };   // replaces `repository` (R10)
  issueTracker: { platform: PlatformId; site?: string; projectKeys?: string[] };
  limits: ConfigLimits;
  logRetentionDays: number;
};

type ConfigBody = {
  workspace: Config['workspace'];
  issueTracker: Config['issueTracker'];
  limits?: Partial<ConfigLimits>;
  logRetentionDays?: number;
};
```

| Method | Path | Change |
|---|---|---|
| GET | `/api/config` | Returns the new shape. A stored config in the old `repository` shape returns `200 null` (not configured) |
| PUT | `/api/config` | Takes the new shape. `baseFolder` must be absolute, an existing directory, and neither contain nor sit inside the application-data folder. `baseUrl` is required when the platform declares `needsBaseUrl`. A tracker field the tracker does not declare in `settingsFields` is `400 invalid_request` naming the field; a declared `site` that is missing is `400 invalid_request`. A successful save starts discovery (cancelling any running scan) |
| GET | `/api/platforms` | `descriptors[]` carry `settingsFields` (§6.2) |

### 5.2 Workspace and discovery (new)

```ts
type DiscoveryState = 'idle' | 'scanning' | 'complete' | 'cancelled' | 'failed';

type Workspace = {
  baseFolder: string;
  platform: PlatformId;
  baseUrl?: string;
  discovery: { state: DiscoveryState; foldersScanned: number; reason?: string };   // reason when 'failed'
  matched: { repository: string; folder: string; duplicateFolders: string[] }[];   // one per platform repository id
  skipped: { folder: string; reason: 'no-remote' | 'no-matching-remote' | 'remotes-unreadable'; detail?: string }[];
};
```

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/workspace` | | `200 Workspace`; `409 not_configured` before set-up. The UI polls it once a second while `discovery.state` is `scanning` |
| POST | `/api/workspace/rescan` | | `202 Workspace` (state `scanning`); cancels a running scan first |
| POST | `/api/workspace/cancel` | | `202 Workspace` (state `cancelled`); repositories found so far are kept. No scan running: `200 Workspace` unchanged |

`folder` values are absolute paths. A clone that matches two repositories (a fork and its upstream) appears under both. The `folder` used is the clone nearest the base folder (fewest path segments), ties broken by code-point order of the path (FR-051).

### 5.3 Pull requests and sessions

```ts
type PullSummary = 001 PullSummary & { repository: string };

type PullGroup = {
  repository: string;
  status: 'loaded' | 'failed';
  reason?: string;                                  // when 'failed'
  pulls: PullSummary[];                             // empty when 'failed'
};

type SessionSummary = 001 SessionSummary & {
  repositoryAvailable: boolean;                     // false when no clone under the base folder (FR-057)
  repositoryReason?: string;
};
```

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/pulls` | | `200 PullGroup[]`, one per matched repository, listed in parallel; one repository's failure is that group's `failed` status (V.4). `409 signin_required` and `409 not_configured` still apply to the whole call |
| GET | `/api/pulls?repository=<id>` | | `200 PullGroup` for that repository (Retry). Unknown repository: `404 not_found` |
| POST | `/api/sessions` | `{ repository: string; prNumber: number }` | as 001. `repository` must be a matched repository: otherwise `409 repository_unavailable` |
| POST | `/api/sessions/:sessionId/refresh` | | as 001, plus `409 repository_unavailable` |
| POST | `/api/sessions/:sessionId/questions` | `AskBody` | as 001, plus `409 repository_unavailable` |

`SessionDetail` inherits the two new fields from `SessionSummary`. Reading a session (`GET /api/sessions/:sessionId`, snapshots, diff, file, summaries, questions) works whatever `repositoryAvailable` is.

### 5.4 Errors

| `code` | Status | Meaning |
|---|---|---|
| `repository_unavailable` (new) | 409 | the session's repository is not found under the base folder; `message` is the reason |
| `not_configured` | 409 | no workspace configured, including a config file in the old `repository` shape |

## 6. Adapter contract changes

Amends 001 `provider-contracts.md`.

### 6.1 `SourceControlProvider.repositoryForRemote` (new)

```ts
interface SourceControlProvider {
  // … every 001 method unchanged …
  /**
   * The platform repository id for a remote already passed through `normaliseRemote`
   * (`host/path`, no scheme, user, port or `.git`, case-folded), or null when the remote
   * is not on this platform. Pure: no network call. The inverse of `cloneLocations`.
   */
  repositoryForRemote(normalisedRemote: string): string | null;
}
```

Every adapter passes the shared contract suite (`test/contract/source-control.suite.ts`), which checks for each adapter: for every `repo`, every value of `cloneLocations(repo)` maps back to `repo.id`; a remote on another host returns `null`; a self-hosted adapter matches only its configured base address host.

### 6.2 `AdapterDescriptor.settingsFields` (new)

```ts
type AdapterDescriptor = {
  // … 001 fields, including needsBaseUrl …
  settingsFields?: readonly ('site' | 'projectKeys')[];   // tracker settings Setup renders (R14)
};
```

Setup renders exactly the declared fields and names no platform (VIII.2). `test/unit/platform-names.test.ts` keeps guarding `src/ui` and `src/core`.

## 7. Test commands

| Script | Command | Behaviour |
|---|---|---|
| `test` (unchanged) | `node --test "test/**/*.test.ts"` | Includes the new `test/unit/ui-*.test.ts`, `test/unit/discovery.test.ts` and `test/integration/discovery-safety.test.ts`. Does not start a browser |
| `test:ui` (new) | `node --test "test/ui/*.ui.ts"` | Starts the workbench (`test/helpers/server.ts`, fake AI CLI, recorded fetch) and Chromium (`test/helpers/browser.ts`). Runs axe with `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` in light and dark, and widths 400, 1000 and 1440 asserting `document.documentElement.scrollWidth <= innerWidth` (R1) |

Dev-only dependencies: `playwright`, `@axe-core/playwright`. No runtime dependency is added.

## 8. Pure UI modules

Plain TypeScript under `src/ui/state/`, imported directly by `test/unit/ui-*.test.ts` (R2).

| Module | Exports tests code against |
|---|---|
| `selection.ts` | `type Selection`; `anchor(sel, side, line)`, `extend(sel, delta)`, `clear()`, `move(focus, key, rows)`; one side per selection |
| `view-state.ts` | `readSession(id)`, `writeSession(id, patch)`, `readDashboard()`, `writeDashboard(patch)`, `SESSION_KEY(id)`, `DASHBOARD_KEY` |
| `routes.ts` | `parseRoute(hash)`, `buildRoute(route)`, `codeHref(sessionId, snapshotId, ref)` (emits `start` and `end`), `safeReturn(value)` |
| `layout.ts` | `type Band = 'wide' \| 'medium' \| 'narrow'`; `bandFor(width)`, `BAND_QUERIES` |
| `announcer.ts` | `createAnnouncer(write, { intervalMs })` with `now(text)`, `stream(text)`, `done()` |
| `units.ts` | `formatBytes(n)` (KB), `parseKilobytes(text)`, `formatLines(n)` |
