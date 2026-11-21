# Implementation Plan: Review Actions Platform Parity

**Spec**: `review-actions-parity.spec.md` | **Size**: oversized | **Research**: `research.md` | **Design**: `data-model.md`, `contracts/`

**Scale note**: This change touches about 40 files in six areas: the neutral contracts, three platform adapters and their shared helpers, core review actions and spec context, the server's request scope, the UI, and the test suites with their fixtures. Watch the two safety rules first (the author guard and comment ownership), because their bugs sit in identity fields that every platform fills differently. Keep the read layer read-only (VIII.3) when you add the request memo, and record the hosted fixtures only by a person clicking in the real UI (II.4, XI.4).

## Summary

Every review action behaves the same way on Bitbucket Cloud, GitHub and GitLab. Identity becomes a handle on every author field. Core compares handles in one helper, ignoring case, and an empty handle never matches. Threads carry a "starts thread" flag, so the UI can show a "deleted comment" placeholder on any platform. Each writer checks the head itself before a line comment, makes a decision before posting its message, and reports a failed message as a warning on a made decision. Core records that message as posted by the tool. Withdrawing with nothing to withdraw is `conflict` everywhere. One shared helper in `src/adapters/` runs "approved by me" for all three platforms.

Two smaller strands ride along. Spec context also finds a spec in the pull request's own repository by branch name, on the default branch or `develop`. The clone matcher, `.env` credentials and the six failing tests plus the type check are fixed. Repeated reads are combined by a request-scoped GET memo in the read layer, built on Node's `AsyncLocalStorage` and cleared by any write. No new dependencies.

## Project Structure

```text
src/contracts/
  source-control.ts            PullRequestInfo.authorHandle; headCommit and approvedByMe docs (FR-019)
  source-control-writer.ts     Comment.author.handle, Comment.startsThread; decision outcome .message; withdraw/decision-commit docs (FR-012, FR-020)
  http.ts                      ReviewActionResult.warning; neutral headCommit note; drop 'no-enclosing-repository' gap
src/adapters/
  approved-by-me.ts            NEW  shared "approved by me" over a per-PR check (FR-013, FR-014)
  request-memo.ts              NEW  request scope + GET memo, cleared on write (FR-017)
  read-only-http.ts            serve GETs through the memo
  write-http.ts                clear the memo after every write
  env-credentials.ts           GitHub and GitLab bearer tokens (FR-022)
  registry.ts                  SourceControlSettings.sshHost
  bitbucket/source-control.ts  authorHandle, root threads, drop deleted comments, approvedByMe via helper, `this` fix
  bitbucket/source-control-writer.ts   head check, decision then message, no approve body
  github/source-control.ts     authorHandle, comment handle, ssh.github.com, approvedByMe via helper
  github/source-control-writer.ts      head check, quoting reply for whole-PR comments, withdraw → conflict via reads.myDecision
  gitlab/source-control.ts     comment handle = username, startsThread, sshHost, approvedByMe via helper
  gitlab/source-control-writer.ts      versions through read layer, newest version only, decision then message, withdraw → conflict
src/core/
  review-actions.ts            sameHandle helper in all five places; message write record; warning on result
  spec-context.ts              branch-name terms, default branch + develop, no enclosing gap
  spec-match.ts                term matcher replaces key-only matching
src/repo/
  git.ts, manager.ts           ls-remote also reports the default branch
src/config.ts                  optional workspace.sshHost
src/server/http.ts             open one request scope per request
src/server/routes/context.ts   pass workspace.sshHost into SourceControlSettings
src/ui/
  state/use-review-comments.ts threads with no starting comment get a placeholder
  state/use-review-decision.ts keep the message text and expose the warning
  components/comment-thread.tsx, components/decision-panel.tsx, components/spec-context.tsx
  labels.ts                    deletedComment, messageNotPosted, rule labels; neutral comment; drop gapNotInProject
  state/review-queue.ts, screens/home.tsx   neutral comments
  components/panel-host.tsx, components/evidence-panel.tsx   DELETE
test/
  contract/*.suite.ts, *.contract.test.ts    new scenarios and expectations as data
  fixtures/{bitbucket,github,gitlab}/review-actions/   re-authored now, recorded last
  helpers/recorded-fetch.ts    account aliases on recording
  record/capture.ts            NEW  `node --import` preload that wraps the global fetch in recordingFetch; outside every test glob
  record/README.md             NEW  the click script a person follows to record each review action
  gitlab/                      seeder gives a second author and a write-scoped reviewer; live writer contract
  unit/ui-safety.test.ts, ui-view-state.test.ts, spec-match.test.ts, review-actions.test.ts
  unit/ui-review-comments.test.ts, env-credentials.test.ts, request-memo.test.ts, approved-by-me.test.ts   NEW
  end-to-end/spec-context.test.ts   same-repository case
docs/domain_knowledge/CONTEXT.md, docs/domain_knowledge/adr/0003-*.md   corrected wording
```

**Structure Decision**: Platform differences stay inside each adapter. Behaviour that would otherwise be written three times ("approved by me", the request memo) moves to shared modules in `src/adapters/`. Core gains only the neutral handle comparison and the message write record.

## Call paths

- **Line comment**: UI `postReviewAction` → server route → `review-actions.ts run()` (open check, `expectedHead` check, `currentUser`, `sameHandle` author guard, capability, anchor check) → writer `postLineComment` → `reads.getPullRequest` through the read layer (memo hit from core's read) → `conflict` if head ≠ `anchor.commit` → write POST → memo cleared.
- **Decision with a message**: `run()` → writer `approve` / `requestChanges` → decision POST → message POST → outcome `{ decision, message: { posted, commentId | reason } }` → core writes the decision record, then a `comment` record under `<requestId>:message` when posted → result carries `warning` when not posted → decision panel keeps the text.
- **Queue**: `sessions.ts` → adapter `approvedByMe` → `approvedAcross(platform, numbers, one)` → each `one(n)` reads its PR once (memo) → `unavailable` when every check failed → existing `approvalsNote`.
- **Spec lookup**: `spec-context.ts search()` → terms (tracker keys, else branch name and last segment) → `listRemoteHeads` returns heads and the default branch → consider default, `develop`, matching branches → term matcher over folder paths → `chooseCopy(matcher, candidates)`.

## Screens

- **Comment thread**: a thread with no starting comment shows a muted "Deleted comment" row in the root's place, then its replies. Reply is offered on whole-pull-request threads on every platform.
- **Decision panel**: after a decision whose message failed, an `ActionNotice` warning says the decision was made and the message was not posted. The message box keeps its text.
- **Own pull request**: every action shows the existing disabled reason, now on Bitbucket too.
- **Specification panel**: other copies read "`<branch>` also has a copy". The "not inside a project repository" gap is gone. The rule reads "matching branch over base branch".

## Constitution Check

| Rule | Assessment |
|---|---|
| I evidence before opinion | PASS. No AI claims are added. |
| II.1 writes limited to reviewer actions | PASS. No new endpoint kinds. The GitHub quoting reply uses the already-allowlisted whole-PR comment POST. |
| II.2 own approval labelled as the reviewer's | PASS. "Approved by you, waiting to merge" names the reviewer's own approval and joins the allowed list (FR-023). |
| II.4 one click, head check, recorded | PASS. Writers now check the head themselves too. The decision's message gets its own posted write record (FR-011). Where a platform records no commit on a decision (FR-020), the decision is tied to the viewed commit by the server's `expectedHead` refusal and the commit stored on its write record, as in feature 005. |
| III.2 append-only | PASS. The message record is a new intent with its own rows; no update. |
| IV explainability | PASS. Spec rule labels stay shown, with neutral wording. |
| V.1 / V.4 gaps | PASS. "Approved by me" failing everywhere stays a visible note. Removing the enclosing-repository gap is right: the same-repo case is normal, not missing context (FR-034). |
| VI incremental integration | PASS. Uses `AsyncLocalStorage` from Node's standard library. |
| VII.1 / VII.2 identity for audit only | PASS. Handles are compared, logged in the action log and stored as `actor`. Never aggregated. Recordings alias real accounts. |
| VIII.1 / VIII.2 neutrality | PASS. Four platform names leave UI and contract comments (FR-018). The `sshHost` setting and handle field are neutral. |
| VIII.3 read contract read-only, separate writer | PASS. The memo only caches GETs and lives in the read layer. The write layer may clear it but cannot read through it. Writer reads go through `createReadOnlyFetch` (FR-016). |
| IX repository safety | PASS. `ls-remote` gains `--symref` and `HEAD`: still a network read that writes nothing. The repo-safety test covers it. |
| X.7 / X.8 credentials | PASS. `.env` stays the existing keychain-less fallback inside the credential module: `main.ts` wraps the keyring as `withEnvFallback(realKeyring, envCredential)`, so GitHub and GitLab tokens are still read only through the credential store, as X.7 requires for GitLab. The credential leak tests cover the new tokens (X.8). Recordings scrub secrets and alias accounts. |
| X.11 writer allowlist | PASS. GitLab `unapprove` stays, guarded by a decision read. No allowlist widening. |
| XI.1 test-first | PASS. The Verification Plan below gives every requirement and acceptance scenario an obligation or an exemption; `tests/behaviour-checklist.md` holds the behaviour items; every task carries its obligation label, test task first. `tdd_check.py plan` and `tasks` pass. |
| XI.2 one contract suite per contract | PASS. New scenarios take expectations as data. GitLab's "no trace of a deleted first note" is an expectation value, not a branch. |
| XI.4 / XI.5 no automated writes to hosted platforms | PASS. Hosted fixtures are recorded by a person using the real app: every write starts with their click in the UI (II.4), so no test and no script writes to a hosted platform. `test/record/capture.ts` is a `node --import` preload under `test/`, outside `npm test`, `test:live` and `test:gitlab`. It only wraps the global `fetch` in `recordingFetch`, so no recording code enters the product. It refuses to start without `PRWB_RECORD_FIXTURES` and the alias variables. Pull request setup on the hosted test workspace is done by hand. Live writer tests run only against the local GitLab instance. |
| P.4 cross-platform | PASS. Argument arrays only. |
| Q.1 dependencies | PASS. None added. |

Re-checked after Phase 1 design: no violations. Recording was first planned as a script driving the writer adapters, which broke XI.4 and II.4. It now happens through the UI (decided 2026-11-14, after analysis).

## Delivery order

1. Contract fields and docs, core `sameHandle`, unit tests with distinct id, name and handle.
2. Bitbucket fixes: threads, head check, decision then message, request memo, clean-ups.
3. GitHub and GitLab parity: handles, withdraw, quoting reply, newest-version check, read-through, shared "approved by me".
4. Spec context same-repository case.
5. Clone hosts, `.env`, UI fixes, deletions, docs. The suite and type check go green.
6. Live GitLab writer contract.
7. Recording through the UI with the capture preload: GitLab from the local instance, then Bitbucket and GitHub from the dedicated workspace. This needs the test workspace and second account in place.

## Verification Plan

Added after analysis on 2026-11-14 to bring the feature under the integrated-tdd process (constitution XI.1). Edge cases are cited by the `EC-nn` labels added to the spec's Edge Cases.

### Verification commands

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| unit | `node --test {select}` | focused | `package.json` script `test` runs `node --test "test/**/*.test.ts"`; the selector narrows it to one test file, contract files included |
| typecheck | `npm run typecheck` | focused | `package.json` script `typecheck` |
| test-all | `npm test` | broad | `package.json` script `test` |
| build-ui | `npm run build:ui` | focused | `package.json` script `build:ui` (the UI tests need it first) |
| test-ui | `npm run test:ui` | broad | `package.json` script `test:ui` |
| test-gitlab | `npm run test:gitlab` | broad | `package.json` script `test:gitlab` (needs `npm run gitlab:up`) |

### Verification obligations

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | FR-001, US2-AS1 | Each platform lists a pull request and its comments where every person's display name, numeric id and handle differ | The pull request author and each comment author carry a handle in the same form as the signed-in user's handle | contract | planned |
| VO-002 | FR-002 | Ownership is checked for a user whose display name equals another user's handle, whose handles differ only in case, and with an empty handle | Ownership holds only when both handles are non-empty and equal ignoring case; display names and numeric ids never decide it | unit | planned |
| VO-003 | FR-003, EC-02 | Review capabilities are built for the author's own pull request, and for one whose author account was deleted | Own pull request: every action disabled with the reason "you are the author". Deleted author: every action available | unit | planned |
| VO-004 | FR-003, US1-AS1, US1-AS2, US1-AS3, SC-001 | On each platform's identity data, the decision state is read and a review action is posted for an own pull request, and the decision state is read for someone else's | Own: every action disabled with the author reason, and a posted action is refused `forbidden` with no platform request and no write record. Someone else's: actions available | integration | planned |
| VO-005 | FR-004, US2-AS1, US2-AS3, SC-002 | Comments are listed after the tool posted one for the signed-in user, alongside one by someone else and one the user wrote outside the tool | Only the tool-posted comment is marked as the user's and editable | unit | planned |
| VO-006 | FR-010, US5-AS1, SC-005 | A decision is made and its message fails | The result carries the decision and a warning that the message was not posted; the decision is recorded; no comment record is written | unit | planned |
| VO-007 | FR-011, US5-AS2 | A decision and its message both succeed | The message is recorded as posted by the tool after the decision's record is final, and is later listed as editable | unit | planned |
| VO-008 | FR-010, US5-AS1 | The review-action request makes a decision whose message fails | The response succeeds, carries the made decision and a message-not-posted warning | integration | planned |
| VO-009 | FR-012, US6-AS1 | Withdraw is requested on each platform with no decision in place | The response is `conflict` and nothing is sent to the platform | integration | planned |
| VO-010 | FR-015, US6-AS4 | The decision state is read on each platform | Reply is offered on every platform, so no reply is offered that is bound to fail | integration | planned |
| VO-011 | FR-001, FR-029, US7-AS4 | Each platform's review-action test data is loaded | The signed-in user's handle differs from the pull request author's handle | contract | planned |
| VO-012 | FR-005, US3-AS1, SC-003 | Each platform lists a conversation three replies deep | Every comment carries the thread of the first comment | contract | planned |
| VO-013 | FR-006, US3-AS2, EC-03 | Each platform lists a thread whose first comment was deleted, and one whose first and middle comments were deleted | The remaining replies keep one thread with no starting comment, or, on a platform that promotes the next comment, one thread whose next comment starts it | contract | planned |
| VO-014 | FR-013, FR-014, US6-AS2, US6-AS3 | Each platform checks "approved by me" when one check fails, and when every check fails | One failure: the others are still reported. Every failure: the check is reported `unavailable` | contract | planned |
| VO-015 | FR-021, US8-AS1, US8-AS2 | Clone remotes over `ssh.bitbucket.org`, over `ssh.github.com` on port 443, over a configured self-hosted SSH host, and over an unrelated host with a matching path | The first three are recognised as their repository; the unrelated host is not | contract | planned |
| VO-016 | FR-004, US2-AS2, EC-01 | A tool-posted comment is edited then deleted on each platform, and the platform refuses an edit | Edit and delete each reach exactly that comment; a platform refusal is reported as `forbidden` | contract | planned |
| VO-017 | FR-005, US3-AS3 | A reply is posted to a nested comment | It is posted into the first comment's thread | contract | planned |
| VO-018 | FR-007, US4-AS1, SC-004 | A line comment is posted after the pull request moved to a newer commit, including where an older diff version still matches | Refused as `conflict` for new commits; nothing is posted | contract | planned |
| VO-019 | FR-008, US4-AS2 | A single-line and a range comment are posted on an unmoved pull request | Each lands on exactly the chosen lines and side | contract | planned |
| VO-020 | FR-019, EC-04 | A line comment where the pull request list shows an abbreviated head commit | The head check compares full commit ids and does not refuse | contract | planned |
| VO-021 | FR-009, US5-AS3 | The decision itself fails, with a message | The call fails and no message is sent | contract | planned |
| VO-022 | FR-009, FR-010, SC-005 | A decision with a message where the message write fails | The decision is written before the message; the call reports the made decision and the unposted message with its reason, without failing | contract | planned |
| VO-023 | EC-06 | A decision with an empty message | No message is sent and no message result is reported | contract | planned |
| VO-024 | FR-012, EC-05 | Withdraw with no decision, and withdraw twice in a row | Each refused as `conflict`; no write is sent | contract | planned |
| VO-025 | FR-015, US6-AS4 | A reply to a whole-pull-request comment on each platform | The reply is posted; where the platform has no reply for such comments, it is a new comment quoting the original, then the reply | contract | planned |
| VO-026 | FR-016 | Every writer method that needs a read | Each read goes through the read-only layer, never the write layer | contract | planned |
| VO-027 | FR-017 | Repeated reads of one address with one credential inside a request scope; the same outside a scope; a failed read; two concurrent scopes | One network read per scope, its body given to each caller; nothing cached outside a scope; a failed read retried; scopes do not share | unit | planned |
| VO-028 | FR-016, FR-017 | The read-only layer serves repeated reads inside a scope, with a different credential, and a non-read request | One network call for the repeat; a different credential is not shared; a non-read request is never kept | unit | planned |
| VO-029 | FR-017 | A write, successful and failing, inside a scope that holds reads | Every kept read is cleared; the write layer cannot read what is kept | unit | planned |
| VO-030 | FR-013, FR-014, US6-AS3 | The shared check over several pull requests with some failures, all failures, and none to check | Successes reported, each failure logged with its pull request number and error code; all failing gives `unavailable`; none gives an empty result | unit | planned |
| VO-031 | FR-021 | The workspace SSH host setting holds a bare host, a scheme, a path and a port | The bare host is accepted; the others are refused as invalid | unit | planned |
| VO-032 | FR-017, SC-010, EC-12 | The review queue opens on Bitbucket Cloud with several pull requests inside one request | Each pull request is read at most once | unit | planned |
| VO-033 | FR-006, US3-AS2, SC-003, EC-03 | Comments are grouped into threads where one thread has no starting comment and one lost both its first and a middle comment | Each conversation is one thread; a thread with no starting comment opens with one deleted-comment placeholder; replies follow in time order | unit | planned |
| VO-034 | FR-004, FR-006, FR-015, US3-AS2 | The comments are shown in the browser with an orphaned thread, a whole-pull-request thread and comments by others | The placeholder shows first in the orphaned thread; Reply shows on the whole-pull-request thread; Edit and Delete show only on the user's tool-posted comments | end-to-end | planned |
| VO-035 | FR-010, US5-AS1, EC-06 | In the browser, a decision is made whose message failed, then one with an empty message | The panel says the decision was made and the message was not posted, and keeps the text; the empty message shows no warning | end-to-end | planned |
| VO-036 | FR-032, US10-AS1, EC-09 | Search terms are built from branches with and without a tracker key, and matched against spec folders | Without a key the terms are the branch name and its last segment, matched whole and ignoring case; with a key, as feature 006 | unit | planned |
| VO-037 | FR-033 | The remote branch listing command is built | It asks for the branch heads and the default branch | unit | planned |
| VO-038 | FR-033 | The remote listing output is read with and without a default branch | The default branch is reported, or none when the remote names none | integration | planned |
| VO-039 | FR-033 | The new remote listing runs against a clone | The developer's branch, HEAD, index, working tree and stash are unchanged (IX) | integration | planned |
| VO-040 | FR-033, US10-AS2, EC-10 | A spec held on the default branch only, and on both the default branch and `develop` | It is found on the default branch; the other copy names the branch that holds it | integration | planned |
| VO-041 | FR-036, US10-AS1, SC-011 | The overview opens for a pull request whose spec folder is in its own repository, default branch `main`, no tracker key, no enclosing repository | The panel shows the spec's summary and where it was read from, with no gap | end-to-end | planned |
| VO-042 | FR-035, US10-AS4, EC-08 | The overview opens for a pull request inside an enclosing project repository with a tracker key, including a folder present in both repositories | The spec is found as feature 006 describes; the own repository's copy wins | end-to-end | planned |
| VO-043 | FR-034, US10-AS3 | The overview opens for a repository that is not inside another known clone | No gap, warning or note about it is shown | end-to-end | planned |
| VO-044 | FR-022, US9-AS1, US9-AS2 | Credentials are looked up from the environment with `GITHUB_TOKEN`, with only `GH_TOKEN`, with `GITLAB_TOKEN`, and with empty values | GitHub uses `GITHUB_TOKEN`, then `GH_TOKEN`; GitLab uses `GITLAB_TOKEN`; each signs in with write scope; empty values count as absent | unit | planned |
| VO-045 | FR-022 | A GitHub or GitLab token supplied from the environment is used | It never reaches the config, the logs, the review store, an API response, browser storage, an AI prompt or a fixture (X.7, X.8) | unit | planned |
| VO-046 | FR-018 | The source outside the platform adapters is scanned | No platform name appears in it | unit | planned |
| VO-047 | FR-019, EC-04 | The queue compares an abbreviated list-row head with the session's full head | A prefix match is not shown as new commits | unit | planned |
| VO-048 | FR-031, US7-AS3 | The writer contract runs live against the local GitLab instance, as a reviewer on a merge request authored by a second account | Comment, reply, edit, delete, approve, withdraw and the new-commits refusal each succeed or are refused as the shared contract states | contract | planned |

### Verification exemptions

| Requirement | Reason | Alternative verification |
|-------------|--------|--------------------------|
| FR-020 | A documentation requirement: the contract states existing behaviour (EC-07), so there is nothing new to observe | Review of the writer contract's comment (T004) |
| FR-023 | The label already exists and names the reviewer's own approval; the change corrects the safety test's allowlist, so no failing-first run can be shown | `test/unit/ui-safety.test.ts` passes with the label on the own-approval list (T056) |
| FR-024 | Sanitising exists from feature 005; the change names the preview's exemption in the safety scan and adds any missing case | `test/unit/ui-safety.test.ts` exempts only the preview, by name; `test/ui/markdown-preview.ui.ts` shows scripts, event handlers and `javascript:` links stripped (T056, T058) |
| FR-025 | The collapsed lanes setting is already stored; the change corrects the test's allowlist | `test/unit/ui-view-state.test.ts` passes (T057) |
| FR-026 | A deletion of unused files: nothing to observe | `npm run typecheck` passes and nothing imports the files (T061, T072) |
| FR-027 | A whole-suite outcome, not a behaviour | Broad checkpoint runs of `typecheck` and `test-all` (T072) |
| US7-AS1 | The same whole-suite outcome as FR-027 | Broad checkpoint runs of `typecheck` and `test-all` (T072) |
| FR-028 | A requirement on the shape of the tests themselves | Review at T072: the contract suites take expectations as data with no branching on platform, and the contract run lists each scenario for each platform |
| US7-AS2 | The same requirement on the tests as FR-028 | Review at T072, as for FR-028 |
| FR-030 | Recording from real accounts is a person's action against a hosted workspace, which no automated test may touch (XI.5) | MV-001 |

### Manual verification

| ID | Covers | Steps | Expected result | Why not automated |
|----|--------|-------|-----------------|-------------------|
| MV-001 | FR-030, SC-009, US7-AS4 | 1. Start the app with the capture preload and follow the click script against the test workspace, as the reviewer account. 2. Read each fixture folder's README. 3. Search every recorded fixture for the real account names, workspace slug and tokens. | Each README names the recording role and date; no secret, real handle, real name or workspace slug appears; the signed-in handle differs from the pull request author | Needs a person, real accounts and a hosted workspace (II.4, XI.5) |

### Behaviour checklist

The behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md). Review them against the spec with `python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py status --scenarios`.
