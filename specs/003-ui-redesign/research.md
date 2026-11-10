# Research: PR Review Workbench UI Redesign

Each entry settles one question the spec, the constitution and the codebase leave open. "R" numbers are cited from `plan.md`, `data-model.md` and `contracts/`.

## R1. How the interface is tested in a browser

**Decision**: Add `playwright` (the library, not `@playwright/test`) and `@axe-core/playwright` as **devDependencies**. Browser tests live in `test/ui/*.ui.ts`, use `node:test` like every other suite, and run with a new `npm run test:ui` script. Each test starts the real workbench through `test/helpers/server.ts` with the fake AI CLI and recorded platform fetch, then drives Chromium against the launch URL. Axe runs with the `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa` tags, once with `colorScheme: 'light'` and once with `'dark'` (SC-001). Viewport tests set widths 400, 1000 and 1440 and assert `document.documentElement.scrollWidth <= innerWidth` (SC-003).

**Rationale**: The spec's assumptions say no test drives the browser today, and FR-047, SC-001, SC-002 and SC-003 need a real layout engine. Playwright's library API runs under `node:test`, so there is one test runner. The Chromium build is already cached on this machine. Q.1 limits runtime dependencies. These are dev-only, so the shipped package does not grow.

**Alternatives considered**: jsdom with a Preact testing library has no layout, so it cannot check horizontal scroll, focus visibility or contrast. `@playwright/test` brings a second runner and config format. Running browser tests inside `npm test` would make every unit run need a browser, so they get their own script, as `test:gitlab` already does.

## R2. Where UI logic lives so it can be unit-tested without a browser

**Decision**: Put each piece of UI logic in a plain `.ts` module under `src/ui/state/`: the diff selection model, the view-state store, the route builder and parser, the sign-in return check, the unit formatter for limits, and the width bands. Components in `.tsx` call them. Unit tests in `test/unit/ui-*.test.ts` import them directly.

**Rationale**: Node strips types from `.ts` but does not compile JSX, so a `.tsx` file cannot be imported by `node --test`. Pure modules give fast, exact tests for the keyboard model and state rules. The browser tests then only need to prove the wiring.

**Alternatives considered**: Testing everything through Playwright is slow and hides which rule failed. Adding a JSX loader to the unit runner adds tooling for no gain.

## R3. How view state survives navigation and reloads (FR-017, FR-018, FR-055)

**Decision**: One module, `src/ui/state/view-state.ts`, reads and writes `sessionStorage`. There is one key per review session, `prwb:view:<sessionId>`, and one for the dashboard, `prwb:view:dashboard`. Each value is versioned JSON (`v: 1`) holding only allowlisted fields. Unknown fields are dropped and the value is validated on read, so a corrupt or old value falls back to defaults. Every write goes through a typed setter. No setter accepts a credential-shaped field, and the module imports nothing from `api.ts`, so nothing it holds reaches the server.

**Rationale**: The clarification fixes the scope: per tab, through reloads, gone when the tab closes, never sent to the server. That is exactly what `sessionStorage` does. One module makes X.7 checkable: a unit test asserts the stored JSON has only the allowlisted keys.

**Alternatives considered**: In-memory state does not survive a reload. `localStorage` outlives the tab, which the spec forbids. Putting the draft in the URL would leak it into history and make every keystroke a navigation.

## R4. How the shell stops the remount that throws state away

**Decision**: Remove `key={hash}` from `<main>`. `App` renders `AppHeader`, then, for any `#/sessions/:id/*` route, a `ReviewShell` keyed by **session id only**. The shell owns the session detail and the single live-update stream, and gives them to screens through a Preact context. The live region is one static element in `index.html`, so screens can announce with or without the shell. Screens still remount when their route changes. They read and write their in-progress state through the view-state store, so a remount restores the state. Scroll is saved per route key on `hashchange` before the switch and restored after the next render.

**Rationale**: The shell then loads the session once per session, not once per page, so the header does not flicker. Screens stay simple: each one is still a component of its route. Reader 2 noted that Overview calls the state-changing `POST /open` on mount. The shell makes that call once, when it mounts for a session, and no screen makes it.

**Alternatives considered**: Keeping every screen mounted and hiding inactive ones keeps all their data and streams alive. A global store library is a runtime dependency the problem does not need.

## R5. One live-update stream, and what "dropped" means (FR-030)

**Decision**: The shell opens the one `subscribeSession` stream. Ask and Summaries subscribe to the shell's events, not to their own `EventSource`. The stream counts as **dropped** when `EventSource` reports an error and is not open again within 5 seconds, or when its `readyState` is `CLOSED`. The banner then reads `Live updates paused — Reconnect`. Reconnect closes the stream, opens a new one, refetches the session detail and questions, and clears the banner on the first `open`.

**Rationale**: `EventSource` retries by itself, so a single error is often a blip. The 5-second grace period stops the banner flashing on every retry. The existing `onDisconnect` and `onResyncError` hooks in `api.ts` already report what is needed.

**Alternatives considered**: Showing the banner on the first error flashes during normal retries. Reconnecting automatically with no banner hides the gap that V.1 says must be shown.

## R6. Panels, width bands and resizing (FR-019, FR-020, FR-024)

**Decision**: `src/ui/state/layout.ts` defines the three bands as media queries: `wide` is `(width >= 1200px)`, `medium` is `(900px <= width < 1200px)` and `narrow` is `(width < 900px)`. `app.css` uses the same three. Panel state (`ask` or `evidence`, and the evidence reference) lives in view state, not in the URL. When the band is wide the panel sits beside the content. When it is medium the panel overlays the content as a non-modal `aside` with a close button and Escape. When it is narrow, "Ask about selection" and claim references navigate to the existing full-page routes. If a resize enters `narrow` while a panel is open, the app replaces the hash with that panel's full-page route, and the draft stays in view state. A resize back out leaves the reviewer on the full page. Opening a panel moves focus to its `h2` (with `tabindex="-1"`). Closing it returns focus to the opener, whose element id is held in memory.

**Rationale**: Deep links stay the existing routes (FR-023), so panels add no new URL. The edge case of resizing across a boundary keeps the content open with no lost draft.

**Alternatives considered**: Putting the panel in the hash makes every open and close a navigation and conflicts with "existing route, same content". A modal overlay in the medium band would trap focus away from the diff the reviewer is asking about.

## R7. Diff keyboard model and row markup (FR-005 to FR-008)

**Decision**: Each diff row is `<tr class="diff-line" data-type="add|remove|context" aria-selected="true|false">` with four cells: old number, new number, a mark cell (`+`, `−` U+2212, or a space, `aria-hidden`), and text in `white-space: pre`. Each selectable line number is a `<button>` that keeps its existing `data-testid` (`diff-line-head-<n>` and `diff-line-base-<n>`). The diff is one Tab stop with roving `tabindex` (approved proposal 5). ↑ and ↓ move within a side. ← and → switch between the old and new side on the same row when that side has a number. Enter or Space sets the anchor, or completes a range when an anchor is set on the same side. Shift with ↑ or ↓ extends the range. Escape clears it. Selection rules live in `src/ui/state/selection.ts`. A selection stays on one side, and choosing a line on the other side starts a new one (edge case). The existing behaviours stay: a second click extends a single-line selection, and a context line is selectable on the new side only. A selected row gets a left selection bar (`box-shadow: inset 4px 0 0 var(--selected-bar)`) as well as `--diff-selected-bg`.

**Rationale**: The approved wireframe fixes the roving model. Keeping the testids on the buttons keeps 001's identifiers stable (FR-046). Moving the mark into its own cell stops it being copied with the code and matches the four-column grid `app.css` already expects.

**Alternatives considered**: A full ARIA `grid` role brings cell-navigation rules that screen readers handle unevenly for tables of code. One Tab stop per line makes a 2,000-line diff impossible to Tab past.

## R8. Badges and icons under a strict CSP (FR-009, FR-044)

**Decision**: One `Badge` component renders `<span class="badge" data-kind="…" data-label|data-status="…">` with a text glyph (`aria-hidden="true"`) and the visible text label. The glyphs are: Evidence ✓, Inference ≈, Found ✓, Missing ✕, Stale ⟳, Skipped ⊘, Unresolved ?, Older head ⟲, Read-only 🔒︎ (text presentation), Documented intent ✎, Inferred intent ≈, and PR status ● with the status word. `data-label` (claims) and `data-status` (completeness) go on the badge element, as the Verbatim Constraints require. The `li` elements keep their existing attributes, so 001's contract still holds. New colour triples are added in both theme blocks for skipped, unresolved, older-head, read-only and each PR status. Each foreground/background pair is checked at 4.5:1 or better by the axe run. `text-transform: uppercase` is removed from badges, so the visible text is the verbatim label.

**Rationale**: CSP is `style-src 'self'` with no inline styles. Text glyphs need no asset pipeline and inherit the badge colour. Keeping attributes on both elements satisfies the spec without breaking any documented selector.

**Alternatives considered**: An SVG sprite file needs a new served asset and a route entry for 12 tiny shapes. Moving the attributes off the `li` would be a deliberate testid-contract change for no user benefit.

## R9. Code view range (FR-010, FR-011, edge cases)

**Decision**: The code route accepts `start` and `end`. A link with only `line` is read as `start=end=line`. `refHref` emits `start` and `end` from the claim's `startLine` and `endLine`. The code view marks every row from `start` to `end` with `aria-current="true"` and the cited class, and scrolls `start` into view. A range past the end of the file highlights what exists and shows "Lines a–b are past the end of this file (it has n lines)." as a notice. A commit that is no longer available shows its reason as a state, not an error. The code table sits in a `div.code-scroll` with `overflow-x: auto`, and cells use `white-space: pre`.

**Rationale**: Today the route drops `endLine` and `.diff { overflow-x: auto }` sits on a `<table>`, where it does nothing. A wrapping scroll container is the standard fix.

**Alternatives considered**: Wrapping long lines changes how code reads and breaks column alignment.

## R10. Workspace configuration replaces the single repository (FR-048)

**Decision**: The config's `repository` object becomes `workspace: { baseFolder, platform, baseUrl? }`. The rest stays: `issueTracker`, `limits`, `logRetentionDays`. `baseFolder` must be absolute, must exist as a directory, and must neither contain nor sit inside the application-data folder (`assertOutsideClone` reused). `baseUrl` is required when the platform's descriptor says `needsBaseUrl`. A config file still in the old `repository` shape loads as **not configured**, so Setup opens and nothing guesses a base folder. `// simplified: no automatic migration; the product is unreleased and its one user re-runs Setup. Add a migration if it ships before this lands.`

**Rationale**: Inferring a base folder from an old clone path could point discovery at a home directory. The product has no installed base yet.

**Alternatives considered**: Converting `clonePath` to `dirname(clonePath)` is a guess with a large blast radius. Keeping both shapes doubles every config code path.

## R11. Discovery: finding and matching repositories (FR-049 to FR-051, FR-056)

**Decision**: A new `src/repo/discovery.ts` walks the base folder with `fs.opendir`. It never follows a symbolic link or junction (`Dirent.isSymbolicLink()`). It skips the application-data folder and the inside of every `.git`. A folder is a repository when it holds a `.git` directory or `.git` file. The walk keeps descending inside a repository, so nested repositories are found too. For each repository the Repository manager runs its existing `listRemotes` command (IX.2), at most 8 at once. The source-control provider gets one new read-only contract method, `repositoryForRemote(normalisedRemote): string | null`. It turns a remote such as `host/group/sub/repo` into the platform's repository id, or null when the remote is not on this platform. The adapter owns that knowledge (VIII.2). One clone can match several repositories (a fork and its upstream). The same repository found in several folders keeps the clone nearest the base folder (fewest path segments), with ties broken by the path's code-point order. The others are listed as duplicates. Discovery runs at start-up, after each config save and on Rescan. It reports folders scanned while it runs, and cancelling keeps what has been found so far. The result is held in memory by a `Workspace` service.

**Rationale**: Reading remotes through `git remote -v` keeps all git access in one place and writes nothing. Matching by remote in the adapter is the inverse of the existing `cloneLocations`, so GitLab's nested groups and self-hosted hosts stay inside the GitLab adapter. Holding the result in memory is enough because discovery reruns at every start-up.

**Alternatives considered**: Parsing `.git/config` by hand duplicates git's own config rules (includes, `insteadOf`). Deriving the reverse match in core from `cloneLocations` would need core to know each platform's path shape. Persisting the result to disk adds a cache that can go stale while the folder tree changes.

## R12. Dashboard data shape and per-repository failure (FR-052 to FR-054)

**Decision**: `GET /api/pulls` returns one `PullGroup` per matched repository: `{ repository, status: 'loaded' | 'failed', reason?, pulls }`. The server lists each repository in parallel and turns one repository's failure into that group's `failed` status (V.4). `GET /api/pulls?repository=<id>` returns one group, which is what Retry calls. `PullSummary` gains `repository`. `POST /api/sessions` takes `{ repository, prNumber }`. The UI merges the groups into one list, most recently updated first (approved proposal 17).

**Rationale**: One request loads the dashboard and one request retries one repository. The existing `signin_required` refusal still applies to the whole call, because without a sign-in no repository can load.

**Alternatives considered**: One request per repository from the browser makes the first load slower and puts fan-out logic in the UI. A single flat list cannot carry a per-repository failure.

## R13. Sessions run against the session's own repository (FR-057, FR-058)

**Decision**: `SessionEnvironment` is built per repository: `environmentFor(repo)` returns the provider, a tracker created with that repository, the clone path from the workspace (or null) and the limits. Every place that called `deps.environment()` passes the session's stored repository instead. When the workspace has no clone for a session's repository, `SessionSummary` and `SessionDetail` carry `repositoryAvailable: false` and `repositoryReason`. Refresh, Ask and starting a summary run then refuse with a new error code, `repository_unavailable` (`409`). Reading still works from the store.

**Rationale**: The store already keys sessions by platform, repository id and PR number, so no schema change is needed. A session outlives its folder moving because the folder is looked up at use, not stored.

**Alternatives considered**: Storing the clone path on the session breaks when a folder moves. Hiding such sessions breaks "stays readable".

## R14. Tracker-declared settings fields (FR-034)

**Decision**: `AdapterDescriptor` gains `settingsFields?: readonly ('site' | 'projectKeys')[]`. Each tracker adapter declares what it reads: Jira Cloud declares site and project keys, GitLab Issues declares site, and GitHub Issues declares none. Setup renders exactly the declared fields. Config validation refuses a declared `site` that is missing, and drops nothing silently: an undeclared field that is sent is refused as `invalid_request` naming the field.

**Rationale**: This is the same pattern as `needsBaseUrl`, which already keeps Setup free of platform names.

**Alternatives considered**: A free-form field schema per adapter is more general than two known fields need.

## R15. Sign-in return (FR-038)

**Decision**: `api.ts` sends a `signin_required` reviewer to `#/signin?return=<current hash>`. Sign-in accepts `return` only when it starts with `#/`, parses to a known route, and is not itself a sign-in or setup route. Anything else returns to `#/`. The check lives in `src/ui/state/routes.ts` and is unit-tested.

**Rationale**: This is approved proposal 8. Allowing only parsed app routes rules out an open redirect.

**Alternatives considered**: Holding the origin in `sessionStorage` breaks when the sign-in link is opened in a new tab.

## R16. Dialogs, menus and headings (FR-032, FR-033, FR-040)

**Decision**: The Delete confirmation uses the native `<dialog>` with `showModal()`. That gives a focus trap and Escape-to-cancel for free. Cancel gets focus when the dialog opens, and focus returns to the session-actions button when it closes. The settings menu and session-actions menu are disclosure buttons (`aria-expanded`, `aria-controls`) holding links and buttons, not ARIA `menu` widgets. The app title becomes a plain link, so each page's own heading is its single `h1` (approved proposal 1). Panels use `h2`.

**Rationale**: Native `<dialog>` is supported in every current browser and needs no script for focus trapping. The disclosure pattern is simpler than `menu` and reads correctly to screen readers for a short list.

**Alternatives considered**: A hand-written focus trap is code to get wrong. The `menu` role promises arrow-key behaviour that then has to be built.

## R17. Polite announcements, throttled (FR-007, FR-031)

**Decision**: The shell holds one `aria-live="polite"` region. A scope change announces its scope-bar text at once. Streaming answer text is announced at most once every 2 seconds, as the text added since the last announcement, plus a final "Answer complete" message. One small `announce()` helper in `src/ui/state/announcer.ts` does the throttling.

**Rationale**: One region avoids competing announcements. A 2-second floor keeps speech readable while still reporting progress.

**Alternatives considered**: Putting `aria-live` on the streaming text element re-reads the whole growing answer on every chunk.

## R18. Connection checklist (FR-037)

**Decision**: Setup builds the checklist in the browser from three existing reads: `GET /api/workspace` (base folder readable, repositories found), `GET /api/signins` (one row per configured platform) and `GET /api/provider`. A check that cannot run yet shows "? not checked yet" with what it waits for (approved proposal 11). No new server check is added.

**Rationale**: Every fact the checklist needs is already read-only and available. The spec's assumption says the checklist adds no write.

**Alternatives considered**: A dedicated `/api/checks` endpoint duplicates three reads.
