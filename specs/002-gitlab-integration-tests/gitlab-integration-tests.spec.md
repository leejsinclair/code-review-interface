# Feature Specification: GitLab Platform and Live Integration Tests

**Feature Branch**: `002-gitlab-integration-tests`
**Created**: 2026-11-08
**Status**: Draft

**Grilled on**: 2026-11-08

**Input**: Add self-hosted GitLab as a third source-control platform and GitLab Issues as a third issue tracker, and use a disposable local GitLab to build the project's first automated tests that run against a real platform instead of hand-written fixtures. References: `testing/README.md`, `testing/gitlab.md`.

## Why

Every platform test today replays hand-written responses. The contract tests prove the adapters match those responses, not that the responses match a real platform. No recorded response covers a second page of results, and sign-in is never checked against a real server. Bitbucket Cloud and Jira cannot be reached from the development machine. The local GitLab instance under `gitlab/` gives a real Git host, REST API and issue tracker that tests can drive repeatably and offline.

## Clarifications

### Session 2026-11-08

- Q: Which GitLab account do the adapters use in live tests? → A: A fresh non-administrator user per run, created by the seeder with its own token and deleted with the run; root is used only by the seeder.
- Q: How should platform redirects be handled? → A: Follow same-origin redirects only, for every platform; refuse cross-origin redirects without sending the credential; test a renamed project live and a cross-origin redirect in a unit test.
- Q: Where does the GitLab Issues tracker get its address? → A: Its own existing site setting, under the same https-or-loopback-http rule as the repository address; it may differ from the repository's instance.
- Q: What happens to leftovers from crashed runs? → A: Each run lists them and never deletes them; a separate manual command, `gitlab:clean`, removes `it-*` projects and users on request.
- Q: Is the optional recording mode in this feature? → A: Yes, as the last story (P3); it can be cut at implement time without affecting the other stories.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prove the GitLab adapters against a real GitLab (Priority: P1)

A developer starts the local GitLab and runs the GitLab test command. The suite creates its own projects, branches, commits, merge requests and issues, then runs the same source-control and issue-tracker contract suites every other adapter passes, this time against live responses. When the run ends, everything the suite created is gone.

**Why this priority**: It delivers the two adapters and the first evidence that an adapter matches a real platform rather than a hand-written fixture. Every later story reuses its test setup.

**Independent Test**: With GitLab up and bootstrapped, run the GitLab test command. Both contract suites pass for the GitLab adapters, and afterwards no project or user created by the run remains.

**Acceptance Scenarios**:

1. **Given** GitLab is running and bootstrapped, **When** the developer runs the GitLab test command, **Then** the shared source-control contract suite passes for the GitLab adapter using data the suite created moments before.
2. **Given** the same run, **When** the issue-tracker contract suite runs, **Then** it passes for the GitLab Issues adapter, including an issue that exists, one that does not, one the signed-in user may not see, and a merge-request reference that is not mistaken for an issue.
3. **Given** a seeded merge request whose changes include an added, a modified, a renamed, a deleted and a binary file, **When** its changed files are listed, **Then** each file has the right status, paths and line counts, and the binary file is marked binary.
4. **Given** the run has finished, passed or failed, **When** the developer lists GitLab projects and users, **Then** none created by that run remain and nothing created by anyone else has changed.
5. **Given** GitLab is stopped, **When** the developer runs plain `npm test`, **Then** every other test runs as before and the GitLab tests are reported as skipped with a message that says how to start GitLab.
6. **Given** GitLab is stopped, **When** the developer runs the GitLab test command explicitly, **Then** the run fails and says GitLab is unreachable.

---

### User Story 2 - Review a GitLab merge request end to end (Priority: P2)

A reviewer configures the workbench for a self-hosted GitLab by giving its address, the project and their token, then reviews a merge request exactly as they would on GitHub or Bitbucket: open a session, read summaries, ask scoped questions, see a new head after a push, and see the session react when the merge request is closed, merged or deleted. A live test drives this whole journey against the local GitLab, using the real application server, store and Git, with the fake AI command-line tool.

**Why this priority**: It shows the product works on a real platform end to end, not only that the adapters return the right shapes. It depends on Story 1's adapters and test setup.

**Independent Test**: Run the lifecycle portion of the GitLab suite. One seeded merge request goes through the full review journey and restart with every assertion passing and the reviewer's clone unchanged.

**Acceptance Scenarios**:

1. **Given** the workbench is configured with the local GitLab address, a seeded project and a valid token, **When** the reviewer opens the merge request, **Then** one review session starts with its commits, changed files, linked issue and summaries.
2. **Given** an open session, **When** the reviewer asks a question scoped to a line range, **Then** the answer is stored against that range and the current head commit.
3. **Given** an open session, **When** the test pushes a new commit to the merge request and the reviewer refreshes, **Then** a new snapshot with the new head appears and earlier answers stay tied to the old head.
4. **Given** sessions on three merge requests, **When** one is closed, one merged and one deleted on GitLab and each session is refreshed, **Then** each session shows the right state and keeps its stored answers.
5. **Given** the merge request is reopened after closing, **When** the session is refreshed, **Then** it shows the merge request as open again.
6. **Given** a completed review, **When** the workbench restarts on the same store, **Then** sessions and answers are still there.
7. **Given** any step above, **When** the workbench touches the reviewer's clone, **Then** its branch, HEAD, index, working-tree status and stash are unchanged.

---

### User Story 3 - Cover what recorded fixtures cannot (Priority: P2)

A developer runs the GitLab suite and gets evidence for behaviour that hand-written fixtures never exercise: results that span more than one page, a real Git fetch over HTTP with a token, and tokens that are invalid or revoked.

**Why this priority**: These are the gaps that motivated the feature. They need Story 1's setup but not Story 2's lifecycle.

**Independent Test**: Run the paging, fetch and token cases of the GitLab suite on their own. Each passes against the live instance.

**Acceptance Scenarios**:

1. **Given** a project with more open merge requests than fit on one page, **When** open merge requests are listed, **Then** every one is returned exactly once.
2. **Given** a merge request with more changed files than fit on one page, **When** its changed files are listed, **Then** every file is returned exactly once.
3. **Given** more results than the adapter's page cap allows, **When** they are listed, **Then** the result is reported as truncated rather than silently cut short.
4. **Given** a reviewer clone whose remote points at the local GitLab over HTTP, **When** the workbench fetches a merge request's head and target with the stored token, **Then** both commits are available for review and only application-owned or remote-tracking refs change.
5. **Given** a token that never existed, **When** sign-in is checked, **Then** it fails with a reason and the platform is marked signed-out.
6. **Given** a token that worked and is then revoked, **When** the next platform call runs, **Then** it fails as unauthorized and the platform is marked expired.
7. **Given** a seeded project that is then renamed, **When** the adapter reads it at its old path, **Then** GitLab's same-origin redirect is followed and the merge request is returned.

---

### User Story 4 - Record real responses as fixtures (Priority: P3)

A developer turns on a recording mode, runs a GitLab test, and gets fixture files built from the real responses with credentials stripped. This shows how Bitbucket and Jira fixtures can later be refreshed from real responses.

**Why this priority**: Optional. It improves fixture trust over time but nothing else depends on it.

**Independent Test**: Run one GitLab contract case in recording mode, then replay the recorded files in the ordinary fixture-backed contract suite. It passes, and no recorded file contains the token.

**Acceptance Scenarios**:

1. **Given** recording mode is on, **When** a GitLab test runs, **Then** each request and response is saved as a fixture in the format the existing fixture replay reads.
2. **Given** a recorded fixture, **When** it is searched for the token, authorization headers or cookies, **Then** none are found.
3. **Given** recording mode is off, **When** the suite runs, **Then** no fixture file is written.

---

### Edge Cases

- A merge request is created just after a push, before GitLab has processed the branch: the seeder waits until the branch is visible instead of failing on the first refusal.
- A new merge request is still being prepared and has no diff references: tests wait until it is ready before reading its diff or files.
- A merge is requested before GitLab has decided the merge request is mergeable: the seeder waits, within the same bound.
- Any wait exceeds about 30 seconds: the test fails naming what it was waiting for. No fixed sleeps.
- Deleting a project only schedules deletion and renames it: cleanup finishes the permanent removal using the renamed path.
- A previous run crashed and left its projects or test user behind: a new run never deletes them, because they do not carry its own run name. It lists them, and the developer removes them with the manual cleanup command.
- Cleanup itself fails part way: the test result still reports the original failure, and the leftover names are printed.
- Two suites run at once against the same instance: unique names keep their data apart and neither touches the other's.
- The configured address is `http://` but not loopback, such as `http://gitlab.example.com` or `http://localhost.example.com`: refused.
- The configured address carries a user name or password: refused.
- GitLab is served under a sub-path, such as `https://host/gitlab`: API, clone and web links all keep the sub-path.
- A project lives in a nested group (`group/sub/project`): references, clone locations and API addresses handle every level.
- A confidential issue, or an issue in a project the user cannot see: GitLab answers "not found". The tracker reports it unresolved, never as an error that breaks the session.
- `#12` and `!12` in the same text refer to different things: one is an issue, the other a merge request.
- A merge request from a fork: its head is fetched from the base project's merge-request ref.
- A deleted merge request: the adapter reports it as not found, and the session shows it as deleted.
- A platform answers with a redirect to a different origin: the call fails as unavailable and the credential never reaches that origin.
- GitLab is reachable but the token is missing or not bootstrapped: an explicit run fails with a message pointing at the bootstrap command; plain `npm test` skips with that message.

## Requirements *(mandatory)*

### Functional Requirements

**GitLab source control**

- **FR-001**: The workbench MUST offer self-hosted GitLab as a source-control platform that implements the existing source-control contract with no change to that contract's callers.
- **FR-002**: The GitLab source-control adapter MUST confirm sign-in with one read-only call and report the account name.
- **FR-003**: The GitLab source-control adapter MUST list open merge requests and get one merge request, reporting its number, title, description, author, source and target branches, head commit, state (open, closed or merged) and last update time.
- **FR-004**: The GitLab source-control adapter MUST list a merge request's commits oldest first, with full commit ids and UTC times.
- **FR-005**: The GitLab source-control adapter MUST list a merge request's changed files with status added, modified, renamed or deleted, the previous path for renames, line counts, and a binary flag.
- **FR-006**: The GitLab source-control adapter MUST return a merge request's unified diff.
- **FR-007**: The GitLab source-control adapter MUST give the head location as the base project's merge-request ref and the target location as the target branch, each with the project's clone addresses.
- **FR-008**: The GitLab source-control adapter MUST give clone locations that match a reviewer clone's remote, including the instance's host, port, sub-path and nested groups.
- **FR-009**: The GitLab adapters MUST follow GitLab's paging until all results are read, and report truncation when the existing page cap is reached.
- **FR-010**: A deleted or missing merge request MUST be reported as not found, a refused credential as unauthorized, and a server failure as unavailable.

**GitLab Issues**

- **FR-011**: The workbench MUST offer GitLab Issues as an issue tracker that implements the existing issue-tracker contract.
- **FR-012**: The GitLab Issues tracker MUST find issue references written as `#123` and as `group/project#123`, including nested groups.
- **FR-013**: The GitLab Issues tracker MUST recognise merge-request references (`!123`, `group/project!123`) as merge requests, reporting them the way existing trackers report a reference that turns out to be a pull request, and never look them up as issues.
- **FR-014**: The GitLab Issues tracker MUST return a found issue's title, description as plain text and web link.
- **FR-015**: The GitLab Issues tracker MUST report a missing, confidential or forbidden issue as unresolved with a reason, never as an error.

**Self-hosted address**

- **FR-016**: Source-control and issue-tracker configuration MUST each accept their own base address for a self-hosted instance, through settings whose names and validation mention no platform. The tracker uses its existing site setting, so issues may live on a different instance from the code.
- **FR-017**: Every base address, including the existing tracker site, MUST use https, except that http is allowed when the host is a loopback address (`localhost`, `127.0.0.0/8`, `::1`).
- **FR-018**: A base address carrying a user name, password, query or fragment MUST be refused.
- **FR-019**: The setup screen SHOULD offer a repository base-address field the same way it already offers the tracker site field, and show the validation reason when an address is refused.
- **FR-020**: The automated platform-name check MUST also forbid GitLab's name in code outside adapters, tests and fixtures, and MUST keep passing.

**Read-only product**

- **FR-021**: Every product request to GitLab MUST go through the existing read-only layer, and the product MUST NOT create, comment on, approve, merge or delete anything on GitLab.
- **FR-043**: The read-only layer MUST follow a redirect only when it stays on the same origin (scheme, host and port), for every platform.
- **FR-044**: The read-only layer MUST refuse a redirect to another origin as unavailable, without sending the credential there.
- **FR-022**: The product MUST read the GitLab token only through the credential store, and the token MUST NOT appear in configuration, logs, the review store, API responses or fixtures.

**Platform seeder (test-only)**

- **FR-023**: A test-only seeder MUST define provider-neutral test-setup operations: create and delete a repository, fork a repository, push commits (including adds, edits, renames, deletes and binary files), open, update, close, reopen, merge and delete pull requests, create issues, and create and revoke a test user's token.
- **FR-024**: The GitLab seeder MUST live under `test/`, never under `src/`, and MUST NOT use the product's read-only HTTP layer or adapters.
- **FR-025**: Tests MUST use only the neutral seeder operations, so that adding a GitHub or Bitbucket sandbox seeder later requires no change to the tests.
- **FR-026**: The seeder MUST wait for GitLab's background processing (branch visible after a push, merge request ready, mergeability decided) by polling with a bound of about 30 seconds, never with fixed sleeps.
- **FR-027**: The seeder MUST refuse to run against any address that is not loopback.
- **FR-028**: The seeder MUST name everything it creates `it-<suite>-<timestamp>` and MUST delete only things carrying its own run's name, completing GitLab's two-step project removal.
- **FR-029**: For each run, the seeder MUST create a non-administrator user named for the run, with its own token and access to the run's projects only. The adapters under test MUST use that token, never the root token, and the user MUST be deleted with the run's projects.

**Live suite**

- **FR-030**: The project MUST provide the `test:gitlab` command that runs the GitLab live suite.
- **FR-031**: The live suite MUST run the existing source-control and issue-tracker contract suites against the GitLab adapters, taking expected values from the seeded data rather than fixture constants.
- **FR-032**: The live suite MUST run the full review lifecycle against GitLab with the real server, store and Git and the fake AI command-line tool: open session, summaries, scoped questions, new head and refresh, closed, merged, reopened and deleted merge requests, and restart.
- **FR-033**: The live suite MUST cover more than one page of merge requests and of changed files, a real Git fetch over HTTP with a token, invalid and revoked tokens, and a renamed project reached through its old path.
- **FR-034**: Every repository operation in the live suite MUST check that the reviewer clone's branch, HEAD, index, working-tree status and stash are unchanged.
- **FR-035**: Under plain `npm test`, the live suite MUST skip with a message naming `npm run gitlab:up` and `npm run gitlab:bootstrap` when GitLab is unreachable or not bootstrapped.
- **FR-036**: Under `test:gitlab`, the live suite MUST fail when GitLab is unreachable or not bootstrapped.
- **FR-037**: A skipped GitLab test MUST be reported as skipped, never as passed.
- **FR-038**: The live suite MUST read the instance address and token from `GITLAB_URL` and `GITLAB_TOKEN`, defaulting to the values in `testing/gitlab.md`.
- **FR-039**: Tests MUST NOT run `gitlab:reset`.
- **FR-045**: Each live run MUST list any `it-*` projects and users left by earlier runs, without deleting them.
- **FR-046**: The project MUST provide a manual cleanup command, `gitlab:clean`, that deletes only `it-*` projects and users from the local instance and refuses any address that is not loopback.
- **FR-040**: `testing/README.md` and `testing/gitlab.md` MUST describe GitLab as a supported platform and how to run the live suite.

**Recording (optional)**

- **FR-041**: The fixture replay helper SHOULD offer a recording mode that saves real GitLab responses as fixtures in the format it replays.
- **FR-042**: Recorded fixtures MUST NOT contain tokens, authorization headers or cookies.

### Key Entities

- **Self-hosted address**: the base web address of a platform instance a reviewer configures. Scheme, host, optional port and optional sub-path. The source-control and issue-tracker configurations each hold their own.
- **Merge request**: GitLab's pull request. Has a per-project number, source and target branches, head commit, state and a merge-request ref. Maps onto the existing pull-request shape.
- **Issue reference**: text pointing at an issue (`#123`, `group/project#123`) or at a merge request (`!123`), resolved by the tracker.
- **Platform seeder**: test-only setup that writes to a disposable platform. A neutral set of operations with one implementation per platform.
- **Seeded run**: everything one suite creates, named `it-<suite>-<timestamp>`: projects, forks, test user and token, branches, commits, merge requests and issues. It is the unit of cleanup.
- **Recorded fixture**: a saved request and response pair, with credentials stripped, that the existing replay helper reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The GitLab adapters pass 100% of the shared source-control and issue-tracker contract cases against the live instance, with no case skipped or special-cased for GitLab.
- **SC-002**: With GitLab stopped, plain `npm test` passes with the same pass count as before this feature and reports every GitLab test as skipped.
- **SC-003**: With GitLab stopped, `test:gitlab` exits with failure within 30 seconds and names the cause.
- **SC-004**: After any live run, passed or failed, zero projects, users or tokens carrying that run's name remain, and zero items the run did not create were changed.
- **SC-005**: Across a full live run, zero product requests to GitLab use a method other than GET.
- **SC-006**: Across a full live run, the reviewer clone's fingerprint is identical before and after every repository operation.
- **SC-007**: The full live suite completes in under 10 minutes on a warm local instance.
- **SC-008**: Ten consecutive live runs on the same instance pass with no reset between them.
- **SC-009**: A reviewer can configure the local GitLab and open a review session on a merge request in under 2 minutes using only `testing/gitlab.md`.

## Assumptions

- Several lines of the request were cut off at the end. They were read as: the lifecycle ends with "and restart", where the real server, store and Git are used; "skipped coverage is never reported as passed"; recording "shows the approach for refreshing Bitbucket and Jira fixtures"; "poll the branch until it is visible"; "gitlab:reset is never run by tests"; "browser/UI automation (a separate follow-up)".
- The constitution amendments the request asked for are already in place: VIII.1 lists self-hosted GitLab for development and testing, XI.2 allows live GitLab adapter tests, and XI.4 allows test-only writes to a disposable loopback instance. This feature proposes no further amendment.
- GitLab is offered as a real selectable platform, not a test-only one. Reviewers can configure it like the others.
- GitLab merge requests and issues have separate numbering, so `#12` is always an issue and `!12` is always a merge request.
- GitLab reports a confidential or inaccessible issue as "not found". The tracker treats that as unresolved.
- GitLab will not create an already-expired token. A revoked token stands in for an expired one: both are refused as unauthorized.
- Fork support is needed because the shared contract suite includes a fork case and every adapter must pass the same suite.
- GitLab tests live where plain `npm test` picks them up, so they run whenever GitLab is up and skip when it is not.

## Verbatim Constraints

- Test command name: `test:gitlab`
- Run naming: `it-<suite>-<timestamp>`
- Merge-request head ref: `refs/merge-requests/<iid>/head`
- Environment variables: `GITLAB_URL`, `GITLAB_TOKEN`
- Fixture replay helper: `test/helpers/recorded-fetch.ts`
- Never run by tests: `gitlab:reset`
- Manual leftover cleanup command: `gitlab:clean`

## Out of Scope

- Browser and UI automation. A separate follow-up.
- GitLab.com or any hosted or shared GitLab. Only the disposable local instance is written to.
- GitHub or Bitbucket sandbox seeders. The seeder is designed for them, but none is built here.
- Refreshing Bitbucket or Jira fixtures from real responses. Recording only demonstrates the approach.
- Any write by the product to any platform.
