# Tasks: Review Actions Platform Parity

**Spec**: `review-actions-parity.spec.md` | **Plan**: `plan.md` | **Design**: `data-model.md`, `contracts/`, `research.md`

**Scale note**: About 45 files in six areas: neutral contracts, three platform adapters with their fixtures, core review actions and spec context, the server's request scope, the UI, and the test suites. Watch the two safety rules first (author guard, comment ownership). The read layer stays read-only when the memo arrives (VIII.3), and no automated test writes to a hosted platform (XI.5).

**How the phases split**: US1 to US6 all change the same two files per platform, so those stories are delivered **per platform** (Phases 3 to 5), not per story. Each task still carries its story tag. Foundational writes every failing contract scenario and its per-platform expectation data once, so the three platform phases touch only their own adapter files and fixtures and can run in parallel. US8 (clone hosts) has no phase of its own: its config lives in Foundational and its adapter changes in Phases 4 and 5.

**Typecheck is red between phases.** Foundational changes contract types and removes a gap kind and a label, so adapters and spec context fail the type check until their phase lands. It must be green at Polish (FR-027).

Tests are written first and must fail before their implementation (constitution XI.1). Each task carries the Verification Plan obligations it serves (`[VO-nnn]`): the first task to name an obligation is its test task, later ones its behaviour tasks. `[NT: reason]` marks a task with no test of its own.

## Phase 1: Setup

- [x] T001 [NT: baseline run] Record the baseline: run `npm run typecheck` and `npm test`, and note the type errors and the six failing tests, to check against at T072 · (no file)
- [ ] T002 [US7] [NT: person task outside the repository] Person task: set up the dedicated test workspace and second account on Bitbucket Cloud and GitHub, each with a hand-made pull request authored by the second account. Keep names and tokens in an untracked env file. Blocks Phase 10 recording only · (outside the repository)

## Phase 2: Foundational

Files: `src/contracts/source-control.ts`, `src/contracts/source-control-writer.ts`, `src/contracts/http.ts`, `src/config.ts`, `src/ui/labels.ts`, `src/core/review-actions.ts`, `src/adapters/request-memo.ts`, `src/adapters/approved-by-me.ts`, `src/adapters/registry.ts`, `src/server/routes/context.ts`, `src/adapters/read-only-http.ts`, `src/adapters/write-http.ts`, `src/server/http.ts`

Tests: `test/unit/review-actions.test.ts`, `test/integration/review-actions-routes.test.ts`, `test/contract/source-control.suite.ts`, `test/contract/source-control.contract.test.ts`, `test/contract/source-control-writer.suite.ts`, `test/contract/source-control-writer.contract.test.ts`, `test/unit/request-memo.test.ts`, `test/unit/read-only-http.test.ts`, `test/unit/write-http.test.ts`, `test/unit/approved-by-me.test.ts`, `test/unit/config.test.ts`

No platform phase starts until this phase is done.

**Wave 1 — contract types and labels (different files):**

- [x] T003 [P] [US1] [NT: contract type and doc declarations] Add `PullRequestInfo.authorHandle` (`''` when the platform reports none). Document that `headCommit` may be abbreviated on list rows and is compared by prefix (FR-019), and the partial and `unavailable` rules of `approvedByMe` (FR-013). Every comment platform-neutral (FR-018) · src/contracts/source-control.ts
- [x] T004 [P] [US2] [NT: contract type and doc declarations] `Comment.author` becomes `{ id, name, handle }`; add `Comment.startsThread`; add `message?` to the `decision` outcome; document withdraw-with-nothing as `conflict` (FR-012) and the decision on the current head where no commit is recorded (FR-020). Neutral comments · src/contracts/source-control-writer.ts
- [x] T005 [P] [US5] [NT: contract type and doc declarations] Add `ReviewActionResult.warning` (`message_not_posted`); add the prefix note on `PullSummary.headCommit`; remove the `no-enclosing-repository` gap kind (FR-034); update `SpecSource.key` and `SpecRule` docs; neutral comments (FR-018) · src/contracts/http.ts
- [x] T006 [P] [US8] [NT: type declaration only] Add optional `sshHost` to the `WorkspaceConfig` type (validation comes in T020, after its test) · src/config.ts
- [x] T007 [P] [US3] [NT: label text, shown by the UI tasks] Add `REVIEW_LABELS.deletedComment` and `messageNotPosted`, a `SpecRule` label map (`matching-branch-over-develop` → "matching branch over base branch"), and the "`<branch>` also has a copy" label. Remove `gapNotInProject`. Neutral comment (FR-018) · src/ui/labels.ts

**⟶ Wait for Wave 1 to finish, then Wave 2 — failing tests (different files):**

- [x] T008 [P] [US1] [VO-002] [VO-003] [VO-005] [VO-006] [VO-007] Use data where every user and author has a distinct id, display name and handle. Cover: `sameHandle` (ignores case, empty never matches); author guard disables every capability with "you are the author"; a deleted author account stays reviewable; edit and delete ownership by handle plus the session's write records; a posted message writes a `<requestId>:message` `comment` intent after the decision intent is terminal; a failed message gives `warning` and no comment intent; an empty message gives neither · test/unit/review-actions.test.ts
- [x] T009 [P] [US1] [VO-004] [VO-008] [VO-009] [VO-010] For each platform's identity data: an own pull request gives 403 `forbidden` with no network write; `GET …/decision` shows `canReview.allowed: false` with the author reason; a failed message gives 200 with `warning` and the decision; withdraw with nothing gives 409 `conflict`; `capability.reply.allowed` is true on every platform (FR-015) · test/integration/review-actions-routes.test.ts
- [x] T010 [P] [US3] [VO-001] [VO-011] [VO-012] [VO-013] [VO-014] [VO-015] Read contract scenarios and per-platform expectation data, with no branching on platform (FR-028): `authorHandle` and `author.handle` in the `CurrentUser.handle` form; nested replies share the root `threadId`; at most one `startsThread` per thread; orphaned replies with `orphanPlaceholder` as data (GitLab `false`); `approvedByMe` partial failure and all-fail `unavailable`; clone locations (two for Bitbucket, `ssh.github.com`, GitLab `sshHost`, no other host claimed); signed-in handle differs from `authorHandle` (FR-029) · test/contract/source-control.suite.ts, test/contract/source-control.contract.test.ts
- [x] T011 [P] [US4] [VO-016] [VO-017] [VO-018] [VO-019] [VO-020] [VO-021] [VO-022] [VO-023] [VO-024] [VO-025] [VO-026] Writer contract scenarios and per-platform expectation data: new-commits refusal is `conflict` with nothing posted, newest diff version only; an abbreviated list-row head never causes a refusal, because the head check reads the full id from the pull request itself (FR-019); a platform refusal of an edit or delete is reported as `forbidden` (edge case: handle changed after listing); single-line and range anchors land on exactly the chosen lines; decision write before message write; message failure resolves with `message.posted: false`; decision failure sends no message; empty message sends none; withdraw with nothing is `conflict` twice with no write; reply to a whole-pull-request comment posts (quoting body where the platform has no reply); every writer read goes through the read layer (FR-016) · test/contract/source-control-writer.suite.ts, test/contract/source-control-writer.contract.test.ts
- [x] T012 [P] [US6] [VO-027] New: inside `withRequestScope`, one in-flight promise per GET URL plus credential; outside a scope nothing is cached; a failed read is evicted; clearing empties the scope; scopes do not leak between concurrent requests · test/unit/request-memo.test.ts
- [x] T013 [P] [US6] [VO-028] Inside a scope a repeated GET makes one network call and replays the body to each caller; a different credential is not shared; non-GET is never memoised · test/unit/read-only-http.test.ts
- [x] T014 [P] [US6] [VO-029] A write clears the memo on success and on failure; the write layer has no path that reads the memo · test/unit/write-http.test.ts
- [x] T015 [P] [US6] [VO-030] New: concurrency 4; each failure logged with pull request number and error code; partial success returns the successes; every check failing throws `unavailable`; empty input returns an empty set · test/unit/approved-by-me.test.ts
- [x] T016 [P] [US8] [VO-031] `workspace.sshHost` accepts a bare host and rejects a scheme, path or port · test/unit/config.test.ts

**⟶ Wait for Wave 2 to finish, then Wave 3 — core and shared modules (different files):**

- [x] T017 [P] [US1] [VO-002] [VO-003] [VO-004] [VO-005] [VO-006] [VO-007] [VO-008] Export `sameHandle` and use it in the `run()` guard, `decision()`, edit/delete ownership, `readBack()` and `comments()`. Remove both `info.author === me` checks. `resultOf()` fills `author.name` and `author.handle` from `currentUser()`. Write the message intent when `message.posted`, and set `warning` when not · src/core/review-actions.ts
- [x] T018 [P] [US6] [VO-027] New: `AsyncLocalStorage` scope, `withRequestScope`, memo get/fill (read layer only) and clear (write layer) · src/adapters/request-memo.ts
- [x] T019 [P] [US6] [VO-030] New: `approvedAcross(platform, numbers, one)` over `mapLimited` (limit 4) · src/adapters/approved-by-me.ts
- [x] T020 [P] [US8] [VO-031] Validate `workspace.sshHost` as a bare host name (an invalid value is `ConfigError('invalid_request', 'workspace.sshHost', …)`); add `SourceControlSettings.sshHost` and pass it into settings at both call sites · src/config.ts, src/adapters/registry.ts, src/server/routes/context.ts

**⟶ Wait for T018, then Wave 4 — memo wiring (different files):**

- [x] T021 [P] [US6] [VO-028] Serve GETs through the scope's memo · src/adapters/read-only-http.ts
- [x] T022 [P] [US6] [VO-029] Clear the scope's memo after every write, successful or not · src/adapters/write-http.ts
- [x] T023 [P] [US6] [VO-027] Wrap each request in `withRequestScope` · src/server/http.ts

**Checkpoint**: T008 and T012 to T016 pass. T009 to T011 fail per platform until Phases 3 to 5 land.

## Phase 3: Bitbucket Cloud parity (US1 to US6, P1) 🎯 MVP

Files: `src/adapters/bitbucket/source-control.ts`, `src/adapters/bitbucket/source-control-writer.ts`, `test/fixtures/bitbucket/`

Tests: `test/unit/bitbucket-approvals.test.ts`

Bitbucket is the product's target, so it lands first.

**Wave 1 — test data and tests (different files):**

- [x] T024 [P] [US3] [VO-011] Re-author the review-action fixtures: signed-in `account_id` differs from the author's and from every display name; a conversation three deep; a deleted root and a deleted middle reply; a whole-pull-request comment; a pull request moved to a newer head. README says hand-authored, re-recorded at T068 · test/fixtures/bitbucket/review-actions/
- [x] T025 [P] [US6] [VO-032] `approvedByMe` goes through `approvedAcross` (partial failure logged, all-fail `unavailable`); opening the queue inside `withRequestScope` reads each pull request at most once (SC-010) · test/unit/bitbucket-approvals.test.ts

**⟶ Wait for Wave 1 to finish, then Wave 2 (different files):**

- [x] T026 [P] [US1] [VO-001] [VO-012] [VO-013] [VO-014] [VO-032] `authorHandle` and `author.handle` from `account_id` (`''` when absent). Walk `parent` links over every comment, deleted ones included, to the root `threadId`, then drop deleted comments. `startsThread` when there is no parent. `approvedByMe` through `approvedAcross`. Fix the misplaced `this` method reference · src/adapters/bitbucket/source-control.ts
- [x] T027 [P] [US4] [VO-009] [VO-016] [VO-017] [VO-018] [VO-019] [VO-020] [VO-021] [VO-022] [VO-023] [VO-024] [VO-026] Before a line comment, read the pull request through the read layer and refuse with `conflict` when the head is not `anchor.commit`. Post ranges on exactly the chosen lines. Decision first, then message, returning `message` on the outcome and never throwing for a failed message. Drop the unused approve body. Keep withdraw's `myDecision` guard · src/adapters/bitbucket/source-control-writer.ts

**Checkpoint**: Bitbucket passes the read and writer contract suites (`node --test --test-name-pattern=bitbucket-cloud test/contract/*.contract.test.ts`), T009 for Bitbucket, and T025. US1 to US6 hold on Bitbucket. The other platforms' scenarios still fail until their phases land.

## Phase 4: GitHub parity (US1 to US6, US8)

Files: `src/adapters/github/source-control.ts`, `src/adapters/github/source-control-writer.ts`, `test/fixtures/github/`

Tests: `test/unit/github-approvals.test.ts`

**Wave 1 — test data and tests (different files):**

- [x] T028 [P] [US6] [VO-011] Re-author the review-action fixtures: `login` differs from every display name and from the author's; a reply chain whose root is deleted; a whole-pull-request issue comment with its `issues/comments/{id}` read and the quoting POST; a pull request moved to a newer head · test/fixtures/github/review-actions/
- [x] T029 [P] [US6] [NT: existing test moved to the shared helper, covered by the read contract] `approvedByMe` goes through `approvedAcross` · test/unit/github-approvals.test.ts

**⟶ Wait for Wave 1 to finish, then Wave 2 (different files):**

- [x] T030 [P] [US1] [VO-001] [VO-012] [VO-013] [VO-014] [VO-015] `authorHandle` and `author.handle` from `user.login`. `startsThread` when `in_reply_to_id` is absent. `cloneLocations` and `repositoryForRemote` accept `ssh.github.com` (FR-021). `approvedByMe` through `approvedAcross` · src/adapters/github/source-control.ts
- [x] T031 [P] [US6] [VO-009] [VO-010] [VO-016] [VO-018] [VO-020] [VO-024] [VO-025] [VO-026] Head check through the read layer before a line comment. `replyToThread` reads `pulls/comments/{id}`; on `not_found` it reads `issues/comments/{id}` and posts a quoting comment to `issues/{pr}/comments`. `withdrawDecision` uses `reads.myDecision()` and refuses with `conflict`, with no own `/user` or reviews read. Every read through `createReadOnlyFetch` · src/adapters/github/source-control-writer.ts

**Checkpoint**: GitHub passes both contract suites (`node --test --test-name-pattern=github test/contract/*.contract.test.ts`), T009 for GitHub, and T029.

## Phase 5: GitLab parity (US1 to US6, US8)

Files: `src/adapters/gitlab/source-control.ts`, `src/adapters/gitlab/source-control-writer.ts`, `test/fixtures/gitlab/`

**Wave 1 — test data:**

- [x] T032 [US2] [VO-011] Re-author the review-action fixtures and variants: `username` differs from the display name and numeric id, and from the author's; a discussion whose first note was deleted (next note first); versions where an older version matches the anchor commit but the newest does not; a message POST that fails after approve; unapprove with no decision · test/fixtures/gitlab/review-actions/

**⟶ Wait for T032, then Wave 2 (different files):**

- [x] T033 [P] [US2] [VO-001] [VO-012] [VO-013] [VO-014] [VO-015] `authorHandle` and `author.handle` from `username`. `threadId` is the discussion id; `startsThread` for the discussion's first note. `cloneLocations` and `repositoryForRemote` accept `settings.sshHost` (FR-021). `approvedByMe` through `approvedAcross` · src/adapters/gitlab/source-control.ts
- [x] T034 [P] [US4] [VO-009] [VO-016] [VO-018] [VO-020] [VO-021] [VO-022] [VO-023] [VO-024] [VO-026] Read versions through the read layer and compare `versions[0]` only. Decision first, then message, with `message` on the outcome. Withdraw reads `myDecision()` and refuses with `conflict` before `unapprove`. Request-changes stays unavailable with its version reason · src/adapters/gitlab/source-control-writer.ts

**Checkpoint**: GitLab passes both contract suites (`node --test --test-name-pattern=gitlab test/contract/*.contract.test.ts`) and T009 for GitLab. All three platforms agree once Phases 3 to 5 are all done.

## Phase 6: Thread and decision interface (US3, US5)

Files: `src/ui/state/use-review-comments.ts`, `src/ui/state/use-review-decision.ts`, `src/ui/components/comment-thread.tsx`, `src/ui/components/decision-panel.tsx`

Tests: `test/unit/ui-review-comments.test.ts`, `test/ui/comment-manage.ui.ts`, `test/ui/overview-decision.ui.ts`

Needs only Foundational; runs alongside Phases 3 to 5.

### Tests

**Wave 1 — failing tests (different files):**

- [x] T035 [P] [US3] [VO-033] New: `threadsOf()` gives one thread per `threadId` at any depth; a thread with no `startsThread` comment gets `start: 'deleted'`; a deleted root plus a deleted middle reply give one placeholder; replies ordered by `createdAt`; `canReply` follows `capability.reply` · test/unit/ui-review-comments.test.ts
- [x] T036 [P] [US3] [VO-034] `comment-deleted-placeholder` shows first in an orphaned thread; `comment-reply` shows on a whole-pull-request thread; `comment-edit` and `comment-delete` only on editable comments · test/ui/comment-manage.ui.ts
- [x] T037 [P] [US5] [VO-035] A result with `warning` shows `decision-message-not-posted`, the decision state updates, and `decision-message` keeps its text; an empty message shows no warning · test/ui/overview-decision.ui.ts

### Implementation

**⟶ Wait for the tests, then Wave 2 (different files):**

- [x] T038 [P] [US3] [VO-033] `threadsOf()` uses `startsThread` and emits the `'deleted'` start · src/ui/state/use-review-comments.ts
- [x] T039 [P] [US5] [VO-035] Expose `warning` from the result and keep the message text when it is present · src/ui/state/use-review-decision.ts

**⟶ Wait for Wave 2, then Wave 3 (different files):**

- [x] T040 [P] [US3] [VO-034] Render the muted `comment-deleted-placeholder` row, then the replies, in one `comment-thread` · src/ui/components/comment-thread.tsx
- [x] T041 [P] [US5] [VO-035] Show the `ActionNotice` `decision-message-not-posted` with `REVIEW_LABELS.messageNotPosted` · src/ui/components/decision-panel.tsx

**Checkpoint**: T035 to T037 pass. Orphaned replies and half-made decisions read correctly on every platform.

## Phase 7: Spec in the pull request's own repository (US10, P2)

Files: `src/repo/git.ts`, `src/repo/manager.ts`, `src/core/spec-match.ts`, `src/core/spec-context.ts`, `src/ui/components/spec-context.tsx`

Tests: `test/unit/spec-match.test.ts`, `test/unit/git-commands.test.ts`, `test/integration/spec-lookup-git.test.ts`, `test/integration/repo-safety.test.ts`, `test/integration/spec-context-service.test.ts`, `test/end-to-end/spec-context.test.ts`, `test/end-to-end/spec-gaps.test.ts`

Needs only Foundational; independent of Phases 3 to 6.

### Tests

**Wave 1 — failing tests (different files):**

- [x] T042 [P] [US10] [VO-036] With no tracker key, the terms are the branch name and its last segment after `/`, de-duplicated ignoring case; a branch term matches a whole folder name only (`feature/007-review-actions-parity` matches, `007-review` does not); a tracker key still matches as in feature 006 · test/unit/spec-match.test.ts
- [x] T043 [P] [US10] [VO-037] `listRemoteHeads` args are `ls-remote --symref {url} HEAD refs/heads/*` · test/unit/git-commands.test.ts
- [x] T044 [P] [US10] [VO-038] The manager parses the `HEAD` symref into `defaultBranch` (null when absent) alongside the heads · test/integration/spec-lookup-git.test.ts
- [x] T045 [P] [US10] [VO-039] The new `ls-remote` form still writes nothing to the clone (IX) · test/integration/repo-safety.test.ts
- [x] T046 [P] [US10] [VO-040] Search considers the default branch, `develop` when it exists, and the matching branches, once each; other copies name their actual branch · test/integration/spec-context-service.test.ts
- [x] T047 [P] [US10] [VO-041] [VO-042] Same-repository case: default branch `main`, branch named like the spec folder, no tracker key, no enclosing repository → summary and source shown, no gap. Keep the enclosing-repository case with a tracker key unchanged (FR-035, FR-036) · test/end-to-end/spec-context.test.ts
- [x] T048 [P] [US10] [VO-043] A repository outside any enclosing project repository raises no gap (replace the `no-enclosing-repository` assertion); `no-key` arises only with no term at all · test/end-to-end/spec-gaps.test.ts

### Implementation

**⟶ Wait for the tests, then Wave 2 (different files):**

- [x] T049 [P] [US10] [VO-037] [VO-039] Change `GIT_COMMANDS.listRemoteHeads` to the `--symref … HEAD refs/heads/*` form · src/repo/git.ts
- [x] T050 [P] [US10] [VO-036] Term matcher for key and branch terms; `chooseCopy` takes a branch matcher in place of a key, ranking unchanged · src/core/spec-match.ts
- [x] T051 [P] [US10] [VO-040] [VO-043] Rule text from the `SpecRule` label map; "`<branch>` also has a copy" from `others[].branch`; drop the not-in-project gap branch · src/ui/components/spec-context.tsx

**⟶ Wait for T049, then:**

- [x] T052 [US10] [VO-038] Return the heads plus `defaultBranch` from the `HEAD` symref · src/repo/manager.ts

**⟶ Wait for T050 and T052, then:**

- [x] T053 [US10] [VO-040] [VO-041] [VO-042] [VO-043] Build terms (keys, else branch name and last segment); consider the default branch, `develop` when present, and matching branches; stop raising the `no-enclosing-repository` gap while still storing `not-inside-project` · src/core/spec-context.ts

**Checkpoint**: T042 to T048 pass. The Specification panel works for this project's own pull requests (SC-011).

## Phase 8: GitHub and GitLab sign-in from `.env` (US9, P3)

Files: `src/adapters/env-credentials.ts`

Tests: `test/unit/env-credentials.test.ts`, `test/unit/credentials.test.ts`

- [x] T054 [US9] [VO-044] [VO-045] New: GitHub reads `GITHUB_TOKEN`, then `GH_TOKEN`; GitLab reads `GITLAB_TOKEN`; each returns `{ secret, scheme: 'bearer', scope: 'write' }`; empty or unset is absent; Bitbucket and Jira unchanged. Extend the credential-store leak tests so a GitHub or GitLab token from the environment never reaches any location X.7 lists (X.8) · test/unit/env-credentials.test.ts, test/unit/credentials.test.ts

**⟶ Wait for T054, then:**

- [x] T055 [US9] [VO-044] [VO-045] Add the GitHub and GitLab branches to `envCredential` · src/adapters/env-credentials.ts

**Checkpoint**: T054 passes; the devcontainer signs in to GitHub and GitLab from `.env` alone.

## Phase 9: Project checks (US7)

Files: `src/ui/state/review-queue.ts`, `src/ui/screens/home.tsx`, `src/ui/components/panel-host.tsx` (delete), `src/ui/components/evidence-panel.tsx` (delete)

Tests: `test/unit/ui-safety.test.ts`, `test/unit/ui-view-state.test.ts`, `test/unit/platform-names.test.ts`, `test/unit/review-queue.test.ts`, `test/ui/markdown-preview.ui.ts`

Needs only Foundational.

### Tests

**Wave 1 — failing or updated tests (different files):**

- [x] T056 [P] [US7] [NT: test allowlist corrections, FR-023 and FR-024 exempt] `OWN_APPROVAL_STRINGS` gains "Approved by you, waiting to merge" (FR-023). Exempt exactly `components/markdown-preview.tsx` from the HTML-injection scan, by name, with a comment citing FR-024 · test/unit/ui-safety.test.ts
- [x] T057 [P] [US7] [NT: test allowlist correction, FR-025 exempt] The stored dashboard view-state allowlist includes `collapsedLanes` (FR-025) · test/unit/ui-view-state.test.ts
- [x] T058 [P] [US7] [NT: preview sanitising test, FR-024 exempt] Add any missing case so the preview provably strips `<script>`, `onerror` handlers and `javascript:` links (FR-024) · test/ui/markdown-preview.ui.ts
- [x] T059 [P] [US7] [VO-046] Keep the scan over all of `src/` outside `src/adapters/`, and make it pass: no platform name in core, server, store, UI or contracts (FR-018). Fix any name the scan finds outside the files Foundational and this phase already own by reporting it back rather than editing another phase's file · test/unit/platform-names.test.ts
- [x] T060 [P] [US7] [VO-047] An abbreviated list-row `headCommit` that prefixes the session head is not "new commits" (FR-019) · test/unit/review-queue.test.ts

### Implementation

**⟶ Wait for the tests, then Wave 2 (different files):**

- [x] T061 [P] [US7] [NT: deletion, FR-026 exempt] Delete the orphaned panels; nothing imports them (FR-026) · src/ui/components/panel-host.tsx, src/ui/components/evidence-panel.tsx
- [x] T062 [P] [US7] [VO-046] [VO-047] Make comments platform-neutral and confirm `sameCommit` compares by prefix · src/ui/state/review-queue.ts
- [x] T063 [P] [US7] [VO-046] Make comments platform-neutral · src/ui/screens/home.tsx

**Checkpoint**: T056 to T060 pass.

## Phase 10: Live GitLab writer and recorded fixtures (US7)

Files: `test/gitlab/contract.test.ts`, `test/seeder/gitlab-seeder.ts`, `test/helpers/recorded-fetch.ts`, `test/record/capture.ts`, `test/record/README.md`

**One sanctioned overlap**: T068 overwrites the fixture folders that Phases 3 to 5 own. This phase starts only after those phases are done, so no two workers touch them at once.

**Wave 1 — failing live test and tooling (different files):**

- [x] T064 [P] [US7] [VO-048] Run the writer contract live against the local GitLab instance, exercising comment, reply, edit, delete, approve, withdraw and the new-commits refusal, not only reads (FR-031). It fails until T066 seeds the reviewer and author · test/gitlab/contract.test.ts
- [x] T065 [P] [US7] [NT: recording tooling, checked by MV-001] `recordingFetch` gains `aliases` (real → placeholder) applied to URLs, headers and bodies; placeholders `alice-dev`, `bob-dev`, `test-workspace` · test/helpers/recorded-fetch.ts

**⟶ Wait for Wave 1, then Wave 2 (different files):**

- [x] T066 [P] [US7] [VO-048] The seeder adds a second author account and gives the reviewer a Developer role and an `api` token; the author's merge request is the review target · test/seeder/gitlab-seeder.ts
- [x] T067 [P] [US7] [NT: recording tooling, checked by MV-001] New `node --import` preload, outside every test glob: refuses to start without `PRWB_RECORD_FIXTURES` and the alias variables, then replaces the global `fetch` with `recordingFetch` (aliases and secrets applied). Add the click script a person follows in the real UI, one review action per click (II.4), covering every scenario the contract suites need, and how each fixture README names the recording role and date. No product file changes · test/record/capture.ts, test/record/README.md

**⟶ Wait for Wave 2, then (person-run, in order):**

- [ ] T068 [US7] [NT: person task, MV-001] Person task: start the app with `node --import ./test/record/capture.ts src/main.ts` and follow the click script. Record GitLab from the local instance, then Bitbucket Cloud and GitHub from the T002 workspace. Replace each `review-actions/` fixture folder, check no secret or real name remains (SC-009), and confirm the signed-in handle differs from `authorHandle` (FR-029). Re-run `node --test test/contract/*.contract.test.ts` · test/fixtures/{bitbucket,github,gitlab}/review-actions/

**Checkpoint**: `npm run gitlab:up && npm run test:gitlab` passes with writes after T066; every fixture README names a real recording role.

## Phase 11: Polish

- [x] T069 [P] [NT: documentation] Confirm the corrected "acts on platforms" boundary wording (already in the working tree) · docs/domain_knowledge/CONTEXT.md
- [x] T070 [P] [NT: documentation] Confirm the corrected Bitbucket range wording; the decision is unchanged and not superseded · docs/domain_knowledge/adr/0003-reviewer-actions-and-workbench-scope.md
- [x] T071 [NT: review grep] Grep all of `src/` outside `src/adapters/` for platform names (FR-018) and for leftover `no-enclosing-repository`, `gapNotInProject` and `info.author ===` references · (no file)
- [x] T072 [NT: broad validation run] Validate against the Success Criteria: run `npm run typecheck` (0 errors), `npm test` (0 failures), `node --test test/contract/*.contract.test.ts`, `npm run test:ui`, and `npm run gitlab:up && npm run test:gitlab`. Compare with the T001 baseline and walk SC-001 to SC-011 · (no file)

## Dependencies & Execution Order

**Phases**: Setup → Foundational → {Phase 3 Bitbucket, Phase 4 GitHub, Phase 5 GitLab, Phase 6 interface, Phase 7 spec context, Phase 8 `.env`, Phase 9 checks} in parallel → Phase 10 (after Phases 3 to 5, and T002 for T068) → Polish.

Bitbucket (Phase 3) is the MVP. If work runs one phase at a time, do it first.

**Waves per phase**:

- **Phase 1**: T001 and T002 are independent. T002 blocks only T068.
- **Phase 2**: Wave 1 (T003 to T007) → Wave 2 tests (T008 to T016) → Wave 3 (T017 to T020) → Wave 4 (T021 to T023, after T018).
- **Phase 3**: T024, T025 → T026, T027.
- **Phase 4**: T028, T029 → T030, T031.
- **Phase 5**: T032 → T033, T034.
- **Phase 6**: T035 to T037 → T038, T039 → T040, T041.
- **Phase 7**: T042 to T048 → T049 to T051 → T052 (after T049) → T053 (after T050 and T052).
- **Phase 8**: T054 → T055.
- **Phase 9**: T056 to T060 → T061 to T063.
- **Phase 10**: T064, T065 → T066, T067 → T068.
- **Phase 11**: T069, T070, T071 → T072.
