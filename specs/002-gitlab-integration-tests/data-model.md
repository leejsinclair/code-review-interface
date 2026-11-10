# Data Model: GitLab Platform and Live Integration Tests

**Feature**: `002-gitlab-integration-tests` | **Date**: 2026-11-08
**Inputs**: [gitlab-integration-tests.spec.md](gitlab-integration-tests.spec.md), [plan.md](plan.md), [research.md](research.md), [001 data model](../001-pr-review-workbench/data-model.md), ADR 0002

This feature adds no table to the review store and changes no stored entity. The store already records platform ids as plain strings, so GitLab sessions, snapshots, issue references and evidence use the existing rows unchanged (constitution III). The changes fall into three groups:

1. **Product configuration and contracts** (`src/`): one new config field, one tightened address rule, one descriptor flag, two new reference forms, a new registry settings value, and a redirect rule in the read-only layer.
2. **Adapter mappings** (`src/adapters/gitlab/`): how GitLab's merge requests, diffs and issues map onto the existing neutral shapes. No new neutral shape is introduced.
3. **Test-only entities** (`test/`): the platform seeder, the seeded run, the live-suite gate, contract targets and recorded fixtures. None of these is reachable from `src/`.

## Overview

```text
Configuration (config.json)
   ├── RepositoryConfig ── + baseUrl? ─────┐
   └── IssueTrackerConfig ── site? ────────┴── Self-hosted address (one rule: validateBaseUrl)
                                                   |
AdapterDescriptor ── + needsBaseUrl ── decides whether baseUrl is required
                                                   |
Registry ── SourceControlSettings { repository, baseUrl? } ──> createGitlabSourceControl
        └── TrackerSettings { site, projectKeys, ... }     ──> createGitlabIssuesTracker
                                                   |
Read-only layer ── Redirect hop (same origin only, max 5) ──> network

Test only (test/):
PlatformSeeder (neutral) <── GitlabSeeder (root token, plain fetch, git CLI)
   └── Seeded run (it-<suite>-<timestamp>)
          ├── Reviewer user (1) ── Reviewer token (1, revocable)
          ├── Seeded repository (1..n; review, fork, hidden)
          │      ├── Seeded commit / File change (0..n)
          │      ├── Seeded pull request (0..n)  [state machine below]
          │      └── Seeded issue (0..n; visible or hidden)
          └── Leftover (other runs' it-* items, listed only)
Live gate (env.ts) ── decides skip or fail per GitLab readiness
Contract target ── expected values (fixture constants or seeded data)
Recorded fixture ── scrubbed request/response pair (recording mode only)
```

## 1. Product configuration and contracts

### Self-hosted address (value type)

The base web address of a platform instance. Not an entity of its own: it is the value held by `RepositoryConfig.baseUrl` and `IssueTrackerConfig.site`, and both go through one validator, `validateBaseUrl(field, value)` in `src/config.ts` (research R2).

| Part | Rule | Source |
|---|---|---|
| Scheme | `https:`. `http:` only when the host is loopback. | FR-017 |
| Host | Loopback means exactly `localhost`, `[::1]`, or a dotted quad whose first octet is `127` after `new URL` normalisation. `localhost.example.com` and `127.evil.com` are not loopback. | FR-017, research R2 |
| Port | Optional. Kept as written. | Key Entities |
| Path | Optional sub-path (`https://host/gitlab`). Kept by every adapter-built API, clone and web address; addresses are joined as strings, never with `new URL('/api/v4', base)`. | Edge case, research R4 |
| User info, query, fragment | Must be empty. Any of them refuses the address. | FR-018 |
| Trailing `/` | Stored as typed; adapters trim it before joining. | research R2 |

**Refusal message**: `invalid(field, 'must use https, or http on a loopback address')` for the scheme rule, and the existing `invalid(field, why)` form for user info, query and fragment. `field` is `repository.baseUrl` or `issueTracker.site`.

**Consequence for existing data**: a saved `site` with user info, a query or a fragment now fails `loadConfig`. `main.ts` already treats an unloadable config as no config, so the reviewer lands on setup and sees the refusal. Plain https Jira sites are unaffected.

### RepositoryConfig (reshaped)

`src/config.ts`, persisted in `<app-data>/config.json`, and mirrored on the `Config` / `ConfigBody` wire types in `src/contracts/http.ts`.

| Field | Type | Rules |
|---|---|---|
| `platform` | `PlatformId` | Unchanged. A registered source-control id; now includes `gitlab`. |
| `id` | string | Unchanged. The platform's path form. For GitLab, the full project path including every nested group (`group/sub/project`). |
| `clonePath` | string | Unchanged. |
| `baseUrl` | string, optional | **New.** A self-hosted address. Required when the chosen platform's descriptor has `needsBaseUrl: true`; validated by `validateBaseUrl` whenever present. Named without any platform (FR-016, VIII.2). |

**Validation**: `validateConfig` receives the set of source-control ids that need a base address alongside the registered ids it already receives, and refuses a missing `baseUrl` at setup time rather than at first use (research R2). The token is never a field here (FR-022); unknown fields are still refused with `unknown_field`.

### IssueTrackerConfig (rule tightened)

| Field | Type | Change |
|---|---|---|
| `platform` | `PlatformId` | Now includes `gitlab-issues`. |
| `site` | string, optional | Was "must be an https URL". Now goes through `validateBaseUrl` (https, or http on loopback; no user info, query or fragment). Required by GitLab Issues. May point at a different instance from `RepositoryConfig.baseUrl` (FR-016). |
| `projectKeys` | string[], optional | Unchanged; unused by GitLab Issues. |

### AdapterDescriptor (reshaped)

`src/contracts/shared.ts`.

| Field | Type | Rules |
|---|---|---|
| `id`, `displayName`, `signInFields` | unchanged | |
| `needsBaseUrl` | boolean, optional | **New.** True when the source-control adapter cannot work without `RepositoryConfig.baseUrl`. Drives the setup screen's `data-testid="setup-base-url"` field (FR-019) and the config check above. Absent means false. |

New descriptors (research R3):

| Id | Role | Display name | Sign-in fields | `needsBaseUrl` |
|---|---|---|---|---|
| `gitlab` | source control | GitLab (self-managed) | one `secret` (bearer) | true |
| `gitlab-issues` | issue tracker | GitLab Issues | one `secret` (bearer) | n/a (uses `site`, required) |

### SourceControlSettings (new, internal wiring)

`src/adapters/registry.ts`. Passed to `SourceControlEntry.create(deps, settings)`, `createSourceControl(platform, deps, settings)` and `verifySignIn(platform, deps, settings)` (research R1).

| Field | Type | Rules |
|---|---|---|
| `repository` | `RepoRef` | The configured repository. |
| `baseUrl` | string, optional | Copied from `RepositoryConfig.baseUrl`, already validated. |

The GitHub and Bitbucket entries ignore it. The `SourceControlProvider` interface itself is unchanged, so its callers in core are unchanged (FR-001). `createGitlabSourceControl` also accepts a `pageSize` option (default 100) that only tests set; the registry never sets it.

### IssueRefForm (extended)

`src/contracts/issue-tracker.ts`.

| Value | Meaning | Status |
|---|---|---|
| `'project-key'`, `'#123'`, `'owner/repo#123'` | Existing forms. | unchanged |
| `'!123'` | A short merge-request reference, resolved against the configured repository. | **new** |
| `'owner/repo!123'` | A qualified merge-request reference, any depth of nested group. | **new** |

### Issue reference (GitLab mapping of an existing entity)

`RawIssueReference` is unchanged in shape. For `gitlab-issues` (FR-012, FR-013, research R5):

| Field | Rule |
|---|---|
| `key` | Lower-cased `path#N` for an issue or `path!N` for a merge request, where `path` is the full project path. A short form is expanded against the configured repository. `#12` and `!12` therefore never share a key. |
| `form` | `'#123'`, `'owner/repo#123'`, `'!123'` or `'owner/repo!123'`. |
| `text` | As written. |

Recognition patterns: qualified `/(?<![\w./-])([\w.-]+(?:\/[\w.-]+)+)([#!])(\d+)\b/`, short `/(?<![\w&/#!])([#!])(\d+)\b/`.

**Lookup outcome** (`IssueLookup`, unchanged shape):

| Input | Outcome | Request sent |
|---|---|---|
| `!` form | `{ status: 'resolved', kind: 'pull-request' }` | none (FR-013) |
| `#` form, 200 | `resolved`, `kind: 'issue'`, `title`, `descriptionText` (stored Markdown, returned as written), `webUrl` = `web_url` (FR-014) | `GET /projects/:id/issues/:iid` |
| 404 (missing, confidential to outsider, or project not visible) | `unresolved`, reason `'not found'` | one GET |
| 401 or 403 | `unresolved`, reason `'forbidden'` | one GET |
| anything else | `unresolved`, reason `'tracker unreachable'` | one GET |

Never thrown as an error (FR-015, V.1).

### Merge request (GitLab mapping onto PullRequestInfo)

GitLab's merge request maps onto the existing `PullRequestInfo`, `CommitInfo`, `ChangedFileInfo` and `HeadLocation` shapes (FR-003 to FR-008, research R4). The project id in API addresses is `encodeURIComponent(fullPath)`.

| Neutral field | GitLab source | Rule |
|---|---|---|
| `number` | `iid` | Per-project, > 0. Separate numbering from issues. |
| `title`, `description` | `title`, `description` | `null` description becomes `''`. |
| `author` | `author.username` | |
| `sourceBranch`, `targetBranch` | `source_branch`, `target_branch` | |
| `headCommit` | `sha` | Full 40-hex. |
| `state` | `state` | `opened` → `open`, `closed` → `closed`, `merged` → `merged`, `locked` → `open`. |
| `updatedAt` | `updated_at` | ISO 8601 UTC. |
| Commits | `/merge_requests/:iid/commits` | Reversed to oldest first; `authoredAt` from `committed_date`, converted to UTC; full sha. |
| Changed file `status` | `/merge_requests/:iid/diffs` | `new_file` → `added`, `deleted_file` → `deleted`, `renamed_file` → `renamed`, otherwise `modified`. `previousPath` = `old_path` for renames only. |
| `linesAdded`, `linesRemoved` | `diff` | Count of `+` and `-` body lines. |
| `binary` | `diff` | True when `diff` is empty or matches `/^Binary files .* differ$/m` and the entry is not a pure rename. The first live contract task keeps whichever signal GitLab 19.5 actually sends. |
| Unified diff | `/merge_requests/:iid/raw_diffs` | Returned as is. |
| `headLocation.ref` | | `refs/merge-requests/<iid>/head` on the base project (`project_id`), also for fork MRs. |
| `targetLocation.ref` | | `refs/heads/<target_branch>`. |
| `remoteUrls` | `GET /projects/:id` | `http_url_to_repo` and `ssh_url_to_repo`; they carry host, port, sub-path and nested groups. |
| `cloneLocations` | | `normaliseRemote(http_url_to_repo)`. |

**Paging**: follow `Link: rel="next"` with the existing `nextLink`. At the existing cap of 10 pages, throw `AdapterError('truncated')` (FR-009).

**Errors** (FR-010): 404 or a deleted MR → `not_found`; 401 → `unauthorized` (platform marked signed-out on a sign-in check, expired on a later call); 5xx, network failure, or a refused redirect → `unavailable`.

### Redirect hop (read-only layer behaviour)

Not stored; a rule in `src/adapters/read-only-http.ts` applied to every platform (FR-043, FR-044, ADR 0002, research R6).

| Field | Rule |
|---|---|
| Method | Always GET. The read-only layer still refuses every other method (FR-021). |
| Fetch mode | `redirect: 'manual'`, so the 3xx is seen before anything follows it. |
| Status handled | 301, 302, 303, 307, 308. |
| Target | `Location` resolved against the current URL. |
| Origin check | `new URL(target).origin === original origin` (scheme, host, port). |
| Hop limit | 5. |

```text
request(url, hop=0)
  ├─ non-3xx                       → return response
  ├─ 3xx, same origin, hop < 5     → request(target, hop+1) with the same headers
  └─ 3xx, no Location / other origin / hop = 5
                                   → AdapterError('unavailable'); no request sent, credential never leaves the origin
```

### Credential (unchanged)

The GitLab token is a `secret` sign-in field in the OS credential store, read only through `credentials.ts` and sent as `Authorization: Bearer <token>`. It never appears in config, logs, the review store, API responses or fixtures (FR-022).

### Session state effects (existing transitions, GitLab inputs)

The review session's existing states are reused. GitLab's states feed them as follows (US2):

```text
open ──(MR closed)──> closed ──(MR reopened)──> open
open ──(MR merged)──> merged        (terminal on GitLab)
open/closed ──(getPullRequest → not_found)──> deleted
open ──(new sha on refresh)──> open with a new snapshot; earlier answers stay on the old head
```

Every transition keeps stored answers (III).

## 2. Test-only entities (`test/`)

None of these is imported by `src/`. The seeder never uses the read-only layer or an adapter (FR-024, XI.4).

### PlatformSeeder (neutral interface)

`test/seeder/platform-seeder.ts`. The only surface tests may call for setup (FR-023, FR-025, research R7).

| Operation group | Operations |
|---|---|
| Run | `begin(suite)` → `SeededRun`; `cleanup()`; `listLeftovers()` |
| Repository | `createRepository`, `deleteRepository`, `renameRepository`, `forkRepository` |
| Commits | `pushCommit(repo, branch, changes: FileChange[])` |
| Pull requests | `openPullRequest`, `updatePullRequest`, `closePullRequest`, `reopenPullRequest`, `mergePullRequest`, `deletePullRequest` |
| Issues | `createIssue`, `createHiddenIssue` |
| Reviewer token | `createReviewerToken`, `revokeReviewerToken` |

Operation names and arguments mention no platform. `GitlabSeeder` (`test/seeder/gitlab-seeder.ts`) is the only implementation.

**Validation**:
- Refuses to construct against an address whose host is not loopback (FR-027), using the same loopback definition as `validateBaseUrl`.
- Every wait (branch visible after push, `diff_refs` present after open, `merge_status` decided before merge) polls with `waitFor` and a bound of about 30 seconds, failing with a message naming what it waited for. No fixed sleeps (FR-026).
- Authenticates with the root token via `PRIVATE-TOKEN` on plain global `fetch`; pushes with the git CLI from its own author clone. The root token never reaches an adapter (FR-029).

### Seeded run

The unit of cleanup: everything one suite creates (Key Entities, research R9).

| Field | Type | Rules |
|---|---|---|
| `name` | string | `it-<suite>-<UTC yyyymmddhhmmssSSS>`. `suite` differs per test file, so parallel `node --test` processes never collide (FR-028). |
| `baseUrl` | string | `GITLAB_URL`, loopback only. |
| `reviewer` | Reviewer user | Exactly one per run. |
| `repositories` | Seeded repository[] | Every project created, including forks and the hidden project. |
| `startedAt` | ISO 8601 UTC | |

**Ownership rule**: an item belongs to the run only if its name or path starts with `name`. `cleanup()` refuses to touch anything else.

**State transitions**:

```text
created ──begin()──> active ──test ends (pass or fail)──> cleaning ──all gone──> cleaned
                                                              └── step fails ──> leftovers-reported
```

- `cleaning`: for each project, `DELETE /projects/:id`; read the renamed `path_with_namespace`; `DELETE` again with `permanently_remove=true&full_path=<renamed>`. Then `DELETE /users/:id?hard_delete=true`. Poll until projects and user are gone.
- `leftovers-reported`: names still present are printed; the test's original failure, if any, stays the reported result.

SC-004: after `cleaned`, zero projects, users or tokens with this run's name remain.

### Reviewer user and token

| Field | Rules |
|---|---|
| `username` | Equal to the run name. Non-administrator. Created with `skip_confirmation`. |
| Membership | Reporter on each review project of the run; not a member of the hidden project. Reporter reads code, MRs and issues and cannot write. |
| `token` | Personal access token, scopes `read_api` and `read_repository`, expires the next day. The only token adapters under test use (FR-029). |
| Lifetime | Deleted with the run (hard delete). |

**Token states** (US3-AS5, AS6):

```text
(never existed) ── sign-in check ──> refused: unauthorized, platform signed-out
active ──revokeReviewerToken()──> revoked ── next call ──> unauthorized, platform expired
```

A revoked token stands in for an expired one, because GitLab will not create an already-expired token.

### Seeded repository

| Field | Rules |
|---|---|
| `path` | Full project path, `<namespace>/<run name>-<label>`; may be in a nested group to exercise FR-008 and FR-012. |
| `kind` | `review` (reviewer is Reporter), `fork` (forked from a review project), `hidden` (private, reviewer not a member). |
| `httpUrl`, `sshUrl` | As GitLab returns them. |
| `previousPaths` | Paths it had before `renameRepository`, used by the US3-AS7 rename test. |

### FileChange (pushCommit input)

| Field | Rules |
|---|---|
| `kind` | `add`, `edit`, `rename`, `delete`. |
| `path` | Required. |
| `fromPath` | Required for `rename`, absent otherwise. |
| `content` | Text or bytes. Bytes mark a binary file. Required for `add` and `edit`. |

A change list for US1-AS3 contains at least one of each kind and one binary file.

### Seeded pull request

| Field | Rules |
|---|---|
| `repo`, `number` | Base project and `iid`. |
| `sourceRepo` | The fork, for a fork MR; else `repo`. |
| `sourceBranch`, `targetBranch`, `headCommit`, `title`, `description` | Recorded at creation and updated by `updatePullRequest` / `pushCommit`; these are the contract suite's expected values (FR-031). |
| `state` | Mirrors GitLab: see below. |

**State transitions** (seeder operations, US2-AS3 to AS5):

```text
(none) ──openPullRequest──> opening ──diff_refs ready──> open
open ──pushCommit / updatePullRequest──> open (new headCommit)
open ──closePullRequest──> closed ──reopenPullRequest──> open
open ──mergePullRequest (after merge_status decided)──> merged
open | closed ──deletePullRequest──> deleted (adapter: not_found)
```

`merged` and `deleted` are terminal.

### Seeded issue

| Field | Rules |
|---|---|
| `repo`, `number` | Project and issue `iid`. |
| `title`, `description`, `webUrl` | Expected lookup values. |
| `visibility` | `visible` (in a review project) or `hidden` (in the hidden project; expected outcome `unresolved`, reason `'not found'`). Confidential issues are not used: Reporters can see them (research R8). |

### Leftover

An `it-*` project or user that does not carry the current run's name (FR-045, FR-046).

| Field | Rules |
|---|---|
| `kind` | `project` or `user`. |
| `name` | Path or username; starts with `it-`. |

A live run only lists leftovers. Only the manual `gitlab:clean` command (`test/gitlab/clean.ts`) deletes them, and it refuses a non-loopback address. Tests never run `gitlab:reset` (FR-039).

### Live gate

`test/gitlab/env.ts` (research R10).

| Input | Source | Default |
|---|---|---|
| `GITLAB_URL` | environment | value in `testing/gitlab.md` (FR-038) |
| `GITLAB_TOKEN` | environment | value in `testing/gitlab.md` (root token, seeder only) |
| `PRWB_GITLAB_REQUIRED` | `test/gitlab/required.env` via `node --env-file`, set by `test:gitlab` | unset |

Readiness probe: `GET <GITLAB_URL>/api/v4/version` with a 5-second timeout.

| Readiness | `PRWB_GITLAB_REQUIRED` unset (`npm test`) | set (`test:gitlab`) |
|---|---|---|
| `ready` (200) | run | run |
| `unreachable` | every test declared `skip` with a message naming `npm run gitlab:up` and `npm run gitlab:bootstrap` (FR-035, FR-037) | one failing test naming the cause, within 30 s (FR-036, SC-003) |
| `not-bootstrapped` (401) | same skip | same failure, pointing at bootstrap |

### Contract target

The data a shared contract runner takes, so fixture and live runs share one suite (FR-031, SC-001). Exported from `test/contract/source-control.suite.ts` (`runSourceControlContract`) and `test/contract/issue-tracker.suite.ts` (`runIssueTrackerContract`).

| Field | Rules |
|---|---|
| `platform` | Registry id. |
| `create` | Builds the adapter with given deps and settings. |
| `fetch` | `recordedFetch` for fixture targets; `logged-fetch` around real fetch for live targets. |
| `expected` | All expected values: repo, PR numbers and fields, commits, changed files, fork case, issue keys, the no-access reason (`'forbidden'` for GitHub Issues and Jira, `'not found'` for GitLab). Constants for fixtures, seeded data for live. |

The runner never branches on platform; per-platform differences live only in `expected`. Live runs assert from the request log that every product request was a GET (SC-005).

### Live workbench and clone

| Entity | Rules |
|---|---|
| `startWorkbench` live option | `{ repository, issueTracker, credentials, clonePath, fetch }`. Skips fixture loading and defaults; uses the real server, store and Git with the fake AI CLI (FR-032). |
| Live clone (`liveClone(httpUrl, token)`) | HTTP clone in a temp directory. `HOME` points at another temp directory with `credential.helper=store` and a `.git-credentials` for the host. The token never enters the clone's config, remote URL or the product (research R11). |
| Clone fingerprint | Branch, HEAD, index, working-tree status and stash. Captured before and compared after every repository operation; must be identical (FR-034, SC-006). Only `refs/prwb/*` and remote-tracking refs may change (US3-AS4). |

### Recorded fixture (optional, P3)

Written by `recordingFetch(network, { dir, secrets })` in `test/helpers/recorded-fetch.ts`, only when `PRWB_RECORD_FIXTURES=<dir>` is set (FR-041, research R12).

| Field | Rules |
|---|---|
| `request` | `{ method, url, headers.accept? }`, the existing `FixtureRequest` shape. |
| `response` | `{ status, headers, body }`, the existing `FixtureResponse` shape. |

**Validation** (FR-042): before writing, drop `authorization`, `private-token`, `cookie` and `set-cookie` headers, and replace every occurrence of each secret in URLs and bodies with `[redacted]`. A recorded file containing the token, those header names or a cookie fails the recording test. With the variable unset, no file is written (US4-AS3).
