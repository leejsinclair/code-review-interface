# Feature Specification: Risk-Based Review Focus

**Feature Branch**: `004-risk-review-focus`

**Created**: 2026-11-10

**Status**: Draft

**Grilled on**: 2026-11-10

**Input**: User description: "Feature 004: Risk-based review focus (MVP FR-3). Classify every changed file Low/Normal/Elevated/Critical with reasons, rule IDs and the changed lines responsible. Deterministic mandatory-scrutiny rules first (configurable rule file: auth, authorisation, data deletion, financial calculation, schema migration; comment/whitespace-only changes stay Low), AI assessment may raise but never lower a rule class. Mechanical files (generated, lockfiles) are candidates for reduced review, never approved. Reviewers can filter/sort files by risk, and override a classification with a recorded reason (Critical needs reason and named reviewer) as an append-only Disposition. Recalculate on every snapshot. UI: fills the Overview 'Review focus' placeholder, risk badges and filter/sort in the file list, highlight the lines that drove a class in the Files diff view, risk-first file order with next/previous following it. No numeric score (MVP 7.1)."

The workbench already shows a pull request's changed files, summarises them and answers questions about them. What it cannot yet say is **where to look first**. Every file is listed in diff order and looks equally important, and the Overview's "Review focus" section reads "Not available yet." This feature gives every changed file a **risk class**, always with the reasons and the changed lines behind it, so a reviewer spends their attention on the files that need it and can see which files are candidates for a lighter look.

It implements MVP requirement FR-3 (ADR 0001 places it in Phase 1). Its design follows the risk rules in `MVP/MVP.md` section 7.1 and is informed by the reviewer's file-ordering and path-sensitivity logic in the team's VS Code extension (ADR 0003). The extension's 0 to 100 score is **not** carried over: MVP 7.1 says there is no composite numeric score.

## Verbatim Constraints

- The four classes are named exactly **Low**, **Normal**, **Elevated** and **Critical**, in that order of increasing scrutiny.
- The Overview section is headed **Review focus**. Its placeholder text "Not available yet." is removed.
- A candidate for reduced review is labelled **Mechanical (candidate for reduced review)**. The word "approved", and any approval styling, MUST NOT appear on any risk surface (constitution II.2, II.3).
- The built-in rules have these stable IDs: `R-AUTH`, `R-AUTHZ`, `R-DELETE`, `R-FINANCE`, `R-MIGRATION`, `R-CONFIG`, `R-LOCKFILE`, `R-GENERATED`, `R-COMMENT-ONLY`, `R-RENAME-ONLY`. AI-raised classes show the origin **AI** instead of a rule ID.

## Clarifications

### Session 2026-11-10

- Q: Is classification per file or also per line range? → A: Per file. The changed lines that drove the class are shown as the explanation, not as separate classes. Range classes are not part of this feature.
- Q: Does an override replace the class everywhere? → A: Yes. The effective class (used for ordering, filtering and the Review focus list) is the override while it applies. The original class, its reasons and the override's reason stay visible beside it.
- Q: Where do the rules live and who edits them? → A: Built-in defaults ship with the workbench. A rule file in the workbench's data directory can add to or tighten them. It is edited outside the app; there is no rule editor in this feature.
- Q: How is the "named reviewer" for lowering a Critical class established? → A: It is the account the reviewer is signed in with on the source-control platform, read from the platform and not typed. If it cannot be read, lowering a Critical class is refused. This makes a read-only "current user" capability a dependency, built here and reused by the workload feature (008).
- Q: What is the default file order in the Files view? → A: Diff order stays the default. Risk order is a one-click sort the reviewer chooses, kept for that browser tab; Next and Previous follow whichever order is chosen.
- Q: Which files does the AI assess? → A: Every changed file except lockfiles and generated files, which are not sent and show that they were not assessed and why. Comment-only and rename-only files are assessed and can be raised, which removes them from the reduced-review candidates.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See where to look first (Priority: P1)

A reviewer opens a pull request's Overview and, in the **Review focus** section, sees the files that need the most attention, Critical first and then Elevated, each with its class, its reasons and a link to the file. Files that are only mechanical changes (generated files, lockfiles, comment-only edits, pure renames) are listed apart, as candidates for a lighter look. The reviewer does not have to open the diff to find the risky files.

**Why this priority**: This is the core of the feature and the reason the placeholder exists. A technical lead's first question is "is there anything here I must not skim?".

**Independent Test**: Open the session for a pull request that changes a migration file, an authentication file, a lockfile and a README. Without opening any file, check that Review focus lists the migration and the authentication file with their classes and reasons, and lists the lockfile as a mechanical candidate.

**Acceptance Scenarios**:

1. **Given** a snapshot whose changed files include a database migration, **When** the Overview loads, **Then** that file is listed under Review focus as **Critical** with the reason and rule ID `R-MIGRATION`.
2. **Given** a snapshot where every changed file is Normal or Low, **When** the Overview loads, **Then** Review focus says no file is Elevated or Critical and still shows the count of each class.
3. **Given** a lockfile or generated file in the snapshot, **When** the Overview loads, **Then** it appears as **Mechanical (candidate for reduced review)** with a link that opens its diff, and it is not described as approved.
4. **Given** a reviewer refreshes the pull request and a new snapshot is created, **When** the new snapshot appears, **Then** every file's class is recalculated for it, and the previous snapshot's classes remain viewable with that snapshot.
5. **Given** classification could not be completed for some files (for example, the file was skipped for size), **When** the Overview loads, **Then** those files are named as **not fully analysed**, with the reason, and are never silently shown as Low.

---

### User Story 2 - Understand why a file has its class (Priority: P1)

For any file, the reviewer can see which rules or AI assessment gave it its class, in plain words, and which changed lines were responsible. In the Files view, those lines are marked in the diff so the reviewer can go straight to them.

**Why this priority**: A class without a cause cannot be judged (constitution IV.1). If reviewers cannot see why a file is Critical, they will either distrust the classification or stop checking.

**Independent Test**: Open the Files view for a file classified Critical by a rule. Check that the class, the rule ID, the reason text and the responsible lines are visible, and that the responsible lines are marked in the diff in a way that does not depend on colour alone.

**Acceptance Scenarios**:

1. **Given** a file classified by two rules, **When** its risk detail is shown, **Then** both rules appear with their IDs and reasons, and the class shown is the higher of the two.
2. **Given** a classified file open in the Files view, **When** the diff is shown, **Then** each line that drove the class carries a visible mark and an accessible name stating the rule ID (or AI) it supports, in light and dark themes.
3. **Given** a rule that matched on a file's path rather than on its changed lines, **When** its detail is shown, **Then** it says it matched on the path and shows no line marks for that rule.
4. **Given** keyboard use only, **When** the reviewer moves through the file's risk marks, **Then** they can reach every marked line and each is announced with its class and reason.

---

### User Story 3 - Filter, sort and step through files by risk (Priority: P2)

The reviewer can show only files of chosen classes, sort the file list from highest to lowest risk, and use Next and Previous to move through the files in that order, so a review can start with the files that matter most.

**Why this priority**: It turns the classification into a working order. It depends on User Story 1 but is useful on its own once classes exist.

**Independent Test**: In a session with files of all four classes, sort by risk and confirm Critical files come first; filter to Critical and Elevated and confirm only those remain; press Next repeatedly and confirm it visits files in the risk order shown.

**Acceptance Scenarios**:

1. **Given** the file list, **When** the reviewer chooses to sort by risk, **Then** files are ordered Critical, Elevated, Normal, Low, and files of equal class keep a stable, predictable order (by path).
2. **Given** the file list, **When** the reviewer filters by one or more classes, **Then** only files of those effective classes are listed and the count shown matches.
3. **Given** risk order is chosen, **When** the reviewer uses Next or Previous in the Files view, **Then** they move to the next or previous file in that order, and at the ends they are told there is no further file, not wrapped around silently.
4. **Given** the reviewer has chosen a filter and order, **When** they leave the session and come back in the same browser tab, **Then** the choice is kept, like other view state.
5. **Given** the file list is filtered by risk and the existing text filter is also used, **When** both are set, **Then** a file must satisfy both, and clearing either restores its part.

---

### User Story 4 - AI can raise a class but never lower it (Priority: P2)

After the rules have set their classes, the AI provider assesses the changed files and may raise a file's class when it sees a risk the rules do not (for example, a change to shared error handling). It must give reasons and cite the lines. It can never lower a class that a rule set. If the AI is unavailable, or its answer cannot be used, the rule classes stand and the reviewer is told the AI assessment is missing.

**Why this priority**: Rules alone miss risky changes in ordinary-looking files. The raise-only rule keeps mandatory scrutiny from depending on a model's judgement (constitution IV.2).

**Independent Test**: With the fake AI provider returning a raise for a Normal file, a lowering for a Critical file, and an uncited raise for another file, confirm the first is raised and marked as AI-assessed, and the other two have no effect on the classes and are reported.

**Acceptance Scenarios**:

1. **Given** a file the rules classed Normal, **When** the AI assesses it as Elevated with reasons and cited lines, **Then** the file's class is Elevated, its origin is shown as AI, and the original rule class is still visible.
2. **Given** a file the rules classed Critical, **When** the AI assesses it as Low, **Then** the class stays Critical, and the lower opinion is not applied.
3. **Given** an AI assessment with no resolvable line reference, **When** it is processed, **Then** it does not change the class and the file shows that an AI opinion was ignored for lack of a reference (constitution I.1).
4. **Given** the AI provider is unavailable or its output cannot be read, **When** the Overview loads, **Then** rule classes are shown, and Review focus states that the AI assessment is missing and why (constitution V.1, V.4).
5. **Given** the AI raises a file that the rules had marked Mechanical because it is comment-only or rename-only, **When** the class is shown, **Then** the file is no longer listed as a candidate for reduced review.
6. **Given** a lockfile or generated file, **When** the AI assessment runs, **Then** the file is not sent, its class stays as the rules set it, and it shows that it was not assessed by AI and why.
7. **Given** an AI assessment is stored, **When** it is shown, **Then** it records the provider and the context version it was made from (constitution III.4).

---

### User Story 5 - Override a class with a recorded reason (Priority: P2)

A reviewer who disagrees with a class (for example, a rule matched a test fixture that only looks sensitive) can override it, giving a reason. The override is kept as a permanent record. Lowering a Critical class (including a later step down from a file the rules or AI calculated as Critical) additionally requires the name of the reviewer making the call. The override applies while the file's change is unchanged; if the change differs in a later snapshot, the override no longer applies, and the reviewer sees why.

**Why this priority**: Rules and AI are fallible and reviewers must be able to correct them, but the correction must be accountable (constitution III.2, III.3).

**Independent Test**: Override a Normal file to Elevated with a reason, then override a Critical file to Normal, confirming the second is refused without a reason and a named reviewer. Refresh the pull request with a change to the first file and confirm the override lapses visibly.

**Acceptance Scenarios**:

1. **Given** a file of any class, **When** the reviewer overrides it with a reason, **Then** the effective class changes, the original class and reasons stay visible, and the override's reason and time are shown.
2. **Given** a Critical file, **When** the reviewer tries to lower it without a reason, **Then** the override is refused and the missing reason is named. **When** they provide a reason, **Then** the form shows the platform account that will be recorded as the named reviewer, and saving stores it.
   - **Given** the platform account cannot be read, **When** the reviewer tries to lower a Critical file, **Then** the override is refused, the reason is shown (for example "Sign in to the platform again"), and no record is made.
3. **Given** a reviewer raises a class (including a Low file to Critical), **When** they save it, **Then** a reason is required, but a named reviewer is not.
4. **Given** an override exists, **When** the reviewer overrides the same file again, **Then** a new record is added and the latest one applies; no earlier record is changed or removed, and the full history can be read.
5. **Given** an override on a file, **When** a new snapshot arrives in which that file's change is identical, **Then** the override still applies; **When** the file's change differs, **Then** the override is shown as lapsed, with its recorded reason, and the recalculated class applies.
6. **Given** a session is deleted by the user, **When** it is deleted, **Then** its overrides go with it, as the only permitted removal (constitution III.2).
7. **Given** an older snapshot is being viewed, **When** the reviewer looks for override controls, **Then** none are offered, in line with the latest-snapshot rule for other actions.

---

### User Story 6 - Adjust the mandatory-scrutiny rules (Priority: P3)

A team can tighten or extend the rules (for example, treat a `billing/` folder as financial) with a rule file, without changing the workbench. If the file is missing, the built-in rules apply. If it is invalid, the built-in rules apply and the reviewer is told the file was ignored and why.

**Why this priority**: Every codebase has its own sensitive areas, but the built-in set is enough to deliver value first.

**Independent Test**: Add a rule file marking a path pattern as financial, refresh a session, and confirm matching files become Elevated or Critical under that rule ID; then corrupt the file and confirm the built-in rules apply with a visible notice.

**Acceptance Scenarios**:

1. **Given** a valid rule file adding a path pattern for an existing rule family, **When** a snapshot is classified, **Then** files matching it are classified by that rule and show its ID.
2. **Given** a rule file that tries to **lower** a built-in rule's class, **When** it is read, **Then** that entry is rejected and the notice names it, because the file may only add to or tighten the rules (constitution IV.2).
3. **Given** a rule file that cannot be read, **When** a snapshot is classified, **Then** the built-in rules apply and Review focus shows which file was ignored and the reason.
4. **Given** the rule file changes, **When** the next snapshot is taken or the reviewer refreshes, **Then** the new rules apply, and each snapshot records which ruleset version classified it.

---

### Edge Cases

- **EC-01 Comment-only or whitespace-only change in a sensitive file**: the file stays Low with rule `R-COMMENT-ONLY`, and the reason says a sensitive rule would have applied (MVP 7.1).
- **EC-02 Language where comments cannot be told from code**: the change counts as behavioural, so the file is not treated as Low. Missing knowledge never lowers a class (constitution V.2).
- **EC-03 Added or deleted files in a sensitive area**: count as behavioural changes. A deleted migration or authentication file is therefore treated as a behavioural change in that area.
- **EC-04 Rename with no content change**: Low with `R-RENAME-ONLY`, as a mechanical candidate. A rename into or out of a sensitive path is Elevated, because the path rule still matches either name.
- **EC-05 Binary files and files skipped for size or line limits**: classified from the path alone, never below Normal, and named as not fully analysed with the reason.
- **EC-06 A lockfile or generated file in a sensitive path**: the sensitive-path rule wins; it is not shown as a mechanical candidate.
- **EC-07 One file matching several rules**: the highest class wins and every matching rule is listed.
- **EC-08 A very large pull request** (hundreds of files): rule classes appear with the file list; the AI assessment arrives later and does not delay it.
- **EC-09 AI assessment still running when the reviewer looks**: rule classes show immediately with a "AI assessment in progress" note; the class may rise when it finishes, and the change is announced to screen readers.
- **EC-10 Snapshot replaced while the AI assessment runs**: the assessment belongs to the snapshot it started on and is shown there as an older-head result, never applied to the new snapshot.
- **EC-11 A file removed from the pull request in a later snapshot**: its overrides stay in the history of the earlier snapshot and are not applied to anything.
- **EC-12 Signed-out or expired platform sign-in**: raising a class, or lowering a non-Critical class, still works; lowering a Critical class is refused until the reviewer signs in again.
- **EC-13 Read-only session (workspace missing or session closed)**: stored classes and overrides can be read; no new AI assessment is run, and the reason is shown.
- **EC-14 No files changed or all files skipped**: Review focus says so, and does not show an empty list as "no risk".

## Requirements *(mandatory)*

### Functional Requirements

**Classification**

- **FR-001**: The system MUST give every changed file in a snapshot exactly one risk class from Low, Normal, Elevated or Critical, together with at least one reason.
- **FR-002**: The system MUST NOT compute, store or show a numeric risk score or a percentage for a file or a pull request.
- **FR-003**: The system MUST apply the built-in mandatory-scrutiny rules before any AI assessment. A change in a path or changed line matching authentication (`R-AUTH`), authorisation or permissions (`R-AUTHZ`), data deletion (`R-DELETE`) or financial calculation (`R-FINANCE`) MUST set a floor of Elevated; a behavioural change in those areas MUST set Critical. "In those areas" means the file's path matches the family; a changed-line term match in a file whose path does not match sets the Elevated floor only.
- **FR-004**: A database migration file (`R-MIGRATION`) MUST be Critical. Configuration and infrastructure files, such as CI definitions, container definitions and infrastructure-as-code (`R-CONFIG`), MUST be at least Elevated.
- **FR-005**: A change that only adds, removes or edits comments or whitespace MUST NOT trigger a sensitive rule. The file MUST stay Low with `R-COMMENT-ONLY`, and the reason MUST say which rule was not applied.
- **FR-006**: A change that is behavioural in a language whose comments the system cannot recognise MUST be treated as behavioural. The system MUST NOT infer "comment-only" from missing knowledge.
- **FR-007**: Lockfiles (`R-LOCKFILE`), generated files (`R-GENERATED`), comment-only or whitespace-only changes (`R-COMMENT-ONLY`) and pure renames (`R-RENAME-ONLY`) MUST be Low and labelled **Mechanical (candidate for reduced review)**, unless a higher rule or the AI also applies.
- **FR-008**: Binary files and files skipped for size or line limits MUST be classified from their path alone, MUST NOT be classified below Normal, and MUST be marked not fully analysed with the reason.
- **FR-009**: When several rules match a file, the system MUST use the highest class and list every matching rule with its ID.
- **FR-010**: Every classification MUST record its class, its reasons, the IDs of the rules (or the AI origin) that caused it, and the changed lines responsible. A rule matched on the path alone MUST say so and record no lines.
- **FR-011**: The system MUST classify every snapshot as soon as its files are known, MUST recalculate the classes for every new snapshot, and MUST keep each snapshot's classes with that snapshot.
- **FR-012**: The system MUST analyse the changed files themselves and directly obvious relationships (path and changed-line content) only. It MUST NOT claim a full analysis of everything the change could affect.

**AI assessment**

- **FR-013**: After the rules have run, the system MUST ask the configured AI provider to assess the changed files, using the same isolated workspace and restrictions as other AI work, and MUST NOT delay showing the rule classes while it runs. Lockfiles (`R-LOCKFILE`) and generated files (`R-GENERATED`) MUST NOT be sent for assessment; they MUST show "Not assessed by AI: lockfile" or "Not assessed by AI: generated file", which is a stated exclusion, not a gap. Every other changed file, including comment-only and rename-only files, MUST be assessed, subject to the existing size and prompt limits. A file excluded by those limits is not sent and is shown as not assessed by AI with the limit as the reason; its class stays as classified from the path under FR-008.
- **FR-014**: An AI assessment MAY raise a file's class. It MUST NOT lower any class, whether set by a rule or by an earlier AI assessment.
- **FR-015**: An AI assessment MUST give reasons and at least one resolvable reference to a changed line. An assessment without one MUST NOT change the class and MUST be shown as ignored, with the reason.
- **FR-016**: The system MUST record, with every AI assessment, the provider, the context version and the time.
- **FR-017**: When the AI provider is unavailable, or its output cannot be read, the system MUST show the rule classes and state that the AI assessment is missing and why.
- **FR-018**: A comment-only or rename-only file raised by the AI MUST no longer be listed as a candidate for reduced review. A lockfile or generated file cannot be raised by the AI, because it is not assessed (FR-013); only a reviewer's override can change its class.

**Overrides**

- **FR-019**: A reviewer MUST be able to override a file's class with a reason. The reason MUST NOT be empty.
- **FR-020**: Lowering a file below Critical MUST additionally require a named reviewer whenever the file's calculated class (the rule or AI class, before any override) is Critical, whatever its current effective class is. A second override that takes such a file from Elevated to Low therefore needs the name too. The name MUST be the account the reviewer is signed in with on the source-control platform, read from the platform (read-only), shown in the form before saving and stored with the record. The reviewer MUST NOT be able to type or change it. If the account cannot be read (not signed in, expired sign-in, platform unreachable), lowering a Critical class MUST be refused, with the reason and the way to fix it; other overrides remain possible. An override that does not take a Critical-calculated file below Critical MUST NOT require a name, and MUST NOT call the platform.
- **FR-021**: Each override MUST be stored as an append-only record. The system MUST NOT offer any way to change or delete one. A correction MUST be a new record, and the latest record MUST apply.
- **FR-022**: The effective class MUST be the override while it applies. The original class, its reasons and the override's reason, time and reviewer MUST remain visible next to it.
- **FR-023**: An override MUST keep applying to a later snapshot in which the file's change is identical. If the file's change differs, the override MUST be shown as lapsed, with its recorded reason, and the recalculated class MUST apply.
- **FR-024**: Overrides MUST be offered only for the latest snapshot of a session, and only when the session can be acted on.
- **FR-025**: The system MUST NOT total, rank or compare overrides or reviewer names by person (constitution VII). Reviewer names exist for the audit of the record only.

**Presentation**

- **FR-026**: The Overview's **Review focus** section MUST list Critical files, then Elevated files, each with its class, reasons and a link to the file in the Files view. It MUST list mechanical candidates and not-fully-analysed files separately, and show a count for each class.
- **FR-027**: The Review focus section MUST show, when relevant: that the AI assessment is in progress, missing or partly ignored; that the rule file was ignored; and that overrides are in effect.
- **FR-028**: The file list MUST show each file's effective class as a badge whose meaning does not depend on colour, and MUST let the reviewer see its reasons without leaving the page.
- **FR-029**: The file list MUST let the reviewer filter by one or more classes and sort by risk. The default order MUST remain diff order. Risk order MUST be Critical, Elevated, Normal, Low, and ties MUST be ordered by path.
- **FR-030**: In the Files view, Next and Previous MUST follow the order the reviewer has chosen, MUST NOT wrap around silently at either end, and MUST work from the keyboard.
- **FR-031**: In the Files view, every changed line that drove the file's class MUST be marked in the diff with a visible mark and an accessible name giving the rule ID or AI origin. These marks MUST work alongside the existing selection and range highlighting.
- **FR-032**: The chosen class filter and sort order MUST be kept for the same browser tab, in the same way as other view state, and MUST NOT be sent to the server.
- **FR-033**: New states MUST follow the workbench's existing patterns for loading, empty, failed and stale content, and changes to a file's class while the page is open MUST be announced to screen readers.
- **FR-034**: Text from the pull request, files, rules and AI MUST be shown as text only, never as markup.

**Rules**

- **FR-035**: The built-in rules MUST ship with the workbench with the stable IDs given in Verbatim Constraints. An optional rule file in the workbench's data directory MAY add rules or tighten them, and MUST NOT lower a built-in class.
- **FR-036**: When the rule file is missing, the built-in rules MUST apply. When it is invalid in whole or in part, the built-in rules MUST apply for the invalid part, and the system MUST show which entry was ignored and why.
- **FR-037**: Each snapshot MUST record the version of the ruleset that classified it.

**Records and boundaries**

- **FR-038**: Rule results, AI assessments and overrides MUST be stored as separate kinds of record, and shown as distinct in the UI (constitution III.1). An AI assessment MUST reference the lines it rests on.
- **FR-039**: The system MUST NOT write anything to any platform as part of this feature, and MUST NOT change the reviewer's working copy.
- **FR-040**: The system MUST NOT derive, store or show any per-person metric, including overrides per reviewer.

### Key Entities *(include if feature involves data)*

- **Risk classification**: The class of one changed file in one snapshot, with its reasons, the matching rule IDs or AI origin, the responsible lines, whether it is mechanical or not fully analysed, and the ruleset version used. It is recalculated for each snapshot.
- **Mandatory-scrutiny rule**: A fixed rule with a stable ID, a family (authentication, authorisation, data deletion, financial, migration, configuration, mechanical), the class it sets, and how it matches (path, changed-line content, or both).
- **Ruleset**: The built-in rules plus any valid additions from the rule file, with a version, so a classification can be reproduced.
- **Responsible line**: A changed line, on the new or old side, that caused a classification, tied to the rule or assessment it supports.
- **AI assessment**: An AI opinion on a file's risk with reasons, cited lines, provider, context version and time. It can raise a class and never lower one.
- **Class override**: A reviewer's record that a file's class should be a given class, with a reason, the time, the platform account name where required (when taking a Critical-calculated file below Critical), the file's change as it was at the time, the class it replaced, and the file's calculated class at the time. Append-only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a reference set of pull requests with known sensitive files, a reviewer can name every Critical and Elevated file from the Overview alone, without opening the file list or any diff, in 100% of cases.
- **SC-002**: Every classified file shows at least one reason and either a rule ID or the AI origin, and every line-based reason shows the lines responsible: 100% of files in the reference set.
- **SC-003**: Classification by rules is repeatable: classifying the same snapshot twice gives the same classes, reasons and lines in 100% of reference cases.
- **SC-004**: Across every test case, no AI assessment ever lowers a class, and no AI assessment without a resolvable reference changes a class: zero exceptions.
- **SC-005**: No comment-only or whitespace-only change in a sensitive file is classed above Low, and no behavioural change in a sensitive area is classed below Elevated, in 100% of the reference cases.
- **SC-006**: Rule classes appear no later than the file list itself for a pull request of 500 changed files; AI assessment never delays them.
- **SC-007**: Every override in the test set is recorded with a reason, every lowering of a Critical class is also recorded with a named reviewer, and no record can be changed or removed except by deleting its whole session.
- **SC-008**: Every new screen state (Review focus, file badges, filters, risk marks in the diff) conveys its meaning without relying on colour and passes the same automated accessibility checks as existing screens, with no violations, at wide, medium and narrow widths.
- **SC-009**: No screen, record or export of this feature totals, ranks or compares anything by person.
- **SC-010**: Reviewers can go from the Overview to the first Critical file's responsible lines in the diff in no more than two actions.

## Assumptions

- Classification is per file. Per-range classes (MVP FR-3.1 mentions files and ranges) are not part of this feature; the responsible lines serve as the range-level explanation.
- The initial rule set follows MVP section 7.1. Path patterns and changed-line patterns for the families are product defaults to be tuned against real pull requests; this feature does not claim they are complete.
- "Behavioural change" means a changed line that is not blank, whitespace-only or a comment-only line in a language the system recognises. Added and deleted files count as behavioural.
- "Public interface change" and "shared code" cannot be detected without code intelligence the product does not build (constitution VI.1), so they are left to the AI assessment, which may raise a class for them.
- The AI assessment runs automatically for each new snapshot when the provider is available, on the same work queue discipline as summaries. A manual re-run is not required in this feature.
- **Dependency**: the workbench cannot yet read who the reviewer is on the platform. This feature needs a read-only "current user" capability from every source-control platform it supports, with its own contract tests. The reviewer-workload feature (008) needs the same capability, so it is built once, here, and 008 reuses it. The reviewer's account name is used for audit of the override only (constitution VII.2).
- Overrides carry over to a later snapshot by comparing the file's change, not its position or commit; the comparison method is a planning decision.
- The rule file is plain data edited outside the app, in the workbench's data directory. A rule editor is out of scope.
- Readiness (the derived "ready for human approval" state) and risk-based sorting of the pull request list on Home are out of scope. This feature neither sets nor implies readiness (constitution II.2).
- Constitution 2.0.0 applies throughout; the plan will check each principle and record the result.
