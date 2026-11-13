# Data Model: Specification Context and TDD Alignment

Conventions follow `src/store/schema.sql`: snake_case columns, JSON arrays in TEXT, booleans as
INTEGER 0/1, ISO 8601 UTC timestamps, lower-case UUID ids, `STRICT` tables, every statement idempotent
(`IF NOT EXISTS`), every table append-only (`BEFORE UPDATE` aborts) with the session-deletion guard on
`BEFORE DELETE` (as `risk_run`). No existing table changes.

Evidence and Assessment stay separate (III.1): `spec_lookup`, `spec_source` and `spec_document` are
Evidence; `spec_alignment_run`, `spec_alignment_row` and `spec_alignment_item` are Assessment and
reference the documents they rest on (FR-017). No Disposition record is added (FR-4.7 is out of scope).
Every assessment statement is Inferred; "Inferred" is a constant of the UI, not a column. Nothing here
can hold "Verified".

## Entities and relationships

```text
pr_snapshot 1──* spec_lookup 1──* spec_source            (where a key's folder was found)
                    │        1──* spec_document ──? spec_source   (full text; one per kind per key)
pr_snapshot 1──* spec_alignment_run ──1 spec_lookup      (the documents the run rests on)
                    │  ?── spec_document (specification), ?── spec_document (tdd-evidence)
                    ├──* spec_alignment_row              (one per acceptance criterion)
                    └──* spec_alignment_item             (verdict items and scope deviations)
```

A lookup is stored on each snapshot, and again on a same-head refresh only when a document's commit or
the set of matching branches changed (R5). Staleness is never stored; it is derived on read (see below).

## `spec_lookup` (one row per search attempt)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `snapshot_id` | TEXT FK `pr_snapshot` ON DELETE CASCADE | |
| `looked_at` | TEXT NOT NULL | |
| `trigger` | TEXT CHECK in `snapshot`, `refresh` | |
| `keys` | TEXT NOT NULL, JSON array of strings | keys from branch, title, description (FR-001); empty means no key |
| `searched` | TEXT NOT NULL, JSON array of `{repository, role, heads}` | `role` is `own` or `enclosing`; `heads` the branch names considered (FR-002, FR-003); shown as "where it looked" |
| `enclosing_note` | TEXT CHECK in `found`, `not-inside-project` | the "not inside a project repository" gap (US4.4) |
| `outcome` | TEXT CHECK in `found`, `partial`, `not-found`, `no-key`, `failed` | `partial` = a specification without evidence, or evidence for only some keys |
| `reason` | TEXT | iff outcome is not `found`; for `failed`, the first git error line (V.4) |
| CHECK | | `outcome = 'no-key' ⇔ json_array_length(keys) = 0`; `(outcome = 'found') = (reason IS NULL)` |
| Index | | `spec_lookup_by_snapshot (snapshot_id, looked_at)` |

## `spec_source` (where one key's documents were found)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `lookup_id` | TEXT FK `spec_lookup` CASCADE | |
| `key` | TEXT NOT NULL | the Jira key as written in the PR; documents are grouped by it (edge case) |
| `repository` | TEXT NOT NULL | id of the repository read |
| `branch` | TEXT NOT NULL | the branch the folder was read from |
| `commit_sha` | TEXT NOT NULL | the last commit touching the folder |
| `folder` | TEXT NOT NULL | `specs/<name>` |
| `rule_used` | TEXT CHECK in `matching-branch`, `develop`, `most-recent-commit`, `only-match` | the precedence step that chose it (R4), shown in the panel |
| `other_copies` | TEXT NOT NULL, JSON array of `{repository, branch, commit_sha, folder}` | every other match, so the panel can list them (FR-004, US4.6) |
| `develop_copy_exists` | INTEGER 0/1 | FR-004: the other copy is on `develop` |
| `matches_key` | INTEGER NOT NULL CHECK 1 | name matched the whole key, case-insensitively, boundary rule R3 |
| Index | | `spec_source_by_lookup (lookup_id, key)` |

A source may be used by the specification document and not the evidence, or the reverse, because each
document picks its own best place (FR-005). Both documents then point to different `spec_source` rows.

## `spec_document` (the text as read; Evidence, never edited)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `lookup_id` | TEXT FK `spec_lookup` CASCADE | |
| `key` | TEXT NOT NULL | |
| `kind` | TEXT CHECK in `specification`, `tdd-evidence` | |
| `status` | TEXT CHECK in `found`, `missing` | `stale` is derived, not stored |
| `source_id` | TEXT FK `spec_source`, NULL when missing | |
| `file_path` | TEXT | the file read, e.g. `specs/ENG-1213-x/spec.md` |
| `commit_sha` | TEXT | the last commit touching the file; the value re-checked on refresh |
| `content` | TEXT | full text, kept so citations survive a moved or force-pushed branch (R8) |
| `content_sha256` | TEXT | |
| `other_files` | TEXT NOT NULL, JSON array of paths | other files ending in `spec.md` in the folder; the one used is `file_path` (edge case) |
| `missing_reason` | TEXT | iff missing: `no key`, `no clone`, `no folder`, `no evidence file`, `read failed: <first git error line>` |
| `UNIQUE (lookup_id, key, kind)` | | |
| CHECK | | `status = 'found'` requires `source_id`, `file_path`, `commit_sha`, `content`, `content_sha256` all NOT NULL and `missing_reason` NULL; `status = 'missing'` requires `content`, `commit_sha`, `source_id` NULL and `missing_reason` NOT NULL (FR-010: no assumed content) |
| CHECK | | `kind = 'specification'` file name ends in `spec.md`; `kind = 'tdd-evidence'` file name is `tdd-evidence.md` |

Size: the full text is stored. Prompt limits cut only what is sent to the AI, recorded on the run as
`left_out`. The full text stays viewable, read-only (FR-008).

## `spec_alignment_run` (one row per AI attempt, written when it ends)

As `risk_run`, the row is written once the run ends because the store is append-only; queued and running
state lives in the `alignment` lane (see State transitions).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `snapshot_id` | TEXT FK `pr_snapshot` CASCADE | the head the run was made against (FR-016) |
| `lookup_id` | TEXT FK `spec_lookup` CASCADE | the documents it rests on |
| `spec_document_id` | TEXT NOT NULL FK `spec_document` CASCADE | a run needs a found specification (FR-015) |
| `tdd_document_id` | TEXT FK `spec_document` CASCADE | NULL when evidence is missing; then every row's `test_shown` is `no-evidence-available` |
| `requested_at`, `finished_at` | TEXT NOT NULL | |
| `provider` | TEXT NOT NULL CHECK `<> ''` | III.4 |
| `context_version` | TEXT | `<headCommit>:<sha256>` as for risk runs; NULL when nothing was sent |
| `outcome` | TEXT CHECK in `completed`, `cancelled`, `failed` | |
| `cancel_reason` | TEXT CHECK in `user`, `restart`, `superseded` | iff cancelled |
| `failure_reason` | TEXT | iff failed: provider unavailable, unreadable output, no workspace |
| `spec_summary`, `tdd_summary` | TEXT | AI summaries (FR-008); NULL unless completed; `tdd_summary` NULL when no evidence |
| `verdict` | TEXT CHECK in `sufficient`, `incomplete`, `cannot-judge` | iff completed; `cannot-judge` when evidence is missing (FR-015); labelled Inferred, never feeds readiness (II.2) |
| `verdict_text` | TEXT | the verdict in plain words; NULL unless completed |
| `left_out` | TEXT NOT NULL, JSON array of `{document, part, reason}` | parts cut for size; `reason` is `prompt limit` |
| `restrictions_not_enforced` | TEXT NOT NULL, JSON array | same meaning as `summary` |
| `warning` | TEXT | set when output was unparseable and kept as one Inference (I.3) |
| CHECK | | the outcome-specific columns above hold exactly when their outcome applies |
| Index | | `spec_alignment_run_by_snapshot (snapshot_id, finished_at)` |

Both document references must point at `status = 'found'` rows of the stated `lookup_id` with the
matching `kind`; SQLite cannot check this with a CHECK, so `review-store.ts` verifies it in the insert
transaction. No coverage figure is stored (V.2, FR-015): counts shown in the UI are counted from rows.

## `spec_alignment_row` (one per acceptance criterion; Assessment)

| Column | Type | Notes |
|---|---|---|
| `run_id` | TEXT FK `spec_alignment_run` CASCADE | |
| `ordinal` | INTEGER ≥ 0 | specification order; `PRIMARY KEY (run_id, ordinal)` |
| `criterion_ref` | TEXT | the identifier in the specification (e.g. `FR-003`), NULL if it has none |
| `criterion_text` | TEXT NOT NULL CHECK `trim(...) <> ''` | the criterion's wording |
| `implementation_state` | TEXT CHECK in `implementation-and-test`, `implementation`, `requires-verification`, `not-found` | FR-011; UI labels from `labels.ts` |
| `test_shown` | TEXT CHECK in `shown`, `none`, `no-evidence-available` | `no-evidence-available` is never shown as "no test" (US4.2) |
| `test_mismatch` | INTEGER 0/1 | 1 when a test is named for the criterion but describes different behaviour (US2.3); only with `test_shown = 'shown'` |
| `note` | TEXT NOT NULL | the AI's reason, text only |
| `unverified` | INTEGER 0/1 | 1 when no citation resolved (FR-014) |
| `citations` | TEXT NOT NULL, JSON array | see Citations |
| CHECK | | `implementation_state = 'implementation-and-test'` requires `test_shown = 'shown'`; `test_mismatch = 0 OR test_shown = 'shown'` |

Only a completed run has rows. A criterion the model did not return gets no row and is shown as "AI gave
no opinion", as for risk items.

## `spec_alignment_item` (verdict findings and scope deviations; Assessment)

| Column | Type | Notes |
|---|---|---|
| `run_id` | TEXT FK `spec_alignment_run` CASCADE | |
| `ordinal` | INTEGER ≥ 0 | `PRIMARY KEY (run_id, ordinal)` |
| `kind` | TEXT CHECK in `uncovered-criterion`, `test-may-not-test-right-thing`, `implemented-not-requested`, `requested-not-implemented` | the first two are the verdict's lists (FR-012); the last two are the deviations (FR-013) |
| `row_ordinal` | INTEGER | the `spec_alignment_row` it concerns, for the first two kinds and `requested-not-implemented`; NULL for `implemented-not-requested` |
| `text` | TEXT NOT NULL | plain words, text only |
| `unverified` | INTEGER 0/1 | as for rows |
| `citations` | TEXT NOT NULL, JSON array | `implemented-not-requested` must cite changed lines; `requested-not-implemented` must cite a specification passage |
| FK | | `(run_id, row_ordinal)` references `spec_alignment_row` |

An empty list is not stored as a row. For a completed run, "none were found" is derived from the absence
of rows of a kind, and the panel says so (US3.3).

## Citations (JSON inside `citations`)

Each citation records where the claim comes from and whether the server found it (I.1, III.3):

- `{kind: "spec" | "tdd", document_id, quote, startLine, endLine, resolved}`: resolved by quoted passage or
  line range against the stored `content` (R7).
- `{kind: "code", path, side, startLine, endLine, resolved}`: `side` is `head` or `base`; resolved against
  the snapshot's changed lines as claims are.

A statement with no resolved citation is stored with `unverified = 1` and shown as lower-confidence
Inference. It is never dropped (V.1, FR-014).

## Derived, never stored

Computed in `src/core/spec-context.ts` from the rows above:

1. **Latest** lookup for a snapshot, and the latest `completed` run for it.
2. **Stale** (FR-016, R5) when any holds: the snapshot is not the session's latest; a found document's
   current commit (re-checked by `ls-remote` and `lastCommitTouching`) differs from its stored `commit_sha`;
   a matching branch now exists that did not when `develop` was used. The reason is returned with the flag.
   Stale documents and runs are never shown as current.
3. **Completeness rows** `specification` and `tdd-evidence` (FR-009): `found`, `missing` or `stale`, with
   the reason, taken from the latest lookup (R9). For several keys, the row is missing if any key's
   document is missing, naming the key.
4. **Ambiguity**: more than one `spec_source` for a key, or more than one `other_files` entry, is returned
   with the choice and its `rule_used`.
5. Counts (criteria, uncovered, flagged) are counted from rows on read; none is stored.

## State transitions

```text
snapshot stored ──► spec_lookup (+ spec_source, spec_document found|missing)   (once, not blocking snapshot creation)
        │                    │
        │                    ├─ no key / no clone / no folder / failed ──► gap only, no run (FR-015, FR-018)
        │                    └─ specification found ──► alignment lane queued ─► running ─► spec_alignment_run
        │                                                    (completed | failed | cancelled)
        │                                                    └─ newer snapshot ─► cancelled, superseded
same-head refresh ──► re-check commits ──► unchanged: nothing written
                                      └─► moved: new spec_lookup + documents + queued run; earlier rows show stale
retry (POST, guarded) ──► new queued run on the latest lookup; earlier run kept
```

Document status: `found` or `missing` when stored. Displayed status: `found`, `missing` or `stale`, derived.

## Recovery

`work-recovery.ts` leaves no `spec_alignment_run` for work interrupted by a restart, because the run is
written when it ends. The snapshot shows "Alignment assessment missing: the workbench was restarted", and
the reviewer can retry. The documents and their summaries from earlier runs remain. A queued job is in
memory only. Fetched refs are under `refs/prwb/<session>/<snapshot>/spec-<n>` and go with the existing
session-ref delete.

## Validation rules (boundary)

- Keys come from the tracker's `extractReferences`; the core holds no key pattern. A name matches a key
  when it contains it case-insensitively with no letter or digit before and no letter or digit after (R3).
- Branches considered: `develop` and heads whose name matches the key. Folders considered: `specs/<name>`
  whose name matches the key. Files: name ending in `spec.md`, and `tdd-evidence.md` (in the folder, else in its `tests/` subfolder).
- Choice per document: repository (own, then enclosing), then matching branch over `develop`, then most
  recent last-touching commit (R4).
- AI output: shape guard, enum values as above, no `verified` value accepted anywhere, extra fields
  refused. Unparseable output becomes one Inference with `warning` set, reusing `textAsInference`.
- Retry body: empty; extra fields refused. `GET` routes never write (X.5).
- Every string from the PR, the documents or the AI is data; the UI renders it as text only. Documents go
  only to the configured provider (X.9) and are passed in the data block, not through the AI's workspace.
