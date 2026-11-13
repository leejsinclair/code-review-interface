# Tasks: Review Actions

**Spec**: `review-actions.spec.md` | **Plan**: `plan.md` | **Size**: oversized

**Scale note**: About 40 tasks across contracts, three platform adapters, the store and server, shared UI components and two screens. Watch two things. First, the write path (head check, request id, allowlist, lock, read-back) is built and tested in Foundational, before any screen can post. Second, each file has one owner phase, so `diff.tsx` belongs to US1 and `overview.tsx` to US2. The shared UI components (comment box, thread with reply/edit/delete, decision panel, action notice) are therefore built in Foundational, and US3 and US4 are mostly verification of behaviour those components already carry.

Tests come first in every phase and must fail before the code that satisfies them (constitution XI).

## Phase 1: Setup

Files: `test/helpers/logged-write-fetch.ts`

- [x] **T001** Write-aware sibling of `logged-fetch.ts`: records every method and URL and exposes `assertOnlyAllowedWrites(allowlist)` · test/helpers/logged-write-fetch.ts

## Phase 2: Foundational (blocks every story)

Files: `src/contracts/{shared,source-control,source-control-writer,http}.ts`, `src/adapters/{write-http,registry}.ts`, `src/adapters/{github,gitlab,bitbucket}/source-control.ts`, `src/adapters/{github,gitlab,bitbucket}/source-control-writer.ts`, `src/credentials.ts`, `src/store/{schema.sql,review-store.ts}`, `src/core/review-actions.ts`, `test/fixtures/gitlab/review-actions/`, `src/server/routes/review-actions.ts`, `src/server/routes.ts`, `src/main.ts`, `src/server/reviewer.ts`, `src/server/routes/context.ts`, `src/ui/{api.ts,labels.ts,app.css}`, `src/ui/state/use-review-decision.ts`, `src/ui/components/{action-notice,comment-box,comment-thread,decision-panel}.tsx`, and their tests and fixtures.

**Wave 1 — contracts and schema (independent, different files):**
- [x] **T002** [P] Add error codes `forbidden`, `conflict`, `rejected`, `rate_limited` to `AdapterErrorCode` and `ADAPTER_ERROR_CODES`, carrying the platform message · src/contracts/shared.ts
- [x] **T003** [P] `SourceControlWriter` interface: post comment (pull request, line or range, reply), edit, delete, approve, request changes, withdraw; neutral `Anchor` and `WriteOutcome` · src/contracts/source-control-writer.ts
- [x] **T004** [P] Add `listComments`, `myDecision` and `reviewCapability` to `SourceControlProvider`, keep the "no method writes" header true · src/contracts/source-control.ts
- [x] **T005** [P] Review-action HTTP types: `ReviewAction`, post request with `expectedHead` and `requestId`, comment, decision, `canReview` · src/contracts/http.ts
- [x] **T006** [P] Table `write_record` (insert and read only, cascade on session delete, one pending row per PR) · src/store/schema.sql

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — failing tests and fixtures (independent, different files):**
- [x] **T007** [P] Test: write layer refuses a method or endpoint not on the allowlist, refuses redirects, and read adapters cannot write (X.11) · test/unit/write-http.test.ts
- [x] **T008** [P] Writer contract suite over recorded fixtures: comment, line and range anchor, reply, edit, delete, approve with commit, request changes (and the GitLab version-probed gap), withdraw, error mapping, own-comment id · test/contract/source-control-writer.suite.ts
- [x] **T009** [P] Run the suite for GitHub, GitLab and Bitbucket on recorded fixtures · test/contract/source-control-writer.contract.test.ts
- [x] **T010** [P] Recorded fixtures for comment, review and decision endpoints on GitHub, GitLab and Bitbucket · test/fixtures/github/review-actions/, test/fixtures/gitlab/review-actions/, test/fixtures/bitbucket/review-actions/
- [x] **T041** [P] Test: write scope is requested only on the first write action, a missing scope maps to `forbidden`, and no token reaches any X.7 location · test/unit/credentials.test.ts
- [x] **T011** [P] Test: `write_record` has no update or delete, one pending intent per PR, one terminal row per intent, abandoned pending row is closed · test/integration/review-store.test.ts
- [x] **T012** [P] Test core: head moved returns conflict and posts nothing, repeated `requestId` posts once, concurrent clicks post once, ambiguous failure reads back before retry, empty text refused, request changes needs a message, PR not open and not-author disable with reason, anchor refused when the path is not a changed file or the range is outside that file's diff on that side · test/unit/review-actions.test.ts
- [x] **T013** [P] Test routes: wrong Origin refused (X.5), unknown fields refused, error body carries the platform reason, and the AI provider and risk and claims paths receive no writer (FR-006) · test/integration/review-actions-routes.test.ts

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — adapters, store, write layer (independent, different files):**
- [x] **T014** [P] Write-only fetch with method plus endpoint allowlist, status to neutral code mapping, `redirect: 'manual'`, no shared client with the read layer · src/adapters/write-http.ts
- [x] **T015** [P] Store functions: insert and read `write_record`; no update or delete · src/store/review-store.ts
- [x] **T016** [P] GitHub: `listComments`, `myDecision` reads, and the writer with `commit_id`, `side` and `line` anchors · src/adapters/github/source-control.ts, src/adapters/github/source-control-writer.ts
- [x] **T017** [P] GitLab: reads and writer with the `position` object and version-probed request-changes capability · src/adapters/gitlab/source-control.ts, src/adapters/gitlab/source-control-writer.ts
- [x] **T018** [P] Bitbucket: reads and writer with `inline` anchors and full head SHA through `getPullRequest` · src/adapters/bitbucket/source-control.ts, src/adapters/bitbucket/source-control-writer.ts
- [x] **T019** [P] Ask for write scope only on first write action, and map a missing scope to `forbidden` with a sign-in prompt · src/credentials.ts

**⟶ Wait for Wave 3 to finish, then:**

**Wave 4 — wiring (independent, different files):**
- [x] **T020** [P] Writer registry map and `writerDeps()`, separate from the read map · src/adapters/registry.ts
- [x] **T021** [P] Core: post, `expectedHead` check, anchor validation (changed file, range inside the diff on `side`), `requestId` replay, per-PR lock, read-back, eligibility, `postedByTool` match · src/core/review-actions.ts

**⟶ Wait for Wave 4 to finish, then:**

**Wave 5 — server (independent, different files):**
- [x] **T022** [P] Routes post, comments, decision · src/server/routes/review-actions.ts
- [x] **T023** [P] Build writer deps at the three call sites · src/main.ts, src/server/reviewer.ts, src/server/routes/context.ts

**⟶ Wait for Wave 5 to finish, then:**

**Wave 6 — register and independent UI (independent, different files):**
- [x] **T024** [P] Register the review-actions routes · src/server/routes.ts
- [x] **T025** [P] API client functions and labels (Approve, Request changes, General comment; no "Reject") · src/ui/api.ts, src/ui/labels.ts
- [x] **T026** [P] Action notice: error with platform reason in `role="alert"` and the out-of-date notice, announced to screen readers · src/ui/components/action-notice.tsx
- [x] **T031** [P] Styles for the dialog, comment box, thread and panel in all three bands · src/ui/app.css

**⟶ Wait for Wave 6 to finish, then:**

**Wave 7 — comment box and shared state (independent, different files):**
- [x] **T027** [P] Comment box: Post comment button posts at once with a fresh `requestId`, disabled for empty text and while busy, text kept on error, cancel closes · src/ui/components/comment-box.tsx
- [x] **T030** [P] Shared decision state so the overview and file view agree · src/ui/state/use-review-decision.ts

**⟶ Wait for Wave 7 to finish, then:**

**Wave 8 — thread and decision panel (independent, different files):**
- [x] **T028** [P] Thread: shows author, time, body as text, outdated marker; reply always, edit and delete only when editable · src/ui/components/comment-thread.tsx
- [x] **T029** [P] Decision panel: one-click approve, request changes (disabled until a message is typed), general comment, withdraw, own-decision label with time and commit, disabled reason; separate from readiness · src/ui/components/decision-panel.tsx

**Checkpoint**: a post works over HTTP on recorded fixtures, including the refused-when-head-moved case, with no screen yet.

## Phase 3: User Story 1 — Comment on a changed line (P1, MVP)

Files: `src/ui/screens/diff.tsx`, `test/ui/line-comment.ui.ts`

### Tests
- [x] **T032** [US1] Browser test: select a line and a range, comment, Post comment posts at once, cancel posts nothing, the comment shows beside the line, refusal shows the reason and keeps the text, double click posts once, out-of-date head posts nothing, keyboard only · test/ui/line-comment.ui.ts

### Implementation

**Wave 1:**
- [x] **T033** [US1] Comment action on the selected line or range, comment box, thread beside the line, base and head sides, skipped or binary diffs offer no comment, decision panel mounted in the file view for US3, reasons when disabled, sends the snapshot head as `expectedHead` · src/ui/screens/diff.tsx

**Checkpoint**: a line comment can be posted and seen from the file view.

## Phase 4: User Story 2 — Decide and comment from the overview (P1)

Files: `src/ui/screens/overview.tsx`, `test/ui/overview-decision.ui.ts`

### Tests
- [x] **T034** [US2] Browser test: approve with and without a message, request changes blocked without a message, own decision shown with commit and time and never as readiness, withdraw in one click, general comment posts to the pull request, merged or closed pull request disables actions, and approve, request changes, general comment and withdraw complete by keyboard only with the result announced · test/ui/overview-decision.ui.ts

### Implementation

**Wave 1:**
- [x] **T035** [US2] Decision panel, general comment box and the pull request comment list, kept out of `ReviewFocus` and readiness · src/ui/screens/overview.tsx

**Checkpoint**: a review can be finished from the overview.

## Phase 5: User Story 3 — Decide from the file view (P2)

Files: `test/ui/file-decision.ui.ts`

### Tests
- [x] **T036** [US3] Browser test: approve from the file view posts at once like the overview, then the overview shows the same decision, and the other way round, with the same keyboard-only path · test/ui/file-decision.ui.ts

**Checkpoint**: both views show one decision. The behaviour comes from T029, T030 and T033.

## Phase 6: User Story 4 — Reply, edit, delete own comments (P3)

Files: `test/ui/comment-manage.ui.ts`

### Tests
- [x] **T037** [US4] Browser test: reply appears in the thread, edit and delete offered only on a comment this tool posted, none on others' comments, delete removes it on the platform and in the tool, and reply, edit and delete complete by keyboard only · test/ui/comment-manage.ui.ts

**Checkpoint**: comments can be managed. The behaviour comes from T021 and T028.

## Phase 7: Polish

Files: `README.md`, `MVP/MVP.md`, `docs/domain_knowledge/adr/0003-reviewer-actions-and-workbench-scope.md`, `docs/`

**Wave 1 — independent, different files:**
- [x] **T038** [P] Update the "product never writes" statements to the reviewer-actions scope (one-click, no confirmation) · README.md, MVP/MVP.md
- [x] **T039** [P] Mark ADR 0003 accepted once reviewed (already amended for constitution 3.0.0), and document the write scope each platform needs (verify the proposed scopes in `contracts/writer.md` against fixtures) · docs/domain_knowledge/adr/0003-reviewer-actions-and-workbench-scope.md
- [ ] **T040** Run the test and lint suites and check every Success Criterion SC-001 to SC-007 · (no file)

## Dependencies & Execution Order

Setup → Foundational → US1 and US2 (independent of each other, different files) → US3 and US4 (verification, after US1 and US2) → Polish.

Foundational waves: Wave 1 contracts and schema, then Wave 2 failing tests, then Wave 3 adapters, store and write layer, then Wave 4 registry and core, then Wave 5 server, then Wave 6 registration, API client, notice and styles, then Wave 7 comment box and shared state, then Wave 8 thread and decision panel. Each wave waits for the one before.

## Requirement coverage

FR-001 T033 · FR-002 T029 T035 · FR-003 T029 T035 · FR-004 T029 T035 · FR-005 T033 T036 · FR-006 T021 T022 · FR-007 T021 T025 · FR-008 T016 T017 T018 T029 · FR-009 T029 T034 · FR-010 T028 T037 · FR-011 T021 T028 · FR-012 T003 T014 · FR-013 T029 T035 · FR-014 T033 T035 · FR-015 T006 T015 · FR-016 T021 T026 · FR-017 removed · FR-018 T021 T029 · FR-019 T026 T032 · FR-020 T008 T016 T017 T018
