// Review-store connection (research R5).
//
// One `node:sqlite` file at `<app-data>/review.db`, with foreign keys on (the
// session cascade depends on it) and WAL. schema.sql is applied once, recorded
// by `PRAGMA user_version`; every statement in it is also idempotent, so an
// existing file keeps its records. Only review-store.ts reads or writes rows.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveAppDataDir } from '../appdata.ts';

/** The schema version this module writes; bump it whenever schema.sql changes (3: write_record, feature 005; 4: spec_* tables, feature 006). */
export const SCHEMA_VERSION = 4;

const SCHEMA_URL = new URL('./schema.sql', import.meta.url);

function readSchema(): string {
  return readFileSync(SCHEMA_URL, 'utf8');
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return Number(row?.user_version ?? 0);
}

function applySchema(db: DatabaseSync): void {
  if (userVersion(db) >= SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Re-checked inside the write lock, in case another connection applied it first.
    if (userVersion(db) < SCHEMA_VERSION) {
      db.exec(readSchema());
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/** Opens (creating when absent) the review store, default `<app-data>/review.db`. */
export function openDatabase(file: string = join(resolveAppDataDir(), 'review.db')): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    applySchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
