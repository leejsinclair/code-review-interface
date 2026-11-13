---

description: "Task list for Risk-Based Review Focus (feature 004)"
---

# Tasks: Risk-Based Review Focus

**Input**: Design documents from `/specs/004-risk-review-focus/`

**Prerequisites**: plan.md, spec.md, research.md (RR-1 to RR-11), data-model.md, contracts/ (http-api, rule-file, source-control-current-user, ui), quickstart.md, tests/behaviour-checklist.md

**Tests**: Requested. The plan's Verification Plan lists 38 obligations (VO-001 to VO-038) and constitution XI.1 requires a failing test ahead of each behaviour. In every phase the test task comes first and MUST be seen to fail before the implementation task starts.

**Organization**: Grouped by user story so each can be built and checked on its own. Phase 2 holds only what every story needs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US6, from spec.md
- Commands: focused test `node --test <file>`; `npm run typecheck`; `npm test`; `npm run build:ui` then `npm run test:ui`

## Path Conventions

Single project: server in `src/`, UI in `src/ui/`, tests in `test/{unit,integration,contract,end-to-end,ui}`. Class names are lower case on the wire and in the store (`low | normal | elevated | critical`), mapped to Low/Normal/Elevated/Critical only in `src/ui/labels.ts`. No numeric score, percentage or per-person total exists anywhere (FR-002, FR-025, FR-040).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire types, schema, labels and fixtures that every later task reads.

- [x] T001 Add the risk wire types to `src/contracts/http.ts` exactly as in `contracts/http-api.md`: `RiskClass`, `RiskOrigin`, `LineRange`, `RiskReason`, `OverrideRecord`, `RiskFile`, `RiskReport`, the `risk` SSE event payload `{ snapshotId, revision, changedPaths, cause }`, and the override request body `{ snapshotId, path, class, reason }`. No field named score, percentage or rank.
- [x] T002 [P] (start only after T012 is written and seen failing, XI.1) Add the six append-only tables to `src/store/schema.sql` per `data-model.md`: `risk_ruleset`, `risk_classification`, `risk_reason`, `risk_run`, `risk_assessment_item`, `class_override`. Use `CREATE TABLE IF NOT EXISTS`, `STRICT`, the BEFORE UPDATE / BEFORE DELETE triggers and session-walk delete guard used by the existing tables, and these constraints verbatim: `mechanical = 0 OR rule_class = 'low'`; `not_fully_analysed IS NULL OR rule_class <> 'low'`; `UNIQUE (snapshot_id, path)`; `matched_on = 'path' ⇔ json_array_length(lines) = 0`; `proposed_class` in `normal, elevated, critical`; `ignored_reason` in `not-higher, no-resolvable-line, unknown-file, not-assessable` iff `applied = 0`; `provider <> ''`; `cancel_reason` in `user, restart, superseded` iff cancelled; `reason` `trim(reason) <> ''`; `class <> replaced_class`; `reviewer_handle` and `reviewer_name` both NULL or both set, both set iff `calculated_class = 'critical'` and `class` ranks below critical (`calculated_class` is a NOT NULL column holding the file's rule-or-AI class at save time, before any override); index `class_override_by_path (session_id, path, created_at)`. No existing table changes.
- [x] T003 [P] Add `RISK_LABELS` and `REVIEW_FOCUS = { heading: 'Review focus' }` to `src/ui/labels.ts` with the verbatim strings in `contracts/ui.md` (`Low`, `Normal`, `Elevated`, `Critical`, `Mechanical (candidate for reduced review)`, `Rule`, `AI`, `Reviewer override`, `Not fully analysed`, `Not assessed by AI: lockfile`, `Not assessed by AI: generated file`, `AI assessment in progress`, `AI assessment missing`, `AI opinion ignored`). Keep `REVIEW_FOCUS.body` for now: `src/ui/screens/overview.tsx` still renders it until T031, and removing it earlier breaks `typecheck`. The word "approved" MUST NOT appear.
- [x] T004 [P] Create the reference pull request fixture `test/fixtures/github/risk-reference.json` (and any sibling `risk-*.json`) with changed files: a database migration, an authentication file, a lockfile, a README, a comment-only edit in an auth file, a pure rename, a binary file, a file with markup in its path. Include real unified-diff `patch` text. Used by quickstart.md scenarios and the tasks below.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure helpers, the store methods and the snapshot hook. No user story can start before this is done.

**⚠️ CRITICAL**: Complete before Phase 3.

- [x] T005 [P] Write failing unit tests `test/unit/risk-glob.test.ts`: `*`, `**`, `?`, case-insensitive match on `/`-separated repository paths; patterns over 200 characters or malformed are rejected; no regular expression is built from input (RR-3, RR-4).
- [x] T006 [P] Implement `src/core/risk/glob.ts` (small `*`/`**`/`?` matcher, no `RegExp` from user data) to pass T005.
- [x] T007 [P] Write failing unit tests `test/unit/risk-patch.test.ts`: parse a stored `patch` into changed lines with `side` (`head`/`base`) and line numbers; the change fingerprint is equal for the same added/removed lines at shifted positions and different head commits, differs when a line differs; fallback fingerprint `status + paths + additions + deletions + size_bytes` for a limit-skipped file with no patch (RR-7).
- [x] T008 [P] Implement `src/core/risk/patch.ts`: patch parser and `changeFingerprint` (sha256 via `node:crypto` over status, old path, new path and ordered `+<line>`/`-<line>`, no hunk headers, context or line numbers) to pass T007.
- [x] T009 [P] Write failing unit tests `test/unit/risk-comments.test.ts` (VO-007, VO-008): comment-only and blank lines are non-behavioural for tabled languages; a trailing comment after code is code; block-comment state across hunk lines; a TypeScript reindent is whitespace-only; a Python or YAML reindent and a reordering of statements are behavioural; an unknown extension makes every non-blank changed line behavioural; added and deleted files are always behavioural (RR-2).
- [x] T010 [P] Implement `src/core/risk/comments.ts`: per-extension comment table (families in `LANGUAGES` plus shell, SQL, YAML, TOML, HTML/XML, Markdown), hunk scan, whitespace-sequence test skipped for whitespace-significant languages (Python, YAML, Makefile, F#, Haskell) to pass T009.
- [x] T011 [P] Create `src/core/risk/classes.ts`: `RiskClass` type, the rank constant (low 0, normal 1, elevated 2, critical 3; a code constant, never stored or shown as a number) and `maxClass`/`isHigher` helpers.
- [x] T012 Extend `test/integration/review-store.test.ts`: add the six new tables to the append-only test (UPDATE and DELETE abort), assert deleting a session removes their rows, and assert the new store methods exist while no by-reviewer or cross-file override query does (VO-024, VO-032 part). Must fail first, and is written before the schema in T002 so the trigger tests are seen failing.
- [x] T013 Add append and read methods to `src/store/review-store.ts` for the six tables: `appendRiskClassification` (with reasons and ruleset row in one transaction), `readRiskClassifications(snapshotId)`, `appendRiskRun` with items, `readLatestCompletedRiskRun(snapshotId)`, `appendClassOverride`, `readOverrideHistory(sessionId, path)`, `readLatestOverride(sessionId, path)`. No update, no delete, no by-reviewer or cross-file query. Makes T012 pass.
- [x] T014 Write a failing integration test (in `test/integration/session-context.test.ts`) that `deps.onSnapshotStored(sessionId, snapshotId)` is called right after `appendSnapshot` on both the open/create path and the `refresh` path, including a snapshot with no workspace (`repositoryStatus = 'missing'`) (RR-1).
- [x] T015 Add the optional `onSnapshotStored` dependency to `src/core/sessions.ts` and call it after `appendSnapshot` at both call sites, to pass T014. A failure inside the hook MUST NOT fail snapshot creation (V.4).

**Checkpoint**: helpers, tables and hook exist; user stories can start.

---

## Phase 3: User Story 1 - See where to look first (Priority: P1) 🎯 MVP

**Goal**: Every changed file gets a rule-based class with reasons; the Overview "Review focus" section lists Critical and Elevated files, mechanical candidates and not-fully-analysed files with counts.

**Independent Test**: Open the session for the reference PR (migration, auth file, lockfile, README). Without opening a file, Review focus lists the migration (Critical, `R-MIGRATION`) and the auth file with reasons, and lists the lockfile as Mechanical (candidate for reduced review).

### Tests for User Story 1 (write first, confirm failing)

- [x] T016 [P] [US1] Write failing unit tests `test/unit/risk-classify.test.ts`: VO-001 (two rules, higher wins, both listed), VO-002 (Critical for path-in-area + behavioural in auth, authz, delete, finance and migration; at least Elevated for CI/container/IaC; Elevated for a term-only match in an ordinary file), VO-003 (classify twice, identical output), VO-004 (path-only match says so and records no lines), VO-005 (no rule matches: Normal, reason "No mandatory-scrutiny rule matched", origin `default`, no rule ID), VO-006 (comment-only edit in auth and migration files: Low, `R-COMMENT-ONLY`, reason names the rule not applied, mechanical), VO-009 (added and deleted file in a sensitive area are behavioural; deleted migration is Critical), VO-010 (pure rename Low `R-RENAME-ONLY` mechanical; rename into or out of a sensitive path Elevated), VO-011 (lockfile and generated file Low mechanical; one inside a sensitive path keeps the sensitive class and is not mechanical), VO-012 (binary and limit-skipped file: never below Normal, `notFullyAnalysed` with reason from path rules only), VO-037 (only paths and changed lines of the changed files are read).
- [x] T017 [P] [US1] Write failing unit tests `test/unit/risk-effective.test.ts` for the rule-only report: effective class equals rule class, every changed file appears once with at least one reason, counts per class plus `mechanical` and `notFullyAnalysed`, `files: []` with zero counts for no files, and VO-031 (the `RiskReport` type and output carry no score, percentage or rank).
- [x] T018 [P] [US1] Write failing integration test `test/integration/risk-service.test.ts` for classify-on-store: storing a snapshot writes ruleset, classifications and reasons synchronously without a workspace; VO-036 (500 synthetic files with patches classified within 2 s, independent of any AI run); classifying a snapshot with a failing hook does not break the snapshot.
- [x] T019 [P] [US1] Write failing end-to-end test `test/end-to-end/risk.test.ts` (first cases): `GET /api/sessions/:id/snapshots/:snapshotId/risk` returns every changed file once with class and reasons, 404 for an unknown session or snapshot, old snapshots readable with `canOverride.allowed = false`, the guard (token, Host, Origin) applies, and the `risk` SSE event carries paths and revision but no class.
- [x] T020 [P] [US1] Write failing UI test `test/ui/overview.ui.ts` (Review focus cases, VO-033 part): counts line always shown, Critical then Elevated list with reasons and rule IDs and links, "No file is Elevated or Critical." when none, mechanical list with kind and a link that opens the diff, not-fully-analysed list with reasons, "No changed files." for none, the heading is "Review focus" and "Not available yet." is gone.

### Implementation for User Story 1

- [x] T021 [P] [US1] Create `src/core/risk/builtin-rules.ts`: rule data `{ id, family, class, floor, paths, lineTerms }` for `R-AUTH`, `R-AUTHZ`, `R-DELETE`, `R-FINANCE`, `R-MIGRATION`, `R-CONFIG`, `R-LOCKFILE`, `R-GENERATED`, `R-COMMENT-ONLY`, `R-RENAME-ONLY` with the path globs and generated markers listed in RR-3, and a built-in ruleset number for the version string.
- [x] T022 [US1] Create `src/core/risk/ruleset.ts` (built-ins only for now): `loadRuleset()` returns the built-in rules and `ruleset_version = "builtin-<N>"`, `ruleFile: 'absent'`, empty notice. The rule-file loader is added in US6; keep the signature open to an optional file input.
- [x] T023 [US1] Create `src/core/risk/classify.ts` (pure): files plus ruleset to classifications, reasons and responsible lines, following the precedence in RR-3 (1 binary/skipped, 2 rename-only, 3 sensitive path rules, 4 comment-only → Low `R-COMMENT-ONLY` naming rules not applied, 5 highest wins with every rule listed, 6 default Normal). Reason text comes from fixed templates plus the rule label; no PR text is interpolated. Passes T016.
- [x] T024 [US1] Create `src/core/risk/effective.ts`: derive `RiskFile` and `RiskReport` from stored rows (rule class, `mechanical`, counts, `canOverride`, `revision`); the AI and override steps are added in US4 and US5. Nothing is cached in a table. Passes T017.
- [x] T025 [US1] Create `src/core/risk-service.ts` with `onSnapshotStored`: read `changed_file` rows, load the ruleset, classify, append via the store in one call, publish SSE `risk` with cause `classified`; and `getReport(sessionId, snapshotId)`. Passes T018.
- [x] T026 [US1] Add `src/server/routes/risk.ts` with the report `GET`, register it in `src/server/routes.ts`, add the `risk` event name in `src/server/events.ts`. Passes T019.
- [x] T027 [US1] Wire the risk service in `src/main.ts` (pass `onSnapshotStored` into the session dependencies).
- [x] T028 [P] [US1] Add `getRisk` to `src/ui/api.ts`, create `src/ui/state/use-risk.ts` (`useRisk(sessionId, snapshotId)` loads the report and re-reads on the `risk` event) and handle the `risk` event in `src/ui/state/live-stream.ts`; announce each path whose `effectiveClass` changed through `src/ui/state/announcer.ts` (FR-033).
- [x] T029 [P] [US1] Create `src/ui/components/risk-badge.tsx`: icon (`lucide-preact`) plus the class word, `aria-label` "Risk: Critical" etc., meaning independent of colour; styles in `src/ui/app.css` for light and dark themes.
- [x] T030 [US1] Create `src/ui/components/review-focus.tsx` (`data-testid="review-focus"`) per `contracts/ui.md` order: counts, notices area, Critical list, Elevated list, empty sentence, Mechanical list, Not fully analysed list, no-files sentence; rows link to `#/sessions/:id/diff?path=…` (first marked line when the file has lines, SC-010); uses `AsyncRegion` for loading, failed with Retry and stale. Text only, never markup (FR-034).
- [x] T031 [US1] Replace the placeholder in `src/ui/screens/overview.tsx` with `review-focus.tsx` using `useRisk`, then delete `REVIEW_FOCUS.body` ("Not available yet.") from `src/ui/labels.ts`. Passes T020.

**Checkpoint**: US1 works alone and is the MVP: rule classes are stored, served and listed in the Overview.

---

## Phase 4: User Story 2 - Understand why a file has its class (Priority: P1)

**Goal**: For any file the reviewer sees the rules, reasons and responsible lines, and the lines are marked in the diff, not by colour alone.

**Independent Test**: Open the Files view for a Critical file: class, rule ID, reason text and responsible lines are visible, the lines carry a mark with an accessible name, and every mark is reachable by keyboard.

- [x] T032 [P] [US2] Write failing UI test `test/ui/diff.ui.ts` (risk cases, VO-029 part): two-rule file shows both rules with IDs and the higher class; each responsible line has a gutter mark with `aria-label="Risk mark: R-AUTH: <reason>"` (`AI` for an AI mark) in light and dark themes; a path-only rule shows "Matched on the path; no changed lines" and no marks; "Next risk mark" and "Previous risk mark" reach every marked line and announce "Risk mark 2 of 5: …", and announce there is no further mark at the ends; marks coexist with selection and range highlighting.
- [x] T033 [P] [US2] Create `src/ui/components/risk-reasons.tsx`: reasons with rule ID or `AI` origin, distinct origin labels for Rule, AI and Reviewer override (III.1), the not-applied sensitive rule shown as "would have applied, was not", `data-testid` per `contracts/ui.md`. Reasons render as text only.
- [x] T034 [P] [US2] Add a `riskMarks` prop to `src/ui/components/code-view.tsx`: a separate gutter cell with glyph and `aria-label`, never a background, alongside existing selection and range highlighting; styles in `src/ui/app.css`.
- [x] T035 [US2] In `src/ui/screens/diff.tsx` add the file header (badge, `risk-reasons`, override state placeholder), pass `riskMarks` from `useRisk`, and add the `Next risk mark` / `Previous risk mark` buttons moving focus through marked lines with announcements. Passes T032.

**Checkpoint**: US1 and US2 deliver the full rule-based explanation.

---

## Phase 5: User Story 3 - Filter, sort and step through files by risk (Priority: P2)

**Goal**: Class filter, risk sort and Next/Previous following the chosen order, kept for the tab.

**Independent Test**: With all four classes present, sort by risk (Critical first), filter to Critical and Elevated, press Next repeatedly and confirm it follows the shown order and stops at the ends.

- [x] T036 [P] [US3] Write failing unit tests `test/unit/ui-file-order.test.ts` (VO-027): `arrangeFiles(files, classOf, { order, classes, text })` orders Critical, Elevated, Normal, Low with ties by path ascending case-insensitive; diff order is the default; class filter by effective class; the text filter must also be satisfied; Next/Previous follow the arranged list and report no neighbour at either end (no wrap).
- [x] T037 [P] [US3] Extend `test/unit/ui-view-state.test.ts` (VO-028): `fileOrder` and `riskClasses` are validated on read, restored in the same tab, invalid values fall back to defaults, and no server request carries them; `view-state.ts` still imports nothing from `api.ts`.
- [x] T038 [P] [US3] Write failing UI test `test/ui/overview.ui.ts` (file list cases, append): badge per row, "Why?" disclosure `file-risk-<path>`, class filter checkboxes (none checked = all), `file-order` select, "Showing n of m files", each filter has its own clear, an empty result keeps the existing empty state.
- [x] T039 [US3] Create `src/ui/state/file-order.ts` (`arrangeFiles`, the single ordering function shared by the list and the Files view) to pass T036.
- [x] T040 [US3] Add `fileOrder` and `riskClasses` to `SessionViewState` in `src/ui/state/view-state.ts` to pass T037.
- [x] T041 [P] [US3] Create `src/ui/components/risk-filter.tsx`: checkbox group, one box per class, own clear button, accessible names.
- [x] T042 [US3] Update `src/ui/components/file-list.tsx`: risk badge and "Why?" disclosure per row, `risk-filter`, the order control, count text, using `arrangeFiles` and the tab state. Passes T038.
- [x] T088 [P] [US3] Write failing UI cases in `test/ui/diff.ui.ts` for Next and Previous in the Files view: they follow the chosen order and class filter, work from the keyboard, show "No previous file" / "No further file" at the ends and never wrap (FR-030).
- [x] T043 [US3] Make `prev-file` / `next-file` in `src/ui/screens/diff.tsx` use `arrangeFiles` with the tab's order and filter; replace a missing neighbour with the text "No previous file" / "No further file" (FR-030). Passes T088.

**Checkpoint**: US3 works on rule classes alone.

---

## Phase 6: User Story 4 - AI can raise a class but never lower it (Priority: P2)

**Goal**: A separate AI lane assesses files after the rules and can only raise a class, with a resolvable cited line; failures degrade visibly.

**Independent Test**: With the fake provider returning a raise for a Normal file, a lowering for a Critical file and an uncited raise for another, only the first changes a class; the other two are reported ignored.

- [x] T044 [P] [US4] Write failing unit tests `test/unit/risk-assess.test.ts` (VO-018, VO-019): a lower class, an equal class and `low` for Critical and Normal files give no change and items recorded `not-higher`; a raise with no resolvable line, a line outside the changes, or an unknown file is `no-resolvable-line` / `unknown-file`; a raise with a resolvable cited line applies; the only code path that raises is one comparison (SC-004).
- [x] T045 [US4] Implement `src/core/risk/assess.ts` (pure): AI output plus rule classes to items, raise-only, resolving cited ranges against the patch line map (RR-5). Passes T044.
- [x] T046 [P] [US4] Add fake-provider risk scripts under `test/fixtures/` (fake-claude): a valid raise, a lowering, an uncited raise, unreadable output, provider unavailable.
- [x] T047 [P] [US4] Write failing integration test `test/integration/risk-service.test.ts` (AI cases): VO-016 (lockfile and generated file never in the prompt, show "Not assessed by AI: lockfile / generated file"), VO-017 (a Normal file raised to Elevated shows origin AI with rule class still visible; a comment-only file raised leaves the mechanical list), VO-020 (provider unavailable, unreadable output, restart mid-run: rule classes show and the report says the AI assessment is missing and why), VO-021 (run stores provider, context version, time; no platform write; no working-copy change), VO-038 (snapshot replaced mid-run: result stored on its own snapshot, `olderHead`, never applied to the new one).
- [x] T048 [P] [US4] Add `'risk'` to `AskOutput` in `src/contracts/ai-provider.ts` and `RISK_SCHEMA` (`{ files: [{ path, class: 'normal'|'elevated'|'critical', reasons, lines }] }`) in `src/adapters/claude-code-cli/schemas.ts`.
- [x] T049 [P] [US4] Add `'risk'` to `LaneName` in `src/core/lanes.ts` (one job at a time, in memory, cancelled as `superseded` for older snapshots; `cancelQueued` already iterates every lane).
- [x] T050 [P] [US4] Extend `test/unit/prompt.test.ts` with failing cases for `output: 'risk'`: fixed instructions, untrusted-data block with PR title and description and each assessable file's diff in diff order within the existing budget, per-file rule class and rule IDs as context, lockfile and generated files absent, excluded files named with their reason.
- [x] T051 [US4] Implement the `'risk'` output in `src/core/prompt.ts` to pass T050.
- [x] T052 [P] [US4] Extend `test/unit/risk-effective.test.ts` with failing AI cases: `assessedClass = max(rule, applied AI item)` from the latest completed run, `origin = 'ai'` on a raise, `mechanical` cleared by a raise (FR-018), `ai.state` values (`applied`, `not-higher`, `no-resolvable-line`, `unknown-file`, `no-opinion`, `not-assessed`, `pending`, `unavailable`), `ai.ignoredCount`, `olderHead`.
- [x] T053 [US4] Extend `src/core/risk/effective.ts` with the AI step to pass T052.
- [x] T054 [US4] Extend `src/core/risk-service.ts`: `onSnapshot` queues the risk lane run when the workspace is ready and the provider is available, writes the `risk_run` and items once it ends (completed, failed with reason, cancelled `superseded`), records provider, context version, excluded files and `restrictions_not_enforced`, publishes SSE `risk` with cause `ai`. Passes T047. Confirm `src/core/work-recovery.ts` needs no change (no unfinished risk run is stored).
- [x] T055 [US4] Pass `onSnapshot` risk queuing through `src/core/sessions.ts` and `src/main.ts`; with no workspace or a closed session no AI run is queued and the reason is stated.
- [x] T085 [P] [US4] Write failing UI cases in `test/ui/overview.ui.ts` and the AI cases of `test/end-to-end/risk.test.ts` for the AI notices (VO-034 announcement): in progress, missing with reason, opinion ignored with reason and count, provider and context version, "Not assessed by AI: …", older-head marking.
- [x] T056 [US4] Add the AI notices to `src/ui/components/review-focus.tsx` and `src/ui/components/risk-reasons.tsx`: "AI assessment in progress" with a polite announcement when it finishes, "AI assessment missing" with reason, "AI opinion ignored" with reason and count, provider and context version for a stored assessment, "Not assessed by AI: …" as a stated exclusion, older-head marking. Passes T085.

**Checkpoint**: Rule classes appear immediately; the AI run never delays them and can only raise.

---

## Phase 7: User Story 5 - Override a class with a recorded reason (Priority: P2)

**Goal**: Append-only overrides with a reason; lowering a Critical class also records the platform account read server-side through a new `currentUser()`; overrides carry across snapshots by change fingerprint.

**Independent Test**: Override a Normal file to Elevated with a reason; override a Critical file to Normal, which is refused without a reason and without a readable account; refresh with a change to the first file and the override lapses visibly.

- [x] T057 [P] [US5] Add a failing `currentUser` case to `test/contract/source-control.suite.ts` (shared by every adapter, on fixtures; one GET, no write; rejects with `AdapterError` `unauthorized` or `unavailable`) plus fixtures `test/fixtures/{gitlab,bitbucket}/user.json` and GitHub's as needed (VO-021, XI.2, XI.3).
- [x] T058 [US5] Add `CurrentUser = { handle: string; displayName: string }` and `currentUser()` to `src/contracts/source-control.ts` per `contracts/source-control-current-user.md`.
- [x] T059 [P] [US5] Before editing any of the three adapter files (T059 to T061), read their uncommitted working-tree diff and keep that work intact. Implement `currentUser()` in `src/adapters/github/source-control.ts` (`GET /user`: `login`, `name ?? login`) and refactor `verifySignIn` / `approvedByMe` to reuse it instead of their own `/user` GET.
- [x] T060 [P] [US5] Implement `currentUser()` in `src/adapters/gitlab/source-control.ts` (`GET /user`: `username`, `name`) with the same refactor.
- [x] T061 [P] [US5] Implement `currentUser()` in `src/adapters/bitbucket/source-control.ts` (`GET /user`: `account_id`, `display_name`) with the same refactor of `verifySignIn` / `approvedByMe`.
- [x] T062 [P] [US5] Extend `test/unit/risk-effective.test.ts` with failing override cases: the latest override whose `change_fingerprint` equals the snapshot's applies and becomes the effective class; a latest override whose fingerprint differs is `applies = false` (lapsed) with no fall back to an older record; a file removed in a later snapshot has no row and nothing applies; the original class, reasons and override reason stay in the `RiskFile`.
- [x] T063 [US5] Extend `src/core/risk/effective.ts` with the override step to pass T062.
- [x] T064 [P] [US5] Write failing integration tests in `test/integration/risk-service.test.ts` (override cases): VO-022 (POST with a `reviewer` field refused `unknown_field`, no record), VO-023 (a two-step lowering, Critical to Elevated and then Elevated to Low, needs and stores the name at both steps and is refused at either when the account is unreadable; lower Critical with the account readable stores handle and name; unreadable (401) or platform down is refused with reason and fix and no record; raising a class while signed out is allowed with no platform call), VO-024 (override twice gives two rows, latest applies, history readable; update and delete aborted; session deletion removes all), VO-025 (identical change under a new head and shifted lines still applies), VO-026 (differing change lapses with the recorded reason; removed file's overrides stay in history), a read-only or closed session and an older snapshot refuse overrides (409 `read_only`).
- [x] T065 [US5] Extend `src/core/risk-service.ts`: `createOverride` (validates `path` is a changed file of the latest snapshot, `class` one of four, `reason` trimmed 1 to 2,000 characters, `class` differs from the effective class; calls `currentUser()` through the registry only when the new class is below Critical and the file's calculated class is Critical; stores `calculated_class` on every record, and reviewer handle and name only then), `currentReviewer(sessionId)` (no cache, never throws for a platform error), `overrideHistory(sessionId, path)`; publishes SSE `risk` with cause `override`. Passes T064. Reviewer names are audit data only: no per-person query or total (FR-025).
- [x] T066 [P] [US5] Extend `test/end-to-end/risk.test.ts` with failing route cases: `201` with `OverrideRecord`; `400 unknown_field`, `400 invalid_request` naming `reason`; `409 read_only`; `404 not_found`; `409 signin_required` with "Sign in to the platform again"; `502 platform_error`; a `POST …/risk/overrides` with a foreign `Origin`, a wrong `Host` or a missing token is refused and writes no record (X.2, X.3, X.5, XI.3); `GET …/risk/reviewer` returns `ok: false` with `reason` and `fix` and never a 500; `GET …/risk/overrides?path=` requires `path`; no PUT, PATCH or DELETE route exists.
- [x] T067 [US5] Add the override `POST`, `GET …/risk/reviewer` and `GET …/risk/overrides?path=` handlers to `src/server/routes/risk.ts` (the POST is covered by the Origin check). Passes T066.
- [x] T068 [P] [US5] Write failing UI test `test/ui/diff.ui.ts` (override cases, VO-035): the Override class button opens the dialog, focus moves to the first field and returns to the button on close, Escape closes; a Critical lowering shows "Recorded as: <displayName> (<handle>)" read only; unreadable account shows reason and fix, disables Save and says other overrides remain possible; success announces "Class changed from X to Y"; a "History" disclosure lists records oldest first; a lapsed override shows "Override lapsed: this file's change differs. Recorded reason: …"; no override controls on an older snapshot or a closed session, with the reason shown; no count, total or ranking of overrides or reviewers.
- [x] T069 [P] [US5] Add `getReviewer`, `postOverride` and `getOverrideHistory` to `src/ui/api.ts`.
- [x] T070 [US5] Create `src/ui/components/override-dialog.tsx` per `contracts/ui.md` (Class select of the other three classes, required Reason textarea with 2,000 counter, reviewer preview only when lowering Critical, History disclosure, server message shown in the dialog on failure). Styles in `src/ui/app.css`.
- [x] T086 [P] [US5] Write a failing UI case in `test/ui/overview.ui.ts` for the "Overridden" note with the original class and the "overrides in effect" count in Review focus (FR-027; the diff-header override cases are already in T068).
- [x] T071 [US5] Wire the dialog, the override state, the lapsed note and the `canOverride` reason into the file header in `src/ui/screens/diff.tsx`, and the "Overridden" note with the original class and the "overrides in effect" count (FR-027) into `src/ui/components/review-focus.tsx`. Passes T068, T086.

**Checkpoint**: Overrides are recorded, accountable, append-only and visible.

---

## Phase 8: User Story 6 - Adjust the mandatory-scrutiny rules (Priority: P3)

**Goal**: An optional `risk-rules.json` can add to or tighten the built-in rules; a bad file leaves the built-ins in force with a visible notice.

**Independent Test**: Add a rule file marking a path pattern as financial, refresh, and matching files are classified under that rule; corrupt the file and the built-ins apply with a notice naming the file and reason.

- [x] T072 [P] [US6] Write failing unit tests `test/unit/risk-ruleset.test.ts` per `contracts/rule-file.md` (VO-013, VO-014): an `extend` entry adds `paths` and `lineTerms` and may only raise `class`; an `add` entry needs an ID of the form `X-<NAME>`, family and class; rejected with a named reason: an entry that lowers a built-in class, unknown field, unknown family, colliding ID, a pattern over 200 characters or more than 100 patterns per entry, a malformed glob; a missing file gives `absent`; non-JSON or non-object gives `ignored` with one item `entry: "(file)"`; a partly invalid file gives `partly-ignored` and built-ins still apply for the invalid part; the version is `builtin-<N>+<first 12 hex of sha256 of canonical JSON of accepted entries>`.
- [x] T073 [US6] Extend `src/core/risk/ruleset.ts` with the rule-file loader and validator for `<appDataDir>/risk-rules.json` (globs and terms only, no regular expressions from the file) to pass T072. The browser never names a path.
- [x] T074 [P] [US6] Write failing integration test `test/integration/risk-service.test.ts` (rule-file cases, VO-015): a valid `extend` and `add` classify matching files under that ID; changing the file between snapshots gives each snapshot its own `ruleset_version` and notice; a bad file never blocks classification.
- [x] T075 [US6] Make `src/core/risk-service.ts` read the rule file at every snapshot store and on refresh and store `risk_ruleset` with version, status and notice. Passes T074.
- [x] T087 [P] [US6] Write a failing case in `test/ui/overview.ui.ts` for the rule-file notice (names the file or entry and the reason).
- [x] T076 [US6] Show the rule-file notice in `src/ui/components/review-focus.tsx` (names the file or entry and the reason). Passes T087.

**Checkpoint**: All six stories are independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T077 [P] Write and satisfy `test/unit/risk-labels.test.ts` (VO-030): scan `src/ui/labels.ts` and the rendered text of the risk components for the word "approved" and for approval icons or styling; none exist. Mechanical files read exactly "Mechanical (candidate for reduced review)".
- [x] T078 [P] Write and satisfy `test/unit/risk-boundaries.test.ts` (VO-031, VO-032): the `RiskReport` type, store tables and UI contain no score, percentage or rank; the store interface and HTTP contract have no by-reviewer or cross-file override query; override history requires a path.
- [x] T079 [P] Extend `test/ui/sweep.ui.ts` (VO-029, SC-008): axe at wide, medium and narrow widths in light and dark themes over Review focus, file badges, filters, diff risk marks and the override dialog; a forced-colors and greyscale render asserts the text, glyph and `aria-label` are present.
- [x] T080 [P] Extend `test/end-to-end/risk.test.ts` for the full reference journey (VO-033, VO-034, VO-035): Overview to first Critical file's responsible lines in no more than two actions (SC-010); refresh creates a new snapshot, recalculates every class and keeps the older snapshot's classes; markup in a path, reason and rule label is rendered as text; a read-only session shows stored classes and overrides, runs no new AI assessment and shows the reason; deleting the session removes its risk records and overrides.
- [x] T081 Run `npm run typecheck`, `npm test` (including `test/unit/platform-names.test.ts` and `test/unit/read-only-http.test.ts`, which must stay green), then `npm run build:ui` and `npm run test:ui`; fix regressions. Run `npm run test:gitlab` when the local GitLab is available.
- [x] T082 Walk through every scenario in `specs/004-risk-review-focus/quickstart.md` and every item in `specs/004-risk-review-focus/tests/behaviour-checklist.md`; record any gap as a new task.
- [ ] T083 Carry out the manual checks MV-001 (light, dark and forced colours or greyscale on a real display) and MV-002 (screen reader through Review focus, risk marks and an AI class change) from `plan.md` and record the result in `specs/004-risk-review-focus/tests/behaviour-checklist.md`.
- [x] T084 [P] Update `README.md` with a short Review focus section: the four classes, that there is no score, and where `risk-rules.json` lives (`contracts/rule-file.md`).

---

## Dependencies & Execution Order

- **Phase 1** has no dependencies; T001 to T004 each touch a different file, so T002, T003 and T004 can run alongside T001.
- **Phase 2** needs Phase 1 (T012 is written first and must fail before T002 adds the schema; T013 needs T002; T014/T015 are independent of T005 to T011). Blocks every story.
- **US1 (P1)** needs Phase 2. It is the MVP and creates `classify.ts`, `effective.ts`, `risk-service.ts`, the route and `review-focus.tsx`, which later stories extend.
- **US2 (P1)** needs US1 (report, `useRisk`, badge). It does not need US3 to US6.
- **US3 (P2)** needs US1 (`useRisk`, badge) and can run in parallel with US2 once US1 is done, except T043 and T035 both edit `src/ui/screens/diff.tsx`: do T035 first.
- **US4 (P2)** needs US1 and extends `effective.ts` and `risk-service.ts`. Independent of US2, US3.
- **US5 (P2)** needs US1. The `currentUser` tasks T057 to T061 are independent of everything else and can start as early as Phase 2. T063, T065 and T071 follow US4's edits to the same files (`effective.ts`, `risk-service.ts`, `review-focus.tsx`) if US4 is in flight.
- **US6 (P3)** needs US1 (`ruleset.ts`, `risk-service.ts`); independent of US2 to US5 apart from the shared files.
- **Polish** needs the stories it covers.

Within each story: failing test, then implementation, then UI wiring; a task is not done until its test passes and `npm run typecheck` is clean.

## Parallel Opportunities

- Phase 2: T005/T007/T009/T011 (tests) and then T006/T008/T010 run in parallel (separate files); the store track (T012, T013) and the hook track (T014, T015) run alongside.
- US1: T016 to T020 (all tests) in parallel; T021 with T028 and T029 once the contracts exist.
- US2: T032, T033, T034 in parallel, then T035.
- US3: T036, T037, T038 in parallel; T041 alongside T039/T040.
- US4: T044, T046, T047, T048, T049, T050 and T052 touch different files and can start together.
- US5: T057 then T059, T060, T061 in parallel; T062, T064, T066 and T068 (tests) in parallel.
- Polish: T077, T078, T079, T080 and T084 in parallel.
- Different developers: after US1, one person can take US2 + US3 (UI), one US4 (AI), one US5 (identity and overrides), one US6.

### Parallel example: User Story 1 tests

```text
T016 test/unit/risk-classify.test.ts
T017 test/unit/risk-effective.test.ts
T018 test/integration/risk-service.test.ts
T019 test/end-to-end/risk.test.ts
T020 test/ui/overview.ui.ts
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 and Phase 2.
2. Phase 3 (US1): rule classification stored, served and shown in Review focus.
3. **Stop and validate** against the reference PR and quickstart. This already answers "is there anything here I must not skim?".

### Incremental delivery

1. US2 adds the explanation in the diff (the other P1): ship with the MVP if possible, since a class without a cause cannot be judged (IV.1).
2. US3 gives the working order; US4 the AI raise; US5 accountable overrides; US6 the rule file. Each is testable on its own and does not remove an earlier one.
3. Polish last; T081 is the gate before the feature is called implemented.

## Notes

- No task writes to any platform or to the reviewer's working copy (FR-039, II.1).
- No new runtime dependency (Q.1). Glob, comment table and fingerprint are string code and `node:crypto`.
- This repo does not allow Claude to commit; leave changes in the working tree.
- The `speckit-tasks` run leaves `currentStep` on `tasks`; implement is a separate step.
