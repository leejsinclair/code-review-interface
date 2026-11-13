# Research: Risk-Based Review Focus

Phase 0 output. The spec has no `NEEDS CLARIFICATION` markers; this file records the planning
decisions the spec deferred (see its Assumptions) and the design choices made against the existing
code. IDs `RR-n` are cited from `plan.md`, `data-model.md` and `contracts/`.

## RR-1 Where classification runs and when

- **Decision**: A pure, synchronous classifier in `src/core/risk/` runs in-process when a snapshot is
  stored, before any workspace work, and writes its records in the same call. It reads only the
  `changed_file` rows (path, old path, status, language, `patch`, `excluded_reason`, `binary`). It does
  not touch the workspace or the network.
- **Rationale**: FR-011 and SC-006 want rule classes with the file list, and a snapshot without a
  workspace (platform diff, `repositoryStatus = 'missing'`) must still be classified. `onSnapshot` in
  `sessions.ts` is called only when `ensureWorkspace` succeeds, so it cannot be the hook. A new optional
  dependency `onSnapshotStored(sessionId, snapshotId)` is called right after `appendSnapshot` at both call
  sites (`create`/open and `refresh`). 500 files of patch text is a few milliseconds of string work.
- **Alternatives**: classify lazily on first `GET` (rejected: a read would write, breaking X.5 and giving
  non-repeatable timestamps); classify on the summary lane (rejected: waits behind AI work, breaks SC-006).

## RR-2 Comment-only and whitespace-only detection (FR-005, FR-006)

- **Decision**: A changed line is *non-behavioural* when it is blank, or (for a language in the comment
  table) is a comment-only line. The table is keyed by file extension and gives line-comment prefixes and
  block delimiters. It covers the families already in `LANGUAGES` plus shell, SQL, YAML, TOML, HTML/XML and
  Markdown. Block-comment state is tracked across all hunk lines (context lines too), starting "unknown" at
  each hunk. A line that begins with `*` while the state is unknown counts as a comment only when it matches
  `^\s*\*(\s|/|$)` and the hunk contains a block-comment opener for that language above it. A trailing
  comment after code is code. A file whose extension is not in the table has no comments: every non-blank
  changed line is behavioural (FR-006, V.2).
- **Whitespace-only edits** (a reindent): per hunk, the sequence of removed lines equals the sequence of
  added lines after all whitespace is removed. Sequence, not multiset, so reordering statements is still
  behavioural. For whitespace-significant languages (Python, YAML, Makefile, F#, Haskell) a reindent is
  behavioural, so this test is skipped for them.
- **Added and deleted files**: always behavioural (Assumptions), whatever their content.
- **Rationale**: no parser exists and constitution VI.1 forbids building code intelligence; a lexical table
  is the smallest thing that meets FR-005 and errs toward "behavioural", which can only raise a class.
- **Alternatives**: tree-sitter (a runtime dependency per language, Q.1, and it is code intelligence);
  asking the AI whether a change is comment-only (rejected: IV.2, rules first and deterministic).

## RR-3 Built-in rules (FR-003, FR-004, FR-007, FR-035)

- **Decision**: Rules are data in `src/core/risk/builtin-rules.ts`: `{ id, family, class, floor, paths,
  lineTerms }`. Path patterns are globs matched by a small in-repo matcher (`*`, `**`, `?`; case-insensitive;
  no regex from user data). Line terms are case-insensitive whole-word or substring tests applied only to
  behavioural changed lines (added or removed, both sides).
  - `R-AUTH`, `R-AUTHZ`, `R-DELETE`, `R-FINANCE`: a path match or a behavioural line match gives a floor of
    Elevated; a *behavioural change in the area* gives Critical. "In the area" means the **path** matches (the
    file lives in the sensitive area) and the file has any behavioural change, including added or deleted file;
    a line-term match alone (an ordinary file that mentions `password`) gives Elevated only. This is the
    reading of FR-003 that keeps SC-005 testable: path in the area + behavioural = Critical; term only = Elevated.
  - `R-MIGRATION`: path match (`**/migrations/**`, `**/migrate/**`, `db/changelog/**`, `*.sql` under those,
    `schema.sql`, `**/alembic/versions/**`, `**/flyway/**`, Rails `db/migrate/**`) = Critical when behavioural.
    A comment-only edit of a migration is Low (`R-COMMENT-ONLY`, FR-005).
  - `R-CONFIG`: CI definitions (`.github/workflows/**`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`,
    `Jenkinsfile`), container files (`Dockerfile*`, `docker-compose*.yml`, `.devcontainer/**`), infrastructure
    as code (`*.tf`, `*.tfvars`, `**/k8s/**`, `**/helm/**`, `*.bicep`, `cloudformation*`) = at least Elevated.
  - `R-LOCKFILE`: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `poetry.lock`,
    `Gemfile.lock`, `composer.lock`, `*.lock` = Low, mechanical.
  - `R-GENERATED`: `dist/**`, `*.min.js`, `*.generated.*`, `*.g.dart`, `*.pb.go`, `__generated__/**`,
    and a first-lines marker (`@generated`, `DO NOT EDIT`, `Code generated`) read from the patch's first
    hunk context or added lines = Low, mechanical.
  - `R-COMMENT-ONLY`, `R-RENAME-ONLY`: Low, mechanical (RR-2; a rename with `linesAdded = linesRemoved = 0`).
- **Precedence** (resolves the edge cases):
  1. Binary or limit-skipped file (FR-008): path rules only, floor Normal, flagged not fully analysed.
  2. Rename-only: if either name matches a sensitive path rule the file is Elevated (rule ID of the path
     rule); otherwise Low with `R-RENAME-ONLY`.
  3. Sensitive path rules (auth, authz, delete, finance, migration, config) evaluated. A lockfile or generated
     file that matches one keeps that class and is not mechanical.
  4. If the only changed lines are non-behavioural: Low with `R-COMMENT-ONLY`, and the reason names each
     sensitive rule that would have applied and was not applied (FR-005).
  5. Otherwise highest class wins, every matching rule is listed (FR-009).
  6. A file no rule matches is Normal with the reason "No mandatory-scrutiny rule matched" (FR-001 needs a
     reason on every file; this is rule-less and shows no rule ID, only the origin `default`).
- **Rationale**: the spec says path rules are "defaults to be tuned"; data-driven rules make tuning a data
  change, and the same shape serves the rule file (RR-4).

## RR-4 The rule file (FR-035 to FR-037, US6)

- **Decision**: `<appDataDir>/risk-rules.json`, plain JSON, read at classification time (every snapshot, and
  on refresh) by `src/core/risk/ruleset.ts`. Shape in `contracts/rule-file.md`. Entries are of two kinds:
  `extend` (name a built-in rule ID; add `paths` and `lineTerms`, and optionally a *higher* `class`) and `add`
  (a new rule with a new ID of the form `X-<NAME>`, family and class). Anything else is an ignored entry with
  a stated reason: unknown field, unknown family, a class lower than the built-in's, an ID that collides, a
  pattern over 200 characters or more than 100 patterns per entry, a malformed glob.
  A file that is not JSON or not an object is ignored as a whole. Built-ins always apply.
- **Version**: `ruleset_version = "builtin-<N>"` for built-ins alone, `"builtin-<N>+<first 12 hex of
  sha256(canonical JSON of the accepted entries)>"` with a file. The version is stored per snapshot (FR-037).
- **Lint of user patterns**: globs and terms only (no regular expressions from outside the code), so a rule
  file cannot cause catastrophic backtracking and the matcher is trivially bounded.
- **Alternatives**: YAML (needs a dependency, Q.1); regex line patterns (ReDoS risk, no timeout primitive for
  a synchronous `RegExp`); an in-app editor (out of scope).

## RR-5 The AI assessment (FR-013 to FR-018)

- **Decision**: A third output kind, `risk`, on the existing `AiProvider.ask` contract, and a third lane
  `risk` in `lanes.ts`. `buildPrompt` gains `output: 'risk'`: fixed instructions, a data block with the PR
  title and description, each assessable file's diff in diff order within the existing budget, and, per file,
  its rule class and rule IDs as context (so the model reasons about what rules missed). Lockfile and
  generated files are never put in the prompt (FR-013); files already excluded by `excludedReason` or the
  prompt budget are named as not assessed with that reason.
  Output schema `RISK_SCHEMA`: `{ files: [{ path, class: 'normal'|'elevated'|'critical', reasons: [text],
  lines: [{ side, startLine, endLine }] }] }`. Core validates it with a hand-written guard like
  `isSummaryOutput`.
- **Applying it** (`src/core/risk/assess.ts`, pure): for each returned file that is a changed file of the
  snapshot and assessable: it applies only if the proposed class is higher than the rule class and at least
  one cited line range resolves to a changed line of that file on that side (the same line map the Evidence
  checker builds from `patch`). Otherwise it is stored as *not applied* with a reason from a closed set:
  `not-higher` (this covers every lowering and equal class), `no-resolvable-line`, `unknown-file`,
  `not-assessable`. A proposed `low` is never accepted by the schema's enum; if the model sends it anyway the
  item is `not-higher`. So SC-004 holds by construction: the only code that raises a class is one comparison.
- **Lane, not summary lane**: spec Assumptions say "same work queue discipline as summaries". A separate lane
  keeps risk work from queueing behind a long summary and from blocking it, while keeping one job at a time
  per lane, in-memory only, cancelled as `superseded` for older snapshots, and failing to a visible state.
  `cancelQueued` already iterates every lane, so supersession needs no change.
- **Snapshot replaced while running** (edge case): the run belongs to its snapshot; the result is written to
  that snapshot and never applied to a newer one; the UI shows it on the older snapshot, marked older.
- **Stored prompt**: `stored_prompt` has an exactly-one-owner CHECK over question and summary run; changing
  a CHECK means rebuilding an append-only table, which this feature does not need. The risk run therefore
  stores its own `context_version`, `excluded_files` and `restrictions_not_enforced` columns (III.4 needs only
  provider, context version and time). Prompt text is reproducible from the context version; the full prompt is
  not stored. This is a recorded departure from how summaries work, justified by the migration cost.
- **Streaming**: no `risk-delta` events. The risk surface shows "AI assessment in progress" until the run ends.
- **Alternatives**: one provider call per file (rejected: slow, no cross-file view); folding risk into the
  summary schema (rejected: couples two features, a failed summary would lose risk, and the summary lane
  would not be free for the next question).

## RR-6 Current user capability (FR-020, Dependency)

- **Decision**: `SourceControlProvider.currentUser(): Promise<CurrentUser>` where
  `CurrentUser = { handle: string; displayName: string }`. GitHub: `GET /user` (`login`, `name ?? login`);
  GitLab: `GET /user` (`username`, `name`); Bitbucket Cloud: `GET /user` (`account_id`, `display_name`).
  It rejects with `AdapterError` (`unauthorized`, `unavailable`). It is read-only and goes through the same
  `ReadOnlyFetch`. `verifySignIn` and `approvedByMe` are refactored to call it instead of each owning a `/user`
  GET (`myLogin` in the GitHub and GitLab adapters). One contract-test case is added to the shared suite, run
  by every adapter against fixtures (XI.2).
- **Who calls it**: a core function `currentReviewer(sessionId)` resolves the session's platform from its
  stored `pr_repo_platform`, builds the provider through the registry, and calls `currentUser()` once, with no
  cache. It is called by `GET .../risk/reviewer` (form preview) and by the `POST .../risk/overrides` handler,
  and only when the override takes a file whose calculated class (`assessedClass`, before any override) is Critical below Critical (FR-020), so a stepwise lowering cannot avoid the name. The client never sends a name.
- **Recorded**: `reviewer_handle` and `reviewer_name` on the override. Both are audit data (VII.2).
- **Rationale**: `verifySignIn` already proves the credential and returns an `account`, but its value differs
  by platform (a display name on Bitbucket, a handle elsewhere) and its job is a sign-in check, not identity.
  Feature 008 needs identity, so identity gets its own method now.
- **Alternatives**: reuse `verifySignIn().account` (rejected: Bitbucket's `display_name` is not stable or
  unique, and a sign-in check should not be the audit source); a typed name (rejected by the spec).

## RR-7 Override carry-over by change fingerprint (FR-023)

- **Decision**: `change_fingerprint = sha256` over a canonical text of the file's change: status, old path,
  new path, and the ordered changed lines of every hunk as `+<line>` / `-<line>` with the original text, with
  hunk headers, context lines and line numbers left out. Two snapshots where the same lines were added and
  removed (even at different positions or after a rebase onto a newer target) have the same fingerprint.
  The fingerprint is computed in core from `patch`; it is stored on the override and compared with the later
  snapshot's value.
- **Why not the head commit or `diff_fingerprint`**: a new head commit with an unrelated file changed must
  not lapse an override on a file that did not change, and `diff_fingerprint` covers the whole diff.
- **Limit-skipped files** (no `patch`): the fingerprint falls back to `status + paths + additions +
  deletions + size_bytes`, and the override notes it was compared coarsely. A coarse match is accepted; this
  is a stated limitation.
- **Applying**: effective class for snapshot S and path P = the latest override record for (session, P) whose
  `change_fingerprint` equals S's fingerprint for P. If the latest record's fingerprint differs, it is shown
  as lapsed (US5-AS5) and no earlier record is consulted: a lapse is not a fall back to an older override,
  because the reviewer's latest word was about a change that no longer exists.
- **Removed file in a later snapshot**: no classification row exists for it in that snapshot, so nothing
  applies; its overrides remain in the history.

## RR-8 Records, append-only and deletion

- **Decision**: Six new tables, each with the same BEFORE UPDATE / BEFORE DELETE triggers as the rest of
  the schema and a session-walk in the delete guard: `risk_ruleset`, `risk_classification`, `risk_reason`,
  `risk_run`, `risk_assessment_item`, and `class_override` (see `data-model.md`). Rule results
  (`risk_classification`, `risk_reason`), AI results (`risk_run`, `risk_assessment_item`) and Dispositions
  (`class_override`) are separate kinds (III.1, FR-038). All are `CREATE TABLE IF NOT EXISTS` and add to the
  idempotent `schema.sql`; no existing table changes, so existing databases migrate by re-applying the file.
- **Test for the triggers**: the existing append-only test in `test/integration/review-store.test.ts`
  enumerates tables; the new tables are added to it. `deleteSession` already cascades through
  `ON DELETE CASCADE` from `pr_snapshot` and `review_session`.

## RR-9 HTTP surface and live updates

- **Decision**: Read: `GET /api/sessions/:id/snapshots/:snapshotId/risk` returns the snapshot's `RiskReport`
  (classes, reasons, lines, ruleset notice, AI state, overrides in effect, lapsed overrides). Write:
  `POST /api/sessions/:id/risk/overrides`. Identity preview: `GET /api/sessions/:id/risk/reviewer`. Override
  history: `GET /api/sessions/:id/risk/overrides?path=`. One new SSE event name, `risk`, carrying the changed
  file paths and the new report revision, so the UI re-reads the report and announces changes (FR-033).
  Details in `contracts/http-api.md`.
- **Why one report endpoint**: the Overview, file list and diff view all need the same data; one read keeps
  them consistent and means the file list fetches one resource, not one per file.

## RR-10 The UI

- **Decision**: One shared hook, `useRisk(sessionId, snapshotId)` in `src/ui/state/use-risk.ts`, loads the
  report and re-reads on the `risk` event. `src/ui/state/file-order.ts` is a pure function
  `arrangeFiles(files, classOf, { order, classes, text })` used by both the Overview file list and the Files
  view, so "Next and Previous follow the chosen order" is one tested function, not two copies.
  Per-tab state (`fileOrder`, `riskClasses`) goes in `SessionViewState` in `view-state.ts`, validated on read
  like the other fields; `view-state.ts` imports nothing from `api.ts` (X.7 test already enforces this).
  New components: `risk-badge.tsx`, `review-focus.tsx`, `risk-reasons.tsx`, `override-dialog.tsx`,
  `risk-filter.tsx`. `code-view.tsx` gains a `riskMarks` prop. `labels.ts` gains `RISK_LABELS` and
  `REVIEW_FOCUS` changes from the placeholder to the heading only.
- **Not by colour alone** (FR-028, FR-031, SC-008): the badge is an icon plus the class word; a risk mark in
  the diff is a gutter glyph with an accessible name `Risk mark: <rule ID or AI>: <reason>` and a tooltip.
  Marks sit beside the existing selection and range highlighting (a separate gutter cell, not a background).
- **Keyboard**: `[` and `]` are not used (Next/Previous already exist as links). A "Next risk mark" and
  "Previous risk mark" button pair in the file header moves focus to marked lines in order.
- **Alternatives**: a table instead of badges in the list (rejected: the list is a mobile-first list today,
  see 003); colour-coded rows (rejected by FR-028).

## RR-11 Constitution mapping that needed a decision

- **Platform names (VIII.2)**: `currentUser()` is implemented only inside the three adapters; core uses the
  neutral method. `test/unit/platform-names.test.ts` already fails if a platform name leaks.
- **VII / FR-025 / FR-040**: the override history API returns records for one file only and has no
  aggregate or per-reviewer query. The store has no method that groups by reviewer. A unit test greps the
  store interface and the HTTP contract for such a method.
- **No new runtime dependency (Q.1)**: glob matching, the comment table and the fingerprint use only
  `node:crypto` and string code.
