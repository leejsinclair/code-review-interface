# Research: PR Context and Interrogation

Phase 0 decisions for [plan.md](plan.md). Each entry gives the decision, why, and what was rejected. The spec has no open `NEEDS CLARIFICATION` markers. R12 holds the one item the spec defers to the Week 1 spike, with its acceptance test.

## R1. Runtime and running from source

**Decision**: Node.js 24 with TypeScript in `strict` mode, run directly through Node's built-in type stripping. `tsconfig.json` sets `erasableSyntaxOnly` and `verbatimModuleSyntax`, so no enums, namespaces or parameter properties are written. `tsc --noEmit` type-checks. `tsc -p tsconfig.build.json` emits `dist/` only for the published package, because Node does not strip types for files under `node_modules`.
**Rationale**: P.5 requires the development server to start from source with no build step other than TypeScript tooling, and to run under plain `node --inspect`. Type stripping meets both with no dependency.
**Alternatives considered**: `tsx` or `ts-node` add a dependency and a loader, and so a second runtime path. Bun or Deno conflict with P.1 and P.2.

## R2. HTTP server and streaming

**Decision**: `node:http` with a small route table. Streaming reaches the browser over server-sent events, one stream per open session (`GET /api/sessions/:sessionId/events`). Starting work is always a POST, and the stream only reports progress.
**Rationale**: There are about twenty routes, so a framework buys little. Server-sent events are one-way, which matches streamed text and queue state. The browser's `EventSource` sends the session cookie on same-origin requests (R3), and reconnects by itself.
**Alternatives considered**: Express or Fastify are runtime dependencies for routing alone (Q.1). WebSockets are two-way, which is not needed, and handshake Origin checks would have to be built by hand.

## R3. Local server authentication (X.1 to X.5)

**Decision**: Bind `127.0.0.1` on port 0. At launch, generate a 32-byte token with `crypto.randomBytes`, open `http://127.0.0.1:<port>/launch#<token>`, and print the same URL to the terminal. The launch page is a static file. Its script reads the fragment, POSTs it to `/api/auth`, and the server replies by setting the token as an `HttpOnly; SameSite=Strict; Path=/` cookie. The page then clears the fragment from history. Every route except `/launch`, its script and `/api/auth` requires the cookie, compared in constant time. Every request must have `Host` equal to `127.0.0.1:<port>`. Every request that carries an `Origin` header must have it equal to the server origin, whatever its method (X.3), and every non-GET request must carry one (X.5). Each response sends `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and never any CORS header. Request logs record the route pattern, never the URL or headers.
**Rationale**: The fragment never reaches the server, proxies or logs. Exchanging it by POST keeps GET free of state changes (X.5). The cookie lets `EventSource` and static assets authenticate without custom headers. `SameSite=Strict` together with the Origin check stops cross-site requests, and the Host check stops DNS rebinding.
**Alternatives considered**: A token in the query string ends up in history and logs. A bearer header on every fetch cannot cover `EventSource` or `<script src>`.

## R4. Application data and configuration

**Decision**: Resolve the app-data directory by hand: `%LOCALAPPDATA%\pr-review-workbench` on Windows, `~/Library/Application Support/pr-review-workbench` on macOS, and `$XDG_DATA_HOME/pr-review-workbench` (default `~/.local/share`) on Linux. It holds `config.json`, `review.db`, `logs/`, `workspaces/`, `provider-home/` and `empty-hooks/`. The config file holds the repository (platform id and identifier), the clone path, the tracker (platform id, site, Jira project keys) and the limits, and nothing else. The setup screen writes it through the API, and validation refuses any field it does not know.
**Rationale**: FR-043 and FR-039. Three lines of code do not justify a dependency. Refusing unknown fields stops a token from being pasted into the config by mistake.
**Alternatives considered**: `env-paths` adds a dependency for one function. A dot-directory in the home folder breaks platform conventions.

## R5. Review store

**Decision**: `node:sqlite` (`DatabaseSync`), one file, `PRAGMA foreign_keys=ON` and WAL. History tables (snapshots, evidence, questions, answer chunks, answers, summaries) get `BEFORE UPDATE` triggers that always abort, and `BEFORE DELETE` triggers that abort unless a `session_deletion` row exists for that session. `deleteSession()` inserts that row, deletes the session (cascading to everything under it), and removes the marker, all in one transaction. The only mutable row is the session's current-status cache (PR status, last-checked head), which is not history. `review-store.ts` exposes `append*` and `read*` functions only, plus `deleteSession`.
**Rationale**: III.2 asks that the store expose no update or delete for history. Triggers make that true even for code that bypasses the module, and a test can show it. `node:sqlite` is built in. Node 24 prints an experimental warning for it once at start-up. That is accepted, and the module is pinned behind `db.ts`.
**Alternatives considered**: `better-sqlite3` is a native build dependency (Q.1). JSON files give no atomic cascade delete and no constraints. Postgres is not a local single-user store.

## R6. Credential store

**Decision**: `@napi-rs/keyring` (runtime dependency), used only from `src/credentials.ts`. That module stores one entry per platform under the service `pr-review-workbench`, holding `{account, secret}`. It never returns the secret to the API layer. Adapters get an `authorize(request)` callback that adds the header. `credentials.ts` also registers every loaded secret with the log scrubber, and child processes get an allowlisted environment, so no token reaches the AI CLI or git.
**Rationale**: FR-028, FR-040, X.7 and X.8. The package uses the platform keychains (macOS Keychain, Windows Credential Manager, Secret Service on Linux), ships prebuilt binaries and is maintained.
**Alternatives considered**: `keytar` is archived. Shelling out to `security` or `secret-tool` has no Windows equivalent for reading generic credentials and would break P.4.

## R7. Browser UI

**Decision**: Preact with TSX, bundled into one `app.js` and one `app.css` by `esbuild`, served from `dist/ui/`. Development runs `esbuild --watch`. The UI renders every piece of PR, issue, code and AI text as a text node, never as HTML. Markdown in descriptions is shown as plain text.
**Rationale**: The diff view, range selection, streaming answers and queue state are enough interaction to want components. Preact is about 4 KB and has no transitive dependencies. Text-only rendering, together with the CSP, closes the XSS path from PR or AI content.
**Alternatives considered**: React with Vite is a heavier toolchain for the same result. Plain DOM code would mean more code for the diff and selection views. `htm` without a build needs an inline import map, which the CSP forbids (see Complexity Tracking in the plan).

## R8. Tests and verification commands

**Decision**: `node:test` running `.ts` files through type stripping, plus `tsc --noEmit`. `package.json` scripts: `test` runs `node --test "test/**/*.test.ts"`, and `typecheck` runs `tsc --noEmit`. Levels are `test/unit`, `test/integration` (real git in temporary repositories, the real SQLite store), `test/contract` (one suite per contract, run against every adapter), and `test/end-to-end` (the real server over HTTP, with a fake AI CLI and recorded platforms). Recorded fixtures replay through an injected `fetch`. Tests against the real Claude Code CLI live in `test/live/*.live.ts`, outside the `test` glob, and run through a separate script, `test:live` (`node --test "test/live/*.live.ts"`). They never skip: without an installed, signed-in CLI they fail, the run is classified `environment`, and the obligation is deferred, so a skipped test can never count as a pass.
**Rationale**: The runner is built in, so no framework is chosen on the project's behalf beyond the platform. XI.2 needs contract suites and recorded fixtures. XI.3 needs real git.
**Alternatives considered**: Vitest or Jest are extra dependencies for features `node:test` already has. Playwright UI tests are deferred. Rendering is checked through the API end-to-end tests plus the manual checks in the Verification Plan.

## R9. Git access and repository hardening

**Decision**: `src/repo/git.ts` runs `git` with `execFile` and an argument array, never a shell, with `cwd` set to the clone or worktree. Every call adds `-c core.hooksPath=<app-data>/empty-hooks -c core.fsmonitor=false -c protocol.file.allow=user -c submodule.recurse=false`, and sets `GIT_TERMINAL_PROMPT=0` in an allowlisted environment. Commands the manager may run: `remote -v`, `fetch --no-tags --no-write-fetch-head --no-recurse-submodules <url> +<src>:refs/prwb/<session>/<snapshot>/{head,target}`, `merge-base`, `diff -M --numstat -z`, `diff -M --patch`, `cat-file -e/-s`, `show <commit>:<path>`, `worktree add --detach <app-dir path> <sha>`, `worktree remove --force <that path>`, `worktree list --porcelain`, `update-ref -d refs/prwb/...`, `for-each-ref refs/prwb/`, and `rev-parse`/`status --porcelain`/`stash list` for the safety fingerprint in tests. A test reads the module's command table and fails on `checkout`, `switch`, `pull`, `merge`, `rebase`, `reset`, `stash`, `clean`, `worktree prune`, or any ref outside `refs/prwb/`.
**Rationale**: IX.1 and IX.2. Hooks are disabled because `worktree add` runs `post-checkout`, and a repository that sets `core.hooksPath` to a tracked directory such as `.husky` would run the PR's own code. A global `worktree prune` could drop the reviewer's own entries for worktrees on an unmounted drive, so only the workbench's own worktrees are removed, by path. `--no-write-fetch-head` leaves `FETCH_HEAD` as the reviewer had it.
**Alternatives considered**: `isomorphic-git` or `nodegit` re-create git (VI.1) and differ from the reviewer's own git behaviour (credentials, LFS).

## R10. Fetching a PR head, forks and matching the clone

**Decision**: The source-control adapter describes where the head lives, as `{remoteUrl, ref}`. GitHub uses `refs/pull/<n>/head` on the base repository, which covers forks. Bitbucket Cloud uses the fork's clone URL and its source branch. Fetches use the scheme (SSH or HTTPS) of the local clone's matching remote and rely on the reviewer's own git credentials (SSH agent or credential helper). The workbench never passes its tokens to git. After the fetch, the manager checks that the fetched commit equals the PR head the platform reported. If it does not, the repository row is missing with "fetched head does not match the PR". The clone matches when one of its remotes, normalised to host and path without `.git` and case-folded, equals one of the adapter's `cloneLocations(repo)`.
**Rationale**: FR-036 and FR-005. Using the reviewer's existing git auth means the workbench handles no git credentials, and the adapter keeps the platform-specific ref layout.
**Alternatives considered**: Putting the API token into an HTTPS URL would expose it in the process list and in any remote URL git records, against X.7. Fetching into `refs/remotes/` would move refs the reviewer may rely on.

## R11. Diff, limits and file reading

**Decision**: When the head is fetched, compute `base = merge-base(target, head)`, read `--numstat -z` for counts and binary markers (`-`), and read `--patch` for the hunks. Otherwise use the platform's unified diff, parsed by the same `unified-diff.ts`, with no base commit recorded. The snapshot records `diffSource` (`local` or `platform`) and `baseCommit`. Limits are applied per file, in this order: binary, then size over `maxFileBytes` (from `cat-file -s` at head, default 1,048,576), then changed lines over `maxChangedLines` (default 5,000). After that the prompt budget (`maxPromptChars`, default 400,000) fills in diff order, and the rest are left out with the reason `prompt limit`. The diff fingerprint is SHA-256 of the normalised patch.
**Rationale**: FR-038 and FR-049. One parser means both diff sources render and limit the same way.
**Alternatives considered**: The `parse-diff` package is a dependency for about 80 lines of parser.

## R12. AI provider: Claude Code CLI under the FR-022 restrictions

**Decision**: Spawn the resolved `claude` executable with `execFile`-style arguments and no shell. Its `cwd` is `<app-data>/provider-home/<request>`, an empty directory the workbench creates and removes. The arguments are `-p --input-format text --output-format stream-json --include-partial-messages --verbose --restricted --tools Read,Grep,Glob --strict-mcp-config --disable-slash-commands --no-session-persistence --add-dir <worktree> --json-schema <answer or summary schema> --append-system-prompt <workbench instructions>`. The prompt goes in on stdin. The environment is allowlisted (`PATH`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_*`, `LANG`, `TMPDIR`/`TEMP`, plus any `ANTHROPIC_*` or `CLAUDE_*` provider variables already set). How each restriction is met:

- (a) and (b): the only tools are Read, Grep and Glob. `--restricted` confines file tools to the working directories, and the only one with content is the worktree.
- (c): `--restricted` drops command-running tools and WebFetch, `--tools` names no network tool, and `--strict-mcp-config` with no `--mcp-config` loads no MCP server.
- (d): `--restricted` ignores user, project and local settings files, so no hooks load. The `cwd` is empty, and CLAUDE.md files in `--add-dir` directories are not auto-loaded.
- (e): PR, issue and code text sit inside a delimited data block (R14), apart from the system instructions.

At start-up, `capabilities()` runs `claude --version` and reads `claude --help`. It reports (c) and (d) as unenforced unless `--restricted`, `--tools` and `--strict-mcp-config` are all listed, and (a) and (b) as unenforced unless `--restricted` and `--add-dir` are listed. If (c) or (d) is unenforced, interrogation and summaries are unavailable with that reason.
**Rationale**: The flags were read from the installed CLI (2.1.319) on 2026-11-07. The empty `cwd` closes the CLAUDE.md path without `--bare`, which would refuse the reviewer's OAuth sign-in. Stdin avoids the Windows command-line length limit of about 32 KB, and prompts reach 400,000 characters. The Week 1 spike the spec names becomes an acceptance test: US2-AS7's hook-marker test, run against the real CLI, plus a check that a planted `CLAUDE.md` instruction has no effect.
**Alternatives considered**: `--bare` skips hooks and CLAUDE.md but accepts only `ANTHROPIC_API_KEY`, and most reviewers sign in with OAuth. A `cwd` of the worktree itself depends on `--restricted` alone to skip the PR's `CLAUDE.md`, which the help text does not promise. On Windows, an npm `.cmd` shim cannot run without a shell, so the adapter resolves the native `claude.exe`, or `node` plus the package's JavaScript entry, and otherwise reports the provider as not installed.

## R13. Answer shape, streaming and claim checking

**Decision**: The answer schema is `{claims: [{text, label: "evidence" | "inference", intent?: "documented" | "inferred", refs: [{kind: "code", path, side: "head" | "base", startLine, endLine} | {kind: "issue", platform, key} | {kind: "pr"}]}], unsupportedAssumptions: string[], suggestedFollowUps: string[]}`, passed as `--json-schema`. A claim about what the change is for carries `intent`. `documented` stands only when the claim cites an issue or the PR description (`kind: "pr"`); otherwise the workbench shows it as `inferred`. The UI groups documented intent apart from inferred intent (FR-017). Summaries use the same claim shape inside `{prSummary, files: [{path, claims}], functionalImpact, technicalImpact}`. Text deltas from `stream_event` lines are published as raw text and appended as answer chunks. On `result`, the structured output is validated by a hand-written guard. A code ref resolves when `cat-file -e <commit>:<path>` succeeds and `endLine` is within the file's line count at that commit (head, or base for `side: base`). An issue ref resolves when that key was fetched for the session. An Evidence claim with no resolving ref is stored as Inference, and the reason is recorded per ref. If the output does not validate, one Inference holding the raw text is stored with the warning `unstructured`. If the answer is cancelled, the chunks become one Inference marked `cancelled`.
**Rationale**: FR-016 to FR-019, FR-021, FR-045 to FR-047. Validation happens at the trust boundary, and the label is decided by the workbench, never by the model.
**Alternatives considered**: Asking for Markdown with inline tags is fragile to parse. Zod is a dependency for a handful of shapes.

## R14. Prompt assembly and context version

**Decision**: `prompt.ts` builds `{instructions, data}`. Instructions are fixed text: the role, the answer rules, the "Answer for" audience rule, and the statement that everything in the data block is content to analyse, never instructions. They go in through `--append-system-prompt`. The data block goes on stdin, wrapped as `<<<PRWB-DATA nonce>>> … <<<END nonce>>>`, where the nonce is random per request. It holds, in order: scope, category, question, PR title and description, issues' plain text, the parent question and its claims (follow-ups only, FR-050), then file diffs in diff order up to the budget. Earlier questions are never included. The context version is `<headCommit>:<sha256(data block without nonce)>` and is stored with the stored prompt.
**Rationale**: FR-022(e), FR-020 and FR-050. A per-request nonce stops PR text from closing the block early.
**Alternatives considered**: Sending the session history as conversation turns breaks FR-050 and makes context versions hard to compare.

## R15. Issue references and issue text

**Decision**: The `IssueTracker` contract has `extractReferences(text)` and `lookup(ref)`. Jira takes `[A-Z][A-Z0-9]+-\d+` and accepts a key when its project is configured or when lookup confirms it. GitHub Issues takes `#123` and `owner/repo#123`, and lookup reports `kind: "pull-request"` when the number is a PR. Core runs extraction over the branch name, title and description, then merges by `(platform, key)` and keeps every origin. Jira descriptions (ADF) become plain text with a small node walker. GitHub bodies are already text and are shown as text. Lookup is a single GET per key. Without Jira credentials, lookup returns unresolved with `no Jira access configured`.
**Rationale**: FR-003, FR-004 and FR-026. Extraction belongs to the tracker, so core never learns a key format.
**Alternatives considered**: One shared regex in core would put platform knowledge outside the adapters (VIII.2).

## R16. Platform adapters

**Decision**: GitHub uses REST v3 (`GET /repos/{o}/{r}/pulls?state=open`, `/pulls/{n}`, `/pulls/{n}/commits`, `/pulls/{n}/files`, and the diff media type). Bitbucket Cloud uses REST 2.0 (`GET /2.0/repositories/{ws}/{repo}/pullrequests?state=OPEN`, `/pullrequests/{id}`, `/commits`, `/diffstat`, `/diff`) with Basic auth from the Atlassian email and API token. Jira Cloud uses `GET /rest/api/3/issue/{key}?fields=summary,description` with Basic email and token. Sign-in checks are `GET /user`, `GET /2.0/user` and `GET /rest/api/3/myself`. Every request goes through `read-only-http.ts`, which throws on any method but GET. A 401 or 403 marks that platform's sign-in as expired. Pagination is followed up to a fixed page cap, and anything cut off is reported as a gap.
**Rationale**: FR-025, FR-027, FR-040 and VIII.3. GraphQL would need POST, so it is not used.
**Alternatives considered**: Octokit and the Atlassian SDKs are large dependencies whose surface includes writes.

## R17. Per-session work queue and recovery

**Decision**: Each open session has two in-memory lanes, summaries and questions, each running one job at a time (FR-053). A question is stored when asked, and its lifecycle is recorded only by appending answer chunks and one terminal answer row (`completed` or `cancelled`). Queued and running are derived from the absence of a terminal row and from the in-memory lane. At start-up, `recovery.ts` removes every worktree listed under `<app-data>/workspaces` from its clone's worktree list and deletes leftover directories. It then appends a `cancelled` answer, built from stored chunks, for every question and summary with no terminal row.
**Rationale**: FR-009, FR-045 and the crash edge case, while staying append-only.
**Alternatives considered**: A status column updated in place breaks III.2.

## R18. Logs

**Decision**: `log.ts` writes JSON lines to `<app-data>/logs/prwb-YYYY-MM-DD.log`. Its `log()` accepts only `{op, outcome, durationMs, sessionId?, snapshotId?, requestId?, errorCode?, errorMessage?}`. Before writing, `errorMessage` passes through a scrubber that replaces every registered secret (platform tokens, the launch token) and any `Authorization` value. At start-up and once a day, files older than `logRetentionDays` (default 7) are deleted. Nothing is sent off the machine.
**Rationale**: FR-054, P.5, X.2 and X.9. A field allowlist means code, prompts and PR text cannot reach the log by accident.
**Alternatives considered**: `pino` is a dependency, and its free-form objects defeat the allowlist.

## R19. Platform-name guard and the browser launch

**Decision**: A unit test walks `src/` (skipping `src/adapters/`) and fails on any case-insensitive match of `github`, `bitbucket`, `jira`, `atlassian` or `claude`. The registry's ids are the only bridge from configuration to adapters. To open the browser without a shell: `open <url>` on macOS, `xdg-open <url>` on Linux, `rundll32 url.dll,FileProtocolHandler <url>` on Windows, all through `execFile`. If opening fails, the URL is still printed.
**Rationale**: VIII.2 (the SHOULD made into a build failure) and P.4.
**Alternatives considered**: The `open` package is a dependency for three lines.

## Runtime dependencies (Q.1)

| Dependency | Purpose | Alternative considered |
|---|---|---|
| `@napi-rs/keyring` | OS keychain access (FR-028, X.7) | `keytar` (archived), OS CLIs (no Windows reader) |
| `preact` | UI components, bundled into `app.js` | React (larger), plain DOM (more code) |

Development only: `typescript`, `esbuild`, `@types/node`.
