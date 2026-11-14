# Research: Review Actions Platform Parity

Each entry settles a choice the spec and the codebase left open. The spec's clarifications are not reopened here.

## R1. Where the handle lives

**Decision**: Add `handle` to `Comment.author` (`{ id, name, handle }`) and `authorHandle` to `PullRequestInfo`. Keep `author` as the display text and `author.name` as the display name.
**Rationale**: Replacing `PullRequestInfo.author` with the handle would show raw Bitbucket account ids on Home, in the session queue and in the review shell, and the Home filter would match on them. A separate field keeps display and identity apart.
**Alternatives considered**: Redefine `author.id` as the handle. Rejected: GitHub and GitLab use the numeric id for other things, and one field with two meanings is how this bug started.

Per platform:

| Platform | Signed-in handle | `authorHandle` and `author.handle` |
|---|---|---|
| Bitbucket Cloud | `account_id` | `author.account_id`, or `''` when absent |
| GitHub | `login` | `user.login` |
| GitLab | `username` | `author.username` |

## R2. How handles compare

**Decision**: One core helper, `sameHandle(a, b)`. It is true only when both are non-empty and equal ignoring case. It is used by the author guard in `run()`, by `decision()`, by edit/delete ownership, by `readBack()` and by `comments()`.
**Rationale**: GitHub logins and GitLab usernames ignore case, and the adapters already lowercase on their side. Comparing without case is platform-neutral and harmless for Bitbucket account ids. The empty-handle rule covers the "deleted author account" edge case: a missing handle never matches, so the actions stay available.
**Alternatives considered**: Adapters lowercase every handle. Rejected: `currentUser().handle` is shown at sign-in and would change case for the user.

The two inline `info.author === me` checks fold into the helper so they cannot drift. `resultOf()` fills `author.name` from `currentUser().displayName`, so a just-posted comment shows the name, not the handle.

## R3. Threads and the deleted first comment

**Decision**: Add `Comment.startsThread: boolean`. `threadId` stays the id a reply is posted to. The UI's `threadsOf()` puts the starting comment first. When a thread has none, it shows a "Deleted comment" placeholder in its place.

- **Bitbucket**: walk `parent` links over every comment, deleted ones included, to find the root id. Then drop deleted comments. A deleted root and a deleted middle reply leave one thread under one placeholder.
- **GitHub**: `startsThread` is true when `in_reply_to_id` is absent. GitHub replies always point at the root, so a deleted root leaves replies with no start.
- **GitLab**: `threadId` is the discussion id. `startsThread` is true for the first note of a discussion. GitLab keeps no trace of a deleted first note: the next note becomes first. The contract suite records this as the expectation value `orphanPlaceholder: false` for GitLab. Its replies are still shown, in one thread.

**Rationale**: `id === threadId` cannot mark the start on GitLab, where the thread id is a discussion id. One explicit flag works on all three, and the placeholder is derived in one pure UI function.
**Alternatives considered**: Adapters emit a synthetic deleted root. Rejected: it puts a fake comment in the read model, and GitLab could not produce one anyway.

## R4. Head check before a line comment

**Decision**: Every writer reads the pull request through the read layer and refuses with `conflict` when the head is not `anchor.commit`. GitLab compares with the newest diff version only (`versions[0]`), not any version.
**Rationale**: Core already checks `expectedHead`. FR-007 asks each platform to hold the rule too, so a writer used outside the route stays safe. The request memo (R8) makes the second read free.
**Alternatives considered**: Core only. Rejected: the writer contract suite tests the writer alone and already expects the refusal.

## R5. Decision with a message

**Decision**: The decision outcome gains `message?: { posted: true; commentId: string } | { posted: false; reason: string }`. Bitbucket and GitLab POST the decision first, then the message. A message failure returns the made decision with `posted: false`, and never throws. GitHub sends both in one review, so it sets no `message`. Core writes a second write-record intent, `<requestId>:message`, with action `comment` and the message's comment id, so the message is editable (FR-011). `ReviewActionResult` gains `warning?: { code: 'message_not_posted'; message: string }`. The decision panel keeps the text when the warning is present.
**Rationale**: Uses existing write-record actions. No schema change. One pending intent at a time still holds, because the decision intent is terminal before the message intent opens.
**Alternatives considered**: A new `decision_message` action. Rejected: it needs a schema change, and `postedCommentIds()` would need a new case for the same meaning.

An empty message posts nothing and sets no `message`.

## R6. Withdrawing with nothing to withdraw

**Decision**: `conflict` on every platform. GitHub and GitLab call `reads.myDecision()` first and refuse when it is null, as Bitbucket already does. GitHub's `withdrawDecision` reuses the read adapter instead of re-reading `/user` and the reviews.
**Rationale**: The spec pins `conflict`. A read first avoids a failing platform write.

## R7. "Approved by me", shared

**Decision**: New `src/adapters/approved-by-me.ts` exports `approvedAcross(platform, numbers, one)`. It runs `one(n)` through `mapLimited` with limit 4, logs each failure with the pull request number and error code, returns the set of successes, and throws `AdapterError('unavailable')` when every check failed and `numbers` is not empty. Each adapter's `approvedByMe` becomes a one-line call with its own `one`. The read contract keeps its `approvedByMe(repo, numbers): Promise<Set<number>>` shape.
**Rationale**: It is Bitbucket's current behaviour, lifted. Core already turns `unavailable` into `PullGroup.approvalsNote`.
**Alternatives considered**: A per-PR contract method with core doing the loop. Rejected: it changes the read contract for no gain.

## R8. Combining repeated reads

**Decision**: New `src/adapters/request-memo.ts` holds an `AsyncLocalStorage` scope. `withRequestScope(fn)` opens it. `src/server/http.ts` wraps each request in it. Inside a scope, `createReadOnlyFetch` serves a repeated GET of the same URL and credential from one in-flight promise, and replays the body to each caller. `createWriteFetch` clears the scope's memo after every write, successful or not. Outside a scope, nothing is cached.
**Rationale**: Exactly "within one request" (FR-017, SC-010), with no TTL guess and no contract change. Clearing on write keeps any read after a write fresh. It helps every platform, and Bitbucket's rate limit needs it most. `AsyncLocalStorage` is in Node's standard library.
**Alternatives considered**: A short-TTL cache in the Bitbucket adapter. Rejected: a time window can serve a stale head across requests, and it would be Bitbucket-only code for a shared need.

## R9. GitHub reply to a whole-pull-request comment

**Decision**: `replyToThread` first reads `pulls/comments/{id}` through the read layer. On `not_found` it reads `issues/comments/{id}` and posts a new comment to `issues/{pr}/comments` with the original quoted (`> ` on each line, then a blank line, then the reply). The quoting comment starts its own thread. `capability.reply` stays allowed on every platform.
**Rationale**: It matches the GitHub writer's existing edit fallback, uses an allowlisted endpoint and posts nothing that fails. It satisfies FR-015 with no per-thread capability field.

## R10. Clone over alternative SSH hosts

**Decision**: GitHub `cloneLocations` returns `github.com/<id>` and `ssh.github.com/<id>`, and `repositoryForRemote` accepts both. `normaliseRemote` already drops the `:443` port. GitLab gains an optional `workspace.sshHost` config value, passed as `SourceControlSettings.sshHost`, and matches remotes on either host. The read suite expects Bitbucket's two locations.
**Rationale**: GitLab's SSH host cannot be learned before discovery runs. The only API source is per-project `ssh_url_to_repo`, and `repositoryForRemote` is synchronous. A neutral config value is the smallest fix.
**Alternatives considered**: Accept any host whose path matches. Rejected: it would claim clones of other servers.

## R11. `.env` for GitHub and GitLab

**Decision**: `envCredential` returns `{ secret, scheme: 'bearer', scope: 'write' }` for `github` from `GITHUB_TOKEN`, then `GH_TOKEN`, and for `gitlab` from `GITLAB_TOKEN`.
**Rationale**: Both sign in with a personal access token only, as the descriptors show. It matches the existing Bitbucket and Jira fallback.

## R12. Spec in the pull request's own repository

**Decision**:
- **Terms**: the tracker keys, as today. When there are none, the branch name and its last segment after `/`, de-duplicated ignoring case. A key matches a folder as feature 006 describes. A branch term matches only a whole folder name, ignoring case.
- **Branches**: `listRemoteHeads` becomes `ls-remote --symref <url> HEAD refs/heads/*`. One call returns the heads and the default branch. The search considers the default branch, `develop` when it exists, and the matching branches: names matching a key, or the source branch itself for branch terms.
- **Ranking**: `chooseCopy` takes a branch matcher in place of a key. The rule `matching-branch-over-develop` keeps its stored and wire value. Its label becomes "matching branch over base branch". Other copies read "`<branch>` also has a copy".
- **Enclosing repository**: the `not-inside-project` note is still stored but no longer raises a gap. The `no-enclosing-repository` gap kind and its label are removed.

**Rationale**: It follows the clarified rules (FR-032 to FR-035) and keeps feature 006 unchanged when a key is present. Keeping the stored rule value avoids a store migration.
**Alternatives considered**: Rename the rule value. Rejected: it means a migration and wire churn for a label.

## R13. Markdown preview exemption

**Decision**: `ui-safety.test.ts` exempts exactly `components/markdown-preview.tsx` from the HTML-injection scan, by name, with a comment citing FR-024. The proof of sanitising is the existing Playwright test `test/ui/markdown-preview.ui.ts`, which covers scripts, `onerror` handlers and `javascript:` links. Add any case it misses.
**Rationale**: DOMPurify needs a DOM, and plain `node --test` has none. Adding jsdom for one test breaks Q.1's minimum.
**Alternatives considered**: Add jsdom as a dev dependency. Rejected: a second DOM for one assertion the browser test already makes.

## R14. Recording real responses

**Decision**: A person records by using the real app against a pull request they set up by hand in the dedicated test workspace, authored by the second account. They start the server with `node --import ./test/record/capture.ts src/main.ts`. The preload, outside every test glob, replaces the global `fetch` with `recordingFetch`, and `main.ts` already defaults its network to the global `fetch`. The person then follows the click script in `test/record/README.md`, one review action per click. `recordingFetch` gains `aliases`, a real-to-placeholder map applied to URLs, headers and bodies. Real handles, names and workspace slugs become `alice-dev`, `bob-dev` and `test-workspace`. Each README names the role that recorded it ("reviewer account", "author account") and the date. GitLab records from the local instance, with a seeder that adds a second author account and gives the reviewer a Developer role and an `api` token.
**Rationale**: Every write starts with a person's click in the UI (II.4), so it is ordinary product use, not a test writing to a hosted platform (XI.4, XI.5). The preload keeps recording code out of the product. Aliasing keeps account details out of fixtures (FR-030) and keeps the signed-in user different from the author (FR-029).
**Alternatives considered**: A recording hook in `main.ts`. Rejected: it puts test code in the product. A script that drives the writer adapters directly. Rejected after analysis: it writes to a hosted platform through an adapter (XI.4) without a UI click (II.4).

## R15. Edit and delete across sessions

**Decision**: Unchanged. A comment is editable when its handle is the reviewer's and its id is in this session's posted write records.
**Rationale**: Feature 005 scoped ownership to the session's write record. The spec's tests post and edit in one session. Widening it is a separate decision.
