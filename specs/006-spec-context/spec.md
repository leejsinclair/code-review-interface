# Feature Specification: Specification Context and TDD Alignment

**Feature Branch**: `006-spec-context`

**Created**: 2026-11-10

**Status**: Draft

**Grilled on**: 2026-11-10

**Input**: User description: "Changed files on the overview page doesn't provide any real value. Find and show the documents from the specification the pull request relates to: for hd-job, the pull request `feature/ENG-1213-Data-Request` relates to a branch in project-hd-v3 based on the Jira code ENG-1213. project-hd-v3 includes `apps/hd-job` as a sub-folder, so we know the two are related. project-hd-v3 has a `specs` folder, and on `develop` or an open branch there will be specs for that Jira code if it was built with Spec Kit: a file ending in `spec.md` and one called `tdd-evidence.md`. Both are very important. The reviewer needs the context of both summarised. The TDD evidence needs to align with the acceptance criteria in the spec. Was there sufficient testing? Did it test the right things? Does the code reflect the spec?"

This is roadmap feature 007 in ADR 0003 (MVP Phase 2, FR-4.1 to FR-4.5). It takes the next free folder number, 006.

## Clarifications

### Session 2026-11-10

- Q: When does the spec-alignment assessment run? → A: Automatically on each snapshot, once the documents are found, as summaries and risk already do.
- Q: Which folder does the assessment use when several match the key? → A: A matching branch beats `develop`; remaining ties go to the folder with the most recent commit. The panel states the rule used.
- Q: What if the specification and `tdd-evidence.md` exist in different places? → A: Read each document from the best place it exists, applying the same branch-over-`develop` rule per document, and show each one's own source.
- Q: What makes the documents stale? → A: Their commits are re-checked on each refresh; when either document's commit has moved, the documents and the assessment are marked stale and a new assessment runs on the new text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the specification and the test evidence for the pull request (Priority: P1)

A reviewer opens the overview of a pull request whose branch carries a Jira key, such as `feature/ENG-1213-Data-Request` in hd-job. The overview finds the specification folder for that key, which lives in the enclosing project repository (project-hd-v3), and shows a short summary of the specification and a short summary of the TDD evidence, with where each was read from. The reviewer gets the intent and the proof of testing without leaving the tool or hunting through another repository.

**Why this priority**: This is the core value. Without the documents in front of the reviewer, no judgement about testing or fit is possible, and it replaces a section that has no value.

**Independent Test**: Open a pull request whose key matches a specification folder in the enclosing project's `develop` branch. The overview shows the two summaries and the source, and no "Changed files" section.

**Acceptance Scenarios**:

1. **Given** a pull request in a repository that sits inside a project repository, and that project has a specification folder whose name contains the pull request's Jira key, **When** the reviewer opens the overview, **Then** a Specification panel shows a summary of the specification, a summary of the TDD evidence, and the repository, branch and commit each was read from.
2. **Given** the folder exists only on an open branch whose name contains the key, **When** the reviewer opens the overview, **Then** the documents are read from that branch and the panel says so.
3. **Given** the folder exists on both `develop` and a matching branch, **When** the overview opens, **Then** the matching branch's documents are shown and the panel says `develop` also has a copy.
4. **Given** the overview is open, **Then** it has no "Changed files" section; the Diff screen remains the place for the file list.
5. **Given** the reviewer wants the original wording, **When** they open a document from the panel, **Then** its full text is shown as it was read, read-only.

---

### User Story 2 - Judge whether there was enough testing, of the right things (Priority: P1)

The reviewer sees each acceptance criterion from the specification as a row. Each row says what the TDD evidence shows for it (a test is shown, or no test is shown) and whether the code appears to implement it. Above the rows a verdict says whether the testing looks sufficient, and lists the criteria that have no evidence and the tests that do not appear to exercise the behaviour the criterion asks for.

**Why this priority**: "Was there sufficient testing, and did it test the right things" is the reviewer's central question. The summaries give context; this table gives the answer.

**Independent Test**: Use a specification with five criteria where the TDD evidence covers four and one test does not exercise its criterion. The table has five rows, the uncovered one is flagged, the mismatched test is flagged, and the verdict says testing is incomplete.

**Acceptance Scenarios**:

1. **Given** both documents were found, **When** the assessment completes, **Then** there is one row per acceptance criterion with its identifier or wording, an implementation state (Implementation and test identified, Implementation identified, Requires verification, or Not found), and whether the TDD evidence shows a test for it.
2. **Given** a criterion has no matching test in the evidence, **Then** its row says so and it is listed in the verdict as uncovered.
3. **Given** a test in the evidence is named for a criterion but the described behaviour differs from it, **Then** the row is flagged and the verdict lists it under "tests that may not test the right thing".
4. **Given** every row and the verdict were produced by AI, **Then** each is labelled Inferred, never Verified, and each cites where in the specification, the TDD evidence or the code it comes from.
5. **Given** the reviewer follows a citation, **Then** it opens the cited passage of the stored document text or the cited code lines.

---

### User Story 3 - See whether the code reflects the specification (Priority: P2)

The reviewer sees two short lists of apparent scope deviations: things the code does that the specification did not ask for, and things the specification asked for that the code does not do.

**Why this priority**: It completes the "does the code reflect the spec" question, but the criteria table already shows missing implementation, so the product works without it.

**Independent Test**: Use a pull request that adds an endpoint the specification never mentions and omits one required criterion. Both appear in the right list, each with a citation.

**Acceptance Scenarios**:

1. **Given** the code changes include behaviour with no matching requirement, **Then** it is listed as implemented but not requested, with the changed lines it comes from.
2. **Given** a requirement has no matching change, **Then** it is listed as requested but not implemented, with the requirement it comes from.
3. **Given** there are no deviations, **Then** the panel says none were found and does not leave the lists blank without comment.

---

### User Story 4 - See clearly when the specification cannot be found or is incomplete (Priority: P1)

When the specification or the TDD evidence is missing, stale or ambiguous, the reviewer is told, with the reason. A missing document is a visible gap. It is never read as "nothing to check" or "tests pass".

**Why this priority**: A silent gap reads as a clean result, which would mislead the reviewer (constitution V.1, V.2). This is as important as finding the documents.

**Independent Test**: Open a pull request whose key matches no folder, then one whose folder has a specification but no TDD evidence. Each shows an explicit gap and no assessment is made for what is missing.

**Acceptance Scenarios**:

1. **Given** no folder matches the key anywhere, **Then** the Specification row of the completeness list is missing with the reason, and the panel says no specification was found and where it looked.
2. **Given** a specification file is found but `tdd-evidence.md` is not, **Then** the TDD evidence row is missing, the criteria are still listed from the specification, and each row's test column says "no evidence available", not "no test".
3. **Given** the PR has no Jira key, **Then** the panel says no key was found to search with.
4. **Given** the pull request's repository is not inside a project repository known to the workspace, **Then** the panel says so and searches only the pull request's own repository.
5. **Given** the documents were read from `develop` but a matching branch has newer commits, or the commit of either document has moved since it was read, or the documents were read at an older pull request head than the one shown, **Then** the documents and the assessment are marked stale with the reason, never shown as current, and a new assessment runs on the new text.
6. **Given** several folders match the key, **Then** all are listed and the assessment uses the one on a matching branch rather than `develop`, and among the rest the one with the most recent commit. The reviewer is told which was used and by which rule.
7. **Given** reading from the project repository fails (unreachable, no permission), **Then** this becomes a visible gap and the rest of the overview still loads.

---

### Edge Cases

- The key matches folders for two unrelated features (for example `ENG-12` against `ENG-1213`): a match requires the whole key, so `ENG-12` must not match `ENG-1213-...`.
- Key case differs between the branch and the folder name (`eng-1213` and `ENG-1213`): they match.
- The pull request refers to more than one key: the documents for each are searched, and the panel groups them by key.
- The folder holds more than one file ending in `spec.md`: all are listed and the one used is named.
- The specification is very large: the assessment states which parts were left out for size, and the reviewer still sees the full text on request.
- The specification or evidence was changed after the pull request opened: the commit read is shown so the reviewer can tell.
- The pull request's own repository also has a matching folder: it is searched first and its documents are used first.
- The enclosing project clone has uncommitted work or a different branch checked out: the reviewer's working copy is never read or changed.
- The AI provider fails or returns something unusable: the documents and their summaries remain, the assessment shows a visible failure, and it can be retried.

## Requirements *(mandatory)*

### Functional Requirements

**Finding the documents**

- **FR-001**: The system MUST take the Jira keys from the pull request (branch name, title, description) and use them to find the specification.
- **FR-002**: The system MUST search the pull request's own repository first, then the project repository that encloses it on the reviewer's machine, determined from the repositories the workspace already discovered, not from a platform name or a naming convention.
- **FR-003**: In each repository searched, the system MUST consider the `develop` branch and every open branch whose name contains the key, and MUST find specification folders whose name contains the whole key, case-insensitively.
- **FR-004**: When a matching branch and `develop` both hold the folder, the matching branch MUST win, and the panel MUST say the other copy exists.
- **FR-005**: The system MUST read the specification file (the file whose name ends in `spec.md`) and `tdd-evidence.md` each from the best place it exists, applying the branch-over-`develop` rule to each document separately, so evidence that exists only on the feature branch is not reported missing. It MUST record the repository, branch and commit each document was read from.
- **FR-006**: Finding and reading MUST NOT change the reviewer's working copy, branches, index, stash or uncommitted files, and any fetch MUST write only to refs the product owns.

**Showing the context**

- **FR-007**: The overview MUST replace the "Changed files" section with a Specification panel and MUST NOT show the file list.
- **FR-008**: The panel MUST show a summary of the specification, a summary of the TDD evidence, the source of each, and a way to read each document in full as read-only text.
- **FR-009**: The completeness list MUST gain a Specification row and a TDD evidence row, each found, missing or stale, with a reason when not found.
- **FR-010**: A missing, stale or ambiguous document MUST be shown as an explicit gap and MUST NOT be replaced by an assumption, a guess at its content or an assumed pass.

**Assessing alignment**

- **FR-011**: The system MUST produce one row per acceptance criterion in the specification, with the criterion's identifier or wording, an implementation state (Implementation and test identified, Implementation identified, Requires verification, Not found) and whether the TDD evidence shows a test for it.
- **FR-012**: The system MUST produce a verdict on test sufficiency that names uncovered criteria and tests that do not appear to exercise the behaviour the criterion asks for.
- **FR-013**: The system MUST list apparent scope deviations in both directions: implemented but not requested, and requested but not implemented.
- **FR-014**: Every statement in the assessment MUST be labelled Inferred and MUST cite its source: a passage of the specification, a passage of the TDD evidence or a range of changed lines. A statement whose citation cannot be found in the stored document text or the changes MUST be downgraded or flagged, not shown as fact.
- **FR-015**: The assessment MUST NOT run when the specification is missing, MUST state which parts cannot be judged when only the TDD evidence is missing, and MUST NOT report a coverage figure it has not been given.
- **FR-016**: The assessment MUST start automatically for each new snapshot once the documents are found, without the reviewer asking. It MUST be tied to the pull request head it was made against, MUST be marked stale when the head moves or when the commit of either document moves (the documents' commits are re-checked on each refresh), and a new run MUST add a record without removing the earlier one.
- **FR-017**: The documents read, the summaries and assessment, and any later reviewer judgement MUST be kept as separate kinds of record. The assessment MUST reference the documents it rests on.
- **FR-018**: A failure to find, read or assess MUST degrade to a visible gap or failure notice and MUST NOT stop the rest of the overview from loading.

### Key Entities

- **Specification source**: where the documents were found: the repository, branch, commit and folder, with the key that matched and any other folders or copies that also matched.
- **Specification document**: the full text of the specification file or `tdd-evidence.md` as read at that commit, with its status (found, missing or stale). It is evidence, never edited.
- **Acceptance criterion**: one testable statement from the specification, with an identifier or wording.
- **Alignment row**: for one criterion, the implementation state, whether a test is shown, and the citations. It is an assessment, labelled Inferred.
- **Test sufficiency verdict**: the overall judgement of testing, with uncovered criteria and tests that may not test the right thing.
- **Scope deviation**: a change with no requirement, or a requirement with no change, with its citation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a pull request whose key matches a specification folder, a reviewer sees both summaries and the source on the overview without opening another repository, in at least 95% of cases where the folder exists on `develop` or a matching open branch.
- **SC-002**: A reviewer can answer "was there enough testing, and of the right things" from the overview alone, without opening the specification or the TDD evidence, for a specification of up to 30 acceptance criteria.
- **SC-003**: When the specification or the TDD evidence cannot be found, 100% of those cases show an explicit gap with a reason, and none show an assessment or a pass for the missing part.
- **SC-004**: Every statement in the assessment carries a source the reviewer can open, and none is shown as verified without the reviewer marking it.
- **SC-005**: In a test set that includes a pull request that does not match its specification, the reviewer is shown the mismatch (an uncovered criterion, a test that does not test the right thing, or a scope deviation) in every case.
- **SC-006**: Finding the documents leaves the reviewer's checked-out branch, working files, index and stash unchanged in every test.
- **SC-007**: The overview opens with the rest of its content in the same time whether or not the specification is found; a missing specification adds no failure to the page.

## Assumptions

- The Jira key is in the pull request's branch name, title or description, using the key forms the product already recognises. A pull request with no key shows the "no key" gap; searching by other means is out of scope.
- The enclosing project repository is a clone the workspace already found, whose folder contains the pull request's clone. A repository not inside another known clone only searches its own repository.
- The specification folder's name contains the Jira key, as Spec Kit names folders after the feature branch. Matching on the content of specification files is out of scope for this feature.
- Specification files end in `spec.md` (`spec.md`, `<name>.spec.md`, `<name>-spec.md`) and the evidence file is named `tdd-evidence.md`, directly in the specification folder or in its `tests/` subfolder (the folder copy wins). Other layouts are shown as a missing document.
- "Open branches" are those the project repository's remote reports; branches for closed or merged pull requests are not searched beyond `develop`.
- The assessment uses the AI provider the product already uses for summaries and risk, with the same restrictions, and the documents it reads from another repository are passed in its input, not read through the AI's workspace.
- Marking a mapping Verified (FR-4.7), the assumptions and ambiguities list (FR-4.6) and related pull requests (FR-4.8) are not part of this feature.
- Reviewing the quality or wording of the specification itself is out of scope; the product assesses alignment with the pull request.
- The new panel and rows follow the product's existing wording and visual conventions and its constitution, including the separation of evidence, assessment and disposition (III.1) and missing context shown as gaps (V.1).
