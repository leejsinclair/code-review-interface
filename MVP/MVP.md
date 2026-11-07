# PR Review Workbench — Product & Technical Specification (MVP)

Nov 7, 2026 · @Lee Sinclair

## 1. Purpose, positioning and scope

The PR Review Workbench is a decision-support tool that helps a reviewer understand a Bitbucket Cloud pull request, see where review attention is needed, and judge whether the available evidence supports merging. It assembles evidence around the PR; it does not approve, merge or replace any existing system.

**Source and basis.** This specification formalises the expert-panel evaluation (developer, technical lead, BA) and its agreed MVP. Items marked *\[Assumption\]* are decisions made here to make the spec buildable and should be confirmed.

**The one job.** A developer opens the workbench to understand a PR quickly and know where to concentrate review. Every other capability supports that.

### 1.1 Outputs

1. Understand the change.
2. Identify where review attention is needed.
3. Assess whether the available evidence supports approval.

### 1.2 What the product does not replace

- Bitbucket (source control, PR management), Jira (issue management), Spec Kit (specification lifecycle), SonarQube (static analysis), existing test frameworks, and human review and approval.

### 1.3 Design principles

| Principle | Requirement |
| --- | --- |
| Evidence before opinion | Every material AI finding links to identifiable evidence (file/line, requirement, report). |
| Human accountability | AI recommends; humans decide. The product never approves or merges. |
| Risk-directed review | Attention is concentrated where the consequence of a defect is greatest. |
| Explainability | Every classification states why, and which lines caused it. |
| Incremental integration | Consume existing tools; do not recreate them. |
| Read-only by default | No silent modification of any repository. |
| Separation of concerns | Evidence, AI assessment and human decision are stored and displayed separately. |
| Role-oriented presentation | One underlying dataset, three lenses. |
| Progressive complexity | Single-PR workflow first; cross-PR intelligence later. |

## 2. Users, roles and journeys

There is one workflow with three presentation lenses. Roles are a view filter, not a permission system; no role administration is built in the MVP.

| Role | Primary question | Default view contents |
| --- | --- | --- |
| Developer / reviewer | What changed, and where should I look? | Diff with risk overlay, code explanations, AI interrogation, changed-line coverage, suggested investigations |
| Technical lead | Is this safe and well-evidenced enough to merge? | Risk distribution, critical findings, SonarQube evidence, review readiness |
| Business analyst | Does this deliver what was asked, and nothing more? | Functional change summary, acceptance-criteria traceability, requirement gaps, manual test suggestions |

### 2.1 Primary journey (MVP)

1. **Discover.** Pick an open PR from the configured repository.
2. **Understand.** Read the PR summary and per-file explanations.
3. **Prioritise.** Filter the diff by risk class; see why each item was flagged; skim low-risk items.
4. **Interrogate.** Select code (or the whole PR) and ask what/why/how/what-if/risk/requirement questions.
5. **Assess evidence.** Review requirement traceability, changed-line coverage and SonarQube findings.
6. **Decide.** Review the readiness recommendation, disposition findings, record verification, then approve or reject **in the source-control platform** (Bitbucket Cloud in the target environment).

### 2.2 Secondary journeys

- **Re-review after new commits.** Refresh the PR; only affected findings are re-analysed; prior dispositions persist where the underlying code is unchanged.
- **BA business-language question.** The BA asks, for example, whether a customer can reset a password more than once, and gets an answer linked to code and requirement evidence without needing to read code.
- **Missing evidence.** No coverage report, no issue reference or no specification is shown as an explicit gap, never silently skipped.

## 3. Constraints and architecture

The workbench is a local TypeScript/Node.js application that orchestrates four evidence sources and one AI provider around a persistent review session. It owns context assembly and the review record; it does not own code intelligence.

### 3.1 Fixed constraints

| Area | Constraint |
| --- | --- |
| Team / timeline | 1 technical lead, 2 developers, 1 BA; 6–8 weeks to MVP |
| Stack | TypeScript / Node.js |
| Source control | Bitbucket Cloud in the target environment; GitHub for development and dogfooding. Both behind a `SourceControlProvider` contract; personal authentication per platform |
| Issue tracking | Jira in the target environment; GitHub Issues for development and dogfooding. Both behind an `IssueTracker` contract (read-only) |
| AI | Claude Code CLI (no direct API dependency); GitHub Copilot is a future provider |
| Static analysis | Local SonarQube, manually engaged; evidence imported or refreshed manually |
| Specifications | Spec Kit, associated automatically; may live in `project-<code>` repositories |
| Spec discovery | May require fetching `develop` and searching open branches for the specification folder |
| Repositories | Single repository initially |
| Persistence | Local application storage; database choice subject to existing architecture |
| Safety | Must not interfere with the developer's active branch or uncommitted work |

### 3.2 Logical components

| Component | Responsibility | Talks to |
| --- | --- | --- |
| Source-control provider interface | Provider-neutral contract for PR list, metadata, commits, diff, changed-file metadata; Bitbucket Cloud adapter (target) and GitHub adapter (development) | Bitbucket Cloud REST API, GitHub REST API |
| Repository manager | Isolated read-only checkouts (temporary worktrees); fetch without touching the active branch | Local git |
| Context assembler | Builds the review context: PR, diff, repo, issue references, specification, evidence | All connectors |
| Issue-tracker interface | Provider-neutral, read-only contract for issue-reference extraction and issue lookup; Jira adapter (target) and GitHub Issues adapter (development) | Jira (read), GitHub Issues (read) |
| Requirements connector | Specification discovery, related-PR lookup | `project-<code>` repos, issue tracker, source-control provider |
| Evidence service | Imports coverage (LCOV) and SonarQube reports; normalises to the evidence model | Local files, SonarQube export/API |
| Risk engine | Deterministic rules plus AI-assisted behavioural analysis; produces explainable classifications | Context assembler, AI provider |
| AI provider interface | Provider-neutral contract; Claude Code CLI adapter first | `claude` CLI |
| Review store | Sessions, findings, dispositions, conversations, evidence references | Local storage |
| UI | Single web UI with role lenses | All of the above through one local API |

### 3.3 Architectural rules

- The PR is the central object; all evidence hangs off a **ReviewSession** keyed by repository + PR id.
- Evidence, AI assessment and human decision are separate record types and never merged.
- Issue references, branch names and PR references are stored, each tagged with its provider, in a form that permits later cross-PR aggregation, but no cross-repository graph is built in the MVP.
- All repository access goes through the Repository manager. No component runs git commands in the developer's working tree.
- No component outside an adapter knows which source-control or issue platform is in use; adding a platform must not require changes outside its adapter (the same rule as the AI provider, section 6).
- Bitbucket Cloud and Jira adapters are verified against recorded API fixtures where live access is unavailable; GitHub adapters may be exercised live.

## 4. Functional requirements

Seven capabilities plus role lenses make up the MVP. Each requirement has an ID for traceability to wireframes (section 8.4) and tests. "Must" is mandatory for MVP exit.

### FR-1 PR discovery and context assembly

| ID | Requirement |
| --- | --- |
| FR-1.1 | Must list open PRs for the configured repository and let the user select one. |
| FR-1.2 | Must retrieve title, description, author, source and target branch, commits, full diff and changed-file metadata. |
| FR-1.3 | Must extract issue references (Jira keys, or GitHub issue references such as `#123` and `owner/repo#123`) from branch name, PR title and description, and show which source each reference came from. |
| FR-1.4 | Must resolve the local repository and create an isolated read-only workspace for the PR. |
| FR-1.5 | Must create one ReviewSession per PR; refreshing a PR updates it and never duplicates history. |
| FR-1.6 | Must show a visible "context completeness" list (PR, repo, issue reference, specification, coverage, SonarQube) with found / missing / stale status. |

**Acceptance:** a reviewer can select an open PR and start analysis; source and target branches are correct; commit-to-commit changes are identifiable; the developer's branch and uncommitted files are untouched.

### FR-2 Change understanding and AI interrogation

| ID | Requirement |
| --- | --- |
| FR-2.1 | Must generate an overall PR summary, a per-file summary, and functional and technical impact statements. |
| FR-2.2 | Must allow questions scoped to a selected line range, method, file, or the whole PR. |
| FR-2.3 | Must support question categories: What, Why, How, What-if, Risk, Requirements. |
| FR-2.4 | Must offer contextual suggested questions, varied by role lens. |
| FR-2.5 | Must display source references (file:line, requirement ID) with every answer, navigable to the code or requirement. |
| FR-2.6 | Must label each statement in an answer as **Evidence** (directly supported) or **Inference** (AI reasoning), and distinguish documented intent from inferred intent. |
| FR-2.7 | Must persist all questions and answers with provider, timestamp and the context version used. |
| FR-2.8 | Must run read-only: no file modification, no arbitrary command execution in the default workflow. |
| FR-2.9 | Should allow business-language questions without code knowledge (same interface, same engine). |

**Acceptance:** scoped and PR-wide questions work; answers cite evidence; unsupported assumptions are called out; the default workflow cannot modify code.

### FR-3 Risk-based change analysis

| ID | Requirement |
| --- | --- |
| FR-3.1 | Must classify every changed file as **Low**, **Normal**, **Elevated** or **Critical**, with a reason. |
| FR-3.2 | Must identify behaviourally significant changed lines and sections, and record which lines drove each classification. |
| FR-3.3 | Must apply deterministic mandatory-scrutiny rules (section 7.1) before AI assessment; AI may raise but never lower a rule-triggered class. |
| FR-3.4 | Must identify low-risk mechanical changes (formatting, comments, generated files, lockfiles) as candidates for reduced review, not as approved. |
| FR-3.5 | Must let the user filter and sort the diff by risk class. |
| FR-3.6 | Must let reviewers override a classification with a recorded reason; a Critical classification cannot be downgraded without a reason and a named reviewer. |
| FR-3.7 | Must recalculate classifications when the PR changes. |
| FR-3.8 | Must analyse direct references and obvious relationships only; it must not claim full blast-radius analysis. |

**Acceptance:** every flag has an explanation; Low items remain viewable; nothing is auto-approved.

### FR-4 Requirements and change intent

| ID | Requirement |
| --- | --- |
| FR-4.1 | Must associate the PR with an issue (from FR-1.3) and display its key, summary and acceptance criteria. |
| FR-4.2 | Must discover the Spec Kit specification automatically, including in `project-<code>` repositories, by searching `develop` and applicable open branches. |
| FR-4.3 | Must display the relevant functional and technical specification content. |
| FR-4.4 | Must produce a traceability table: each acceptance criterion with an assessment (Implementation identified / Implementation and test identified / Requires verification / Not found). |
| FR-4.5 | Must flag apparent scope deviations: implemented but not requested, and requested but not implemented. |
| FR-4.6 | Must list assumptions and ambiguities found. |
| FR-4.7 | Must label AI-generated mappings **Inferred** until a reviewer marks them **Verified**. |
| FR-4.8 | Should show other PRs referencing the same issue with their status (basic related-PR discovery); must not imply the issue is complete because one PR merged. |

### FR-5 PR-specific test coverage

| ID | Requirement |
| --- | --- |
| FR-5.1 | Must import or locate existing coverage reports (LCOV first). |
| FR-5.2 | Must compute changed-executable-line coverage and list uncovered changed lines. |
| FR-5.3 | Should report uncovered new functions where the report supports it, and branch coverage where the tooling supplies it. |
| FR-5.4 | Must link uncovered lines to the diff view. |
| FR-5.5 | Must show "no coverage evidence" explicitly, with report timestamp and commit when available, and never invent a percentage. |
| FR-5.6 | Should show suggested missing test scenarios, labelled as recommendations, not results. |

**Out of scope for FR-5:** running tests, a new test runner, mutation testing.

### FR-6 Static analysis and quality evidence

| ID | Requirement |
| --- | --- |
| FR-6.1 | Must import or manually refresh SonarQube results for the PR/branch. |
| FR-6.2 | Must show new bugs, vulnerabilities, code smells, and complexity and duplication where available. |
| FR-6.3 | Must separate new findings from pre-existing technical debt where the data supports it. |
| FR-6.4 | Must display scan timestamp and the commit it covers, and flag the evidence as **stale** when the PR head has moved. |
| FR-6.5 | Must link each finding to its original in SonarQube. |
| FR-6.6 | Must store evidence in the generic evidence model (section 5) so other harnesses can be added without new UI. |

### FR-7 Review readiness and human decisions

| ID | Requirement |
| --- | --- |
| FR-7.1 | Must consolidate risk, test, requirements and static-analysis findings into one readiness panel. |
| FR-7.2 | Must show one of four states: **Insufficient evidence**, **Review required**, **Ready for human approval**, **Blocked** (rules in section 7.2). |
| FR-7.3 | Must separate Confirmed issues, Recommendations, Unknowns and Human review obligations. |
| FR-7.4 | Must let reviewers acknowledge, verify, or dismiss each finding; dismissal requires a reason. |
| FR-7.5 | Must keep dispositions across refreshes where the underlying code is unchanged, and reopen them where it changed. |
| FR-7.6 | Must keep an auditable, append-only review history (who, what, when, why). |
| FR-7.7 | Must not approve, decline or merge the PR, and must not show a green "approved" badge. |

### FR-8 Role lenses

| ID | Requirement |
| --- | --- |
| FR-8.1 | Must provide Developer, Technical lead and BA lenses over the same data, switchable in one click. |
| FR-8.2 | Must remember the last lens per user locally; no permissions model. |

## 5. Data model

Three record families are kept strictly apart: **Evidence** (facts from tools), **Assessment** (AI or rules output) and **Disposition** (human decisions). Every Assessment cites Evidence; every Disposition cites a Finding. *\[Assumption\]* Entity and field names below are indicative; storage technology follows the existing architecture.

| Entity | Key fields | Notes |
| --- | --- | --- |
| ReviewSession | id, scmProvider, repo, prId, issueRefs\[\] (provider + key), sourceBranch, targetBranch, headCommit, createdAt, lastRefreshedAt | One per repo + PR; refresh updates, never duplicates |
| PrSnapshot | sessionId, headCommit, diffHash, files\[\], commits\[\] | Immutable per head commit; enables commit-to-commit comparison |
| ChangedFile | path, status, additions, deletions, isGenerated, language | Part of a snapshot |
| Evidence | id, sessionId, kind (`coverage` / `sonar` / `spec` / `issue` / `lint` / `custom`), source, capturedAt, commit, payloadRef, status (`current` / `stale` / `missing`) | Generic model so new harnesses need no UI change |
| Requirement | id, source (issue tracker / Spec Kit), text, criterionRef | Read from source; never edited here |
| Finding | id, sessionId, category (`risk` / `requirement` / `coverage` / `static` / `scope`), severity, title, explanation, origin (`rule` / `ai` / `tool`), confidence, evidenceRefs\[\], codeRefs\[\] | Origin and evidence are mandatory |
| RiskClassification | targetType (file / range), targetRef, class, reasons\[\], ruleIds\[\], overriddenBy | Recomputed on each snapshot |
| Conversation / Message | id, sessionId, scope (PR / file / range), provider, contextVersion, role, text, claims\[\] | Claim = {text, type: evidence / inference, refs\[\]} |
| TraceabilityLink | requirementId, codeRefs\[\], testRefs\[\], state (`inferred` / `verified` / `rejected`), by | AI creates as inferred |
| Disposition | id, findingId, action (`acknowledge` / `verify` / `dismiss` / `override`), reason, actor, at, codeHashAtTime | Append-only; reopened when `codeHashAtTime` no longer matches |
| ReadinessSnapshot | sessionId, snapshotId, state, reasons\[\], computedAt | Recommendation only; derived, never user-set |

### 5.1 Data rules

- Disposition and review history are append-only; corrections are new records.
- Each Finding and Message stores the provider and context version, so results are reproducible and auditable.
- Evidence carries the commit it applies to; evidence for an older commit is marked stale, never deleted.
- No developer-level metrics are derived or stored (no scoring of individuals, review duration or defect counts per person).

## 6. AI provider interface and repository safety

The workbench controls context and stores results; the provider only reasons over what it is given. Claude Code CLI is the first adapter, and GitHub Copilot is a later one that must not require changes outside the adapter.

### 6.1 Provider contract *\[Assumption: shape\]*

```typescript
interface AiProvider {
  id: string;                       // "claude-code-cli"
  ask(req: AskRequest): AsyncIterable<AskEvent>;   // streamed
  cancel(requestId: string): Promise<void>;
  capabilities(): { readOnlyEnforced: boolean; streaming: boolean };
}

interface AskRequest {
  requestId: string;
  workspacePath: string;            // isolated read-only worktree, never the user's tree
  scope: { type: 'pr' | 'file' | 'range'; path?: string; startLine?: number; endLine?: number };
  category: 'what' | 'why' | 'how' | 'whatif' | 'risk' | 'requirement';
  question: string;
  context: ContextBundle;           // diff, PR text, requirements, evidence summaries
  history: Message[];
}

interface AskResult {
  claims: { text: string; type: 'evidence' | 'inference'; refs: CodeOrRequirementRef[] }[];
  unsupportedAssumptions: string[];
  suggestedFollowUps: string[];
}
```

### 6.2 Interrogation rules

- The answer must be returned in the structured claims form above; free text that cannot be parsed is shown as a single **Inference** with a warning.
- A claim typed **Evidence** without at least one resolvable reference is downgraded to **Inference** by the workbench.
- The Claude CLI adapter runs with read-only tool permissions in the isolated workspace, with no write or shell-execution tools enabled by default. *\[Assumption\]* The exact CLI flags are confirmed in a Week 1 spike.
- One question runs against one provider; two providers are never run on the same question.
- Prompts, context version, provider id and timestamp are persisted with every answer.

### 6.3 Repository safety

| Rule | Mechanism |
| --- | --- |
| Never switch the active branch | All inspection uses `git worktree` in an application-owned directory |
| Never touch uncommitted files | The user's working tree is never a target of any command |
| Fetching is non-destructive | Fetch into remote-tracking refs only; no pull, merge, rebase or checkout in the user's tree |
| Specification discovery | Fetch `develop` and relevant open branches, then read specification folders from the object store or a temporary worktree |
| Cleanup | Worktrees are removed on session close and by a startup sweep of orphans |
| Visibility | If a repo or spec cannot be resolved, show a missing-context notice; do not substitute assumptions |

## 7. Risk rules, readiness logic and quality attributes

### 7.1 Risk classification

Classification is hybrid: deterministic rules set a floor, AI assessment may raise a class, and a reviewer may override with a reason. There is no composite numeric score.

| Class | Treatment | Typical triggers |
| --- | --- | --- |
| Low | Reduced review priority; still viewable | Comment-only or whitespace changes, generated files, lockfiles, mechanical renames |
| Normal | Standard review | Ordinary logic and UI changes with no sensitive trigger |
| Elevated | Detailed review | Behavioural change in shared code, error handling, configuration, public interface change |
| Critical | Mandatory human verification | Authentication, authorisation, data deletion, financial calculation, schema migration |

**Mandatory-scrutiny rules** *\[Assumption: initial rule set, configurable file\]*:

- Path or symbol matches for authentication, authorisation/permissions, data deletion and financial calculations set a floor of **Elevated**; a behavioural (non-comment, non-whitespace) change in those areas sets **Critical**.
- Database migration files set **Critical**.
- Comment-only or whitespace-only changes in a sensitive file do not trigger the rule; they stay Low and the reason is shown.
- Generated files and lockfiles are Low *candidates*, flagged "mechanical", with a link to open the diff.
- Every classification stores: class, reasons, rule IDs, and the changed lines responsible.

### 7.2 Readiness recommendation

Readiness is derived and cannot be set by a user. States are evaluated top-down; the first match wins.

| Order | State | Condition *\[Assumption: exact thresholds\]* |
| --- | --- | --- |
| 1 | Blocked | Any Critical finding or Critical-class change without a Verify or Dismiss-with-reason disposition |
| 2 | Insufficient evidence | Required evidence missing or stale: no specification/issue link, no coverage for changed code (where a report is expected), or SonarQube evidence stale |
| 3 | Review required | Any Elevated finding, uncovered changed lines, unmapped acceptance criteria or scope deviation without disposition |
| 4 | Ready for human approval | None of the above; remaining items are Low or already dispositioned |

The panel always shows its reasons and the unknowns. The state is labelled a recommendation, uses neutral styling (no green approval badge), and the approve/decline action stays in the source-control platform.

### 7.3 Non-functional requirements

| Attribute | Requirement |
| --- | --- |
| Safety | Zero modifications to the user's working tree, branch or uncommitted files (exit criterion). |
| Trust | Every Finding has an origin and evidence references; no unreferenced claim is displayed as fact. |
| Auditability | Review history is append-only and exportable (JSON or Markdown). *\[Assumption: export format\]* |
| Performance | PR context assembled and summary started within 60 s for a typical PR; interrogation answers stream. *\[Assumption: targets to be baselined\]* |
| Resilience | Any missing source degrades to a visible gap; one failed connector does not block the rest. |
| Security | Source-control and issue-tracker credentials stored in the OS keychain or equivalent; code and context are sent only to the configured provider. *\[Assumption\]* |
| Privacy of people | No per-developer scoring, ranking or review-duration metrics. |
| Extensibility | New AI provider = new adapter; new evidence tool = new importer; neither requires UI change. |
| Maintainability | Reuse existing tools; no custom code-intelligence, test-execution or dependency-graph engine. |

## 8. Delivery, validation and wireframes

### 8.1 Phasing

| Phase | Scope |
| --- | --- |
| 1 — MVP (6–8 weeks) | FR-1 to FR-8 as specified above |
| 2 — After validation | Test quality assessment, blast-radius / regression impact, consolidated Jira implementation view, API contract analysis, Copilot as a second provider |
| 3 — Backlog | Cross-PR semantic analysis, historical defect intelligence, mutation testing, deployment and migration analysis, architectural conformance, review analytics, engineering knowledge graph |

**Delivery sequence** *(planning allocation, not an estimate)*: Week 1 discovery, context assembly, data model · Week 2 diff presentation and PR summary · Weeks 3–4 interrogation and risk analysis · Week 5 Jira/specification traceability · Week 6 coverage and SonarQube evidence · Week 7 readiness, dispositions, role lenses · Week 8 integration testing, UX refinement, hardening.

**Validation checkpoint (end of Week 3 or 4):** review five real PRs with the existing process and with the workbench; compare time to understand, issues found, time on low-risk files, questions that needed the author, requirement and test gaps, and reviewer confidence. If scope must shrink, protect interrogation and the evidence foundation first.

### 8.2 Explicitly out of scope for the MVP

Cross-PR semantic analysis; cross-repository dependency graph; full blast-radius analysis; Copilot integration; automated test execution; mutation testing; autonomous code fixes; automatic PR approval or merge; historical defect intelligence; deployment orchestration; advanced review analytics; **developer performance scoring**; a custom specification editor; Jira project management; an architectural conformance engine.

### 8.3 Success measures and exit criteria

Baseline a sample of existing PRs before judging the MVP. These are hypotheses to test, not established expectations: cut initial comprehension time by 30%; cut time on low-risk changes by 40%; at least 80% of AI findings rated useful; changed-line coverage shown for at least 80% of PRs where reports exist; fewer review cycles caused by misunderstood requirements.

The MVP is complete only when, using real PRs, it demonstrates:

| Area | Exit criterion |
| --- | --- |
| Source control | Reliably retrieves and analyses an open PR on Bitbucket Cloud; the GitHub adapter does the same for development |
| Understanding | Produces an accurate PR summary |
| Interrogation | Answers contextual questions with source evidence |
| Risk | Identifies meaningful high-risk changes; correctly marks common mechanical changes Low |
| Requirements | Associates a PR with its issue (Jira in the target environment) and specification context |
| Coverage | Shows measured changed-line coverage when a report exists |
| SonarQube | Shows manually refreshed analysis evidence |
| Readiness | Surfaces unresolved issues and evidence gaps |
| Human decisions | Records dispositions and verification |
| Repository safety | Never alters the developer's working state |

Test set: UI change; complex business logic; security-sensitive change; database migration; PR with generated files; PR with poor coverage; PR that does not match its specification; PR with several related changes.

### 8.4 Wireframe index

The wireframes are in the companion design artifact *PR Review Workbench — Wireframes*.

| ID | Screen | Lens | Requirements shown |
| --- | --- | --- | --- |
| W1 | PR list and session start | All | FR-1.1, FR-1.5 |
| W2 | Review overview and context completeness | All | FR-1.2–1.6, FR-2.1, FR-3.1, FR-3.5, FR-4.8, FR-8 |
| W3 | Diff with risk overlay | Developer | FR-3.1–3.7, FR-5.4 |
| W4 | AI interrogation panel | Developer, BA | FR-2.2–2.9 |
| W5 | Requirements traceability | BA | FR-4.1–4.8 |
| W6 | Test and static-analysis evidence | Technical lead | FR-5.1–5.6, FR-6.1–6.6 |
| W7 | Review readiness and dispositions | Technical lead | FR-7.1–7.7 |
| W8 | Review history | All | FR-7.6, FR-2.7 |

### 8.5 Open questions

- Which Jira access path is allowed (personal API token, MCP, or Jira keys only)? FR-4.1 acceptance-criteria display depends on it.
- Where do SonarQube results come from for a manual import: a local report file, the local server's API, or both?
- Which coverage report formats exist across target repositories beyond LCOV?
- What is the exact read-only permission configuration of the Claude Code CLI in the target environment (Week 1 spike)?
- Should the initial mandatory-scrutiny rule set be seeded from existing engineering standards?
- Which GitHub issue field or convention carries acceptance criteria (issue body section, task list, or label), so FR-4.1 works in development?
- Is the existing application foundation (local repository management, Bitbucket auth) already in place? If not, the panel advised reducing scope rather than weakening interrogation.