# Research: GitLab Platform and Live Integration Tests

Each entry is a decision the codebase did not already settle.

## R1. How a source-control adapter gets its base address

**Decision**: The registry gets a `SourceControlSettings = { repository: RepoRef; baseUrl?: string }` parameter. The signatures become `SourceControlEntry.create(deps, settings)`, `createSourceControl(platform, deps, settings)` and `verifySignIn(platform, deps, settings)`, where `settings` covers both roles. The two callers in `server/routes/context.ts` and the contract-suite factory pass it. The GitHub and Bitbucket entries ignore it.
**Rationale**: Today only trackers receive settings, so a GitLab adapter has no way to learn its address. FR-001 promises no change to the callers of the `SourceControlProvider` contract. That interface stays as it is. Only the registry's factory, which is internal wiring, changes.
**Alternatives considered**: Encoding the address into the repository id (`host/group/project`) puts parsing into core code and breaks the existing id shape. A GitLab-only global setting would name the platform outside its adapter.

## R2. The address setting and its rule

**Decision**: The repository config gets an optional `baseUrl`. The tracker keeps `site`. Both go through one function, `validateBaseUrl(field, value)`, in `src/config.ts`. It parses with `new URL` and refuses the address when any of these hold:
- `username`, `password`, `search` or `hash` is non-empty.
- The protocol is not `https:`, except that `http:` is allowed when `isLoopbackHost(url.hostname)` is true.

`isLoopbackHost` accepts exactly `localhost`, `[::1]`, and any dotted-quad whose first octet is `127`. `new URL` has already normalised forms such as `127.1`. Addresses are stored as typed, and adapters trim a trailing `/`. Config validation refuses a missing `baseUrl` when the chosen platform's descriptor has `needsBaseUrl: true`. `validateConfig` already receives the registry's data, so it receives that set too.
**Rationale**: The rule lives in one place, so it is tested once. An exact match on `localhost` refuses `localhost.example.com`. The message keeps the existing `invalid(field, why)` form, now reading "must use https, or http on a loopback address".
**Alternatives considered**: Matching on a hostname prefix lets `127.evil.com` and `localhost.example.com` through. Refusing a missing address only at first use shows the reviewer a vague sign-in failure instead of a setup error.
**Consequence**: A saved `site` that has user info, a query or a fragment now fails `loadConfig`. `main.ts` treats an unloadable config as no config, so the reviewer lands on setup, which shows the refusal. Existing Jira sites are plain https and are unaffected.

## R3. Platform ids and descriptors

**Decision**: The ids are `gitlab` and `gitlab-issues`, with display names "GitLab (self-managed)" and "GitLab Issues". Each takes a single `secret` sign-in field, which gives bearer auth through `signins.ts`. The source-control descriptor sets `needsBaseUrl: true`. The tracker reads the existing `site`, and GitLab Issues requires it.
**Rationale**: GitLab accepts `Authorization: Bearer <PAT>` (see `testing/gitlab.md`), so `credentials.ts` needs no change.
**Alternatives considered**: `gitlab-self-managed` is longer and gains nothing. GitLab.com is out of scope.

## R4. GitLab API mapping

**Decision**: The project id is the full path, encoded as one segment (`encodeURIComponent('group/sub/project')`). API addresses are built as `<baseUrl trimmed>/api/v4/...` by joining strings. `new URL('/api/v4', base)` is not used because it drops a sub-path.

| Contract call | GitLab endpoint | Mapping |
|---|---|---|
| `verifySignIn` | `GET /user` | account = `username` |
| list open | `GET /projects/:id/merge_requests?state=opened&per_page=N` | number = `iid` |
| get one | `GET /projects/:id/merge_requests/:iid` | `opened`→open, `closed`→closed, `merged`→merged, `locked`→open. Branches come from `source_branch` and `target_branch`, head from `sha`. |
| commits | `GET /projects/:id/merge_requests/:iid/commits` (paged) | Returned newest first, so the adapter calls `.reverse()`. Times come from `committed_date`, converted to UTC ISO. |
| changed files | `GET /projects/:id/merge_requests/:iid/diffs` (paged) | The status comes from `new_file`, `deleted_file` and `renamed_file`. The previous path is `old_path`. Line counts are the `+` and `-` lines in `diff`. |
| unified diff | `GET /projects/:id/merge_requests/:iid/raw_diffs` | Used as returned. |
| head / target | MR plus `GET /projects/:id` | head = `refs/merge-requests/<iid>/head` on the MR's `project_id`. Target = `refs/heads/<target_branch>`. The URLs are `http_url_to_repo` and `ssh_url_to_repo`. `cloneLocations` = `normaliseRemote(http_url_to_repo)`. |

Paging follows the `Link: rel="next"` header with the existing `nextLink` and the cap of 10 pages, which throws `truncated`. `api.ts` takes `pageSize` (default 100). `createGitlabSourceControl` accepts it as an option, so live paging tests need a few MRs, not hundreds. The registry never sets it.
**Rationale**: GitLab builds the clone URLs it returns from its `external_url`, so they already carry the host, port, sub-path and nested groups (FR-008). `normaliseRemote` drops the port on both sides, so the clone match agrees.
**Verify live**: GitLab 19.5's binary-file signal. A binary entry is marked binary when `diff` is empty, or matches `/^Binary files .* differ$/m`, and the file is not a pure rename. The first live contract task confirms which signal GitLab sends, and the adapter keeps only that one. `raw_diffs` exists on 19.5. The first live contract case proves it.

## R5. GitLab Issues references

**Decision**: The tracker reads two patterns:
- `QUALIFIED`: `/(?<![\w./-])([\w.-]+(?:\/[\w.-]+)+)([#!])(\d+)\b/`
- `SHORT`: `/(?<![\w&/#!])([#!])(\d+)\b/`, which resolves against the configured repository.

Keys are the lower-cased `path#N` or `path!N`, so `#12` and `!12` never collide. `IssueRefForm` gains `'!123'` and `'owner/repo!123'`. A `!` reference resolves to `{ status: 'resolved', kind: 'pull-request' }` with no request (FR-013). An issue lookup is `GET /projects/:id/issues/:iid`. The description is plain text: GitLab stores Markdown, which is returned as written. The web link is `web_url`. A 404 maps to unresolved "not found", a 401 or 403 to "forbidden", and anything else to "tracker unreachable", as in `github/issues.ts`.
**Rationale**: This reuses the GitHub tracker's shape. Adding the forms keeps the existing tracker contract honest about what it found.
**Alternatives considered**: Dropping `!` references silently would lose the link the author wrote, and V.1 says a missing link must show.

## R6. Same-origin redirects (ADR 0002)

**Decision**: `read-only-http.ts` calls the network with `redirect: 'manual'`. For a 301, 302, 303, 307 or 308 that has a `Location` header, it resolves the target against the current URL. When `new URL(target).origin` equals the original origin, it repeats the GET with the same headers, for at most 5 hops. Any other target, a missing `Location` or a sixth hop throws `AdapterError('unavailable')` before any request goes out.
**Rationale**: Node's fetch returns the real 3xx response under `manual`, so the check runs before the credential could travel. This applies to every platform, and a unit test with `recordedFetch` (which replays 3xx) proves the refusal.
**Note**: GitLab's API usually answers a renamed project's old path in place, through its redirect routes, rather than with a 3xx. The live rename test asserts the outcome (the MR comes back) whichever way GitLab answers. The unit test is what proves the redirect logic.

## R7. Seeder shape and identity

**Decision**: `PlatformSeeder` in `test/seeder/platform-seeder.ts` exposes neutral operations:
- `begin(suite)` and `cleanup()`
- `createRepository`, `deleteRepository`, `renameRepository` and `forkRepository`
- `pushCommit(repo, branch, changes[])`, where each change adds, edits, renames or deletes a file and may carry binary bytes
- `openPullRequest`, `updatePullRequest`, `closePullRequest`, `reopenPullRequest`, `mergePullRequest` and `deletePullRequest`
- `createIssue` and `createHiddenIssue`
- `createReviewerToken` and `revokeReviewerToken`
- `listLeftovers()`

`GitlabSeeder` uses the root token through global `fetch` with a `PRIVATE-TOKEN` header. It never imports the read-only layer or an adapter. It pushes with the git CLI from its own author clone, using `http://oauth2:<root token>@host/...`. Waits use `waitFor` from `test/helpers/fake-ai-cli.ts` with a 30-second bound and a message naming what it waited for. It polls three things: the branch after a push, `diff_refs` after a merge request opens, and `merge_status` before a merge.
**Rename** is not in FR-023's list, but US3-AS7 needs it, so it is added as a neutral operation.
**Rationale**: Tests only call the interface (FR-025). The root token never reaches an adapter (FR-029).

## R8. Per-run reviewer user and hidden issues

**Decision**: `begin()` creates the user `it-<suite>-<timestamp>` with `POST /users` (`skip_confirmation`). It creates the user's token with `POST /users/:id/personal_access_tokens`, scoped `read_api` and `read_repository` and expiring tomorrow. The user is added as **Reporter** to each project the run creates for review. `createHiddenIssue` places the issue in a separate private run project where the user is not a member.
**Rationale**: Reporter can read code, merge requests and issues, but cannot write. Reporters *can* see confidential issues, so a confidential issue would not prove "may not see". A project the user does not belong to answers 404, the same answer a confidential issue gives an outsider.
**Shared expectation**: The issue-tracker suite's "no access" case asserts `status: 'unresolved'` and the reason the target's data record names: `'forbidden'` for GitHub Issues and Jira, `'not found'` for GitLab. That is a data value, not a branch on platform (SC-001).

## R9. Run naming, cleanup and leftovers

**Decision**: The run name is `it-<suite>-<UTC yyyymmddhhmmssSSS>`. Each suite file names a different suite, so parallel `node --test` processes never collide. `cleanup()` runs these steps:
1. Delete each run project with `DELETE /projects/:id`.
2. Read back its renamed `path_with_namespace`, then delete again with `permanently_remove=true&full_path=<renamed>`.
3. Delete the user with `DELETE /users/:id?hard_delete=true`.
4. Poll until both are gone.

It refuses any name that does not start with its own run name. A cleanup failure is logged with the leftover names and never replaces the test's own failure. `listLeftovers()` lists `it-*` projects and users from other runs, and the run prints them (FR-045). `test/gitlab/clean.ts`, run as `gitlab:clean`, deletes every `it-*` project and user on a loopback instance (FR-046).
**Alternatives considered**: Deleting stale `it-*` data automatically could remove a parallel run's data, so FR-045 forbids it.

## R10. Skip under `npm test`, fail under `test:gitlab`

**Decision**: The live files are named `test/gitlab/*.test.ts`, so the existing `npm test` glob picks them up. `env.ts` probes `GET <GITLAB_URL>/api/v4/version` with the root token, with a 5-second timeout.

| GitLab state | `npm test` | `test:gitlab` |
|---|---|---|
| Unreachable | Every test is declared `{ skip: '<message naming npm run gitlab:up and npm run gitlab:bootstrap>' }` | One failing test named for the cause |
| Answers 401 (not bootstrapped) | Same skip message | Same failure |

`test:gitlab` is `node --env-file=test/gitlab/required.env --test "test/gitlab/*.test.ts"`, and the env file sets `PRWB_GITLAB_REQUIRED=1`. A variable already set in the environment wins over the file, so a developer's `GITLAB_URL` is kept.
**Rationale**: `node:test` reports a declared skip as skipped (FR-037). `--env-file` works the same on every OS (P.4). Without it, setting a variable inline needs a shell.
**Alternatives considered**: `test:live` has no skip path. Adding the GitLab files to it would make every developer start GitLab.

## R11. Live harness and git credentials

**Decision**: `startWorkbench` gains a `live` option, `{ repository, issueTracker, credentials, clonePath, fetch }`. With it, the harness skips fixture loading and the GitHub/Jira defaults, and wraps real `fetch` in `logged-fetch`. `git-sandbox.ts` gains `liveClone(httpUrl, token)`. It clones over HTTP into a temp directory, and points `HOME` at another temp directory whose `.gitconfig` sets `credential.helper=store` with a `.git-credentials` file for that host. The token never enters the clone's config, the remote URL or the product.
**Rationale**: The product fetch already relies on the reviewer's own git credentials, and `gitEnv` passes `HOME` through. So the test gives git a credential the way a reviewer would, and no product change is needed. The prompt for US3-AS4 ("with the stored token") is met by the token the reviewer's git uses.
**Alternatives considered**: Injecting the stored token into `git fetch` from the product would need a new credential path through `repo/git.ts`, and would risk the token showing up in process lists and logs.

## R12. Recording mode

**Decision**: `recorded-fetch.ts` gains `recordingFetch(network, { dir, secrets })`. It is turned on by `PRWB_RECORD_FIXTURES=<dir>` and writes one file per request in the replayer's format: `{ request: { method, url, headers.accept? }, response: { status, headers, body } }`. Before writing, it drops `authorization`, `private-token`, `cookie` and `set-cookie`, and replaces every occurrence of each secret in URLs and bodies with `[redacted]`. `recording.test.ts` records one contract case into a temp directory, greps the files for the token, header names and cookies, then replays them with `recordedFetch` through the same contract runner and the seeded expectations it saved.
**Rationale**: This shows how fixtures could be refreshed without committing run-specific GitLab data (FR-041, FR-042). With the variable unset, nothing is written.
