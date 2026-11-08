# PR Review Workbench — Phase 2

Nov 7, 2026 · @Lee Sinclair

Phase 2 starts once Phase 1 ([MVP.md](MVP.md)) has passed its validation checkpoint. It holds the MVP requirements moved out of Phase 1 (see [ADR 0001](../docs/domain_knowledge/adr/0001-phase-1-scope.md)) and the work the MVP specification planned for after validation. Requirement IDs are unchanged from `MVP.md`, so references to them stay valid. Principles, roles, architecture, the AI provider contract and repository-safety rules are those of [MVP.md](MVP.md).

## 1. Requirements moved from Phase 1

### FR-4 Requirements and change intent

Phase 1 already fetches each linked issue's title and description (part of FR-4.1). The rest of FR-4 is Phase 2.

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

### FR-5 PR-specific test coverage (remainder)

Phase 1 delivers FR-5.1, 5.2, 5.4 and 5.5.

| ID | Requirement |
| --- | --- |
| FR-5.3 | Should report uncovered new functions where the report supports it, and branch coverage where the tooling supplies it. |
| FR-5.6 | Should show suggested missing test scenarios, labelled as recommendations, not results. |

### FR-6 Static analysis and quality evidence

| ID | Requirement |
| --- | --- |
| FR-6.1 | Must import or manually refresh SonarQube results for the PR/branch. |
| FR-6.2 | Must show new bugs, vulnerabilities, code smells, and complexity and duplication where available. |
| FR-6.3 | Must separate new findings from pre-existing technical debt where the data supports it. |
| FR-6.4 | Must display scan timestamp and the commit it covers, and flag the evidence as **stale** when the PR head has moved. |
| FR-6.5 | Must link each finding to its original in SonarQube. |
| FR-6.6 | Must store evidence in the generic evidence model (MVP section 5) so other harnesses can be added without new UI. |

### FR-7 Review readiness and human decisions

| ID | Requirement |
| --- | --- |
| FR-7.1 | Must consolidate risk, test, requirements and static-analysis findings into one readiness panel. |
| FR-7.2 | Must show one of four states: **Insufficient evidence**, **Review required**, **Ready for human approval**, **Blocked** (rules in section 2). |
| FR-7.3 | Must separate Confirmed issues, Recommendations, Unknowns and Human review obligations. |
| FR-7.4 | Must let reviewers acknowledge, verify, or dismiss each finding; dismissal requires a reason. |
| FR-7.5 | Must keep dispositions across refreshes where the underlying code is unchanged, and reopen them where it changed. |
| FR-7.6 | Must keep an auditable, append-only review history (who, what, when, why). |
| FR-7.7 | Must not approve, decline or merge the PR, and must not show a green "approved" badge. |

FR-7.7's rule that the product never approves, declines or merges applies from Phase 1 (constitution II.1).

### FR-8 Role lenses

| ID | Requirement |
| --- | --- |
| FR-8.1 | Must provide Developer, Technical lead and BA lenses over the same data, switchable in one click. |
| FR-8.2 | Must remember the last lens per user locally; no permissions model. |

## 2. Readiness recommendation

Readiness is derived and cannot be set by a user. States are evaluated top-down; the first match wins.

| Order | State | Condition *\[Assumption: exact thresholds\]* |
| --- | --- | --- |
| 1 | Blocked | Any Critical finding or Critical-class change without a Verify or Dismiss-with-reason disposition |
| 2 | Insufficient evidence | Required evidence missing or stale: no specification/issue link, no coverage for changed code (where a report is expected), or SonarQube evidence stale |
| 3 | Review required | Any Elevated finding, uncovered changed lines, unmapped acceptance criteria or scope deviation without disposition |
| 4 | Ready for human approval | None of the above; remaining items are Low or already dispositioned |

The panel always shows its reasons and the unknowns. The state is labelled a recommendation, uses neutral styling (no green approval badge), and the approve/decline action stays in the source-control platform.

## 3. Data model additions

| Entity | Key fields | Notes |
| --- | --- | --- |
| Requirement | id, source (issue tracker / Spec Kit), text, criterionRef | Read from source; never edited here |
| TraceabilityLink | requirementId, codeRefs\[\], testRefs\[\], state (`inferred` / `verified` / `rejected`), by | AI creates as inferred |
| ReadinessSnapshot | sessionId, snapshotId, state, reasons\[\], computedAt | Recommendation only; derived, never user-set |

Disposition gains the `acknowledge`, `verify` and `dismiss` actions (Phase 1 records `override` only). Review history becomes exportable (JSON or Markdown). *\[Assumption: export format\]*

## 4. Components

| Component | Responsibility | Talks to |
| --- | --- | --- |
| Requirements connector | Specification discovery, related-PR lookup | `project-<code>` repos, issue tracker, source-control provider |
| Evidence service (SonarQube) | Imports SonarQube reports; normalises to the evidence model | SonarQube export/API |

Specification discovery follows the MVP repository-safety rules: fetch `develop` and relevant open branches, then read specification folders from the object store or a temporary worktree.

## 5. Work planned after validation

These items were already scheduled for after the MVP's validation.

- Test quality assessment
- Blast-radius / regression impact
- Consolidated Jira implementation view
- API contract analysis
- GitHub Copilot as a second AI provider (a new `AiProvider` adapter, no changes outside it)

## 6. Exit criteria

| Area | Exit criterion |
| --- | --- |
| Requirements | Associates a PR with its specification context and acceptance criteria |
| SonarQube | Shows manually refreshed analysis evidence |
| Readiness | Surfaces unresolved issues and evidence gaps |
| Human decisions | Records dispositions and verification |

Success measure to test: fewer review cycles caused by misunderstood requirements. Added test-set case: PR that does not match its specification.

## 7. Wireframes

| ID | Screen | Lens | Requirements shown |
| --- | --- | --- | --- |
| [W5](<W5 Requirements traceability.png>) | Requirements traceability | BA | FR-4.1–4.8 |
| [W6](<W6 Test and static-analysis evidence.png>) | Test and static-analysis evidence (static-analysis part) | Technical lead | FR-5.3, FR-5.6, FR-6.1–6.6 |
| [W7](<W7 Review readiness and dispositions.png>) | Review readiness and dispositions | Technical lead | FR-7.1–7.7 |
| [W8](<W8 Review history.png>) | Review history (decisions) | All | FR-7.6 |

## 8. Open questions

- Where do SonarQube results come from for a manual import: a local report file, the local server's API, or both?
- Which GitHub issue field or convention carries acceptance criteria (issue body section, task list, or label), so FR-4.1 works in development?
- Where do specification repositories live: how does `project-<code>` map to a PR or issue, and how is the right specification folder chosen?
- Which items form the traceability rows: the issue's acceptance criteria, the specification's requirements, or both?
