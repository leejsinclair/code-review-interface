# Data Model: Risk-Based Review Focus

Conventions follow `src/store/schema.sql`: snake_case columns, JSON arrays in TEXT, booleans as
INTEGER 0/1, ISO 8601 UTC timestamps, lower-case UUID ids, `STRICT` tables, every statement idempotent,
every table append-only with the session-deletion guard. No existing table changes (RR-8).

Classes are stored as the lower-case words `low | normal | elevated | critical`; the UI maps them to
Low, Normal, Elevated, Critical through `labels.ts`. Rank for comparison: low 0, normal 1, elevated 2,
critical 3 (a code constant, never stored, never shown as a number: FR-002).

## Entities and relationships

```text
review_session 1──* pr_snapshot 1──1 risk_ruleset            (rule results: Assessment by rules)
                       │      1──* risk_classification 1──* risk_reason
                       │      1──* risk_run 1──* risk_assessment_item   (Assessment by AI)
review_session 1──* class_override                           (Disposition, references a snapshot and a path)
```

## `risk_ruleset` (one row per snapshot)

| Column | Type | Notes |
|---|---|---|
| `snapshot_id` | TEXT PK, FK `pr_snapshot` ON DELETE CASCADE | |
| `ruleset_version` | TEXT NOT NULL | `builtin-<N>` or `builtin-<N>+<12 hex>` (RR-4) |
| `rule_file_status` | TEXT CHECK in `absent`, `used`, `partly-ignored`, `ignored` | |
| `rule_file_notice` | TEXT NOT NULL, JSON array of `{entry, reason}` | empty when `absent` or `used`; for `ignored` one item with `entry: "(file)"` |
| `classified_at` | TEXT NOT NULL | |

## `risk_classification` (one row per changed file per snapshot: the **rule class**)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `snapshot_id` | TEXT FK `pr_snapshot` CASCADE | |
| `path` | TEXT NOT NULL | the file's new path, equal to `changed_file.path` |
| `rule_class` | TEXT CHECK in the four classes | highest class among matching rules (FR-009) |
| `mechanical` | INTEGER 0/1 | FR-007: Low and one of lockfile, generated, comment-only, rename-only, and no higher rule |
| `not_fully_analysed` | TEXT | NULL, or the reason: `binary`, `file size`, `changed lines` (reuses `excluded_reason`) |
| `change_fingerprint` | TEXT NOT NULL | RR-7 |
| `UNIQUE (snapshot_id, path)` | | |
| CHECK | | `mechanical = 0 OR rule_class = 'low'`; `not_fully_analysed IS NULL OR rule_class <> 'low'` (FR-008: never below Normal) |

## `risk_reason` (the reasons and lines of a rule classification, FR-010)

| Column | Type | Notes |
|---|---|---|
| `classification_id` | TEXT FK CASCADE | |
| `ordinal` | INTEGER ≥ 0 | display order; `PRIMARY KEY (classification_id, ordinal)` |
| `rule_id` | TEXT NOT NULL | `R-…` or `X-…`, or `DEFAULT` for the no-rule Normal (no rule ID is shown for `DEFAULT`) |
| `rule_class` | TEXT | the class this rule alone sets; for a not-applied sensitive rule under `R-COMMENT-ONLY` see `applied` |
| `applied` | INTEGER 0/1 | 0 only for a sensitive rule recorded as "would have applied, was not" (FR-005) |
| `matched_on` | TEXT CHECK in `path`, `lines`, `path+lines` | a path-only match records no lines (FR-010) |
| `text` | TEXT NOT NULL | plain-words reason, composed by core from fixed templates plus the rule's label; no PR text is interpolated into it |
| `lines` | TEXT NOT NULL, JSON array of `{side, startLine, endLine}` | `side` is `head` (new) or `base` (old); empty for a path match |
| CHECK | | `matched_on = 'path' ⇔ json_array_length(lines) = 0` |

## `risk_run` (one row per AI assessment attempt for a snapshot; terminal state in the same row)

The run is written once it ends, because the schema is append-only and a run's start is held in the
in-memory lane (as `summary_run` is, then `summary`). To keep "in progress" visible after a restart, a
queued/running run is represented by the lane and by `work-recovery.ts`; see Recovery below.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `snapshot_id` | TEXT FK CASCADE | |
| `requested_at`, `finished_at` | TEXT NOT NULL | |
| `provider` | TEXT NOT NULL CHECK `<> ''` | III.4 |
| `outcome` | TEXT CHECK in `completed`, `cancelled`, `failed` | |
| `cancel_reason` | TEXT CHECK in `user`, `restart`, `superseded` | iff cancelled |
| `failure_reason` | TEXT | iff failed: provider unavailable, unreadable output, no workspace |
| `context_version` | TEXT | `<headCommit>:<sha256>` as for summaries (III.4); NULL when nothing was sent |
| `excluded_files` | TEXT JSON array of `{path, reason}` | `lockfile`, `generated file`, `binary`, `file size`, `changed lines`, `prompt limit` |
| `restrictions_not_enforced` | TEXT JSON array | same meaning as `summary` |

## `risk_assessment_item` (what the AI said about one file, applied or not)

| Column | Type | Notes |
|---|---|---|
| `run_id` | TEXT FK `risk_run` CASCADE | |
| `path` | TEXT NOT NULL | `PRIMARY KEY (run_id, path)` |
| `proposed_class` | TEXT CHECK in `normal`, `elevated`, `critical` | the model cannot propose `low` through the schema |
| `applied` | INTEGER 0/1 | 1 only if higher than the rule class and a cited line resolved |
| `ignored_reason` | TEXT CHECK in `not-higher`, `no-resolvable-line`, `unknown-file`, `not-assessable` | iff `applied = 0` |
| `reasons` | TEXT JSON array of strings | the model's reasons, shown as text only (FR-034) |
| `lines` | TEXT JSON array of `{side, startLine, endLine, resolved}` | each cited range and whether it resolved (I.1, III.3) |

Not-assessed files (lockfile, generated, over limit) have **no** item: they are listed in
`risk_run.excluded_files`. A file the model did not mention has no item and is shown as "AI gave no
opinion", not as agreement.

## `class_override` (Disposition; append-only)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `session_id` | TEXT FK `review_session` CASCADE | |
| `snapshot_id` | TEXT FK `pr_snapshot` CASCADE | the latest snapshot at the time (FR-024) |
| `path` | TEXT NOT NULL | |
| `class` | TEXT CHECK in the four classes | the class chosen |
| `replaced_class` | TEXT CHECK in the four classes | the effective class it replaced |
| `calculated_class` | TEXT NOT NULL CHECK in the four classes | the file's rule-or-AI class at save time, before any override; decides whether a name is required |
| `reason` | TEXT NOT NULL CHECK `trim(reason) <> ''` | max 2,000 characters, checked at the boundary |
| `change_fingerprint` | TEXT NOT NULL | RR-7 |
| `reviewer_handle`, `reviewer_name` | TEXT | both NULL, or both set; both set iff `calculated_class = 'critical'` and `class` ranks below critical |
| `created_at` | TEXT NOT NULL | |
| CHECK | | `class <> replaced_class`; the named-reviewer rule above |
| Index | | `class_override_by_path (session_id, path, created_at)` for "latest record" reads |

Referenced Finding (III.3): the override references the file and its snapshot classification through
`(snapshot_id, path)`; no separate Finding entity exists in this feature.

## Derived, never stored: effective class and the report

Computed in `src/core/risk/effective.ts` for a snapshot and path:

1. `rule_class` and `mechanical` from `risk_classification`.
2. `assessed_class` = `max(rule_class, applied AI item's proposed_class)` from the latest `completed`
   `risk_run` of that snapshot; `origin = 'ai'` when the AI raised it.
3. `mechanical` is cleared when the AI raised the class (FR-018).
4. `effective_class` = the latest `class_override` for (session, path) whose `change_fingerprint` matches the
   snapshot's, else `assessed_class`. A latest override whose fingerprint differs is returned as `lapsed`.
5. Everything for the report is derived from these rows. Nothing is cached in a table, so there is no state
   to drift (and nothing to update on an append-only store).

### State transitions

```text
snapshot stored ──► risk_ruleset + risk_classification + risk_reason   (synchronous, once)
        │
        └─► (workspace ready, provider ok) ──► risk lane queued ─► running ─► risk_run(completed|failed|cancelled)
                                                      └─► superseded by a newer snapshot ─► risk_run(cancelled, superseded)
effective class:  rule ──► (+AI raise) ──► (+override while fingerprint matches) ──► lapsed when it stops matching
```

## Recovery

`work-recovery.ts` already closes unfinished summary runs and questions on start as `cancelled/restart`.
Because a risk run is written only when it ends, a restart leaves no `risk_run` for the interrupted work and
the snapshot shows "AI assessment missing: the workbench was restarted". No automatic re-run in this feature
(spec Assumptions: manual re-run not required). A queued risk job is in memory only.

## Validation rules (boundary)

- Override body: `path` must be a changed file of the latest snapshot; `class` one of the four; `reason`
  trimmed, 1 to 2,000 characters; no `reviewer` field accepted (extra fields refused).
- Rule file: RR-4 limits. AI output: shape guard plus the per-item rule in RR-5.
- Every string from PR, rule file, rule label or AI is data; the UI renders it as text only (FR-034).
