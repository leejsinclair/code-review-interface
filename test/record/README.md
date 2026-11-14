# Recording the review-action fixtures (T068)

A person records each platform once, by using the real app. The preload `test/record/capture.ts` saves every request the app makes as a fixture, with credentials and real names already replaced. It touches no product code.

## Before you start

Sign in on the platform as the REVIEWER, who is not the author of the pull request (FR-029). Use a throwaway test project or workspace and a pull request created by a second account. Put the tokens in `.env` as usual.

```
PRWB_RECORD_FIXTURES=/tmp/rec/gitlab            # empty or new folder, one per platform
PRWB_RECORD_ALIAS_REVIEWER=<real reviewer handle>   # becomes alice-dev
PRWB_RECORD_ALIAS_AUTHOR=<real author handle>       # becomes bob-dev
PRWB_RECORD_ALIAS_WORKSPACE=<real workspace/owner>  # becomes test-workspace
node --import ./test/record/capture.ts src/main.ts
```

It refuses to start if any of the four is missing. Secrets come from the usual token variables (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_API_TOKEN`, `JIRA_API_TOKEN`) and from `PRWB_RECORD_SECRETS` (comma separated). Responses are recorded, not request bodies: a fixture that must tell apart two writes to one URL (for example a decision and its message on GitLab) needs `bodyIncludes` added by hand.

## Click script (one review action per click)

Do the steps in this order, and wait for each result before the next click. Do not retry a click: a retry records a second response for the same request.

1. Open the review queue, then the pull request (the list, the pull request, its changed files and commits record themselves).
2. Post a comment on the whole pull request (General comment, Post comment).
3. Reply to that comment (Reply). On GitHub this is refused by the platform; click it anyway and keep the answer.
4. Post a comment on one line of a changed file.
5. Post a comment on a range of lines (two or more) of the same file.
6. Edit the line comment (Edit), then Delete it (Delete comment).
7. Reply to another line comment, three deep: reply to the reply.
8. Delete a comment in the middle of a thread, then the root of another thread, so the deleted-root and deleted-middle shapes are recorded.
9. Withdraw with no decision made (Withdraw). Keep the refusal.
10. Approve with no message (Approve).
11. Withdraw (Withdraw). Then click Withdraw once more to record the second refusal.
12. Approve with a message, then Withdraw it.
13. Request changes with a message (Request changes); on GitLab the button is unavailable, so skip it and note that in the README. Then Withdraw it.
14. Moved head: with the review open, have the author push one more commit. Without reloading, post a line comment. Keep the refusal. Reload and read the list again; the list row shows the abbreviated head.
15. Read-only account: sign in once with a token that cannot write and click Post comment, to record the forbidden answer.

Rate limiting (429), unavailable (5xx), a conflict (409), a rejected body (422) and a failing decision message cannot be clicked on purpose. Keep the hand-authored variants for those and say so in the fixture README.

## After recording

1. Replace each platform's `test/fixtures/<platform>/review-actions/` folder with the recording (keep `variants/` for the scenarios you could not click). Rename files to the names the contract suites load.
2. Check that no secret or real name remains (SC-009): search the folder for each token, each real handle, display name and workspace, and for `[redacted]` appearing where a value is still needed.
3. Confirm the signed-in handle (`alice-dev`) differs from the pull request's `authorHandle` (`bob-dev`) in the fixtures (FR-029).
4. Rewrite each fixture folder's `README.md`: name the recording role (reviewer, not author), the platform and instance version, the date (YYYY-MM-DD), and which scenarios were hand-authored instead. Remove "hand-authored" from every file that is now recorded.
5. Run `node --test test/contract/*.contract.test.ts`.

Record GitLab first from the local instance (`npm run gitlab:up`), then Bitbucket Cloud and GitHub from the T002 workspace.
