# Contracts: GitLab Platform and Live Integration Tests

What this feature exposes and what tests code against. Identifiers in backticks are exact. Names fixed by the spec's Verbatim Constraints are copied verbatim:

| Verbatim constraint | Value |
|---|---|
| Test command name | `test:gitlab` |
| Run naming | `it-<suite>-<timestamp>` |
| Merge-request head ref | `refs/merge-requests/<iid>/head` |
| Environment variables | `GITLAB_URL`, `GITLAB_TOKEN` |
| Fixture replay helper | `test/helpers/recorded-fetch.ts` |
| Never run by tests | `gitlab:reset` |
| Manual leftover cleanup command | `gitlab:clean` |

The `SourceControlProvider` interface does not change (FR-001). The `IssueTracker` interface changes only by two added `IssueRefForm` values.

## 1. Command line (`package.json` scripts)

| Script | Command | Behaviour |
|---|---|---|
| `test` (unchanged) | `node --test "test/**/*.test.ts"` | Picks up `test/gitlab/*.test.ts`. When GitLab is unreachable or not bootstrapped, every GitLab test is reported **skipped**, never passed, with a message naming `npm run gitlab:up` and `npm run gitlab:bootstrap` (FR-035, FR-037). |
| `test:gitlab` (new) | `node --env-file=test/gitlab/required.env --test "test/gitlab/*.test.ts"` | Runs the live suite. When GitLab is unreachable or not bootstrapped, it fails with one test named for the cause, within 30 seconds (FR-036, SC-003). |
| `gitlab:clean` (new) | `node test/gitlab/clean.ts` | Deletes only `it-*` projects and users on the instance at `GITLAB_URL`. Refuses any non-loopback address (FR-046). Never run by tests. |
| `gitlab:reset` (existing) | unchanged | MUST NOT be run by any test (FR-039). |

### Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `GITLAB_URL` | `test/gitlab/env.ts`, seeder, `gitlab:clean` | Instance address. Default from `testing/gitlab.md`. Must be loopback (FR-027). |
| `GITLAB_TOKEN` | `test/gitlab/env.ts`, seeder, `gitlab:clean` | Root token, used only by the seeder and the readiness probe. Default from `testing/gitlab.md`. Never given to an adapter (FR-029). |
| `PRWB_GITLAB_REQUIRED` | `test/gitlab/env.ts` | `1` turns "skip" into "fail". Set by `test/gitlab/required.env`; a value already in the environment wins. |
| `PRWB_RECORD_FIXTURES` | `test/helpers/recorded-fetch.ts` | A directory path turns recording mode on. Unset: nothing is written (US4-AS3). |

Readiness probe: `GET <GITLAB_URL>/api/v4/version` with the root token, 5-second timeout. Unreachable or 401 means not ready.

## 2. Platform registry (product)

| Id | Role | Display name | Sign-in fields | Descriptor |
|---|---|---|---|---|
| `gitlab` | source control | `GitLab (self-managed)` | `secret` (bearer) | `needsBaseUrl: true` |
| `gitlab-issues` | issue tracker | `GitLab Issues` | `secret` (bearer) | requires `site` |

Exports in `src/adapters/gitlab/`: `GITLAB_ID`, `GITLAB_DESCRIPTOR`, `createGitlabSourceControl` (in `source-control.ts`); `GITLAB_ISSUES_ID`, `GITLAB_ISSUES_DESCRIPTOR`, `createGitlabIssuesTracker` (in `issues.ts`).

```ts
// src/contracts/shared.ts
export type AdapterDescriptor = {
  id: PlatformId;
  displayName: string;
  signInFields: readonly SignInField[];
  /** New. True when the source-control platform needs a repository base address. */
  needsBaseUrl?: boolean;
};

// src/adapters/registry.ts
export type SourceControlSettings = { repository: RepoRef; baseUrl?: string };
type SourceControlEntry = { descriptor: AdapterDescriptor; create(deps: AdapterDeps, settings: SourceControlSettings): SourceControlProvider };
export function createSourceControl(platform: PlatformId, deps: AdapterDeps, settings: SourceControlSettings): SourceControlProvider;
export function verifySignIn(platform: PlatformId, deps: AdapterDeps, settings: SourceControlSettings & TrackerSettings): Promise<SignInCheck>;

// src/adapters/gitlab/source-control.ts — pageSize is test-only; the registry never sets it (default 100)
export function createGitlabSourceControl(deps: AdapterDeps, settings: SourceControlSettings, options?: { pageSize?: number }): SourceControlProvider;
```

### GitLab mapping onto the source-control contract

| Contract value | GitLab source |
|---|---|
| PR number | merge request `iid` |
| state | `opened`/`locked` → `open`, `closed` → `closed`, `merged` → `merged` |
| head location ref | `refs/merge-requests/<iid>/head` on the base project (also for forks) |
| target location ref | `refs/heads/<target_branch>` |
| clone URLs | `http_url_to_repo`, `ssh_url_to_repo` (keep host, port, sub-path, nested groups) |
| errors | missing/deleted → `not_found`; 401/403 → `unauthorized`; 5xx/network/cross-origin redirect → `unavailable`; page cap → `truncated` |

## 3. Issue references

```ts
// src/contracts/issue-tracker.ts
export type IssueRefForm = 'project-key' | '#123' | 'owner/repo#123' | '!123' | 'owner/repo!123';
```

| Text | Form | Resolution |
|---|---|---|
| `#12` | `#123` | issue 12 in the configured project |
| `group/sub/project#12` | `owner/repo#123` | issue 12 in that project (any nesting depth) |
| `!12`, `group/project!12` | `!123`, `owner/repo!123` | `{ status: 'resolved', kind: 'pull-request' }`, no request sent |

Keys are lower-cased `path#N` or `path!N`, so `#12` and `!12` never collide. Missing, confidential or forbidden issues resolve to `status: 'unresolved'` with a reason (`'not found'` on GitLab), never an error (FR-015).

## 4. Configuration (HTTP API wire types)

```ts
// src/contracts/http.ts
export type Config = {
  repository: { platform: PlatformId; id: string; clonePath: string; baseUrl?: string };  // baseUrl: new
  issueTracker: { platform: PlatformId; site?: string; projectKeys?: string[] };          // unchanged shape
  limits: ConfigLimits;
  logRetentionDays: number;
};
// ConfigBody carries the same repository and issueTracker shapes.
```

`GET /api/config`, `PUT /api/config` and `GET /api/platforms` keep their routes; `descriptors[]` now may carry `needsBaseUrl`.

Address rule, `validateBaseUrl(field, value)` in `src/config.ts`, applied to `repository.baseUrl` and `issueTracker.site`:

- Refused when the URL has a user name, password, query or fragment (FR-018).
- Must be `https:`; `http:` only when `isLoopbackHost(hostname)`: exactly `localhost`, `[::1]`, or a dotted quad starting `127.` (FR-017).
- Refused when missing and the chosen source-control descriptor has `needsBaseUrl: true`.
- Error uses the existing `invalid(field, why)` form; the http message reads `must use https, or http on a loopback address`.

| Example | Result |
|---|---|
| `https://git.example.com/gitlab` | accepted, sub-path kept |
| `http://localhost:8929`, `http://127.0.0.1`, `http://[::1]` | accepted |
| `http://gitlab.example.com`, `http://localhost.example.com` | refused |
| `https://user:pw@host`, `https://host/?q=1`, `https://host/#x` | refused |

## 5. Read-only HTTP layer (every platform)

`src/adapters/read-only-http.ts` sends GET with `redirect: 'manual'`. On 301, 302, 303, 307 or 308 with a `Location`:

- Same origin (scheme, host, port): repeat the GET with the same headers, up to 5 hops (FR-043).
- Other origin, missing `Location`, or a 6th hop: throw `AdapterError('unavailable')` before any request is sent, so the credential never leaves the origin (FR-044).

## 6. Setup screen (UI)

Route `#/setup` is unchanged.

| `data-testid` | Element |
|---|---|
| `setup` | setup screen (existing) |
| `setup-base-url` | new **Repository base address** input, shown only when the chosen source-control descriptor has `needsBaseUrl: true` |
| `setup-error` | existing alert; shows the address validator's message on refusal |

## 7. Test-only interfaces (under `test/`)

### Platform seeder: `test/seeder/platform-seeder.ts`

Neutral; tests call only this (FR-025). `GitlabSeeder` in `test/seeder/gitlab-seeder.ts` implements it with the root token, plain `fetch` and the git CLI; it never imports `src/adapters/` or the read-only layer (FR-024).

```ts
export interface PlatformSeeder {
  begin(suite: string): Promise<SeededRun>;          // creates run user `it-<suite>-<timestamp>` and its reviewer token
  cleanup(): Promise<void>;                           // deletes only this run's projects and user; logs leftovers
  createRepository(name: string): Promise<SeededRepo>;
  deleteRepository(repo: SeededRepo): Promise<void>;
  renameRepository(repo: SeededRepo, newName: string): Promise<SeededRepo>;
  forkRepository(repo: SeededRepo): Promise<SeededRepo>;
  pushCommit(repo: SeededRepo, branch: string, changes: FileChange[]): Promise<string /* commit sha */>;
  openPullRequest(repo: SeededRepo, input: { source: string; target: string; title: string; description?: string; sourceRepo?: SeededRepo }): Promise<SeededPull>;
  updatePullRequest(pull: SeededPull, input: { title?: string; description?: string }): Promise<SeededPull>;
  closePullRequest(pull: SeededPull): Promise<void>;
  reopenPullRequest(pull: SeededPull): Promise<void>;
  mergePullRequest(pull: SeededPull): Promise<void>;
  deletePullRequest(pull: SeededPull): Promise<void>;
  createIssue(repo: SeededRepo, input: { title: string; description?: string }): Promise<SeededIssue>;
  createHiddenIssue(input: { title: string }): Promise<SeededIssue>;  // in a run project the reviewer cannot see
  createReviewerToken(): Promise<string>;
  revokeReviewerToken(token: string): Promise<void>;
  listLeftovers(): Promise<{ projects: string[]; users: string[] }>;  // other runs' `it-*` items; never deletes (FR-045)
}

export type FileChange =
  | { kind: 'add'; path: string; content: string | Uint8Array }
  | { kind: 'edit'; path: string; content: string | Uint8Array }
  | { kind: 'rename'; from: string; to: string; content?: string | Uint8Array }
  | { kind: 'delete'; path: string };
```

`SeededRun`, `SeededRepo`, `SeededPull` and `SeededIssue` carry the run name, the reviewer token, the repository id (full path), clone URLs, the `iid`, head sha and branch names that tests use as expected values. Waits poll with a ~30-second bound and name what they waited for; no fixed sleeps (FR-026).

`test/seeder/run-name.ts`: builds `it-<suite>-<timestamp>` (timestamp UTC `yyyymmddhhmmssSSS`), tests ownership by run-name prefix, filters leftovers.

### Contract runners

| Module | Export |
|---|---|
| `test/contract/source-control.suite.ts` | `runSourceControlContract(target)` |
| `test/contract/issue-tracker.suite.ts` | `runIssueTrackerContract(target)` |

`target` supplies the adapter factory and expected values as data. Fixture tests pass constants; live tests pass seeded values. The "no access" case expects `status: 'unresolved'` with the reason the target names (`'forbidden'` for GitHub Issues and Jira, `'not found'` for GitLab), never a platform branch (SC-001).

### Live gate: `test/gitlab/env.ts`

Exports the resolved `GITLAB_URL` / `GITLAB_TOKEN`, the readiness probe, and the gate each live file uses to declare its tests `{ skip: '<message>' }` or fail.

### Harness and helpers

| Module | Addition |
|---|---|
| `test/helpers/fake-ai-cli.ts` | `startWorkbench({ live: { repository, issueTracker, credentials, clonePath, fetch } })`: real server, store and Git, no fixture loading |
| `test/helpers/git-sandbox.ts` | `liveClone(httpUrl, token)`: HTTP clone with a temp `HOME` holding `credential.helper=store`; token never in the clone's config or remote URL |
| `test/helpers/logged-fetch.ts` | wraps real `fetch`, logs each request so suites assert GET-only (SC-005) |
| `test/helpers/recorded-fetch.ts` | `recordingFetch(network, { dir, secrets })`: writes `{ request: { method, url, headers.accept? }, response: { status, headers, body } }` per request; drops `authorization`, `private-token`, `cookie`, `set-cookie`; replaces each secret with `[redacted]` (FR-041, FR-042) |

### Live test files

| File | Story |
|---|---|
| `test/gitlab/contract.test.ts` | US1 |
| `test/gitlab/lifecycle.test.ts` | US2 |
| `test/gitlab/coverage.test.ts` | US3 |
| `test/gitlab/recording.test.ts` | US4 |
