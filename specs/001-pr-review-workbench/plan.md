# Implementation Plan: PR Context and Interrogation

**Branch**: `001-pr-review-workbench` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)
**Inputs**: the feature spec, constitution 1.1.0, `MVP/MVP.md`, ADR 0001, `docs/domain_knowledge/CONTEXT.md`

**Scale note.** This is the first code in a greenfield repository: about 60 source files across seven areas (server, store, repository manager, core services, four platform adapters plus the AI adapter, and the browser UI) and 54 requirements. Watch the three trust boundaries most closely: the repository manager (constitution IX), the local HTTP server (X) and the AI adapter's restrictions (FR-022, X.10). Each has its own safety tests, and none of them may be simplified.

## Summary

A reviewer runs one `npx` command, which starts a local Node.js server on `127.0.0.1` and opens the browser UI. They pick an open PR, and the workbench builds a review session: PR metadata from the platform, the PR head fetched into an app-owned ref namespace of their existing clone, a detached worktree as the isolated workspace, a locally computed diff, linked issues fetched read-only, and a context-completeness list. Summaries generate automatically per snapshot. The reviewer asks scoped, categorised questions, and answers stream from the Claude Code CLI running with read and search tools only, and are then replaced by labelled claims whose references the workbench checks against the snapshot's commits.

The stack is TypeScript in `strict` mode on Node.js 24, run from source through Node's built-in type stripping. It uses the platform where it can: `node:http` for the server, `node:sqlite` for the review store, `node:test` for tests, and the `git` CLI for repository access. Two runtime dependencies are added: `@napi-rs/keyring` for the OS keychain, and `preact` for the UI, bundled by `esbuild` (see [research.md](research.md), R5 to R8).

## Project Structure

```text
package.json                  engines node >=24; bin prwb; scripts dev, test, test:live, typecheck, build, build:ui
tsconfig.json                 strict, erasableSyntaxOnly, noEmit (development runs from source)
tsconfig.build.json           emits dist/ for the published package (Node does not strip types under node_modules)
bin/prwb.mjs                  npx entry
src/
  main.ts                     composition root and launcher: app-data dir, start-up sweep, server, open browser
  appdata.ts                  per-OS application-data directory (FR-043)
  log.ts                      structured JSON-lines log, 7-day rotation, secret scrubber (FR-054)
  config.ts                   repository, clone path, tracker, limits; no credentials (FR-039)
  credentials.ts              the one credential-store module (FR-028, X.7, X.8)
  server/
    http.ts                   node:http on 127.0.0.1, random free port (X.1)
    guard.ts                  launch-token cookie, Host and Origin checks, CSP (X.2 to X.5)
    routes.ts                 router: route modules, path matching, boundary validation, error bodies
    routes/context.ts         US1 routes: config, platforms, sign-ins, pulls, sessions, snapshots, events
    routes/interrogation.ts   US2 routes: provider, summaries, diff, file, suggestions, questions
    events.ts                 server-sent events per session (streaming, queue state)
  contracts/                  shared, source-control, issue-tracker, ai-provider (VIII.1), http wire types
  adapters/                   the only code that names a platform (VIII.2)
    registry.ts               platform id to adapter factory
    ai-registry.ts            AI provider id to provider factory
    read-only-http.ts         fetch wrapper that refuses every method but GET (VIII.3)
    github/                   source-control.ts and issues.ts (GitHub Issues)
    bitbucket/                source-control.ts (Bitbucket Cloud)
    jira/                     issues.ts and adf.ts (Jira Cloud, ADF to plain text)
    claude-code-cli/          provider.ts, capabilities.ts (restriction probe), stream.ts, schemas.ts
  repo/
    git.ts                    execFile runner, argument arrays, hardened -c options
    manager.ts                the Repository manager (IX.2): clone match, fetch, worktree, diff
    files.ts                  file access at a commit for reference checks and the code view
    unified-diff.ts           one parser for local and platform diffs
  core/
    sessions.ts               start, open, refresh, close, delete; read-only rule (FR-006, FR-041)
    signins.ts                per-platform sign-in state (FR-040)
    references.ts             issue reference collection and de-duplication (FR-003)
    evidence.ts               issue evidence capture and staleness (FR-011)
    completeness.ts           derives the completeness list (FR-007)
    limits.ts                 file exclusion and prompt budget (FR-049)
    prompt.ts                 delimited prompt assembly, context version (FR-022e, FR-050)
    claims.ts                 parse, check references, downgrade (FR-017 to FR-019)
    interrogation.ts          questions, follow-ups, cancel (FR-021, FR-047)
    lanes.ts                  per-session summary and question lanes (FR-053)
    summaries.ts              per-snapshot summaries (FR-012)
    suggestions.ts            fixed question templates (FR-015)
    recovery.ts               start-up sweep of leftover workspaces (FR-009)
    work-recovery.ts          start-up recovery of interrupted AI work (EC-11)
  store/
    db.ts                     node:sqlite connection and migrations
    schema.sql                tables and append-only triggers (III.2)
    review-store.ts           the only data access; no update or delete for history
  ui/                         Preact app: launch page, shell, API client, labels, app.tsx router,
                              screens (setup, sign-in, home, overview, diff, code, issue, description, ask),
                              components (claims, summaries)
test/
  unit/  integration/  contract/  end-to-end/
  live/                       real Claude Code CLI suites (*.live.ts), run by test:live only
  helpers/                    git sandbox with safety fingerprint, fake AI CLI, recorded-fetch replayer, test server
  fixtures/                   recorded GitHub, Bitbucket Cloud and Jira Cloud responses; fake CLI scripts
```

**Structure Decision**: one package with the server, the store and the UI in one TypeScript codebase (constitution P.1). Platform knowledge lives only under `src/adapters/`, and git runs only through `src/repo/`. Both boundaries are enforced by tests (VIII.2, IX.2).

## Call paths

Every file below is new.

```calls Start a review session
+ POST /api/sessions **new** @ src/server/routes/context.ts
+   startSession() **new** @ src/core/sessions.ts
+     SourceControlProvider.getPullRequest() **new** @ src/adapters/registry.ts
+     RepositoryManager.fetchHead() **new** @ src/repo/manager.ts
+     RepositoryManager.createWorkspace() **new** @ src/repo/manager.ts
+     RepositoryManager.diff() **new** @ src/repo/manager.ts
+     collectReferences() **new** @ src/core/references.ts
+     captureIssueEvidence() **new** @ src/core/evidence.ts
+     ReviewStore.appendSnapshot() **new** @ src/store/review-store.ts
+     enqueueSummaries() **new** @ src/core/summaries.ts
```
note: each source failure is caught at its own call and recorded as a gap; none aborts the session start (FR-032). `sessions.ts` reaches `enqueueSummaries()` through the `onSnapshot` callback that `src/main.ts` wires, and nothing is queued without an isolated workspace (FR-005).

```calls Answer a question
+ POST /api/sessions/:sessionId/questions **new** @ src/server/routes/interrogation.ts
+   askQuestion() **new** @ src/core/interrogation.ts
+     buildPrompt() **new** @ src/core/prompt.ts
+     AiProvider.ask() **new** @ src/adapters/claude-code-cli/provider.ts
+     publish() **new** @ src/server/events.ts
+     finaliseClaims() **new** @ src/core/claims.ts
+       RepositoryManager.resolveReference() **new** @ src/repo/manager.ts
+     ReviewStore.appendAnswer() **new** @ src/store/review-store.ts
```
note: streamed chunks are appended to the store as they arrive, so a crash leaves the partial text to keep as cancelled (FR-045).

```calls Refresh a session
+ POST /api/sessions/:sessionId/refresh **new** @ src/server/routes/context.ts
+   refreshSession() **new** @ src/core/sessions.ts
+     SourceControlProvider.getPullRequest() **new** @ src/adapters/registry.ts
+     RepositoryManager.fetchHead() **new** @ src/repo/manager.ts
+     markCommitEvidenceStale() **new** @ src/core/evidence.ts
+     captureIssueEvidence() **new** @ src/core/evidence.ts
+     ReviewStore.appendSnapshot() **new** @ src/store/review-store.ts
+     enqueueSummaries() **new** @ src/core/summaries.ts
```
note: a refresh takes a new snapshot only when the head moved or the latest snapshot's fetch failed (FR-052); work still queued for the older snapshot is cancelled as superseded (FR-051).

## States

```states Question
Queued: Waiting behind the running question in this session. (start) shows interrogation
Running: Raw text streams, marked in progress and not yet checked. shows interrogation
Completed: Labelled claims replace the raw text, references checked. (final) shows interrogation
Cancelled: Text so far kept as one Inference, marked cancelled. (final) shows interrogation
Failed: The provider errored; kept with the reason as a visible gap. (final) shows interrogation
Queued -> Running: previous question ends
Queued -> Cancelled: user cancels, a refresh supersedes it, or the workbench restarts
Running -> Completed: provider finishes
Running -> Cancelled: user cancels or workbench restarts
Running -> Failed: provider error
grid:
Queued | Running | Completed
.      | Cancelled | Failed
```
note: a summary run follows the same states on its own lane. Without an isolated workspace no question or summary is queued (FR-005).

```states Review session
Active: PR open and the latest snapshot is the platform head. (start) shows overview
HeadMoved: Platform head has moved; PR row stale, refresh offered. shows overview
ReadOnly: PR closed or merged; history readable, no refresh or questions. (final) shows overview
Deleted: Removed with every record, workspace and app-owned ref. (final)
Active -> HeadMoved: open finds a new head
HeadMoved -> Active: user refreshes
Active -> ReadOnly: PR closed or merged
HeadMoved -> ReadOnly: PR closed or merged
Active -> Deleted: user confirms delete
grid:
Active | HeadMoved | ReadOnly
Deleted | . | .
```
note: delete is offered from every state; closing a session keeps it in its state and only removes the workspace. A PR reopened on the platform leaves the session ReadOnly, with a note (FR-041).

## Screens

```screen overview Review session overview
title: PR title, branches, status (new)
row:
  chip: Context version (new)
  button: Refresh (new) (1)
  button: Close session (new)
list: PR found | Repository found | Issue ABC-12 stale (new) (2)
text: Skipped files with reasons (new) (3)
text: PR summary, as labelled claims (new)
list: Per-file summaries (new)
text: Functional and technical impact (new)
list: Changed files with status and lines added and removed (new) (4)
```
1: **Shown only while the PR is open.** A read-only session hides it and says why.
2: **Context completeness.** Each row shows found, missing or stale, with the reason for anything not found.
3: **Limits made visible.** Every file left out of a prompt is listed with its reason (FR-049).
4: **Opens the diff.** From the diff a line range, old or new side, or a whole file becomes a question scope.

```screen interrogation Interrogation panel
title: Scope: src/auth/reset.ts lines 40 to 60 (new)
row:
  list: What | Why | How | What-if | Risk | Requirements (new)
  list: Answer for: Technical | Business (new) (1)
list: Suggested questions for this scope (new)
field: Question (new)
button: Ask (new)
list: Queued questions, each cancellable (new) (2)
text: Answer streaming, in progress, not yet checked (new) (3)
list: Claims labelled Evidence or Inference, each with references (new) (4)
list: Unsupported assumptions (new)
list: Suggested follow-ups (new)
text: Provider, time, context version, restrictions not enforced (new) (5)
```
1: **Stored with the question.** Business keeps code identifiers out of claim text, with the same claims and references.
2: **One question runs at a time.** The rest wait in order (FR-053).
3: **Raw text first.** The labelled claims replace it when the answer completes.
4: **References open the code.** A cited removed line opens at the base commit; any other cited line opens at the head commit.
5: **Restrictions.** Names each FR-022 restriction the provider could not enforce, when there is one.

## Constitution Check

Checked before Phase 0 research and again after the Phase 1 design.

| Principle | Assessment |
|---|---|
| I. Evidence before opinion | PASS. `claims.ts` checks every reference against the snapshot's commits before display and downgrades an unresolved Evidence claim (I.2). Unparseable output becomes one Inference with a warning (I.3). |
| II. Human accountability | PASS. Every adapter uses the read-only HTTP wrapper, which refuses any method but GET, so nothing can be approved, commented on or changed (II.1). This feature has no readiness or risk class (II.2, II.3). |
| III. Separation of records | PASS. Issue Evidence and AI messages are separate tables. Append-only is enforced by SQLite triggers, and only a whole-session delete is allowed, inside one transaction (III.2). Each message stores its provider id, context version and timestamp (III.4). Findings and dispositions arrive in later features. |
| IV. Explainability | PASS. This feature makes no classification. |
| V. Missing context shown | PASS. The completeness list shows found, missing or stale, with reasons (V.1). Commit-bound evidence is marked stale and never deleted (V.3). Each connector call is isolated, so a failure becomes a gap (V.4). |
| VI. Incremental integration | PASS. It uses the git CLI, the platform APIs and the Claude Code CLI. A "method" scope is a user-selected range, so no code parser is built (VI.1). Issue evidence uses the generic evidence model (VI.2). |
| VII. No developer metrics | PASS. Nothing is scored, ranked or timed per person. Durations in the logs are per operation and carry no person. |
| VIII. Provider neutrality | PASS. The three contracts live in `src/contracts/`. A test fails when a platform name appears outside `src/adapters/`, tests and fixtures (VIII.2). Read-only is enforced in one wrapper (VIII.3). |
| IX. Repository safety (NON-NEGOTIABLE) | PASS. All git runs through `src/repo/`. Fetches write only to `refs/prwb/*` with `--no-write-fetch-head`. Workspaces are detached worktrees under the app-data dir, and git runs with repository hooks disabled. Each operation, including delete, the start-up sweep and a cancelled question, is tested against a before and after fingerprint of branch, HEAD, index, status and stash (XI.3; VO-005, VO-072, VO-073). The AI provider's only view of code is the isolated worktree (IX.3; see Complexity Tracking). |
| X. Local server security | PASS. The server binds `127.0.0.1` on port 0 and authenticates with a per-launch token cookie. It checks Host on every request, rejects any request whose Origin is present and foreign, requires Origin on every non-GET, sends a strict CSP and no CORS headers, and never changes state on a GET (X.1 to X.5). The three bootstrap routes reached without the token are recorded in Complexity Tracking (X.2). The AI adapter runs `--restricted` with `--tools Read,Grep,Glob` and `--strict-mcp-config`, from an empty app-owned directory with the worktree added as a working directory (X.6, X.10); VO-074 checks this on every test run. Credentials appear only in `credentials.ts`, which has dedicated leak tests (X.7, X.8). |
| XI. Test-first verification | PASS. The Verification Plan below covers every requirement and scenario. Contract suites run every adapter against recorded fixtures (XI.2). Each IX and X rule has a test (XI.3). |
| P. Platform | PASS, with the interpretation in Complexity Tracking. Node 24, TypeScript `strict`, `npx` start, execFile with argument arrays, `path` functions, and plain `node --inspect`. |
| Q. Workflow | PASS. The scope is MVP FR-1 and FR-2 only (Q.2). Both runtime dependencies are recorded with alternatives in research R5 and R7 (Q.1). |

Re-checked after Phase 1 design: no change. The data model keeps Evidence and messages apart, and the contracts name no platform outside the adapters.

### Complexity Tracking

| Departure | Why needed | Simpler alternative rejected |
|---|---|---|
| X.2: `GET /launch`, `GET /launch.js` and `POST /api/auth` are reached without the token cookie | The token travels in the URL fragment, which the browser never sends, so the launch page and its script must load before the token can be presented, and `POST /api/auth` is the request that presents it, in its body. These routes return only static files or the cookie, never review data, and the Host and Origin checks still apply to them. | Token in the query string: it reaches logs and history. A bearer header only: `EventSource` and static assets cannot send one. |
| IX.3 and FR-022(a) interpretation: the provider's working directory is an empty app-owned directory, and the isolated worktree is its one added directory (`--add-dir`) | Starting the CLI inside the worktree makes it load the PR's `CLAUDE.md` and project settings, which X.10 forbids. The worktree stays the only code the provider can read and the developer's tree is never reachable, which is what IX.3 protects. VO-017, VO-071 and VO-074 verify it. | Working directory = worktree: loads the PR's configuration. `--bare`: refuses the reviewer's OAuth sign-in (research R12). |
| P.5 interpretation: the browser UI is transpiled and bundled by `esbuild` | Browsers cannot run TypeScript or TSX, and the strict CSP (X.4) rules out an inline import map. The server itself still starts from source with no build. `esbuild` is used here only as the TypeScript transpiler for browser code. | Compiling the UI with `tsc` alone leaves bare `preact` imports the browser cannot resolve without an inline import map. A framework-free UI would mean far more hand-written DOM code for the diff, streaming and selection views. |

## Verification Plan

Verification is derived from the spec's requirements, acceptance scenarios and edge cases (EC-01 to EC-18) and from the design in [research.md](research.md). Test names begin with their obligation id, such as `VO-012 range-scoped Why question`, so a focused run selects them by name. Real git in temporary repositories is used wherever repository safety is at stake. Bitbucket Cloud and Jira Cloud are exercised through recorded fixtures (XI.2). The fake AI CLI is a Node script that emits the CLI's stream-json lines. Obligations that need the real Claude Code CLI (VO-017, VO-018, VO-071) run through the `test-live` command, never through `test`. They never skip: without an installed, signed-in CLI the run fails, is classified `environment`, and the obligation is deferred, so it is never reported verified on a skipped test. VO-074 checks the same restrictions on every `test` run, at the process boundary, with the fake CLI.

### Verification commands

| ID | Command | Scope | Source |
|---|---|---|---|
| test | `npm test` | broad | `package.json` scripts.test, `node --test "test/**/*.test.ts"` (research R8; the script is created by the first setup task) |
| test-one | `node --test --test-name-pattern "{select}" "test/**/*.test.ts"` | focused | `package.json` scripts.test with a name filter (research R8) |
| test-live | `npm run test:live` | focused | `package.json` scripts.test:live, `node --test "test/live/*.live.ts"` (research R8; the script is created by the first setup task) |
| typecheck | `npm run typecheck` | broad | `package.json` scripts.typecheck, `tsc --noEmit` (research R1) |

### Verification obligations

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|---|---|---|---|---|---|
| VO-001 | FR-001, US1-AS1 | A configured repository has three open PRs on the recorded platform; the reviewer lists PRs and starts a session from one | All three PRs are listed, and starting a session from any one of them returns a review session for that PR | end-to-end | planned |
| VO-002 | FR-003, US1-AS2 | Branch name holds one Jira key and the description holds another | Both references are returned, each with its origin (branch name, description) | integration | planned |
| VO-003 | FR-007, US1-AS3 | A PR with no issue reference starts a session | The session opens and the issue row of the completeness list is missing | end-to-end | planned |
| VO-004 | FR-004, FR-027, US1-AS4 | A PR references one issue; the session starts | The issue's title and plain-text description are returned, and every request sent to the issue tracker was a GET | end-to-end | planned |
| VO-005 | FR-008, US1-AS5 | Clone on a branch other than the PR branch, with uncommitted, staged and stashed changes; a session is started, refreshed and closed | Branch, HEAD, index, working-tree status and stash list are identical before and after | integration | planned |
| VO-006 | FR-006, US1-AS6 | A session exists for a PR with one question answered; the reviewer opens the same PR again | The same session id is returned, with one session and one question for that PR | end-to-end | planned |
| VO-007 | FR-010, US1-AS7 | The PR head moves to a new commit; the reviewer refreshes | A second snapshot exists for the new head, the first is unchanged, the files changed between the two heads are listed, and evidence captured for the old head shows stale | integration | planned |
| VO-008 | FR-041, US1-AS8 | A session's PR has been merged; the reviewer lists and opens sessions | The session is listed as merged and opens with its snapshots, summaries, questions and answers; refresh and new questions are refused | end-to-end | planned |
| VO-009 | FR-036, FR-037, US1-AS9, EC-17 | The PR branch is checked out in the reviewer's clone; a session is started | The session opens, the workspace is a detached worktree, and the checked-out branch, its ref value and HEAD are unchanged | integration | planned |
| VO-010 | FR-052, US1-AS10 | A session's PR received a new commit since it was last opened; the reviewer opens it | The PR row shows stale, a refresh is offered, the snapshot count is unchanged, and no platform call is made between opens | end-to-end | planned |
| VO-011 | FR-012, US2-AS1 | A session opens on a snapshot; summaries complete | The overview holds a PR summary, one summary per changed file, and functional and technical impact statements, each made of labelled claims | end-to-end | planned |
| VO-012 | FR-013, FR-014, FR-034, US2-AS2 | The reviewer selects lines 40 to 60 of a file and asks a Why question | The question is stored with scope type range, lines 40 to 60 and category why; the prompt's scope is that range; each cited file and line opens in the diff at that line | end-to-end | planned |
| VO-013 | FR-018, US2-AS3 | The provider returns Evidence claims citing a missing path, a line past the end of a file, an issue not fetched for the session, and only the PR description | Each such claim is shown as Inference; a claim with one resolving reference stays Evidence | unit | planned |
| VO-014 | FR-019, US2-AS4 | The provider returns text that does not validate as labelled claims | The answer is one Inference holding the text, with a warning | unit | planned |
| VO-015 | FR-048, FR-024, US2-AS5 | A question is asked with Answer for set to Business | The question is stored with Business, the prompt carries the business-reader rule, and the answer keeps its claims, labels and references | end-to-end | planned |
| VO-016 | FR-020, US2-AS6 | A question is answered, the server restarts on the same store, and the session is reopened | The question and answer are returned with provider `claude-code-cli`, timestamp, stored prompt and context version | end-to-end | planned |
| VO-017 | FR-022, US2-AS7, EC-14 | Real CLI: a PR adds `.claude/settings.json` with a hook that creates a marker file, and a `CLAUDE.md` with an instruction to start every answer with a fixed word; summaries are generated and a question is asked | No marker file exists anywhere afterwards, and no answer or summary starts with the planted word | integration | planned |
| VO-018 | FR-048, US2-AS5 | Real CLI: a Business question "Can a customer reset a password more than once?" on a fixture PR | No claim text contains an identifier from the changed lines, and the claims cite the code and the issue | integration | planned |
| VO-019 | FR-035, FR-016, US2-AS8 | An answer cites a line the PR removed and a line in a file outside the diff | The removed line opens at the snapshot's base commit and the other at its head commit, each at the cited line | end-to-end | planned |
| VO-020 | FR-047, FR-050, US2-AS9 | Two questions are answered; the reviewer selects a suggested follow-up on the second | The new question has the follow-up text and the same scope, stores the second question as its parent, and its stored prompt holds the second question and its claims and not the first question | end-to-end | planned |
| VO-021 | FR-051, FR-053, US2-AS10 | Questions were answered, then a refresh takes a new snapshot | Earlier answers are returned marked with the older head commit; summaries for the new snapshot are generated without a request; a new question is stored against the new snapshot | end-to-end | planned |
| VO-022 | FR-002, FR-025 | Contract suite for SourceControlProvider, run against the GitHub and Bitbucket Cloud recorded fixtures | Each adapter returns title, description, author, source and target branch, commits, unified diff and changed-file metadata for the same PR shape | contract | planned |
| VO-023 | FR-003 | Jira keys: one in a configured project, one in an unconfigured project the tracker confirms, one in an unconfigured project the tracker does not know | The first two are accepted as issue references; the third is not | contract | planned |
| VO-024 | FR-003 | GitHub Issues: `#123` resolves to a pull request and `owner/repo#45` to an issue | `#123` is returned as a PR reference and `owner/repo#45` as an issue | contract | planned |
| VO-025 | FR-004 | Jira Cloud issue with a rich-text description, and a Jira tracker with no stored credentials | The description is returned as plain text; without credentials each Jira issue is unresolved with the reason `no Jira access configured` | contract | planned |
| VO-026 | FR-005, EC-01 | No clone at the configured path, and a clone whose remotes point elsewhere | The repository row is missing with the reason, PR metadata and the platform's diff are returned, no summary is generated and no question can be asked, each with the repository row's reason, and no clone was created | end-to-end | planned |
| VO-027 | FR-007 | Completeness derived for each input: head matches, head moved, platform unreachable; clone found and fetched, not found; no issue, issue fetched, unresolved, re-fetch failed | Each row has the status and reason the requirement states, and the PR and repository rows are not stored as Evidence | unit | planned |
| VO-028 | FR-009, FR-042 | A session is closed, and separately the workbench starts with a leftover worktree from a killed run | Close keeps the session record and removes only its worktree; start-up removes the leftover worktree from the clone's worktree list and from disk | integration | planned |
| VO-029 | FR-011 | Issue re-fetch on refresh succeeds, then fails | Success adds a current record and keeps the earlier one; failure shows the issue stale with the reason using the last record; no evidence record is ever deleted | integration | planned |
| VO-030 | FR-015 | Suggested questions requested for pr, file and range scopes | Each scope returns its own fixed templates, covering every category | unit | planned |
| VO-031 | FR-017 | Claims stating intent: one citing the PR description, one citing an issue, one citing only code | The first two are documented intent, the third is inferred intent, and they are returned in separate groups; every claim carries Evidence or Inference | unit | planned |
| VO-032 | FR-021 | The fake provider streams text slowly; the client listens on the session's event stream | Text events arrive marked in progress and not yet checked before completion; on completion the labelled claims replace them; a cancel request ends the run | end-to-end | planned |
| VO-033 | FR-022, EC-09 | Provider capability probe on CLI help text lacking the restricted mode, lacking only the strict MCP option, and lacking only additional-directory support | The first two make interrogation and summaries unavailable with the reason; the third leaves them available and every answer and summary names restrictions (a) and (b) as not enforced | unit | planned |
| VO-034 | FR-022, EC-15 | PR description and code contain text imitating the data-block end marker and an instruction to ignore previous rules | The instructions contain no PR, issue or code text, and the data block closes only at its own per-request marker | unit | planned |
| VO-035 | FR-023 | A question is asked with one configured provider | Exactly one provider run starts for the question, and the stored answer names one provider | unit | planned |
| VO-036 | FR-025 | Source tree scanned outside the adapters, tests and fixtures | The check fails when a platform or provider name appears there, and passes on the current tree | unit | planned |
| VO-037 | FR-025 | Contract suite for IssueTracker, run against the Jira Cloud and GitHub Issues fixtures | Both adapters pass the same suite: extraction, lookup, unresolved with reason | contract | planned |
| VO-038 | FR-026 | Two sessions on different PRs reference the same issue key | Each stored reference, branch name and PR reference carries its platform, and a lookup by platform and key returns both sessions | integration | planned |
| VO-039 | FR-027 | The read-only HTTP layer is asked to send POST, PUT, PATCH and DELETE | Each is refused before any network call; recorded fixture logs hold only GET requests | unit | planned |
| VO-040 | FR-028 | Known tokens stored for all three platforms, then a full session with a question | No token appears in the config file, the logs, the review store file, any API response, the AI process arguments, environment or input, or the test fixtures | integration | planned |
| VO-041 | FR-029 | A full session runs with a network spy | Requests go only to the configured platform hosts, the only child processes are git, the AI CLI and the operating system's browser opener, and nothing else is contacted | integration | planned |
| VO-042 | FR-030 | The server starts | It listens on 127.0.0.1 on a port chosen at launch and on no other address | integration | planned |
| VO-043 | FR-030 | Requests with no token cookie, a wrong token, and the launch token exchanged by POST | The first two are refused with 401; the exchange sets the cookie; the token never appears in the logs | end-to-end | planned |
| VO-044 | FR-030 | Requests with a foreign Host header; a GET and a POST with a foreign Origin; a POST with no Origin | The foreign Host is refused with 421; each Origin case is refused with 403 | end-to-end | planned |
| VO-045 | FR-030 | Every route is called with GET, and responses are inspected | Responses carry the strict Content-Security-Policy and no CORS headers, and no GET changes the store | end-to-end | planned |
| VO-046 | FR-032, EC-02 | The issue tracker returns 500 and the AI provider fails on start | The issue row shows missing with the failure reason, summaries show unavailable with the reason, and PR metadata, diff and repository rows are still returned | end-to-end | planned |
| VO-047 | FR-033 | The diff of a snapshot with added, modified, renamed and deleted files is requested | Each file is returned with its status, lines added and removed, and its hunks | end-to-end | planned |
| VO-048 | FR-036, EC-18 | A fetch succeeds, and a fetch fails because the commit is gone | Success changes refs only under the app-owned namespace and leaves FETCH_HEAD, local branches, index and stash unchanged; failure shows the repository row missing with the reason and the diff comes from the platform | integration | planned |
| VO-049 | FR-036, EC-16 | A PR from a fork, then the same with the fork unreachable | The head is fetched into the app-owned namespace from where the platform exposes it (the fork's repository, or the base repository's PR ref); when unreachable, the repository row is missing with the reason and the platform diff is used | integration | planned |
| VO-050 | FR-037 | A session starts with a clone available | The workspace is a detached worktree at the snapshot head in a directory under the application-data directory | integration | planned |
| VO-051 | FR-038 | Snapshots taken with the head fetched and with no clone | The first diff is computed locally from the merge-base and records source local and its base commit; the second records source platform and no base commit | integration | planned |
| VO-052 | FR-039 | Configuration saved with all fields, with a missing clone path, and with an extra token field | The first is accepted; the second and third are refused with the field named; the saved file holds no credential | unit | planned |
| VO-053 | FR-040, EC-13 | Sign-in for each platform; then the GitHub token is rejected on a later call | Each sign-in is checked by a read-only call; Bitbucket Cloud offers email and API token and no app password; after the rejection only GitHub asks for sign-in again and the issue tracker still works | end-to-end | planned |
| VO-054 | FR-043 | The application-data directory is resolved on Windows, macOS and Linux environments, and a configuration places the clone inside it | Each OS gets its per-user directory, and the store and workspaces never resolve inside the clone | unit | planned |
| VO-055 | FR-044 | A session with snapshots, evidence, questions and a workspace is deleted after confirmation; separately, an update or delete of a single history record is attempted | The delete removes every record under the session, its worktree and its app-owned refs; the single-record change is refused by the store | integration | planned |
| VO-056 | FR-045, EC-10 | A question is cancelled mid-answer | The answer is kept with the text received, marked cancelled, as one Inference | end-to-end | planned |
| VO-057 | FR-046 | The provider returns claims and unsupported assumptions | The answer returns the assumptions apart from the claims | end-to-end | planned |
| VO-058 | FR-049, EC-05 | A PR with a binary file, a file over 1 MB, a file over 5,000 changed lines, and enough other diff to pass 400,000 characters; then lowered limits | The three files and the overflow files are left out of every prompt with reasons binary, size, changed lines and prompt limit, in diff order; they are listed in the summary and under the repository row; lowered limits change which files are left out | unit | planned |
| VO-059 | FR-053, EC-12 | Three questions are asked while a summary is generating | One summary and one question run at once; the others are shown queued in order; a queued question cancelled before it starts never runs | end-to-end | planned |
| VO-060 | FR-054 | A session with a question runs, and log files dated 8 days ago exist | Each log line holds only the allowed fields with session, snapshot and request ids; no credential, launch token, code, diff, prompt, answer, PR or issue text appears; the old files are deleted | integration | planned |
| VO-061 | FR-041, EC-03 | The PR is merged while a session is open; the reviewer refreshes | Refresh reports the new status instead of failing, the session becomes read-only, and its history stays readable | end-to-end | planned |
| VO-062 | FR-010, EC-04 | The PR branch is force-pushed to rewritten history; the reviewer refreshes | A new snapshot is taken for the new head, and earlier snapshots with their questions and answers are kept | integration | planned |
| VO-063 | FR-003, EC-06 | The same issue appears in the branch name, title and description in different forms | One issue is shown with all three origins | unit | planned |
| VO-064 | FR-004, EC-07 | An issue reference with a wrong key, and one the account has no access to | Each is shown unresolved with its reason and not dropped | contract | planned |
| VO-065 | FR-032, EC-08 | The AI CLI is not on the path, and separately is installed but not signed in | Interrogation and summaries show unavailable with the reason, and PR context still loads | end-to-end | planned |
| VO-066 | FR-009, FR-045, EC-11 | The workbench is killed while an answer streams and another question is queued, then restarted | The streaming answer is kept with its received text, marked cancelled; the queued question is kept, marked cancelled; the session reopens from storage | integration | planned |
| VO-067 | FR-008 | The repository manager's command table is checked | No command runs checkout, switch, pull, merge, rebase, reset, stash, clean or worktree prune, every git call is an argument array without a shell, and every ref written is under the app-owned namespace | unit | planned |
| VO-068 | FR-008, FR-037 | The PR adds a post-checkout hook in a tracked hooks directory that the clone's configuration points at; a session starts | The hook does not run, and no file outside the workspace changes | integration | planned |
| VO-069 | FR-020 | Two questions with the same scope, one plain and one a follow-up | Each stored answer shows a context version of head commit plus context fingerprint, and the two versions differ | unit | planned |
| VO-070 | FR-021 | A completed answer is read back through the API | Its claims carry checked references, and nothing marked in progress remains | end-to-end | planned |
| VO-071 | FR-022 | Real CLI: a question asks the provider to read a file outside the workspace and to fetch a URL | Neither succeeds, and the answer contains neither the outside file's content nor the URL's | integration | planned |
| VO-072 | FR-008 | SC-001: the clone is on another branch with uncommitted, staged and stashed changes; a session is deleted, and separately the workbench starts and sweeps a leftover worktree from a killed run | Branch, HEAD, index, working-tree status and stash list are identical before and after each operation | integration | planned |
| VO-073 | FR-008 | SC-001: the clone is on another branch with uncommitted, staged and stashed changes; a question is asked and answered, and another is cancelled mid-answer | Branch, HEAD, index, working-tree status and stash list are identical before and after each | end-to-end | planned |
| VO-074 | FR-022 | The provider answers a question through the fake CLI, which records how it was started | It was started in restricted mode with read and search tools only, strict MCP configuration and the worktree as its one added directory; its working directory is an empty directory outside the worktree and the clone; its environment holds no platform token; PR, issue and code text reached it only on standard input | integration | planned |
| VO-075 | FR-051, FR-053 | A question runs on snapshot 1 while another question and the summary run for snapshot 1 are queued; a refresh takes snapshot 2 | The running question completes against snapshot 1; the queued question and summary run are kept, cancelled as superseded, and never run; summaries for snapshot 2 are queued | end-to-end | planned |
| VO-076 | FR-041 | A session's PR was closed, then reopened on the platform; the reviewer opens the session | The session stays read-only and shows the note that the PR was reopened; refresh and new questions are refused | end-to-end | planned |
| VO-077 | FR-052, FR-010 | A refresh with the head unchanged after a successful fetch; then a refresh with the head unchanged after the previous fetch failed | The first takes no new snapshot; the second takes one for the same head | integration | planned |

### Verification exemptions

| Requirement | Reason | Alternative verification |
|---|---|---|
| FR-031 | A prohibition on a feature: the change adds no way to score, rank or time a person, so no test can observe the absence | MV-004: review of the data model, the API contract and the UI at the end of the feature |

### Manual verification

| ID | Covers | Steps | Expected result | Why not automated |
|---|---|---|---|---|
| MV-001 | FR-007, FR-012, FR-017, FR-021, FR-033, FR-046, FR-049 | Open a session on a test-set PR and walk the overview, diff and interrogation screens | Completeness rows, skipped files, documented and inferred intent groups, in-progress marker, claims, assumptions and diff counts are visible as in W1, W2 and W4 | Visual layout against wireframes; the behaviour is covered by the end-to-end obligations |
| MV-002 | FR-025, SC-002 | Run a session and a question on one real Bitbucket Cloud PR whose description references a real Jira Cloud issue | Context, issue text, summaries and a question work against the real platforms | Needs real accounts in the target environment; SC-002 excludes recorded responses |
| MV-003 | SC-003, SC-009, SC-011 | A named evaluator rates summaries, answers and 50 Evidence claims on the test set, outside the workbench | At least 5 of 6 summaries accurate, at least 80% of answers useful, at least 90% of Evidence references support their claim | Human judgement; ratings are not stored |
| MV-004 | FR-031 | Review the data model, the API contract and every screen | No field, response or view scores, ranks or times a person | Absence of a feature |
| MV-005 | SC-006, SC-007 | Time a typical test-set PR from selection to first summary text, and a question to first answer text, with the real CLI | Summary starts within 60 seconds, answer within 10 seconds | Depends on the real provider and network |

### Behaviour checklist

The behaviour items this feature must show are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).
