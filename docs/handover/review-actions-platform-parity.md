# Handover: review actions platform parity (Bitbucket, GitHub, GitLab)

**For:** `/speckit-specify` → plan → tasks → implement
**Date:** 2026-11-14
**Source:** code review of commits `eef67d3` (reviewer actions) and `538f031` (wiring), centred on the Bitbucket Cloud adapter and compared against GitHub and GitLab.
**Related:** `specs/005-review-actions/` (feature this hardens), `specs/004-risk-review-focus/` (`currentUser`), ADR 0003, constitution II.1, VII.2, VIII.1–VIII.3, X.11, XI.2, SC-007, SC-008, VO-036.

## 1. Why this feature
Feature 005 lets a reviewer comment, reply, edit, delete, approve, request changes and withdraw from the workbench on all three platforms. The Bitbucket work added new behaviour and some hardening that the other adapters lack. A review found:

- **Identity mismatches** that break two safety rules: you could review your own pull request on Bitbucket, and you could never edit your own comments on GitLab.
- **Thread and anchoring bugs** in Bitbucket.
- **Partial-failure behaviour** that differs between platforms.
- **Read-only and naming rules** broken in places.
- **6 failing tests and a failing typecheck.**
- **No review-action fixture has ever been recorded from a real platform.**

The product targets Bitbucket Cloud and Jira; development runs on GitHub (see memory: *Dev on GitHub, target Bitbucket/Jira*). Bitbucket correctness is the priority, and the neutral contract must keep all three platforms behaving the same way.

## 2. Outcome wanted
A reviewer gets the same, correct behaviour on Bitbucket Cloud, GitHub and GitLab for every review action:

- The tool always knows which pull requests and comments are theirs.
- Threads render as threads.
- A comment never lands on the wrong lines.
- A partly failed action is reported honestly.
- The test suite proves all of this against recorded platform responses.

## 3. User stories (proposed priorities)

**P1: I cannot review my own pull request, on any platform.**
When I open a pull request I authored, every review action is disabled and the reason is "you are the author". Today this fails on Bitbucket: the author is compared by display name against an account id.
*Acceptance:* on each platform, with a PR author whose display name differs from their handle, `decision()` reports `canReview.allowed = false` and `perform()` rejects with `forbidden`.

**P1: I can edit and delete the comments I posted from the tool, on any platform.**
Comments I posted show Edit and Delete; other people's comments don't. Today this fails on GitLab: the author is compared by display name or numeric id against the username.
*Acceptance:* on each platform, a comment I posted (recorded in `write_record`) is listed with `editable = true`, and an edit or delete succeeds.

**P1: Replies show in the right thread.**
A reply to a reply on Bitbucket appears inside the original thread. Replies to a deleted comment still show, under a "deleted comment" placeholder.
*Acceptance:* a Bitbucket comment tree three levels deep maps to a single `threadId`, the id of the root comment.

**P1: A line comment never lands on lines from a newer commit.**
If the pull request moved on after I chose the lines, the comment is refused with "new commits", on every platform.
*Acceptance:* the Bitbucket writer refuses with `conflict` when the head differs from `anchor.commit`. The writer contract suite checks this for all three platforms.

**P2: An approval or request for changes that comes with a message is never half-reported.**
The decision is made first and the message posted second. If only the message fails, I am told the decision went through but the message did not, and nothing is left orphaned.
*Acceptance:* the order and the partial-failure outcome are the same on Bitbucket and GitLab, and tested. GitHub sends both in one request.

**P2: Errors and edge cases mean the same thing on every platform.**
- Withdrawing when I have no decision gives one neutral error.
- An approval lookup that fails for every pull request is reported as a failed check, never as "nothing approved".
- Replying to a comment on the whole pull request works on GitHub, as it already does on Bitbucket and GitLab.

**P3: My clone is recognised whichever SSH host I used.**
This covers `ssh.bitbucket.org` (done), `ssh.github.com` (port 443), and a self-hosted GitLab whose SSH host differs from its web host.

**P3: I can sign in from `.env` in the devcontainer for GitHub and GitLab, as I already can for Bitbucket and Jira.**

## 4. Requirements (candidates for the spec)
- **R1.** The neutral contract carries an author identity in the same form as `currentUser().handle`, for both the pull request author and each comment author. Core compares identities only through these fields.
- **R2.** Each comment's `threadId` is the id of its thread's root on every platform, including nested replies and deleted roots.
- **R3.** Before posting, each writer confirms that a line comment's commit is the current head. If not, it rejects with `conflict`.
- **R4.** For a decision with a message: decision first, then the message. A message failure gives a successful decision outcome plus a warning. The message's comment id is recorded as posted by the tool.
- **R5.** One neutral error code for "nothing to withdraw" (proposed: `conflict`).
- **R6.** `approvedByMe` works the same on every platform: failures are logged, one failing pull request doesn't hide the others, and all of them failing gives `unavailable`. The logic is shared in `src/adapters/`.
- **R7.** Every GET a writer needs goes through the read-only layer (VIII.3). Today the GitLab writer's `versions()` does not.
- **R8.** On every platform, a reply to a comment on the whole pull request either works or is offered as a new comment. The UI never offers an action that is bound to fail.
- **R9.** Repeated reads of the same pull request within one review request are coalesced on Bitbucket, to stay inside its API-token rate limits.
- **R10.** No platform name appears outside `src/adapters/` (VO-036). Where `headCommit` on list rows may be abbreviated, the contract says so in neutral terms.
- **R11.** `.env` credential fallback covers GitHub (`GITHUB_TOKEN`/`GH_TOKEN`) and GitLab (`GITLAB_TOKEN`).
- **R12.** The review-action fixtures for every platform are recorded from real accounts, and the writer contract runs live against the local GitLab instance.

## 5. Evidence (where each problem is)
| # | Problem | Location |
|---|---|---|
| 1 | Author guard compares `info.author` (Bitbucket display_name) with `handle` (account_id) | `src/core/review-actions.ts:279`, `:358`; `src/adapters/bitbucket/source-control.ts` `toPullRequest` |
| 2 | `isAuthor` matches id or name with the handle; on GitLab the name is a display name and the id is numeric | `src/core/review-actions.ts:111`; `src/adapters/gitlab/source-control.ts` `listComments` |
| 3 | `threadId = parent.id` (immediate parent); deleted comments filtered out | `src/adapters/bitbucket/source-control.ts` `listComments` |
| 4 | Line comment posted with no head check (contract test fails) | `src/adapters/bitbucket/source-control-writer.ts` `postLineComment` |
| 5 | Message posted before the decision (Bitbucket) or after it, throwing on failure (GitLab) | `bitbucket/source-control-writer.ts` `decide`; `gitlab/source-control-writer.ts` `approve` |
| 6 | Withdraw with nothing to withdraw: `conflict` (Bitbucket), `not_found` (GitHub), platform 404 (GitLab) | the three `source-control-writer.ts` files |
| 7 | GitHub reply to an issue comment → `pulls/comments/{id}/replies` returns 404; UI offers Reply on every thread | `github/source-control-writer.ts`; `src/ui/components/comment-thread.tsx:80` |
| 8 | GitHub and GitLab `approvedByMe` swallow every failure | `github/source-control.ts`, `gitlab/source-control.ts` |
| 9 | GitLab writer reads `versions` through the raw fetch | `gitlab/source-control-writer.ts` `versions()` |
| 10 | Abbreviated Bitbucket SHAs worked around in the UI; platform named outside adapters | `src/ui/state/review-queue.ts:39` `sameCommit`; `src/contracts/http.ts:207`; `src/ui/labels.ts:104`; `src/ui/screens/home.tsx:179` |
| 11 | About 4 GETs of the same PR per `decision()` on Bitbucket, plus an extra `headOf` per comment write | `bitbucket/source-control.ts`, `bitbucket/source-control-writer.ts` |
| 12 | `this.getPullRequest` inside an object-literal method; unused `{ commit }` body sent to `/approve` | `bitbucket/source-control.ts`, `bitbucket/source-control-writer.ts` |
| 13 | `.env` credentials only for Bitbucket and Jira | `src/adapters/env-credentials.ts` |

## 6. Current test state (2026-11-14)
`npm test` result: 808 tests, 802 pass, **6 fail**:
- `test/contract/source-control.suite.ts:179`: `cloneLocations` now returns two Bitbucket locations; the suite expects exactly one.
- `test/contract/source-control-writer.suite.ts:130`: Bitbucket line comment never sends or checks the commit (finding 4).
- `test/unit/platform-names.test.ts`: "bitbucket" appears in 4 places outside `src/adapters/` (finding 10).
- `test/unit/ui-safety.test.ts` SC-008: `markdown-preview.tsx` uses `dangerouslySetInnerHTML` (the HTML is sanitised by DOMPurify).
- `test/unit/ui-safety.test.ts` SC-007: the label "Approved by you, waiting to merge" contains the word "approved", which SC-007 bans.
- `test/unit/ui-view-state.test.ts`: `collapsedLanes` is missing from the allowlist of stored keys.

`npm run typecheck` also fails. The orphaned `src/ui/components/panel-host.tsx` and `evidence-panel.tsx` (imported nowhere) refer to view state that has been removed.

**Missing coverage:**
- No fixture is recorded from a real platform: every `test/fixtures/*/review-actions/README.md` says "hand-authored". The Bitbucket README also says line ranges are unsupported, but the adapter now sends `start_to`/`start_from`.
- `test/gitlab/` (local instance) tests reads only, never the writer.
- On every platform, the fixture's signed-in user is also the PR author, so the author guard and the capability check are never exercised.
- No tests for: nested Bitbucket replies; a deleted root with replies; multi-line anchors from `start_to`/`start_from`; partial failure of a decision message; withdrawing with nothing to withdraw; a GitHub reply to an issue comment; GitHub and GitLab `approvedByMe` when every lookup fails.

## 7. Constraints
- **The read contract stays read-only.** All writes go through `SourceControlWriter` and the allowlisted write layer. Nothing merges, declines or closes (II.1, FR-012).
- **Core never branches on platform.** Adapters own the platform differences (VIII.1, VIII.2, VO-036).
- **Tests first** (XI). Behaviour shared across platforms is proved in the shared contract suites (`source-control.suite.ts`, `source-control-writer.suite.ts`), which take expectations as data and never branch on platform (XI.2).
- **Identity is audit data only** (VII.2). Secrets never appear in logs or fixtures. Recording fixtures needs real accounts, with scrubbing through `test/helpers/recorded-fetch.ts`.

## 8. Out of scope
- New review actions (suggestions, resolving threads, batched or pending reviews).
- GitLab request-changes. It stays unavailable, with the version reason (FR-020).
- Bitbucket Data Center / Server.
- Detecting stale decisions on Bitbucket and GitLab, which record no commit for a decision. Keep the current behaviour (the decision is treated as standing on the current head) and document it.

## 9. Open decisions for `/speckit-clarify`
1. **SC-007 wording.** Either rename the "Approved by you, waiting to merge" lane (e.g. "You signed off, not merged yet") or allow that one label because it reports the reviewer's own action.
2. **SC-008 and the Markdown preview.** Either allow sanitised HTML as a reviewed exemption, or render without `innerHTML`.
3. **Neutral error for "nothing to withdraw".** `conflict` (proposed) or `not_found`.
4. **GitHub reply to a PR-level comment.** Post it as a new PR comment (quoting the original), or hide Reply for those threads.
5. **Abbreviated `headCommit` on list rows.** Document it in the contract (proposed), or resolve full SHAs at one extra call per PR.
6. **Orphaned panel components.** Delete `panel-host.tsx` and `evidence-panel.tsx`, or restore the panel flow.
7. **Live fixture recording.** Which Bitbucket workspace or repository to use. It needs a second account so the author guard can be recorded.

## 10. Suggested delivery order (for `/speckit-plan`)
1. Contract identity fields, then core identity checks (unblocks R1).
2. Bitbucket fixes (R2, R3, R4, R9, item 12).
3. Cross-platform consistency (R4 for GitLab, R5–R8, R10, R11).
4. Tests: turn the 6 failures and the typecheck green; add the missing cases from §6; add a live GitLab writer test.
5. Record the review-action fixtures live: Bitbucket, then GitHub (R12).

## 11. How to verify the finished feature
- `npm run typecheck` is clean; `npm test` shows 0 failures.
- `node --test test/contract/*.contract.test.ts` passes for all three platforms, including the new cases.
- `npm run gitlab:up && npm run test:gitlab` passes the live writer contract.
- Manual check on Bitbucket (`npm run dev`, real account): on your own PR, the actions are disabled with the author reason. On someone else's PR, post a line comment, a range comment and a nested reply; confirm they show as one thread. Edit and delete your comment, approve with a message, then withdraw.
