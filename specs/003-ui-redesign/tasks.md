# Tasks: PR Review Workbench UI Redesign

**Input**: [plan.md](plan.md), [ui-redesign.spec.md](ui-redesign.spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/interfaces.md](contracts/interfaces.md), [wireframes/](wireframes/index.html)

**Scale note**: About 60 files across four areas: the server's config, discovery and session environment; every UI screen; the stylesheet; and a new browser test suite. Each file has exactly one owner phase, with one exception: Phase 7 rebuilds `src/ui/screens/overview.tsx`'s content, and Phase 11, which always runs after it, removes the old PR header block from it when the shell takes over (T077). That keeps Close, Delete and the `POST /open` call working between the two phases. File ownership decides two things the story order alone would not:

- **The review shell is built last among the P2 phases.** It mounts the panel host (Story 6), the live-update banner (Story 8) and the session-actions menu (Story 9), so those phases build their pieces first and the shell phase (Story 5) joins them. Their browser tests are written first and pass once Phase 11 lands.
- **Shared pieces are built in Phase 2**: copy, styles, wire types, the API client, view state, routes, badges, async regions, the file list and the review context. Story phases import them and never edit them.

Watch the wire changes in Phase 6. `/api/config`, `/api/pulls` and `POST /api/sessions` change shape, and the existing tests that use the old shapes change in the same phase.

**Story 1 (wireframes, FR-001 to FR-004) is done.** The wireframes were approved on 2026-11-09 ([approval.md](wireframes/approval.md)). Plan and tasks cover Stage 2 only.

**Tests**: The constitution (XI) asks for test-first work. In each phase, write the `### Tests` tasks first and watch them fail. Browser tests (`test/ui/*.ui.ts`) run with `npm run test:ui`. Unit, contract, integration and end-to-end tests run with `npm test`.

Format: `- [ ] **T###** [P?] [US#] Description · file`. `[P]` means the task is independent of the others in its wave.

---

## Phase 1: Setup

**Wave 1:**

- [x] **T001** Add `playwright` and `@axe-core/playwright` as devDependencies and a `test:ui` script running `node --test "test/ui/*.ui.ts"` (R1, contracts §7) · package.json

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T002** Browser helper: start the workbench through `test/helpers/server.ts` with the fake AI CLI and recorded fetch, launch Chromium, and export `openPage(hash, { width, colorScheme })`, `checkA11y(page)` (axe tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) and `assertNoPageScroll(page)` (`scrollWidth <= innerWidth`) · test/helpers/browser.ts

---

## Phase 2: Foundational (blocks every story)

**Wave 1 — independent (different files):**

- [x] **T003** [P] Add every verbatim string from contracts §0 and the badge texts from contracts §4.4 (U+2212, U+2013 and U+2014 exactly as written) · src/ui/labels.ts
- [x] **T004** [P] Route module with unit tests first: `parseRoute`, `buildRoute`, `routeKey`, `askHref` and `scopeFromQuery` (moved here from ask.tsx), `codeHref` emitting `start` and `end`, a `line`-only link read as `start = end = line`, invalid numbers giving no range, and `safeReturn` accepting only parsed app routes that are not `#/signin` or `#/setup` (R9, R15, data-model §4.6) · src/ui/state/routes.ts, test/unit/ui-routes.test.ts
- [x] **T005** [P] View-state store with unit tests first: `readSession`, `writeSession`, `clearSession`, `readDashboard`, `writeDashboard`, keys `prwb:view:<id>` and `prwb:view:dashboard`, `v: 1`, allowlisted fields only, per-field fallback on bad values, draft capped, 50 scroll entries at most, blocked storage falling back to memory, no import from api.ts. Include a test that the stored JSON holds only allowlisted keys (R3, data-model §4.1–4.2, X.7) · src/ui/state/view-state.ts, test/unit/ui-view-state.test.ts
- [x] **T006** [P] Width bands with unit tests first: `type Band`, `bandFor(width)` at 899/900/1199/1200, `BAND_QUERIES` (R6) · src/ui/state/layout.ts, test/unit/ui-layout.test.ts
- [x] **T007** [P] Announcer with unit tests first: `createAnnouncer(write, { intervalMs })` with `now`, `stream` (at most once every 2 s, only the text added since the last announcement) and `done` ("Answer complete"), using `node:test` mock timers (R17) · src/ui/state/announcer.ts, test/unit/ui-announcer.test.ts
- [x] **T008** [P] Wire types: `Config.workspace` replacing `repository`, `ConfigBody`, `Workspace`, `DiscoveryState`, `PullSummary.repository`, `PullGroup`, `SessionSummary.repositoryAvailable` and `repositoryReason`, `CreateSessionBody.repository`, error code `repository_unavailable` (contracts §5) · src/contracts/http.ts
- [x] **T009** [P] Add `settingsFields?: readonly ('site' | 'projectKeys')[]` to `AdapterDescriptor` (R14) · src/contracts/shared.ts
- [x] **T010** [P] Add one static `<div id="live-region" data-testid="live-region" aria-live="polite">` so every page has exactly one live region, with or without the shell · src/ui/index.html
- [x] **T011** [P] Styles, part 1: colour tokens in both theme blocks (new triples for skipped, unresolved, older head, read-only and each PR status, each pair at 4.5:1 or better), `--selected-bar`, the three band media queries, diff rows (`.diff-line[data-type]`, mark cell, `[aria-selected="true"]` with the inset bar, visible focus on line buttons), badges with no uppercase transform, `div.code-scroll` and `white-space: pre`, Ask form fieldsets and error states, `prefers-reduced-motion`, 24×24 px minimum targets (R7, R8, R9) · src/ui/app.css
- [x] **T012** [P] Shared test data: open PRs for three repositories plus one that answers 500, an issue number that exists in two of those repositories with different content, a PR with 32 changed files, an issue and a PR description containing HTML and markdown, and a fake-AI answer with an Evidence claim citing lines 45–50. Register them with the recorded fetch · test/fixtures/github/ (new files), test/helpers/recorded-fetch.ts, test/fixtures/fake-claude/fake-claude.mjs

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] **T013** [P] API client: `listPullGroups(repository?)` replacing `listPulls`, `getWorkspace`, `rescanWorkspace`, `cancelDiscovery`, `createSession(repository, prNumber)`. Send `signin_required` to `#/signin?return=<encoded current hash>`. Have `subscribeSession` report `open`, `error` and `readyState` so the live-stream model can tell a blip from a drop (contracts §1, §5, R5, R15) · src/ui/api.ts
- [x] **T014** [P] `Badge` component: `<span class="badge" data-kind>` with `data-label`, `data-status`, `data-intent` or `data-reason` on the badge itself, an `aria-hidden` glyph and the visible text, for every kind in contracts §4.4 · src/ui/components/badge.tsx
- [x] **T015** [P] `AsyncRegion` component: `<section class="async-region" data-testid="async-<region>" data-state>` covering loading, empty (explanation and next step), failed (reason and `retry-<region>`), unknown and stale (content with a Stale badge) (data-model §4.8, contracts §4.9) · src/ui/components/async-region.tsx
- [x] **T016** [P] Disclosure menu: a button with `aria-expanded` and `aria-controls` holding links and buttons, closing on Escape with focus back on the button. It does not use the ARIA `menu` role (R16) · src/ui/components/disclosure-menu.tsx
- [x] **T017** [P] Styles, part 2: app header, skip link, review header, review navigation, context strip, live-updates banner, panels (beside in wide, overlay in medium), native dialog with a danger confirm, file-list region and drawer, dashboard rows and filters, Setup sections and checklist, async-region states (contracts §4.1–4.12, wireframes) · src/ui/app.css

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — independent (different files):**

- [x] **T018** [P] `FileList` component: rows keep `changed-file-<path>` and show status, +/− counts and a skipped reason as a Badge. Filter `file-filter` (`type="search"`, visible label), empty result `file-filter-empty` with `file-filter-clear`, and an optional per-row explanation render prop disclosed by `file-explanation-<path>` with `aria-expanded` (FR-024, FR-025, FR-026, FR-044) · src/ui/components/file-list.tsx
- [x] **T019** [P] Review context: a Preact context created in plain `.ts`, holding `session?`, `subscribe(handlers)`, `announce(text)`, `openAsk(scope, openerId)` and `openEvidence(ref, openerId)`. The defaults work without a shell: `subscribe` opens its own `subscribeSession`, `announce` writes to `#live-region` through the announcer, and the two `open*` functions navigate to the full-page routes from routes.ts (R4, R6) · src/ui/state/review-context.ts

**Checkpoint**: Every shared module exists and its unit tests pass. Story phases can start, in parallel where the dependency section allows.

---

## Phase 3: User Story 2 — Read a diff and select a range by mouse or keyboard (P1) 🎯 MVP

**Goal**: Added, removed and selected lines are distinct without relying on colour, and a range can be selected entirely by keyboard.

**Independent Test**: Open a session's diff, select new-side lines 10–14 using only the keyboard, and check the marks, the selection bar, the scope bar text, the live-region announcement and the range Ask receives.

Files: src/ui/state/selection.ts, src/ui/screens/diff.tsx

### Tests

**Wave 1 — independent (different files):**

- [x] **T020** [P] [US2] Selection unit tests: anchor, extend, clear, cursor movement (↑/↓ within a side, ←/→ only where the other side has a number), one side per selection, a line on the other side starting a new selection, context lines selectable on the new side only, a second click extending a single-line selection, and the scope text `Selected: <path> lines a–b (new side)` / `(old side)` · test/unit/ui-selection.test.ts
- [x] **T021** [P] [US2] Browser test: `data-type`, `+`/`−` marks and backgrounds in light and dark. The diff is one Tab stop. Enter sets the anchor, and so does Space after Escape, Shift+↓ extends, Escape clears, and line buttons show a visible focus indicator. Selected rows have `aria-selected="true"` and the bar. `scope-indicator` and `live-region` text change together, and `live-region` is `aria-live="polite"` (FR-031). `Ask about selection` lands on `/ask` with that path, side and range. `diff-line-head-<n>` and `diff-line-base-<n>` are kept. The file list is a left region at 1440 that `file-list-toggle` collapses and expands (FR-024), and a drawer at 1000, and 400 shows `‹ Previous file`, `Next file ›` and `All changed files`. Binary files, a file with no textual change (`diff-no-text`) and skipped files each say which they are, with the reason. Run axe and the no-page-scroll check · test/ui/diff.ui.ts

### Implementation

**Wave 1:**

- [x] **T022** [US2] Selection model: `anchor`, `extend`, `clear`, `move` and `scopeText`, pure, following data-model §4.3 · src/ui/state/selection.ts

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T023** [US2] Diff rows and keyboard: `<tr class="diff-line" data-type aria-selected>` with old number, new number, mark cell and text cells. Line buttons use a roving `tabindex`. Keys go through selection.ts. The scope bar uses the existing `scope-indicator`, `scope-label-input` and `scope-whole-file`. Announce through `ReviewContext.announce`. Write `scope` and `lastDiffPath` to view state and restore the scope on mount. `Ask about selection` calls `ReviewContext.openAsk`, and diff.tsx stops importing from ask.tsx (FR-005 to FR-008, FR-022) · src/ui/screens/diff.tsx

**⟶ Wait for T023, then:**

- [x] **T024** [US2] Diff page layout and states: `FileList` in a left region that `file-list-toggle` collapses (wide) or drawer (medium), the narrow `prev-file`, `next-file` and `all-changed-files` links, `AsyncRegion` `async-diff`, and `diff-no-text` or `skipped-file-<path>` with the reason (FR-024, FR-028, edge cases) · src/ui/screens/diff.tsx

**Checkpoint**: The diff is readable and selectable by keyboard. T020 and T021 pass.

---

## Phase 4: User Story 3 — Trust what labels and references show (P1)

**Goal**: Evidence and Inference badges are visible and readable, and following a reference highlights every referenced line.

**Independent Test**: Open an answer whose Evidence claim cites lines 45–50, check the badge, follow the reference, and count six highlighted lines.

Files: src/ui/components/claims.tsx, src/ui/components/code-view.tsx, src/ui/screens/code.tsx

### Tests

- [x] **T025** [US3] Browser test: claim badges carry `data-label` on the badge element, with text and glyph, and pass axe contrast in light and dark. `claim-ref` hrefs carry `start` and `end`. Following the 45–50 reference marks exactly six rows `aria-current="true"` with line 45 in view, and the same holds for every reference in the test data (SC-004). A `line`-only link highlights one line. Leading spaces and tabs keep their width (FR-011). A long line scrolls inside `code-scroll` with no page scroll at 400. A range past the end shows `code-range-notice`. A reference to a commit that is no longer available shows `async-code` as `unknown` with its reason, not an error. Unresolved references show their reason · test/ui/references.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T026** [P] [US3] `CodeView` component: the table inside `div.code-scroll`, `code-line-<n>` kept, `aria-current="true"` and the cited class on every row from start to end, the first row scrolled into view, and the past-end notice. The code page and the Evidence panel both use it (FR-010, FR-011, R9) · src/ui/components/code-view.tsx
- [x] **T027** [P] [US3] Claims: claim and intent badges through `Badge`, refs built with `codeHref` (start and end), a click on a ref calls `ReviewContext.openEvidence` while the href stays the full-page route, and an `Unresolved` badge with the reason. `claim` and `claim-ref` keep their attributes (FR-009, FR-010, FR-044) · src/ui/components/claims.tsx

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T028** [US3] Code page: read `snapshot`, `side`, `path`, `start`, `end` and `line` from `parseRoute(location.hash)` so the page no longer depends on app.tsx's parsing. Render `CodeView`, wrap it in `AsyncRegion` `async-code`, show a commit that is no longer available as a state rather than an error, make the file path the `h1`, and keep the Back link (history, with Overview for a cold link) (FR-010, FR-028, approved proposal 7) · src/ui/screens/code.tsx

**Checkpoint**: Claim badges and code ranges are correct. Completeness badges (Story 3 scenario 2) come with Overview in Phase 7.

---

## Phase 5: User Story 4 — Ask a question with an accessible form (P1)

**Goal**: Every Ask field is named, groups are announced, an unavailable Ask says why, and errors are announced and linked.

**Independent Test**: Fill in and submit Ask by keyboard and screen-reader names only, including one forced submit failure.

Files: src/ui/components/ask-composer.tsx, src/ui/screens/ask.tsx

### Tests

- [x] **T029** [US4] Browser test: the accessible names `Your question`, group `Category` and group `Answer for`. `Technical` is the default. `ask-button` has `aria-disabled` with `ask-unavailable-reason` for an empty question and for an unavailable provider, and stays focusable. A forced failure shows `ask-error` with `role="alert"`, and the field gets `aria-invalid="true"` and `aria-describedby` naming `ask-error` (FR-012). Draft, category and Answer-for survive a reload of the tab. Failed suggestions and a failed provider check show failed states with Retry (FR-029). The streamed answer is announced at most every 2 s and then `Answer complete`. The older-head badge shows on an earlier-head answer · test/ui/ask.ui.ts

### Implementation

**Wave 1:**

- [x] **T030** [US4] Ask composer, used by the full page and the Ask panel: `<label>` `Your question` on `question-input`, `<fieldset>`/`<legend>` for Category and Answer for (ids kept), and draft, category, answerFor and scope read from and written to view state. `ask-button` uses `aria-disabled` with `ask-unavailable-reason` covering an empty question, an unavailable provider, a read-only PR and an unavailable repository (`repositoryAvailable`, `repositoryReason`). Submit errors are linked to their field. Suggestions use `AsyncRegion` `async-suggestions` and the provider check uses `async-provider` (unknown when it does not answer) (FR-012, FR-013, FR-017, FR-018, FR-029, FR-057) · src/ui/components/ask-composer.tsx

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T031** [US4] Questions page: render `AskComposer`, wrap the thread in `AsyncRegion` `async-questions`, subscribe through `ReviewContext.subscribe` and stop opening its own `EventSource`, announce streamed text through the announcer, show the older-head badge, make `Questions` the `h1`, and remove `askHash` and `scopeFromQuery` (now in routes.ts) (FR-028, FR-031, FR-044) · src/ui/screens/ask.tsx

**Checkpoint**: The Ask form passes T029 on its full page.

---

## Phase 6: User Story 12 — Choose the next PR from a dashboard across a base folder (P1)

Story 11 (Home) is delivered here too, because the dashboard is the Home screen (FR-039 with FR-052).

**Goal**: A base folder replaces the single repository. Discovery finds every repository under it, and Home lists open PRs across all of them, with each repository failing on its own.

**Independent Test**: A base folder holding three clones at different depths and one clone on another host: the dashboard lists the three repositories' PRs, `GET /api/workspace` lists the fourth as skipped with its reason, and returning to `#/` restores the filter and scroll.

Files: src/config.ts, src/contracts/source-control.ts, src/adapters/github/source-control.ts, src/adapters/bitbucket/source-control.ts, src/adapters/gitlab/source-control.ts, src/adapters/github/issues.ts, src/adapters/gitlab/issues.ts, src/adapters/jira/issues.ts, src/repo/manager.ts, src/repo/discovery.ts, src/core/workspace.ts, src/core/sessions.ts, src/core/interrogation.ts, src/core/summaries.ts, src/server/routes/context.ts, src/server/routes/interrogation.ts, src/main.ts, src/ui/screens/home.tsx

### Tests

Test files: test/helpers/git-sandbox.ts, test/unit/config.test.ts, test/contract/source-control.suite.ts, test/unit/discovery.test.ts, test/integration/discovery-safety.test.ts, test/end-to-end/workspace.test.ts, test/ui/home.ui.ts, plus the existing tests T055 updates.

**Wave 1:**

- [x] **T032** [US12] Sandbox helper `makeBaseFolder()`: clones nested at depths 1 to 3, a repository inside another's folder, a clone on another host, one with no remote, a fork naming two repositories, the same repository in two folders, a symbolic link to a repository, and the app-data folder inside the base folder · test/helpers/git-sandbox.ts

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] **T033** [P] [US12] Config tests: the workspace shape. `baseFolder` must be absolute and an existing directory, and must neither contain nor sit inside app data. `baseUrl` is required under `needsBaseUrl`. An undeclared tracker field is `invalid_request` naming the field, and a declared `site` that is missing is refused. Refusals name field paths. The old `repository` shape loads as not configured · test/unit/config.test.ts
- [x] **T034** [P] [US12] Contract suite: for every adapter, every `cloneLocations(repo)` value maps back through `repositoryForRemote` to `repo.id`, a remote on another host gives `null`, and a self-hosted adapter matches only its base address host (contracts §6.1, XI.2) · test/contract/source-control.suite.ts
- [x] **T035** [P] [US12] Discovery tests on the sandbox: every depth and nested repositories found, a `.git` file counts, symbolic links not followed, app data skipped, the reasons `no-remote`, `no-matching-remote` and `remotes-unreadable`, the fork listed under both ids, a duplicate keeping the clone nearest the base folder with ties by code-point order, cancel keeping what was found, and `foldersScanned` increasing (FR-049 to FR-051) · test/unit/discovery.test.ts
- [x] **T036** [P] [US12] Safety test: branch, HEAD, index, status and stash of every discovered repository are unchanged after a scan (IX, XI.3) · test/integration/discovery-safety.test.ts
- [x] **T037** [P] [US12] Workspace end-to-end test: `GET /api/workspace` (409 before setup), `POST .../rescan` (202) and `.../cancel`, both refused without the Origin header. `GET /api/pulls` returns one group per repository with one `failed` group while the others load, `?repository=` returns one group, and an unknown id is 404. `POST /api/sessions` takes `{ repository, prNumber }`. Refresh, Ask and starting a session or summary for a repository with no clone give `409 repository_unavailable`. `repositoryAvailable` and `repositoryReason` are on summaries and details. Right after start-up, with no rescan call, `GET /api/workspace` shows a scan that began at boot (`scanning` or `complete`, never `idle`) (FR-056). With a tracker that reads issues from the repository itself, a session's linked issue is fetched from that session's own repository, not from another matched repository with the same issue number (FR-058). Covers SC-010 (contracts §5.2–5.4) · test/end-to-end/workspace.test.ts
- [x] **T038** [P] [US12] [US11] Browser test: `Your review sessions` comes before `Open pull requests`. Rows show repository, number, title, author, branches and updated time, with `start-review` or `resume-review`, ids `pr-item-<repository>-<number>`, most recently updated first. A failed group shows `pr-group-failed-<repository>` and `retry-pulls-<repository>` while the other rows stay, and Retry loads that group's rows (FR-054). The text and repository filters work, with `dashboard-filter-empty` and `dashboard-filter-clear`. `dashboard-empty` reads `No open pull requests in <base folder>`. A base folder with no repositories, or none on the chosen platform, shows `dashboard-no-repositories` linking to Setup. Only the starting row has `aria-busy`. A failed session list shows a failed state with Retry. A session with no clone shows `Open (read only)`. `skipped-repositories` links to Setup. Filter and scroll are restored on returning to `#/` · test/ui/home.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T039** [P] [US12] Config: `workspace { baseFolder, platform, baseUrl? }` replaces `repository`. Validate against data-model §1.1 (`assertOutsideClone` reused, `validateBaseUrl`, `settingsFields` gating), name field paths in every refusal, and load the old shape as not configured. `// simplified:` no migration (R10) (FR-036, FR-048) · src/config.ts
- [x] **T040** [P] [US12] Add `repositoryForRemote(normalisedRemote): string | null` to `SourceControlProvider` (contracts §6.1) · src/contracts/source-control.ts
- [x] **T041** [P] [US12] GitHub `repositoryForRemote`, the inverse of `cloneLocations` · src/adapters/github/source-control.ts
- [x] **T042** [P] [US12] Bitbucket Cloud `repositoryForRemote` · src/adapters/bitbucket/source-control.ts
- [x] **T043** [P] [US12] GitLab `repositoryForRemote`: nested groups, and only the configured base address host · src/adapters/gitlab/source-control.ts
- [x] **T044** [P] [US12] Tracker descriptors declare `settingsFields`: Jira Cloud `['site', 'projectKeys']`, GitLab Issues `['site']`, GitHub Issues none (R14, FR-034) · src/adapters/jira/issues.ts, src/adapters/gitlab/issues.ts, src/adapters/github/issues.ts
- [x] **T045** [P] [US12] Expose `readRemotes(folder)` through the existing `listRemotes` command, at most 8 at once. Run no other git command (IX.2) · src/repo/manager.ts
- [x] **T046** [P] [US12] [US11] Home dashboard: `AsyncRegion` `async-sessions` (no more swallowed failure) and one region per `PullGroup`. Merge loaded groups sorted by `updatedAt` descending, then repository, then number. Add `dashboard-filter` and `dashboard-repository-filter` over loaded items, kept with scroll in `prwb:view:dashboard` and restored after render. Rows `pr-item-<repository>-<number>` (the one deliberate testid change, FR-046), Start or Resume review, `aria-busy` on the starting row only, `Open (read only)`, `skipped-repositories`, `dashboard-empty`, `dashboard-no-repositories`, and `Home` as the single `h1` (FR-039, FR-052 to FR-055) · src/ui/screens/home.tsx

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T047** [US12] Discovery walk: `fs.opendir`, no symbolic links or junctions, skip app data and the inside of `.git`, descend into repositories, read remotes through `readRemotes`, normalise them, match through `repositoryForRemote`, de-duplicate by fewest path segments and then code-point order, report `foldersScanned`, and stop on an abort signal keeping what was found (R11, data-model §2.3) · src/repo/discovery.ts

**⟶ Wait for T047, then:**

- [x] **T048** [US12] Workspace service: the discovery state machine (idle, scanning, complete, cancelled, failed), `rescan()` cancelling a running walk, `cancel()`, `matched()`, `cloneFor(repo)`, the wire shape with `duplicateFolders` and `skipped`, and a "discovery still running" reason while scanning (data-model §2) · src/core/workspace.ts

**⟶ Wait for T048, then:**

**Wave 4 — independent (different files):**

- [x] **T049** [P] [US12] Sessions: `environmentFor(repo)` replaces `environment()`. The tracker is created with the session's repository (FR-058). List pulls per matched repository in parallel, turning a failure into that group's `failed` status. Start takes a repository. Refresh, start and summary runs refuse with `repository_unavailable` when there is no clone. Summaries and details carry `repositoryAvailable` and `repositoryReason` (R13, FR-054, FR-057) · src/core/sessions.ts
- [x] **T050** [P] [US12] Interrogation uses the session's repository environment and refuses Ask with `repository_unavailable` · src/core/interrogation.ts
- [x] **T051** [P] [US12] Summary runs use the session's repository environment · src/core/summaries.ts

**⟶ Wait for Wave 4 to finish, then:**

**Wave 5 — independent (different files):**

- [x] **T052** [P] [US12] Context routes: `GET /api/workspace`, and `POST /api/workspace/rescan` and `/cancel` behind the guard and the Origin check (X.5). `GET /api/pulls` returns groups, with `?repository=` and 404 for an unknown id. `POST /api/sessions` takes `{ repository, prNumber }`. A config save triggers `rescan()` (FR-056) · src/server/routes/context.ts
- [x] **T053** [P] [US12] Interrogation routes map `repository_unavailable` to 409 · src/server/routes/interrogation.ts

**⟶ Wait for Wave 5 to finish, then:**

- [x] **T054** [US12] Start-up: create the Workspace service from config, start discovery, and pass the service to the routes (FR-056) · src/main.ts

**⟶ Wait for T054, then:**

- [x] **T055** [US12] Update every existing test that writes the old `repository` config, calls `/api/pulls` or starts a session by number alone, so the full `npm test` and `test:gitlab` suites pass again (FR-046) · test/helpers/fake-ai-cli.ts, test/end-to-end/no-clone.test.ts, test/end-to-end/sessions.test.ts, test/end-to-end/signin.test.ts, test/integration/repo-fetch.test.ts, test/integration/repo-safety.test.ts, test/integration/session-context.test.ts, test/integration/session-delete.test.ts, test/integration/workspace-lifecycle.test.ts, test/unit/interrogation.test.ts, test/unit/appdata.test.ts, test/gitlab/coverage.test.ts, test/gitlab/lifecycle.test.ts, test/gitlab/recording.test.ts

**Checkpoint**: The dashboard works across a base folder, configured through `PUT /api/config`. The Setup screen catches up in Phase 12, and "Back to dashboard" arrives with the shell in Phase 11.

---

## Phase 7: User Story 7 — Find files fast on a long PR (P2)

**Goal**: Overview leads with the summary, completeness and a filterable file list. Per-file explanations are disclosed on request.

**Independent Test**: Open the 32-file session and reach any file's diff from Overview without scrolling past per-file summaries.

Files: src/ui/components/completeness.tsx, src/ui/components/summaries.tsx, src/ui/screens/overview.tsx

### Tests

- [x] **T056** [US7] Browser test: the order `pr-summary`, `completeness`, `file-list`, referenced PRs, then `review-focus` showing only `Review focus` and `Not available yet.`. Every file of the 32-file PR is reachable without passing per-file summaries. `file-explanation-<path>` toggles `aria-expanded`. Filter, empty result and clear work. Completeness badges carry `data-status` on the badge element, with text and glyph (Story 3 scenario 2, FR-009). Failed summaries show Retry. The page has a single `h1`, `Overview` · test/ui/overview.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T057** [P] [US7] Completeness list, extracted from `src/ui/screens/overview.tsx` (T059 drops the old copy there): rows keep `completeness-row-<source>` and their attributes, add a `Badge` with `data-status`, can be expanded to show reasons, and have stable anchors for the context strip to link to (FR-009, FR-044) · src/ui/components/completeness.tsx
- [x] **T058** [P] [US7] Summaries: subscribe through `ReviewContext.subscribe`, wrap in `AsyncRegion` `async-summaries`, stop listing per-file summaries in the panel, and export `FileExplanation(path)` for the file list's disclosure (FR-025, FR-028) · src/ui/components/summaries.tsx

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T059** [US7] Overview content: PR summary, `CompletenessList`, `FileList` with `FileExplanation`, referenced PRs, and `review-focus`, with `Overview` as the `h1`. Keep the existing PR header block, Close and Delete, and the `POST /open` call above the content for now, with the PR title demoted from `h1` so `Overview` is the only `h1`. T077 removes that block when the review shell takes it over (FR-025, FR-027, FR-045, R4) · src/ui/screens/overview.tsx

**Checkpoint**: T056 passes at `#/sessions/:id`. Until Phase 11, Overview keeps its old PR header, Close, Delete and `POST /open` call, so nothing is lost between phases.

---

## Phase 8: User Story 6 — Ask and check evidence beside the code (P2)

**Goal**: Ask and Evidence open as panels on wide and medium screens and as the existing full pages on narrow ones. Focus moves to the panel and back.

**Independent Test**: At 1440, select a range, open the Ask panel, ask, open a reference in the Evidence panel, close it, and check focus and scroll. At 400, check that full pages open instead.

Files: src/ui/components/panel.tsx, src/ui/components/sources-nav.tsx, src/ui/screens/description.tsx, src/ui/screens/issue.tsx, src/ui/components/evidence-panel.tsx, src/ui/components/panel-host.tsx

### Tests

- [x] **T060** [US6] Browser test, which passes once Phase 11 mounts the panel host. At 1440, `Ask about selection` opens `ask-panel` beside the diff with the scope filled in and focus on its `h2`. A claim reference opens `evidence-panel` with the full range and `open-full-page`. Escape and `panel-close` return focus to the opener, keeping the thread's scroll and Answer-for. At 1000 the panel overlays the page. At 400, full pages open. Resizing from 1440 to 1000 with a panel open keeps it open as an overlay with the draft. Resizing to 400 with a panel open switches to the full-page route and keeps the draft. `ask-about-pr` works from Overview. Every 001 route opens as a deep link with the same content (FR-023). Description and issue text containing HTML shows literally (FR-042) · test/ui/panels.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T061** [P] [US6] `Panel`: an `<aside aria-labelledby>` with `<h2 tabindex="-1">` focused on open, `panel-close`, Escape, and focus returned to `openerId` on close (FR-020) · src/ui/components/panel.tsx
- [x] **T062** [P] [US6] Sources sub-navigation: Description, then every linked issue including missing ones, with `aria-current` on the current one (approved proposal 4) · src/ui/components/sources-nav.tsx

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] **T063** [P] [US6] Description page: `h1` Description, `SourcesNav`, `AsyncRegion`, text rendered as text nodes, and an exported `DescriptionView` for the Evidence panel (FR-028, FR-042) · src/ui/screens/description.tsx
- [x] **T064** [P] [US6] Issue page: the issue key as the `h1`, `SourcesNav`, `AsyncRegion`, text rendered as text nodes, and an exported `IssueView` for the Evidence panel · src/ui/screens/issue.tsx

**⟶ Wait for Wave 2 to finish, then:**

- [x] **T065** [US6] *(Superseded after delivery: the Evidence panel was removed and a code citation now opens the Files view; see spec FR-019 and FR-021. `openEvidence` no longer exists in `ReviewContext`.)* Evidence panel: a code ref through `CodeView` with the full range, issue and description refs through their views, and `open-full-page` linking the existing route (FR-021) · src/ui/components/evidence-panel.tsx

**⟶ Wait for T065, then:**

- [x] **T066** [US6] Panel host wrapping the current screen: the band from `layout.ts` via `matchMedia`, and a `ReviewContext` override of `openAsk` and `openEvidence` that opens a panel in wide and medium and navigates in narrow. Panel state lives in view state. Entering narrow with a panel open replaces the hash with the panel's full-page route. The Ask panel is `AskComposer` with the scope (FR-019, FR-020, FR-022, R6) · src/ui/components/panel-host.tsx

**Checkpoint**: The panel pieces are built. They work end to end once Phase 11 mounts `PanelHost`.

---

## Phase 9: User Story 8 — See honest loading, empty and failure states (P2)

The failed states for the session list, provider check and suggestions are built in their own screens (T030, T046), on `AsyncRegion` from Phase 2. This phase adds the live-update model and banner, and checks every hidden failure.

**Goal**: A dropped live-update stream is shown and can be reconnected, and no failure is shown as an empty list.

**Independent Test**: Make the session list, provider check and suggestions fail in turn, then drop the stream, and check each failure state and the banner.

Files: src/ui/state/live-stream.ts, src/ui/components/live-banner.tsx

### Tests

**Wave 1 — independent (different files):**

- [x] **T067** [P] [US8] Live-stream unit tests with mock timers: `connecting → open`, `open → retrying` on error, `retrying → open` within 5 s, `retrying → dropped` after 5 s, `CLOSED → dropped` from any state, and Reconnect `→ connecting` (data-model §4.7) · test/unit/ui-live-stream.test.ts
- [x] **T068** [P] [US8] Browser test, which needs Phases 5, 6 and 11. With responses held or stubbed through `page.route`, regions show each `data-state`: `loading` naming the region, `empty` with its explanation, `unknown` for a provider check that does not answer, and `stale` with a Stale badge once the head moves (FR-028). Failed session list, provider check and suggestions each show a failed state with Retry, and Retry recovers. A stream closed by the server shows `live-updates-banner` within 5 s. `reconnect-button` restores events and refetches the detail and questions (FR-028 to FR-030) · test/ui/states.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T069** [P] [US8] Live-stream model: a pure state machine with the 5-second grace period, driven by the `subscribeSession` callbacks (R5) · src/ui/state/live-stream.ts
- [x] **T070** [P] [US8] Live-updates banner: `role="status"`, the text `Live updates paused — Reconnect`, and `reconnect-button` (FR-030) · src/ui/components/live-banner.tsx

**Checkpoint**: T067 passes. The banner appears once Phase 11 mounts it.

---

## Phase 10: User Story 9 — Close or delete a session safely (P2)

**Goal**: Close and Delete sit in a secondary menu, and Delete asks in a dialog with Cancel focused.

**Independent Test**: Open session actions, choose Delete, press Escape, confirm nothing was deleted and focus returned, then delete for real.

Files: src/ui/components/session-actions.tsx

### Tests

- [x] **T071** [US9] Browser test, which passes once Phase 11 mounts the menu. `session-actions-button` sets `aria-expanded` and holds `close-session-button` and `delete-session-button`. Delete opens `delete-session-dialog`, which states what is lost, with focus on `delete-session-cancel` and a danger-styled `delete-session-confirm`. Escape or Cancel deletes nothing (the session still answers 200) and returns focus to `session-actions-button`. Confirm deletes, clears `prwb:view:<id>` and goes Home (FR-032, FR-033, FR-047) · test/ui/session-actions.ui.ts

### Implementation

- [x] **T072** [US9] Session actions: `DisclosureMenu` with Close and Delete, and a native `<dialog>` opened with `showModal()` stating the consequences, with Cancel focused, focus returned on close, and `clearSession(id)` after a delete (R16) · src/ui/components/session-actions.tsx

**Checkpoint**: Built. It works end to end once Phase 11 mounts it.

---

## Phase 11: User Story 5 — Move around a review without losing your place (P2)

**Goal**: A persistent app header and review shell. One session load and one stream per session, and drafts, choices, scope and scroll survive navigation.

**Independent Test**: Type a draft, choose Business, select a range, open a claim reference, go back, and check nothing changed.

Files: src/ui/components/app-header.tsx, src/ui/components/review-shell.tsx, src/ui/app.tsx, and the removal of the old header block from src/ui/screens/overview.tsx (owned by Phase 7, see the scale note)

### Tests

**Wave 1 — independent (different files):**

- [x] **T073** [P] [US5] Browser test: the first Tab shows `Skip to content` and moves focus to `main`. `app-header`, on Home, Setup and every session page, shows the product name linking to `#/`, `workspace-identity`, `connection-state` with its `data-state`, and the settings menu holding Setup and Sign-in (FR-014). `review-header` shows its fields, with `back-to-dashboard` restoring the dashboard's filter and scroll. `review-nav` marks the current tab with `aria-current="page"`, and Questions shows its count and running state. `context-strip` links to the completeness rows and contains no `ready`, `safe` or `approved`. The header element survives tab changes, and `POST /open` is called once per session. Scroll is restored per page. `repository-unavailable` sits beside a disabled Refresh and Ask. On a closed and on a merged PR, `read-only-notice` shows, Refresh and Ask are unavailable with the read-only reason beside them, and Overview, Files, Questions and Sources still render (spec edge case, 001 FR-041). When the head commit moves while a draft question is open, the draft is kept and `refresh-button` reads `New commits — Refresh`. `session-unavailable` shows, with a link to Home, when the session is deleted in another tab, including while the Ask panel is open. Each route has exactly one `h1` · test/ui/shell.ui.ts
- [x] **T074** [P] [US5] Keyboard-only journey (SC-002): Home → Start review → Overview → Files → select a range → Ask → open evidence → return, with no pointer use. The draft, Business choice, scope and scroll are unchanged on return, and again after a reload of the tab. No request URL or body sent during the journey contains the draft text, and a new tab on the same route starts with no draft (FR-017, FR-018, FR-047) · test/ui/journey.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T075** [P] [US5] App header: the skip link first, the product name as a plain link to `#/`, `workspace-identity` from `GET /api/workspace` (base folder and platform display name), `connection-state` from sign-ins and the provider check (a failed check shows unknown, not hidden), and `settings-menu-button` holding Setup and Sign-in (FR-014, FR-029) · src/ui/components/app-header.tsx
- [x] **T076** [P] [US5] Review shell, keyed by session id. Load the detail once, call `POST /open` once, and open one stream driven by the live-stream model with `LiveBanner`. Provide `ReviewContext` (session, shared subscribe, announce). Render `‹ Back to dashboard`, then the review header (repository, `#<n> <title>`, author, branches, PR status badge, short head and snapshot time, `context-version`, `refresh-button` reading `New commits — Refresh` when the head has moved, `read-only-notice`, and reasons beside an unavailable Refresh or Ask). Then `SessionActions`, `review-nav` (with `ask-about-pr` on every tab except Files), `context-strip`, `session-unavailable`, and `PanelHost` around the screen. Save scroll by route key on `hashchange` and restore it after render (R4, R5, FR-015, FR-016, FR-022, FR-030, FR-032, FR-055, FR-057) · src/ui/components/review-shell.tsx

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T077** [US5] App: remove `key={hash}`, route through `parseRoute`, render `AppHeader` and `<main id="main" tabindex="-1">`, wrap every `#/sessions/:id…` route in `ReviewShell` keyed by session id, and render Overview with its new signature. Remove Overview's old PR header block, Close and Delete, and its `POST /open` call, which the shell now owns (T059 kept them until now). Every existing route keeps its content (FR-014, FR-023, R4) · src/ui/app.tsx, src/ui/screens/overview.tsx

**Checkpoint**: Stories 5, 6, 8 and 9 work end to end. T060, T068, T071, T073 and T074 pass.

---

## Phase 12: User Story 10 — Set up and sign in with guidance (P3)

**Goal**: Setup takes a base folder, shows only the declared fields, limits in human units and the discovery result, and gives a checklist after saving. Sign-in explains itself and returns to the page that sent the reviewer there.

**Independent Test**: Configure GitHub, then GitLab (self-managed), then Bitbucket Cloud with Jira Cloud, checking the visible fields each time. Trigger sign-in from a session page and check the return.

Files: src/ui/state/units.ts, src/ui/screens/signin.tsx, src/ui/screens/setup.tsx

### Tests

**Wave 1 — independent (different files):**

- [x] **T078** [P] [US10] Units tests: `formatBytes` shows whole KB, `parseKilobytes` accepts whole KB of 1 or more, `formatLines`, and every default round-trips unchanged · test/unit/ui-units.test.ts
- [x] **T079** [P] [US10] Browser test: `setup-base-folder` is labelled `Base folder`. For each platform from `/api/platforms`, `setup-base-url` appears only under `needsBaseUrl`, and `setup-site` and `setup-project-keys` appear only when declared. `advanced-limits` starts collapsed and shows defaults in KB and lines. Server errors show at their fields and in `setup-error` with links to them. After a save, `discovery-result` shows its state, with `discovery-progress` and `discovery-cancel` while scanning, then `rescan-button` and the matched, duplicate and skipped rows with reasons. A base folder with no repositories, or none on the chosen platform, shows a complete `discovery-result` that says so and what to check. `connection-checklist` rows carry `data-status` and next steps, and a check that cannot run yet shows `? not checked yet` (FR-034 to FR-037, FR-048, FR-056) · test/ui/setup.ui.ts
- [x] **T080** [P] [US10] Browser test: Sign-in states why it is needed, for which platform, and that access is read-only. A `signin_required` from a session page returns there after success. A `return` naming an outside URL, `#/setup` or `#/signin` goes to `#/` (FR-038) · test/ui/signin.ui.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T081** [P] [US10] Limit units: `formatBytes`, `parseKilobytes`, `formatLines` (data-model §4.10) · src/ui/state/units.ts
- [x] **T082** [P] [US10] Sign-in: the explanation text from labels.ts, one form per configured platform (ids kept), and navigation to `safeReturn(return)` after success (FR-038) · src/ui/screens/signin.tsx

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T083** [US10] Setup: base folder, platform select, `setup-base-url` under `needsBaseUrl`, tracker fields from `settingsFields` with no platform named (VIII.2), and `Advanced limits` through units.ts. Map refusals by field path to inline errors and the top summary. Show the discovery result, polling `GET /api/workspace` once a second while scanning, with Rescan and Cancel. Build the connection checklist from workspace, sign-ins and provider, using `AsyncRegion` `async-workspace` and `async-signins`. `Setup` is the single `h1` (FR-034 to FR-037, FR-048, FR-056, R18) · src/ui/screens/setup.tsx

**Checkpoint**: Setup and Sign-in pass T079 and T080 against the Phase 6 server.

---

## Final Phase: Polish and validation

**Wave 1 — independent (different files):**

- [x] **T084** [P] Route sweep: on every route (Home, Setup, Sign-in, Overview, Files, Code, Questions, Description, Issue, each with a panel open where one applies), axe finds zero violations in light and dark (SC-001), there is no page-level horizontal scroll at 400, 1000 and 1440 (SC-003), and there is exactly one `h1`. Landmarks: axe's `landmark-one-main`, `region` and `bypass` rules run explicitly (the first two are tagged best-practice, so the WCAG tags alone skip them), and every page has one `banner` and one `main`. With `page.emulateMedia({ reducedMotion: 'reduce' })`, no element has a running animation or a transition longer than 0.01 s (FR-040) · test/ui/sweep.ui.ts
- [x] **T085** [P] Static UI checks: `src/ui` uses no `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` (SC-008, FR-042). No interface string says `ready`, `safe` or `approved` about a PR (SC-007, FR-016). The UI calls only local `/api/` routes, with no platform URL (FR-043). Every `data-testid` in `specs/001-pr-review-workbench/contracts/ui.md` still appears in `src/ui`, except the deliberate `pr-item-<number>` change (FR-046) · test/unit/ui-safety.test.ts
- [x] **T086** [P] Record each of the 13 guide §4 findings against the test or manual check that resolves it (SC-006), and each guide §3 strength against where it still appears (FR-044, FR-045). Add a recorded manual copy review of every interface string in `labels.ts` and the screens for wording that states or implies merge readiness, since T085's word search cannot catch implication (SC-007, FR-016) · specs/003-ui-redesign/checklists/guide-findings.md

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T087** Validate against the Success Criteria: run `npm run typecheck`, `npm run build:ui`, `npm test`, `npm run test:ui` and `npm run test:gitlab`, and report each suite's result. `test:gitlab` needs the local GitLab from `testing/gitlab.md`; if it is not running, report SC-005 as not verified rather than skipping the suite. SC-005 needs every existing test and the five FR-047 areas passing · (no file)

---

## Dependencies & Execution Order

**Phases**: Setup → Foundational → story phases → Polish.

- Phases 3, 4, 5, 6, 7, 8, 9 and 10 each depend only on Phase 2 and own disjoint files, so they can run in parallel.
- Phase 11 (US5 shell) mounts the work of Phases 7, 8, 9 and 10, and reads Phase 6's workspace and repository fields. Run it after all five.
- Phase 12 (US10) needs Phase 6's server endpoints for its tests.
- Polish runs after every other phase.
- Browser tests that need a later phase: T038's back link and T060, T068 and T071 pass after Phase 11. T068 also needs Phases 5 and 6.

**Waves per phase**:

- **Phase 1**: T001 → T002.
- **Phase 2**: Wave 1 (T003–T012) → Wave 2 (T013–T017; T017 follows T011 in app.css) → Wave 3 (T018, T019).
- **Phase 3 (US2)**: tests T020, T021 → T022 → T023 → T024.
- **Phase 4 (US3)**: test T025 → T026, T027 → T028.
- **Phase 5 (US4)**: test T029 → T030 → T031.
- **Phase 6 (US12)**: T032 → tests T033–T038 → Wave 1 (T039–T046) → T047 → T048 → Wave 4 (T049–T051) → Wave 5 (T052, T053) → T054 → T055.
- **Phase 7 (US7)**: test T056 → T057, T058 → T059.
- **Phase 8 (US6)**: test T060 → T061, T062 → T063, T064 → T065 → T066.
- **Phase 9 (US8)**: tests T067, T068 → T069, T070.
- **Phase 10 (US9)**: test T071 → T072.
- **Phase 11 (US5)**: tests T073, T074 → T075, T076 → T077.
- **Phase 12 (US10)**: tests T078–T080 → T081, T082 → T083.
- **Polish**: T084, T085, T086 → T087.
