# Implementation Plan: Specification Context and TDD Alignment

**Branch**: `006-spec-context` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

**Size**: normal

## Summary

The overview's "Changed files" section is replaced by a Specification panel. For each Jira key on the pull request, a new `spec-context` service looks for a specification folder named after the key, first in the pull request's own repository, then in the project repository whose clone encloses it on disk. It reads the specification file and `tdd-evidence.md` from the best branch (a matching branch beats `develop`, per document) using read-only git into refs the product owns, and stores the text with where and at which commit it was read. Once the documents exist, one AI run on a new work lane, queued with each snapshot like summaries and risk, returns both summaries, one row per acceptance criterion, a test-sufficiency verdict and scope deviations. The server checks every citation against the stored text and the changed lines and downgrades what it cannot resolve. Missing, stale or ambiguous documents show as completeness gaps, never as a pass.

No new dependencies.

## Technical Context

**Language/Version**: TypeScript (`strict`), Node.js 24, Preact 10. No change.

**Storage**: the existing SQLite store; six new append-only tables (`data-model.md`). Document text is kept in the store so citations stay resolvable after the branch moves.

**Testing**: `node:test` unit and integration tests with the git sandbox helper and the fake AI CLI; browser tests with Playwright, as in features 003 to 005.

**Constraints**: constitution IX (git allowlist, no working-copy change), I.1/I.2 (citations, downgrade), III (separate record types), V (gaps), VIII.2 (no platform branching), X.9 (documents go only to the configured provider).

## Constitution Check

| Rule | Assessment |
|---|---|
| I.1, I.2, I.3 citations, downgrade, unparseable output | PASS. Every row, verdict item and deviation carries a citation checked against stored text or changed lines (FR-014). Unresolvable ones are downgraded to `unverified`. Unparseable output becomes one Inference with a warning, reusing `textAsInference`. |
| II.1, II.2 no writes, no verdict | PASS. Read-only. The verdict says "testing looks sufficient or incomplete" and is labelled Inferred; it does not feed readiness. |
| III.1, III.3 separate record types | PASS. `spec_document` (Evidence), `spec_alignment_*` (Assessment, referencing the documents they rest on). No Disposition is added. |
| III.2 append-only | PASS. Triggers as in `risk_run`. A new run adds a record. |
| III.4 provider, context version, timestamp | PASS. Stored on `spec_alignment_run`. |
| IV.1 reasons for classifications | PASS. The state of each criterion cites its lines. The precedence rule used is stored and shown. |
| V.1 to V.4 gaps, no invented values, stale, connector failure | PASS. Specification and TDD evidence are completeness rows. No coverage figure is computed. Moved commits mark stale. A failed read is a gap and loads nothing else down. |
| VI.1 consume existing tools | PASS. Reads Spec Kit output with git. No parser beyond file-name matching and the AI's reading. |
| VII no developer metrics | PASS. No per-author figure. |
| VIII.2 no platform branching | PASS. The enclosing project is found from discovered folder paths. Git does the reading. No platform adapter changes. |
| IX.1, IX.2, IX.4 repository safety | PASS, with new git commands added to the allowlist and each tested (XI.3). Fetches go to `refs/prwb/<session>/<snapshot>/spec-<n>`, removed by the existing session-ref delete. |
| IX.3 AI workspace | PASS. The AI keeps the pull request's isolated worktree. The documents are in the data block, not read from the project clone. |
| X.5 state-changing checks | PASS. `GET` never writes. Retry is a `POST` behind the guard. |
| X.9 context to the configured provider only | PASS. Same provider as summaries. |
| XI.1 test-first | PASS. Test tasks come first. Recorded git sandboxes cover the safety rules. |
| Q.1 dependencies | PASS. None added. |
| Q.2 scope | PASS. ADR 0003 brings FR-4.1 to FR-4.5 into this feature. FR-4.6 to FR-4.8 stay out. |

Re-checked after design: no violations. No Complexity Tracking needed.

## Project Structure

```text
src/repo/
  git.ts                    +listRemoteHeads, +listTreePaths, +lastCommitTouching (allowlist)
  manager.ts                +listRemoteBranches, +fetchSpecRef, +listSpecFiles, +readSpecFile
src/core/
  spec-match.ts             NEW  pure: key-in-name match, folder choice rule, file-name match
  spec-context.ts           NEW  service: lookup, recheck, documents, alignment lane run, report
  spec-alignment.ts         NEW  pure: validate AI output, check citations, downgrade
  workspace.ts              +enclosingOf(repositoryId)
  completeness.ts           +specification and tdd-evidence rows
  prompt.ts                 +'alignment' output kind and rules
  lanes.ts                  +'alignment' lane
  sessions.ts               +onRefreshed hook (same head, documents re-checked)
src/contracts/
  http.ts                   +SpecContextReport and related wire types, +CompletenessRow sources
  ai-provider.ts            +alignment output schema
src/adapters/claude-code-cli/schemas.ts   +alignment schema
src/store/schema.sql, review-store.ts     +six tables and their methods
src/server/routes/spec-context.ts         NEW  report, document text, retry
src/main.ts                 wire the service and the routes
src/ui/
  components/spec-context.tsx   NEW  panel: summaries, source, rows, verdict, deviations, document viewer
  state/use-spec-context.ts     NEW
  screens/overview.tsx          replace Changed files; remove snapshot fetch
  api.ts, labels.ts, app.css    edited
test/{unit,integration,end-to-end,ui}/  see tasks
```

**Structure Decision**: mirror feature 004: a pure module for rules, a service that is the only writer, an AI lane run, a report derived from stored rows, SSE for progress. Git access stays in the Repository manager (IX.2).

## How it fits together

On `onSnapshotStored`, the service starts the lookup without blocking snapshot creation. It takes the keys from the branch, title and description with the same tracker `extractReferences` the issue row uses, so the core holds no key pattern. For each key it searches the pull request's clone, then the enclosing clone from `Workspace.enclosingOf`. In a clone it lists the remote's heads with `ls-remote`, keeps `develop`, every head whose name contains the whole key (the pull request's own head included), fetches each into a product-owned ref, lists the tree for `specs/*<key>*` folders and picks files. Each chosen file is read at its last-touching commit and stored. When `onSnapshot` fires, the service waits for the lookup, then queues one alignment job on the `alignment` lane if a specification was found.

On a same-head refresh, `onRefreshed` repeats `ls-remote` and the last-touching commit for each stored document. If either moved, it stores a new lookup and documents and queues a new run; the earlier ones stay and show as stale. The report is derived on read. It marks stale when the snapshot is not the latest, or a document's current commit differs from the stored one.

```text
Key found ─ own repo ─ enclosing repo ─ heads: develop + matching ─ per-document best source
   │            │              │                   │                         │
 no key     no clone      not inside one      none match              spec only / both / none
 gap        gap           search own only     gap                      gap on the missing one
```

## Key risks

- `ls-remote` and `fetch` need network and the reviewer's git credentials, the same as the existing PR fetch. A failure is a gap with the first git error line (FR-018, SC-007).
- Large documents are cut by the existing prompt limits. The run records which parts were left out; the full text stays viewable.
- The AI can cite wrongly. Citation checking is deterministic and downgrades, so a wrong citation shows as `unverified`, never as fact.
