# Tasks: PR Context and Interrogation

**Input**: [plan.md](plan.md), [spec.md](spec.md), [data-model.md](data-model.md), [research.md](research.md), [contracts/](contracts/), [tests/behaviour-checklist.md](tests/behaviour-checklist.md)

**Scale note.** This is a greenfield build: about 60 source files and 30 test files across the server, the store, the repository manager, core services, four platform adapters, the AI adapter and the UI, covering 54 requirements and 77 verification obligations. Watch the three trust boundaries: `src/repo/` (constitution IX), `src/server/guard.ts` (X) and `src/adapters/claude-code-cli/` (FR-022, X.10). None of their safety tests may be weakened to get a task green.

**Format**: `- [ ] T### [P] [US#] [VO-nnn | NT: reason] Description · path`. IDs are not bolded, because the integrated-tdd gate reads `- [ ] T###` exactly. Every task carries a `[VO-nnn]` or `[NT: reason]` label. The first task naming an obligation writes its failing test; later tasks naming it make it pass.

**Ownership rules that shape the split:**

- Composition roots (`src/main.ts`, `src/ui/app.tsx`) belong to Polish, because both stories plug into them. Until then each story is exercised through `test/helpers/server.ts`, which starts the server with the route modules a test passes in.
- Route handlers are split by story: `src/server/routes/context.ts` (US1) and `src/server/routes/interrogation.ts` (US2). Each takes its dependencies as arguments, so `main.ts` wires them.
- `sessions.ts` (US1) never imports summaries or lanes. It takes `onSnapshot` and `onClose` callbacks, which `main.ts` points at US2's `summaries.ts` and `lanes.ts`.
- The platform-name guard (VO-036) rejects `github`, `bitbucket`, `jira`, `atlassian` and `claude` anywhere in `src/` outside `src/adapters/`. So `PlatformId` is a plain `string` in contracts, adapters declare their own display name and sign-in fields, and the UI renders sign-in forms from `/api/platforms`. Platforms are named only in `src/adapters/registry.ts` (US1) and the AI provider only in `src/adapters/ai-registry.ts` (US2).

---

## Phase 1: Setup

Files: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`

**Wave 1 — independent (different files):**

- [x] T001 [P] [NT: tooling, no behaviour] Create `package.json`: name `pr-review-workbench`, `"type": "module"`, `engines.node >=24`, `bin.prwb = bin/prwb.mjs`; scripts `test` = `node --test "test/**/*.test.ts"`, `test:live` = `node --test "test/live/*.live.ts"`, `typecheck` = `tsc --noEmit`, `build` = `tsc -p tsconfig.build.json`, `build:ui` = esbuild bundling `src/ui/app.tsx` and `src/ui/launch.ts` into `dist/ui/`, `dev` = `esbuild --watch` plus `node src/main.ts`; dependencies `@napi-rs/keyring`, `preact`; devDependencies `typescript`, `esbuild`, `@types/node`; run `npm install` · package.json
- [x] T002 [P] [NT: tooling, no behaviour] Create `tsconfig.json` (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`, `jsx: react-jsx`, `jsxImportSource: preact`, includes `src`, `test`) and `tsconfig.build.json` (emits `src/` to `dist/`, excludes `src/ui`) · tsconfig.json, tsconfig.build.json

**⟶ Wait for Wave 1 to finish, then:**

- [x] T003 [NT: process step, records the baseline] Record the integrated-tdd baseline: `python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py run --phase baseline --command test`, and confirm `npm run typecheck` runs; no test file exists yet, so if `node --test` fails on the unmatched glob, name that with `--note` · (no file)

---

## Phase 2: Foundational

**Blocks every story.** Shared helpers, contracts, the store, the git runner, the HTTP server and its guard, and the UI's static shell.

Files: `test/helpers/{app-data,git-sandbox,recorded-fetch,fake-keyring,server}.ts`, `src/appdata.ts`, `src/log.ts`, `src/config.ts`, `src/credentials.ts`, `src/contracts/{shared,source-control,issue-tracker,ai-provider,http}.ts`, `src/adapters/read-only-http.ts`, `src/repo/git.ts`, `src/repo/unified-diff.ts`, `src/core/limits.ts`, `src/store/{schema.sql,db.ts,review-store.ts}`, `src/server/{http,guard,routes,events}.ts`, `src/ui/{index.html,app.css,launch.html,launch.ts,api.ts,labels.ts}`

### Tests

Test files: `test/unit/{platform-names,appdata,log,config,credentials,read-only-http,git-commands,unified-diff,limits}.test.ts`, `test/integration/{review-store,server-bind}.test.ts`, `test/end-to-end/server-guard.test.ts`

**Wave 1 — independent (different files): test helpers**

- [x] T004 [P] [NT: test infrastructure] Temporary app-data directory per test, set through the env var `appdata.ts` reads, removed after the test · test/helpers/app-data.ts
- [x] T005 [P] [NT: test infrastructure] Git sandbox: bare "platform" repo, reviewer clone with remotes, PR branches, a fork, force-push; `fingerprint(clone)` returning current branch, HEAD, `ls-files -s` hash, `status --porcelain=v2`, `stash list`, every ref outside `refs/prwb/`, and FETCH_HEAD contents (XI.3) · test/helpers/git-sandbox.ts
- [x] T006 [P] [NT: test infrastructure] Recorded-fetch replayer: serves `test/fixtures/<platform>/*.json` by method and URL, logs every request with method, host and headers, and fails on an unrecorded request · test/helpers/recorded-fetch.ts
- [x] T007 [P] [NT: test infrastructure] In-memory keyring with the `@napi-rs/keyring` `Entry` shape, injectable into `credentials.ts` · test/helpers/fake-keyring.ts
- [x] T008 [P] [NT: test infrastructure] Test server: starts `src/server/http.ts` with the route modules passed in, performs the `/api/auth` exchange, and returns a client that sends the cookie, `Host` and `Origin` · test/helpers/server.ts

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files): failing tests**

- [x] T009 [P] [VO-036] Walk `src/` skipping `src/adapters/`; fail on any case-insensitive `github`, `bitbucket`, `jira`, `atlassian`, `claude`; prove the check fails on a planted file in a temp tree and passes on the real tree · test/unit/platform-names.test.ts
- [x] T010 [P] [VO-054] App-data dir on Windows (`LOCALAPPDATA`), macOS and Linux (`XDG_DATA_HOME`, default `~/.local/share`) env shapes; a clone path inside it is refused so the store and workspaces never resolve inside the clone · test/unit/appdata.test.ts
- [x] T011 [P] [VO-060] `log()` writes only the allowed fields; extra fields are dropped; registered secrets and `Authorization` values are scrubbed from `errorMessage`; files dated 8 days ago are deleted, 6 days ago kept · test/unit/log.test.ts
- [x] T012 [P] [VO-052] Config save: complete config accepted; missing `clonePath` refused naming the field; an extra `token` field refused with `unknown_field`; saved file holds no credential; limits default to 1,048,576 / 5,000 / 400,000 · test/unit/config.test.ts
- [x] T013 [P] [VO-040] Credentials: secret stored only in the keyring; no API returns it; `authorize()` adds the header; every loaded secret is registered with the log scrubber; `config.json` and log files never contain it · test/unit/credentials.test.ts
- [x] T014 [P] [VO-039] POST, PUT, PATCH and DELETE are refused before any network call; GET passes through; the recorded log holds only GETs · test/unit/read-only-http.test.ts
- [x] T015 [P] [VO-067] Read `git.ts`'s command table: no `checkout`, `switch`, `pull`, `merge`, `rebase`, `reset`, `stash`, `clean`, `worktree prune`; every call is an argument array with no shell; every ref written is under `refs/prwb/`; every call carries the hardened `-c` options · test/unit/git-commands.test.ts
- [x] T016 [P] [VO-047] Parse a unified diff with added, modified, renamed, deleted and binary files: status, lines added and removed, hunks with old and new line numbers · test/unit/unified-diff.test.ts
- [x] T017 [P] [VO-058] Per-file exclusion in order binary, file size, changed lines; prompt budget fills in diff order and marks the rest `prompt limit`; lowered limits change which files are left out · test/unit/limits.test.ts
- [x] T018 [P] [VO-055] Store: an UPDATE or DELETE on any history table aborts; `deleteSession` removes the session and every child row in one transaction; the session-status row is the only one that updates · test/integration/review-store.test.ts
- [x] T019 [P] [VO-042] The server listens on 127.0.0.1 on a port chosen at launch and is not reachable on any other local address · test/integration/server-bind.test.ts
- [x] T020 [P] [VO-043] [VO-044] [VO-045] No cookie and a wrong cookie get 401; the POST `/api/auth` exchange sets the `HttpOnly; SameSite=Strict` cookie; foreign `Host` gets 421; a GET or a POST with a foreign `Origin` gets 403, and a non-GET with no `Origin` gets 403; every response carries the CSP, `nosniff`, `no-referrer` and no `Access-Control-*`; the token never appears in logs · test/end-to-end/server-guard.test.ts

### Implementation

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — independent (different files), no internal dependencies:**

- [x] T021 [P] [VO-036] Shared contract types: `PlatformId` (string), `AdapterError` with codes `unauthorized`, `not_found`, `unavailable`, `truncated`, `Authorize`, `ReadOnlyFetch`, `AdapterDeps`, `SignInCheck`, and `AdapterDescriptor` (`id`, `displayName`, `signInFields`) so no core or UI file names a platform · src/contracts/shared.ts
- [x] T022 [P] [VO-054] Per-OS app-data resolution (R4); creates `logs/`, `workspaces/`, `provider-home/`, `empty-hooks/`; refuses a path inside a given repository · src/appdata.ts
- [x] T023 [P] [VO-060] JSON-lines logger with field allowlist, secret registry and scrubber, daily file `prwb-YYYY-MM-DD.log`, retention sweep (R18) · src/log.ts
- [x] T024 [P] [VO-047] Unified-diff parser shared by local and platform diffs (R11); also computes the diff fingerprint, SHA-256 of the normalised patch · src/repo/unified-diff.ts
- [x] T025 [P] [VO-058] `Limits` type with defaults; `excludedReason(file, limits)`; `fillBudget(files, maxPromptChars)` returning included files and `prompt limit` exclusions in diff order (FR-049) · src/core/limits.ts
- [x] T026 [P] [VO-055] Every table in data-model.md, foreign keys with `ON DELETE CASCADE`, `BEFORE UPDATE` abort triggers on every history table, `BEFORE DELETE` triggers that abort unless a `session_deletion` row exists, and the unique keys listed in the data model · src/store/schema.sql
- [x] T027 [P] [NT: pub/sub plumbing; its stream is verified by VO-032 in Phase 4] Per-session server-sent events hub: `subscribe(sessionId, res)`, `publish(sessionId, event, data)`, heartbeat, cleanup on close · src/server/events.ts
- [x] T028 [P] [VO-043] Launch page and script: read the fragment, POST it to `/api/auth`, `history.replaceState` to clear it, navigate to `/` · src/ui/launch.html, src/ui/launch.ts
- [x] T029 [P] [NT: static shell; layout checked by MV-001] UI shell page loading `/app.js` and `/app.css` with no inline script or style (CSP), and base styles · src/ui/index.html, src/ui/app.css
- [x] T030 [P] [NT: display-label constants; checked by MV-001] Stored-to-display label maps from contracts/ui.md (labels, categories, statuses, Answer for, intent groups, `no Jira access configured`) · src/ui/labels.ts

**⟶ Wait for Wave 3 to finish, then:**

**Wave 4 — independent (different files):**

- [x] T031 [P] [VO-036] `SourceControlProvider` contract, `PullRequestInfo`, `CommitInfo`, `ChangedFileInfo`, `HeadLocation` (provider-contracts.md) · src/contracts/source-control.ts
- [x] T032 [P] [VO-036] `IssueTracker` contract, `RawIssueReference`, `IssueLookup` · src/contracts/issue-tracker.ts
- [x] T033 [P] [VO-036] `AiProvider` contract, `RestrictionId`, `ProviderCapabilities`, `AskRequest`, `AskEvent` · src/contracts/ai-provider.ts
- [x] T034 [P] [VO-036] Wire types from http-api.md (`Config`, `SessionDetail`, `CompletenessRow`, `SnapshotDetail`, `FileDiff`, `Summary`, `Question`, `Answer`, `Claim`, `Ref`, `ErrorBody`, `ErrorCode`), shared by routes and UI · src/contracts/http.ts
- [x] T035 [P] [VO-039] GET-only fetch wrapper that throws before any network call on another method, maps 401/403 to `AdapterError('unauthorized')`, 404 to `not_found`, network and 5xx to `unavailable` (VIII.3, FR-027) · src/adapters/read-only-http.ts
- [x] T036 [P] [VO-052] Load, validate and save `<app-data>/config.json`; refuse unknown fields with `unknown_field` and missing ones naming the field; take registered platform ids as a parameter; default limits and `logRetentionDays` · src/config.ts
- [x] T037 [P] [VO-040] The one credential module: one keyring entry per platform under `pr-review-workbench`; `save`, `remove`, `has`, `account`, `authorize(platform)`; registers each loaded secret with the log scrubber; never returns a secret (R6, X.7, X.8) · src/credentials.ts
- [x] T038 [P] [VO-067] Git runner: `execFile` with an argument array; exported command table; hardened `-c core.hooksPath=<app-data>/empty-hooks -c core.fsmonitor=false -c protocol.file.allow=user -c submodule.recurse=false`; allowlisted env with `GIT_TERMINAL_PROMPT=0`; refuses any ref write outside `refs/prwb/` (R9) · src/repo/git.ts
- [x] T039 [P] [VO-055] `DatabaseSync` connection at `<app-data>/review.db`, `foreign_keys=ON`, WAL, applies `schema.sql` once · src/store/db.ts
- [x] T040 [P] [VO-043] [VO-044] [VO-045] Request guard: Host check (421), constant-time cookie check (401) except `/launch`, `/launch.js`, `/api/auth`; Origin check on every request that carries one, and `Origin` required on every non-GET (403; X.3, X.5); `/api/auth` exchange setting the cookie; security headers on every response; never a CORS header (R3) · src/server/guard.ts

**⟶ Wait for Wave 4 to finish, then:**

**Wave 5 — independent (different files):**

- [x] T041 [P] [VO-055] The only data access: `append*` and `read*` per entity, `upsertSessionStatus`, `deleteSession` (marker row, cascade, marker removed, one transaction), lookups by platform and issue key; no other update or delete · src/store/review-store.ts
- [x] T042 [P] [VO-045] Router: `RouteModule` type, path-pattern matching, JSON body parsing with size cap, boundary validation helpers, `ErrorBody` responses for every `ErrorCode`, 404 `not_found` for unknown routes, GET handlers given a read-only store view · src/server/routes.ts
- [x] T043 [P] [NT: thin client; exercised through the API end-to-end tests and MV-001] UI API client: typed `fetch` for every route in http-api.md, `ErrorBody` handling that routes `signin_required` to `#/signin`, and an `EventSource` wrapper that re-reads questions and summaries on reconnect · src/ui/api.ts

**⟶ Wait for Wave 5 to finish, then:**

- [x] T044 [VO-042] [VO-043] `node:http` server on `127.0.0.1`, port 0; runs the guard, serves `/launch`, `/launch.js`, `/`, `/app.js`, `/app.css` from `dist/ui/`, then dispatches to the route modules it is given; logs the route pattern, never the URL or headers · src/server/http.ts

**Checkpoint**: `npm run typecheck` and every Phase 2 test pass. Record a broad checkpoint run. No story work starts before this.

---

## Phase 3: User Story 1 — Open a PR and see what context exists (Priority: P1) 🎯 MVP

**Goal**: list open PRs, start or reopen one review session per PR, fetch the head into `refs/prwb/*`, create a detached worktree, compute the diff, collect issue references and issue evidence, and show the completeness list, all without touching the reviewer's branch, index, working tree or stash.

**Independent Test**: against a git sandbox with a dirty working tree and recorded platform fixtures, start a session through the API; check the PR details, issue references with origins, the completeness list, and that the clone's fingerprint is unchanged.

Files: `test/fixtures/{github,bitbucket,jira}/`, `src/adapters/registry.ts`, `src/adapters/github/{source-control,issues}.ts`, `src/adapters/bitbucket/source-control.ts`, `src/adapters/jira/{adf,issues}.ts`, `src/repo/manager.ts`, `src/core/{references,completeness,evidence,recovery,signins,sessions}.ts`, `src/server/routes/context.ts`, `src/ui/screens/{setup,signin,home,overview,issue,description}.tsx`

### Tests

Test files: `test/unit/{references,completeness}.test.ts`, `test/contract/{source-control,issue-tracker}.contract.test.ts`, `test/integration/{repo-safety,repo-fetch,workspace-lifecycle,session-context,session-delete}.test.ts`, `test/end-to-end/{sessions,no-clone,signin}.test.ts`

**Wave 1 — independent (different files):**

- [x] T045 [P] [US1] [NT: recorded API data, not behaviour] Record GitHub fixtures with tokens stripped: open PR list (3), PR detail open, merged, closed, closed then reopened, and deleted (404); commits; files; diff media type; a fork PR; `GET /user`; issues: one issue, one number that is a PR, one 404 · test/fixtures/github/
- [x] T046 [P] [US1] [NT: recorded API data, not behaviour] Record Bitbucket Cloud fixtures: open PR list, PR detail, commits, diffstat, diff, a fork PR, `GET /2.0/user`, a 401 · test/fixtures/bitbucket/
- [x] T047 [P] [US1] [NT: recorded API data, not behaviour] Record Jira Cloud fixtures: issue with ADF description, configured and unconfigured project keys, 404, 403, 500, `GET /rest/api/3/myself` · test/fixtures/jira/
- [x] T048 [P] [US1] [VO-063] The same issue in branch name, title and description in different forms becomes one reference carrying all three origins · test/unit/references.test.ts
- [x] T049 [P] [US1] [VO-027] Completeness for each input: head matches, head moved, platform unreachable; clone found and fetched, not found; no issue, issue fetched, unresolved, re-fetch failed; repository row lists per-file and `prompt limit` skipped files; PR and repository rows are never read from Evidence · test/unit/completeness.test.ts

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] T050 [P] [US1] [VO-022] One `SourceControlProvider` suite run against the GitHub and Bitbucket Cloud fixtures: PR info, commits, unified diff, changed-file metadata for the same PR shape; `headLocation` for a fork; deleted PR rejects `not_found` · test/contract/source-control.contract.test.ts
- [x] T051 [P] [US1] [VO-023] [VO-024] [VO-025] [VO-037] [VO-064] One `IssueTracker` suite run against Jira Cloud and GitHub Issues fixtures: configured key accepted, unconfigured key accepted only when lookup confirms; `#123` that is a PR returns `pull-request`, `owner/repo#45` an issue; ADF to plain text; no credential gives `no Jira access configured` without a request; wrong key and no access unresolved with reason · test/contract/issue-tracker.contract.test.ts
- [x] T052 [P] [US1] [VO-005] [VO-009] [VO-068] [VO-072] Fingerprint the clone before and after start, refresh, close, delete and a start-up sweep of a leftover worktree: on another branch with staged, unstaged and stashed changes; with the PR branch checked out; with `core.hooksPath` pointing at a tracked hooks dir whose `post-checkout` writes a marker (marker never appears, no file outside the workspace changes) · test/integration/repo-safety.test.ts
- [x] T053 [P] [US1] [VO-048] [VO-049] [VO-050] [VO-051] Fetch writes only `refs/prwb/<session>/<snapshot>/{head,target}` and leaves FETCH_HEAD, branches, index and stash as they were; a missing commit or unreachable fork gives repository row `missing` with reason and a platform diff; the workspace is a detached worktree at the head under `<app-data>/workspaces`; a local diff records `local` and its merge-base, no clone records `platform` and no base · test/integration/repo-fetch.test.ts
- [x] T054 [P] [US1] [VO-028] Close keeps every record and removes only the worktree; a leftover worktree from a killed run is removed from the clone's worktree list and from disk at start-up, and the reviewer's own worktrees are untouched · test/integration/workspace-lifecycle.test.ts
- [x] T055 [P] [US1] [VO-002] [VO-007] [VO-029] [VO-038] [VO-062] [VO-077] Branch key and description key both returned with origins; refresh after a new commit adds snapshot 2, keeps snapshot 1, lists files changed between heads, shows old-head evidence stale; issue re-fetch success appends `current`, failure appends `stale` with reason and keeps the last record; two sessions on the same issue found by platform and key; a force-push becomes a new snapshot with earlier ones kept; a refresh with an unchanged head after a successful fetch takes no snapshot, and after a failed fetch takes one for the same head · test/integration/session-context.test.ts
- [x] T056 [P] [US1] [VO-055] Deleting a session with snapshots, evidence and a workspace removes every record, the worktree and every `refs/prwb/<sessionId>/` ref; without `confirm: true` it is refused · test/integration/session-delete.test.ts
- [x] T057 [P] [US1] [VO-001] [VO-003] [VO-004] [VO-006] [VO-008] [VO-010] [VO-061] [VO-076] Over HTTP with recorded platforms: three PRs listed and any starts a session; no issue gives issue row `missing` and the session opens; a referenced issue's title and plain text returned with only GETs sent to the tracker; reopening returns the same session id with no new snapshot; a merged PR lists as merged, opens read-only, refresh refused with `read_only`; a moved head on open shows PR row stale and `headMoved` with no new snapshot and no platform call between opens; merged during a session, refresh reports the status instead of failing; a PR closed and then reopened on the platform opens read-only with `statusNote` `reopened on platform`, and refresh is refused with `read_only` · test/end-to-end/sessions.test.ts
- [x] T058 [P] [US1] [VO-026] No clone at the configured path, and a clone whose remotes point elsewhere: repository row `missing` with the reason, PR metadata and platform diff returned, `workspaceReady` false, no clone created · test/end-to-end/no-clone.test.ts
- [x] T059 [P] [US1] [VO-053] Sign-in per platform is checked by one read-only GET; Bitbucket Cloud's sign-in fields are email and API token with no app password; after GitHub returns 401 only GitHub reports `expired` and asks again, and the issue tracker still answers · test/end-to-end/signin.test.ts

### Implementation

**⟶ Wait for the tests above to be written and failing, then:**

**Wave 1 — independent (different files):**

- [x] T060 [P] [US1] [VO-022] GitHub source-control adapter over REST v3 (R16): list open, get PR (deleted → `not_found`), commits, files, unified diff, `cloneLocations`, `headLocation` = base repo + `refs/pull/<n>/head`, `targetLocation`, `verifySignIn` via `GET /user`, pagination cap reported as `truncated`, descriptor with display name and sign-in fields · src/adapters/github/source-control.ts
- [x] T061 [P] [US1] [VO-022] Bitbucket Cloud source-control adapter over REST 2.0 with Basic email and API token (R16): list, get, commits, diffstat, diff, `headLocation` = fork clone URL + source branch, `verifySignIn` via `GET /2.0/user`; sign-in fields email and API token, no app password · src/adapters/bitbucket/source-control.ts
- [x] T062 [P] [US1] [VO-004] [VO-024] [VO-037] [VO-064] GitHub Issues tracker: extract `#123` and `owner/repo#123`, expand short forms, lookup one GET per key returning issue or `pull-request`, body kept as plain text, unresolved with reason on 404 or 403 · src/adapters/github/issues.ts
- [x] T063 [P] [US1] [VO-025] Jira ADF node walker to plain text (paragraphs, lists, code, mentions, links as text) · src/adapters/jira/adf.ts
- [x] T064 [P] [US1] [VO-005] [VO-009] [VO-028] [VO-048] [VO-049] [VO-050] [VO-051] [VO-068] Repository manager (IX.2): match the clone by normalised remotes; fetch head and target with `--no-tags --no-write-fetch-head --no-recurse-submodules` into `refs/prwb/<session>/<snapshot>/{head,target}` using the clone's remote scheme; verify the fetched head equals the PR head; `merge-base`; `--numstat -z` and `--patch` diff; `cat-file -s` sizes; `worktree add --detach`, `worktree remove --force <path>`, `worktree list --porcelain`; `update-ref -d` for a session's refs; changed files between two heads · src/repo/manager.ts
- [x] T065 [P] [US1] [VO-002] [VO-038] [VO-063] Collect references: run the tracker's `extractReferences` over branch, title and description, merge by `(platform, key)` keeping every origin, keep Jira keys only when configured or confirmed by lookup, mark `pull-request` kind (FR-003, R15) · src/core/references.ts
- [x] T066 [P] [US1] [VO-003] [VO-027] Derive the PR, repository and issue rows from session status, latest snapshot and latest Evidence per issue; list skipped files from the snapshot's changed files plus the latest completed summary prompt's `prompt limit` exclusions read from the store (FR-007, FR-049) · src/core/completeness.ts
- [x] T067 [P] [US1] [VO-007] [VO-029] Capture issue Evidence for every `issue`-kind reference with the transitions in data-model.md (`current`, `missing`, `stale` with `lastGoodId`); derived staleness for commit-bound evidence; each lookup isolated so one failure is a gap (FR-011, FR-032) · src/core/evidence.ts
- [x] T068 [P] [US1] [NT: UI rendering; checked by MV-001] Setup screen: repository platform and id, clone path, tracker platform, site, project keys, limits; field errors from `invalid_request` and `unknown_field` · src/ui/screens/setup.tsx
- [x] T069 [P] [US1] [NT: UI rendering; checked by MV-001] Sign-in screen rendering one `signin-form-<platform>` per configured platform from the fields `/api/platforms` returns; the secret input is never echoed back · src/ui/screens/signin.tsx
- [x] T070 [P] [US1] [NT: UI rendering; checked by MV-001] Home screen: `pr-list` with `pr-item-<number>`, and `session-list` with each session's `session-status` · src/ui/screens/home.tsx
- [x] T071 [P] [US1] [NT: UI rendering; checked by MV-001] Overview screen without summaries (US2 adds them through `app.tsx`): title, branches, status, Refresh only while open else `read-only-notice` with any status note, Close, Delete with confirm, completeness rows with `data-status`, issues with reasons, `skipped-file-<path>`, `changed-file-<path>` rows linking to the diff route · src/ui/screens/overview.tsx
- [x] T072 [P] [US1] [NT: UI rendering; checked by MV-001] Issue view: stored title and plain-text description as text nodes · src/ui/screens/issue.tsx
- [x] T073 [P] [US1] [NT: UI rendering; checked by MV-001] PR description view as a text node, the target of a `pr` ref · src/ui/screens/description.tsx

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] T074 [P] [US1] [VO-023] [VO-025] [VO-037] [VO-064] Jira Cloud tracker: extract `[A-Z][A-Z0-9]+-\d+`, accept configured project keys, confirm others by lookup; `GET /rest/api/3/issue/{key}?fields=summary,description` with Basic email and token; ADF via `adf.ts`; no credential gives `no Jira access configured` with no request; `verifySignIn` via `/myself` · src/adapters/jira/issues.ts
- [x] T075 [P] [US1] [VO-028] [VO-072] Start-up workspace sweep: for every directory under `<app-data>/workspaces`, remove its worktree from the owning clone by path and delete the directory; never `worktree prune` (FR-009) · src/core/recovery.ts

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — one task:**

- [x] T076 [US1] [VO-022] [VO-037] [VO-053] Platform registry: maps `github`, `bitbucket-cloud`, `github-issues`, `jira-cloud` to adapter factories given `AdapterDeps`; lists source-control and tracker descriptors for `/api/platforms` · src/adapters/registry.ts

**⟶ Wait for T076 to finish, then:**

**Wave 4 — independent (different files):**

- [x] T077 [P] [US1] [VO-053] Sign-in service: save through `credentials.ts` after a passing `verifySignIn`, otherwise `signin_rejected`; in-memory state `signed-in`, `signed-out`, `expired`; an `AdapterError('unauthorized')` marks only that platform expired (FR-040, EC-13) · src/core/signins.ts
- [x] T078 [P] [US1] [VO-005] [VO-006] [VO-007] [VO-008] [VO-009] [VO-010] [VO-026] [VO-028] [VO-038] [VO-051] [VO-055] [VO-061] [VO-062] [VO-072] [VO-076] [VO-077] Sessions: `start` (platform PR, match clone, fetch, worktree, diff local or platform, per-file exclusions, references, evidence, append snapshot and session in one transaction, then `onSnapshot`), `open` (check head and status only, recreate worktree, never snapshot; a closed PR reopened on the platform stays read-only with `statusNote` `reopened on platform`), `refresh` (status, issues, new snapshot only when head moved or last fetch failed, then `onSnapshot`; closed or merged → `read_only`), `close` (remove worktree, `onClose`), `delete` (store delete, worktree, refs); every source failure is a gap (FR-032) · src/core/sessions.ts

**⟶ Wait for Wave 4 to finish, then:**

- [x] T079 [US1] [VO-001] [VO-003] [VO-004] [VO-026] [VO-053] Context routes, taking their dependencies as arguments: `GET/PUT /api/config`, `GET /api/platforms` (AI provider ids passed in), `GET /api/signins`, `PUT /api/signins/:platform`, `GET /api/pulls`, `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST …/open`, `POST …/refresh`, `POST …/close`, `DELETE /api/sessions/:id`, `GET …/snapshots/:snapshotId`, `GET …/events`; boundary validation; `platform_error` only for pulls and session start · src/server/routes/context.ts

**Checkpoint**: User Story 1 works on its own. Every Phase 3 test passes through `test/helpers/server.ts` with the context routes; the clone fingerprint is unchanged across start, refresh and close. Record a broad checkpoint run.

---

## Phase 4: User Story 2 — Understand the change and ask questions about it (Priority: P1)

**Goal**: summaries per snapshot, scoped and categorised questions, streamed answers replaced by checked, labelled claims, follow-ups, cancel, the per-session queue, the diff and code views, and the AI provider running under the FR-022 restrictions.

**Independent Test**: on a session from Story 1 with the fake AI CLI, summaries complete; a range-scoped Why question and a whole-PR question each return labelled claims whose Evidence references resolve; the clone fingerprint is unchanged.

Files: `test/fixtures/fake-claude/`, `test/helpers/fake-ai-cli.ts`, `src/adapters/ai-registry.ts`, `src/adapters/claude-code-cli/{schemas,stream,capabilities,provider}.ts`, `src/repo/files.ts`, `src/core/{suggestions,lanes,prompt,claims,interrogation,summaries,work-recovery}.ts`, `src/server/routes/interrogation.ts`, `src/ui/components/{claims,summaries}.tsx`, `src/ui/screens/{diff,code,ask}.tsx`

### Tests

Test files: `test/unit/{suggestions,prompt,claims,ai-capabilities,interrogation}.test.ts`, `test/integration/{work-recovery,ai-invocation}.test.ts`, `test/live/live-cli.live.ts`, `test/end-to-end/{diff,summaries,interrogation,supersede}.test.ts`

**Wave 1 — independent (different files):**

- [x] T080 [P] [US2] [NT: test infrastructure] Fake AI CLI: a Node script that answers `--version` and `--help` (variants chosen by env), and on `-p` writes stream-json `stream_event` deltas then a `result`, for scenarios structured, unstructured, slow, error-on-start, not-signed-in; records argv, env and stdin to a file · test/fixtures/fake-claude/fake-claude.mjs
- [x] T081 [P] [US2] [NT: test infrastructure] Helper that puts the fake CLI first on `PATH`, selects its scenario, and reads its recorded invocations · test/helpers/fake-ai-cli.ts
- [x] T082 [P] [US2] [VO-030] `pr`, `file` and `range` scopes each return their own fixed templates, covering every category · test/unit/suggestions.test.ts
- [x] T083 [P] [US2] [VO-034] [VO-069] PR description and code imitating the end marker and "ignore previous rules": instructions hold no PR, issue or code text and the data block closes only at its per-request nonce marker; a plain question and a follow-up with the same scope get `<head>:<sha256>` context versions that differ · test/unit/prompt.test.ts
- [x] T084 [P] [US2] [VO-013] [VO-014] [VO-031] Evidence claims citing a missing path, a line past the end, an unfetched issue, or only the PR description become Inference with per-ref reasons, and one resolving ref keeps Evidence; output failing validation becomes one Inference with `unstructured`; intent citing the PR description or an issue is documented, citing only code is inferred · test/unit/claims.test.ts
- [x] T085 [P] [US2] [VO-033] Capability probe on help text lacking `--restricted`, lacking only `--strict-mcp-config`, lacking only `--add-dir`: the first two make the provider unavailable with the reason; the third leaves it available with (a) and (b) not enforced · test/unit/ai-capabilities.test.ts
- [x] T086 [P] [US2] [VO-035] With one configured provider, a question starts exactly one provider run and the stored answer names that one provider · test/unit/interrogation.test.ts
- [x] T087 [P] [US2] [VO-066] Store with a question that has chunks and no terminal row, a queued question with no prompt, and a summary run in progress: recovery appends `cancelled` with `restart`, chunks become one Inference, the queued question is cancelled with no claims · test/integration/work-recovery.test.ts
- [x] T088 [P] [US2] [VO-017] [VO-018] [VO-071] Live CLI, run only by `npm run test:live` and never skipped (without an installed, signed-in CLI it fails, to be classified `environment` and deferred): a PR adding a `.claude/settings.json` hook that writes a marker and a `CLAUDE.md` planting a first word — no marker anywhere, no answer or summary starts with the word; a Business question has no changed-line identifier in claim text and cites code and the issue; reading a file outside the workspace and fetching a URL both fail · test/live/live-cli.live.ts
- [x] T089 [P] [US2] [VO-047] Over HTTP, `…/diff?path=` for added, modified, renamed and deleted files returns status, lines added and removed, and hunks; a binary file returns `binary` with no hunks · test/end-to-end/diff.test.ts
- [x] T118 [P] [US2] [VO-074] With the fake CLI recording its invocation, the provider answers a question: argv holds `--restricted`, `--tools Read,Grep,Glob`, `--strict-mcp-config`, `--disable-slash-commands` and `--add-dir <worktree>` as the only added directory; cwd is an empty directory under `provider-home/`, outside the worktree and the clone; env holds no token from the fake keyring; PR, issue and code text appear only on stdin, never in argv · test/integration/ai-invocation.test.ts

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] T090 [P] [US2] [VO-011] [VO-021] [VO-046] [VO-065] Over HTTP with the fake CLI: a new snapshot generates summaries without a request, holding a PR summary, one per changed file, and functional and technical impact as labelled claims; after refresh, new summaries are generated and older ones keep their head commit; provider failing on start shows summaries `failed` with the reason while PR, diff and repository rows still return; CLI missing and not signed in report `provider_unavailable` while context loads; a no-clone session queues no summary and reports the repository row's reason (the US2 half of VO-026, whose first test is T058) · test/end-to-end/summaries.test.ts
- [x] T091 [P] [US2] [VO-012] [VO-015] [VO-016] [VO-019] [VO-020] [VO-032] [VO-056] [VO-057] [VO-059] [VO-070] [VO-073] Over HTTP with the fake CLI: range 40–60 Why question stored with scope and category and its prompt scoped to the range; Business stored and the prompt carries the business rule; after a server restart on the same store the answer returns with provider, time and context version; a removed line opens at base and a non-diff file at head via `/file`; a follow-up stores its parent and its prompt holds the parent and its claims but not the first question; deltas arrive marked in progress, then claims replace them; cancel mid-answer keeps the text as one cancelled Inference; assumptions returned apart from claims; three questions during a summary run one at a time in order, a cancelled queued one never runs; completed answers have no in-progress marker; a read-only session and a no-clone session refuse questions with `read_only` and `workspace_unavailable` (the US2 halves of VO-008 and VO-026, whose first tests are T057 and T058); the clone fingerprint is unchanged across a question answered and a question cancelled mid-answer · test/end-to-end/interrogation.test.ts
- [x] T119 [P] [US2] [VO-075] Over HTTP with the fake CLI in its slow scenario: a question runs on snapshot 1 while another question and snapshot 1's summary run wait; a refresh takes snapshot 2; the running question completes against snapshot 1, the waiting question and summary run end `cancelled` with `superseded` and the fake CLI records no run for them, and snapshot 2's summaries are queued · test/end-to-end/supersede.test.ts

### Implementation

**⟶ Wait for the tests above to be written and failing, then:**

**Wave 1 — independent (different files):**

- [x] T092 [P] [US2] [NT: static JSON schema data; its use is verified by VO-013 and VO-014] Answer and summary JSON schemas with the embedded claim `$defs`, exactly as provider-contracts.md · src/adapters/claude-code-cli/schemas.ts
- [x] T093 [P] [US2] [VO-032] Stream-json line parser: `stream_event` text deltas to `{type: 'delta'}`, `result` to `{type: 'result', output}`, errors to `{type: 'error'}` · src/adapters/claude-code-cli/stream.ts
- [x] T094 [P] [US2] [VO-033] [VO-065] Capability probe: resolve the native executable without a shell (on Windows `claude.exe` or `node` plus the package entry), run `--version` and `--help`, map flags to restrictions (a) to (e), unavailable when not installed, not signed in, or (c) or (d) unenforced (R12) · src/adapters/claude-code-cli/capabilities.ts
- [x] T095 [P] [US2] [VO-013] [VO-019] File access at a commit for reference checks and the code view: `cat-file -e`, line count, `show <commit>:<path>`; `not_found` when the commit is gone · src/repo/files.ts
- [x] T096 [P] [US2] [VO-030] Fixed suggested-question templates per scope type and category (FR-015) · src/core/suggestions.ts
- [x] T097 [P] [US2] [VO-059] [VO-075] Per-session work lanes: one summary lane and one question lane, each one job at a time, FIFO by `seq`, cancel before start, `cancelQueued(reason)` for superseded work, stop on close (FR-053, R17) · src/core/lanes.ts
- [x] T098 [P] [US2] [NT: UI rendering; checked by MV-001] Claims list: `claim` with `data-label` and `data-intent`, documented and inferred intent grouped apart, `claim-ref` opening the code, issue or description route, `answer-warning`, `context-version`, `restrictions-not-enforced` · src/ui/components/claims.tsx
- [x] T099 [P] [US2] [NT: UI rendering; checked by MV-001] Diff screen: file status and counts, hunks, `diff-line-head-<n>` and `diff-line-base-<n>` selection to a range scope on either side, whole-file scope, `scope-label-input` · src/ui/screens/diff.tsx
- [x] T100 [P] [US2] [NT: UI rendering; checked by MV-001] Code view at a snapshot's head or base, scrolled to the cited line · src/ui/screens/code.tsx

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2 — independent (different files):**

- [x] T101 [P] [US2] [VO-017] [VO-033] [VO-035] [VO-071] [VO-074] `AiProvider` for the Claude Code CLI: per-request empty `cwd` under `provider-home/`, arguments from R12 (`--restricted --tools Read,Grep,Glob --strict-mcp-config --disable-slash-commands --no-session-persistence --add-dir <worktree> --json-schema … --append-system-prompt …`), data on stdin, allowlisted env with no platform token, `cancel` kills the process, `cwd` removed after · src/adapters/claude-code-cli/provider.ts
- [x] T102 [P] [US2] [VO-012] [VO-015] [VO-018] [VO-020] [VO-034] [VO-069] Prompt builder: fixed instructions with the audience rule, data block `<<<PRWB-DATA nonce>>> … <<<END nonce>>>` holding scope, category, question, PR text, issues' plain text, parent question and claims for a follow-up only, then file diffs in diff order within the budget from `limits.ts`; Requirements questions draw only on issue text; context version `<head>:<sha256(data without nonce)>`; `excludedFiles` (R14, FR-050) · src/core/prompt.ts
- [x] T103 [P] [US2] [VO-013] [VO-014] [VO-031] [VO-056] [VO-057] Claims finaliser: hand-written guard for the answer and summary shapes; resolve `code` refs through `files.ts`, `issue` refs against the session's fetched issues, `pr` refs against the description; the workbench decides `label` and `intent`; unstructured and cancelled text become one Inference with a warning; assumptions and follow-ups kept apart (R13) · src/core/claims.ts
- [x] T104 [P] [US2] [NT: UI rendering; checked by MV-001] Summaries panel: `pr-summary`, `file-summary-<path>`, `functional-impact`, `technical-impact`, streamed `answer-raw-text` while in progress, skipped files, `older-snapshot-marker`, `provider-unavailable`, and the repository row's reason when there is no isolated workspace · src/ui/components/summaries.tsx
- [x] T105 [P] [US2] [NT: UI rendering; checked by MV-001] Interrogation panel: `scope-indicator`, `category-*`, `answer-for-*` defaulting to Technical, `suggested-question`, `question-input`, `ask-button`, `question-<id>` with `data-state` and `data-head-commit`, `cancel-question-<id>`, `answer-raw-text`, claims, `unsupported-assumptions`, `suggested-follow-up`, `answer-provenance` · src/ui/screens/ask.tsx

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3 — independent (different files):**

- [x] T106 [P] [US2] [VO-033] AI registry: maps `claude-code-cli` to its provider factory and exposes its id for `/api/platforms` · src/adapters/ai-registry.ts
- [x] T107 [P] [US2] [VO-008] [VO-012] [VO-016] [VO-020] [VO-021] [VO-026] [VO-032] [VO-035] [VO-056] [VO-057] [VO-059] [VO-070] [VO-073] Interrogation: refuse unless open, latest snapshot, repository found and provider available; append the question; queue on the question lane; on start append the stored prompt; append each delta as a chunk and publish `answer-delta`; on result finalise claims and append the answer; cancel queued or running; follow-ups copy and revalidate the parent scope (data-model open point 6) · src/core/interrogation.ts
- [x] T108 [P] [US2] [VO-011] [VO-021] [VO-026] [VO-046] [VO-058] [VO-075] Summaries: `onSnapshot` cancels the older snapshot's queued summary run and queued questions as `superseded` through `lanes.cancelQueued`, then queues a run on the summary lane, but only when the snapshot has an isolated workspace (FR-005); same streaming, finalising and failure handling as questions, writing summary sections per kind and file · src/core/summaries.ts
- [x] T109 [P] [US2] [VO-066] Start-up recovery of interrupted AI work: append `cancelled` with `restart` for every question and summary run with no terminal record, chunks becoming one Inference · src/core/work-recovery.ts

**⟶ Wait for Wave 3 to finish, then:**

- [x] T110 [US2] [VO-012] [VO-016] [VO-019] [VO-046] [VO-047] [VO-065] Interrogation routes, taking their dependencies as arguments: `GET /api/provider`, `GET …/snapshots/:id/summaries`, `GET …/snapshots/:id/diff`, `GET …/snapshots/:id/file`, `GET /api/suggestions`, `GET/POST /api/sessions/:id/questions`, `POST …/questions/:qid/cancel`; boundary validation of `AskBody` and scope · src/server/routes/interrogation.ts

**Checkpoint**: User Story 2 works on top of User Story 1. Every Phase 4 test passes with the fake CLI. Run `npm run test:live` with the real CLI installed and signed in; if it cannot run, classify the run `environment` and defer VO-017, VO-018 and VO-071, never report them verified. Record a broad checkpoint run.

---

## Phase 5: Polish & Cross-Cutting Concerns

Files: `src/main.ts`, `bin/prwb.mjs`, `src/ui/app.tsx`, `README.md`

### Tests

Test files: `test/end-to-end/full-app.test.ts`

- [x] T111 [VO-041] Start the composed app from `main.ts` with known tokens in the fake keyring, the recorded-fetch spy and the fake CLI; run a full session with summaries and a question: no token in config, logs, store file, any response, AI argv, env or stdin; requests reach only configured hosts and the only child processes are git, the AI CLI and the browser opener; every GET route leaves the store unchanged and carries the CSP; log lines hold only allowed fields with no code, diff, prompt, answer, PR or issue text; the clone fingerprint is unchanged (SC-001). This file also carries the full-session halves of VO-040, VO-045 and VO-060, whose first tests are T013, T020 and T011 · test/end-to-end/full-app.test.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] T112 [P] [VO-028] [VO-040] [VO-041] [VO-045] [VO-060] [VO-066] Launcher `startWorkbench()`: resolve app-data, logger and daily retention, store, credentials, adapters from both registries over `read-only-http`, sign-ins, sessions with `onSnapshot` and `onClose` wired to summaries and lanes, both route modules, start-up sweep (`recovery.ts`, then `work-recovery.ts`), server, launch token, print the URL and open the browser with `execFile` (`open`, `xdg-open`, `rundll32`); on SIGINT and SIGTERM close every open session's workspace (FR-042) · src/main.ts
- [x] T113 [P] [NT: UI composition; checked by MV-001] Hash router composing every screen: `#/setup` first when config is null, `#/signin` on `signin_required`, home, overview with the summaries panel, diff, code, issue, description, ask · src/ui/app.tsx
- [x] T114 [P] [NT: npx entry, no behaviour of its own] `#!/usr/bin/env node` entry that imports `dist/main.js` and calls `startWorkbench()` · bin/prwb.mjs
- [x] T115 [P] [NT: documentation] README: `npx` start, configuration, per-platform sign-in, what the workbench never does, where data lives, `npm run test:live` for the real-CLI suite · README.md

**⟶ Wait for Wave 1 to finish, then:**

- [ ] T116 [NT: manual verification, recorded with tdd_check.py manual] Run MV-001 to MV-005 and record each: walk the screens against W1, W2, W4; one real Bitbucket Cloud PR with a real Jira Cloud issue (SC-002); evaluator ratings outside the workbench (SC-003, SC-009, SC-011); review the data model, API and every screen for any score, rank or timing of a person (FR-031); time first summary and first answer text (SC-006, SC-007) · (no file)
- [x] T117 [NT: suite run that validates the Success Criteria] Run `npm run typecheck`, `npm run build`, `npm run build:ui` and `npm test` as a broad checkpoint through `tdd_check.py run`, and `npm run test:live` through `tdd_check.py run --command test-live`; run `tdd_check.py tasks` and `tdd_check.py compliance`; confirm SC-001, SC-004, SC-005 and SC-010 from the automated results · (no file)

---

## Dependencies & Execution Order

**Phases**: Setup → Foundational → US1 → US2 → Polish. US2 depends on US1 because every question needs a review session and its workspace; the two cannot run in parallel. Polish depends on both, since it owns the composition roots.

**Waves within each phase:**

- **Phase 1**: Wave 1 (T001, T002) → T003 baseline.
- **Phase 2**: Wave 1 helpers (T004–T008) → Wave 2 failing tests (T009–T020) → Wave 3 dependency-free modules (T021–T030) → Wave 4 contracts, config, credentials, git, db, guard (T031–T040) → Wave 5 store, router, UI client (T041–T043) → T044 server.
- **Phase 3 (US1)**: Tests Wave 1 fixtures and unit tests (T045–T049) → Tests Wave 2 (T050–T059) → Impl Wave 1 adapters, manager, core, UI (T060–T073) → Wave 2 Jira tracker, recovery (T074–T075) → T076 registry → Wave 4 sign-ins, sessions (T077–T078) → T079 context routes.
- **Phase 4 (US2)**: Tests Wave 1 (T080–T089, T118) → Tests Wave 2 end-to-end (T090–T091, T119) → Impl Wave 1 (T092–T100) → Wave 2 provider, prompt, claims, panels (T101–T105) → Wave 3 AI registry, interrogation, summaries, work recovery (T106–T109) → T110 interrogation routes.
- **Phase 5**: T111 test → Wave 1 (T112–T115) → T116 manual checks → T117 suite run.

**Parallel opportunities**: every `[P]` task in a wave can run at once. Phase 2's Waves 2 to 4 are wide enough to split across workers; each story phase goes to one worker, since US2 waits for US1.
