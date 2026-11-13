<!--
Sync Impact Report (scratch; remove before commit)
Version change: 2.0.0 -> 3.0.0 (MAJOR: a safeguard is removed)
Modified principles:
  - II.4 Every platform write: separate preview-and-confirm step replaced by one deliberate
    click on a control naming the action and destination; request carries the viewed head
    commit and the server refuses it if the head moved; record also keeps the exact body.
  - X.11 SourceControlWriter: confirmation token requirement removed. Allowlist, X.5,
    lazy write scope and tests unchanged.
Added sections: Amendment 3.0.0 note (footer)
Removed sections: none
Templates checked: .specify/templates/{plan,spec,tasks,checklist}-template.md read the
  constitution at run time; no rule text copied, no change needed.
Docs: ADR 0003 updated. README.md line 5 and MVP/MVP.md (1.3 and line 34 "Read-only by
  default") still say the product only reads; deferred to feature 005 task T038.
Deferred TODOs: none
-->

# PR Review Workbench Constitution

This constitution governs the PR Review Workbench described in `MVP/MVP.md`. Each rule is
numbered so that `/speckit-plan` and `/speckit-analyze` can cite it. MUST rules are
mandatory; SHOULD rules may be departed from only with a recorded justification.

## Core Principles

### I. Evidence Before Opinion

- **I.1** Every material AI finding MUST cite at least one resolvable reference: a file and
  line range, a requirement ID, or an evidence report.
  *Rationale:* a claim that cannot be traced cannot be checked, so it cannot be trusted.
- **I.2** A statement typed Evidence without a resolvable reference MUST be downgraded to
  Inference before it is stored or shown.
  *Rationale:* the label must describe the support that exists, not the support claimed.
- **I.3** AI output that cannot be parsed into structured claims MUST be shown as a single
  Inference with a warning, never as fact.
  *Rationale:* unstructured text gives no way to tell evidence from reasoning.

### II. Human Accountability

- **II.1** The product MUST NOT merge or decline a pull request, change an issue, or change
  code, branches or any repository on any platform. The only platform writes it MAY make are
  the reviewer actions in II.4: post a comment or reply, edit or delete a comment the
  product itself posted, approve, request changes, and withdraw an approval or a change
  request. Test setup is governed by XI.4.
  *Rationale:* AI recommends and people decide; the decision stays in the platform of record.
  The reviewer's own review actions are the one place the platform needs a person's input.
- **II.2** The readiness state MUST be derived by rules, MUST NOT be settable by a user and
  MUST be labelled a recommendation, with no "approved" badge or approval styling. Showing
  the signed-in reviewer's own approval, read from the platform, is not a readiness state:
  it is a fact about that reviewer and MUST be labelled as the reviewer's own, never as the
  product's verdict.
  *Rationale:* a tool that looks like it approved a PR invites people to stop checking, but a
  reviewer needs to see what they themselves already decided.
- **II.3** Mechanical or low-risk changes MUST be presented as candidates for reduced review,
  never as approved.
  *Rationale:* reduced attention is a reviewer's choice, not the tool's verdict.
- **II.4** Every platform write MUST be started by a person in the UI with one deliberate
  click on a control that names the action and its destination, and MUST NOT be
  triggered, batched or chosen by AI. The request MUST carry the head commit the reviewer
  was viewing, and the server MUST refuse it if the head has moved. An approval or change
  request MUST be tied to that commit. Each write MUST be recorded append-only (III.2)
  with the actor, time, commit and exact body.
  *Rationale:* a reviewer who clicks a button named for the action has chosen it; the
  commit check stops an approval landing on code the reviewer did not see.

### III. Separation of Evidence, Assessment and Disposition

- **III.1** Evidence (facts from tools), Assessment (AI or rule output) and Disposition
  (human decisions) MUST be separate record types, stored separately and shown as distinct
  in the UI.
  *Rationale:* mixing what was measured, what was inferred and what was decided destroys
  the audit trail.
- **III.2** Disposition and review-history records MUST be append-only: the store exposes
  no update or delete for them, and a correction is a new record. The user MAY delete a
  whole review session, with every record under it, in one confirmed action; no record
  inside a kept session may be removed or changed.
  *Rationale:* an audit trail that can be rewritten is not an audit trail. Removing a whole
  session lets the owner of the data discard code they no longer want stored without
  rewriting the history of any session that remains.
- **III.3** Every Assessment MUST reference the Evidence it rests on, and every Disposition
  MUST reference the Finding it decides.
  *Rationale:* each record must be traceable to the one beneath it.
- **III.4** Every Finding and AI message MUST store its provider id, context version and
  timestamp.
  *Rationale:* results must be reproducible and attributable to the inputs that produced them.

### IV. Explainability

- **IV.1** Every classification (risk class, traceability state, readiness state) MUST state
  its reasons and the changed lines, rule IDs or evidence that caused it.
  *Rationale:* a reviewer cannot judge a classification they cannot see the cause of.
- **IV.2** Deterministic rules MUST run before AI assessment; AI MAY raise a rule-set class
  but MUST NOT lower it.
  *Rationale:* mandatory scrutiny must not depend on a model's judgement.

### V. Missing Context Is Shown, Never Assumed

- **V.1** An absent or unresolvable issue, specification, coverage report, SonarQube result
  or repository MUST appear as an explicit gap with status missing or stale.
  *Rationale:* a silently skipped source reads as a clean result.
- **V.2** The product MUST NOT invent a value for absent evidence (for example a coverage
  percentage) and MUST NOT substitute an assumption for missing context.
  *Rationale:* a made-up number is worse than no number.
- **V.3** Evidence for an older commit than the PR head MUST be marked stale, never deleted
  or shown as current.
  *Rationale:* evidence describes a specific commit, not the PR in general.
- **V.4** A failing connector MUST degrade to a visible gap and MUST NOT block the other
  connectors.
  *Rationale:* one unavailable tool should cost one piece of evidence, not the whole review.

### VI. Incremental Integration

- **VI.1** The product MUST consume existing tools (source control, issue tracker, Spec Kit,
  SonarQube, coverage reports, the AI CLI) and MUST NOT re-create them; it builds no custom
  code-intelligence, test-execution, static-analysis or dependency-graph engine.
  *Rationale:* the team's time goes into assembling evidence, not duplicating tools that exist.
- **VI.2** New evidence tools SHOULD be added as importers into the generic evidence model
  without UI changes.
  *Rationale:* a new harness should not mean a new screen.

### VII. No Developer-Level Metrics

- **VII.1** The product MUST NOT derive, store or display any metric that scores, ranks or
  times an individual, including review duration, time spent waiting on a person and defect
  counts per person. Ordering a reviewer's own queue by attributes of the pull requests
  (age, size, risk class, whether the reviewer was asked to review) is allowed and MUST show
  its reasons.
  *Rationale:* per-person metrics turn a review aid into a surveillance tool and change
  behaviour for the worse.
- **VII.2** Actor names on dispositions and history exist for audit only and MUST NOT be
  aggregated per person.
  *Rationale:* accountability needs to know who decided, not how a person compares.

### VIII. Provider Neutrality

- **VIII.1** Source control (Bitbucket Cloud target; GitHub, and self-hosted GitLab for
  development and testing), issue
  tracking (Jira target, GitHub Issues for development) and AI (Claude Code CLI first,
  Copilot later) MUST each sit behind a provider-neutral contract (`SourceControlProvider`,
  `IssueTracker`, `AiProvider`).
  *Rationale:* the target platforms differ from the development platforms, so both must
  be swappable.
- **VIII.2** No code outside an adapter MAY name, import or branch on a specific platform;
  adding a platform MUST NOT require changes outside its adapter. An automated check
  SHOULD fail the build when a platform name appears outside adapter code, tests and
  fixtures.
  *Rationale:* platform knowledge that leaks into core code makes every new platform a
  rewrite.
- **VIII.3** Every read contract (`SourceControlProvider`, `IssueTracker` and any quality
  provider) MUST be read-only: its adapters MUST NOT call any endpoint or command that
  creates, updates or deletes data on the external system. The reviewer actions allowed by
  II.1 and II.4 MUST go only through a separate `SourceControlWriter` contract, implemented
  per platform in its adapter, with its own method and endpoint allowlist and its own
  contract-test suite. The read adapters MUST NOT share a write-capable client with it.
  *Rationale:* keeping writes out of the read path means a bug in reading can never write,
  and every write has one place to audit (see II.1).

### IX. Repository Safety (NON-NEGOTIABLE)

- **IX.1** The product MUST NOT switch the developer's active branch or modify their working
  tree, index, stash or uncommitted files.
  *Rationale:* a review tool that loses someone's work will not be used twice.
- **IX.2** All git access MUST go through the Repository manager. Inspection MUST use
  detached worktrees in an application-owned directory; fetches MUST write only to
  remote-tracking refs or to refs in an application-owned namespace
  (`refs/<app-namespace>/*`); checkout, pull, merge, rebase, reset, stash and clean MUST NOT
  run against the developer's tree.
  *Rationale:* one controlled path to git makes the safety rule enforceable and testable. An
  app-owned namespace lets the product fetch a PR head (including one from a fork) without
  moving any ref the developer relies on.
- **IX.3** The AI provider MUST run with the isolated worktree as its workspace, never the
  developer's tree.
  *Rationale:* an AI tool with filesystem access must not be pointed at uncommitted work.
- **IX.4** Worktrees MUST be removed when a session closes and by a startup sweep of orphans.
  *Rationale:* leftover worktrees clutter the repository and can block branch operations.

### X. Local Server Security

- **X.1** The server MUST bind to `127.0.0.1` only, never to `0.0.0.0` or another
  interface, on a random free port chosen at launch.
  *Rationale:* a review server holding code and credentials must not be reachable from
  the network.
- **X.2** Every request MUST carry a per-launch secret token, generated from a
  cryptographically secure source and passed by the launcher to the browser at start-up;
  requests without a valid token MUST be rejected. The token MUST NOT be logged.
  *Rationale:* other local processes and web pages must not be able to use the API.
- **X.3** The server MUST reject requests whose `Host` header is not the bound loopback
  address and port, and whose `Origin` header, when present, is not the server's own origin.
  *Rationale:* this defeats DNS rebinding and cross-site requests.
- **X.4** The server MUST NOT send permissive CORS headers and MUST send a strict
  Content-Security-Policy (no `unsafe-inline`, no `unsafe-eval`, no third-party sources,
  `frame-ancestors 'none'`).
  *Rationale:* the browser's own protections are the last line of defence for a local app.
- **X.5** Every state-changing request MUST verify that its `Origin` is the server's own
  and reject it otherwise; `GET` and `HEAD` requests MUST NOT change state.
  *Rationale:* another website must not be able to trigger an action (CSRF).
- **X.6** The AI provider MUST be run with read-only permissions where the provider
  supports it; where it does not, the UI MUST show that read-only is not enforced.
  *Rationale:* least privilege where possible, and a visible gap where not (see V.1).
- **X.7** Credentials (Bitbucket, GitHub, Jira tokens) MUST be stored only in the OS
  keychain, through one credential-store module. They MUST NOT appear in config files,
  logs, the review store, API responses, browser storage, AI prompts or test fixtures.
  Throwaway credentials for the disposable local test instance (XI.4) are not reviewer
  credentials and MAY be committed. The product still reads GitLab credentials only through
  the credential store.
  *Rationale:* a token that is written anywhere else will eventually leak from there.
- **X.8** The credential-store module is security-critical and MUST have dedicated tests,
  including tests that fail if a credential reaches any location listed in X.7.
  *Rationale:* the rule is only as strong as the test that catches its breach.
- **X.9** Code and review context MUST be sent only to the configured AI provider. The
  product MUST NOT send telemetry, analytics or crash reports anywhere.
  *Rationale:* reviewers must know exactly where their code goes.
- **X.10** The AI provider MUST NOT load configuration, hooks, MCP servers or instruction
  files from the repository content under review, and MUST NOT be given network-capable
  tools.
  *Rationale:* a pull request can carry AI-tool configuration; loading it would let the PR's
  author run commands or rewrite the provider's instructions on the reviewer's machine, and
  network tools would give that content a way out.
- **X.11** The `SourceControlWriter` MUST refuse any method or endpoint not on its
  allowlist. A write request MUST be a state-changing request under X.5. Credentials MUST
  be asked for write scope only when the reviewer first uses a write action, and the scopes
  each platform needs MUST be documented. Automated tests MUST prove that the read adapters
  cannot write and that the writer refuses an unlisted endpoint.
  *Rationale:* a write path is the most dangerous code in a review tool, so it is narrow,
  explicit and tested for the ways it could widen.

### XI. Test-First Verification

- **XI.1** Development MUST follow the integrated-tdd process: every behaviour traces to a
  verification obligation, its failing test is written first, and completion evidence
  comes from real test runs.
  *Rationale:* tests written from requirements check the requirement, not the code.
- **XI.2** Bitbucket and Jira adapters MUST be tested against recorded API fixtures; GitHub
  adapters MAY additionally be tested against live data. Each contract MUST have one
  contract-test suite that every adapter of that contract passes. GitLab adapters MAY
  additionally be tested live against the local instance (XI.4).
  *Rationale:* the target platforms may be unreachable during development, and adapters
  are only interchangeable if they pass the same tests.
- **XI.3** Each rule in principles IX and X MUST have an automated test that fails when the
  rule is broken. Repository-safety tests MUST compare the developer's branch, HEAD,
  index, working-tree status and stash before and after each repository operation.
  *Rationale:* safety and security rules that are not tested will regress unnoticed.
- **XI.4** Tests MAY create, change and delete repositories, pull requests and issues on a
  disposable platform instance that runs on the developer's or CI machine, is bound to
  loopback, and exists only for testing. That writing MUST be done by test-only code under
  `test/`, never by product code or through an adapter. It MUST NOT target any hosted or
  shared platform (GitHub, GitLab.com, Bitbucket Cloud, Jira Cloud). Each suite MUST change
  only data it created.
  *Rationale:* II.1 and VIII.3 keep the product an observer, but realistic scenarios for its
  read paths must be created by something. A disposable local instance is the one place
  where writing can't affect anyone else's work.
- **XI.5** `SourceControlWriter` adapters MUST be tested against recorded fixtures, and MAY
  additionally be tested live against the disposable local instance (XI.4). They MUST NOT
  be exercised against any hosted or shared platform by an automated test.
  *Rationale:* product code can now write, so the test rule that keeps writes away from
  real teams' pull requests has to cover it too.

## Platform and Technical Constraints

- **P.1** The product MUST be a local Node.js server with a browser UI, written as one
  TypeScript codebase with `strict` mode enabled. Electron, Tauri, hosted deployment and
  native packaging are excluded.
  *Rationale:* one runtime and one language keep a four-person team fast.
- **P.2** The product MUST run on the active Node.js LTS line (Node.js 24 at ratification),
  declared in `package.json` `engines`.
  *Rationale:* an LTS runtime is what work machines can be expected to have.
- **P.3** The product MUST be distributed as an npm package (public or internal) and MUST
  start with a single `npx` command that starts the server and opens the browser.
  *Rationale:* installation friction decides whether reviewers try the tool at all.
- **P.4** The product MUST behave the same on Windows, macOS and Linux. It MUST NOT use
  shell-specific scripts, MUST build file paths with Node's `path` functions, and MUST run
  git and other child processes with argument arrays and no shell. The test suite SHOULD
  run on all three operating systems before a release.
  *Rationale:* shells and path separators are the usual source of cross-platform defects,
  and a shell also opens a command-injection path.
- **P.5** The server MUST run under plain `node --inspect`, MUST emit structured logs, and
  the development server MUST start from source with no build step other than TypeScript
  tooling.
  *Rationale:* a developer must be able to attach a debugger and read logs without a
  pipeline in the way.

## Development Workflow and Quality Gates

- **Q.1** Runtime dependencies MUST be kept to a minimum. Each new runtime dependency MUST
  be recorded in the feature's plan with its purpose and the alternative considered.
  *Rationale:* every dependency is code the team must trust, update and audit.
- **Q.2** Phase 1 (MVP) scope is FR-1, FR-2, FR-3 and FR-5.1, 5.2, 5.4 and 5.5 of
  `MVP/MVP.md`, plus the read-only fetch of a linked issue's title and description (part of
  FR-4.1), as decided in ADR 0001. ADR 0003 brings forward, as features 004 to 010: review
  progress, AI review passes with finding triage (FR-7.3 to 7.6 in part), FR-4.1 to 4.5 and
  spec context, reviewer workload on Home, SonarQube evidence (FR-6), and the reviewer
  actions in II.4. The rest of FR-4, FR-5.3, FR-5.6, FR-7 and FR-8 stay Phase 2
  (`MVP/Phase 2.md`). Items listed in section 8.2 of `MVP/MVP.md` are out of scope and MUST
  NOT be specified or built without an amendment.
  *Rationale:* a 6–8 week MVP fails by growing, not by shrinking; each addition is named so
  the scope stays a list, not a drift.
- **Q.3** If scope must shrink, AI interrogation (FR-2) and the evidence foundation (FR-1,
  the evidence model, repository safety) MUST be protected first.
  *Rationale:* these are the capabilities the rest of the product depends on.

## Governance

- **G.1** This constitution takes precedence over other project practices. Where a
  specification, plan or task conflicts with it, the constitution wins until amended.
- **G.2** The constitution MAY be amended only by a versioned change that records its
  rationale. Versions follow semantic versioning: MAJOR when a principle is removed or
  redefined, MINOR when a principle or section is added or materially expanded, PATCH for
  wording and clarification.
- **G.3** `/speckit-plan` and `/speckit-analyze` MUST check each feature against every
  principle and report each violation with its rule number and a justification. A
  violation without a justification blocks the feature.
- **G.4** A violation of a NON-NEGOTIABLE principle cannot be justified; it can only be
  removed from the feature or permitted by amending the constitution.

**Version**: 3.0.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-10

**Amendment 2.0.0 (2026-11-10, ADR 0003)**: MAJOR, because II.1 and VIII.3 are redefined.
Adds II.4, X.11 and XI.5; clarifies II.2 (the reviewer's own approval is a fact, not a
readiness verdict), VII.1 (queue ordering by pull request attributes) and Q.2 (named scope
additions). Rationale: the product is to help a reviewer act, not only read, and the
reviewer actions are the platform input a person must give.

**Amendment 3.0.0 (2026-11-10, feature 005)**: MAJOR, because a safeguard is removed. II.4
no longer requires a separate preview-and-confirm step; a write is one deliberate click
that carries the viewed head commit, which the server checks. X.11 no longer requires a
confirmation token. Rationale: the reviewer asked for comments and decisions to post
immediately; the action-named button, the head-commit check, the allowlist and the
append-only record remain.
