# Feature Specification: Review Actions Platform Parity

**Feature Branch**: `007-review-actions-parity`
**Created**: 2026-11-14
**Status**: Draft

**Grilled on**: 2026-11-14 (stopped early, 0 points open)

**Input**: "Review actions platform parity — see docs/handover/review-actions-platform-parity.md"
**Hardens**: `specs/005-review-actions/` (review actions), `specs/004-risk-review-focus/` (signed-in user), `specs/006-spec-context/` (spec context, same-repository case)

## Clarifications

### Session 2026-11-14

- Q: Rename the "Approved by you, waiting to merge" lane, or allow it as an own-approval label? → A: Allow it, alongside the existing own-approval labels (constitution II.2).
- Q: Allow sanitised HTML in the Markdown preview as an exemption, build it from a sanitised DOM fragment, or show plain text? → A: A named, reviewed exemption for the Markdown preview only, with a test proving the sanitising.
- Q: Where do the live review-action recordings come from? → A: A dedicated test workspace and a second account, set up before implement reaches the recording tasks; their names stay out of the spec.
- Q: On GitHub, post a reply to a whole-pull-request comment as a new quoting comment, or hide Reply there? → A: Post it as a new comment on the pull request that quotes the original.
- Q: Correct the stale "never acts on platforms" boundary in the domain context and the "one line, not a range" Bitbucket gap in ADR 0003? → A: Correct both; ADR 0003's decision is unchanged, so it is not superseded.
- Q: Fix spec context for specs in the pull request's own repository as part of this feature, or separately? → A: As part of this feature.
- Q: How is a same-repo spec folder found without a tracker key? → A: Its name equals the branch name, or the branch name's last segment after `/`, ignoring case.
- Q: Which base branches does spec context search? → A: The repository's default branch, plus `develop` when it exists.

## User Scenarios & Testing *(mandatory)*

Feature 005 lets a reviewer comment, reply, edit, delete, approve, request changes and withdraw from the workbench on Bitbucket Cloud, GitHub and GitLab. A review of that work found that the three platforms do not behave the same way, and that two safety rules break on some of them. This feature makes every review action behave the same, correct way on all three. Bitbucket Cloud is the product's target, so its correctness comes first.

Spec context (feature 006) also turned out to work only when the specs live in a separate, enclosing project repository. Most of the time a pull request's specs live in its own repository. This feature makes that normal case work too (User Story 10).

### User Story 1 - I cannot review my own pull request, on any platform (Priority: P1)

When I open a pull request I wrote, every review action is disabled and the tool tells me why: I am the author. Today Bitbucket lets me review my own work, because it compares my account id with my display name and they never match.

**Why this priority**: Reviewing your own pull request defeats the point of review. This is a safety rule the tool already claims to enforce.

**Independent Test**: On each platform, sign in as a user whose display name differs from their handle, open a pull request they wrote, and try every review action.

**Acceptance Scenarios**:

1. **Given** I am signed in and my display name differs from my handle, **When** I open a pull request I wrote on any of the three platforms, **Then** every review action is disabled and the reason shown is that I am the author.
2. **Given** a pull request I wrote, **When** a review action reaches the server anyway, **Then** it is refused as forbidden and nothing is sent to the platform.
3. **Given** a pull request someone else wrote, **When** I open it, **Then** the review actions are available as before.

### User Story 2 - I can edit and delete the comments I posted, on any platform (Priority: P1)

Comments I posted from the tool show Edit and Delete. Other people's comments do not. Today GitLab never shows Edit or Delete on my own comments, because it compares my username with my display name or numeric id.

**Why this priority**: Feature 005 promised this on every platform. On GitLab it does not work at all.

**Independent Test**: On each platform, post a comment from the tool, reload the pull request, then edit and delete it.

**Acceptance Scenarios**:

1. **Given** a comment the tool posted for me, **When** the pull request's comments are listed on any platform, **Then** that comment is marked as mine and offers Edit and Delete.
2. **Given** that comment, **When** I edit it and then delete it, **Then** both succeed and the change shows on the platform.
3. **Given** a comment someone else wrote, or one I wrote outside the tool, **When** comments are listed, **Then** it offers neither Edit nor Delete.

### User Story 3 - Replies show in the right thread (Priority: P1)

A reply to a reply on Bitbucket appears inside the original conversation, not as a new one. If someone deletes the comment that started a conversation, the replies still show, under a "deleted comment" placeholder.

**Why this priority**: Split threads hide the conversation a reviewer is answering. Lost replies hide other reviewers' feedback.

**Independent Test**: On Bitbucket, load a pull request with a conversation three replies deep and one whose first comment was deleted.

**Acceptance Scenarios**:

1. **Given** a Bitbucket conversation three levels deep, **When** it is shown, **Then** every comment appears in one thread that belongs to the first comment.
2. **Given** a conversation whose first comment was deleted, **When** it is shown, **Then** the replies appear under a "deleted comment" placeholder.
3. **Given** a reply to a nested comment, **When** I post it, **Then** it appears in the same thread.

### User Story 4 - A line comment never lands on lines from a newer commit (Priority: P1)

If new commits arrive after I chose the lines, my line comment is refused and I am told there are new commits, on every platform. Today Bitbucket posts it anyway, so it can point at the wrong code.

**Why this priority**: A comment on the wrong lines misleads the author and cannot be moved afterwards.

**Independent Test**: On each platform, choose lines, push a new commit to the pull request, then post the comment.

**Acceptance Scenarios**:

1. **Given** I chose lines on one commit, **When** the pull request has moved to a newer commit and I post, **Then** the comment is refused as a conflict with a "new commits" message and nothing is posted.
2. **Given** the pull request has not moved, **When** I post a single-line or a range comment, **Then** it lands on exactly the lines I chose.

### User Story 5 - A decision with a message is never half-reported (Priority: P2)

When I approve or request changes with a message, the decision is made first and the message posted second. If only the message fails, I am told the decision went through but the message did not. Nothing is left behind that the tool does not know about.

**Why this priority**: Today Bitbucket and GitLab do this in opposite orders, and GitLab reports a made decision as a failure. A reviewer can end up approving twice or believing they did not approve.

**Independent Test**: On Bitbucket and GitLab, make the message post fail after the decision succeeds, and read the outcome.

**Acceptance Scenarios**:

1. **Given** the decision succeeds and the message fails, **When** the outcome is shown, **Then** it says the decision was made and the message was not posted, and the message text stays in the box.
2. **Given** both succeed, **When** I later view the message, **Then** it is recorded as posted by the tool and offers Edit and Delete.
3. **Given** the decision itself fails, **When** the outcome is shown, **Then** no message is posted.

### User Story 6 - Errors and edge cases mean the same thing on every platform (Priority: P2)

The same situation gives the same result whichever platform I am on.

**Why this priority**: The interface can only explain an error it can recognise. Today the same situation gives three different errors.

**Independent Test**: Run each case below against all three platforms and compare the outcomes.

**Acceptance Scenarios**:

1. **Given** I have no decision on a pull request, **When** I withdraw, **Then** every platform gives the same "nothing to withdraw" error.
2. **Given** the check for "approved by me" fails for every pull request in my queue, **When** the queue loads, **Then** it reports that the check failed, not that nothing is approved.
3. **Given** that check fails for one pull request only, **When** the queue loads, **Then** the other pull requests still show their status and the failure is logged.
4. **Given** a comment on the whole pull request, **When** I reply on GitHub, **Then** the reply is posted, as it already is on Bitbucket and GitLab. The tool never offers a reply that is bound to fail.

### User Story 7 - The project's checks prove parity (Priority: P2)

As a maintainer, I can run the test suite and the type check and see them pass. The tests prove every behaviour above on all three platforms, against responses recorded from real accounts.

**Why this priority**: Six tests and the type check fail today, and no review-action response has ever been recorded from a real platform. Without this, nothing above stays fixed.

**Independent Test**: Run the type check, the full test suite, the platform contract suites and the live GitLab writer test.

**Acceptance Scenarios**:

1. **Given** the finished feature, **When** I run the type check and the test suite, **Then** both pass with no failures.
2. **Given** the shared contract suites, **When** they run for each platform, **Then** they cover the author guard, comment ownership, nested and orphaned replies, single-line and range anchors, the new-commits refusal, a decision whose message fails, withdrawing with nothing to withdraw, a reply to a whole-pull-request comment, and an "approved by me" check that fails everywhere.
3. **Given** the local GitLab instance, **When** the live tests run, **Then** they exercise review actions, not only reads.
4. **Given** the recorded responses, **When** I read their notes, **Then** each says which real account recorded it, and the signed-in user differs from the pull request author.

### User Story 8 - My clone is recognised whichever SSH host I used (Priority: P3)

The tool matches my local clone to its pull requests whether I cloned over the usual SSH host or an alternative one.

**Why this priority**: It only affects people who use the alternative hosts, and Bitbucket already works.

**Independent Test**: Point a clone's remote at each alternative host and open the workbench from it.

**Acceptance Scenarios**:

1. **Given** a GitHub clone over `ssh.github.com` on port 443, **When** I open the workbench, **Then** its repository is recognised.
2. **Given** a self-hosted GitLab whose SSH host differs from its web host, **When** I open the workbench, **Then** its repository is recognised.

### User Story 9 - I can sign in from `.env` for GitHub and GitLab (Priority: P3)

In the devcontainer, the tool picks up GitHub and GitLab credentials from `.env`, as it already does for Bitbucket and Jira.

**Why this priority**: A convenience for development. Other sign-in routes already work.

**Independent Test**: Start the devcontainer with only a `.env` file holding each token and open a pull request on each platform.

**Acceptance Scenarios**:

1. **Given** `.env` holds `GITHUB_TOKEN` or `GH_TOKEN`, **When** no other GitHub credential is available, **Then** the tool signs in to GitHub with it.
2. **Given** `.env` holds `GITLAB_TOKEN`, **When** no other GitLab credential is available, **Then** the tool signs in to GitLab with it.

### User Story 10 - The spec is found when it lives in the pull request's own repository (Priority: P2)

Most teams keep their Spec Kit specs in the same repository as the code. When I open a pull request whose spec is in its own repository, the Specification panel finds and summarises it, just as it does when the spec lives in an enclosing project repository. Today the lookup only works with a tracker key such as `ENG-1213` in the branch name and a `develop` branch. It also warns that the repository is "not inside a known project repository", which is the normal case.

**Why this priority**: Spec context does not work at all for the usual setup, including this project's. The enclosing project repository stays supported, as a special case.

**Independent Test**: Open a pull request in a repository whose default branch is `main`, from a branch named like its spec folder, with no tracker key and no enclosing repository.

**Acceptance Scenarios**:

1. **Given** a pull request whose spec folder is in its own repository and whose branch carries no tracker key, **When** I open the overview, **Then** the panel shows the spec's summary and where it was read from.
2. **Given** a repository whose default branch is not `develop`, **When** the spec exists only on the default branch, **Then** it is found there.
3. **Given** a repository that is not inside another known clone, **When** the overview opens, **Then** no gap or warning is shown for that.
4. **Given** a pull request in a repository inside an enclosing project repository, with a tracker key, **When** the overview opens, **Then** the spec is found exactly as feature 006 describes.

### Edge Cases

- EC-01: A user's handle changes between listing comments and editing one: ownership follows the handle at the time of the check, and an edit refused by the platform is reported as forbidden.
- EC-02: The pull request author's account has been deleted: the author guard does not match anyone, so the review actions stay available.
- EC-03: Both the first comment and a middle reply in a thread are deleted: the remaining replies stay in one thread under one placeholder.
- EC-04: A line comment where the platform's list shows an abbreviated commit id: the new-commits check compares full commit ids, so an abbreviation never causes a false refusal.
- EC-05: A decision is withdrawn and immediately withdrawn again: the second gives the "nothing to withdraw" error.
- EC-06: A decision with an empty message: no message is posted and no warning is shown.
- EC-07: A decision on Bitbucket or GitLab after new commits: these platforms record no commit for a decision, so the decision stands on the current head. This is today's behaviour and stays.
- EC-08: A spec folder exists in both the pull request's own repository and the enclosing project repository: the own repository wins, as feature 006 already ranks them.
- EC-09: A branch named `feature/007-review-actions-parity` matches `specs/007-review-actions-parity`. A branch named `007-review` does not match `specs/007-review-actions-parity`: the name must match whole.
- EC-10: The default branch and `develop` both hold a copy: the panel names the branch that also has a copy, rather than always saying `develop`.
- EC-11: A same-repository spec folder has no TDD evidence file: the panel shows the spec and says which parts cannot be judged, as feature 006 already does for missing evidence.
- EC-12: Many pull requests in the queue on Bitbucket: repeated reads of the same pull request in one request are combined, so the queue stays inside the platform's rate limit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every platform MUST report the pull request author and each comment author in the same form as the signed-in user's handle.
- **FR-002**: The tool MUST decide "this is my pull request" and "this is my comment" only by comparing handles, never display names or numeric ids.
- **FR-003**: On a pull request the signed-in user wrote, every review action MUST be disabled with the reason "you are the author", and the server MUST refuse such an action as forbidden.
- **FR-004**: A comment the tool posted for the signed-in user MUST be listed as editable on every platform, and its edit and delete MUST succeed.
- **FR-005**: Every comment MUST carry the thread of its first comment, on every platform, including nested replies.
- **FR-006**: Replies whose first comment was deleted MUST still be shown, under a "deleted comment" placeholder.
- **FR-007**: Before posting a line comment, every platform MUST confirm the pull request is still on the commit the lines were chosen on, and MUST refuse with a conflict if it is not.
- **FR-008**: A single-line or range comment MUST land on exactly the lines chosen, on every platform.
- **FR-009**: For a decision with a message, the decision MUST be made first and the message posted second, on every platform that sends them separately.
- **FR-010**: If the decision succeeds and its message fails, the outcome MUST report a made decision with a warning that the message was not posted, and MUST keep the message text.
- **FR-011**: A message posted with a decision MUST be recorded as posted by the tool.
- **FR-012**: Withdrawing when the reviewer has no decision MUST give the same conflict error on every platform.
- **FR-013**: The "approved by me" check MUST log each failure, MUST still report the pull requests whose check succeeded, and MUST report the check as unavailable when it fails for every pull request.
- **FR-014**: The "approved by me" behaviour MUST be shared by all platforms rather than written once per platform.
- **FR-015**: A reply to a comment on the whole pull request MUST be posted on every platform. Where the platform has no reply for such comments, the reply MUST be posted as a new comment on the pull request that quotes the original. The interface MUST NOT offer a reply that is bound to fail.
- **FR-016**: Every read a writer needs MUST go through the read-only layer.
- **FR-017**: Repeated reads of the same pull request within one request MUST be combined on Bitbucket.
- **FR-018**: Platform names MUST NOT appear outside the platform adapters.
- **FR-019**: The shared contract MUST state, in platform-neutral terms, that a commit id on a list row may be abbreviated, and the interface MUST compare commit ids accordingly.
- **FR-020**: The shared contract MUST state that on platforms which record no commit for a decision, the decision stands on the current head.
- **FR-021**: A clone MUST be recognised over `ssh.bitbucket.org`, over `ssh.github.com` on port 443, and over a self-hosted GitLab SSH host that differs from its web host.
- **FR-022**: Credentials MUST be read from `.env` for GitHub (`GITHUB_TOKEN`, then `GH_TOKEN`) and GitLab (`GITLAB_TOKEN`) when no other credential is available.
- **FR-023**: The lane label "Approved by you, waiting to merge" MUST be allowed as a label of the reviewer's own approval (constitution II.2), alongside the existing own-approval labels. Every other interface string stays banned from saying ready, safe or approved.
- **FR-024**: The Markdown preview MUST be the only named exemption to the no-HTML-injection rule, and a test MUST prove its sanitising strips scripts, event handlers and `javascript:` links. Every other UI file stays under the ban.
- **FR-025**: The stored view state allowlist MUST include the collapsed lanes setting.
- **FR-026**: The unused panel components that no longer type-check MUST be removed.
- **FR-027**: The type check and the full test suite MUST pass with no failures.
- **FR-028**: The shared contract suites MUST cover every behaviour in FR-001 to FR-015 for all three platforms, with expectations given as data and no branching on platform.
- **FR-029**: The signed-in user in the review-action test data MUST differ from the pull request author on every platform.
- **FR-030**: The review-action test data for every platform MUST be recorded from real accounts in a dedicated test workspace (for GitLab, the local instance), with a second account as the pull request author, and with secrets and account details scrubbed.
- **FR-031**: The writer contract MUST run live against the local GitLab instance.
- **FR-032**: When the branch carries no tracker key, spec context MUST find the spec folder whose name equals the branch name, or the branch name's last segment after `/`, ignoring case. A tracker key, when present, still matches as feature 006 describes.
- **FR-033**: Spec context MUST search the repository's default branch, plus `develop` when it exists, alongside the matching branches.
- **FR-034**: A repository that is not inside an enclosing project repository MUST NOT produce a gap, warning or note about it.
- **FR-035**: Spec context MUST keep finding specs in an enclosing project repository by tracker key, as feature 006 describes.
- **FR-036**: The spec context tests MUST cover the same-repository case, with no tracker key and a default branch other than `develop`.

### Key Entities

- **Identity**: Who someone is on a platform, in one comparable form: the handle. The signed-in user, each pull request author and each comment author carry one. Identity is audit data only.
- **Comment thread**: A first comment and all its replies at any depth. It belongs to the first comment, even when that comment is deleted.
- **Line anchor**: The file, line range and commit a line comment was written against.
- **Decision outcome**: The result of approving or requesting changes. It says whether the decision was made and, separately, whether its message was posted.
- **Write record**: The existing append-only record of each write the tool made. It now also covers a message posted with a decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On all three platforms, 100% of attempts to review one's own pull request are refused, including when display name and handle differ.
- **SC-002**: On all three platforms, 100% of comments the tool posted offer Edit and Delete, and 0% of other comments do.
- **SC-003**: A conversation of any depth shows as exactly one thread on every platform.
- **SC-004**: 0 line comments are posted against a commit that is no longer the pull request's head.
- **SC-005**: In every case where the decision succeeds and the message fails, the reviewer is told both facts, and nothing posted is left unrecorded.
- **SC-006**: Each edge case in User Story 6 gives the same outcome on all three platforms.
- **SC-007**: The type check reports 0 errors and the test suite reports 0 failures.
- **SC-008**: Every behaviour in FR-001 to FR-015 has a contract test that runs for all three platforms.
- **SC-009**: 100% of review-action test data is recorded from real accounts, and none of it contains a secret.
- **SC-010**: Opening the review queue on Bitbucket reads each pull request at most once per request.
- **SC-011**: For a pull request whose spec is in its own repository, the overview shows the spec summary with no tracker key in the branch and no enclosing repository.

## Assumptions

- Withdrawing with nothing to withdraw gives a conflict error on every platform, as the handover proposes.
- Abbreviated commit ids on list rows are documented in the contract, rather than fetched in full at one extra call per pull request.
- The orphaned panel components are deleted rather than restored. Nothing imports them.
- The two-location result from the clone matcher is correct, and the contract test's expectation is updated to match.
- The test workspace and second account exist before the recording tasks start. Recording comes last, so everything else is built and tested first.
- GitLab request-changes stays unavailable with its version reason, as in feature 005.
- The small Bitbucket clean-ups the review noted (a misplaced method reference, an unused request body) are done along the way and carry no requirement of their own.

## Out of Scope

- New review actions: suggestions, resolving threads, batched or pending reviews.
- GitLab request-changes.
- Bitbucket Data Center and Server.
- Detecting stale decisions on Bitbucket and GitLab.
- Merging, declining or closing a pull request (constitution II.1).

## Verbatim Constraints

- Error codes: `forbidden` (reviewing your own pull request), `conflict` (new commits; nothing to withdraw), `unavailable` (every "approved by me" check failed).
- SSH hosts: `ssh.bitbucket.org`, `ssh.github.com` (port 443).
- Environment variables: `GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN`.
- Verification commands: `npm run typecheck`, `npm test`, `node --test test/contract/*.contract.test.ts`, `npm run gitlab:up && npm run test:gitlab`.
