# Behaviour Checklist: 007-review-actions-parity

**Specification**: [review-actions-parity.spec.md](../review-actions-parity.spec.md) | **Verification Plan**: [plan.md](../plan.md#verification-plan) | **Tasks**: [tasks.md](../tasks.md)

## US1-AS1

> **Given** I am signed in and my display name differs from my handle, **When** I open a pull request I wrote on any of the three platforms, **Then** every review action is disabled and the reason shown is that I am the author.

- **BI-001** Expresses: FR-001, FR-002, FR-003, US1-AS1, SC-001. Verified by: VO-002, VO-003, VO-004.
  - **Given** I am signed in and my display name differs from my handle, on each of the three platforms
  - **When** I open a pull request I wrote
  - **Then** every review action is disabled
  - **And** the reason shown is that I am the author
  - **And** the match is made on handles alone, never on display names or numeric ids

## US1-AS2

> **Given** a pull request I wrote, **When** a review action reaches the server anyway, **Then** it is refused as forbidden and nothing is sent to the platform.

- **BI-002** Expresses: FR-003, US1-AS2. Verified by: VO-004.
  - **Given** a pull request I wrote
  - **When** a review action reaches the server anyway
  - **Then** it is refused as `forbidden`
  - **And** nothing is sent to the platform and no write is recorded

## US1-AS3

> **Given** a pull request someone else wrote, **When** I open it, **Then** the review actions are available as before.

- **BI-003** Expresses: FR-002, US1-AS3. Verified by: VO-004.
  - **Given** a pull request someone else wrote
  - **When** I open it
  - **Then** the review actions are available as before

## US2-AS1

> **Given** a comment the tool posted for me, **When** the pull request's comments are listed on any platform, **Then** that comment is marked as mine and offers Edit and Delete.

- **BI-004** Expresses: FR-001, FR-004, US2-AS1, SC-002. Verified by: VO-001, VO-005, VO-034.
  - **Given** a comment the tool posted for me
  - **When** the pull request's comments are listed on any of the three platforms
  - **Then** that comment carries my handle and is marked as mine
  - **And** it offers Edit and Delete

## US2-AS2

> **Given** that comment, **When** I edit it and then delete it, **Then** both succeed and the change shows on the platform.

- **BI-005** Expresses: FR-004, US2-AS2. Verified by: VO-016.
  - **Given** that comment
  - **When** I edit it and then delete it
  - **Then** both succeed
  - **And** the edit and the delete reach exactly that comment on the platform

## US2-AS3

> **Given** a comment someone else wrote, or one I wrote outside the tool, **When** comments are listed, **Then** it offers neither Edit nor Delete.

- **BI-006** Expresses: FR-002, FR-004, US2-AS3, SC-002. Verified by: VO-005, VO-034.
  - **Given** a comment someone else wrote, or one I wrote outside the tool
  - **When** comments are listed
  - **Then** it offers neither Edit nor Delete

## US3-AS1

> **Given** a Bitbucket conversation three levels deep, **When** it is shown, **Then** every comment appears in one thread that belongs to the first comment.

- **BI-007** Expresses: FR-005, US3-AS1, SC-003. Verified by: VO-012, VO-033.
  - **Given** a Bitbucket conversation three levels deep
  - **When** it is shown
  - **Then** every comment appears in one thread that belongs to the first comment

## US3-AS2

> **Given** a conversation whose first comment was deleted, **When** it is shown, **Then** the replies appear under a "deleted comment" placeholder.

- **BI-008** Expresses: FR-006, US3-AS2. Verified by: VO-013, VO-033, VO-034.
  - **Given** a conversation whose first comment was deleted
  - **When** it is shown
  - **Then** the replies appear in one thread under a "deleted comment" placeholder
  - **And** on a platform that keeps no trace of the deleted first comment, the next comment starts the thread and the replies still appear in one thread

## US3-AS3

> **Given** a reply to a nested comment, **When** I post it, **Then** it appears in the same thread.

- **BI-009** Expresses: FR-005, US3-AS3. Verified by: VO-017.
  - **Given** a reply to a nested comment
  - **When** I post it
  - **Then** it is posted into the thread of the first comment and appears in the same thread

## US4-AS1

> **Given** I chose lines on one commit, **When** the pull request has moved to a newer commit and I post, **Then** the comment is refused as a conflict with a "new commits" message and nothing is posted.

- **BI-010** Expresses: FR-007, US4-AS1, SC-004. Verified by: VO-018.
  - **Given** I chose lines on one commit, on any of the three platforms
  - **When** the pull request has moved to a newer commit and I post
  - **Then** the comment is refused as a `conflict` with a "new commits" message
  - **And** nothing is posted, even where an older version of the pull request still matches the commit

## US4-AS2

> **Given** the pull request has not moved, **When** I post a single-line or a range comment, **Then** it lands on exactly the lines I chose.

- **BI-011** Expresses: FR-008, US4-AS2. Verified by: VO-019.
  - **Given** the pull request has not moved
  - **When** I post a single-line or a range comment
  - **Then** it lands on exactly the lines I chose

## US5-AS1

> **Given** the decision succeeds and the message fails, **When** the outcome is shown, **Then** it says the decision was made and the message was not posted, and the message text stays in the box.

- **BI-012** Expresses: FR-010, US5-AS1, SC-005. Verified by: VO-006, VO-008, VO-022, VO-035.
  - **Given** the decision succeeds and the message fails
  - **When** the outcome is shown
  - **Then** it says the decision was made and the message was not posted
  - **And** the message text stays in the box
  - **And** the decision is recorded and no comment is recorded for the unposted message

## US5-AS2

> **Given** both succeed, **When** I later view the message, **Then** it is recorded as posted by the tool and offers Edit and Delete.

- **BI-013** Expresses: FR-011, US5-AS2. Verified by: VO-007.
  - **Given** both succeed
  - **When** I later view the message
  - **Then** it is recorded as posted by the tool
  - **And** it offers Edit and Delete

## US5-AS3

> **Given** the decision itself fails, **When** the outcome is shown, **Then** no message is posted.

- **BI-014** Expresses: FR-009, US5-AS3. Verified by: VO-021.
  - **Given** the decision itself fails
  - **When** the outcome is shown
  - **Then** no message is posted

## US6-AS1

> **Given** I have no decision on a pull request, **When** I withdraw, **Then** every platform gives the same "nothing to withdraw" error.

- **BI-015** Expresses: FR-012, US6-AS1. Verified by: VO-009, VO-024.
  - **Given** I have no decision on a pull request
  - **When** I withdraw
  - **Then** every platform gives the same `conflict` error for nothing to withdraw
  - **And** nothing is sent to the platform

## US6-AS2

> **Given** the check for "approved by me" fails for every pull request in my queue, **When** the queue loads, **Then** it reports that the check failed, not that nothing is approved.

- **BI-016** Expresses: FR-013, US6-AS2. Verified by: VO-014.
  - **Given** the check for "approved by me" fails for every pull request in my queue
  - **When** the queue loads
  - **Then** it reports that the check failed, not that nothing is approved

## US6-AS3

> **Given** that check fails for one pull request only, **When** the queue loads, **Then** the other pull requests still show their status and the failure is logged.

- **BI-017** Expresses: FR-013, FR-014, US6-AS3. Verified by: VO-014, VO-030.
  - **Given** that check fails for one pull request only
  - **When** the queue loads
  - **Then** the other pull requests still show their status
  - **And** the failure is logged with the pull request number and the error
  - **And** the same behaviour holds on all three platforms

## US6-AS4

> **Given** a comment on the whole pull request, **When** I reply on GitHub, **Then** the reply is posted, as it already is on Bitbucket and GitLab. The tool never offers a reply that is bound to fail.

- **BI-018** Expresses: FR-015, US6-AS4. Verified by: VO-010, VO-025.
  - **Given** a comment on the whole pull request
  - **When** I reply on GitHub
  - **Then** the reply is posted as a new comment on the pull request that quotes the original, then gives the reply
  - **And** Reply is offered on every platform, so the tool never offers a reply that is bound to fail

## US7-AS1

> **Given** the finished feature, **When** I run the type check and the test suite, **Then** both pass with no failures.

- **BI-019** Expresses: FR-027, US7-AS1, SC-007. Verified by: exemption FR-027, exemption US7-AS1.
  - **Given** the finished feature
  - **When** I run the type check and the test suite
  - **Then** both pass with no failures

## US7-AS2

> **Given** the shared contract suites, **When** they run for each platform, **Then** they cover the author guard, comment ownership, nested and orphaned replies, single-line and range anchors, the new-commits refusal, a decision whose message fails, withdrawing with nothing to withdraw, a reply to a whole-pull-request comment, and an "approved by me" check that fails everywhere.

- **BI-020** Expresses: FR-028, US7-AS2, SC-008. Verified by: exemption FR-028, exemption US7-AS2.
  - **Given** the shared contract suites
  - **When** they run for each platform
  - **Then** they cover the author guard, comment ownership, nested and orphaned replies, single-line and range anchors, the new-commits refusal, a decision whose message fails, withdrawing with nothing to withdraw, a reply to a whole-pull-request comment, and an "approved by me" check that fails everywhere
  - **And** their expectations are given as data with no branching on platform

## US7-AS3

> **Given** the local GitLab instance, **When** the live tests run, **Then** they exercise review actions, not only reads.

- **BI-021** Expresses: FR-031, US7-AS3. Verified by: VO-048.
  - **Given** the local GitLab instance
  - **When** the live tests run
  - **Then** they exercise review actions, not only reads

## US7-AS4

> **Given** the recorded responses, **When** I read their notes, **Then** each says which real account recorded it, and the signed-in user differs from the pull request author.

- **BI-022** Expresses: FR-029, FR-030, US7-AS4, SC-009. Verified by: VO-011, MV-001, exemption FR-030.
  - **Given** the recorded responses
  - **When** I read their notes
  - **Then** each says which real account recorded it
  - **And** the signed-in user differs from the pull request author
  - **And** no secret or real account detail appears in them

## US8-AS1

> **Given** a GitHub clone over `ssh.github.com` on port 443, **When** I open the workbench, **Then** its repository is recognised.

- **BI-023** Expresses: FR-021, US8-AS1. Verified by: VO-015.
  - **Given** a GitHub clone over `ssh.github.com` on port 443
  - **When** I open the workbench
  - **Then** its repository is recognised

## US8-AS2

> **Given** a self-hosted GitLab whose SSH host differs from its web host, **When** I open the workbench, **Then** its repository is recognised.

- **BI-024** Expresses: FR-021, US8-AS2. Verified by: VO-015, VO-031.
  - **Given** a self-hosted GitLab whose SSH host differs from its web host, and that SSH host set in the workspace settings
  - **When** I open the workbench
  - **Then** its repository is recognised
  - **And** a clone on any other host with a matching path is not claimed

## US9-AS1

> **Given** `.env` holds `GITHUB_TOKEN` or `GH_TOKEN`, **When** no other GitHub credential is available, **Then** the tool signs in to GitHub with it.

- **BI-025** Expresses: FR-022, US9-AS1. Verified by: VO-044.
  - **Given** `.env` holds `GITHUB_TOKEN` or `GH_TOKEN`
  - **When** no other GitHub credential is available
  - **Then** the tool signs in to GitHub with it, preferring `GITHUB_TOKEN`

## US9-AS2

> **Given** `.env` holds `GITLAB_TOKEN`, **When** no other GitLab credential is available, **Then** the tool signs in to GitLab with it.

- **BI-026** Expresses: FR-022, US9-AS2. Verified by: VO-044.
  - **Given** `.env` holds `GITLAB_TOKEN`
  - **When** no other GitLab credential is available
  - **Then** the tool signs in to GitLab with it

## US10-AS1

> **Given** a pull request whose spec folder is in its own repository and whose branch carries no tracker key, **When** I open the overview, **Then** the panel shows the spec's summary and where it was read from.

- **BI-027** Expresses: FR-032, FR-036, US10-AS1, SC-011. Verified by: VO-036, VO-041.
  - **Given** a pull request whose spec folder is in its own repository and whose branch carries no tracker key
  - **When** I open the overview
  - **Then** the panel shows the spec's summary and where it was read from
  - **And** the folder was matched by the branch name, or its last segment after a slash, ignoring case

## US10-AS2

> **Given** a repository whose default branch is not `develop`, **When** the spec exists only on the default branch, **Then** it is found there.

- **BI-028** Expresses: FR-033, US10-AS2. Verified by: VO-037, VO-038, VO-040.
  - **Given** a repository whose default branch is not `develop`
  - **When** the spec exists only on the default branch
  - **Then** it is found there

## US10-AS3

> **Given** a repository that is not inside another known clone, **When** the overview opens, **Then** no gap or warning is shown for that.

- **BI-029** Expresses: FR-034, US10-AS3. Verified by: VO-043.
  - **Given** a repository that is not inside another known clone
  - **When** the overview opens
  - **Then** no gap or warning is shown for that

## US10-AS4

> **Given** a pull request in a repository inside an enclosing project repository, with a tracker key, **When** the overview opens, **Then** the spec is found exactly as feature 006 describes.

- **BI-030** Expresses: FR-035, US10-AS4. Verified by: VO-042.
  - **Given** a pull request in a repository inside an enclosing project repository, with a tracker key
  - **When** the overview opens
  - **Then** the spec is found exactly as feature 006 describes

## Other behaviours

- **BI-031** Expresses: FR-003, EC-02. Verified by: VO-003.
  - **Given** the pull request author's account has been deleted
  - **When** I open the pull request
  - **Then** the review actions stay available
- **BI-032** Expresses: FR-004, EC-01. Verified by: VO-016.
  - **Given** my handle changed between listing comments and editing one
  - **When** the platform refuses the edit
  - **Then** the refusal is reported as `forbidden`
- **BI-033** Expresses: FR-006, EC-03. Verified by: VO-013, VO-033.
  - **Given** both the first comment and a middle reply in a thread are deleted
  - **When** the thread is shown
  - **Then** the remaining replies stay in one thread under one placeholder
- **BI-034** Expresses: FR-019, EC-04. Verified by: VO-020, VO-047.
  - **Given** the pull request list shows an abbreviated commit id
  - **When** I post a line comment, or the queue checks for new commits
  - **Then** commit ids are compared in full, so the abbreviation causes no refusal and no new-commits notice
- **BI-035** Expresses: FR-012, EC-05. Verified by: VO-024.
  - **Given** a decision was just withdrawn
  - **When** I withdraw again
  - **Then** the second withdraw gives the `conflict` error for nothing to withdraw
- **BI-036** Expresses: FR-009, EC-06. Verified by: VO-023, VO-035.
  - **Given** a decision with an empty message
  - **When** the decision is made
  - **Then** no message is posted
  - **And** no warning is shown
- **BI-037** Expresses: FR-009, FR-010. Verified by: VO-022.
  - **Given** a decision with a message, on a platform that sends them separately
  - **When** the decision is made
  - **Then** the decision is made first and the message posted second
  - **And** a message failure is reported with the made decision rather than as a failed decision
- **BI-038** Expresses: FR-016. Verified by: VO-026, VO-028.
  - **Given** a review action that needs a read from the platform
  - **When** the action runs
  - **Then** every read goes through the read-only layer
- **BI-039** Expresses: FR-017, SC-010, EC-12. Verified by: VO-027, VO-029, VO-032.
  - **Given** many pull requests in the queue on Bitbucket
  - **When** the queue opens
  - **Then** each pull request is read at most once in that request
  - **And** any write clears what was read, so a read after a write is fresh
- **BI-040** Expresses: FR-018. Verified by: VO-046.
  - **Given** the source outside the platform adapters
  - **When** it is scanned
  - **Then** no platform name appears in it
- **BI-041** Expresses: FR-020, EC-07. Verified by: exemption FR-020.
  - **Given** a platform that records no commit for a decision
  - **When** a decision is made after new commits
  - **Then** the decision stands on the current head, as the shared contract states
- **BI-042** Expresses: FR-023. Verified by: exemption FR-023.
  - **Given** the lane label "Approved by you, waiting to merge"
  - **When** the interface strings are checked
  - **Then** it is allowed as a label of my own approval
  - **And** every other string stays banned from saying ready, safe or approved
- **BI-043** Expresses: FR-024. Verified by: exemption FR-024.
  - **Given** Markdown with a script, an event handler and a `javascript:` link
  - **When** the preview shows it
  - **Then** all three are stripped
  - **And** no other part of the interface is allowed to inject HTML
- **BI-044** Expresses: FR-025. Verified by: exemption FR-025.
  - **Given** I collapsed some lanes
  - **When** the view state is stored
  - **Then** the collapsed lanes setting is among the allowed stored settings
- **BI-045** Expresses: FR-026. Verified by: exemption FR-026.
  - **Given** the unused panel components
  - **When** the feature is finished
  - **Then** they are gone and the type check passes
- **BI-046** Expresses: FR-022. Verified by: VO-045.
  - **Given** a GitHub or GitLab token read from `.env`
  - **When** the tool signs in with it
  - **Then** the token never reaches the config, the logs, the review store, an API response, browser storage, an AI prompt or a fixture
- **BI-047** Expresses: FR-033. Verified by: VO-039.
  - **Given** a clone of the pull request's repository
  - **When** spec context lists the remote branches and the default branch
  - **Then** the developer's branch, working copy and stash are unchanged
- **BI-048** Expresses: FR-033, EC-10. Verified by: VO-040.
  - **Given** the default branch and `develop` both hold a copy
  - **When** the panel shows the spec
  - **Then** it names the branch that also has a copy, rather than always saying `develop`
- **BI-049** Expresses: FR-032, EC-09. Verified by: VO-036.
  - **Given** a branch named `feature/007-review-actions-parity` and one named `007-review`
  - **When** spec folders are matched
  - **Then** the first matches `specs/007-review-actions-parity`
  - **And** the second does not, because the name must match whole
- **BI-050** Expresses: FR-035, EC-08. Verified by: VO-042.
  - **Given** a spec folder in both the pull request's own repository and the enclosing project repository
  - **When** the spec is chosen
  - **Then** the own repository wins
