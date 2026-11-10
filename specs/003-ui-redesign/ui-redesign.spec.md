# Feature Specification: PR Review Workbench UI Redesign

**Feature Branch**: `003-ui-redesign`
**Created**: 2026-11-09
**Status**: Draft

**Grilled on**: 2026-11-09

**Input**: Handoff "wireframes and implementation of the PR Review Workbench UI redesign", and the review it builds on, [ui-guide.md](ui-guide.md) (copied here from the reviewing session; its move to `docs/ui-guide.md` waits for approval). Section references such as "guide §4 #2" point into that guide.

The workbench already lets a reviewer open a pull request, see what context exists, read the diff and ask questions whose answers separate Evidence from Inference. A review of the interface found that some of those trust signals are invisible (diff colours, claim badges, referenced ranges), that key controls cannot be used by keyboard, and that moving between screens throws away the reviewer's work. This feature fixes those defects first, then gives every review a persistent frame so a developer, a technical lead and a business analyst can each follow one shared workflow without losing their place.

It is delivered in two stages. **Stage 1** is low-fidelity wireframes, kept in `wireframes/` beside this spec and approved after this spec and before plan; changes they reveal are folded back into this spec. **Stage 2** is the implementation, covered by plan and tasks, in the order of the user stories below. These stages are not the product's Phase 1 / Phase 2 (ADR 0001); this whole feature sits inside product Phase 1.

Every existing capability stays. Anything that did not exist before is labelled **[NEW]** in the wireframes and in this spec.

## Clarifications

### Session 2026-11-09

- Q: Where does the wireframe stage sit in the pipeline? → A: Between specify and plan, inside this spec. Wireframes go in `wireframes/` beside this spec, the product owner approves them, and any changes they reveal are folded back into this spec before plan. Plan and tasks cover Stage 2 only.
- Q: What form do the wireframes take? → A: Annotated HTML pages, one per screen, that open in a browser and show the three widths, with focus order numbered on the elements and the app's colour tokens so light and dark can be checked.
- Q: How long does in-progress view state last? → A: Through reloads of the same browser tab, kept in that tab's own browser storage. It is gone when the tab closes, is never sent to the server, and never holds credentials.
- Q: (Wireframe review) How does the reviewer reach many repositories? → A: Setup takes a base folder. Every git repository nested under it, at any depth, is found, and Home becomes a dashboard of open pull requests across all of them. The reviewer opens one, then returns to the dashboard for the next. This is folded into this feature.
- Q: Can one base folder hold repositories on different platforms? → A: No. Setup picks one source-control platform per base folder; a repository whose remotes are on another host is listed as skipped.
- Q: How are linked issues found across repositories? → A: One issue tracker serves every repository.
- Q: Which pull requests does the dashboard list? → A: Every open pull request in every matched repository.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Approve the redesign on wireframes before planning (Priority: P1)

The product owner sees every redesigned screen at wide, medium and narrow widths, including the awkward states, and the keyboard order for the diff and the side panels. They approve or ask for changes. Planning does not start until they approve, and any changes are folded into this spec first.

**Why this priority**: The redesign touches every screen. Agreeing the layout on paper is far cheaper than reworking built screens.

**Independent Test**: Hand the wireframe set to the product owner and check each listed screen and state is present at all three widths, with keyboard annotations where required.

**Acceptance Scenarios**:

1. **Given** the wireframe set, **When** the product owner reviews it, **Then** it shows Home as the pull request dashboard across repositories (including one repository failing to load), Overview, Files/Diff with a selection and the Ask panel open, Questions with the Evidence panel open, Code full page with a range, Description, Issue, Setup (GitHub, Bitbucket Cloud with Jira Cloud, self-hosted and issue-tracker variants, each showing the repositories found under the base folder), Sign-in (including the Bitbucket Cloud and Jira Cloud sign-ins), the Delete confirmation dialog, and a state gallery, each at about 1440, 1000 and 400 pixels wide.
2. **Given** the state gallery, **When** it is reviewed, **Then** it shows loading, empty, failed, stale, live-updates-disconnected, AI provider unavailable, read-only PR and answered-for-an-older-head states.
3. **Given** the Diff and panel wireframes, **When** they are reviewed, **Then** each annotates the keyboard path and focus order, including where focus goes when a panel opens and closes.
4. **Given** the wireframes are not yet approved, **When** planning is proposed, **Then** it does not start.

---

### User Story 2 - Read a diff and select a range with mouse or keyboard (Priority: P1)

A developer opens a changed file and can tell at a glance which lines were added, removed or unchanged, without relying on colour. They select a line range by clicking or entirely by keyboard, see exactly what is selected, and ask about it.

**Why this priority**: Additions, removals and selections are currently indistinguishable on screen, and selection is mouse-only (guide §4 #1, #2). The diff is the developer's main workspace, so this is a trust and accessibility defect.

**Independent Test**: Open any session's diff, select lines 10 to 14 on the new side using only the keyboard, and confirm the rows are visibly marked, the scope is announced, and Ask receives that range.

**Acceptance Scenarios**:

1. **Given** a diff with additions and removals, **When** it is shown, **Then** each added line carries a `+` mark, each removed line a `−` mark, and each has a distinct background, in light and dark themes.
2. **Given** focus on a line number, **When** the reviewer presses Enter or Space, **Then** that line becomes the selection anchor; **When** they press Shift with an arrow key, **Then** the selection extends one line; **When** they press Escape, **Then** the selection clears.
3. **Given** a selection, **When** it changes, **Then** a scope bar reads "Selected: <path> lines a–b (new side)" (or "old side") and screen readers hear the change.
4. **Given** a selection, **When** the reviewer chooses "Ask about selection", **Then** Ask opens with that path, side and range, and any range label they typed.
5. **Given** a selected row, **When** it is shown, **Then** it has a visible selection bar as well as a colour change.

---

### User Story 3 - Trust what labels and references show (Priority: P1)

A technical lead reading an answer or the Overview can see at a glance which claims are Evidence and which are Inference, which context is found, missing or stale, and, when following a reference, exactly the referenced lines.

**Why this priority**: Evidence/Inference and completeness badges currently render as neutral chips, and a reference to lines 45–50 highlights only line 45 (guide §4 #3, #4). Provenance is the product, so this is a trust defect.

**Independent Test**: Open an answer with an Evidence claim whose reference spans several lines, check the badges are styled and readable, follow the reference, and count the highlighted lines.

**Acceptance Scenarios**:

1. **Given** a claim, **When** it is shown, **Then** its badge shows the text "Evidence" or "Inference", plus an icon, and a colour that meets AA contrast in both themes.
2. **Given** a completeness row, **When** it is shown, **Then** its own badge shows found, missing or stale with the same text-plus-colour treatment.
3. **Given** a code reference to lines 45–50, **When** the reviewer follows it, **Then** the code view highlights all six lines and scrolls the first into view.
4. **Given** a line with indentation or a very long line, **When** the code view shows it, **Then** whitespace is preserved exactly and long lines scroll sideways inside the code region, not the whole page.
5. **Given** an older link that names a single `line`, **When** it is opened, **Then** that line is highlighted as before.

---

### User Story 4 - Ask a question with an accessible form (Priority: P1)

Any reviewer, including one using a screen reader, can fill in the Ask form: every field is named, the choice groups are announced as groups, and errors say what went wrong and where.

**Why this priority**: The question box has no label, the radio groups have no group name, and errors are not tied to fields (guide §4 #5). Ask is the core interaction for all three users.

**Independent Test**: Complete and submit the Ask form with a screen reader and keyboard only, including one deliberate submit failure.

**Acceptance Scenarios**:

1. **Given** the Ask form, **When** a screen reader reads it, **Then** it announces "Your question" for the text box, a "Category" group and an "Answer for" group.
2. **Given** Ask is unavailable (empty question or AI provider unavailable), **When** the reviewer reaches the Ask button, **Then** the reason is shown next to it.
3. **Given** a submit failure, **When** it happens, **Then** the error is announced immediately and is linked to the field or form it concerns.

---

### User Story 5 - Move around a review without losing your place (Priority: P2)

A reviewer always sees which PR they are in, its head commit and status, and can move between Overview, Files, Questions and Sources from any review page. A half-written question, the Answer-for choice, the selected scope and each page's scroll position survive moving to another page and back.

**Why this priority**: Today only the Code page has a way back, and every navigation resets the screen, so a Business answer choice snaps back to Technical after viewing evidence (guide §4 #6, #7). This is the core workflow defect after the P1 trust fixes.

**Independent Test**: Type a draft question, choose Business, select a range, open a claim reference, go back, and confirm all of it is unchanged.

**Acceptance Scenarios**:

1. **Given** any page of a review session, **When** it is shown, **Then** a review header shows the PR's repository, number and title, author, source → target branch, PR status, short head commit with snapshot time, Refresh (or "New commits — Refresh"), the read-only notice when it applies, and "Back to dashboard". **[NEW: repository, Back to dashboard]**
2. **Given** any page of a review session, **When** it is shown, **Then** review navigation offers Overview, Files, Questions (with a count and a running indicator) and Sources, and marks the current one for assistive technology.
3. **Given** the review header, **When** it is shown, **Then** a context strip summarises completeness (for example "Description ✓ · 2 issues ✓ · 1 issue missing · 3 files skipped"), links to the details, and never uses words such as "ready", "safe" or "approved".
4. **Given** a draft question, a Business Answer-for choice, a selected scope and a scrolled list, **When** the reviewer navigates elsewhere in the same session and returns, **Then** all four are as they left them.
5. **Given** any page, **When** a keyboard user presses Tab first, **Then** a "skip to content" link appears and moves focus to the main content. **[NEW]**
6. **Given** any page, **When** it is shown, **Then** the app header shows the workspace (base folder and platform) and the connection state (signed in, sign-in required, or AI provider unavailable). **[NEW]**

---

### User Story 6 - Ask and check evidence beside the code (Priority: P2)

On a wide screen, a reviewer asks about their selection in a panel beside the diff, and opens a cited source in a panel beside the question thread, without leaving the page. On a narrow screen the same actions open the existing full pages, so deep links keep working.

**Why this priority**: It removes most back-and-forth navigation, but depends on the review shell and preserved state from Story 5.

**Independent Test**: At 1440 pixels, select a range, open the Ask panel, ask, open a claim reference in the Evidence panel, close it, and confirm focus and scroll return to where they were. Repeat at 400 pixels and confirm full pages open instead.

**Acceptance Scenarios**:

1. **Given** a selection on a wide screen, **When** the reviewer chooses "Ask about selection", **Then** the Ask panel opens beside the diff with the scope filled in and focus on the panel heading.
2. **Given** a claim reference, **When** the reviewer follows it on a wide screen, **Then** the Evidence panel shows the referenced code, issue or description with the full range highlighted, plus "Open full page".
3. **Given** an open panel, **When** the reviewer closes it (button or Escape), **Then** focus returns to the control that opened it and the thread keeps its scroll position and Answer-for choice.
4. **Given** a narrow screen, **When** the reviewer asks or follows a reference, **Then** the existing full-page route opens instead of a panel.
5. **Given** an existing deep link to any review route, **When** it is opened, **Then** it shows the same content as before the redesign.
6. **Given** Overview, **When** it is shown, **Then** "Ask about this PR" is available without entering the diff, so a business analyst can ask about the whole PR.

---

### User Story 7 - Find files fast on a long PR (Priority: P2)

A reviewer opening a large PR sees the PR summary, the context completeness and the changed-file list near the top of Overview, with per-file explanations available on request, and can filter the file list.

**Why this priority**: Overview currently renders every per-file summary before the file list, burying navigation on long PRs (guide §4 #8).

**Independent Test**: Open a session with 30 or more changed files and reach any file's diff from Overview without scrolling past per-file summaries.

**Acceptance Scenarios**:

1. **Given** Overview, **When** it is shown, **Then** the order is PR summary, context completeness (expandable, with reasons), changed files (status, +/− counts, skipped reason), then referenced PRs.
2. **Given** a changed-file row, **When** the reviewer asks for its explanation, **Then** the per-file summary is disclosed in place or shown in the file view.
3. **Given** the file list, **When** the reviewer types in its filter, **Then** only matching files remain, and an empty result says so. **[NEW]**
4. **Given** Overview, **When** it is shown, **Then** a "Review focus" region is reserved for future lenses and shows only the line "Not available yet."

---

### User Story 8 - See honest loading, empty and failure states (Priority: P2)

Wherever the interface waits for data, the reviewer can tell whether it is loading, genuinely empty, failed, unknown or stale, and can retry a failure in place. If live updates drop, they are told and can reconnect.

**Why this priority**: Several failures are currently swallowed and shown as empty lists, and a dropped live-update stream is silent (guide §4 #9). Showing "nothing" when the truth is "we could not check" misleads a technical lead.

**Independent Test**: Make the session list, AI provider check and suggested questions each fail in turn, then drop the live-update stream, and check each shows a failed state with Retry and the stream shows a reconnect banner.

**Acceptance Scenarios**:

1. **Given** any region that loads data, **When** loading fails, **Then** it shows what failed and a Retry action, not an empty list.
2. **Given** a region whose data loaded but is empty, **When** it is shown, **Then** it explains the empty state and, where useful, what to do next.
3. **Given** live updates drop, **When** the reviewer is on a session page, **Then** a banner reads "Live updates paused — Reconnect" and Reconnect restores updates.
4. **Given** an answer produced for an earlier head commit, **When** it is shown, **Then** the older-head marker is visible.

---

### User Story 9 - Close or delete a session safely (Priority: P2)

Session actions sit in a secondary menu. Deleting a session asks for confirmation in a dialog that states the consequences, offers Cancel as the default, and makes Delete clearly dangerous.

**Why this priority**: Today the confirmation replaces the button with an identical-looking one and there is no Cancel (guide §4 #10). Deleting a session loses stored questions and answers.

**Independent Test**: Open the session menu, choose Delete, press Escape, and confirm nothing was deleted and focus returned; then delete for real.

**Acceptance Scenarios**:

1. **Given** the review header, **When** the reviewer opens session actions, **Then** Close and Delete are offered there, not as primary buttons.
2. **Given** the reviewer chooses Delete, **When** the dialog opens, **Then** it states what will be lost, focus is on Cancel, and the Delete button is styled as dangerous.
3. **Given** the dialog is open, **When** the reviewer presses Escape or Cancel, **Then** nothing is deleted and focus returns to the session actions control.

---

### User Story 10 - Set up and sign in with guidance (Priority: P3)

A new user chooses a base folder and a platform, sees which repositories were found under it, sees only the fields that apply to the platform they pick, reads limits in human units, and after saving gets a checklist of what is connected and what to do next. Sign-in explains why it is needed and returns them to where they were.

**Why this priority**: Setup is done rarely, but today it shows tracker fields that do not apply and raw byte counts (guide §4 #11).

**Independent Test**: Configure a base folder with GitHub, then GitLab (self-managed), then Bitbucket Cloud with Jira Cloud as tracker, checking the visible fields each time; trigger sign-in from a session page and confirm the return.

**Acceptance Scenarios**:

1. **Given** a chosen source-control platform, **When** Setup shows its fields, **Then** the base address field appears only when that platform declares it needs one (a self-hosted platform).
2. **Given** a chosen issue tracker, **When** Setup shows its fields, **Then** only the fields that tracker declares appear.
3. **Given** the limits, **When** they are shown, **Then** they sit in a collapsed "Advanced limits" section, in human units (KB, lines), with defaults visible.
4. **Given** server validation errors, **When** Setup is saved, **Then** each error is shown at its field and summarised at the top of the form.
5. **Given** a successful save, **When** the page updates, **Then** a connection checklist shows base folder readable, repositories found and signed in, each with its status and the next step. **[NEW]**
6. **Given** a sign-in prompted from another page, **When** sign-in succeeds, **Then** the reviewer returns to that page. **[NEW]**
7. **Given** the Sign-in page, **When** it is shown, **Then** it explains why sign-in is needed, for which platform, and that access is read-only.
8. **Given** a saved base folder, **When** Setup shows it, **Then** it lists the repositories found, the ones skipped with their reason, and duplicates, with a "Rescan" action. **[NEW]**

---

### User Story 11 - Start or resume a review from Home (Priority: P3)

Home, the dashboard of Story 12, lists the reviewer's sessions first, then open pull requests across repositories, each with a clear "Start review" or "Resume review" action, and a filter over what is loaded.

**Why this priority**: Home works today; this is polish (guide §4 #12).

**Independent Test**: With one existing session and several open PRs, check the actions, filter the list, and start a review while the other rows stay usable.

**Acceptance Scenarios**:

1. **Given** existing sessions, **When** Home loads, **Then** "Your review sessions" appears before "Open pull requests".
2. **Given** a PR row, **When** it is shown, **Then** it shows repository, number, title, author, branches, updated time, and "Start review" or "Resume review".
3. **Given** no open PRs, **When** Home loads, **Then** it reads "No open pull requests in <base folder>".
4. **Given** a review is starting from one row, **When** it is in progress, **Then** only that row is busy and the others stay usable.
5. **Given** the filter, **When** the reviewer types, **Then** only matching loaded items remain. **[NEW]**

---

### User Story 12 - Choose the next PR from a dashboard across a base folder (Priority: P1)

A reviewer points the workbench at one folder holding many clones. The dashboard lists the open pull requests of every repository found under it. They open one, review it, return to the dashboard exactly where they left it, and choose the next. **[NEW]**

**Why this priority**: The reviewer works across many repositories. A single configured repository makes them reconfigure the workbench for each pull request. This changes the entry point every other story starts from, so it is built straight after the P0 trust and accessibility fixes (Stories 2 to 4).

**Independent Test**: Make a base folder holding three clones on the chosen platform at different depths, plus one clone on another host. Check the dashboard lists the open PRs of the three, the fourth is shown in Setup as skipped with its reason, and after opening a PR and choosing "Back to dashboard" the filter and scroll position are unchanged.

**Acceptance Scenarios**:

1. **Given** a base folder with repositories nested at different depths, **When** discovery runs, **Then** every repository whose remotes are on the chosen platform is found.
2. **Given** a repository whose remotes are on another host, or that has no remote, **When** discovery runs, **Then** it is listed in Setup as skipped with that reason, and its pull requests are not listed.
3. **Given** the dashboard, **When** one repository's pull requests fail to load, **Then** that repository shows its own failed state with Retry and every other repository's pull requests still show.
4. **Given** a filtered and scrolled dashboard, **When** the reviewer opens a pull request and then chooses "Back to dashboard", **Then** the filter and scroll position are as they left them.
5. **Given** the dashboard, **When** the reviewer filters by repository or types text, **Then** only matching loaded pull requests and sessions remain.
6. **Given** a session whose repository is no longer found under the base folder, **When** it is opened, **Then** it is readable, and Refresh and Ask are unavailable with the reason shown.

---

### Edge Cases

- A referenced range runs past the end of the file, or the referenced commit is no longer available: the code view highlights what exists and shows the reason as a state, not an error.
- A selection crosses from old-side to new-side lines: the selection stays on one side; choosing a line on the other side starts a new selection.
- The head commit moves while a draft question is open: the draft is kept and the header offers "New commits — Refresh".
- The session is deleted or closed in another tab while a panel is open: the page shows the session is no longer available and offers Home.
- The window is resized across a layout boundary while a panel is open: the content stays open, as a panel or as a full page, without losing the draft.
- A filter matches nothing: an explicit "no matches" state with a way to clear the filter.
- A binary file, a file with no textual change, or a skipped file: the diff says which, with the skip reason.
- The page is reloaded: the URL opens the same screen and the in-progress state from Story 5 is restored. Closing the tab discards it.
- A read-only (closed or merged) PR: as 001 FR-041 requires, the session cannot be refreshed or asked new questions, so Refresh and the Ask actions are unavailable with the reason shown; all reading works.
- PR, issue and AI text containing HTML or markdown: it shows as literal text.
- A repository nested inside another repository's folder: both are found.
- A fork clone whose remotes name two repositories on the platform: each repository is listed.
- The same repository cloned in two folders: it appears once, the folder used is named, and the other is listed as a duplicate.
- The base folder holds no repositories, or none on the chosen platform: Setup and the dashboard say so and point to Setup.
- The base folder contains, or is inside, the workbench's own data folder: Setup refuses it with the reason.
- A very large base folder: discovery shows progress (folders scanned) and can be cancelled; repositories found so far are kept.

## Requirements *(mandatory)*

### Functional Requirements

**Stage 1: wireframes**

- **FR-001**: The wireframe set MUST cover the screens and states listed in Story 1 at about 1440, 1000 and 400 pixels wide.
- **FR-002**: The Diff and panel wireframes MUST annotate keyboard path and focus order, including focus on panel open and close.
- **FR-003**: Plan MUST NOT start until the product owner has approved the wireframes, and changes the wireframes reveal MUST be folded into this spec first.
- **FR-004**: The wireframes MUST label every capability that did not exist before as **[NEW]**.

**Trust and accessibility fixes (guide §4 P0)**

- **FR-005**: Diff rows MUST distinguish added, removed and unchanged lines by a `+`/`−` mark and a background, in both themes.
- **FR-006**: Diff range selection MUST work by keyboard: Enter or Space sets the anchor, Shift with an arrow extends, Escape clears, and each line control shows a visible focus indicator.
- **FR-007**: A selection change MUST update a visible scope bar and be announced to screen readers.
- **FR-008**: Selected diff rows MUST show a selection bar as well as a colour change.
- **FR-009**: Every claim and completeness badge MUST show its text label, an icon, and a colour meeting AA contrast in both themes.
- **FR-010**: Following a code reference MUST highlight the full referenced range, from its first to its last line.
- **FR-011**: The code view MUST preserve whitespace and scroll long lines inside the code region.
- **FR-012**: The Ask form MUST give the question box a visible label, group Category and Answer-for choices with group names, link errors to their fields, and announce a submit failure immediately.
- **FR-013**: The Ask button MUST show why it is unavailable whenever it is disabled.

**Review shell and state**

- **FR-014**: Every page MUST have an app header with a skip-to-content link, the product name linking Home, workspace identity (base folder and platform; amended by FR-048), connection state, and a settings menu holding Setup and Sign-in.
- **FR-015**: Every review-session page MUST show the review header, review navigation and context strip described in Story 5.
- **FR-016**: The context strip and all other copy MUST NOT state or imply that a PR is ready, safe or approved to merge.
- **FR-017**: The question draft, Category, Answer-for choice, selected scope and per-page scroll position MUST survive navigation within the same session and reloads of the same browser tab. They MUST be kept only in that tab, never sent to the server, and never hold credentials (constitution X.7).
- **FR-018**: Answer-for MUST default to Technical and keep the reviewer's choice for that session.

**Panels**

- **FR-019**: At 1200 pixels and wider, Ask and Evidence MUST open as side panels; between 900 and 1199 pixels they MUST overlay the page; below 900 pixels they MUST open the existing full-page routes.
- **FR-020**: Opening a panel MUST move focus to its heading; closing it (button or Escape) MUST return focus to the control that opened it.
- **FR-021**: The Evidence panel MUST show the referenced source with its full range highlighted and an "Open full page" link to the existing route.
- **FR-022**: Overview MUST offer "Ask about this PR"; Files MUST offer "Ask about selection" when a range is selected.
- **FR-023**: Every existing route MUST keep working as a deep link with the same content.
- **FR-024**: At 1200 pixels and wider, the file list MUST sit in a collapsible left region; between 900 and 1199 pixels it MUST be a drawer; below 900 pixels the diff MUST offer "‹ Previous file", "Next file ›" and "All changed files".

**Overview and files**

- **FR-025**: Overview MUST order PR summary, context completeness, changed files, then referenced PRs, with per-file summaries disclosed on request. These are the per-file summaries the summary run already produces; when and how they are generated does not change.
- **FR-026**: The file list MUST offer a text filter over its files. **[NEW]**
- **FR-027**: Overview MUST reserve a "Review focus" region that shows only "Not available yet." and MUST NOT show risk, coverage, readiness or role content in it.

**States**

- **FR-028**: Every region that loads data MUST distinguish loading, empty, failed, unknown and stale, and offer Retry when failed.
- **FR-029**: Failures that are currently hidden (session list, AI provider check, suggested questions) MUST be shown as failed states.
- **FR-030**: A dropped live-update stream MUST show the "Live updates paused — Reconnect" banner on session pages, and Reconnect MUST restore updates.
- **FR-031**: Streaming answer text and scope changes MUST be announced politely to screen readers, throttled so speech does not flood.

**Session actions**

- **FR-032**: Close and Delete MUST sit in a secondary session-actions menu.
- **FR-033**: Delete MUST open a confirmation dialog stating what is lost, with focus on Cancel, Escape cancelling, and a danger-styled confirm.

**Setup, sign-in and Home**

- **FR-034**: Setup MUST show only the fields the chosen source-control platform and chosen tracker declare they need, for the platforms registered at implementation time, and MUST NOT name or branch on a specific platform (constitution VIII.2). The repository and clone path fields are replaced by the base folder (FR-048).
- **FR-035**: Setup MUST show limits in human units inside a collapsed "Advanced limits" section with defaults visible.
- **FR-036**: Setup MUST show each server validation error at its field and in a summary at the top.
- **FR-037**: After a successful save, Setup MUST show a connection checklist with each check's status and next step. **[NEW]**
- **FR-038**: Sign-in MUST explain why it is needed and that access is read-only, and MUST return the reviewer to the originating page after success. **[NEW: return]**
- **FR-039**: Home (the dashboard of FR-052) MUST list sessions before open PRs, give each row "Start review" or "Resume review", show empty and failed states, busy only the row being started, and offer a filter over loaded items. **[NEW: filter]**

**Workspace and dashboard**

- **FR-048**: Setup MUST take one base folder, one source-control platform (with a base address when that platform declares one) and one issue tracker. These replace the single repository and clone path. **[NEW]**
- **FR-049**: The workbench MUST find every git repository under the base folder at any depth, without changing any of them, without following symbolic links, and without looking inside its own data folder.
- **FR-050**: Each found repository MUST be matched to the chosen platform by its remotes. A repository with no matching remote MUST be listed as skipped with the reason.
- **FR-051**: The same platform repository found in several folders MUST appear once, using the clone nearest the base folder (ties broken by the code-point order of the path) so the choice is stable between scans, naming the folder used and listing the others as duplicates.
- **FR-052**: Home MUST be a dashboard of open PRs across all matched repositories. Each row MUST show repository, number, title, author, branches, updated time, and "Start review" or "Resume review". Rows MUST be sorted most recently updated first. **[NEW]**
- **FR-053**: The dashboard MUST filter by repository and by text, over loaded items. **[NEW]**
- **FR-054**: A repository whose PRs fail to load MUST show its own failed state with Retry, while every other repository's PRs still show (constitution V.4).
- **FR-055**: Every review page MUST show the PR's repository and offer "Back to dashboard". Returning MUST restore the dashboard's filters and scroll position, kept as FR-017 keeps view state. **[NEW]**
- **FR-056**: Setup MUST show the discovery result (matched, skipped with reasons, duplicates) and a "Rescan" action. Discovery MUST run on save, on Rescan and at start-up. **[NEW]**
- **FR-057**: A session whose repository is no longer found under the base folder MUST stay readable, with Refresh and Ask unavailable and the reason shown.
- **FR-058**: The issue tracker settings MUST apply to every repository. A tracker that reads issues from the repository itself MUST use each PR's own repository.

**Cross-cutting**

- **FR-040**: Every page MUST meet WCAG 2.2 AA, with landmarks, exactly one top-level heading, labelled controls, no meaning carried by colour alone, reduced motion respected and targets at least 24 by 24 pixels.
- **FR-041**: Every page MUST work in light and dark themes and at 400, 1000 and 1440 pixels wide without page-level horizontal scrolling.
- **FR-042**: All PR, issue, code and AI text MUST still be shown as plain text; the redesign MUST NOT introduce any path that renders it as markup.
- **FR-043**: The interface MUST NOT offer any action that writes to the repository or to any platform.
- **FR-044**: Evidence/Inference labels, unresolved-reference reasons, skipped-file reasons and the older-head marker MUST stay visible wherever they appear today.
- **FR-045**: Every existing feature listed in guide §3 "Strengths to preserve" MUST remain available.
- **FR-046**: Existing test identifiers MUST stay stable, or each change MUST be made deliberately with the affected tests updated in the same change.
- **FR-047**: New automated tests MUST cover range highlighting, keyboard selection, badge attributes, state preserved across navigation, and cancelling Delete.

### Key Entities

- **Review session view state**: what a reviewer has in progress within one session in one browser tab, kept through reloads of that tab and discarded when it closes: question draft, category, Answer-for choice, selected scope (PR, file or range with side and label), scroll position per page, and which panel is open. Belongs to one session; does not change stored session data.
- **Badge**: a semantic label shown as text, icon and colour. Values: Evidence, Inference, Documented intent, Inferred intent, Found, Missing, Stale, Skipped, Unresolved, Older head, Read-only, PR status.
- **Async region state**: the condition of any data-loading area: loading, empty, failed (with reason and retry), unknown, or stale.
- **Workspace**: the base folder, the one source-control platform (and its base address when it declares one), the one issue tracker, and the repositories found. Replaces the single configured repository.
- **Discovered repository**: one repository found under the base folder: its platform repository id, the folder used, and its status (matched, skipped with a reason, or duplicate of another folder). Sessions keep referring to a repository by platform and id, so a session outlives its folder moving.
- **Wireframe set**: the Stage 1 deliverable, kept in `wireframes/` beside this spec as annotated HTML pages, one per screen or state, each viewable at the three widths, with keyboard and focus annotations, and an approval record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An automated accessibility check reports zero WCAG 2.2 AA violations on every route, in light and dark themes.
- **SC-002**: A keyboard-only walkthrough of Home → Start review → Overview → Diff → select a range → Ask → open evidence → return completes with no pointer use, and on return the draft, Answer-for choice, scope and scroll are unchanged.
- **SC-003**: Every route renders with no page-level horizontal scroll at 400, 1000 and 1440 pixels, checked in a browser.
- **SC-004**: Following a reference to N lines highlights exactly N lines, for every reference in the test data.
- **SC-005**: 100% of existing unit, contract and end-to-end tests pass, and the five new test areas in FR-047 each have at least one passing test.
- **SC-006**: Every one of the 13 findings in guide §4 is resolved, and each is checked off with a test or a recorded manual check.
- **SC-007**: A copy review finds zero interface strings that state or imply merge readiness.
- **SC-008**: A search of the interface finds zero places where untrusted text is rendered as markup.
- **SC-009**: The product owner records approval of the wireframes before plan starts.
- **SC-010**: With a base folder holding matched repositories nested up to three levels deep and one repository on another host, the dashboard lists the open PRs of every matched repository, and Setup lists the other as skipped with its reason.

## Assumptions

- The UI guide copied beside this spec is the agreed design direction; the handoff's "Agreed decisions" are not revisited.
- One shared workflow serves developer, technical lead and business analyst. There is no role switcher.
- Themes follow the operating system preference, as today. No manual theme switch is added.
- Filters work on items already loaded in the page; they do not query the server.
- The connection checklist uses checks the server can already make or can make read-only; it adds no write.
- Automated tests today exercise the server over HTTP; none drives the browser interface. FR-047 and SC-001 need a way to test the interface in a browser, chosen in plan.
- Discovery reads only the folder tree and each repository's remotes; it runs no command that changes a repository (constitution IX).
- A self-hosted platform's base address is what recognises its remotes, so one base folder serves one self-hosted instance.
- Today a platform declares only whether it needs a base address. Trackers will also need to declare their site and project-key fields for FR-034.
- Wireframes are low fidelity: layout, content, states and keyboard flow, not final visual styling. They use the app's existing colour tokens, so both themes can be viewed.
- The registered platforms today are GitHub, GitLab (self-managed), Bitbucket Cloud, GitHub Issues, GitLab Issues and Jira Cloud. Setup variants are confirmed against the registry at implementation, since GitLab work is still uncommitted in the working tree.
- Repository documentation (including moving the guide to `docs/ui-guide.md`) is written in a later, approved session, not here.

## Out of Scope

- A role switcher.
- Risk, coverage, readiness or role lenses (only empty layout space is reserved).
- Any action that writes to a repository or platform.
- Repositories on different platforms in one base folder.
- A different issue tracker per repository.
- Filtering the dashboard to pull requests the reviewer is asked to review.

## Verbatim Constraints

- Diff rows: `class="diff-line"` with `data-type` (`add`, `remove`, `context`) and `aria-selected`.
- Badges carry `data-label` (claims) and `data-status` (completeness) on the badge element itself.
- The code route accepts `start` and `end`; a link with only `line` keeps working.
- The Ask form uses the labels `Your question`, `Category` and `Answer for`, with choices `Technical` and `Business`; default `Technical`.
- Scope bar text: `Selected: <path> lines a–b (new side)` (or `old side`).
- Actions: `Ask about this PR`, `Ask about selection`, `Start review`, `Resume review`, `Open full page`, `New commits — Refresh`.
- Live-update banner: `Live updates paused — Reconnect`.
- Home empty state: `No open pull requests in <base folder>`.
- Dashboard and workspace copy: `Back to dashboard`, `Rescan`, `Your review sessions`, `Open pull requests`, `Base folder`.
- Review navigation: `Overview`, `Files`, `Questions`, `Sources`.
- Setup section: `Advanced limits`. Overview reserved region: `Review focus`, with the line `Not available yet.` Narrow file navigation: `‹ Previous file`, `Next file ›`, `All changed files`.
- New capabilities are labelled `[NEW]`.
- Existing `data-testid` values in `specs/001-pr-review-workbench/contracts/ui.md`, including `delete-session-confirm`, `scope-indicator`, `diff-line-head-<n>`, `diff-line-base-<n>`, `claim`, `claim-ref`, `answer-for-technical` and `answer-for-business`, stay as they are unless changed deliberately with their tests (FR-046). One deliberate change: `pr-item-<number>` becomes `pr-item-<repository>-<number>`, because numbers repeat across repositories.
