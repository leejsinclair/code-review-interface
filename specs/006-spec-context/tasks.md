# Tasks: Specification Context and TDD Alignment

**Spec**: `spec.md` | **Plan**: `plan.md` | **Size**: normal

Tests come first in every phase and must fail before the code that satisfies them (constitution XI). The lookup, the store, the alignment lane, the routes and the whole panel are shared by all four stories, so they are built in Foundational. Each story then owns its screen wiring and its own browser and end-to-end tests, and proves its journey on top of Foundational.

## Phase 1: Setup

Files: `test/helpers/spec-sandbox.ts`, `test/fixtures/fake-claude/fake-claude.mjs`, `test/helpers/fake-ai-cli.ts`

**Wave 1 — independent (different files):**
- [x] **T001** [P] Git sandbox helper: a project repository with `specs/<NNN>-<KEY>-<slug>/` folders on `develop` and on matching branches, a nested clone of the pull request repository inside it, folders for `ENG-12` and `ENG-1213`, and a way to move a document's commit · test/helpers/spec-sandbox.ts
- [x] **T002** [P] Fake AI alignment scenarios: full output (five criteria, one uncovered, one mismatched test, both deviations), no evidence, no deviations, wrong citations, unparseable output, provider failure · test/fixtures/fake-claude/fake-claude.mjs, test/helpers/fake-ai-cli.ts

## Phase 2: Foundational (blocks every story)

Files: `src/contracts/{http,ai-provider}.ts`, `src/adapters/claude-code-cli/schemas.ts`, `src/store/{schema.sql,review-store.ts}`, `src/repo/{git,manager}.ts`, `src/core/{spec-match,spec-alignment,spec-context,workspace,prompt,lanes,sessions}.ts`, `src/server/routes/spec-context.ts`, `src/server/routes.ts`, `src/server/routes/context.ts`, `src/main.ts`, `src/ui/{api,labels}.ts`, `src/ui/app.css`, `src/ui/state/use-spec-context.ts`, `src/ui/components/spec-context.tsx`, and their unit and integration tests.

**Wave 1 — failing tests (independent, different files):**
- [x] **T003** [P] Test key matching: whole key only (`ENG-12` does not match `ENG-1213`), case-insensitive, folder choice per document (own repository, matching branch over `develop`, most recent commit), file names ending in `spec.md` and `tdd-evidence.md`, several `spec.md` files · test/unit/spec-match.test.ts
- [x] **T004** [P] Test alignment output checks: citations resolved against stored text and changed lines, unresolved ones downgraded to `unverified` and never dropped, `verified` and extra fields refused, unparseable output becomes one Inference with a warning, `no-evidence-available` forced when evidence is missing, `tests_mismatch` only with a test shown · test/unit/spec-alignment.test.ts
- [x] **T005** [P] Test the allowlist holds `listRemoteHeads`, `listTreePaths`, `lastCommitTouching`, none with a forbidden verb, and that a bad commit or a `..` path is refused before running · test/unit/git-commands.test.ts
- [x] **T006** [P] Test in a sandbox that a full lookup fetches only into `refs/prwb/<session>/<snapshot>/spec-<n>`, reads files at their last-touching commit, and leaves the checked-out branch, index, stash and working files unchanged; refs are removed with the session · test/integration/spec-lookup-git.test.ts
- [x] **T007** [P] Test the six tables: append-only, session-delete guard, the CHECK rules in `data-model.md`, and that a run's document references must be found rows of its own lookup · test/integration/review-store.test.ts
- [x] **T008** [P] Test the prompt for the `alignment` kind (documents in the data block, prompt-limit cuts recorded as `left_out`) and the `alignment` lane running apart from `summary` · test/unit/prompt.test.ts
- [x] **T009** [P] Test `enclosingOf`: nearest proper ancestor among discovered clones, none for a clone not inside another, no platform or naming rule · test/integration/workspace-lifecycle.test.ts
- [x] **T010** [P] Test the service: own repository searched first then enclosing, lookup does not block the snapshot, same-head refresh stores nothing when unchanged and a new lookup and run when a commit moved or a matching branch appeared, git failure becomes a gap, AI failure keeps documents and can retry, a restart leaves no run and shows the notice, a newer snapshot cancels the run as superseded · test/integration/spec-context-service.test.ts
- [x] **T011** [P] Test the routes: guard and Origin checks, `404` for unknown session, snapshot or foreign document, `text/plain` with `nosniff` for document text, retry `409 read_only` and `409 conflict`, `400 unknown_field`, `202` with `runId`, SSE `spec-context`, `GET` never writes · test/integration/spec-context-routes.test.ts

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — contracts, schema, pure rules (independent, different files):**
- [x] **T012** [P] Wire types `SpecContextReport` and related, and the two new `CompletenessRow` sources · src/contracts/http.ts
- [x] **T013** [P] Alignment output schema and its CLI schema · src/contracts/ai-provider.ts, src/adapters/claude-code-cli/schemas.ts
- [x] **T014** [P] Six append-only tables with their triggers and checks · src/store/schema.sql
- [x] **T015** [P] Add the three allowlisted commands with path and commit validation · src/repo/git.ts
- [x] **T016** [P] Pure key, folder and file matching and the precedence rule · src/core/spec-match.ts
- [x] **T017** [P] Pure validation and citation checking with downgrade · src/core/spec-alignment.ts
- [x] **T018** [P] `enclosingOf(repositoryId)` from discovered folder paths · src/core/workspace.ts
- [x] **T019** [P] The `alignment` output kind with its rules, and the `alignment` lane · src/core/prompt.ts, src/core/lanes.ts

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — store and repository manager (independent, different files):**
- [x] **T020** [P] `listRemoteBranches`, `fetchSpecRef`, `listSpecFiles`, `readSpecFile` on the manager, with the size check · src/repo/manager.ts
- [x] **T021** [P] Store methods for lookups, sources, documents, runs, rows and items, with the same-lookup check on insert · src/store/review-store.ts

**⟶ Wait for Wave 3 to finish, then:**

**Wave 4 — the service (single task):**
- [x] **T022** Service: keys via `extractReferences`, search own then enclosing, choose per document, store text with source and commit, queue one alignment job when a specification exists, derive stale, ambiguity and counts on read, retry, restart recovery · src/core/spec-context.ts

**⟶ Wait for Wave 4 to finish, then:**

**Wave 5 — integration points (independent, different files):**
- [x] **T023** [P] `onRefreshed` hook for a same-head refresh · src/core/sessions.ts
- [x] **T024** [P] Report, document text and retry routes, mounted and published on SSE, and the completeness context · src/server/routes/spec-context.ts, src/server/routes.ts, src/server/routes/context.ts
- [x] **T025** [P] Wire the service, the lane and the routes · src/main.ts
- [x] **T026** [P] Client calls for the three routes and the verbatim labels from `contracts/ui.md` · src/ui/api.ts, src/ui/labels.ts
- [x] **T027** [P] Styles for the panel, rows, verdict, lists and viewer · src/ui/app.css

**⟶ Wait for Wave 5 to finish, then:**

**Wave 6 — view state (single task):**
- [x] **T028** Hook that reads the report, re-reads on SSE `spec-context` for its snapshot, and holds viewer state · src/ui/state/use-spec-context.ts

**⟶ Wait for Wave 6 to finish, then:**

**Wave 7 — the panel (single task):**
- [x] **T029** Specification panel: summaries, source with rule and other copies, per-key groups, criteria table, verdict and its two lists, deviations with a "none found" line, gaps and where it looked, stale reasons, citations that open the stored text or changed lines, read-only document viewer, `Retry assessment`; text only, `Inferred` on every statement · src/ui/components/spec-context.tsx

**Checkpoint**: the lookup, the store, the lane, the routes and the panel work end to end; no screen shows them yet.

## Phase 3: User Story 1 — See the specification and the test evidence (P1, MVP)

**Goal**: The overview shows both summaries, the source and the full text, and no "Changed files".
**Independent test**: Open a pull request whose key matches a folder on the enclosing project's `develop`.

Files: `src/ui/screens/overview.tsx`, `test/ui/spec-context.ui.ts`, `test/end-to-end/spec-context.test.ts`

### Tests

**Wave 1 — failing tests (independent, different files):**
- [x] **T030** [P] [US1] Browser test: panel with two summaries and the source, no "Changed files", `Read in full` shows the text read-only · test/ui/spec-context.ui.ts
- [x] **T031** [P] [US1] End-to-end: folder on `develop` found in the enclosing repository, folder only on a matching branch, matching branch beats `develop` and the panel names the `develop` copy, several keys grouped, case-insensitive key, `ENG-12` does not match `ENG-1213`, the reviewer's working copy unchanged · test/end-to-end/spec-context.test.ts

**⟶ Wait for Wave 1 to finish, then:**

### Implementation

- [x] **T032** [US1] Replace "Changed files" with the Specification panel and remove the overview's snapshot fetch · src/ui/screens/overview.tsx

**Checkpoint**: A reviewer sees the intent and the testing proof on the overview. US1 is independently demoable.

## Phase 4: User Story 2 — Judge whether there was enough testing, of the right things (P1)

**Goal**: One row per criterion, a test column, and a sufficiency verdict that names gaps and mismatches.
**Independent test**: Five criteria, evidence for four, one mismatched test: five rows, the uncovered one flagged, the mismatch flagged, verdict incomplete.

Files: `test/ui/spec-alignment.ui.ts`, `test/end-to-end/spec-alignment.test.ts`

**Wave 1 — failing tests (independent, different files):**
- [x] **T033** [P] [US2] Browser test: row states, `Test shown` and `No test shown`, flagged mismatch, verdict lists, `Inferred` on every statement and the word `Verified` nowhere, a citation opens the cited passage or lines, an unresolved citation reads `Source not found in the stored text` · test/ui/spec-alignment.ui.ts
- [x] **T034** [P] [US2] End-to-end: alignment starts on its own after the documents are found, one row per criterion in specification order, verdict `incomplete`, a criterion the AI skipped shows "AI gave no opinion", a new snapshot supersedes the run and earlier runs are kept, no coverage figure anywhere · test/end-to-end/spec-alignment.test.ts

**Checkpoint**: Both tests pass on the Foundational panel. A defect they expose is fixed in the Foundational file that owns it, not here.

## Phase 5: User Story 4 — See clearly when documents are missing, stale or ambiguous (P1)

**Goal**: Every gap is explicit with a reason; nothing missing reads as a pass.
**Independent test**: A key with no folder, then a folder with no evidence: each shows a gap and no assessment for what is missing.

Files: `src/core/completeness.ts`, `test/unit/completeness.test.ts`, `test/ui/spec-gaps.ui.ts`, `test/end-to-end/spec-gaps.test.ts`

### Tests

**Wave 1 — failing tests (independent, different files):**
- [x] **T035** [P] [US4] Test the `specification` and `tdd-evidence` completeness rows: found, missing and stale with reasons, several keys name the key that is missing · test/unit/completeness.test.ts
- [x] **T036** [P] [US4] End-to-end: no folder, specification without evidence (rows listed, `No evidence available`), no key, repository not inside a project (own repository only), moved document commit marks stale and starts a new run, several folders with the rule used, git read failure while the rest of the overview loads, AI failure shows a notice and retry works, overview timing unchanged with no specification · test/end-to-end/spec-gaps.test.ts
- [x] **T037** [P] [US4] Browser test: each gap message and where it looked, `Stale` with its reason, completeness rows in the list, `Retry assessment` disabled while a run is queued · test/ui/spec-gaps.ui.ts

**⟶ Wait for Wave 1 to finish, then:**

### Implementation

- [x] **T038** [US4] Add the `specification` and `tdd-evidence` rows, derived from the latest lookup · src/core/completeness.ts

**Checkpoint**: A missing, stale or ambiguous document is never read as a pass. US4 is independently testable.

## Phase 6: User Story 3 — See whether the code reflects the specification (P2)

**Goal**: Two lists of scope deviations, each with a citation, or a line saying none were found.
**Independent test**: An unrequested endpoint and an omitted criterion each appear in the right list.

Files: `test/ui/spec-deviations.ui.ts`, `test/end-to-end/spec-deviations.test.ts`

**Wave 1 — failing tests (independent, different files):**
- [x] **T039** [P] [US3] Browser test: `Implemented but not requested` cites changed lines, `Requested but not implemented` cites a specification passage, "none were found" text when both are empty · test/ui/spec-deviations.ui.ts
- [x] **T040** [P] [US3] End-to-end: both deviation kinds stored with citations, an empty list stores no row, an uncited unrequested change is kept as `unverified` · test/end-to-end/spec-deviations.test.ts

**Checkpoint**: The panel answers "does the code reflect the spec". US3 is independently testable.

## Phase 7: Polish

Files: `README.md`

**Wave 1 — single task:**
- [x] **T041** Document the Specification panel, how the enclosing project repository is found, and the new git commands · README.md

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T042** Validate against Success Criteria SC-001 to SC-007: run `npm run typecheck`, `npm test`, `npm run test:ui` and `npm run build:ui`; confirm the changed-files section is gone and SC-006 holds · package.json

## Dependencies & Execution Order

Setup → Foundational → stories → Polish. Foundational blocks every story. After it, US1, US2, US4 and US3 touch disjoint files and can run in any order or in parallel; US1 is the MVP.

- Setup: one wave, T001 and T002 in parallel.
- Foundational: Wave 1 tests, then Wave 2 contracts and pure rules, then Wave 3 store and manager, then T022 service, then Wave 5 integration points, then T028 hook, then T029 panel.
- Each story: its failing tests (one wave), then its one implementation task where it has one. US2 and US3 have tests only, because the Foundational panel already carries their behaviour.
- Polish: T041 then T042.

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 keys from the pull request | T003, T022 |
| FR-002 own then enclosing repository | T009, T010, T018, T022 |
| FR-003 develop and matching branches, whole key | T003, T016, T020 |
| FR-004 matching branch beats develop | T003, T031, T016 |
| FR-005 each document from its best place, with source | T003, T021, T022, T031 |
| FR-006 working copy never changed | T006, T015, T020 |
| FR-007 panel replaces Changed files | T030, T032 |
| FR-008 summaries, source, full text | T029, T030, T011 |
| FR-009 completeness rows | T035, T038 |
| FR-010 gaps never assumed | T036, T037, T029 |
| FR-011 criteria rows | T033, T034, T017 |
| FR-012 sufficiency verdict | T033, T034 |
| FR-013 scope deviations | T039, T040 |
| FR-014 Inferred and citation check | T004, T017, T033 |
| FR-015 no run without a specification, no figures | T010, T034, T036 |
| FR-016 automatic, tied to head, stale, append-only | T007, T010, T023, T036 |
| FR-017 separate record kinds | T007, T014, T021 |
| FR-018 failures degrade, overview still loads | T010, T036 |
