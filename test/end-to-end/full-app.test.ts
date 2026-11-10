// VO-041 (FR-029, SC-001) and the full-session halves of VO-040 (FR-028), VO-045 (FR-030) and
// VO-060 (FR-054): the app composed by `src/main.ts`, with known tokens in the fake keyring, the
// recorded-fetch spy as its network and the fake AI CLI, runs one full session: summaries and a
// question. Every child process is seen through the `child_process` diagnostics channel.
//
// The app is started once, by the first test that runs (so a name-filtered run that selects none of
// these starts nothing), then a log file dated 8 days ago is written and the app restarted, so the
// start-up retention sweep has something to delete. The session runs after the restart.

import assert from 'node:assert/strict';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import type { CloneFingerprint } from '../helpers/git-sandbox.ts';
import { startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';
import type { TestResponse } from '../helpers/server.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PLATFORM_TOKENS = ['test-github-token', 'test-jira-token'];
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const QUESTION = 'FULLAPP what does the reset change do?';
const ANSWER_TEXT = 'FULLAPP the values from 40 to 60 are multiplied by ten.';
const ANSWER = { claims: [{ text: ANSWER_TEXT, label: 'inference', refs: [] }], unsupportedAssumptions: [], suggestedFollowUps: [] };
const SUMMARY_TEXT = 'FULLAPP summary of the reset change.';
const SUMMARY = { prSummary: [{ text: SUMMARY_TEXT, label: 'inference', refs: [] }], files: [], functionalImpact: [], technicalImpact: [] };
const LOG_FIELDS = new Set(['ts', 'op', 'outcome', 'durationMs', 'sessionId', 'snapshotId', 'requestId', 'errorCode', 'errorMessage']);

const cleanups: Array<() => unknown> = [];
const hook = { after: (fn: () => unknown) => void cleanups.push(fn) };
const spawned: string[] = [];
const onSpawn = (message: unknown): void => {
  const child = (message as { process: { spawnfile?: string } }).process;
  queueMicrotask(() => spawned.push(basename(child.spawnfile ?? '?')));
};
const responses: TestResponse[] = [];

let bench: Workbench;
let staleLog: string;
let fingerprintBefore: CloneFingerprint;
let sessionId: string;
let snapshotId: string;

const call = async (method: string, path: string, body?: unknown): Promise<TestResponse> => {
  const res = await bench.client.request(method, path, body === undefined ? {} : { body });
  responses.push(res);
  return res;
};

/** Every row of every table, read through its own read-only connection. */
const dumpStore = (): string => {
  const db = new DatabaseSync(join(bench.appData.dir, 'review.db'), { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
  } finally {
    db.close();
  }
};

const readAll = async (dir: string): Promise<string> => {
  const names = await readdir(dir).catch(() => [] as string[]);
  return (await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8').catch(() => '')))).join('\n');
};

let session: Promise<void> | null = null;
const fullSession = (): Promise<void> => (session ??= runFullSession());

async function runFullSession(): Promise<void> {
  subscribe('child_process', onSpawn);
  bench = await startWorkbench(hook, { composed: true, fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  staleLog = join(bench.appData.dir, 'logs', `prwb-${new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)}.log`);
  await writeFile(staleLog, '{"ts":"old","op":"old","outcome":"ok","durationMs":0}\n');
  await bench.restart();
  fingerprintBefore = await bench.sandbox!.fingerprint();

  await call('GET', '/api/pulls');
  const detail = (await call('POST', '/api/sessions', { repository: 'acme/widgets', prNumber: 1 })).json as Json;
  sessionId = detail.sessionId as string;
  snapshotId = (detail.snapshots as Json[]).at(-1)!.snapshotId as string;
  await waitFor(async () => ((await call('GET', `/api/sessions/${sessionId}/snapshots/${snapshotId}/summaries`)).json as Json[])[0]?.state === 'completed', 'the summaries');
  const asked = (await call('POST', `/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: QUESTION })).json as Json;
  await waitFor(async () => ((await call('GET', `/api/sessions/${sessionId}/questions`)).json as Json[]).find((q) => q.questionId === asked.questionId)?.state === 'completed', 'the answer');
}

after(async () => {
  unsubscribe('child_process', onSpawn);
  for (const fn of cleanups.reverse()) await fn();
});

test('VO-041 the composed app reaches only the configured hosts, starts only git, the AI CLI and the browser opener, and leaves the clone unchanged', async () => {
  await fullSession();
  assert.ok(bench.recorded.requests.length > 0);
  bench.recorded.assertAllRecorded();
  assert.deepEqual([...new Set(bench.recorded.requests.map((r) => r.host))].sort(), ['acme.atlassian.net', 'api.github.com']);

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  assert.deepEqual([...new Set(spawned)].sort(), ['claude', 'git', opener].sort());
  const opened = (await readFile(join(bench.fake!.binDir, 'opened.log'), 'utf8')).trim().split('\n');
  assert.equal(opened.at(-1), `${bench.client.origin}/launch#${bench.client.launchToken}`, 'the browser is opened on the launch URL');

  assert.deepEqual(await bench.sandbox!.fingerprint(), fingerprintBefore, 'the clone is unchanged (SC-001)');
});

test('VO-040 in a full session no platform token reaches the config, logs, store file, any response, or the AI process', async () => {
  await fullSession();
  const storeFiles = (await readdir(bench.appData.dir)).filter((n) => n.startsWith('review.db'));
  const places: Array<[string, string]> = [
    ['config', await readFile(join(bench.appData.dir, 'config.json'), 'utf8')],
    ['logs', await readAll(join(bench.appData.dir, 'logs'))],
    ['store', (await Promise.all(storeFiles.map((f) => readFile(join(bench.appData.dir, f), 'latin1')))).join('\n')],
    ['responses', responses.map((r) => JSON.stringify(r.headers) + r.text).join('\n')],
    ['AI process', JSON.stringify(await bench.fake!.invocations())],
  ];
  for (const [where, text] of places) {
    assert.ok(text.length > 0, `${where} was read`);
    for (const token of PLATFORM_TOKENS) assert.ok(!text.includes(token), `${where} holds no platform token`);
  }
  for (const [where, text] of places.slice(0, 3)) assert.ok(!text.includes(bench.client.launchToken), `${where} holds no launch token`);
});

test('VO-045 on the composed app every GET route carries the CSP and no CORS header, and leaves the store unchanged', async () => {
  await fullSession();
  const session = `/api/sessions/${sessionId}`;
  const snapshot = `${session}/snapshots/${snapshotId}`;
  const paths = [
    '/api/config',
    '/api/platforms',
    '/api/signins',
    '/api/provider',
    '/api/pulls',
    '/api/sessions',
    session,
    snapshot,
    `${snapshot}/diff?path=src%2Fapp.js`,
    `${snapshot}/file?side=head&path=src%2Fapp.js`,
    `${snapshot}/summaries`,
    '/api/suggestions?scope=pr&category=what',
    `${session}/questions`,
  ];
  const before = dumpStore();
  for (const path of paths) {
    const res = await call('GET', path);
    assert.equal(res.status, 200, `GET ${path}: ${res.text}`);
    assert.equal(res.headers['content-security-policy'], CSP, `GET ${path} carries the CSP`);
    assert.ok(!Object.keys(res.headers).some((h) => h.startsWith('access-control-')), `GET ${path} has no CORS header`);
  }
  const events = await bench.client.open('GET', `${session}/events`);
  assert.equal(events.headers['content-security-policy'], CSP);
  events.destroy();
  assert.equal(dumpStore(), before, 'no GET changed the store');
});

test('VO-060 in a full session log lines hold only the allowed fields and no text, and old log files are deleted', async () => {
  await fullSession();
  assert.ok(!existsSync(staleLog), 'the 8-day-old log file is deleted at start');
  const lines = (await readAll(join(bench.appData.dir, 'logs'))).split('\n').filter((l) => l.trim() !== '');
  assert.ok(lines.length > 0);
  const forbidden = [QUESTION, ANSWER_TEXT, SUMMARY_TEXT, 'export const value', 'reset', '<<<PRWB-DATA', bench.client.launchToken, ...PLATFORM_TOKENS];
  for (const line of lines) {
    const entry = JSON.parse(line) as Json;
    for (const key of Object.keys(entry)) assert.ok(LOG_FIELDS.has(key), `log field ${key} is allowed`);
    for (const text of forbidden) assert.ok(!line.includes(text), `a log line holds ${JSON.stringify(text)}`);
  }
  assert.ok(lines.some((l) => (JSON.parse(l) as Json).sessionId === sessionId), 'lines carry the session id');
});
