// VO-055 (FR-044, III.2): history in the review store is append-only, and only a whole session can be
// deleted, in one transaction.
//
// API required from src/store/db.ts (T039):
//
//   export function openDatabase(file?: string): DatabaseSync;
//     file defaults to `<app-data>/review.db` (resolved by src/appdata.ts); foreign_keys=ON, WAL;
//     applies schema.sql (T026) once, so reopening an existing file keeps its records.
//
// API required from src/store/review-store.ts (T041):
//
//   export function createReviewStore(db: DatabaseSync): ReviewStore;
//
//   ReviewStore methods used here (records use the data-model.md field names, in camelCase; every
//   nullable field is passed explicitly; for "exactly one of" owners only the owner key is passed):
//     appendSession({ id, pr: { repo: { platform, identifier }, number }, createdAt })
//     upsertSessionStatus({ sessionId, prStatus, statusNote, lastCheckedAt, lastCheckedHead,
//                           lastCheckOutcome, lastCheckError, lastOpenedAt })
//     appendSnapshot({ id, sessionId, seq, takenAt, headCommit, title, description, author,
//                      sourceBranch: { repo, name }, targetBranch: { repo, name }, targetCommit, baseCommit,
//                      diffSource, diffFingerprint, repositoryStatus, repositoryReason, headRef, targetRef })
//     appendCommit({ snapshotId, ordinal, sha, authorName, message, committedAt })
//     appendChangedFile({ snapshotId, ordinal, path, oldPath, status, additions, deletions, binary,
//                         sizeBytes, language, patch, excludedReason })
//     appendIssueReference({ snapshotId, issue: { platform, key }, kind, origins: [{ field, text }] })
//     appendEvidence({ id, sessionId, snapshotId, kind, source: { platform, key }, capturedAt, commit,
//                      commitBound, status, reason, lastGoodId,
//                      payload: { platform, key, title, descriptionText, webUrl } | null })
//     appendSummaryRun({ id, snapshotId, requestedAt, provider })
//     appendQuestion({ id, sessionId, snapshotId, seq, askedAt, text, category, audience,
//                      scope: { type, path, side, startLine, endLine, label }, followsQuestionId, origin, provider })
//     appendStoredPrompt({ id, questionId | summaryRunId, instructions, data, contextVersion,
//                          excludedFiles: [{ path, reason }], dataChars, restrictionsNotEnforced, sentAt })
//     appendStreamChunk({ questionId | summaryRunId, seq, text, receivedAt })
//     appendAnswer({ id, questionId, outcome, cancelReason, failureReason, warning, rawText,
//                    unsupportedAssumptions, suggestedFollowUps, contextVersion, restrictionsNotEnforced, finishedAt })
//     appendSummary({ id, summaryRunId, outcome, cancelReason, failureReason, warning, rawText,
//                     contextVersion, restrictionsNotEnforced, finishedAt })
//     appendSummarySection({ id, summaryId, ordinal, kind, path })
//     appendClaim({ id, answerId | summarySectionId, ordinal, text, proposedLabel, label, proposedIntent, intent })
//     appendReference({ claimId, ordinal, kind, path, side, startLine, endLine, commit, issue, resolved,
//                       unresolvedReason })
//     readSession(id) -> { id, pr, createdAt } | null | undefined
//     readSessionStatus(sessionId) -> the status fields above | null | undefined
//     deleteSession(id) -> void (marker row, cascade, marker removed, one transaction)
//   No other method may update or delete. Methods may be sync or async.
//
// Tables (schema.sql, T026): the snake_case entity names of data-model.md, listed in TABLES below.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type * as DbModule from '../../src/store/db.ts';
import type * as ReviewStoreModule from '../../src/store/review-store.ts';
import { useTempAppData, type TempAppData } from '../helpers/app-data.ts';

type Db = typeof DbModule;
type ReviewStoreMod = typeof ReviewStoreModule;
// The store's own types do not exist yet; the test drives it through this loose shape.
type Store = Record<string, (...args: unknown[]) => unknown>;

/** Every append-only table, by the data model's entity names (R5). */
const HISTORY_TABLES = [
  'review_session',
  'pr_snapshot',
  'commit',
  'changed_file',
  'issue_reference',
  'evidence',
  'summary_run',
  'question',
  'stored_prompt',
  'stream_chunk',
  'answer',
  'summary',
  'summary_section',
  'claim',
  'reference',
  // Risk-based review focus (feature 004).
  'risk_ruleset',
  'risk_classification',
  'risk_reason',
  'risk_run',
  'risk_assessment_item',
  'class_override',
] as const;
const STATUS_TABLE = 'session_status';
const MARKER_TABLE = 'session_deletion';
const TABLES = [...HISTORY_TABLES, STATUS_TABLE, MARKER_TABLE];

const REQUIRED_METHODS = [
  'appendSession', 'upsertSessionStatus', 'appendSnapshot', 'appendCommit', 'appendChangedFile',
  'appendIssueReference', 'appendEvidence', 'appendSummaryRun', 'appendQuestion', 'appendStoredPrompt',
  'appendStreamChunk', 'appendAnswer', 'appendSummary', 'appendSummarySection', 'appendClaim',
  'appendReference', 'readSession', 'readSessionStatus', 'deleteSession',
  'appendRiskClassification', 'readRiskClassifications', 'appendRiskRun', 'readLatestCompletedRiskRun',
  'appendClassOverride', 'readOverrideHistory', 'readLatestOverride',
];

const q = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const sha = (c: string): string => c.repeat(40);
const T0 = '2026-11-07T10:00:00.000Z';
const T1 = '2026-11-07T11:00:00.000Z';
const PROVIDER = 'claude-code-cli';

interface Ctx {
  appData: TempAppData;
  dbFile: string;
  db: DatabaseSync;
  store: Store;
  mods: { db: Db; store: ReviewStoreMod };
}

async function loadModules(): Promise<{ db: Db; store: ReviewStoreMod }> {
  const db = (await import('../../src/store/db.ts')) as Db;
  const store = (await import('../../src/store/review-store.ts')) as ReviewStoreMod;
  return { db, store };
}

function close(db: DatabaseSync): void {
  try {
    if (db.isOpen) db.close();
  } catch {
    // already closed
  }
}

async function withStore(t: { after(fn: () => unknown): void }, fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const appData = await useTempAppData(t);
  await mkdir(appData.dir, { recursive: true });
  const mods = await loadModules();
  const dbFile = join(appData.dir, 'review.db');
  const db = (await mods.db.openDatabase(dbFile)) as DatabaseSync;
  try {
    const store = mods.store.createReviewStore(db) as unknown as Store;
    await fn({ appData, dbFile, db, store, mods });
  } finally {
    close(db);
  }
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS n FROM ${q(table)}`).get() as { n: number };
  return Number(row.n);
}

function counts(db: DatabaseSync, tables: readonly string[]): Record<string, number> {
  return Object.fromEntries(tables.map((table) => [table, count(db, table)]));
}

/** Every row of every table, order-independent, for before/after comparison. */
function dump(db: DatabaseSync): Record<string, string[]> {
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${q(table)}`).all().map((row) => JSON.stringify(row)).sort(),
    ]),
  );
}

function firstColumn(db: DatabaseSync, table: string): string {
  const cols = db.prepare(`PRAGMA table_info(${q(table)})`).all() as Array<{ name: string }>;
  const col = cols[0];
  assert.ok(col, `${table} has columns`);
  return col.name;
}

function noOpenTransaction(db: DatabaseSync): void {
  // BEGIN fails inside an open transaction.
  db.exec('BEGIN');
  db.exec('ROLLBACK');
}

interface Populated {
  sessionId: string;
  snapshotId: string;
}

/** One session with a record in every history table (two prompts, chunks, claims and references). */
async function populate(store: Store, prNumber: number): Promise<Populated> {
  const repo = { platform: 'scm-test', identifier: 'owner/repo' };
  const issue = { platform: 'tracker-test', key: `ABC-${prNumber}` };
  const sessionId = randomUUID();
  const snapshotId = randomUUID();
  const head = sha('a');
  const contextVersion = `${head}:${'d'.repeat(64)}`;

  await store.appendSession!({ id: sessionId, pr: { repo, number: prNumber }, createdAt: T0 });
  await store.upsertSessionStatus!({
    sessionId, prStatus: 'open', statusNote: null, lastCheckedAt: T0, lastCheckedHead: head,
    lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: T0,
  });
  await store.appendSnapshot!({
    id: snapshotId, sessionId, seq: 1, takenAt: T0, headCommit: head,
    title: 'Add x', description: 'Implements ABC.', author: 'Ana',
    sourceBranch: { repo, name: `feature/ABC-${prNumber}` }, targetBranch: { repo, name: 'main' },
    targetCommit: sha('b'), baseCommit: sha('c'), diffSource: 'local', diffFingerprint: 'e'.repeat(64),
    repositoryStatus: 'found', repositoryReason: null,
    headRef: `refs/prwb/${sessionId}/${snapshotId}/head`, targetRef: `refs/prwb/${sessionId}/${snapshotId}/target`,
  });
  await store.appendCommit!({ snapshotId, ordinal: 0, sha: head, authorName: 'Ana', message: 'Add x', committedAt: T0 });
  await store.appendChangedFile!({
    snapshotId, ordinal: 0, path: 'src/x.ts', oldPath: null, status: 'modified', additions: 3, deletions: 1,
    binary: false, sizeBytes: 120, language: 'TypeScript', patch: '@@ -1 +1 @@\n-a\n+b\n', excludedReason: null,
  });
  await store.appendIssueReference!({
    snapshotId, issue, kind: 'issue', origins: [{ field: 'branch', text: issue.key }],
  });
  await store.appendEvidence!({
    id: randomUUID(), sessionId, snapshotId, kind: 'issue', source: issue, capturedAt: T0, commit: head,
    commitBound: false, status: 'current', reason: null, lastGoodId: null,
    payload: { ...issue, title: 'Do x', descriptionText: 'Because.', webUrl: `https://tracker.example.test/${issue.key}` },
  });

  // Risk records (feature 004): a rule classification with its reason, an AI run with an item, an override.
  const fingerprint = 'f'.repeat(64);
  await store.appendRiskClassification!({
    ruleset: { snapshotId, rulesetVersion: 'builtin-1', ruleFileStatus: 'absent', ruleFileNotice: [], classifiedAt: T0 },
    files: [
      {
        id: randomUUID(), snapshotId, path: 'src/x.ts', ruleClass: 'elevated', mechanical: false, notFullyAnalysed: null,
        changeFingerprint: fingerprint,
        reasons: [{ ordinal: 0, ruleId: 'R-AUTH', ruleClass: 'elevated', applied: true, matchedOn: 'path', text: 'Matches an authentication path.', lines: [] }],
      },
    ],
  });
  await store.appendRiskRun!({
    id: randomUUID(), snapshotId, requestedAt: T0, finishedAt: T1, provider: PROVIDER, outcome: 'completed',
    cancelReason: null, failureReason: null, contextVersion, excludedFiles: [], restrictionsNotEnforced: [],
    items: [
      { path: 'src/x.ts', proposedClass: 'critical', applied: true, ignoredReason: null, reasons: ['Changes a check'], lines: [{ side: 'head', startLine: 1, endLine: 1, resolved: true }] },
    ],
  });
  await store.appendClassOverride!({
    id: randomUUID(), sessionId, snapshotId, path: 'src/x.ts', class: 'normal', replacedClass: 'elevated', calculatedClass: 'elevated',
    reason: 'Only a rename of a variable.', changeFingerprint: fingerprint, reviewer: null, createdAt: T0,
  });

  // Summary run and its children.
  const summaryRunId = randomUUID();
  const summaryId = randomUUID();
  const sectionId = randomUUID();
  const sectionClaimId = randomUUID();
  await store.appendSummaryRun!({ id: summaryRunId, snapshotId, requestedAt: T0, provider: PROVIDER });
  await store.appendStoredPrompt!({
    id: randomUUID(), summaryRunId, instructions: 'Summarise the change.', data: '<data nonce="n1">x</data>',
    contextVersion, excludedFiles: [{ path: 'big.bin', reason: 'binary' }], dataChars: 27,
    restrictionsNotEnforced: ['a'], sentAt: T0,
  });
  await store.appendStreamChunk!({ summaryRunId, seq: 0, text: 'Adds x', receivedAt: T0 });
  await store.appendSummary!({
    id: summaryId, summaryRunId, outcome: 'completed', cancelReason: null, failureReason: null, warning: null,
    rawText: null, contextVersion, restrictionsNotEnforced: ['a'], finishedAt: T0,
  });
  await store.appendSummarySection!({ id: sectionId, summaryId, ordinal: 0, kind: 'pr', path: null });
  await store.appendClaim!({
    id: sectionClaimId, summarySectionId: sectionId, ordinal: 0, text: 'Adds x for ABC.',
    proposedLabel: 'evidence', label: 'evidence', proposedIntent: 'documented', intent: 'documented',
  });
  await store.appendReference!({
    claimId: sectionClaimId, ordinal: 0, kind: 'issue', path: null, side: null, startLine: null, endLine: null,
    commit: null, issue, resolved: true, unresolvedReason: null,
  });

  // Question and its children.
  const questionId = randomUUID();
  const answerId = randomUUID();
  const answerClaimId = randomUUID();
  await store.appendQuestion!({
    id: questionId, sessionId, snapshotId, seq: 1, askedAt: T0, text: 'Why is x needed?', category: 'why',
    audience: 'technical', scope: { type: 'file', path: 'src/x.ts', side: null, startLine: null, endLine: null, label: null },
    followsQuestionId: null, origin: 'typed', provider: PROVIDER,
  });
  await store.appendStoredPrompt!({
    id: randomUUID(), questionId, instructions: 'Answer the question.', data: '<data nonce="n2">y</data>',
    contextVersion, excludedFiles: [], dataChars: 27, restrictionsNotEnforced: [], sentAt: T0,
  });
  await store.appendStreamChunk!({ questionId, seq: 0, text: 'Because', receivedAt: T0 });
  await store.appendAnswer!({
    id: answerId, questionId, outcome: 'completed', cancelReason: null, failureReason: null, warning: null,
    rawText: null, unsupportedAssumptions: [], suggestedFollowUps: ['What if y?'], contextVersion,
    restrictionsNotEnforced: [], finishedAt: T0,
  });
  await store.appendClaim!({
    id: answerClaimId, answerId, ordinal: 0, text: 'x calls y.', proposedLabel: 'evidence', label: 'evidence',
    proposedIntent: null, intent: null,
  });
  await store.appendReference!({
    claimId: answerClaimId, ordinal: 0, kind: 'code', path: 'src/x.ts', side: 'head', startLine: 1, endLine: 2,
    commit: head, issue: null, resolved: true, unresolvedReason: null,
  });

  return { sessionId, snapshotId };
}

function methodNames(obj: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (key !== 'constructor' && typeof (obj as Record<string, unknown>)[key] === 'function') names.add(key);
    }
  }
  return [...names];
}

const MUTATING_WORDS = new Set([
  'update', 'upsert', 'delete', 'remove', 'edit', 'replace', 'set', 'put', 'patch', 'clear', 'drop',
  'truncate', 'modify', 'change', 'erase', 'purge', 'overwrite',
]);

function words(name: string): string[] {
  return name.split(/(?=[A-Z])|_/).map((w) => w.toLowerCase()).filter(Boolean);
}

test('VO-055 the database opens review.db in the app-data dir with foreign keys on and WAL', async (t) => {
  const appData = await useTempAppData(t);
  await mkdir(appData.dir, { recursive: true });
  const { db: dbMod } = await loadModules();
  const db = (await dbMod.openDatabase()) as DatabaseSync;
  try {
    assert.ok(existsSync(join(appData.dir, 'review.db')), 'review.db is created in the app-data dir');
    const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    assert.equal(Number(fk.foreign_keys), 1);
    const jm = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    assert.equal(jm.journal_mode.toLowerCase(), 'wal');
  } finally {
    close(db);
  }
});

test('VO-055 the schema has every table in the data model', async (t) => {
  await withStore(t, async ({ db }) => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const table of TABLES) assert.ok(names.has(table), `table ${table} exists`);
  });
});

test('VO-055 the schema is applied once: reopening the file keeps every record', async (t) => {
  await withStore(t, async ({ db, dbFile, store, mods }) => {
    const { sessionId } = await populate(store, 1);
    const before = dump(db);
    db.close();
    const reopened = (await mods.db.openDatabase(dbFile)) as DatabaseSync;
    try {
      assert.deepEqual(dump(reopened), before);
      const again = mods.store.createReviewStore(reopened) as unknown as Store;
      const session = (await again.readSession!(sessionId)) as { id: string } | null | undefined;
      assert.equal(session?.id, sessionId);
    } finally {
      close(reopened);
    }
  });
});

test('VO-055 an UPDATE on any history table aborts', async (t) => {
  await withStore(t, async ({ db, store }) => {
    await populate(store, 1);
    const before = dump(db);
    for (const table of HISTORY_TABLES) {
      assert.ok(count(db, table) > 0, `${table} holds a row, so its trigger is exercised`);
      const col = q(firstColumn(db, table));
      assert.throws(() => db.exec(`UPDATE ${q(table)} SET ${col} = ${col}`), Error, `UPDATE ${table} aborts`);
    }
    assert.deepEqual(dump(db), before, 'no record changed');
  });
});

test('VO-055 a DELETE on any history table aborts', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const { sessionId } = await populate(store, 1);
    const before = dump(db);
    for (const table of HISTORY_TABLES) {
      assert.ok(count(db, table) > 0, `${table} holds a row, so its trigger is exercised`);
      assert.throws(() => db.exec(`DELETE FROM ${q(table)}`), Error, `DELETE FROM ${table} aborts`);
    }
    assert.throws(() => db.prepare(`DELETE FROM ${q('review_session')} WHERE id = ?`).run(sessionId), Error);
    assert.deepEqual(dump(db), before, 'no record removed');
  });
});

test('VO-055 the session-status row is the only one that updates', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const names = methodNames(store);
    for (const required of REQUIRED_METHODS) assert.ok(names.includes(required), `store has ${required}`);
    for (const name of names) {
      if (name === 'upsertSessionStatus' || name === 'deleteSession') continue;
      const mutating = words(name).filter((w) => MUTATING_WORDS.has(w));
      assert.deepEqual(mutating, [], `${name} must not update or delete`);
    }

    const { sessionId } = await populate(store, 1);
    await store.upsertSessionStatus!({
      sessionId, prStatus: 'merged', statusNote: null, lastCheckedAt: T1, lastCheckedHead: sha('f'),
      lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: T1,
    });
    const status = (await store.readSessionStatus!(sessionId)) as Record<string, unknown> | null | undefined;
    assert.ok(status, 'status is readable');
    assert.equal(status.sessionId, sessionId);
    assert.equal(status.prStatus, 'merged');
    assert.equal(status.lastCheckedHead, sha('f'));
    assert.equal(status.lastCheckedAt, T1);
    assert.equal(status.lastOpenedAt, T1);
    assert.equal(count(db, STATUS_TABLE), 1, 'upsert keeps one status row per session');

    // The status table has no abort trigger, even for code that bypasses the module.
    const col = q(firstColumn(db, STATUS_TABLE));
    assert.doesNotThrow(() => db.exec(`UPDATE ${q(STATUS_TABLE)} SET ${col} = ${col}`));
  });
});

test('VO-055 deleteSession removes the session and every child row, and nothing of another session', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const a = await populate(store, 1);
    const b = await populate(store, 2);
    const before = counts(db, [...HISTORY_TABLES, STATUS_TABLE]);
    for (const table of HISTORY_TABLES) assert.ok(before[table]! > 0, `${table} populated`);

    await store.deleteSession!(a.sessionId);

    const after = counts(db, [...HISTORY_TABLES, STATUS_TABLE]);
    for (const table of [...HISTORY_TABLES, STATUS_TABLE]) {
      assert.equal(after[table], before[table]! / 2, `${table}: only session A's rows were removed`);
    }
    assert.equal((await store.readSession!(a.sessionId)) ?? null, null);
    assert.equal((await store.readSessionStatus!(a.sessionId)) ?? null, null);
    const kept = (await store.readSession!(b.sessionId)) as { id: string } | null | undefined;
    assert.equal(kept?.id, b.sessionId);
    assert.equal(count(db, MARKER_TABLE), 0, 'the deletion marker is removed');

    // With the marker gone, session B's history is protected again.
    const snapshot = dump(db);
    assert.throws(() => db.exec(`DELETE FROM ${q('reference')}`), Error);
    assert.throws(() => db.prepare(`DELETE FROM ${q('review_session')} WHERE id = ?`).run(b.sessionId), Error);
    assert.deepEqual(dump(db), snapshot);
    noOpenTransaction(db);
  });
});

test('VO-055 deleteSession runs in one transaction: a failure part-way removes nothing', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const a = await populate(store, 1);
    await populate(store, 2);
    const before = dump(db);

    // Make the cascade fail at the deepest table, after the marker and the parent rows are in play.
    db.exec(`CREATE TEMP TRIGGER test_induced_failure BEFORE DELETE ON main.${q('reference')}
             BEGIN SELECT RAISE(ABORT, 'induced failure'); END`);
    await assert.rejects(async () => store.deleteSession!(a.sessionId));
    db.exec('DROP TRIGGER temp.test_induced_failure');

    noOpenTransaction(db);
    assert.deepEqual(dump(db), before, 'every record is still there, and no marker is left');
    const session = (await store.readSession!(a.sessionId)) as { id: string } | null | undefined;
    assert.equal(session?.id, a.sessionId);

    // And the same delete succeeds once the failure is gone.
    await store.deleteSession!(a.sessionId);
    assert.equal((await store.readSession!(a.sessionId)) ?? null, null);
    assert.equal(count(db, MARKER_TABLE), 0);
  });
});


test('feature 004: no store method reads overrides by reviewer or across files, and history needs a path', async (t) => {
  await withStore(t, async ({ store }) => {
    const names = methodNames(store);
    for (const name of names) {
      if (!/override/i.test(name)) continue;
      assert.equal(/reviewer|by(?:user|person|author)|all|list|count|total|rank/i.test(name.replace(/^(append|read)/, '')), false, `${name} is per-file`);
    }
    assert.equal((store.readOverrideHistory as unknown as { length: number }).length, 2, 'history takes a session and a path');
    assert.equal((store.readLatestOverride as unknown as { length: number }).length, 2);
  });
});

test('feature 004: an override that lowers a Critical-calculated class needs both reviewer fields; others need neither', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const { sessionId, snapshotId } = await populate(store, 1);
    const base = {
      sessionId, snapshotId, path: 'src/x.ts', replacedClass: 'critical', changeFingerprint: 'f'.repeat(64), createdAt: T1,
      reason: 'Reviewed: only a comment moved.',
    };
    // Critical lowered without a named reviewer, and a reviewer on a class that never needed one: both refused.
    assert.throws(() => store.appendClassOverride!({ ...base, id: randomUUID(), class: 'normal', calculatedClass: 'critical', reviewer: null }), Error);
    assert.throws(() => store.appendClassOverride!({ ...base, id: randomUUID(), class: 'elevated', replacedClass: 'normal', calculatedClass: 'elevated', reviewer: { handle: 'ana', name: 'Ana' } }), Error);
    assert.throws(() => store.appendClassOverride!({ ...base, id: randomUUID(), class: 'normal', calculatedClass: 'critical', reviewer: { handle: 'ana', name: '' } }), Error);
    // A blank reason and an unchanged class are refused too.
    assert.throws(() => store.appendClassOverride!({ ...base, id: randomUUID(), class: 'elevated', calculatedClass: 'elevated', replacedClass: 'normal', reviewer: null, reason: '   ' }), Error);
    assert.throws(() => store.appendClassOverride!({ ...base, id: randomUUID(), class: 'normal', replacedClass: 'normal', calculatedClass: 'normal', reviewer: null }), Error);
    const before = count(db, 'class_override');
    store.appendClassOverride!({ ...base, id: randomUUID(), class: 'normal', calculatedClass: 'critical', reviewer: { handle: 'ana', name: 'Ana Lee' } });
    store.appendClassOverride!({ ...base, id: randomUUID(), class: 'elevated', replacedClass: 'normal', calculatedClass: 'normal', reviewer: null, createdAt: '2026-11-07T12:00:00.000Z' });
    assert.equal(count(db, 'class_override'), before + 2);
    const history = store.readOverrideHistory!(sessionId, 'src/x.ts') as Array<{ reviewer: { handle: string } | null }>;
    assert.equal(history.length, 3, 'oldest first, one session and one file');
    assert.equal(history[1]?.reviewer?.handle, 'ana');
    const latest = store.readLatestOverride!(sessionId, 'src/x.ts') as { class: string };
    assert.equal(latest.class, 'elevated');
    assert.equal(store.readLatestOverride!(sessionId, 'other.ts'), null);
  });
});

// Feature 005 (T011, III.2, FR-015): write_record is the append-only record of platform writes.
//
// API assumed from src/store/review-store.ts (T015, arrives in Wave 3):
//   insertWriteRecord({ intentId, sessionId, state: 'pending' | 'posted' | 'failed', action, actor, destination,
//                       headSha, body, platformId, errorCode, errorMessage, createdAt }) -> void
//     destination is an object (stored as JSON); nullable fields are passed explicitly.
//   listWriteRecords(sessionId, intentId?) -> rows in insert order, same camelCase fields, destination parsed
//   closeAbandonedWrites(sessionId, closedAt) -> number of intents closed
//     writes a `failed` row (errorCode 'abandoned') for every intent of the session that is pending with no terminal row.
// A second `pending` row with the same intentId (read-back after an ambiguous failure) is allowed.

type WriteRow = {
  intentId: string; state: string; action: string; actor: string | null; destination: unknown; headSha: string;
  body: string | null; platformId: string | null; errorCode: string | null; errorMessage: string | null; createdAt: string;
};

async function writeSession(store: Store, n: number): Promise<string> {
  const sessionId = randomUUID();
  await store.appendSession!({ id: sessionId, pr: { repo: { platform: 'scm-test', identifier: 'owner/repo' }, number: n }, createdAt: T0 });
  return sessionId;
}

function writeRow(sessionId: string, intentId: string, state: 'pending' | 'posted' | 'failed', extra: Partial<WriteRow> = {}): Record<string, unknown> {
  return {
    intentId, sessionId, state, action: 'comment', actor: 'ana', destination: { scope: 'pr' }, headSha: sha('a'),
    body: 'Looks fine.', platformId: state === 'posted' ? `c-${intentId}` : null,
    errorCode: state === 'failed' ? 'rejected' : null, errorMessage: state === 'failed' ? 'refused' : null,
    createdAt: T1, ...extra,
  };
}

test('feature 005: write_record exists, the store has insert and read only, and the table refuses update and delete', async (t) => {
  await withStore(t, async ({ db, store }) => {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='write_record'").get(), 'write_record table');
    assert.equal(typeof store.insertWriteRecord, 'function');
    assert.equal(typeof store.listWriteRecords, 'function');
    for (const name of methodNames(store)) {
      if (/write/i.test(name)) assert.ok(!/^(update|delete|remove|set|upsert)/i.test(name), `${name} must not update or delete write records`);
    }
    const sessionId = await writeSession(store, 1);
    await store.insertWriteRecord!(writeRow(sessionId, 'i1', 'pending'));
    await store.insertWriteRecord!(writeRow(sessionId, 'i1', 'posted'));
    const before = dump2(db);
    assert.throws(() => db.exec("UPDATE write_record SET body = 'changed'"), /append-only/);
    assert.throws(() => db.exec('DELETE FROM write_record'), /deleted only with its whole session/);
    assert.deepEqual(dump2(db), before, 'a refused update or delete changes nothing');
  });
});

function dump2(db: DatabaseSync): string[] {
  return db.prepare('SELECT * FROM write_record').all().map((r) => JSON.stringify(r)).sort();
}

test('feature 005: only one pending intent is open per pull request; a new one may open once the first has a result', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const a = await writeSession(store, 1);
    const b = await writeSession(store, 2);
    await store.insertWriteRecord!(writeRow(a, 'i1', 'pending'));
    assert.throws(() => store.insertWriteRecord!(writeRow(a, 'i2', 'pending')), Error, 'second open intent on the same PR');
    await store.insertWriteRecord!(writeRow(b, 'i3', 'pending')); // another PR is independent
    // A read-back row of the same intent is not a second intent.
    await store.insertWriteRecord!(writeRow(a, 'i1', 'pending', { createdAt: '2026-11-07T11:00:01.000Z' }));
    await store.insertWriteRecord!(writeRow(a, 'i1', 'failed'));
    await store.insertWriteRecord!(writeRow(a, 'i2', 'pending'));
    assert.equal((db.prepare("SELECT count(*) AS n FROM write_record WHERE intent_id = 'i2'").get() as { n: number }).n, 1);
  });
});

test('feature 005: one terminal row per intent, and a posted row needs an actor', async (t) => {
  await withStore(t, async ({ store }) => {
    const s = await writeSession(store, 1);
    await store.insertWriteRecord!(writeRow(s, 'i1', 'pending'));
    await store.insertWriteRecord!(writeRow(s, 'i1', 'posted'));
    assert.throws(() => store.insertWriteRecord!(writeRow(s, 'i1', 'failed')), Error, 'a second terminal row');
    assert.throws(() => store.insertWriteRecord!(writeRow(s, 'i1', 'posted')), Error, 'a second terminal row');
    await store.insertWriteRecord!(writeRow(s, 'i2', 'pending'));
    assert.throws(() => store.insertWriteRecord!(writeRow(s, 'i2', 'posted', { actor: null })), Error, 'posted without an actor');
    assert.throws(() => store.insertWriteRecord!(writeRow(s, 'i2', 'posted', { actor: '  ' })), Error, 'posted with a blank actor');
    const rows = (await store.listWriteRecords!(s, 'i1')) as WriteRow[];
    assert.deepEqual(rows.map((r) => r.state), ['pending', 'posted'], 'insert order');
    assert.deepEqual(rows[1]?.destination, { scope: 'pr' });
    assert.equal(rows[1]?.platformId, 'c-i1');
    assert.equal(rows[1]?.body, 'Looks fine.');
  });
});

test('feature 005: an abandoned pending row is closed with a failed row, and stops holding the lock', async (t) => {
  await withStore(t, async ({ store }) => {
    const s = await writeSession(store, 1);
    const other = await writeSession(store, 2);
    await store.insertWriteRecord!(writeRow(s, 'i1', 'pending'));
    await store.insertWriteRecord!(writeRow(other, 'j1', 'pending'));
    await store.insertWriteRecord!(writeRow(s, 'done', 'posted')); // a posted row with no pending row is not abandoned
    assert.equal(await store.closeAbandonedWrites!(s, '2026-11-07T12:00:00.000Z'), 1);
    const rows = (await store.listWriteRecords!(s, 'i1')) as WriteRow[];
    assert.deepEqual(rows.map((r) => r.state), ['pending', 'failed']);
    assert.equal(rows[1]?.errorCode, 'abandoned');
    assert.equal(rows[1]?.createdAt, '2026-11-07T12:00:00.000Z');
    assert.equal(await store.closeAbandonedWrites!(s, '2026-11-07T12:00:01.000Z'), 0, 'nothing left to close');
    assert.equal(((await store.listWriteRecords!(other, 'j1')) as WriteRow[]).length, 1, 'another PR is untouched');
    await store.insertWriteRecord!(writeRow(s, 'i2', 'pending')); // lock is free
  });
});

test('feature 005: deleting a session deletes its write records and no other session\'s', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const a = await writeSession(store, 1);
    const b = await writeSession(store, 2);
    await store.insertWriteRecord!(writeRow(a, 'i1', 'pending'));
    await store.insertWriteRecord!(writeRow(a, 'i1', 'posted'));
    await store.insertWriteRecord!(writeRow(b, 'j1', 'pending'));
    await store.deleteSession!(a);
    assert.equal(count(db, 'write_record'), 1);
    assert.equal(((await store.listWriteRecords!(b)) as WriteRow[]).length, 1);
  });
});

test('feature 005: a database made before write_record gets the table when it is opened', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { openDatabase } = await import('../../src/store/db.ts');
  const dir = mkdtempSync(join(tmpdir(), 'prwb-schema-'));
  try {
    const file = join(dir, 'review.db');
    const old = openDatabase(file);
    old.exec('DROP TABLE write_record');
    old.exec('PRAGMA user_version = 2');
    old.close();
    openDatabase(file).close();
    const check = new DatabaseSync(file, { readOnly: true });
    assert.ok(check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'write_record'").get(), 'write_record exists');
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feature 006: a database made before the specification tables gets them when it is opened', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { openDatabase } = await import('../../src/store/db.ts');
  const tables = ['spec_alignment_item', 'spec_alignment_row', 'spec_alignment_run', 'spec_document', 'spec_source', 'spec_lookup'];
  const dir = mkdtempSync(join(tmpdir(), 'prwb-schema-'));
  try {
    const file = join(dir, 'review.db');
    const old = openDatabase(file);
    for (const table of tables) old.exec(`DROP TABLE ${table}`);
    old.exec('PRAGMA user_version = 3');
    old.close();
    openDatabase(file).close();
    const check = new DatabaseSync(file, { readOnly: true });
    for (const table of tables) {
      assert.ok(check.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table), `${table} exists`);
    }
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------
// T007 (specs/006-spec-context, data-model.md): the six specification tables. Written first (constitution XI):
// the tables (T014) and store methods (T021) arrive in Waves 2 and 3, so these fail until then.
//
// API required from src/store/review-store.ts (T021; records use the data-model.md names in camelCase, every
// nullable field passed explicitly; methods may be sync or async and throw/reject on a refused record):
//   appendSpecLookup({ lookup: { id, snapshotId, lookedAt, trigger, keys, searched, enclosingNote, outcome, reason },
//                      sources: [{ id, key, repository, branch, commitSha, folder, ruleUsed, otherCopies,
//                                  developCopyExists, matchesKey }],
//                      documents: [{ id, key, kind, status, sourceId, filePath, commitSha, content, contentSha256,
//                                    otherFiles, missingReason }] })        one transaction; lookupId is `lookup.id`
//   appendSpecAlignmentRun({ id, snapshotId, lookupId, specDocumentId, tddDocumentId, requestedAt, finishedAt,
//                            provider, contextVersion, outcome, cancelReason, failureReason, specSummary, tddSummary,
//                            verdict, verdictText, leftOut, restrictionsNotEnforced, warning,
//                            rows: [{ ordinal, criterionRef, criterionText, implementationState, testShown,
//                                     testMismatch, note, unverified, citations }],
//                            items: [{ ordinal, kind, rowOrdinal, text, unverified, citations }] })
//   JSON columns (keys, searched, otherCopies, otherFiles, leftOut, restrictionsNotEnforced, citations) are passed
//   as arrays/objects; booleans as booleans. No method updates or deletes.
// ---------------------------------------------------------------------------------------------------------

const SPEC_TABLES = ['spec_lookup', 'spec_source', 'spec_document', 'spec_alignment_run', 'spec_alignment_row', 'spec_alignment_item'] as const;
const SPEC_METHODS = ['appendSpecLookup', 'appendSpecAlignmentRun'];
type Rec = Record<string, unknown>;

interface SpecIds {
  sessionId: string;
  snapshotId: string;
  lookupId: string;
  sourceId: string;
  specDocumentId: string;
  tddDocumentId: string;
  runId: string;
}

function specLookup(snapshotId: string, over: Rec = {}, parts: { sources?: Rec[]; documents?: Rec[] } = {}): { lookup: Rec; sources: Rec[]; documents: Rec[]; ids: Omit<SpecIds, 'sessionId' | 'snapshotId' | 'runId'> } {
  const ids = { lookupId: randomUUID(), sourceId: randomUUID(), specDocumentId: randomUUID(), tddDocumentId: randomUUID() };
  const file = 'specs/006-ENG-1213-x';
  return {
    ids,
    lookup: {
      id: ids.lookupId, snapshotId, lookedAt: T0, trigger: 'snapshot', keys: ['ENG-1213'],
      searched: [{ repository: 'project-hd-v3', role: 'enclosing', heads: ['develop'] }],
      enclosingNote: 'found', outcome: 'found', reason: null, ...over,
    },
    sources: parts.sources ?? [{
      id: ids.sourceId, key: 'ENG-1213', repository: 'project-hd-v3', branch: 'develop', commitSha: sha('1'), folder: file,
      ruleUsed: 'develop', otherCopies: [], developCopyExists: false, matchesKey: true,
    }],
    documents: parts.documents ?? [
      {
        id: ids.specDocumentId, key: 'ENG-1213', kind: 'specification', status: 'found', sourceId: ids.sourceId,
        filePath: `${file}/spec.md`, commitSha: sha('1'), content: '# Spec\n- FR-001 Do x.\n', contentSha256: 'a'.repeat(64),
        otherFiles: [], missingReason: null,
      },
      {
        id: ids.tddDocumentId, key: 'ENG-1213', kind: 'tdd-evidence', status: 'found', sourceId: ids.sourceId,
        filePath: `${file}/tdd-evidence.md`, commitSha: sha('1'), content: '# Evidence\n- FR-001 test passes.\n', contentSha256: 'b'.repeat(64),
        otherFiles: [], missingReason: null,
      },
    ],
  };
}

const withDoc = (doc: Rec, over: Rec): Rec => ({ ...doc, ...over });

function specRun(ids: Pick<SpecIds, 'snapshotId' | 'lookupId' | 'specDocumentId' | 'tddDocumentId'>, over: Rec = {}): Rec {
  return {
    id: randomUUID(), snapshotId: ids.snapshotId, lookupId: ids.lookupId, specDocumentId: ids.specDocumentId,
    tddDocumentId: ids.tddDocumentId, requestedAt: T0, finishedAt: T1, provider: PROVIDER,
    contextVersion: `${sha('a')}:${'d'.repeat(64)}`, outcome: 'completed', cancelReason: null, failureReason: null,
    specSummary: 'It asks for x.', tddSummary: 'One test.', verdict: 'incomplete', verdictText: 'One criterion has no test.',
    leftOut: [], restrictionsNotEnforced: [], warning: null,
    rows: [
      {
        ordinal: 0, criterionRef: 'FR-001', criterionText: 'Do x.', implementationState: 'implementation-and-test', testShown: 'shown',
        testMismatch: false, note: 'Done in src/x.ts.', unverified: false,
        citations: [{ kind: 'spec', document_id: ids.specDocumentId, quote: 'Do x.', startLine: 2, endLine: 2, resolved: true }],
      },
      {
        ordinal: 1, criterionRef: null, criterionText: 'Do y.', implementationState: 'implementation', testShown: 'none',
        testMismatch: false, note: 'No test names it.', unverified: true, citations: [],
      },
    ],
    items: [
      { ordinal: 0, kind: 'uncovered-criterion', rowOrdinal: 1, text: 'Do y has no test.', unverified: true, citations: [] },
      { ordinal: 1, kind: 'implemented-not-requested', rowOrdinal: null, text: 'Adds a cache.', unverified: false, citations: [{ kind: 'code', path: 'src/x.ts', side: 'head', startLine: 1, endLine: 2, resolved: true }] },
    ],
    ...over,
  };
}

/** A session with one snapshot and a stored lookup (two found documents), plus a completed run. */
async function populateSpec(store: Store, prNumber: number): Promise<SpecIds> {
  const { sessionId, snapshotId } = await populate(store, prNumber);
  const l = specLookup(snapshotId);
  await store.appendSpecLookup!(l);
  const run = specRun({ snapshotId, ...l.ids });
  await store.appendSpecAlignmentRun!(run);
  return { sessionId, snapshotId, ...l.ids, runId: run['id'] as string };
}

async function refused(what: string, fn: () => unknown): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert.ok(threw, `${what} is refused`);
}

test('feature 006: the store has the specification tables and methods, insert and read only', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    for (const table of SPEC_TABLES) assert.ok(names.has(table), `table ${table} exists`);
    for (const method of SPEC_METHODS) assert.equal(typeof store[method], 'function', `store.${method}`);
    for (const name of methodNames(store)) {
      if (!/spec/i.test(name)) continue;
      assert.ok(!words(name).some((w) => MUTATING_WORDS.has(w)), `${name} does not update or delete`);
    }
  });
});

test('feature 006: an UPDATE or a DELETE on any specification table aborts, and nothing changes', async (t) => {
  await withStore(t, async ({ db, store }) => {
    await populateSpec(store, 1);
    const before = Object.fromEntries(SPEC_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${q(table)}`).all().map((r) => JSON.stringify(r)).sort()]));
    for (const table of SPEC_TABLES) {
      assert.ok(count(db, table) > 0, `${table} holds a row, so its trigger is exercised`);
      const col = q(firstColumn(db, table));
      assert.throws(() => db.exec(`UPDATE ${q(table)} SET ${col} = ${col}`), Error, `UPDATE ${table} aborts`);
      assert.throws(() => db.exec(`DELETE FROM ${q(table)}`), Error, `DELETE FROM ${table} aborts`);
    }
    const after = Object.fromEntries(SPEC_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${q(table)}`).all().map((r) => JSON.stringify(r)).sort()]));
    assert.deepEqual(after, before);
  });
});

test('feature 006: deleteSession removes the session\'s specification records and no other session\'s', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const a = await populateSpec(store, 1);
    await populateSpec(store, 2);
    const before = counts(db, SPEC_TABLES);
    await store.deleteSession!(a.sessionId);
    const after = counts(db, SPEC_TABLES);
    for (const table of SPEC_TABLES) {
      assert.ok(after[table]! > 0, `${table} keeps the other session's rows`);
      assert.ok(after[table]! < before[table]!, `${table} lost the deleted session's rows`);
    }
    for (const table of ['spec_lookup', 'spec_alignment_run']) {
      const rows = db.prepare(`SELECT count(*) AS n FROM ${q(table)} WHERE snapshot_id = ?`).get(a.snapshotId) as { n: number };
      assert.equal(Number(rows.n), 0, `${table} has nothing for the deleted snapshot`);
    }
    noOpenTransaction(db);
  });
});

test('feature 006: a lookup is stored with its sources and documents, and read back as written', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const ids = await populateSpec(store, 1);
    const lookup = db.prepare('SELECT * FROM spec_lookup WHERE id = ?').get(ids.lookupId) as Rec;
    assert.equal(lookup['outcome'], 'found');
    assert.deepEqual(JSON.parse(lookup['keys'] as string), ['ENG-1213']);
    assert.equal(count(db, 'spec_source'), 1);
    assert.equal(count(db, 'spec_document'), 2);
    const doc = db.prepare('SELECT * FROM spec_document WHERE id = ?').get(ids.specDocumentId) as Rec;
    assert.equal(doc['content'], '# Spec\n- FR-001 Do x.\n', 'the text is stored in full');
    assert.equal(doc['status'], 'found');
    const row = db.prepare('SELECT * FROM spec_alignment_row WHERE run_id = ? AND ordinal = 1').get(ids.runId) as Rec;
    assert.equal(row['criterion_ref'], null);
    assert.equal(row['unverified'], 1);
  });
});

test('feature 006: spec_lookup CHECK rules: no-key iff no keys, and a reason iff not found', async (t) => {
  await withStore(t, async ({ store }) => {
    const { snapshotId } = await populate(store, 1);
    const none = { sources: [] as Rec[], documents: [] as Rec[] };
    await refused('no-key with keys', () => store.appendSpecLookup!(specLookup(snapshotId, { outcome: 'no-key', reason: 'No Jira key.' }, none)));
    await refused('keys with outcome no-key missing', () => store.appendSpecLookup!(specLookup(snapshotId, { keys: [], outcome: 'not-found', reason: 'x' }, none)));
    await refused('found with a reason', () => store.appendSpecLookup!(specLookup(snapshotId, { outcome: 'found', reason: 'why' })));
    await refused('not-found without a reason', () => store.appendSpecLookup!(specLookup(snapshotId, { outcome: 'not-found', reason: null }, none)));
    await refused('an unknown outcome', () => store.appendSpecLookup!(specLookup(snapshotId, { outcome: 'maybe', reason: 'x' }, none)));
    await refused('an unknown trigger', () => store.appendSpecLookup!(specLookup(snapshotId, { trigger: 'timer' })));
    await refused('an unknown enclosing note', () => store.appendSpecLookup!(specLookup(snapshotId, { enclosingNote: 'maybe' })));
    // The allowed shapes are accepted.
    await store.appendSpecLookup!(specLookup(snapshotId, { keys: [], outcome: 'no-key', reason: 'No Jira key on the pull request.', enclosingNote: null }, none));
    await store.appendSpecLookup!(specLookup(snapshotId, { outcome: 'partial', reason: 'No evidence file.', trigger: 'refresh' }));
    await store.appendSpecLookup!(specLookup(snapshotId, { outcome: 'failed', reason: 'fatal: unable to access', enclosingNote: 'not-inside-project' }, none));
  });
});

test('feature 006: spec_source and spec_document CHECK rules', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const { snapshotId } = await populate(store, 1);
    const base = specLookup(snapshotId);
    const [source] = base.sources as [Rec];
    const [spec, tdd] = base.documents as [Rec, Rec];
    const attempt = (sources: Rec[], documents: Rec[]) => store.appendSpecLookup!(specLookup(snapshotId, {}, { sources, documents }));
    const goodSource = (id: string): Rec => ({ ...source, id });

    await refused('a source that does not match the key', async () => {
      const s = goodSource(randomUUID());
      await attempt([{ ...s, matchesKey: false }], []);
    });
    await refused('an unknown rule', async () => attempt([{ ...goodSource(randomUUID()), ruleUsed: 'newest' }], []));

    const sid = randomUUID();
    const found = (over: Rec): Rec => withDoc({ ...spec, id: randomUUID(), sourceId: sid }, over);
    const cases: Array<[string, Rec]> = [
      ['a found document without content', found({ content: null })],
      ['a found document without a commit', found({ commitSha: null })],
      ['a found document without a source', found({ sourceId: null })],
      ['a found document without a file', found({ filePath: null })],
      ['a found document without a digest', found({ contentSha256: null })],
      ['a found document with a missing reason', found({ missingReason: 'no folder' })],
      ['a specification file not ending in spec.md', found({ filePath: 'specs/006-ENG-1213-x/plan.md' })],
      ['an evidence file with another name', { ...tdd, id: randomUUID(), sourceId: sid, filePath: 'specs/006-ENG-1213-x/evidence.md' }],
      ['an unknown kind', found({ kind: 'plan' })],
      ['an unknown status', found({ status: 'stale' })],
      ['a missing document with content (no assumed content)', withDoc(found({}), { status: 'missing', commitSha: null, sourceId: null, missingReason: 'no folder' })],
      ['a missing document without a reason', withDoc(found({}), { status: 'missing', content: null, contentSha256: null, filePath: null, commitSha: null, sourceId: null, missingReason: null })],
      ['a missing document with a commit', withDoc(found({}), { status: 'missing', content: null, contentSha256: null, filePath: null, sourceId: null, missingReason: 'no folder' })],
      ['a missing document with a source', withDoc(found({}), { status: 'missing', content: null, contentSha256: null, filePath: null, commitSha: null, missingReason: 'no folder' })],
    ];
    for (const [what, doc] of cases) await refused(what, () => attempt([goodSource(sid)], [doc]));
    await refused('two documents of one kind for one key', () => attempt([goodSource(sid)], [found({}), found({})]));
    assert.equal(count(db, 'spec_lookup'), 0, 'a refused lookup leaves nothing behind, in any table');
    assert.equal(count(db, 'spec_source') + count(db, 'spec_document'), 0);

    // A missing document is accepted with its reason and no content.
    await attempt([], [{
      id: randomUUID(), key: 'ENG-1213', kind: 'tdd-evidence', status: 'missing', sourceId: null, filePath: null, commitSha: null,
      content: null, contentSha256: null, otherFiles: [], missingReason: 'no evidence file',
    }]);
    assert.equal(count(db, 'spec_document'), 1);
  });
});

test('feature 006: spec_alignment_run outcome-specific columns hold exactly when their outcome applies', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const { snapshotId } = await populate(store, 1);
    const l = specLookup(snapshotId);
    await store.appendSpecLookup!(l);
    const ids = { snapshotId, ...l.ids };
    const noChildren = { rows: [], items: [] };
    const bad: Array<[string, Rec]> = [
      ['an unknown outcome', { outcome: 'done' }],
      ['a completed run with a cancel reason', { cancelReason: 'user' }],
      ['a completed run with a failure reason', { failureReason: 'x' }],
      ['a completed run without a verdict', { verdict: null }],
      ['a completed run without a verdict text', { verdictText: null }],
      ['a completed run without a spec summary', { specSummary: null }],
      ['an unknown verdict', { verdict: 'good' }],
      ['an empty provider', { provider: '' }],
      ['a cancelled run without a cancel reason', { outcome: 'cancelled', verdict: null, verdictText: null, specSummary: null, tddSummary: null, ...noChildren }],
      ['a cancelled run with an unknown reason', { outcome: 'cancelled', cancelReason: 'timeout', verdict: null, verdictText: null, specSummary: null, tddSummary: null, ...noChildren }],
      ['a cancelled run with a verdict', { outcome: 'cancelled', cancelReason: 'superseded', ...noChildren }],
      ['a failed run without a failure reason', { outcome: 'failed', verdict: null, verdictText: null, specSummary: null, tddSummary: null, ...noChildren }],
      ['a failed run with a summary', { outcome: 'failed', failureReason: 'provider unavailable', ...noChildren }],
      ['a failed run with rows', { outcome: 'failed', failureReason: 'provider unavailable', verdict: null, verdictText: null, specSummary: null, tddSummary: null }],
      ['a run with no specification document', { specDocumentId: null }],
    ];
    for (const [what, over] of bad) await refused(what, () => store.appendSpecAlignmentRun!(specRun(ids, over)));
    assert.equal(count(db, 'spec_alignment_run') + count(db, 'spec_alignment_row') + count(db, 'spec_alignment_item'), 0, 'a refused run leaves no rows');

    await store.appendSpecAlignmentRun!(specRun(ids, { outcome: 'cancelled', cancelReason: 'superseded', verdict: null, verdictText: null, specSummary: null, tddSummary: null, contextVersion: null, ...noChildren }));
    await store.appendSpecAlignmentRun!(specRun(ids, { outcome: 'failed', failureReason: 'unreadable output', verdict: null, verdictText: null, specSummary: null, tddSummary: null, ...noChildren }));
    await store.appendSpecAlignmentRun!(specRun(ids, { verdict: 'cannot-judge', tddSummary: null, tddDocumentId: null }));
    assert.equal(count(db, 'spec_alignment_run'), 3, 'earlier runs are kept: a new one adds a record');
  });
});

test('feature 006: a run\'s document references must be found rows of its own lookup, of the right kind', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const { snapshotId } = await populate(store, 1);
    const own = specLookup(snapshotId);
    const other = specLookup(snapshotId, { trigger: 'refresh' });
    const missingEvidence: Rec = {
      id: randomUUID(), key: 'ENG-1213', kind: 'tdd-evidence', status: 'missing', sourceId: null, filePath: null,
      commitSha: null, content: null, contentSha256: null, otherFiles: [], missingReason: 'no evidence file',
    };
    const withMissing = specLookup(snapshotId, { outcome: 'partial', reason: 'No evidence file.' });
    withMissing.documents = [withMissing.documents[0] as Rec, missingEvidence];
    await store.appendSpecLookup!(own);
    await store.appendSpecLookup!(other);
    await store.appendSpecLookup!(withMissing);
    const ids = { snapshotId, ...own.ids };

    await refused('a specification of another lookup', () => store.appendSpecAlignmentRun!(specRun(ids, { specDocumentId: other.ids.specDocumentId })));
    await refused('evidence of another lookup', () => store.appendSpecAlignmentRun!(specRun(ids, { tddDocumentId: other.ids.tddDocumentId })));
    await refused('an unknown specification document', () => store.appendSpecAlignmentRun!(specRun(ids, { specDocumentId: randomUUID() })));
    await refused('the evidence document as the specification', () => store.appendSpecAlignmentRun!(specRun(ids, { specDocumentId: own.ids.tddDocumentId })));
    await refused('the specification as the evidence', () => store.appendSpecAlignmentRun!(specRun(ids, { tddDocumentId: own.ids.specDocumentId })));
    await refused('a missing document as the evidence', () => store.appendSpecAlignmentRun!(specRun({ snapshotId, lookupId: withMissing.ids.lookupId, specDocumentId: withMissing.ids.specDocumentId, tddDocumentId: withMissing.ids.tddDocumentId }, { tddDocumentId: missingEvidence['id'] })));
    await refused('a lookup of another snapshot', async () => {
      const second = await populate(store, 2);
      await store.appendSpecAlignmentRun!(specRun({ ...ids, snapshotId: second.snapshotId }));
    });
    assert.equal(count(db, 'spec_alignment_run'), 0, 'every refusal left the run table empty');

    // Without evidence the reference is null and the run is accepted.
    await store.appendSpecAlignmentRun!(specRun({ snapshotId, lookupId: withMissing.ids.lookupId, specDocumentId: withMissing.ids.specDocumentId, tddDocumentId: null as unknown as string }, {
      tddDocumentId: null, tddSummary: null, verdict: 'cannot-judge',
      rows: [{ ordinal: 0, criterionRef: 'FR-001', criterionText: 'Do x.', implementationState: 'requires-verification', testShown: 'no-evidence-available', testMismatch: false, note: 'No evidence.', unverified: true, citations: [] }],
      items: [],
    }));
    assert.equal(count(db, 'spec_alignment_run'), 1);
  });
});

test('feature 006: spec_alignment_row and spec_alignment_item CHECK rules', async (t) => {
  await withStore(t, async ({ db, store }) => {
    const { snapshotId } = await populate(store, 1);
    const l = specLookup(snapshotId);
    await store.appendSpecLookup!(l);
    const ids = { snapshotId, ...l.ids };
    const row = (over: Rec): Rec => ({
      ordinal: 0, criterionRef: 'FR-001', criterionText: 'Do x.', implementationState: 'implementation', testShown: 'none',
      testMismatch: false, note: 'n', unverified: false, citations: [], ...over,
    });
    const item = (over: Rec): Rec => ({ ordinal: 0, kind: 'requested-not-implemented', rowOrdinal: 0, text: 't', unverified: false, citations: [], ...over });
    const bad: Array<[string, Rec]> = [
      ['implementation-and-test without a test shown', { rows: [row({ implementationState: 'implementation-and-test', testShown: 'none' })], items: [] }],
      ['implementation-and-test with no evidence available', { rows: [row({ implementationState: 'implementation-and-test', testShown: 'no-evidence-available' })], items: [] }],
      ['a mismatch with no test shown', { rows: [row({ testMismatch: true, testShown: 'none' })], items: [] }],
      ['a mismatch with no evidence available', { rows: [row({ testMismatch: true, testShown: 'no-evidence-available' })], items: [] }],
      ['a blank criterion', { rows: [row({ criterionText: '   ' })], items: [] }],
      ['an unknown state', { rows: [row({ implementationState: 'Verified' })], items: [] }],
      ['an unknown test value', { rows: [row({ testShown: 'verified' })], items: [] }],
      ['a negative ordinal', { rows: [row({ ordinal: -1 })], items: [] }],
      ['a repeated row ordinal', { rows: [row({}), row({})], items: [] }],
      ['an item of an unknown kind', { rows: [row({})], items: [item({ kind: 'verified-ok' })] }],
      ['an item pointing at a row that is not there', { rows: [row({})], items: [item({ rowOrdinal: 5 })] }],
      ['a repeated item ordinal', { rows: [row({})], items: [item({}), item({})] }],
    ];
    for (const [what, over] of bad) await refused(what, () => store.appendSpecAlignmentRun!(specRun(ids, over)));
    assert.equal(count(db, 'spec_alignment_run') + count(db, 'spec_alignment_row') + count(db, 'spec_alignment_item'), 0, 'a refused child leaves the whole run out');

    await store.appendSpecAlignmentRun!(specRun(ids, {
      rows: [row({ implementationState: 'implementation-and-test', testShown: 'shown', testMismatch: true }), row({ ordinal: 1, testShown: 'no-evidence-available' })],
      items: [item({ kind: 'test-may-not-test-right-thing', rowOrdinal: 0 }), item({ ordinal: 1, kind: 'implemented-not-requested', rowOrdinal: null })],
    }));
    assert.equal(count(db, 'spec_alignment_row'), 2);
    assert.equal(count(db, 'spec_alignment_item'), 2);
  });
});
