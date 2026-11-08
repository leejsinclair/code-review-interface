// VO-060 (FR-054, research R18): the JSON-lines logger.
//
// First test for VO-060; the full-session half lives in
// test/end-to-end/full-app.test.ts (T111).
//
// Contract this file requires of `src/log.ts` (T023):
//
//   export interface LogEntry {
//     op: string; outcome: string; durationMs: number;
//     sessionId?: string; snapshotId?: string; requestId?: string;
//     errorCode?: string; errorMessage?: string;
//   }
//   export interface Logger {
//     // Appends one JSON line to `<dir>/prwb-YYYY-MM-DD.log` (UTC date of `now()`),
//     // holding `ts` (ISO string of `now()`) plus only the allowed LogEntry fields.
//     // The line is on disk once the returned value settles (sync or Promise).
//     log(entry: LogEntry): void | Promise<void>;
//     // Deletes `prwb-YYYY-MM-DD.log` files dated more than `retentionDays` days
//     // before the UTC date of `now()`; leaves every other file alone.
//     sweep(): Promise<void>;
//   }
//   export function createLogger(options: {
//     dir: string;               // the logs directory; created if missing
//     now?: () => Date;          // default () => new Date()
//     retentionDays?: number;    // default 7
//   }): Logger;
//   // Module-wide secret registry used by every logger's scrubber.
//   export function registerSecret(secret: string): void;
//
// `errorMessage` is scrubbed before writing: every registered secret and any
// `Authorization` header value are replaced.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempAppData } from '../helpers/app-data.ts';
import type { LogEntry } from '../../src/log.ts';

type LogModule = typeof import('../../src/log.ts');

const ALLOWED = new Set([
  'ts',
  'op',
  'outcome',
  'durationMs',
  'sessionId',
  'snapshotId',
  'requestId',
  'errorCode',
  'errorMessage',
]);

const DAY_MS = 86_400_000;
const NOW = new Date('2026-03-10T12:00:00.000Z');

const loadLog = async (): Promise<LogModule> => import('../../src/log.ts');

const dateDaysAgo = (now: Date, days: number): string =>
  new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

const logFileName = (date: string): string => `prwb-${date}.log`;

async function readLines(file: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('VO-060 log writes one JSON line holding only the allowed fields to the daily file', async (t) => {
  const { createLogger } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  const logger = createLogger({ dir, now: () => NOW });

  await logger.log({
    op: 'snapshot.create',
    outcome: 'ok',
    durationMs: 42,
    sessionId: 'session-1',
    snapshotId: 'snapshot-1',
    requestId: 'request-1',
    errorCode: 'unavailable',
    errorMessage: 'platform did not answer',
  });

  const files = await readdir(dir);
  assert.deepEqual(files, [logFileName('2026-03-10')]);
  const lines = await readLines(join(dir, logFileName('2026-03-10')));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    ts: NOW.toISOString(),
    op: 'snapshot.create',
    outcome: 'ok',
    durationMs: 42,
    sessionId: 'session-1',
    snapshotId: 'snapshot-1',
    requestId: 'request-1',
    errorCode: 'unavailable',
    errorMessage: 'platform did not answer',
  });
});

test('VO-060 log drops every field outside the allowlist', async (t) => {
  const { createLogger } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  const logger = createLogger({ dir, now: () => NOW });

  const smuggled: Record<string, unknown> = {
    op: 'question.ask',
    outcome: 'error',
    durationMs: 7,
    requestId: 'request-2',
    diff: 'DIFF-TEXT-+const leaked = 1;',
    prompt: 'PROMPT-TEXT-explain this change',
    answer: 'ANSWER-TEXT-it adds a constant',
    prTitle: 'PR-TITLE-Add leaked constant',
    issueText: 'ISSUE-TEXT-customers need a constant',
    code: 'CODE-TEXT-function f() {}',
    token: 'TOKEN-VALUE-abc',
    url: 'http://127.0.0.1:1234/launch#LAUNCH-TOKEN-xyz',
    headers: { authorization: 'Bearer HEADER-VALUE-123' },
  };
  await logger.log(smuggled as unknown as LogEntry);

  const file = join(dir, logFileName('2026-03-10'));
  const text = await readFile(file, 'utf8');
  for (const marker of [
    'DIFF-TEXT',
    'PROMPT-TEXT',
    'ANSWER-TEXT',
    'PR-TITLE',
    'ISSUE-TEXT',
    'CODE-TEXT',
    'TOKEN-VALUE',
    'LAUNCH-TOKEN',
    'HEADER-VALUE',
  ]) {
    assert.ok(!text.includes(marker), `log file contains ${marker}: ${text}`);
  }
  const lines = await readLines(file);
  assert.equal(lines.length, 1);
  const line = lines[0] ?? {};
  for (const key of Object.keys(line)) {
    assert.ok(ALLOWED.has(key), `log line holds a field outside the allowlist: ${key}`);
  }
  assert.equal(line['op'], 'question.ask');
  assert.equal(line['outcome'], 'error');
  assert.equal(line['durationMs'], 7);
  assert.equal(line['requestId'], 'request-2');
});

test('VO-060 log scrubs registered secrets from errorMessage', async (t) => {
  const { createLogger, registerSecret } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  const logger = createLogger({ dir, now: () => NOW });

  const platformToken = 'pat_REGISTERED-PLATFORM-SECRET-0123456789';
  const launchToken = 'REGISTERED-LAUNCH-TOKEN-q2Vb8xYz41';
  registerSecret(platformToken);
  registerSecret(launchToken);

  await logger.log({
    op: 'adapter.fetch',
    outcome: 'error',
    durationMs: 3,
    errorCode: 'unauthorized',
    errorMessage: `upstream refused ${platformToken}; retried with ${platformToken} and launch ${launchToken}`,
  });

  const file = join(dir, logFileName('2026-03-10'));
  const text = await readFile(file, 'utf8');
  assert.ok(!text.includes(platformToken), `platform token reached the log: ${text}`);
  assert.ok(!text.includes(launchToken), `launch token reached the log: ${text}`);
  const line = (await readLines(file))[0] ?? {};
  const message = String(line['errorMessage']);
  assert.ok(message.includes('upstream refused'), `the rest of the message was kept: ${message}`);
  assert.ok(message.includes('retried with'), `the rest of the message was kept: ${message}`);
  assert.equal(line['errorCode'], 'unauthorized');
});

test('VO-060 log scrubs Authorization values from errorMessage', async (t) => {
  const { createLogger } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  const logger = createLogger({ dir, now: () => NOW });

  const messages = [
    'GET failed: Authorization: Bearer UNREGISTERED-BEARER-VALUE-789',
    'request header authorization: Basic VU5SRUdJU1RFUkVELUJBU0lDLVZBTFVF',
    'sent {"Authorization":"Bearer UNREGISTERED-JSON-VALUE.abc.def"} upstream',
  ];
  for (const errorMessage of messages) {
    await logger.log({ op: 'adapter.fetch', outcome: 'error', durationMs: 1, errorMessage });
  }

  const file = join(dir, logFileName('2026-03-10'));
  const text = await readFile(file, 'utf8');
  for (const value of [
    'UNREGISTERED-BEARER-VALUE-789',
    'VU5SRUdJU1RFUkVELUJBU0lDLVZBTFVF',
    'UNREGISTERED-JSON-VALUE.abc.def',
  ]) {
    assert.ok(!text.includes(value), `Authorization value ${value} reached the log: ${text}`);
  }
  const lines = await readLines(file);
  assert.equal(lines.length, 3);
  assert.ok(String(lines[0]?.['errorMessage']).includes('GET failed'));
  assert.ok(String(lines[1]?.['errorMessage']).includes('request header'));
  assert.ok(String(lines[2]?.['errorMessage']).includes('upstream'));
});

test('VO-060 log starts a new file when the UTC date changes', async (t) => {
  const { createLogger } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  let now = NOW;
  const logger = createLogger({ dir, now: () => now });

  await logger.log({ op: 'day.one', outcome: 'ok', durationMs: 1 });
  now = new Date(NOW.getTime() + DAY_MS);
  await logger.log({ op: 'day.two', outcome: 'ok', durationMs: 1 });

  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, [logFileName('2026-03-10'), logFileName('2026-03-11')]);
  const first = await readLines(join(dir, logFileName('2026-03-10')));
  const second = await readLines(join(dir, logFileName('2026-03-11')));
  assert.deepEqual(first.map((l) => l['op']), ['day.one']);
  assert.deepEqual(second.map((l) => l['op']), ['day.two']);
});

test('VO-060 sweep deletes log files dated 8 days ago and keeps those dated 6 days ago', async (t) => {
  const { createLogger } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  await mkdir(dir, { recursive: true });

  const eightDaysAgo = logFileName(dateDaysAgo(NOW, 8));
  const twentyDaysAgo = logFileName(dateDaysAgo(NOW, 20));
  const sixDaysAgo = logFileName(dateDaysAgo(NOW, 6));
  const today = logFileName(dateDaysAgo(NOW, 0));
  const unrelated = 'notes.txt';
  for (const name of [eightDaysAgo, twentyDaysAgo, sixDaysAgo, today, unrelated]) {
    await writeFile(join(dir, name), '{"op":"old","outcome":"ok","durationMs":1}\n');
  }

  const logger = createLogger({ dir, now: () => NOW });
  await logger.sweep();

  const left = new Set(await readdir(dir));
  assert.ok(!left.has(eightDaysAgo), `${eightDaysAgo} should be deleted`);
  assert.ok(!left.has(twentyDaysAgo), `${twentyDaysAgo} should be deleted`);
  assert.ok(left.has(sixDaysAgo), `${sixDaysAgo} should be kept`);
  assert.ok(left.has(today), `${today} should be kept`);
  assert.ok(left.has(unrelated), 'a file that is not a log file is left alone');
});

test('VO-060 sweep honours a configured retentionDays', async (t) => {
  const { createLogger } = await loadLog();
  const appData = await useTempAppData(t);
  const dir = join(appData.dir, 'logs');
  await mkdir(dir, { recursive: true });

  const eightDaysAgo = logFileName(dateDaysAgo(NOW, 8));
  const twelveDaysAgo = logFileName(dateDaysAgo(NOW, 12));
  for (const name of [eightDaysAgo, twelveDaysAgo]) {
    await writeFile(join(dir, name), '{"op":"old","outcome":"ok","durationMs":1}\n');
  }

  const logger = createLogger({ dir, now: () => NOW, retentionDays: 10 });
  await logger.sweep();

  const left = new Set(await readdir(dir));
  assert.ok(left.has(eightDaysAgo), `${eightDaysAgo} is inside a 10-day retention`);
  assert.ok(!left.has(twelveDaysAgo), `${twelveDaysAgo} is outside a 10-day retention`);
});
