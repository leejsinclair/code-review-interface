# Implementation Plan: Risk-Based Review Focus

**Branch**: `004-risk-review-focus` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-risk-review-focus/spec.md`

## Summary

Give every changed file in a snapshot a risk class (Low, Normal, Elevated, Critical) with reasons, rule
IDs and the responsible changed lines. A pure, deterministic classifier runs when a snapshot is stored
and writes append-only rule records (RR-1 to RR-4). An AI assessment then runs on its own work lane, can only
raise a class, and must cite a resolvable changed line (RR-5). A reviewer can override a class with a
recorded reason, and a lowered Critical class also records the platform account, read through a new
read-only `currentUser()` on `SourceControlProvider` (RR-6). Overrides carry across snapshots by a
fingerprint of the file's change (RR-7). The effective class is always derived, never stored (data-model).
The UI fills the Overview "Review focus" section, adds badges, a class filter and a risk sort to the file
list, marks responsible lines in the diff, and makes Next/Previous follow the chosen order (RR-10).

## Technical Context

**Language/Version**: TypeScript (`strict`), Node.js 24, native type stripping (`node src/main.ts`); Preact
10 for the UI. No change to either.

**Primary Dependencies**: None added (Q.1). Glob matching, the comment table and the change fingerprint use
`node:crypto` and string code only (RR-11). Existing: `node:sqlite`, `preact`, `lucide-preact` (icons for
badges, already used), `playwright` and `@axe-core/playwright` (dev).

**Storage**: The existing SQLite review store (`src/store/schema.sql`), six new append-only tables
(`data-model.md`); the rule file `<appDataDir>/risk-rules.json` (read-only to the product).

**Testing**: `node --test` with recorded fixtures and the fake AI provider; Playwright UI tests with axe;
one new case in the shared source-control contract suite (`currentUser`).

**Target Platform**: Local Node.js server and browser UI on Windows, macOS and Linux (P.4): paths built with
`node:path`; rule-file globs match `/`-separated repository paths, never filesystem paths.

**Project Type**: Local web application: one TypeScript codebase, server in `src/`, UI in `src/ui/`.

**Performance Goals**: Rule classification of 500 files, with patches, completes in well under a second
(SC-006: before the file list is shown); a unit test with 500 synthetic files asserts a generous bound (2 s).
The AI run never gates the report.

**Constraints**: No numeric score (FR-002). The AI cannot lower a class (FR-014). Nothing is written to any
platform (FR-039). No worktree is changed (IX). Text from PR, rules and AI is shown as text (FR-034). Rule
patterns are globs and terms only, so a hostile rule file cannot cause regex backtracking (RR-4).

**Scale/Scope**: Hundreds of files per PR; a file's `patch` up to the existing 5,000 changed-line limit.
About 8 new core modules, 1 store extension, 1 route module, 6 UI components, 1 adapter method ×3.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design (see the end of this section).*

Constitution 2.0.0. Each principle is checked; no violation is carried into Complexity Tracking.

| Rule | Result | How the design meets it |
|---|---|---|
| I.1 | Pass | An AI raise needs a resolvable changed line; without one it does not change the class (RR-5, VO-019). Each cited line records `resolved`. |
| I.2, I.3 | N/A | This feature has no Evidence/Inference claim labels. AI output that cannot be parsed makes the run `failed` with the reason; no claim is shown as fact. |
| II.1 | Pass | No platform write. `currentUser()` is a read. The override is stored locally only (FR-039). |
| II.2 | Pass | No readiness state is set or implied. A unit test scans labels and rendered risk text for "approved" (VO-030). |
| II.3 | Pass | Mechanical files are labelled "Mechanical (candidate for reduced review)", never approved (Verbatim Constraints). |
| II.4 | N/A | No platform write. |
| III.1 | Pass | Rule results, AI results and overrides are separate tables and shown as separate origins (data-model, ui.md). |
| III.2 | Pass | All six tables have no-update and delete-only-with-session triggers; no PUT/PATCH/DELETE route; a correction is a new override row (VO-024). |
| III.3 | Pass | An AI item stores the cited lines; an override stores the snapshot and path it decides. |
| III.4 | Pass | `risk_run` stores provider, context version and timestamps. Departure from `stored_prompt` is justified in RR-5 and is not a III.4 gap. |
| IV.1 | Pass | Every classification stores reasons, rule IDs and lines; path-only matches say so (FR-010). |
| IV.2 | Pass | Rules run first on snapshot store; AI raises only; rule file cannot lower (RR-4, RR-5, VO-013, VO-018). |
| V.1, V.2 | Pass | Missing AI, ignored rule file, skipped files and unreadable account are shown as explicit states with reasons. Unknown languages are never treated as comment-only (RR-2). |
| V.3 | Pass | Older snapshots keep their own classes; an AI result for an older head is marked older and never applied to a newer snapshot. |
| V.4 | Pass | AI failure, rule-file failure and identity failure each degrade one thing and block nothing else (VO-014, VO-020, VO-023). |
| VI.1 | Pass | Lexical rules only; no parser, call graph or static analysis built. "Public interface" and "shared code" are left to the AI (spec Assumptions). |
| VI.2 | N/A | Not an evidence importer. |
| VII.1, VII.2 | Pass | No per-person query or total exists; override history is read per file only; reviewer name is audit data (RR-11, VO-031, VO-032). |
| VIII.1, VIII.2 | Pass | `currentUser()` is on the neutral contract, implemented in the three adapters; no platform name in core or UI (`platform-names.test.ts`). |
| VIII.3 | Pass | `currentUser()` is on the read contract and uses the read-only fetch; the contract suite asserts GET only. |
| IX | Pass | The classifier reads stored patches only; the AI runs in the isolated worktree through the existing path. |
| X.1 to X.5 | Pass | New routes sit behind the existing guard; the override POST is state-changing and covered by the Origin check (X.5); the `risk` SSE event carries no class data. |
| X.6, X.10 | Pass | The risk run uses the same provider restrictions and the same untrusted-data block as summaries; restrictions not enforced are recorded on the run. |
| X.7 to X.9 | Pass | No credential is read by this feature except through the existing credential store inside the adapter; `currentUser()` returns only handle and name. No telemetry. |
| X.11 | N/A | No `SourceControlWriter` use. |
| XI.1 | Pass | The Verification Plan below lists obligations; tasks will put a failing test ahead of each behaviour. |
| XI.2 | Pass | `currentUser` is covered by the one shared contract suite for all adapters, on fixtures. |
| XI.3 | Pass | The append-only and read-only-adapter tests extend to the new tables and method (VO-024, VO-021). |
| XI.4, XI.5 | N/A | No test writes to a platform; no writer. |
| P.1 to P.5 | Pass | One TypeScript codebase, no new tooling, `node:path`, no shell, runs from source. |
| Q.1 | Pass | No runtime dependency added (RR-11). |
| Q.2 | Pass | In scope: MVP FR-3, feature 004 per ADR 0003. Out of scope and not built: readiness, Home risk sort, review progress. |

**Re-check after design**: pass on every row. Two design points were checked twice because they touch
principles: (1) the override identity is fetched server-side and the body refuses a `reviewer` field, so VII.2
audit data cannot be client-supplied or aggregated; (2) the `risk_run` table departs from the `stored_prompt`
owner pattern to avoid rebuilding an append-only table, and still meets III.4.

## Project Structure

### Documentation (this feature)

```text
specs/004-risk-review-focus/
├── plan.md              # This file
├── research.md          # Phase 0: decisions RR-1 to RR-11
├── data-model.md        # Phase 1: tables, derived effective class, transitions
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── http-api.md                      # routes, types, SSE event
│   ├── rule-file.md                     # risk-rules.json
│   ├── source-control-current-user.md   # currentUser() on the neutral contract
│   └── ui.md                            # labels, Review focus, list, diff, override dialog
├── tests/
│   └── behaviour-checklist.md
├── checklists/requirements.md
└── tasks.md             # Phase 2: /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/
├── contracts/
│   ├── source-control.ts        # + CurrentUser, currentUser()
│   ├── ai-provider.ts           # AskOutput gains 'risk'
│   └── http.ts                  # + RiskReport, RiskFile, OverrideRecord, SSE 'risk', bodies
├── adapters/{github,gitlab,bitbucket}/source-control.ts   # implement currentUser(); verifySignIn/approvedByMe reuse it
├── adapters/claude-code-cli/schemas.ts                    # + RISK_SCHEMA
├── core/
│   ├── risk/
│   │   ├── classes.ts           # RiskClass, rank constant, maxClass/isHigher
│   │   ├── classes.ts           # RiskClass, rank constant, maxClass/isHigher
│   │   ├── builtin-rules.ts     # rule data, stable IDs (RR-3)
│   │   ├── glob.ts              # small `*`/`**`/`?` matcher
│   │   ├── comments.ts          # per-language comment table + hunk scan (RR-2)
│   │   ├── patch.ts             # parse a stored patch into changed lines with sides; change fingerprint (RR-7)
│   │   ├── ruleset.ts           # load and validate risk-rules.json, version (RR-4)
│   │   ├── classify.ts          # pure: files + ruleset -> classifications and reasons (RR-3)
│   │   ├── assess.ts            # pure: AI output + rule classes -> items, raise-only (RR-5)
│   │   └── effective.ts         # derive effective class and the RiskReport (data-model)
│   ├── risk-service.ts          # onSnapshotStored (classify), onSnapshot (queue AI), overrides, reviewer lookup
│   ├── lanes.ts                 # LaneName gains 'risk'
│   ├── prompt.ts                # output 'risk': instructions + data block
│   ├── sessions.ts              # + deps.onSnapshotStored after appendSnapshot (both call sites)
│   └── work-recovery.ts         # note: no unfinished risk run is stored (no change expected)
├── store/
│   ├── schema.sql               # + 6 tables, indexes, triggers (append-only)
│   └── review-store.ts          # + append/read methods for the new tables (no update, no delete, no by-reviewer query)
├── server/
│   ├── routes/risk.ts           # GET report, GET reviewer, GET/POST overrides
│   ├── routes.ts, events.ts     # register module; SSE event name 'risk'
├── main.ts                      # wire risk service, pass onSnapshotStored/onSnapshot
└── ui/
    ├── api.ts                   # getRisk, getReviewer, postOverride, getOverrideHistory
    ├── labels.ts                # RISK_LABELS; REVIEW_FOCUS heading only
    ├── state/{use-risk.ts, file-order.ts, view-state.ts, live-stream.ts}
    ├── components/{risk-badge.tsx, review-focus.tsx, risk-reasons.tsx, risk-filter.tsx, override-dialog.tsx, file-list.tsx, code-view.tsx}
    ├── screens/{overview.tsx, diff.tsx}
    └── app.css                  # badge, mark and dialog styles (light and dark)

test/
├── unit/risk-*.test.ts          # glob, comments, patch/fingerprint, classify, ruleset, assess, effective, file-order, labels
├── contract/source-control.suite.ts (+ currentUser case, fixtures per adapter)
├── integration/risk-service.test.ts, review-store.test.ts (+ tables)
├── end-to-end/risk.test.ts      # fake provider, fixtures, overrides, refresh carry-over, delete
├── ui/sweep.ui.ts (+ risk states), diff.ui.ts, overview.ui.ts
└── fixtures/github/risk-*.json, fixtures/{gitlab,bitbucket}/user.json (as needed), fake-claude risk scripts
```

**Structure Decision**: Single project, extending the existing layout. Pure logic (`core/risk/*`) is separated
from the stateful `risk-service.ts` so the classifier, the raise-only rule and the effective-class derivation
are unit-tested without a database, the AI or the network. The service is the only module that writes. The
UI reads one report resource through one hook and one ordering function.

## Complexity Tracking

No constitution violations. Two departures from existing patterns, both recorded above and not violations:

| Departure | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A separate `risk` lane | The risk run must not queue behind or block summaries (SC-006, spec "must not delay") | Sharing the summary lane serialises two unrelated AI jobs and makes the risk result wait on a long summary |
| `risk_run` stores its own context columns, not a `stored_prompt` row | `stored_prompt` has a two-owner CHECK; changing it means rebuilding an append-only table | Rebuilding a history table for one feature risks the audit trail it exists to protect |

## Verification Plan

### Verification commands

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| unit-risk | `node --test {select}` | focused | `package.json` script `test` runs `node --test "test/**/*.test.ts"`; the selector narrows it |
| typecheck | `npm run typecheck` | focused | `package.json` script `typecheck` |
| test-all | `npm test` | broad | `package.json` script `test` |
| build-ui | `npm run build:ui` | focused | `package.json` script `build:ui` (UI tests need it first) |
| test-ui | `npm run test:ui` | broad | `package.json` script `test:ui` |
| test-gitlab | `npm run test:gitlab` | broad | `package.json` script `test:gitlab` (optional, needs the local GitLab) |

### Verification obligations

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | FR-001, FR-009, US2-AS1 | A file matches two sensitive rules | One class, the higher; both rules listed with IDs and reasons | unit | planned |
| VO-002 | FR-003, FR-004, SC-005 | Behavioural change in a path in each of auth, authz, delete, finance; in a migration; in a CI file; a term-only match in an ordinary file | Critical for the four areas by path, Critical for migration, at least Elevated for config, Elevated for term-only | unit | planned |
| VO-003 | FR-011, SC-003 | Classify the same snapshot twice | Identical classes, reasons and lines | unit | planned |
| VO-004 | FR-010, US2-AS3 | A path-only rule match | The reason says it matched on the path and records no lines | unit | planned |
| VO-005 | FR-001, FR-009 | A file no rule matches | Normal with a reason and no rule ID | unit | planned |
| VO-006 | FR-005, SC-005, EC-01 | Comment-only edit in an auth and in a migration file | Low, `R-COMMENT-ONLY`, reason names the rule not applied, mechanical | unit | planned |
| VO-007 | FR-006, EC-02 | Behavioural change in a file with an unknown extension | Not Low, not comment-only | unit | planned |
| VO-008 | FR-005, RR-2 | Reindent of a TypeScript file, of a Python file, and a reordering of statements | TS reindent is whitespace-only; Python reindent and reordering are behavioural | unit | planned |
| VO-009 | FR-007, EC-03 | Added file and deleted file in a sensitive area | Behavioural; a deleted migration is Critical | unit | planned |
| VO-010 | FR-007, EC-04 | Rename with no change; rename into and out of a sensitive path | Low `R-RENAME-ONLY` mechanical; Elevated for the sensitive path | unit | planned |
| VO-011 | FR-007, EC-06 | Lockfile and generated file, and one inside a sensitive path | Low mechanical for the first two; sensitive class and not mechanical for the third | unit | planned |
| VO-012 | FR-008, EC-05 | Binary file and a limit-skipped file | Never below Normal; not fully analysed with the reason | unit | planned |
| VO-013 | FR-035, US6-AS2, SC-004 | Rule file entry that lowers a built-in class; entry with a bad glob; unknown field | The entry is rejected and named; built-in unchanged | unit | planned |
| VO-014 | FR-036, US6-AS3, V.4 | Missing file; non-JSON file; partly invalid file | Built-ins apply; notice names the file or entry and reason; nothing else blocked | unit | planned |
| VO-015 | FR-035, FR-037, US6-AS1, US6-AS4 | Valid `extend` and `add`; change the file between snapshots | Matching files classified under that ID; each snapshot records its own ruleset version | integration | planned |
| VO-016 | FR-013, US4-AS6 | Snapshot with a lockfile and a generated file | Neither is in the prompt; both show "Not assessed by AI: lockfile / generated file" | integration | planned |
| VO-017 | FR-013, FR-018, US4-AS1, US4-AS5 | AI raises a Normal file and a comment-only file | Elevated with origin AI and rule class still visible; the comment-only file leaves the mechanical list | integration | planned |
| VO-018 | FR-014, SC-004, US4-AS2 | AI returns a lower class, an equal class and `low` for a Critical and a Normal file | No class changes; items recorded as not applied | unit | planned |
| VO-019 | FR-015, I.1, SC-004, US4-AS3 | AI raise with no resolvable line, with a line outside the changes, and with an unknown file | No class change; shown as ignored with the reason | unit | planned |
| VO-020 | FR-017, FR-027, US4-AS4, V.4 | Provider unavailable; unreadable AI output; restart mid-run | Rule classes show; Review focus says the AI assessment is missing and why | integration | planned |
| VO-021 | FR-016, FR-039, VIII.3, XI.3 | `currentUser()` on every adapter; a risk run | One GET, no write; run stores provider, context version, time; no platform write or working-copy change | contract | planned |
| VO-022 | FR-020, FR-021 | POST an override carrying a `reviewer` field | Refused `unknown_field`; no record | integration | planned |
| VO-023 | FR-020, US5-AS2, EC-12 | Lower a Critical class with the account readable; unreadable (401); platform down; raise a class while signed out | Readable: record has handle and name; unreadable or down: refused with reason and fix, no record; raise: allowed, no platform call | integration | planned |
| VO-024 | FR-019, FR-021, SC-007, III.2, US5-AS4, US5-AS6 | Update and delete on each new table; override twice; delete the session | Triggers abort update and delete; two rows, latest applies, history readable; session deletion removes all | integration | planned |
| VO-025 | FR-023, US5-AS5 | New snapshot with the file's change identical but a new head and shifted lines | The override still applies | integration | planned |
| VO-026 | FR-023, US5-AS5, EC-11 | New snapshot where the file's change differs; where the file is removed | Override shown as lapsed with its reason and the recalculated class; removed file's overrides stay in history only | integration | planned |
| VO-027 | FR-029, FR-030, US3-AS1, US3-AS3 | Order and filter a list with all four classes, ties by path; Next and Previous at the ends | Order Critical, Elevated, Normal, Low, ties by path; Next/Previous follow it and stop at the ends | unit | planned |
| VO-028 | FR-032, US3-AS4, US3-AS5 | Choose a filter and order, leave and return in the tab; combine with the text filter | Choice restored; a file must satisfy both filters; no server request carries it | unit | planned |
| VO-029 | FR-028, FR-031, US2-AS2, US2-AS4, SC-008 | Badges and marks in the UI at wide, medium and narrow widths in both themes; keyboard through marks | Text and accessible name present without colour; every mark reachable and announced; axe finds no violation | end-to-end | planned |
| VO-030 | FR-007, II.2, II.3 | Scan labels and rendered risk text | The word "approved" and approval styling appear nowhere | unit | planned |
| VO-031 | FR-002, SC-009 | Inspect `RiskReport`, store tables and UI for score, percentage or rank | None exists | unit | planned |
| VO-032 | FR-025, FR-040, VII | Inspect the store interface and routes for any by-reviewer or cross-file override query | None exists; history needs a path | unit | planned |
| VO-033 | FR-026, FR-027, US1-AS1 to AS5, SC-001, SC-010 | Open the reference PR Overview | Critical and Elevated listed with reasons and links; mechanical and not fully analysed listed apart; counts shown; refresh recalculates and keeps the older snapshot's classes | end-to-end | planned |
| VO-034 | FR-033, FR-034, EC-08, EC-09 | AI finishes while the page is open; PR text with markup in a path, reason and rule label | Change announced to screen readers; all text rendered as text | end-to-end | planned |
| VO-035 | FR-024, US5-AS7, EC-13 | Override controls on an older snapshot and on a closed session | None offered; read still works; no new AI run, reason shown | end-to-end | planned |
| VO-036 | SC-006, FR-011 | 500 changed files with patches | Rule classes stored and returned within the bound, independent of the AI run | integration | planned |
| VO-037 | FR-012 | Rule-based classification input | Only paths and changed lines of the changed files are read | unit | planned |
| VO-038 | EC-10 | Snapshot replaced while the AI run is in progress | The run's result is stored on its own snapshot, marked older, and not applied to the new one | integration | planned |

### Verification exemptions

| Requirement | Reason | Alternative verification |
|-------------|--------|--------------------------|
| None | - | - |

### Manual verification

| ID | Covers | Steps | Expected result | Why not automated |
|----|--------|-------|-----------------|-------------------|
| MV-001 | FR-028, FR-031, SC-008, VO-029 | On a real display, open the reference PR in light and dark themes, then enable forced colours (or a greyscale filter) and view the file list and a diff with marks | Class and marks are still told apart by text, glyph and shape | Perceived legibility cannot be asserted by axe |
| MV-002 | FR-033, US2-AS4, VO-034 | With a screen reader, open Review focus, step through a diff's risk marks, and let an AI assessment finish | Reading order is sensible, marks are announced with class and reason, the class change is announced once | Screen-reader output varies and is not scripted in CI |

### Behaviour checklist

Behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).
