-- Review store schema (data-model.md, research R5, constitution III.2).
--
-- Table names are the snake_case entity names; columns are the snake_case of the
-- data model's camelCase fields, with nested value types flattened
-- (pr.repo.platform -> pr_repo_platform, scope.startLine -> scope_start_line).
-- Lists are JSON arrays in TEXT columns; booleans are INTEGER 0 or 1; timestamps
-- are ISO 8601 UTC text; identifiers are lower-case UUID text.
--
-- Every statement is idempotent (IF NOT EXISTS), so applying the file to an
-- existing database changes nothing. The connection must run with
-- PRAGMA foreign_keys = ON (set by db.ts) for the cascades to apply.
--
-- Append-only: every table except session_status has a BEFORE UPDATE trigger
-- that always aborts, and a BEFORE DELETE trigger that aborts unless a
-- session_deletion marker exists for the row's session. deleteSession inserts
-- the marker, deletes the review_session row (ON DELETE CASCADE removes
-- everything under it), and removes the marker, in one transaction.
--
-- SQLite runs a cascade after the parent row is gone, so a child's walk up to its
-- session can find no ancestor. That happens only inside a cascade (foreign keys
-- forbid orphans), and a cascade starts only from an allowed delete, so a delete
-- whose session cannot be resolved is allowed while some marker exists:
--   NOT EXISTS (SELECT 1 FROM session_deletion d
--               WHERE d.session_id = IFNULL(<row's session>, d.session_id))
-- With no marker at all, every history delete aborts.

-- ---------------------------------------------------------------------------
-- Deletion marker (not history; no triggers, no foreign key, so a cascade can
-- never remove it mid-delete).

CREATE TABLE IF NOT EXISTS session_deletion (
  session_id TEXT PRIMARY KEY NOT NULL
) STRICT;

-- ---------------------------------------------------------------------------
-- Review session

CREATE TABLE IF NOT EXISTS review_session (
  id                 TEXT PRIMARY KEY NOT NULL,
  pr_repo_platform   TEXT NOT NULL,
  pr_repo_identifier TEXT NOT NULL COLLATE NOCASE,
  pr_number          INTEGER NOT NULL CHECK (pr_number > 0),
  created_at         TEXT NOT NULL,
  UNIQUE (pr_repo_platform, pr_repo_identifier, pr_number)
) STRICT;

-- ---------------------------------------------------------------------------
-- Session status: the only mutable row (a cache of the platform's state).

CREATE TABLE IF NOT EXISTS session_status (
  session_id         TEXT PRIMARY KEY NOT NULL
                     REFERENCES review_session (id) ON DELETE CASCADE,
  pr_status          TEXT NOT NULL CHECK (pr_status IN ('open', 'closed', 'merged')),
  status_note        TEXT,
  last_checked_at    TEXT NOT NULL,
  last_checked_head  TEXT,
  last_check_outcome TEXT NOT NULL CHECK (last_check_outcome IN ('ok', 'unreachable')),
  last_check_error   TEXT,
  last_opened_at     TEXT NOT NULL
) STRICT;

-- ---------------------------------------------------------------------------
-- PR snapshot

CREATE TABLE IF NOT EXISTS pr_snapshot (
  id                            TEXT PRIMARY KEY NOT NULL,
  session_id                    TEXT NOT NULL REFERENCES review_session (id) ON DELETE CASCADE,
  seq                           INTEGER NOT NULL CHECK (seq >= 1),
  taken_at                      TEXT NOT NULL,
  head_commit                   TEXT NOT NULL,
  title                         TEXT NOT NULL,
  description                   TEXT NOT NULL,
  author                        TEXT NOT NULL,
  source_branch_repo_platform   TEXT NOT NULL,
  source_branch_repo_identifier TEXT NOT NULL,
  source_branch_name            TEXT NOT NULL,
  target_branch_repo_platform   TEXT NOT NULL,
  target_branch_repo_identifier TEXT NOT NULL,
  target_branch_name            TEXT NOT NULL,
  target_commit                 TEXT,
  base_commit                   TEXT,
  diff_source                   TEXT NOT NULL CHECK (diff_source IN ('local', 'platform')),
  diff_fingerprint              TEXT NOT NULL,
  repository_status             TEXT NOT NULL CHECK (repository_status IN ('found', 'missing')),
  repository_reason             TEXT,
  head_ref                      TEXT,
  target_ref                    TEXT,
  UNIQUE (session_id, seq),
  CHECK ((diff_source = 'local') = (repository_status = 'found')),
  CHECK (repository_status = 'found' OR repository_reason IS NOT NULL),
  CHECK ((diff_source = 'local') = (base_commit IS NOT NULL)),
  CHECK ((diff_source = 'local') = (target_commit IS NOT NULL)),
  CHECK ((diff_source = 'local') = (head_ref IS NOT NULL)),
  CHECK ((diff_source = 'local') = (target_ref IS NOT NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Commit (a keyword, so always quoted)

CREATE TABLE IF NOT EXISTS "commit" (
  snapshot_id  TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL CHECK (ordinal >= 0),
  sha          TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  message      TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, ordinal)
) STRICT;

-- ---------------------------------------------------------------------------
-- Changed file

CREATE TABLE IF NOT EXISTS changed_file (
  snapshot_id     TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL CHECK (ordinal >= 0),
  path            TEXT NOT NULL,
  old_path        TEXT,
  status          TEXT NOT NULL CHECK (status IN ('added', 'modified', 'deleted', 'renamed', 'copied')),
  additions       INTEGER NOT NULL CHECK (additions >= 0),
  deletions       INTEGER NOT NULL CHECK (deletions >= 0),
  binary          INTEGER NOT NULL CHECK (binary IN (0, 1)),
  size_bytes      INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  language        TEXT,
  patch           TEXT,
  excluded_reason TEXT CHECK (excluded_reason IS NULL
                              OR excluded_reason IN ('binary', 'file size', 'changed lines')),
  PRIMARY KEY (snapshot_id, ordinal),
  UNIQUE (snapshot_id, path),
  CHECK ((status IN ('renamed', 'copied')) = (old_path IS NOT NULL)),
  CHECK (binary = 0 OR excluded_reason = 'binary')
) STRICT;

-- ---------------------------------------------------------------------------
-- Issue reference

CREATE TABLE IF NOT EXISTS issue_reference (
  snapshot_id    TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  issue_platform TEXT NOT NULL,
  issue_key      TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('issue', 'pull-request')),
  -- JSON array of {field: 'branch' | 'title' | 'description', text}; at least one.
  origins        TEXT NOT NULL CHECK (json_valid(origins)
                                      AND json_type(origins) = 'array'
                                      AND json_array_length(origins) >= 1),
  PRIMARY KEY (snapshot_id, issue_platform, issue_key)
) STRICT;

-- ---------------------------------------------------------------------------
-- Evidence (one shared model; payload is the kind's JSON object, an Issue for kind 'issue')

CREATE TABLE IF NOT EXISTS evidence (
  id              TEXT PRIMARY KEY NOT NULL,
  session_id      TEXT NOT NULL REFERENCES review_session (id) ON DELETE CASCADE,
  snapshot_id     TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('coverage', 'sonar', 'spec', 'issue', 'lint', 'custom')),
  source_platform TEXT NOT NULL,
  source_key      TEXT NOT NULL,
  captured_at     TEXT NOT NULL,
  "commit"        TEXT NOT NULL,
  commit_bound    INTEGER NOT NULL CHECK (commit_bound IN (0, 1)),
  status          TEXT NOT NULL CHECK (status IN ('current', 'stale', 'missing')),
  reason          TEXT,
  last_good_id    TEXT REFERENCES evidence (id) ON DELETE CASCADE,
  payload         TEXT CHECK (payload IS NULL OR (json_valid(payload) AND json_type(payload) = 'object')),
  CHECK (status = 'current' OR reason IS NOT NULL),
  CHECK ((status = 'current') = (payload IS NOT NULL)),
  CHECK (status = 'stale' OR last_good_id IS NULL)
) STRICT;

-- ---------------------------------------------------------------------------
-- Summary run

CREATE TABLE IF NOT EXISTS summary_run (
  id           TEXT PRIMARY KEY NOT NULL,
  snapshot_id  TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  provider     TEXT NOT NULL CHECK (provider <> '')
) STRICT;

-- ---------------------------------------------------------------------------
-- Question (scope flattened into scope_* columns)

CREATE TABLE IF NOT EXISTS question (
  id                  TEXT PRIMARY KEY NOT NULL,
  session_id          TEXT NOT NULL REFERENCES review_session (id) ON DELETE CASCADE,
  snapshot_id         TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  seq                 INTEGER NOT NULL CHECK (seq >= 1),
  asked_at            TEXT NOT NULL,
  text                TEXT NOT NULL CHECK (trim(text) <> ''),
  category            TEXT NOT NULL CHECK (category IN ('what', 'why', 'how', 'whatif', 'risk', 'requirement')),
  audience            TEXT NOT NULL CHECK (audience IN ('technical', 'business')),
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('pr', 'file', 'range')),
  scope_path          TEXT,
  scope_side          TEXT CHECK (scope_side IS NULL OR scope_side IN ('new', 'old')),
  scope_start_line    INTEGER,
  scope_end_line      INTEGER,
  scope_label         TEXT CHECK (scope_label IS NULL OR length(scope_label) <= 200),
  follows_question_id TEXT REFERENCES question (id) ON DELETE CASCADE,
  origin              TEXT NOT NULL CHECK (origin IN ('typed', 'suggested', 'follow-up')),
  provider            TEXT NOT NULL CHECK (provider <> ''),
  UNIQUE (session_id, seq),
  CHECK ((origin = 'follow-up') = (follows_question_id IS NOT NULL)),
  CHECK ((scope_type = 'pr') = (scope_path IS NULL)),
  CHECK ((scope_type = 'range') = (scope_side IS NOT NULL)),
  CHECK ((scope_type = 'range') = (scope_start_line IS NOT NULL)),
  CHECK ((scope_type = 'range') = (scope_end_line IS NOT NULL)),
  CHECK (scope_type = 'range' OR scope_label IS NULL),
  CHECK (scope_start_line IS NULL OR (scope_start_line >= 1 AND scope_start_line <= scope_end_line))
) STRICT;

-- ---------------------------------------------------------------------------
-- Stored prompt (exactly one owner: a question or a summary run)

CREATE TABLE IF NOT EXISTS stored_prompt (
  id                        TEXT PRIMARY KEY NOT NULL,
  question_id               TEXT UNIQUE REFERENCES question (id) ON DELETE CASCADE,
  summary_run_id            TEXT UNIQUE REFERENCES summary_run (id) ON DELETE CASCADE,
  instructions              TEXT NOT NULL,
  data                      TEXT NOT NULL,
  context_version           TEXT NOT NULL,
  -- JSON array of {path, reason}
  excluded_files            TEXT NOT NULL CHECK (json_valid(excluded_files) AND json_type(excluded_files) = 'array'),
  data_chars                INTEGER NOT NULL CHECK (data_chars >= 0),
  -- JSON array, a subset of 'a', 'b', 'e'
  restrictions_not_enforced TEXT NOT NULL CHECK (json_valid(restrictions_not_enforced)
                                                 AND json_type(restrictions_not_enforced) = 'array'),
  sent_at                   TEXT NOT NULL,
  CHECK ((question_id IS NULL) <> (summary_run_id IS NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Stream chunk (exactly one owner)

CREATE TABLE IF NOT EXISTS stream_chunk (
  question_id    TEXT REFERENCES question (id) ON DELETE CASCADE,
  summary_run_id TEXT REFERENCES summary_run (id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL CHECK (seq >= 0),
  text           TEXT NOT NULL,
  received_at    TEXT NOT NULL,
  UNIQUE (question_id, seq),
  UNIQUE (summary_run_id, seq),
  CHECK ((question_id IS NULL) <> (summary_run_id IS NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Answer (terminal record of a question)

CREATE TABLE IF NOT EXISTS answer (
  id                        TEXT PRIMARY KEY NOT NULL,
  question_id               TEXT NOT NULL UNIQUE REFERENCES question (id) ON DELETE CASCADE,
  outcome                   TEXT NOT NULL CHECK (outcome IN ('completed', 'cancelled', 'failed')),
  cancel_reason             TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('user', 'restart', 'superseded')),
  failure_reason            TEXT,
  warning                   TEXT CHECK (warning IS NULL OR warning IN ('unstructured', 'cancelled')),
  raw_text                  TEXT,
  unsupported_assumptions   TEXT NOT NULL CHECK (json_valid(unsupported_assumptions)
                                                 AND json_type(unsupported_assumptions) = 'array'),
  suggested_follow_ups      TEXT NOT NULL CHECK (json_valid(suggested_follow_ups)
                                                 AND json_type(suggested_follow_ups) = 'array'),
  context_version           TEXT,
  restrictions_not_enforced TEXT NOT NULL CHECK (json_valid(restrictions_not_enforced)
                                                 AND json_type(restrictions_not_enforced) = 'array'),
  finished_at               TEXT NOT NULL,
  CHECK ((outcome = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK ((outcome = 'failed') = (failure_reason IS NOT NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Summary (terminal record of a summary run)

CREATE TABLE IF NOT EXISTS summary (
  id                        TEXT PRIMARY KEY NOT NULL,
  summary_run_id            TEXT NOT NULL UNIQUE REFERENCES summary_run (id) ON DELETE CASCADE,
  outcome                   TEXT NOT NULL CHECK (outcome IN ('completed', 'cancelled', 'failed')),
  cancel_reason             TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('user', 'restart', 'superseded')),
  failure_reason            TEXT,
  warning                   TEXT CHECK (warning IS NULL OR warning IN ('unstructured', 'cancelled')),
  raw_text                  TEXT,
  context_version           TEXT,
  restrictions_not_enforced TEXT NOT NULL CHECK (json_valid(restrictions_not_enforced)
                                                 AND json_type(restrictions_not_enforced) = 'array'),
  finished_at               TEXT NOT NULL,
  CHECK ((outcome = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK ((outcome = 'failed') = (failure_reason IS NOT NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Summary section

CREATE TABLE IF NOT EXISTS summary_section (
  id         TEXT PRIMARY KEY NOT NULL,
  summary_id TEXT NOT NULL REFERENCES summary (id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL CHECK (ordinal >= 0),
  kind       TEXT NOT NULL CHECK (kind IN ('pr', 'file', 'functional', 'technical')),
  path       TEXT,
  UNIQUE (summary_id, ordinal),
  UNIQUE (summary_id, path),
  CHECK ((kind = 'file') = (path IS NOT NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Claim (exactly one owner: an answer or a summary section)

CREATE TABLE IF NOT EXISTS claim (
  id                 TEXT PRIMARY KEY NOT NULL,
  answer_id          TEXT REFERENCES answer (id) ON DELETE CASCADE,
  summary_section_id TEXT REFERENCES summary_section (id) ON DELETE CASCADE,
  ordinal            INTEGER NOT NULL CHECK (ordinal >= 0),
  text               TEXT NOT NULL CHECK (text <> ''),
  proposed_label     TEXT NOT NULL CHECK (proposed_label IN ('evidence', 'inference')),
  label              TEXT NOT NULL CHECK (label IN ('evidence', 'inference')),
  proposed_intent    TEXT CHECK (proposed_intent IS NULL OR proposed_intent IN ('documented', 'inferred')),
  intent             TEXT CHECK (intent IS NULL OR intent IN ('documented', 'inferred')),
  UNIQUE (answer_id, ordinal),
  UNIQUE (summary_section_id, ordinal),
  CHECK ((answer_id IS NULL) <> (summary_section_id IS NULL)),
  CHECK (label = 'inference' OR proposed_label = 'evidence'),
  CHECK ((proposed_intent IS NULL) = (intent IS NULL)),
  CHECK (intent IS NULL OR intent = 'inferred' OR proposed_intent = 'documented')
) STRICT;

-- ---------------------------------------------------------------------------
-- Reference (a keyword, so always quoted)

CREATE TABLE IF NOT EXISTS "reference" (
  claim_id          TEXT NOT NULL REFERENCES claim (id) ON DELETE CASCADE,
  ordinal           INTEGER NOT NULL CHECK (ordinal >= 0),
  kind              TEXT NOT NULL CHECK (kind IN ('code', 'issue', 'pr')),
  path              TEXT,
  side              TEXT CHECK (side IS NULL OR side IN ('head', 'base')),
  start_line        INTEGER,
  end_line          INTEGER,
  "commit"          TEXT,
  issue_platform    TEXT,
  issue_key         TEXT,
  resolved          INTEGER NOT NULL CHECK (resolved IN (0, 1)),
  unresolved_reason TEXT,
  PRIMARY KEY (claim_id, ordinal),
  CHECK (kind = 'code' OR (path IS NULL AND side IS NULL AND start_line IS NULL
                           AND end_line IS NULL AND "commit" IS NULL)),
  CHECK (start_line IS NULL OR (start_line >= 1 AND end_line IS NOT NULL AND start_line <= end_line)),
  CHECK ((kind = 'issue') = (issue_platform IS NOT NULL)),
  CHECK ((issue_platform IS NULL) = (issue_key IS NULL)),
  CHECK ((resolved = 0) = (unresolved_reason IS NOT NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Indexes for foreign keys not led by a unique key, and for "latest record" reads.

CREATE INDEX IF NOT EXISTS evidence_by_source
  ON evidence (session_id, source_platform, source_key, captured_at);
CREATE INDEX IF NOT EXISTS evidence_by_snapshot ON evidence (snapshot_id);
CREATE INDEX IF NOT EXISTS evidence_by_last_good ON evidence (last_good_id);
CREATE INDEX IF NOT EXISTS summary_run_by_snapshot ON summary_run (snapshot_id);
CREATE INDEX IF NOT EXISTS question_by_snapshot ON question (snapshot_id);
CREATE INDEX IF NOT EXISTS question_by_parent ON question (follows_question_id);

-- ---------------------------------------------------------------------------
-- Append-only triggers. UPDATE always aborts; DELETE aborts unless a marker
-- exists for the row's session (see the header for the cascade case).

-- review_session
CREATE TRIGGER IF NOT EXISTS review_session_no_update BEFORE UPDATE ON review_session
BEGIN SELECT RAISE(ABORT, 'review_session is append-only'); END;
CREATE TRIGGER IF NOT EXISTS review_session_no_delete BEFORE DELETE ON review_session
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'review_session is deleted only with its whole session'); END;

-- pr_snapshot
CREATE TRIGGER IF NOT EXISTS pr_snapshot_no_update BEFORE UPDATE ON pr_snapshot
BEGIN SELECT RAISE(ABORT, 'pr_snapshot is append-only'); END;
CREATE TRIGGER IF NOT EXISTS pr_snapshot_no_delete BEFORE DELETE ON pr_snapshot
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = OLD.session_id)
BEGIN SELECT RAISE(ABORT, 'pr_snapshot is deleted only with its whole session'); END;

-- commit
CREATE TRIGGER IF NOT EXISTS commit_no_update BEFORE UPDATE ON "commit"
BEGIN SELECT RAISE(ABORT, 'commit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS commit_no_delete BEFORE DELETE ON "commit"
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'commit is deleted only with its whole session'); END;

-- changed_file
CREATE TRIGGER IF NOT EXISTS changed_file_no_update BEFORE UPDATE ON changed_file
BEGIN SELECT RAISE(ABORT, 'changed_file is append-only'); END;
CREATE TRIGGER IF NOT EXISTS changed_file_no_delete BEFORE DELETE ON changed_file
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'changed_file is deleted only with its whole session'); END;

-- issue_reference
CREATE TRIGGER IF NOT EXISTS issue_reference_no_update BEFORE UPDATE ON issue_reference
BEGIN SELECT RAISE(ABORT, 'issue_reference is append-only'); END;
CREATE TRIGGER IF NOT EXISTS issue_reference_no_delete BEFORE DELETE ON issue_reference
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'issue_reference is deleted only with its whole session'); END;

-- evidence
CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = OLD.session_id)
BEGIN SELECT RAISE(ABORT, 'evidence is deleted only with its whole session'); END;

-- summary_run
CREATE TRIGGER IF NOT EXISTS summary_run_no_update BEFORE UPDATE ON summary_run
BEGIN SELECT RAISE(ABORT, 'summary_run is append-only'); END;
CREATE TRIGGER IF NOT EXISTS summary_run_no_delete BEFORE DELETE ON summary_run
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'summary_run is deleted only with its whole session'); END;

-- question
CREATE TRIGGER IF NOT EXISTS question_no_update BEFORE UPDATE ON question
BEGIN SELECT RAISE(ABORT, 'question is append-only'); END;
CREATE TRIGGER IF NOT EXISTS question_no_delete BEFORE DELETE ON question
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = OLD.session_id)
BEGIN SELECT RAISE(ABORT, 'question is deleted only with its whole session'); END;

-- stored_prompt
CREATE TRIGGER IF NOT EXISTS stored_prompt_no_update BEFORE UPDATE ON stored_prompt
BEGIN SELECT RAISE(ABORT, 'stored_prompt is append-only'); END;
CREATE TRIGGER IF NOT EXISTS stored_prompt_no_delete BEFORE DELETE ON stored_prompt
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  COALESCE(
    (SELECT q.session_id FROM question q WHERE q.id = OLD.question_id),
    (SELECT s.session_id FROM summary_run r JOIN pr_snapshot s ON s.id = r.snapshot_id
      WHERE r.id = OLD.summary_run_id)),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'stored_prompt is deleted only with its whole session'); END;

-- stream_chunk
CREATE TRIGGER IF NOT EXISTS stream_chunk_no_update BEFORE UPDATE ON stream_chunk
BEGIN SELECT RAISE(ABORT, 'stream_chunk is append-only'); END;
CREATE TRIGGER IF NOT EXISTS stream_chunk_no_delete BEFORE DELETE ON stream_chunk
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  COALESCE(
    (SELECT q.session_id FROM question q WHERE q.id = OLD.question_id),
    (SELECT s.session_id FROM summary_run r JOIN pr_snapshot s ON s.id = r.snapshot_id
      WHERE r.id = OLD.summary_run_id)),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'stream_chunk is deleted only with its whole session'); END;

-- answer
CREATE TRIGGER IF NOT EXISTS answer_no_update BEFORE UPDATE ON answer
BEGIN SELECT RAISE(ABORT, 'answer is append-only'); END;
CREATE TRIGGER IF NOT EXISTS answer_no_delete BEFORE DELETE ON answer
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT q.session_id FROM question q WHERE q.id = OLD.question_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'answer is deleted only with its whole session'); END;

-- summary
CREATE TRIGGER IF NOT EXISTS summary_no_update BEFORE UPDATE ON summary
BEGIN SELECT RAISE(ABORT, 'summary is append-only'); END;
CREATE TRIGGER IF NOT EXISTS summary_no_delete BEFORE DELETE ON summary
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM summary_run r JOIN pr_snapshot s ON s.id = r.snapshot_id
    WHERE r.id = OLD.summary_run_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'summary is deleted only with its whole session'); END;

-- summary_section
CREATE TRIGGER IF NOT EXISTS summary_section_no_update BEFORE UPDATE ON summary_section
BEGIN SELECT RAISE(ABORT, 'summary_section is append-only'); END;
CREATE TRIGGER IF NOT EXISTS summary_section_no_delete BEFORE DELETE ON summary_section
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM summary su
     JOIN summary_run r ON r.id = su.summary_run_id
     JOIN pr_snapshot s ON s.id = r.snapshot_id
    WHERE su.id = OLD.summary_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'summary_section is deleted only with its whole session'); END;

-- claim
CREATE TRIGGER IF NOT EXISTS claim_no_update BEFORE UPDATE ON claim
BEGIN SELECT RAISE(ABORT, 'claim is append-only'); END;
CREATE TRIGGER IF NOT EXISTS claim_no_delete BEFORE DELETE ON claim
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  COALESCE(
    (SELECT q.session_id FROM answer a JOIN question q ON q.id = a.question_id
      WHERE a.id = OLD.answer_id),
    (SELECT s.session_id FROM summary_section ss
       JOIN summary su ON su.id = ss.summary_id
       JOIN summary_run r ON r.id = su.summary_run_id
       JOIN pr_snapshot s ON s.id = r.snapshot_id
      WHERE ss.id = OLD.summary_section_id)),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'claim is deleted only with its whole session'); END;

-- reference
CREATE TRIGGER IF NOT EXISTS reference_no_update BEFORE UPDATE ON "reference"
BEGIN SELECT RAISE(ABORT, 'reference is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reference_no_delete BEFORE DELETE ON "reference"
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  COALESCE(
    (SELECT q.session_id FROM claim c
       JOIN answer a ON a.id = c.answer_id
       JOIN question q ON q.id = a.question_id
      WHERE c.id = OLD.claim_id),
    (SELECT s.session_id FROM claim c
       JOIN summary_section ss ON ss.id = c.summary_section_id
       JOIN summary su ON su.id = ss.summary_id
       JOIN summary_run r ON r.id = su.summary_run_id
       JOIN pr_snapshot s ON s.id = r.snapshot_id
      WHERE c.id = OLD.claim_id)),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'reference is deleted only with its whole session'); END;

-- ===========================================================================
-- Risk-based review focus (specs/004-risk-review-focus/data-model.md). Six append-only tables: rule results
-- (risk_ruleset, risk_classification, risk_reason), AI results (risk_run, risk_assessment_item) and
-- Dispositions (class_override) are separate kinds. The effective class is derived, never stored. No existing
-- table changes.

CREATE TABLE IF NOT EXISTS risk_ruleset (
  snapshot_id      TEXT PRIMARY KEY NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  ruleset_version  TEXT NOT NULL CHECK (ruleset_version <> ''),
  rule_file_status TEXT NOT NULL CHECK (rule_file_status IN ('absent', 'used', 'partly-ignored', 'ignored')),
  -- JSON array of {entry, reason}; empty when absent or used.
  rule_file_notice TEXT NOT NULL CHECK (json_valid(rule_file_notice) AND json_type(rule_file_notice) = 'array'),
  classified_at    TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS risk_classification (
  id                 TEXT PRIMARY KEY NOT NULL,
  snapshot_id        TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  path               TEXT NOT NULL,
  rule_class         TEXT NOT NULL CHECK (rule_class IN ('low', 'normal', 'elevated', 'critical')),
  mechanical         INTEGER NOT NULL CHECK (mechanical IN (0, 1)),
  -- NULL, or why the file was not fully analysed (binary, file size, changed lines).
  not_fully_analysed TEXT,
  change_fingerprint TEXT NOT NULL,
  UNIQUE (snapshot_id, path),
  CHECK (mechanical = 0 OR rule_class = 'low'),
  CHECK (not_fully_analysed IS NULL OR rule_class <> 'low')
) STRICT;

CREATE TABLE IF NOT EXISTS risk_reason (
  classification_id TEXT NOT NULL REFERENCES risk_classification (id) ON DELETE CASCADE,
  ordinal           INTEGER NOT NULL CHECK (ordinal >= 0),
  -- R-..., X-..., or DEFAULT for the Normal given when no rule matched.
  rule_id           TEXT NOT NULL CHECK (rule_id <> ''),
  rule_class        TEXT NOT NULL CHECK (rule_class IN ('low', 'normal', 'elevated', 'critical')),
  -- 0 only for a sensitive rule recorded as "would have applied, was not" (comment-only).
  applied           INTEGER NOT NULL CHECK (applied IN (0, 1)),
  matched_on        TEXT NOT NULL CHECK (matched_on IN ('path', 'lines', 'path+lines')),
  text              TEXT NOT NULL CHECK (text <> ''),
  -- JSON array of {side, startLine, endLine}; empty for a path-only match.
  lines             TEXT NOT NULL CHECK (json_valid(lines) AND json_type(lines) = 'array'),
  PRIMARY KEY (classification_id, ordinal),
  CHECK ((matched_on = 'path') = (json_array_length(lines) = 0))
) STRICT;

CREATE TABLE IF NOT EXISTS risk_run (
  id                        TEXT PRIMARY KEY NOT NULL,
  snapshot_id               TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  requested_at              TEXT NOT NULL,
  finished_at               TEXT NOT NULL,
  provider                  TEXT NOT NULL CHECK (provider <> ''),
  outcome                   TEXT NOT NULL CHECK (outcome IN ('completed', 'cancelled', 'failed')),
  cancel_reason             TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('user', 'restart', 'superseded')),
  failure_reason            TEXT,
  context_version           TEXT,
  excluded_files            TEXT NOT NULL CHECK (json_valid(excluded_files) AND json_type(excluded_files) = 'array'),
  restrictions_not_enforced TEXT NOT NULL CHECK (json_valid(restrictions_not_enforced) AND json_type(restrictions_not_enforced) = 'array'),
  CHECK ((outcome = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK ((outcome = 'failed') = (failure_reason IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS risk_assessment_item (
  run_id         TEXT NOT NULL REFERENCES risk_run (id) ON DELETE CASCADE,
  path           TEXT NOT NULL,
  -- The model cannot propose low through the output schema.
  proposed_class TEXT NOT NULL CHECK (proposed_class IN ('normal', 'elevated', 'critical')),
  applied        INTEGER NOT NULL CHECK (applied IN (0, 1)),
  ignored_reason TEXT CHECK (ignored_reason IS NULL
                             OR ignored_reason IN ('not-higher', 'no-resolvable-line', 'unknown-file', 'not-assessable')),
  reasons        TEXT NOT NULL CHECK (json_valid(reasons) AND json_type(reasons) = 'array'),
  -- JSON array of {side, startLine, endLine, resolved}.
  lines          TEXT NOT NULL CHECK (json_valid(lines) AND json_type(lines) = 'array'),
  PRIMARY KEY (run_id, path),
  CHECK ((applied = 0) = (ignored_reason IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS class_override (
  id                 TEXT PRIMARY KEY NOT NULL,
  session_id         TEXT NOT NULL REFERENCES review_session (id) ON DELETE CASCADE,
  snapshot_id        TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  path               TEXT NOT NULL,
  class              TEXT NOT NULL CHECK (class IN ('low', 'normal', 'elevated', 'critical')),
  replaced_class     TEXT NOT NULL CHECK (replaced_class IN ('low', 'normal', 'elevated', 'critical')),
  -- The file's rule-or-AI class at save time, before any override; decides whether a name is required.
  calculated_class   TEXT NOT NULL CHECK (calculated_class IN ('low', 'normal', 'elevated', 'critical')),
  reason             TEXT NOT NULL CHECK (trim(reason) <> ''),
  change_fingerprint TEXT NOT NULL,
  reviewer_handle    TEXT,
  reviewer_name      TEXT,
  created_at         TEXT NOT NULL,
  CHECK (class <> replaced_class),
  CHECK ((reviewer_handle IS NULL) = (reviewer_name IS NULL)),
  CHECK (reviewer_handle IS NULL OR (trim(reviewer_handle) <> '' AND trim(reviewer_name) <> '')),
  CHECK ((reviewer_handle IS NOT NULL) = (calculated_class = 'critical' AND class IN ('low', 'normal', 'elevated')))
) STRICT;

CREATE INDEX IF NOT EXISTS risk_classification_by_snapshot ON risk_classification (snapshot_id);
CREATE INDEX IF NOT EXISTS risk_run_by_snapshot ON risk_run (snapshot_id, finished_at);
CREATE INDEX IF NOT EXISTS class_override_by_path ON class_override (session_id, path, created_at);
CREATE INDEX IF NOT EXISTS class_override_by_snapshot ON class_override (snapshot_id);

-- risk_ruleset
CREATE TRIGGER IF NOT EXISTS risk_ruleset_no_update BEFORE UPDATE ON risk_ruleset
BEGIN SELECT RAISE(ABORT, 'risk_ruleset is append-only'); END;
CREATE TRIGGER IF NOT EXISTS risk_ruleset_no_delete BEFORE DELETE ON risk_ruleset
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'risk_ruleset is deleted only with its whole session'); END;

-- risk_classification
CREATE TRIGGER IF NOT EXISTS risk_classification_no_update BEFORE UPDATE ON risk_classification
BEGIN SELECT RAISE(ABORT, 'risk_classification is append-only'); END;
CREATE TRIGGER IF NOT EXISTS risk_classification_no_delete BEFORE DELETE ON risk_classification
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'risk_classification is deleted only with its whole session'); END;

-- risk_reason
CREATE TRIGGER IF NOT EXISTS risk_reason_no_update BEFORE UPDATE ON risk_reason
BEGIN SELECT RAISE(ABORT, 'risk_reason is append-only'); END;
CREATE TRIGGER IF NOT EXISTS risk_reason_no_delete BEFORE DELETE ON risk_reason
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM risk_classification c JOIN pr_snapshot s ON s.id = c.snapshot_id
    WHERE c.id = OLD.classification_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'risk_reason is deleted only with its whole session'); END;

-- risk_run
CREATE TRIGGER IF NOT EXISTS risk_run_no_update BEFORE UPDATE ON risk_run
BEGIN SELECT RAISE(ABORT, 'risk_run is append-only'); END;
CREATE TRIGGER IF NOT EXISTS risk_run_no_delete BEFORE DELETE ON risk_run
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'risk_run is deleted only with its whole session'); END;

-- risk_assessment_item
CREATE TRIGGER IF NOT EXISTS risk_assessment_item_no_update BEFORE UPDATE ON risk_assessment_item
BEGIN SELECT RAISE(ABORT, 'risk_assessment_item is append-only'); END;
CREATE TRIGGER IF NOT EXISTS risk_assessment_item_no_delete BEFORE DELETE ON risk_assessment_item
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM risk_run r JOIN pr_snapshot s ON s.id = r.snapshot_id
    WHERE r.id = OLD.run_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'risk_assessment_item is deleted only with its whole session'); END;

-- class_override
CREATE TRIGGER IF NOT EXISTS class_override_no_update BEFORE UPDATE ON class_override
BEGIN SELECT RAISE(ABORT, 'class_override is append-only'); END;
CREATE TRIGGER IF NOT EXISTS class_override_no_delete BEFORE DELETE ON class_override
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = OLD.session_id)
BEGIN SELECT RAISE(ABORT, 'class_override is deleted only with its whole session'); END;

-- write_record (insert and read only; one row per step of a platform write, rows of one action share intent_id)
CREATE TABLE IF NOT EXISTS write_record (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id     TEXT NOT NULL,
  session_id    TEXT NOT NULL REFERENCES review_session (id) ON DELETE CASCADE,
  state         TEXT NOT NULL CHECK (state IN ('pending', 'posted', 'failed')),
  action        TEXT NOT NULL CHECK (action IN ('comment', 'reply_comment', 'edit_comment', 'delete_comment', 'approve', 'request_changes', 'withdraw_decision')),
  actor         TEXT,
  destination   TEXT NOT NULL,
  head_sha      TEXT NOT NULL,
  body          TEXT,
  platform_id   TEXT,
  error_code    TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL,
  CHECK (state <> 'posted' OR (actor IS NOT NULL AND trim(actor) <> ''))
);
CREATE INDEX IF NOT EXISTS write_record_by_intent ON write_record (intent_id, id);
CREATE INDEX IF NOT EXISTS write_record_by_session ON write_record (session_id, id);
-- Exactly one terminal row per intent.
CREATE UNIQUE INDEX IF NOT EXISTS write_record_one_terminal ON write_record (intent_id) WHERE state IN ('posted', 'failed');
CREATE TRIGGER IF NOT EXISTS write_record_no_update BEFORE UPDATE ON write_record
BEGIN SELECT RAISE(ABORT, 'write_record is append-only'); END;
CREATE TRIGGER IF NOT EXISTS write_record_no_delete BEFORE DELETE ON write_record
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = OLD.session_id)
BEGIN SELECT RAISE(ABORT, 'write_record is deleted only with its whole session'); END;
-- One open (pending without a terminal row) intent per PR: a session is one PR.
CREATE TRIGGER IF NOT EXISTS write_record_one_pending BEFORE INSERT ON write_record
WHEN NEW.state = 'pending' AND EXISTS (
  SELECT 1 FROM write_record p
  WHERE p.session_id = NEW.session_id AND p.state = 'pending' AND p.intent_id <> NEW.intent_id
    AND NOT EXISTS (SELECT 1 FROM write_record t WHERE t.intent_id = p.intent_id AND t.state IN ('posted', 'failed')))
BEGIN SELECT RAISE(ABORT, 'another write is pending for this pull request'); END;

-- Feature 006 (specification context): where a pull request's issue-keyed specification was found
-- (spec_lookup, spec_source, spec_document: Evidence) and the AI's alignment of the change with it
-- (spec_alignment_run, spec_alignment_row, spec_alignment_item: Assessment). Append-only, as risk_run.
-- Staleness is derived on read, never stored. Nothing here can hold "Verified".

CREATE TABLE IF NOT EXISTS spec_lookup (
  id             TEXT PRIMARY KEY NOT NULL,
  snapshot_id    TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  looked_at      TEXT NOT NULL,
  trigger        TEXT NOT NULL CHECK (trigger IN ('snapshot', 'refresh')),
  keys           TEXT NOT NULL CHECK (json_valid(keys) AND json_type(keys) = 'array'),
  -- JSON array of {repository, role, heads}.
  searched       TEXT NOT NULL CHECK (json_valid(searched) AND json_type(searched) = 'array'),
  enclosing_note TEXT CHECK (enclosing_note IS NULL OR enclosing_note IN ('found', 'not-inside-project')),
  outcome        TEXT NOT NULL CHECK (outcome IN ('found', 'partial', 'not-found', 'no-key', 'failed')),
  reason         TEXT,
  CHECK ((outcome = 'no-key') = (json_array_length(keys) = 0)),
  CHECK ((outcome = 'found') = (reason IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS spec_source (
  id                  TEXT PRIMARY KEY NOT NULL,
  lookup_id           TEXT NOT NULL REFERENCES spec_lookup (id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,
  repository          TEXT NOT NULL,
  branch              TEXT NOT NULL,
  commit_sha          TEXT NOT NULL,
  folder              TEXT NOT NULL,
  rule_used           TEXT NOT NULL CHECK (rule_used IN ('own-repository-first', 'matching-branch', 'develop', 'most-recent-commit', 'only-match')),
  -- JSON array of {repository, branch, commit_sha, folder}.
  other_copies        TEXT NOT NULL CHECK (json_valid(other_copies) AND json_type(other_copies) = 'array'),
  develop_copy_exists INTEGER NOT NULL CHECK (develop_copy_exists IN (0, 1)),
  matches_key         INTEGER NOT NULL CHECK (matches_key = 1)
) STRICT;

CREATE TABLE IF NOT EXISTS spec_document (
  id             TEXT PRIMARY KEY NOT NULL,
  lookup_id      TEXT NOT NULL REFERENCES spec_lookup (id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('specification', 'tdd-evidence')),
  status         TEXT NOT NULL CHECK (status IN ('found', 'missing')),
  source_id      TEXT REFERENCES spec_source (id) ON DELETE CASCADE,
  file_path      TEXT,
  commit_sha     TEXT,
  content        TEXT,
  content_sha256 TEXT,
  other_files    TEXT NOT NULL CHECK (json_valid(other_files) AND json_type(other_files) = 'array'),
  missing_reason TEXT,
  UNIQUE (lookup_id, key, kind),
  CHECK (status <> 'found' OR (source_id IS NOT NULL AND file_path IS NOT NULL AND commit_sha IS NOT NULL
                               AND content IS NOT NULL AND content_sha256 IS NOT NULL AND missing_reason IS NULL)),
  CHECK (status <> 'missing' OR (content IS NULL AND commit_sha IS NULL AND source_id IS NULL AND missing_reason IS NOT NULL)),
  CHECK (file_path IS NULL
         OR (kind = 'specification' AND file_path LIKE '%spec.md')
         OR (kind = 'tdd-evidence' AND (file_path = 'tdd-evidence.md' OR file_path LIKE '%/tdd-evidence.md')))
) STRICT;

CREATE TABLE IF NOT EXISTS spec_alignment_run (
  id                        TEXT PRIMARY KEY NOT NULL,
  snapshot_id               TEXT NOT NULL REFERENCES pr_snapshot (id) ON DELETE CASCADE,
  lookup_id                 TEXT NOT NULL REFERENCES spec_lookup (id) ON DELETE CASCADE,
  spec_document_id          TEXT NOT NULL REFERENCES spec_document (id) ON DELETE CASCADE,
  tdd_document_id           TEXT REFERENCES spec_document (id) ON DELETE CASCADE,
  requested_at              TEXT NOT NULL,
  finished_at               TEXT NOT NULL,
  provider                  TEXT NOT NULL CHECK (provider <> ''),
  context_version           TEXT,
  outcome                   TEXT NOT NULL CHECK (outcome IN ('completed', 'cancelled', 'failed')),
  cancel_reason             TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('user', 'restart', 'superseded')),
  failure_reason            TEXT,
  spec_summary              TEXT,
  tdd_summary               TEXT,
  verdict                   TEXT CHECK (verdict IS NULL OR verdict IN ('sufficient', 'incomplete', 'cannot-judge')),
  verdict_text              TEXT,
  left_out                  TEXT NOT NULL CHECK (json_valid(left_out) AND json_type(left_out) = 'array'),
  restrictions_not_enforced TEXT NOT NULL CHECK (json_valid(restrictions_not_enforced) AND json_type(restrictions_not_enforced) = 'array'),
  warning                   TEXT,
  CHECK ((outcome = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK ((outcome = 'failed') = (failure_reason IS NOT NULL)),
  CHECK ((outcome = 'completed') = (verdict IS NOT NULL)),
  CHECK ((outcome = 'completed') = (verdict_text IS NOT NULL)),
  CHECK ((outcome = 'completed') = (spec_summary IS NOT NULL)),
  CHECK (tdd_summary IS NULL OR (outcome = 'completed' AND tdd_document_id IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS spec_alignment_row (
  run_id               TEXT NOT NULL REFERENCES spec_alignment_run (id) ON DELETE CASCADE,
  ordinal              INTEGER NOT NULL CHECK (ordinal >= 0),
  criterion_ref        TEXT,
  criterion_text       TEXT NOT NULL CHECK (trim(criterion_text) <> ''),
  implementation_state TEXT NOT NULL CHECK (implementation_state IN ('implementation-and-test', 'implementation', 'requires-verification', 'not-found')),
  test_shown           TEXT NOT NULL CHECK (test_shown IN ('shown', 'none', 'no-evidence-available')),
  test_mismatch        INTEGER NOT NULL CHECK (test_mismatch IN (0, 1)),
  note                 TEXT NOT NULL,
  unverified           INTEGER NOT NULL CHECK (unverified IN (0, 1)),
  citations            TEXT NOT NULL CHECK (json_valid(citations) AND json_type(citations) = 'array'),
  PRIMARY KEY (run_id, ordinal),
  CHECK (implementation_state <> 'implementation-and-test' OR test_shown = 'shown'),
  CHECK (test_mismatch = 0 OR test_shown = 'shown')
) STRICT;

CREATE TABLE IF NOT EXISTS spec_alignment_item (
  run_id      TEXT NOT NULL REFERENCES spec_alignment_run (id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
  kind        TEXT NOT NULL CHECK (kind IN ('uncovered-criterion', 'test-may-not-test-right-thing', 'implemented-not-requested', 'requested-not-implemented')),
  row_ordinal INTEGER,
  text        TEXT NOT NULL CHECK (trim(text) <> ''),
  unverified  INTEGER NOT NULL CHECK (unverified IN (0, 1)),
  citations   TEXT NOT NULL CHECK (json_valid(citations) AND json_type(citations) = 'array'),
  PRIMARY KEY (run_id, ordinal),
  FOREIGN KEY (run_id, row_ordinal) REFERENCES spec_alignment_row (run_id, ordinal) ON DELETE CASCADE,
  CHECK ((kind = 'implemented-not-requested') = (row_ordinal IS NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS spec_lookup_by_snapshot ON spec_lookup (snapshot_id, looked_at);
CREATE INDEX IF NOT EXISTS spec_source_by_lookup ON spec_source (lookup_id, key);
CREATE INDEX IF NOT EXISTS spec_alignment_run_by_snapshot ON spec_alignment_run (snapshot_id, finished_at);

-- spec_lookup
CREATE TRIGGER IF NOT EXISTS spec_lookup_no_update BEFORE UPDATE ON spec_lookup
BEGIN SELECT RAISE(ABORT, 'spec_lookup is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_lookup_no_delete BEFORE DELETE ON spec_lookup
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'spec_lookup is deleted only with its whole session'); END;

-- spec_source
CREATE TRIGGER IF NOT EXISTS spec_source_no_update BEFORE UPDATE ON spec_source
BEGIN SELECT RAISE(ABORT, 'spec_source is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_source_no_delete BEFORE DELETE ON spec_source
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM spec_lookup l JOIN pr_snapshot s ON s.id = l.snapshot_id WHERE l.id = OLD.lookup_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'spec_source is deleted only with its whole session'); END;

-- spec_document
CREATE TRIGGER IF NOT EXISTS spec_document_no_update BEFORE UPDATE ON spec_document
BEGIN SELECT RAISE(ABORT, 'spec_document is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_document_no_delete BEFORE DELETE ON spec_document
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM spec_lookup l JOIN pr_snapshot s ON s.id = l.snapshot_id WHERE l.id = OLD.lookup_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'spec_document is deleted only with its whole session'); END;

-- spec_alignment_run
CREATE TRIGGER IF NOT EXISTS spec_alignment_run_no_update BEFORE UPDATE ON spec_alignment_run
BEGIN SELECT RAISE(ABORT, 'spec_alignment_run is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_alignment_run_no_delete BEFORE DELETE ON spec_alignment_run
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM pr_snapshot s WHERE s.id = OLD.snapshot_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'spec_alignment_run is deleted only with its whole session'); END;

-- spec_alignment_row
CREATE TRIGGER IF NOT EXISTS spec_alignment_row_no_update BEFORE UPDATE ON spec_alignment_row
BEGIN SELECT RAISE(ABORT, 'spec_alignment_row is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_alignment_row_no_delete BEFORE DELETE ON spec_alignment_row
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM spec_alignment_run r JOIN pr_snapshot s ON s.id = r.snapshot_id WHERE r.id = OLD.run_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'spec_alignment_row is deleted only with its whole session'); END;

-- spec_alignment_item
CREATE TRIGGER IF NOT EXISTS spec_alignment_item_no_update BEFORE UPDATE ON spec_alignment_item
BEGIN SELECT RAISE(ABORT, 'spec_alignment_item is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_alignment_item_no_delete BEFORE DELETE ON spec_alignment_item
WHEN NOT EXISTS (SELECT 1 FROM session_deletion d WHERE d.session_id = IFNULL(
  (SELECT s.session_id FROM spec_alignment_run r JOIN pr_snapshot s ON s.id = r.snapshot_id WHERE r.id = OLD.run_id),
  d.session_id))
BEGIN SELECT RAISE(ABORT, 'spec_alignment_item is deleted only with its whole session'); END;
