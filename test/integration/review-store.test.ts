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
] as const;
const STATUS_TABLE = 'session_status';
const MARKER_TABLE = 'session_deletion';
const TABLES = [...HISTORY_TABLES, STATUS_TABLE, MARKER_TABLE];

const REQUIRED_METHODS = [
  'appendSession', 'upsertSessionStatus', 'appendSnapshot', 'appendCommit', 'appendChangedFile',
  'appendIssueReference', 'appendEvidence', 'appendSummaryRun', 'appendQuestion', 'appendStoredPrompt',
  'appendStreamChunk', 'appendAnswer', 'appendSummary', 'appendSummarySection', 'appendClaim',
  'appendReference', 'readSession', 'readSessionStatus', 'deleteSession',
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
