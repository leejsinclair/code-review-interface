# Feature Specification: PR Review Workbench, Feature 1: PR Context and Interrogation

**Feature Branch**: `001-pr-review-workbench`
**Created**: 2026-11-07
**Status**: Draft

**Grilled on**: 2026-11-07

**Input**: `MVP/MVP.md` (product and technical specification for Phase 1)

The workbench helps a reviewer understand a pull request, see where review attention is needed, and judge whether the evidence supports merging. It gathers evidence around the PR. It never approves, merges or changes anything on any platform. Requirement IDs in brackets, such as (MVP FR-1.1), trace back to `MVP/MVP.md` and its wireframes W1 to W8.

Phase 1 (the MVP) delivers PR context (MVP FR-1), summary and interrogation (MVP FR-2), risk classification (MVP FR-3) and core changed-line coverage (MVP FR-5.1, 5.2, 5.4, 5.5). This spec is the first Phase 1 feature: opening a PR with its context, and understanding and interrogating the change. Risk classification and changed-line coverage are later Phase 1 features. Requirements traceability, SonarQube evidence, readiness and decisions, and role lenses are Phase 2 (see [ADR 0001](../../docs/domain_knowledge/adr/0001-phase-1-scope.md)).

## Clarifications

### Session 2026-11-07

- Q: Should the whole MVP stay one spec, or be cut into smaller features? → A: Cut this spec down to Stories 1 and 2 (context and questioning). Specify the rest as later features.
- Q: Where does the workbench get the code it analyses? → A: Only from the reviewer's existing local clone. Without one, a missing-repository notice is shown and only PR metadata is available.
- Q: What should Phase 1 deliver, judged by what a technical lead needs to test the concept? → A: FR-1, FR-2, FR-3 and core changed-line coverage (FR-5.1, 5.2, 5.4, 5.5). FR-4, FR-5.3, FR-5.6, FR-6, FR-7 and FR-8 move to Phase 2.
- Q: Does Phase 1 fetch the linked issue, and which sources does the completeness list show? → A: Fetch the linked issue's title and description read-only, as documented intent for interrogation. The completeness list shows only the sources Phase 1 checks: PR, repository and issue here, plus coverage once the Phase 1 coverage feature adds it.
- Q: How does Phase 1 read Jira issues in the target environment? → A: With a personal Jira API token (account email plus token) kept in the OS keychain, used only for read-only issue lookups. Without a token, the issue shows as unresolved with the reason "no Jira access configured".
- Q: Should a canonical glossary be recorded, and this spec use it? → A: Adopt the MVP's terms as canonical (including MVP meaning Phase 1), record them in `docs/domain_knowledge/CONTEXT.md`, and use them here: interrogation, claim and isolated workspace replace questioning, statement and private copy.
- Q: Where do the requirements moved out of Phase 1, and the MVP's later lists, go? → A: `MVP/Phase 2.md` holds the moved requirements plus the former "after validation" items; `MVP/Phase 3.md` holds the backlog. `MVP/MVP.md` keeps its name and holds Phase 1.

### Session 2026-11-07 (tech-lead review)

- Q: Does the constitution match the Phase 1 scope? → A: No. Constitution 1.1.0 amends rule Q.2 to the ADR 0001 scope, adds rule X.10 (the AI provider loads no configuration from the reviewed repository and has no network tools), and lets rule IX.2 fetches write to an app-owned ref namespace.
- Q: What restrictions does the AI provider run under? → A: It runs in the isolated workspace with read and search tools only, cannot read outside that workspace, has no network tools, loads no project-level settings, hooks, MCP configuration or instruction files from the PR, and treats PR text, issue text and code as untrusted input that cannot change its instructions (FR-022).
- Q: Does this feature include a diff and code view? → A: Yes: each changed file's diff for the current snapshot, a line range (new or old side) or whole file as a question scope, and opening any cited file and line at the snapshot's commit (FR-033 to FR-035). The risk overlay arrives with the FR-3 feature.
- Q: What is a "method" scope? → A: A line range the user selects, with an optional label. No code parser is built. Scope types are `pr`, `file` and `range` (FR-013).
- Q: What do resolvable reference, context version and session close mean? → A: As defined under Definitions and in `CONTEXT.md`.
- Q: When is context stale or missing? → A: Commit-bound evidence goes stale when the head moves. Issue evidence is re-fetched on refresh and is stale only if re-fetching fails. The PR row is stale when the platform head has moved past the latest snapshot. The repository row is missing when no local clone matches by remote URL. The issue row is missing when there is no issue and otherwise lists each issue with its own status. PR and repository rows are derived from the session and snapshot, not stored as Evidence (FR-007, FR-011).
- Q: What are summaries made of? → A: Labelled claims with references, like answers. They stream, are stored per snapshot, and are regenerated for each new snapshot with the old ones kept (FR-012).
- Q: Are unsupported assumptions and follow-up questions shown? → A: Yes, with every answer (FR-046, FR-047). Suggested questions are fixed templates per scope and category in Phase 1 (FR-015).
- Q: How does the PR head reach the isolated workspace? → A: It is fetched into an app-owned ref namespace in the local clone without touching the working tree; the workspace is a detached worktree; the diff is computed locally from the merge-base when a clone exists, otherwise taken from the platform (FR-036 to FR-038).
- Q: How are platforms configured and signed in? → A: Configuration names the repository, platform and local clone path. Each platform has its own sign-in, with tokens in the keychain: Bitbucket Cloud API token (app passwords are no longer accepted), GitHub token, Jira Cloud email plus API token (FR-039, FR-040).
- Q: Must Jira Data Center be supported in Phase 1? → A: No. Phase 1 supports Jira Cloud only; Data Center can follow later as another adapter behind the same contract.
- Q: Can sessions whose PR is closed or merged still be reached? → A: Yes. Existing sessions are listed, including those whose PR is closed or merged, and these reopen read-only (FR-041).
- Q: Which issue references are accepted, and how is issue text handled? → A: Jira keys only for configured project keys or when the tracker confirms them; `#123` resolving to a PR is shown as a PR reference; issue descriptions are converted to plain text before display and use (FR-003, FR-004).
- Q: Where is generated-file detection specified? → A: In the FR-3 risk feature, which owns mechanical-change handling; this feature does not detect generated files.
- Q: How are the success criteria judged? → A: Bitbucket Cloud and Jira Cloud must each pass on at least one real PR before Phase 1 exit; recorded responses are for automated tests only. Ratings are collected outside the workbench by a named evaluator on a stated scale; none is stored (SC-001 to SC-003, SC-009 to SC-011).
- Q: Where is local data kept? → A: In the user's per-user application-data directory, outside every repository (FR-043).
- Q: How can a session be deleted, given that review history is append-only (constitution III.2)? → A: Only a whole session can be deleted, in one confirmed action that removes everything under it; single questions and answers cannot be edited or deleted. III.2 is clarified in constitution 1.1.0 (FR-044).
- Q: How do streaming and labelled claims fit together? → A: Raw text streams, marked as in progress and not yet checked, and is replaced by the labelled claims when the answer completes. A cancelled partial answer is kept, marked cancelled, and all its claims are shown as Inference (FR-021, FR-045).
- Q: How is a business-language answer chosen? → A: By a per-question "Answer for: Technical / Business" choice, defaulting to Technical and stored with the question; no role lens is needed (FR-048).
- Q: What size limits apply? → A: A file is skipped when it is binary, over 1 MB or over 5,000 changed lines; a prompt holds at most 400,000 characters of diff and context, filled in diff order. Both limits are configurable with these defaults, and every skipped file appears with its reason in the summary and the completeness list (FR-049).
- Q: What happens when an FR-022 restriction cannot be enforced, given that constitution X.10 makes "no network tools" and "no repository configuration" absolute? → A: If either of those cannot be enforced, interrogation and summaries are unavailable with the reason. If one of the other three cannot be enforced, the provider runs and every answer names each restriction not enforced. Untrusted input counts as enforced when PR, issue and code text are passed as delimited data apart from the instructions (FR-022).
- Q: Which smaller corrections apply? → A: Story 1 Scenario 5 is reworded; Verbatim Constraints separate display labels from stored values; the Requirements category uses only issue text in Phase 1; W4's lens switcher and "Add as finding" are Phase 2.

### Session 2026-11-07 (clarify)

- Q: Does a question carry the session's earlier questions and answers as context? → A: No. Each question is answered from its scope, the snapshot's context and the linked issues only; a follow-up started from an answer also carries that parent question and its answer's claims, which count toward the context version (FR-050).
- Q: Which snapshot do new questions and summaries apply to after a refresh? → A: Only the latest. Answers and summaries from earlier snapshots stay readable and are marked with the older head commit they were produced for (FR-051).
- Q: When does the workbench check the platform for a new PR head, and when is a snapshot taken? → A: The head and PR status are checked when a session is opened and on refresh, with no background polling; a new snapshot is taken only when the user refreshes (FR-052).
- Q: Are summaries generated automatically, and how many AI requests run at once? → A: Summaries are generated automatically when a snapshot is taken. Per session, at most one summary generation and one question run at a time; further questions queue in order and can be cancelled before they start (FR-053).
- Q: What may the workbench's logs contain? → A: Structured operational records (operation, outcome, duration, errors, session/snapshot/request ids) in the application-data directory, rotated and kept 7 days by default; never credentials, the launch token, code, diff, prompt or answer text, or PR and issue text (FR-054).

### Session 2026-11-07 (analyze)

- Q: How is the head of a PR from a fork fetched? → A: From wherever the platform exposes it: the fork's repository, or the base repository's PR ref where the platform offers one (GitHub's `refs/pull/<n>/head` covers forks). Either way it is written only to the app-owned ref namespace (FR-036, EC-16).
- Q: Are summaries generated for a session with no isolated workspace? → A: No. Without a matching clone, or when the fetch failed, summaries and questions are unavailable with the repository row's reason; PR metadata and the platform's diff still show (FR-005).
- Q: How does a provider error end a question or summary? → A: As failed, with the reason, kept as a visible gap. Cancelled is kept for a user cancel, a superseding refresh or a restart (FR-032, EC-02).
- Q: Does citing the PR description keep a claim labelled Evidence? → A: No. A PR-description reference supports documented intent (FR-017) but on its own leaves the claim Inference; only code and issue references are resolvable references (FR-018).
- Q: What happens to work queued for an older snapshot when a refresh takes a new one? → A: Questions and summaries still queued for the older snapshot are cancelled, marked superseded; work already running finishes against its own snapshot (FR-051).
- Q: Does every refresh take a new snapshot? → A: No. A refresh takes a new snapshot only when the platform head differs from the latest snapshot's head, or when the latest snapshot's fetch failed (FR-052).
- Q: What happens when a closed PR is reopened on the platform? → A: The session stays read-only and shows a note that the PR was reopened; Phase 1 does not resume a read-only session (FR-041).
- Q: What counts as a code identifier in a Business answer? → A: A name that appears in the changed lines, such as a function, class, variable or file name (FR-048).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a PR and see what context exists (Priority: P1)

A reviewer starts the workbench, picks an open pull request from the configured repository, and starts a review session. The workbench gathers the PR's title, description, author, branches, commits, diff and changed files, finds the issue references it mentions, and prepares an isolated workspace, a read-only copy of the code, for analysis. A context-completeness list shows which sources were found, which are missing and which are stale. The reviewer's own branch and uncommitted work are never touched.

**Why this priority**: every other capability works on the context this story assembles. It is also where the non-negotiable safety rule is first exercised.

**Independent Test**: against a test repository with a dirty working tree, select an open PR and start a session. Check the PR details, the found issue references with their origin, the completeness list, and that the reviewer's branch, uncommitted files and stash are byte-for-byte unchanged.

**Acceptance Scenarios**:

1. **Given** a configured repository with three open PRs, **When** the reviewer opens the workbench, **Then** all three are listed and any one can be selected to start a session.
2. **Given** a PR whose branch name holds one issue key and whose description holds another, **When** the session starts, **Then** both references are shown, each labelled with where it was found.
3. **Given** a PR with no linked issue, **When** the session starts, **Then** the completeness list shows the issue as missing, and the session still opens.
4. **Given** a PR that references an issue, **When** the session starts, **Then** the issue's title and description are fetched and shown, and nothing on the issue tracker changes.
5. **Given** the reviewer's active branch is not the PR branch and has uncommitted changes, **When** a session is started, refreshed and closed, **Then** the reviewer's active branch, uncommitted files, index and stash are unchanged.
6. **Given** a session already exists for a PR, **When** the reviewer opens that PR again, **Then** the same session is reused and its history is intact, not duplicated.
7. **Given** the PR author pushes a new commit, **When** the reviewer refreshes the session, **Then** a new snapshot is taken, the changes between the two head commits can be identified, and context captured for the old commit is marked stale.
8. **Given** a session whose PR has since been merged, **When** the reviewer opens the list of review sessions, **Then** the session is listed as merged and opens read-only with its snapshots, summaries, questions and answers.
9. **Given** the PR's branch is checked out in the reviewer's clone, **When** a session is started, **Then** the session opens normally and the reviewer's branch, its checkout and its local branch ref are unchanged.
10. **Given** a session whose PR has received a new commit since it was last opened, **When** the reviewer opens the session, **Then** the PR row shows stale, a refresh is offered, and no new snapshot is taken until the reviewer refreshes.

---

### User Story 2 - Understand the change and ask questions about it (Priority: P1)

The reviewer reads a summary of the whole PR, a summary of each changed file, and statements of its functional and technical impact. They select a line range (optionally labelled, for example with a method name), a file or the whole PR and ask a question in one of six categories. The answer streams in, every claim in it is labelled Evidence or Inference, and each reference opens the code or issue it points to. A business analyst can ask the same way and choose to have the answer written for a business reader.

**Why this priority**: interrogation is the capability the product is built around and the first one protected if scope must shrink.

**Independent Test**: on a session from Story 1, generate the summaries, then ask one question scoped to a line range and one about the whole PR. Check that each claim carries a label, that Evidence claims have working references, and that no file in the repository changed.

**Acceptance Scenarios**:

1. **Given** an open session, **When** the reviewer opens the overview, **Then** a PR summary, per-file summaries and functional and technical impact statements are shown.
2. **Given** the reviewer has selected lines 40 to 60 of a file, **When** they ask a "Why" question, **Then** the answer is scoped to that selection and cites file and line references that open in the diff.
3. **Given** the AI returns a claim typed Evidence with no reference that resolves, **When** the answer is displayed, **Then** that claim is shown as Inference.
4. **Given** the AI returns text that cannot be read as structured claims, **When** the answer is displayed, **Then** it appears as a single Inference with a warning.
5. **Given** a BA sets "Answer for" to Business and asks "Can a customer reset a password more than once?", **When** the answer returns, **Then** its claims contain no code identifiers, it links to the code and issue it rests on, and the question is stored with the Business choice.
6. **Given** a question has been answered, **When** the reviewer reopens the session later, **Then** the question and answer are there with the provider, time and context version used.
7. **Given** a PR whose `.claude/settings.json` defines a hook that would create a marker file, **When** the summaries are generated and a question is asked, **Then** the marker file does not exist anywhere afterwards and the hook did not run.
8. **Given** an answer cites a line the PR removed and a file outside the diff, **When** the reviewer opens each reference, **Then** the removed line opens at the snapshot's base commit and the other file opens at the snapshot's head commit, each at the cited line.
9. **Given** two questions have been answered in a session, **When** the reviewer selects a suggested follow-up on the second answer, **Then** the new question's stored prompt contains the second question and its answer's claims and does not contain the first question.
10. **Given** questions were answered before a refresh took a new snapshot, **When** the reviewer views the session, **Then** those answers are shown marked with their older head commit, the summaries for the new snapshot are generated automatically, and new questions apply to the new snapshot.

---

### Edge Cases

- EC-01 **No local clone matching the configured repository** (no clone at the configured path, or none of its remotes points at the configured repository): the repository row is missing with the reason; analysis that needs code is not attempted, and PR metadata and the platform's diff still show.
- EC-02 **One connector fails** (issue tracker down, AI provider error): that source shows as missing with the failure reason, and a question or summary the provider fails on ends as failed with the reason; the others continue.
- EC-03 **PR closed, merged or deleted while a session is open**: the session stays readable with its history and shows the PR's new status; refresh reports the change rather than failing, and the session becomes read-only.
- EC-04 **Force-push that rewrites history**: the new head is a new snapshot; earlier snapshots and their questions and answers are kept.
- EC-05 **Very large PR or binary files**: files over the FR-049 limits and binary files are listed with their status but not included in any prompt; the summary and the completeness list say which files were skipped and why.
- EC-06 **The same issue referenced several times or in conflicting forms**: each distinct issue is shown once, with every place it was found.
- EC-07 **Issue reference that does not resolve** (wrong key, no access): shown as unresolved with the reason, not dropped.
- EC-08 **The AI provider is not installed or not signed in**: interrogation shows as unavailable with the reason; PR context still works.
- EC-09 **The AI provider cannot enforce an FR-022 restriction**: without "no network tools" or "no repository configuration", interrogation and summaries are unavailable with the reason; without any other restriction, every answer and summary names the restriction not enforced.
- EC-10 **A question is cancelled mid-answer**: the text received so far is kept as one Inference, marked cancelled.
- EC-11 **Workbench crashes or is closed with sessions open**: on next start, leftover isolated workspaces are removed and sessions reopen from storage. An answer or summary that was in progress is kept as cancelled (FR-045); queued questions that had not started are kept, marked cancelled.
- EC-12 **A question is asked while another is running**: it waits in the session's queue (FR-053) and shows as queued; it can be cancelled before it starts.
- EC-13 **Credentials missing or expired**: the user is asked to sign in again for that platform; nothing else is blocked.
- EC-14 **PR adds AI-tool configuration files** (for example `.claude/settings.json`, `CLAUDE.md`, `.mcp.json`): they are shown and reviewed as changed files like any other; the AI provider does not load them, so their hooks, MCP servers and instructions have no effect.
- EC-15 **PR text, issue text or code contains instructions aimed at the AI**: they are treated as content to analyse and do not change the provider's instructions.
- EC-16 **PR from a fork**: the head is fetched into the app-owned ref namespace from wherever the platform exposes it (the fork's repository, or the base repository's PR ref); if the fork cannot be fetched, the repository row is missing with the reason and the diff is taken from the platform.
- EC-17 **PR branch already checked out by the reviewer**: the session works normally; the fetch writes only to the app-owned ref namespace and the workspace is a detached worktree, so the reviewer's checkout and branch ref are untouched.
- EC-18 **Fetch fails** (network, authentication, commit no longer on the remote): the repository row is missing with the failure reason; the diff is taken from the platform and analysis that needs code is not attempted.

## Requirements *(mandatory)*

### Functional Requirements

**PR discovery and context (Story 1)**

- **FR-001**: The workbench MUST list the open PRs of the configured repository and let the user select one. (MVP FR-1.1)
- **FR-002**: The workbench MUST retrieve the PR's title, description, author, source and target branch, commits, full diff and changed-file metadata. (MVP FR-1.2)
- **FR-003**: The workbench MUST extract issue references from the branch name, PR title and description, and show the source of each. A Jira key MUST be accepted only when its project key is configured or the issue tracker confirms the issue exists. A `#123` reference that resolves to a pull request MUST be shown as a PR reference, not an issue. (MVP FR-1.3)
- **FR-004**: The workbench MUST fetch each referenced issue's title and description, read-only, convert the description to plain text before display and use, and use them as documented intent when answering questions. Jira Cloud is read with the user's account email and API token; without them, each Jira issue MUST show as unresolved with the reason "no Jira access configured". (MVP FR-4.1 in part, FR-2.6)
- **FR-005**: The workbench MUST analyse code only in an isolated, read-only workspace it creates from the reviewer's existing local clone, never in the reviewer's working copy. Without a local clone it MUST show a missing-repository notice and offer only PR metadata and the platform's diff; it MUST NOT clone the repository itself. Without an isolated workspace (no matching clone, or the fetch failed), summaries and questions MUST be unavailable, with the repository row's reason. (MVP FR-1.4, 6.3)
- **FR-006**: The workbench MUST keep exactly one review session per repository and PR; refreshing updates it and never duplicates its history. (MVP FR-1.5)
- **FR-007**: The workbench MUST show a context-completeness list with rows for PR, repository and issue, each found, missing or stale, and only for sources the workbench actually checks; later features add their own rows. The PR row is found when the latest snapshot's head commit is the platform's PR head, and stale when the platform head has moved past it or the platform cannot be reached to check. The repository row is found when a local clone with a remote pointing at the configured repository exists and the PR head was fetched into it, and missing, with the reason, otherwise. The issue row is missing when the PR has no issue reference; otherwise it lists each issue with its own status: found when fetched, missing with the reason when unresolved, stale when the latest re-fetch failed. The PR and repository rows are derived from the session and its latest snapshot and are not stored as Evidence. (MVP FR-1.6)
- **FR-008**: The workbench MUST NOT switch the reviewer's active branch or change their working files, uncommitted changes, index or stash. (MVP 6.3, 7.3)
- **FR-009**: The workbench MUST remove its isolated workspaces when a session closes and remove leftover ones at start-up. (MVP 6.3)
- **FR-010**: Each refresh MUST keep a fixed snapshot per PR head commit, so changes between commits can be identified. (MVP FR-1 acceptance, 5)
- **FR-011**: Every captured context source MUST be recorded in one shared evidence model with the time it was captured and the commit it applies to, and earlier records MUST be kept, never deleted. Commit-bound evidence MUST be marked stale when the PR head moves past its commit. Issue evidence MUST be re-fetched on each refresh: when re-fetching succeeds, the new record is current; when it fails, the issue MUST be shown stale with the failure reason, using the last fetched record. (MVP FR-6.6, 5.1)

**Understanding and interrogation (Story 2)**

- **FR-012**: The workbench MUST produce a PR summary, a summary per changed file, and functional and technical impact statements, each made of labelled claims with references, as answers are. Summaries MUST stream as they are produced, MUST be stored per snapshot, and MUST be regenerated for each new snapshot, keeping the earlier ones. (MVP FR-2.1)
- **FR-013**: Users MUST be able to ask a question scoped to the whole PR, a file or a line range. A "method" scope is a line range the user selects, with an optional label such as the method's name; the workbench builds no code parser to find methods. (MVP FR-2.2; constitution VI.1)
- **FR-014**: Each question MUST belong to one category: What, Why, How, What-if, Risk or Requirements. In Phase 1, Requirements questions draw only on the text of the linked issues. (MVP FR-2.3)
- **FR-015**: The workbench MUST offer suggested questions that depend on the selected scope; in Phase 1 they are fixed templates per scope and category. (MVP FR-2.4)
- **FR-016**: Every answer MUST show its source references (file and line, issue key), and each reference MUST open the code or issue. (MVP FR-2.5)
- **FR-017**: Every claim in an answer MUST be labelled Evidence or Inference, and documented intent MUST be shown apart from inferred intent. (MVP FR-2.6)
- **FR-018**: A claim labelled Evidence without at least one resolvable reference MUST be shown as Inference. (MVP 6.2)
- **FR-019**: An answer that cannot be read as labelled claims MUST be shown as one Inference with a warning. (MVP 6.2)
- **FR-020**: Every question and answer MUST be kept with its provider, timestamp, prompt and the context version used, and the context version MUST be shown with every answer. (MVP FR-2.7, 6.2)
- **FR-021**: Answers and summaries MUST stream as raw text while they are produced, marked as in progress and not yet checked, and MUST be replaced by their labelled claims, with references checked, when they complete. The user MUST be able to cancel a question. (MVP 6.1, 7.3)
- **FR-022**: The AI provider MUST run under all of these restrictions: (a) its workspace is the session's isolated workspace and its only tools read and search files; (b) it cannot read files outside that workspace; (c) it has no network-capable tools; (d) it loads no project-level settings, hooks, MCP server configuration or instruction files (such as `CLAUDE.md`) found in the repository content under review; (e) PR text, issue text and code reach it as untrusted input that cannot change its instructions, which counts as enforced when that text is passed as delimited data apart from the instructions. If (c) or (d) cannot be enforced, interrogation and summaries MUST be unavailable, with the reason. If (a), (b) or (e) cannot be enforced, every answer and summary MUST name each restriction that is not enforced. (MVP FR-2.8, 6.2; constitution IX.3, X.6, X.10)
- **FR-023**: Each question MUST be answered by exactly one provider. (MVP 6.2)
- **FR-024**: Users SHOULD be able to ask business-language questions through the same interface, using the "Answer for" choice (FR-048). (MVP FR-2.9)

**Platforms, trust and privacy (both stories)**

- **FR-025**: The workbench MUST work with Bitbucket Cloud and Jira Cloud in the target environment and with GitHub and GitHub Issues for development, and adding a platform MUST NOT change behaviour outside that platform's connector. (MVP 3.1, 3.3)
- **FR-026**: Issue references, branch names and PR references MUST be stored with their platform, in a form that allows later cross-PR grouping. (MVP 3.3)
- **FR-027**: The workbench MUST NOT approve, decline, merge, comment on or otherwise change any PR, issue or repository on any platform. (MVP FR-7.7)
- **FR-028**: Platform credentials MUST be kept in the operating system's secure credential store and MUST never be shown, logged or sent to the AI provider. (MVP 7.3)
- **FR-029**: Code and review context MUST be sent only to the configured AI provider; the workbench MUST send no telemetry anywhere. (MVP 7.3)
- **FR-030**: The workbench MUST be reachable only from the user's own machine and only by the user's own browser session. (constitution X)
- **FR-031**: The workbench MUST NOT compute, store or show any metric that scores, ranks or times an individual. (MVP 5.1, 7.3)
- **FR-032**: A failing source MUST show as a visible gap with its reason and MUST NOT block other sources. (MVP 7.3)

**Diff and code view (Story 2)**

- **FR-033**: The workbench MUST show each changed file's diff for the current snapshot, with the file's status and its lines added and removed. The risk overlay on this view arrives with the FR-3 risk feature. (MVP FR-1.2, W3)
- **FR-034**: From the diff, users MUST be able to select a line range on the new or the old side, or a whole file, as the scope of a question. (MVP FR-2.2)
- **FR-035**: Users MUST be able to open any cited file and line at the snapshot's head commit, including files outside the diff, and any cited removed line at the snapshot's base commit. (MVP FR-2.5)

**Fetching and the isolated workspace (Story 1)**

- **FR-036**: The workbench MUST fetch the PR head commit and the target branch into the local clone, writing only to an app-owned ref namespace, without touching the working tree, index, local branches or stash. A PR from a fork MUST be fetched in the same way, from wherever the platform exposes its head: the fork's repository, or the base repository's PR ref. When the fetch fails, the repository row MUST show missing with the failure reason. (MVP 6.3; constitution IX.2)
- **FR-037**: The isolated workspace MUST be a detached worktree at the snapshot's head commit, in an application-owned directory. (MVP 6.3; constitution IX.2)
- **FR-038**: When the PR head has been fetched into the local clone, the diff MUST be computed locally from the merge-base of the target branch and the PR head; otherwise it MUST be taken from the platform. Each snapshot MUST record where its diff came from and, when known, its base commit. (MVP FR-1.2)

**Configuration and sign-in (both stories)**

- **FR-039**: The user MUST configure the repository (its platform and identifier), the path of its local clone, and the issue tracker (its platform, site and, for Jira, the project keys). The configuration MUST hold no credentials. (MVP 3.1)
- **FR-040**: The user MUST sign in to each configured platform separately, and each token MUST be kept only in the operating system's keychain: Bitbucket Cloud with an Atlassian account email and API token (Bitbucket no longer accepts app passwords, so they MUST NOT be offered); GitHub with a personal access token; Jira Cloud with an account email and API token. Each sign-in MUST be checked with a read-only call, and a rejected or expired token MUST prompt sign-in again for that platform only. (MVP 3.1, 7.3; constitution X.7)

**Sessions and local data (both stories)**

- **FR-041**: The workbench MUST list the existing review sessions, including those whose PR is now closed or merged, with each PR's current status. A session whose PR is closed or merged MUST open read-only: its snapshots, summaries, questions and answers can be read, and its references opened while their commits remain in the local clone, but it cannot be refreshed or asked new questions. A session whose PR is reopened on the platform MUST stay read-only and show a note that the PR was reopened. (MVP FR-1.5)
- **FR-042**: Closing a session, by the user or by server shutdown, MUST keep the session record and remove only its isolated workspace. (MVP 6.3)
- **FR-043**: The review store and the isolated workspaces MUST live in the user's per-user application-data directory for their operating system, outside every repository, including the local clone. (MVP 3.1, 7.3)
- **FR-044**: The user MUST be able to delete a whole review session, after confirming, which removes the session with its snapshots, summaries, Evidence, questions, answers and stored prompts, its isolated workspace and its app-owned refs in the local clone. Single questions and answers MUST NOT be editable or deletable. (MVP 7.3; constitution III.2)

**Answers (Story 2)**

- **FR-045**: A cancelled answer MUST be kept with the text that had arrived, marked cancelled, and all its claims MUST be shown as Inference; text that never completed into claims is shown as one Inference. (MVP 6.1, 6.2)
- **FR-046**: Every answer MUST show, apart from its claims, the unsupported assumptions it rests on. (MVP FR-2 acceptance, 6.1)
- **FR-047**: Every answer MUST show the provider's suggested follow-up questions; selecting one MUST start a new question with that text and the same scope. (MVP 6.1, W4)
- **FR-048**: Each question MUST carry an "Answer for" choice of Technical or Business, defaulting to Technical and stored with the question. A Business answer MUST keep code identifiers (names that appear in the changed lines, such as function, class, variable or file names) out of its claim text while keeping the same claims, labels and references as a Technical answer. (MVP FR-2.9)

**Limits (Story 2)**

- **FR-049**: A changed file MUST be left out of every prompt when it is binary, larger than 1 MB, or has more than 5,000 changed lines. A prompt MUST hold at most 400,000 characters of diff and context; when a whole-PR prompt would exceed this, files MUST be included in diff order until the limit is reached and the rest left out with the reason "prompt limit". Every file left out MUST be listed with its reason in the summary and, under the repository row, in the completeness list. Both limits MUST be configurable, with these values as defaults. (MVP 7.2)

**Question context, snapshots and concurrency (both stories)**

- **FR-050**: Each question MUST be answered from its scope, the snapshot's context and the linked issues only, without the session's earlier questions and answers. A follow-up started from an answer (FR-047) MUST also include that parent question and its answer's claims; the follow-up MUST store which question it follows, and the parent content MUST count toward its context version. (MVP FR-2.7, 6.2)
- **FR-051**: Questions and summaries MUST be produced only for the session's latest snapshot. Answers and summaries produced for earlier snapshots MUST stay readable and MUST be marked with the older head commit they were produced for. When a refresh takes a new snapshot, questions and summaries still queued for an earlier snapshot MUST be cancelled, marked superseded; work already running finishes against its own snapshot. (MVP FR-1.5; constitution V.3)
- **FR-052**: The workbench MUST check the platform's PR head and status when a session is opened and when the user refreshes, and MUST NOT poll in the background. A new snapshot MUST be taken only at session start and when the user refreshes, and a refresh MUST take one only when the platform head differs from the latest snapshot's head or the latest snapshot's fetch failed; when an open check finds the head has moved, the PR row MUST show stale and a refresh MUST be offered. (MVP FR-1.5, FR-1.6)
- **FR-053**: Summaries for a snapshot MUST be generated automatically when the snapshot is taken. Within a session, at most one summary generation and one question MUST run at a time; further questions MUST wait in order, shown as queued, and MUST be cancellable before they start. (MVP FR-2.1, 6.1)
- **FR-054**: The workbench MUST write structured logs to its application-data directory recording each operation, its outcome, duration and errors, with session, snapshot and request ids. Logs MUST be rotated and kept 7 days by default. Logs MUST NOT contain credentials, the per-launch token, code, diff text, prompt or answer text, or PR and issue text. (MVP 7.3; constitution P.5, X.2, X.7, X.9)

### Key Entities

- **Review session**: the review of one PR in one repository. Holds the platform, PR, issue references, branches, current head commit, the PR's status (open, closed or merged) and timestamps. All other records hang off it. Read-only once its PR is closed or merged.
- **PR snapshot**: a fixed record of the PR at one head commit: its commits, changed files, base commit when known, where its diff came from, and a fingerprint of the diff. Comparing two snapshots shows what changed between rounds.
- **Changed file**: one file in a snapshot, with its status, lines added and removed, and language. Whether a file is generated is decided by the FR-3 risk feature.
- **Evidence**: a fact from a source (issue in this feature; coverage, specification, SonarQube, lint or other in later features). Holds its kind, source, capture time, the commit it applies to, and status current, stale or missing. The PR and repository rows of the completeness list are derived from the session and its latest snapshot, not stored as Evidence.
- **Issue**: an issue the PR references, with its platform, key, title and plain-text description, read from the issue tracker. Never edited here.
- **Summary**: the PR summary, per-file summaries and impact statements for one snapshot, made of labelled claims with references. Generated automatically when the snapshot is taken; regenerating keeps the earlier ones.
- **Conversation and message**: questions and answers within a session, each with the snapshot it was asked against, its scope, category, "Answer for" choice, the question it follows (for a follow-up), provider, context version, labelled claims with their references, unsupported assumptions, suggested follow-ups, and its state (queued, in progress, completed, cancelled or failed).

### Definitions

These terms are defined canonically in [`CONTEXT.md`](../../docs/domain_knowledge/CONTEXT.md); the consequences for this feature are stated here.

- **Resolvable reference**: a file path that exists in the snapshot's head commit (or in its base commit, for a removed line) with every cited line inside that file, or an issue key fetched for this session. Only resolvable references keep a claim labelled Evidence (FR-018). A reference to the PR description supports documented intent (FR-017) but does not by itself keep a claim labelled Evidence.
- **Context version**: the snapshot's head commit plus a fingerprint of the context sent to the provider. It is stored and shown with every answer and summary (FR-020).
- **Session close**: an explicit user action or server shutdown. The session record is kept; only the isolated workspace is removed (FR-042).

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Exit criteria (pass or fail, on a test set of PRs covering a UI change, complex business logic, a security-sensitive change, a database migration, generated files, and several related changes)**

- **SC-001**: Across every session start, refresh, question asked, question cancelled, close and start-up sweep in the test set, the reviewer's branch, HEAD, index, working-tree status and stash are identical before and after: zero changes.
- **SC-002**: An open PR is retrieved and analysed on GitHub, and Bitbucket Cloud and Jira Cloud each pass on at least one real PR before Phase 1 exit. Recorded responses are used by the automated tests only and do not count toward this criterion.
- **SC-003**: A named evaluator rates the PR summary accurate, on the scale accurate / not accurate, for at least 5 of the 6 test-set PRs. Ratings are collected outside the workbench, which stores none.
- **SC-004**: 100% of displayed claims labelled Evidence carry at least one reference that opens the cited code or issue.
- **SC-005**: Every test-set PR without an issue reference shows the issue as missing, and every issue that cannot be fetched shows as unresolved with its reason.
- **SC-010**: For every test-set PR whose issue can be reached, the issue's title and description are shown.
- **SC-011**: In a manual audit of 50 displayed Evidence claims across the test set, the references of at least 90% actually support the claim.

**Performance**

- **SC-006**: For a typical PR (up to 50 changed files and 2,000 changed lines), context is assembled and the summary starts appearing within 60 seconds of selecting it.
- **SC-007**: The first part of an answer appears within 10 seconds of asking.

**Value hypotheses (measured against a baseline of existing PRs; to be tested, not assumed)**

- **SC-008**: Time to first understand a PR falls by 30%.
- **SC-009**: A named evaluator rates at least 80% of answers useful, on the scale useful / not useful. Ratings are collected outside the workbench, which stores none.

## Assumptions

- **Scope** is MVP FR-1 and FR-2. Risk classification (FR-3) and core changed-line coverage (FR-5.1, 5.2, 5.4, 5.5) are later Phase 1 features. FR-4, FR-5.3, FR-5.6, FR-6, FR-7 and FR-8 are Phase 2. Everything in MVP section 8.2 stays out of Phase 1.
- **One repository** is configured at a time, and the reviewer has a local clone of it.
- **Jira** means Jira Cloud. Jira Data Center is not supported in Phase 1; it can be added later as another `IssueTracker` adapter.
- **The AI provider** is the Claude Code CLI already installed and signed in on the reviewer's machine. Its exact settings for the FR-022 restrictions are confirmed in the Week 1 spike.
- **A BA** using the workbench needs the same set-up as a developer: a local clone of the repository and the AI provider installed and signed in.
- **A typical PR** for the performance target has up to 50 changed files and 2,000 changed lines. Targets are baselined during the validation checkpoint.
- **Users** are the single person running the workbench on their own machine.
- **Wireframes** W1, W2 and W4 in `MVP/` show intended layout; they are a guide, not pixel requirements. W4's lens switcher, its lens-grouped suggested questions and its "Add as finding" button are Phase 2.
- **Generated-file detection** belongs to the FR-3 risk feature.

## Verbatim Constraints

These strings were pinned by `MVP/MVP.md` and must be used exactly. Where a display label and a stored value differ, both are given.

- Provider contracts: `SourceControlProvider`, `IssueTracker`, `AiProvider`.
- AI provider id: `claude-code-cli`.
- Claim labels: display `Evidence`, `Inference`; stored `evidence`, `inference`.
- Question categories: display `What`, `Why`, `How`, `What-if`, `Risk`, `Requirements`; stored `what`, `why`, `how`, `whatif`, `risk`, `requirement`.
- Question scope types (stored): `pr`, `file`, `range`.
- Evidence kinds (stored): `coverage`, `sonar`, `spec`, `issue`, `lint`, `custom`; evidence status (stored) `current`, `stale`, `missing`.
- Context completeness statuses (stored and displayed): `found`, `missing`, `stale`.
- Issue reference forms: Jira keys, `#123`, `owner/repo#123`.
- Missing Jira access reason (display): `no Jira access configured`.
