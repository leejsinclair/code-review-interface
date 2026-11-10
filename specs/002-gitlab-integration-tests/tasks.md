# Tasks: GitLab Platform and Live Integration Tests

**Feature**: `002-gitlab-integration-tests` | **Spec**: [gitlab-integration-tests.spec.md](gitlab-integration-tests.spec.md) | **Plan**: [plan.md](plan.md)
**Inputs**: [data-model.md](data-model.md), [contracts/interfaces.md](contracts/interfaces.md), [research.md](research.md)

**Scale note.** About 30 files across five areas: two new adapters, the read-only HTTP layer (every platform), configuration and the setup screen, the shared contract suites, and a new test-only seeder with four live suites. Watch three things. The redirect change in `read-only-http.ts` affects GitHub, Bitbucket and Jira too. The tightened address rule now also applies to the existing tracker `site`. The seeder is the first code that writes to a platform: it stays under `test/`, refuses non-loopback addresses, and deletes only what its own run created.

**Tests first** (constitution XI.1): every `### Tests` block is written before the code it covers and fails until that code lands. Live files under `test/gitlab/` need `npm run gitlab:up` and `npm run gitlab:bootstrap`.

**Ownership decision.** The extracted contract runners take an adapter factory from their target, so the fixture targets call `createGithubSourceControl` and friends directly. That keeps `src/adapters/registry.ts` and `src/server/routes/context.ts` wholly inside US1, with no Foundational edit to them.

Format: `- [ ] **T###** [P?] [US#] Description · exact/file/path`

---

## Phase 1: Setup

Files: `package.json`, `test/gitlab/required.env`

**Wave 1 — independent (different files):**

- [x] **T001** [P] Add scripts `test:gitlab` (`node --env-file=test/gitlab/required.env --test "test/gitlab/*.test.ts"`) and `gitlab:clean` (`node test/gitlab/clean.ts`). Leave `test` and `gitlab:reset` unchanged (FR-030, FR-046) · `package.json`
- [x] **T002** [P] Create the env file with `PRWB_GITLAB_REQUIRED=1` (FR-036) · `test/gitlab/required.env`

---

## Phase 2: Foundational

Blocks every story. Neutral contract and config changes, the redirect rule, the seeder, the live gate, the live harness helpers and the extracted contract runners.

Files: `src/config.ts`, `src/contracts/shared.ts`, `src/contracts/http.ts`, `src/contracts/issue-tracker.ts`, `src/adapters/read-only-http.ts`, `test/seeder/platform-seeder.ts`, `test/seeder/run-name.ts`, `test/seeder/gitlab-seeder.ts`, `test/gitlab/env.ts`, `test/gitlab/clean.ts`, `test/helpers/logged-fetch.ts`, `test/helpers/git-sandbox.ts`, `test/helpers/fake-ai-cli.ts`, `test/contract/source-control.suite.ts`, `test/contract/source-control.contract.test.ts`, `test/contract/issue-tracker.suite.ts`, `test/contract/issue-tracker.contract.test.ts`

### Tests

Owns: `test/unit/config.test.ts`, `test/unit/read-only-http.test.ts`, `test/unit/platform-names.test.ts`, `test/unit/seeder-safety.test.ts`

**Wave 1 — independent (different files):**

- [x] **T003** [P] Address-rule cases for `validateBaseUrl` on both `repository.baseUrl` and `issueTracker.site`: the accepted and refused examples in contracts §4 (sub-path kept; `localhost`, `127.0.0.1`, `[::1]` over http; `http://gitlab.example.com`, `http://localhost.example.com`, user info, query, fragment refused), the message `must use https, or http on a loopback address`, and a missing `baseUrl` refused when the chosen platform is in `needsBaseUrl` (FR-016, FR-017, FR-018) · `test/unit/config.test.ts`
- [x] **T004** [P] Redirect cases with `recordedFetch` replaying 3xx: same-origin 301/302/303/307/308 followed with the same headers; a 6th hop, a missing `Location` and a cross-origin `Location` (including a different port) throw `AdapterError('unavailable')` and send no request to the other origin, so the credential never reaches it (FR-043, FR-044) · `test/unit/read-only-http.test.ts`
- [x] **T005** [P] Add `'gitlab'` to `FORBIDDEN` so the name is refused outside adapters, tests and fixtures (FR-020) · `test/unit/platform-names.test.ts`
- [x] **T006** [P] Seeder safety: run names match `it-<suite>-<yyyymmddhhmmssSSS>`, the ownership test accepts only the run's own prefix (not `it-<suite>-<other ts>`, not a bare `it-`), leftover filtering excludes the current run, and constructing `GitlabSeeder` with a non-loopback `GITLAB_URL` throws before any request (FR-027, FR-028, FR-045) · `test/unit/seeder-safety.test.ts`

### Implementation

**⟶ Wait for the Tests waves to finish, then:**

**Wave 2 — independent (different files):**

- [x] **T007** [P] Add `validateBaseUrl(field, value)` and `isLoopbackHost(hostname)` (exactly `localhost`, `[::1]`, dotted quad starting `127.`). Add optional `RepositoryConfig.baseUrl`, apply the rule to it and to `issueTracker.site`, and refuse a missing `baseUrl` when `RegisteredPlatforms.needsBaseUrl` contains the chosen platform. No platform name in code or messages (FR-016, FR-017, FR-018) · `src/config.ts`
- [x] **T008** [P] Add optional `needsBaseUrl` to `AdapterDescriptor` · `src/contracts/shared.ts`
- [x] **T009** [P] Add optional `baseUrl` to `Config.repository` and `ConfigBody.repository` (FR-016) · `src/contracts/http.ts`
- [x] **T010** [P] Extend `IssueRefForm` with `'!123'` and `'owner/repo!123'` (FR-013) · `src/contracts/issue-tracker.ts`
- [x] **T011** [P] Send GET with `redirect: 'manual'`; on 301/302/303/307/308 resolve `Location` against the current URL, repeat the GET with the same headers when the origin matches (max 5 hops), otherwise throw `AdapterError('unavailable')` before sending (ADR 0002, FR-043, FR-044) · `src/adapters/read-only-http.ts`
- [x] **T012** [P] Run naming `it-<suite>-<UTC yyyymmddhhmmssSSS>`, `ownedBy(runName, name)` prefix test, leftover filter for other runs' `it-*` items (FR-028, FR-045) · `test/seeder/run-name.ts`
- [x] **T013** [P] Neutral `PlatformSeeder` interface, `FileChange`, `SeededRun`, `SeededRepo`, `SeededPull`, `SeededIssue` exactly as contracts §7 (FR-023, FR-025) · `test/seeder/platform-seeder.ts`
- [x] **T014** [P] Wrap real `fetch`, recording each request's method, URL and host so suites assert GET-only (SC-005, FR-021) · `test/helpers/logged-fetch.ts`
- [x] **T015** [P] Add `liveClone(httpUrl, token)`: HTTP clone into a temp dir with a temp `HOME` whose `.gitconfig` sets `credential.helper=store` and whose `.git-credentials` holds the token for that host; the token never enters the clone's config or remote URL (R11, FR-033) · `test/helpers/git-sandbox.ts`
- [x] **T016** [P] Live gate: resolve `GITLAB_URL` / `GITLAB_TOKEN` with `testing/gitlab.md` defaults; probe `GET /api/v4/version` with a 5-second timeout; when unreachable or 401, return `{ skip: '<message naming npm run gitlab:up and npm run gitlab:bootstrap>' }` unless `PRWB_GITLAB_REQUIRED=1`, in which case register one failing test named for the cause (FR-035, FR-036, FR-037, FR-038) · `test/gitlab/env.ts`
- [x] **T017** [P] Move the source-control cases into exported `runSourceControlContract(target)`, where `target` supplies the adapter factory and expected values as data (open numbers, account, author, fork head, clone locations, deleted PR, unauthorized repo). Turn the `.contract.test.ts` into GitHub and Bitbucket fixture targets that call their adapter factories directly. Same pass count as before (FR-031) · `test/contract/source-control.suite.ts`, `test/contract/source-control.contract.test.ts`
- [x] **T018** [P] Same extraction into `runIssueTrackerContract(target)`. The "no access" case asserts `status: 'unresolved'` with the reason the target names (`'forbidden'` for GitHub Issues and Jira), and the pull-request-reference case takes its reference text from the target. Fixture targets for `github-issues` and `jira-cloud`; same pass count (FR-015, FR-031, SC-001) · `test/contract/issue-tracker.suite.ts`, `test/contract/issue-tracker.contract.test.ts`

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — independent (different files):**

- [x] **T019** [P] `GitlabSeeder implements PlatformSeeder`: root token via global `fetch` with `PRIVATE-TOKEN`, never `src/adapters/`; refuse non-loopback with `isLoopbackHost`; `begin(suite)` creates the run user (`skip_confirmation`) and a `read_api`+`read_repository` token expiring tomorrow; each review project adds the user as Reporter; `createHiddenIssue` uses a private run project without the user; pushes via git CLI from its own author clone (adds, edits, renames, deletes, binary bytes); polls branch visibility, `diff_refs` and `merge_status` with `waitFor` (30 s, names what it waited for, no sleeps); `cleanup()` deletes only owned projects in two steps (`permanently_remove=true&full_path=<renamed>`) and the user with `hard_delete`, polls until gone, logs leftovers without masking the test's failure; `listLeftovers()` never deletes (FR-023, FR-024, FR-026, FR-027, FR-028, FR-029, FR-045) · `test/seeder/gitlab-seeder.ts`
- [x] **T020** [P] `startWorkbench({ live: { repository, issueTracker, credentials, clonePath, fetch } })`: real server, store and Git, no fixture loading or GitHub/Jira defaults, network wrapped in `logged-fetch` (R11, FR-032) · `test/helpers/fake-ai-cli.ts`

**⟶ Wait for Wave 3 to finish, then:**

- [x] **T021** `gitlab:clean` entry point: refuses a non-loopback `GITLAB_URL`, deletes every `it-*` project (both steps) and user, reusing the seeder's deletion helpers, and prints what it removed. Never imported by a test (FR-046) · `test/gitlab/clean.ts`

**Checkpoint**: `npm run typecheck` and `npm test` pass with the pre-feature pass count. T003–T006 pass.

---

## Phase 3: User Story 1 — Prove the GitLab adapters against a real GitLab (P1) 🎯 MVP

**Goal**: `gitlab` and `gitlab-issues` adapters pass both shared contract suites against live seeded data, and the run leaves nothing behind.
**Independent Test**: With GitLab up and bootstrapped, `npm run test:gitlab -- test/gitlab/contract.test.ts` passes; afterwards no project or user named for the run remains.

Files: `src/adapters/gitlab/api.ts`, `src/adapters/gitlab/source-control.ts`, `src/adapters/gitlab/issues.ts`, `src/adapters/registry.ts`, `src/server/routes/context.ts`

### Tests

Owns: `test/unit/gitlab-references.test.ts`, `test/gitlab/contract.test.ts`

**Wave 1 — independent (different files):**

- [x] **T022** [P] [US1] Reference parsing: `#12`, `group/project#12`, `group/sub/project#12`, `!12`, `group/project!12`; `#12` and `!12` in one text give two keys; `!` forms resolve to `{ status: 'resolved', kind: 'pull-request' }` with no request; no match inside URLs, `&#12;` or words (FR-012, FR-013) · `test/unit/gitlab-references.test.ts`
- [x] **T023** [P] [US1] Live contract file: gate from `env.ts`; `begin('contract')`; seed a project with open MRs, a fork MR, a deleted MR, issues and a hidden issue; build adapters with the run's reviewer token through `adapterDeps` over `logged-fetch`; run `runSourceControlContract` and `runIssueTrackerContract` with seeded expectations (`'not found'` as the no-access reason, `!N` as the PR reference); add the changed-file case (added, modified, renamed with previous path, deleted, binary flag, line counts); assert every request is GET; in `t.after` call `cleanup()`, assert none of the run's projects or user remain, and print leftovers (US1 AS1–AS4, FR-001–FR-015, FR-029, FR-031, FR-045, SC-001, SC-004, SC-005) · `test/gitlab/contract.test.ts`

### Implementation

**⟶ Wait for the Tests wave to finish, then:**

- [x] **T024** [US1] GitLab API helpers: `<baseUrl trimmed>/api/v4/...` by string join (keeps sub-path), project path encoded as one segment (nested groups), paged GET following `Link: rel="next"` via `nextLink`, `pageSize` default 100, 10-page cap throws `truncated`; status mapping 404 → `not_found`, 401/403 → `unauthorized`, 5xx/network → `unavailable` (FR-008, FR-009, FR-010) · `src/adapters/gitlab/api.ts`

**⟶ Wait for T024, then:**

**Wave 2 — independent (different files):**

- [x] **T025** [P] [US1] `GITLAB_ID`, `GITLAB_DESCRIPTOR` (`GitLab (self-managed)`, one `secret` field, `needsBaseUrl: true`), `createGitlabSourceControl(deps, settings, { pageSize? })`: sign-in via `/user`; list/get MRs with the state map; commits reversed with UTC times; changed files from `/diffs` with status, `old_path`, counted lines; `raw_diffs`; head `refs/merge-requests/<iid>/head` on the base project, target `refs/heads/<target_branch>`, clone URLs and `cloneLocations` from `http_url_to_repo`. Confirm GitLab 19.5's binary signal against T023 and keep only that one (R4) (FR-001–FR-010) · `src/adapters/gitlab/source-control.ts`
- [x] **T026** [P] [US1] `GITLAB_ISSUES_ID`, `GITLAB_ISSUES_DESCRIPTOR` (`GitLab Issues`, one `secret` field), `createGitlabIssuesTracker(deps, { site, repository })`: R5 patterns and keys; `!` references resolved as pull requests without a request; `GET /projects/:id/issues/:iid` → title, description as written, `web_url`; 404 → unresolved `'not found'`, 401/403 → `'forbidden'`, else `'tracker unreachable'` (FR-011–FR-015) · `src/adapters/gitlab/issues.ts`

**⟶ Wait for Wave 2 to finish, then:**

- [x] **T027** [US1] Add `SourceControlSettings`, change `create(deps, settings)`, `createSourceControl(platform, deps, settings)` and `verifySignIn(platform, deps, settings)`; GitHub and Bitbucket entries ignore settings; register `gitlab` and `gitlab-issues` (tracker requires `site`); `registeredPlatforms()` also returns `needsBaseUrl` (R1, FR-001, FR-011, FR-016) · `src/adapters/registry.ts`

**⟶ Wait for T027, then:**

- [x] **T028** [US1] Pass `{ repository, baseUrl }` into `createSourceControl` in `environment()` and into `verifySignIn` in `verify` (FR-001, FR-016) · `src/server/routes/context.ts`

**Checkpoint**: T022 and T023 pass live; `npm test` still passes with GitLab stopped and reports `contract.test.ts` skipped.

---

## Phase 4: User Story 2 — Review a GitLab merge request end to end (P2)

**Goal**: A reviewer configures a self-hosted GitLab and runs the full review journey against it.
**Independent Test**: `npm run test:gitlab -- test/gitlab/lifecycle.test.ts` passes with the reviewer clone's fingerprint unchanged at every step.

Files: `src/ui/screens/setup.tsx`

### Tests

Owns: `test/gitlab/lifecycle.test.ts`

- [x] **T029** [US2] Live lifecycle: seed a project with an MR linking an issue and three more MRs; `liveClone` as the reviewer; `startWorkbench({ live })` configured via `PUT /api/config` with `baseUrl` (and a refused `http://gitlab.example.com` returning the validator message); open session (commits, files, linked issue, summaries); scoped question stored against range and head; push a commit, refresh, new snapshot with old answers on old head; close, merge and delete one MR each and refresh; reopen the closed one; restart on the same store and find sessions and answers; fingerprint the clone (branch, HEAD, index, status, stash) around every repository operation; every GitLab request is GET; the reviewer token appears in no config file, store row, log or API response (US2 AS1–AS7, FR-019, FR-022, FR-032, FR-034, SC-005, SC-006) · `test/gitlab/lifecycle.test.ts`

### Implementation

**⟶ Wait for T029, then:**

- [x] **T030** [US2] Show a **Repository base address** input `data-testid="setup-base-url"` beside the tracker site field when the chosen source-control descriptor has `needsBaseUrl`; send it as `repository.baseUrl`; show refusals in `setup-error`. No platform name in the screen (FR-019, FR-020) · `src/ui/screens/setup.tsx`

**Checkpoint**: T029 passes live; setup screen offers the base address for `gitlab` only.

---

## Phase 5: User Story 3 — Cover what recorded fixtures cannot (P2)

**Goal**: Live evidence for paging, truncation, git fetch over HTTP, bad tokens and a renamed project.
**Independent Test**: `npm run test:gitlab -- test/gitlab/coverage.test.ts` passes.

Files: none in `src/`. A defect these tests expose is fixed in the US1 file that owns it, after US1 is complete.

### Tests

Owns: `test/gitlab/coverage.test.ts`. Same file, so one task at a time.

- [x] **T031** [US3] Paging: with `pageSize: 2`, five open MRs each returned once; an MR with five changed files lists each once; with `pageSize: 1` and eleven MRs the call reports `truncated` (US3 AS1–AS3, FR-009, FR-033) · `test/gitlab/coverage.test.ts`

**⟶ Wait for T031, then:**

- [x] **T032** [US3] Git fetch: `liveClone` over HTTP, the product's repository manager fetches the MR head and target; both commits resolve; only `refs/prwb/*` or remote-tracking refs change; clone fingerprint unchanged (US3 AS4, FR-033, FR-034) · `test/gitlab/coverage.test.ts`

**⟶ Wait for T032, then:**

- [x] **T033** [US3] Tokens: a token that never existed fails sign-in with a reason and marks the platform signed-out; a reviewer token from `createReviewerToken` that worked, then `revokeReviewerToken`, makes the next call fail `unauthorized` and marks the platform expired (US3 AS5–AS6, FR-033) · `test/gitlab/coverage.test.ts`

**⟶ Wait for T033, then:**

- [x] **T034** [US3] Rename: `renameRepository`, then read the MR at the old path and get it back, whether GitLab answers in place or with a same-origin redirect (US3 AS7, FR-033, FR-043) · `test/gitlab/coverage.test.ts`

**Checkpoint**: `coverage.test.ts` passes live and cleans up its run.

---

## Phase 6: User Story 4 — Record real responses as fixtures (P3, optional)

**Goal**: Recording mode writes scrubbed fixtures that the existing replay reads. Can be cut without affecting other stories.
**Independent Test**: `npm run test:gitlab -- test/gitlab/recording.test.ts` passes, and no recorded file contains the token.

Files: `test/helpers/recorded-fetch.ts`

### Tests

Owns: `test/gitlab/recording.test.ts`

- [x] **T035** [US4] Record one source-control contract case into a temp dir; grep every file for the reviewer token, `authorization`, `private-token`, `cookie`, `set-cookie`: none found; replay the files with `recordedFetch` through `runSourceControlContract` with the saved expectations; with `PRWB_RECORD_FIXTURES` unset, the dir stays empty (US4 AS1–AS3, FR-022, FR-041, FR-042) · `test/gitlab/recording.test.ts`

### Implementation

**⟶ Wait for T035, then:**

- [x] **T036** [US4] Add `recordingFetch(network, { dir, secrets })`, on when `PRWB_RECORD_FIXTURES` names a directory: one file per request in the replay format, drop `authorization`, `private-token`, `cookie`, `set-cookie`, replace each secret in URLs and bodies with `[redacted]` (FR-041, FR-042) · `test/helpers/recorded-fetch.ts`

**Checkpoint**: T035 passes live.

---

## Phase 7: Polish

Files: `testing/gitlab.md`, `testing/README.md`

**Wave 1 — independent (different files):**

- [x] **T037** [P] Describe GitLab as a supported platform: configuring the workbench against the local instance (base address, project, token), `test:gitlab`, `GITLAB_URL`/`GITLAB_TOKEN` defaults, skip-versus-fail behaviour, leftovers and `gitlab:clean` replacing reset advice; tests never run `gitlab:reset` (FR-040, SC-009) · `testing/gitlab.md`
- [x] **T038** [P] Add GitLab to the supported platforms and the live suite to the test overview (FR-040) · `testing/README.md`

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T039** Validate against Success Criteria: `npm run typecheck`; with GitLab stopped, `npm test` passes with the pre-feature pass count and every GitLab test skipped (SC-002), and `npm run test:gitlab` fails within 30 s naming the cause (SC-003); with GitLab up, `npm run test:gitlab` passes in under 10 minutes (SC-001, SC-004–SC-007); ten consecutive runs pass with no reset (SC-008); `grep -r "gitlab:reset" test/` finds nothing (FR-039); walk `testing/gitlab.md` to an open session in under 2 minutes (SC-009)

---

## Dependencies & Execution Order

**Phases**: Setup → Foundational → US1 → (US2 ∥ US3 ∥ US4) → Polish. US2, US3 and US4 each need US1's adapters and own disjoint files, so they can run in parallel. US4 can be cut.

- **Setup**: Wave 1 (T001, T002).
- **Foundational**: Tests wave (T003–T006) → Wave 2 (T007–T018) → Wave 3 (T019, T020) → T021.
- **US1**: Tests wave (T022, T023) → T024 → Wave 2 (T025, T026) → T027 → T028.
- **US2**: T029 → T030.
- **US3**: T031 → T032 → T033 → T034 (one file).
- **US4**: T035 → T036.
- **Polish**: Wave 1 (T037, T038) → T039.
