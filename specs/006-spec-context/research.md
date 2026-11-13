# Research: Specification Context and TDD Alignment

## R1. Finding the enclosing project repository

**Decision**: Add `Workspace.enclosingOf(repositoryId)`: the matched entry whose folder is the nearest proper path ancestor of the pull request clone's folder. Search the pull request's own repository first, then that one.
**Rationale**: Discovery already descends into clones and records every matched folder (`src/repo/discovery.ts`), so containment is a path comparison with no platform knowledge (VIII.2). hd-job under project-hd-v3 is found this way.
**Alternatives considered**: Naming convention (`project-<x>`), rejected by FR-002. A configured mapping, rejected as setup the spec does not ask for. `git rev-parse --show-superproject-working-tree`, rejected because the nested folder is not guaranteed to be a submodule.

## R2. Reading another branch without touching the working copy

**Decision**: Four new allowlisted git commands: `listRemoteHeads` (`ls-remote --heads <url>`), `fetchToPrwbRef` reused with side `spec-<n>`, `listTreePaths` (`ls-tree -r --name-only <commit> -- specs/`), `lastCommitTouching` (`log -1 --format=%H <commit> -- <path>`). Content comes from the existing `readFileAtCommit`. Fetched refs go under `refs/prwb/<session>/<snapshot>/` and are removed by `deleteSessionRefs`.
**Rationale**: Same safety shape as the PR fetch (IX.1, IX.2). No checkout, no worktree, no index. The remote's heads are the "open branches" the spec assumes.
**Alternatives considered**: `git show origin/<branch>:path` from the reviewer's refs, rejected because it reads state the reviewer controls and may be stale. A platform API read of file contents, rejected by VIII.2 and because it needs a new method on every adapter.

## R3. Matching the key

**Decision**: A name matches a key when it contains the key case-insensitively, with no letter or digit directly before it and no letter or digit directly after it. This makes `ENG-12` not match `ENG-1213` and `eng-1213-x` match `ENG-1213`. Keys come from the tracker's `extractReferences`, the source the issue row already uses.
**Rationale**: Core holds no key pattern (existing rule in `references.ts`). The boundary rule is the one edge case the spec names.
**Alternatives considered**: Exact folder-name equality, rejected because Spec Kit folders are `NNN-<slug>` forms.

## R4. Which copy wins

**Decision**: Per document, rank by repository (own, then enclosing), then branch matching the key over `develop`, then most recent last-touching commit. The rule used and the other copies are stored on the source record.
**Rationale**: Clarifications 2 and 3. Ranking the repository first honours "searched first and used first".
**Alternatives considered**: Newest commit across all, rejected because it could prefer a stale-key branch over `develop`.

## R5. When the documents are stale

**Decision**: Store, per document, the last-touching commit. Each snapshot and each same-head refresh re-runs `ls-remote` and `lastCommitTouching`; a changed commit stores a new lookup. The report is stale when the snapshot is not the latest, a stored document's current commit differs, or a matching branch now exists that did not when `develop` was used.
**Rationale**: Clarification 4. Derived on read, as completeness is, so nothing has to be rewritten (append-only).
**Alternatives considered**: A timer, rejected because the product refreshes only on request.

## R6. One AI call or three

**Decision**: One run returns both summaries, the rows, the verdict and the deviations, as structured JSON, on a new `alignment` lane.
**Rationale**: The rows need both documents and the diff in one context. One call is one cost and one record. Summaries of the documents are part of the same output so they never disagree with the rows.
**Alternatives considered**: Separate summary and alignment runs, rejected for the cost and for possible disagreement. Reusing the `summary` lane, rejected because a long alignment run would block the pull request summary.

## R7. Checking citations

**Decision**: A pure function resolves each citation: `spec` and `tdd` citations by quoted passage or line range against the stored text, `code` citations against the snapshot's changed lines as the claim code does. A statement with no resolvable citation is kept but marked `unverified` and shown as a lower-confidence Inference. Every statement is `Inferred` regardless (FR-014, SC-004).
**Rationale**: Reuses the existing check for code; adds only document passages. The label never says Verified because marking Verified is FR-4.7, out of scope.
**Alternatives considered**: Dropping unresolvable statements, rejected because a silently dropped finding reads as a clean result (V.1).

## R8. Where the pieces are stored

**Decision**: Six append-only tables: `spec_lookup`, `spec_source`, `spec_document`, `spec_alignment_run`, `spec_alignment_row`, `spec_alignment_item` (verdict items and deviations). Document text is stored in full with its SHA-256.
**Rationale**: Mirrors feature 004. Documents are Evidence, runs and rows are Assessment (III.1). Storing the text keeps citations openable after the branch moves, and keeps the product out of the project clone at read time.
**Alternatives considered**: Re-reading the text from git on demand, rejected because a force-pushed branch would break old citations.

## R9. Completeness rows

**Decision**: Extend `CompletenessRow.source` with `specification` and `tdd-evidence`. Status and reason are derived on read from the latest lookup, as the issue row is.
**Rationale**: FR-009. No new UI for the list.
**Alternatives considered**: A separate gap list in the panel only, rejected because the completeness list is where reviewers already look for gaps.
