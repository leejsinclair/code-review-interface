// T019: the risk routes over HTTP, through the full workbench (fake provider, recorded platform, real git
// sandbox). Later tasks append the AI, override, and reference-journey cases.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const RISK_FILES = {
  'db/migrations/001_add_user.sql': 'ALTER TABLE users ADD COLUMN age INTEGER;\n',
  'src/auth/session.js': 'export function check(token) {\n  return token !== undefined && token.password !== "";\n}\n',
  'package-lock.json': '{\n  "lockfileVersion": 3\n}\n',
  'README.md': '# Widgets\n\nMore docs.\n',
  'src/<b>markup</b>.js': 'export const a = 1;\n',
};

export async function riskBench(t: { after(fn: () => unknown): void }, extra: Parameters<typeof startWorkbench>[1] = {}): Promise<{ bench: Workbench; sessionId: string; snapshotId: string; detail: Json }> {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured' }, prFiles: RISK_FILES, ...extra });
  const detail = await bench.startSession();
  return { bench, sessionId: detail.sessionId, snapshotId: detail.snapshots[0].snapshotId, detail };
}

const riskUrl = (sessionId: string, snapshotId: string): string => `/api/sessions/${sessionId}/snapshots/${snapshotId}/risk`;

test('the report lists every changed file once with its class and reasons', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t);
  const res = await bench.client.get(riskUrl(sessionId, snapshotId));
  assert.equal(res.status, 200, res.text);
  const report = res.json as Json;
  assert.equal(report.snapshotId, snapshotId);
  const paths = (report.files as Json[]).map((f) => f.path);
  assert.deepEqual([...paths].sort(), Object.keys(RISK_FILES).sort());
  assert.equal(new Set(paths).size, paths.length, 'each file once');
  const by = (p: string) => (report.files as Json[]).find((f) => f.path === p)!;
  assert.equal(by('db/migrations/001_add_user.sql').effectiveClass, 'critical');
  assert.equal(by('src/auth/session.js').effectiveClass, 'critical');
  assert.equal(by('package-lock.json').mechanical, true);
  assert.equal(by('README.md').effectiveClass, 'normal');
  for (const f of report.files as Json[]) assert.ok(f.reasons.length >= 1, `${f.path} has a reason`);
  assert.ok(by('db/migrations/001_add_user.sql').reasons.some((r: Json) => r.ruleId === 'R-MIGRATION'));
  assert.deepEqual(Object.keys(report.counts).sort(), ['critical', 'elevated', 'low', 'mechanical', 'normal', 'notFullyAnalysed', 'overrides']);
  assert.equal(report.canOverride.allowed, true);
  assert.equal(typeof report.revision, 'number');
});

test('an unknown session or snapshot is 404', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t);
  assert.equal((await bench.client.get(riskUrl('00000000-0000-4000-8000-000000000000', snapshotId))).status, 404);
  assert.equal((await bench.client.get(riskUrl(sessionId, '00000000-0000-4000-8000-000000000000'))).status, 404);
});

test('the guard applies: no token, a foreign Host and a foreign Origin are refused', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t);
  const url = riskUrl(sessionId, snapshotId);
  assert.equal((await bench.client.get(url, { cookie: false })).status, 401);
  assert.equal((await bench.client.get(url, { host: 'evil.example:80' })).status, 421);
  assert.equal((await bench.client.get(url, { origin: 'http://evil.example' })).status, 403);
});

test('an older snapshot stays readable and cannot be overridden', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t);
  await bench.pushHead({ 'docs/notes.md': '# notes\n' });
  const refreshed = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  const older = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
  assert.equal(older.files.length, Object.keys(RISK_FILES).length);
  assert.equal(older.canOverride.allowed, false);
  assert.match(older.canOverride.reason, /older|latest/i);
  const latestId = (refreshed.json as Json).snapshots[1].snapshotId;
  const latest = (await bench.client.get(riskUrl(sessionId, latestId))).json as Json;
  assert.equal(latest.canOverride.allowed, true);
});

test('the risk event carries the snapshot, a revision and paths, and no class', async (t) => {
  const { bench, sessionId } = await riskBench(t);
  const stream = await bench.subscribe(sessionId);
  t.after(() => stream.close());
  await bench.pushHead({ 'src/auth/more.js': 'export const x = 1;\n' });
  const refreshed = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  const event = await waitFor(() => stream.events.find((e) => e.event === 'risk' && (e.data as Json).cause === 'classified'), 'the risk event');
  const data = event.data as Json;
  assert.equal(data.cause, 'classified');
  assert.equal(data.snapshotId, (refreshed.json as Json).snapshots[1].snapshotId);
  assert.ok(Array.isArray(data.changedPaths) && data.changedPaths.length > 0);
  assert.equal(typeof data.revision, 'number');
  assert.equal(/"(critical|elevated|normal|low)"/.test(JSON.stringify(data)), false, 'no class on the stream');
});

// ---------------------------------------------------------------- AI assessment (T085, US4)

const AI_FILES = { 'src/util/pricing-notes.js': 'export const a = 1;\nexport const b = 2;\n', 'package-lock.json': '{\n  "lockfileVersion": 3\n}\n' };
const reason = 'It changes how the value is chosen.';
const raise = (path: string, cls: string, lines: unknown[] = [{ side: 'head', startLine: 2, endLine: 2 }]) => ({ files: [{ path, class: cls, reasons: [reason], lines }] });

async function aiReport(bench: Workbench, sessionId: string, snapshotId: string, until: (r: Json) => boolean = (r) => ['completed', 'failed', 'cancelled'].includes(r.ai.state)): Promise<Json> {
  return waitFor(async () => {
    const report = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
    return until(report) && report;
  }, 'the AI assessment to end');
}

test('the AI raises a Normal file: AI origin, rule class kept, run details shown, and the event arrives', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { prFiles: AI_FILES, fake: { scenario: 'structured', risk: raise('src/util/pricing-notes.js', 'elevated') } });
  const report = await aiReport(bench, sessionId, snapshotId);
  const f = (report.files as Json[]).find((x) => x.path === 'src/util/pricing-notes.js')!;
  assert.deepEqual([f.ruleClass, f.effectiveClass, f.effectiveOrigin, f.ai.state], ['normal', 'elevated', 'ai', 'applied']);
  assert.ok(f.reasons.some((r: Json) => r.origin === 'ai' && r.text === reason && r.lines.length === 1));
  assert.equal(report.ai.provider, 'claude-code-cli');
  assert.match(report.ai.contextVersion, /^[0-9a-f]{40}:[0-9a-f]{64}$/);
  const lock = (report.files as Json[]).find((x) => x.path === 'package-lock.json')!;
  assert.deepEqual([lock.ai.state, lock.ai.notAssessedReason], ['not-assessed', 'lockfile']);
  const prompt = (await bench.fake!.riskInvocations())[0]!.stdin;
  assert.equal(prompt.includes('lockfileVersion'), false, 'the lockfile never reached the provider');
  assert.ok(prompt.includes('Classes the rules gave'));
  assert.equal((await bench.fake!.riskInvocations()).length, 1);
});

test('an AI lowering and an uncited raise change no class and are counted as ignored', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, {
    prFiles: { ...RISK_FILES, 'src/util/pricing-notes.js': 'export const a = 1;\n' },
    fake: { scenario: 'structured', risk: { files: [
      { path: 'db/migrations/001_add_user.sql', class: 'normal', reasons: ['looks fine'], lines: [{ side: 'head', startLine: 1, endLine: 1 }] },
      { path: 'src/util/pricing-notes.js', class: 'critical', reasons: ['scary'], lines: [] },
    ] } },
  });
  const report = await aiReport(bench, sessionId, snapshotId);
  const by = (p: string) => (report.files as Json[]).find((x) => x.path === p)!;
  assert.equal(by('db/migrations/001_add_user.sql').effectiveClass, 'critical');
  assert.equal(by('db/migrations/001_add_user.sql').ai.state, 'not-higher');
  assert.equal(by('src/util/pricing-notes.js').effectiveClass, 'normal');
  assert.equal(by('src/util/pricing-notes.js').ai.state, 'no-resolvable-line');
  assert.equal(report.ai.ignoredCount, 2);
});

test('a provider that fails leaves the rule classes and says why', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: { scenario: 'structured', riskScenario: 'error-on-start' } });
  const report = await aiReport(bench, sessionId, snapshotId);
  assert.equal(report.ai.state, 'failed');
  assert.match(report.ai.reason, /failed to start/);
  const migration = (report.files as Json[]).find((x) => x.path === 'db/migrations/001_add_user.sql')!;
  assert.equal(migration.effectiveClass, 'critical');
  assert.equal(migration.ai.state, 'unavailable');
});

test('the AI result arrives as a risk event with cause ai', async (t) => {
  const { bench, sessionId } = await riskBench(t, { prFiles: AI_FILES, fake: { scenario: 'structured', risk: raise('src/util/pricing-notes.js', 'elevated') } });
  const stream = await bench.subscribe(sessionId);
  t.after(() => stream.close());
  await bench.pushHead({ 'src/util/pricing-more.js': 'export const c = 3;\n' });
  const refreshed = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  await waitFor(() => stream.events.filter((e) => e.event === 'risk' && (e.data as Json).cause === 'ai').length >= 2, 'the queued and finished events');
});

// ---------------------------------------------------------------- overrides over HTTP (T066, US5)

const USER_URL = 'https://api.github.com/user';
const overridesUrl = (sessionId: string): string => `/api/sessions/${sessionId}/risk/overrides`;
const body = (snapshotId: string, path: string, cls: string, reason = 'Only the log line changed.') => ({ snapshotId, path, class: cls, reason });
const noAiFake = { scenario: 'structured' as const };

test('POST an override: 201 with the record, the class changes, the history is readable, and no write route exists', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  const res = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'elevated'));
  assert.equal(res.status, 201, res.text);
  const record = res.json as Json;
  assert.deepEqual([record.path, record.class, record.replacedClass, record.calculatedClass, record.reviewer], ['README.md', 'elevated', 'normal', 'normal', undefined]);
  assert.equal(typeof record.id, 'string');
  const report = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
  const file = (report.files as Json[]).find((f) => f.path === 'README.md')!;
  assert.deepEqual([file.effectiveClass, file.effectiveOrigin, file.ruleClass, file.override.applies], ['elevated', 'override', 'normal', true]);
  assert.equal(report.counts.overrides, 1);
  const history = await bench.client.get(`${overridesUrl(sessionId)}?path=README.md`);
  assert.equal(history.status, 200);
  assert.deepEqual(((history.json as Json).records as Json[]).map((r) => r.id), [record.id]);
  assert.equal((await bench.client.get(overridesUrl(sessionId))).status, 400, 'path is required: no listing across files');
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const refusedWrite = await bench.client.request(method, overridesUrl(sessionId), { body: body(snapshotId, 'README.md', 'low') });
    assert.ok([404, 405].includes(refusedWrite.status), `${method} → ${refusedWrite.status}`);
  }
});

test('the body is checked: a reviewer field is refused unknown_field, a blank reason names reason, and nothing is recorded', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  const withReviewer = await bench.client.post(overridesUrl(sessionId), { ...body(snapshotId, 'README.md', 'low'), reviewer: 'someone else' });
  assert.equal(withReviewer.status, 400);
  assert.equal((withReviewer.json as Json).error.code, 'unknown_field');
  const blank = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'low', '   '));
  assert.equal(blank.status, 400);
  assert.equal((blank.json as Json).error.code, 'invalid_request');
  assert.match((blank.json as Json).error.message, /reason/);
  const badClass = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'urgent'));
  assert.equal(badClass.status, 400);
  assert.match((badClass.json as Json).error.message, /class/);
  const same = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'normal'));
  assert.equal(same.status, 400);
  assert.equal((await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'nope.txt', 'low'))).status, 404);
  assert.equal((await bench.client.post(overridesUrl('00000000-0000-4000-8000-000000000000'), body(snapshotId, 'README.md', 'low'))).status, 404);
  const history = (await bench.client.get(`${overridesUrl(sessionId)}?path=README.md`)).json as Json;
  assert.deepEqual(history.records, []);
});

test('an older snapshot refuses overrides with 409 read_only', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  await bench.pushHead({ 'docs/notes.md': '# notes\n' });
  const refreshed = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  const older = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'elevated'));
  assert.equal(older.status, 409);
  assert.equal((older.json as Json).error.code, 'read_only');
  assert.match((older.json as Json).error.message, /older|latest/i);
});

test('lowering a Critical class records the platform account read by the server; the client never supplies it', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  const reviewer = (await bench.client.get(`/api/sessions/${sessionId}/risk/reviewer`)).json as Json;
  assert.deepEqual(reviewer, { ok: true, handle: 'alice-dev', displayName: 'Alice Developer' });
  const res = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'db/migrations/001_add_user.sql', 'normal', 'A comment-only migration.'));
  assert.equal(res.status, 201, res.text);
  assert.deepEqual((res.json as Json).reviewer, { handle: 'alice-dev', displayName: 'Alice Developer' });
  assert.equal((res.json as Json).calculatedClass, 'critical');
  const report = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
  assert.equal((report.files as Json[]).find((f) => f.path === 'db/migrations/001_add_user.sql')!.effectiveClass, 'normal');
});

test('a refused credential answers 409 signin_required and an unreachable platform 502 platform_error, with no record', async (t) => {
  const refusedBench = await riskBench(t, {
    fake: noAiFake, drop: (url) => url === USER_URL,
    extra: [{ request: { url: USER_URL }, response: { status: 401, body: { message: 'Bad credentials' } } }],
  });
  const a = await refusedBench.bench.client.post(overridesUrl(refusedBench.sessionId), body(refusedBench.snapshotId, 'db/migrations/001_add_user.sql', 'normal'));
  assert.equal(a.status, 409, a.text);
  assert.equal((a.json as Json).error.code, 'signin_required');
  assert.match((a.json as Json).error.message, /Sign in to the platform again/);
  const reviewer = await refusedBench.bench.client.get(`/api/sessions/${refusedBench.sessionId}/risk/reviewer`);
  assert.equal(reviewer.status, 200, 'never a 500 for a platform error');
  assert.equal((reviewer.json as Json).ok, false);
  assert.match((reviewer.json as Json).fix, /Sign in to the platform again/);
  assert.ok((reviewer.json as Json).reason.length > 0);
  assert.deepEqual(((await refusedBench.bench.client.get(`${overridesUrl(refusedBench.sessionId)}?path=db%2Fmigrations%2F001_add_user.sql`)).json as Json).records, []);
  // Signed out of the platform, raising a class still works and makes no platform call.
  const raised = await refusedBench.bench.client.post(overridesUrl(refusedBench.sessionId), body(refusedBench.snapshotId, 'README.md', 'critical'));
  assert.equal(raised.status, 201, raised.text);

  const downBench = await riskBench(t, { fake: noAiFake, drop: (url) => url === USER_URL, extra: [{ request: { url: USER_URL }, response: { networkError: 'connection refused' } }] });
  const b = await downBench.bench.client.post(overridesUrl(downBench.sessionId), body(downBench.snapshotId, 'db/migrations/001_add_user.sql', 'normal'));
  assert.equal(b.status, 502, b.text);
  assert.equal((b.json as Json).error.code, 'platform_error');
});

test('the guard covers the override POST: no token, a foreign Host and a foreign Origin are refused and write nothing', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  const send = (o: Record<string, unknown>) => bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'elevated'), o);
  assert.equal((await send({ cookie: false })).status, 401);
  assert.equal((await send({ host: 'evil.example:80' })).status, 421);
  assert.equal((await send({ origin: 'http://evil.example' })).status, 403);
  assert.equal((await send({ origin: null })).status, 403);
  assert.deepEqual(((await bench.client.get(`${overridesUrl(sessionId)}?path=README.md`)).json as Json).records, []);
});

// ---------------------------------------------------------------- the reference journey (T080, VO-033, VO-034, VO-035)

test('VO-033 a refresh takes a new snapshot, recalculates every class and keeps the older snapshot\'s classes and overrides', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  const first = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
  assert.equal((await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'elevated'))).status, 201);

  await bench.pushHead({ 'src/auth/session.js': 'export function check(token) {\n  return token !== undefined;\n}\n', 'src/billing/total.js': 'export const total = 1;\n' });
  const refreshed = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  const latestId = (refreshed.json as Json).snapshots[1].snapshotId as string;
  assert.notEqual(latestId, snapshotId);
  const second = (await bench.client.get(riskUrl(sessionId, latestId))).json as Json;
  const byPath = (r: Json, p: string) => (r.files as Json[]).find((f) => f.path === p);
  assert.equal(byPath(second, 'src/billing/total.js')?.effectiveClass, 'critical', 'the new file is classified');
  assert.equal(byPath(second, 'src/billing/total.js')?.reasons[0].ruleId, 'R-FINANCE');
  assert.equal(second.files.length, Object.keys(RISK_FILES).length + 2 - 1, 'every file of the new snapshot appears once (one of the pushed files already existed)');
  assert.ok((second.files as Json[]).every((f) => f.reasons.length >= 1));
  // The older snapshot keeps its own classes, unchanged by the refresh.
  const again = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
  assert.deepEqual((again.files as Json[]).map((f) => [f.path, f.ruleClass, f.assessedClass]), (first.files as Json[]).map((f) => [f.path, f.ruleClass, f.assessedClass]));
  assert.notEqual(second.snapshotId, again.snapshotId);
});

test('VO-035 a read-only session shows its stored classes and overrides, offers no override, and runs no new AI assessment', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake, prStates: ['open', 'merged'] });
  await waitFor(async () => (await bench.fake!.riskInvocations()).length === 1, 'the first AI assessment');
  const reopened = await bench.client.post(`/api/sessions/${sessionId}/open`);
  assert.equal(reopened.status, 200, reopened.text);
  assert.equal((reopened.json as Json).readOnly, true, 'the session is read-only now');
  const report = (await bench.client.get(riskUrl(sessionId, snapshotId))).json as Json;
  assert.equal(report.files.length, Object.keys(RISK_FILES).length, 'the stored classes are still readable');
  assert.equal(report.canOverride.allowed, false);
  assert.match(report.canOverride.reason, /merged|read-only/i);
  const refused = await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'elevated'));
  assert.equal(refused.status, 409);
  assert.equal((await bench.fake!.riskInvocations()).length, 1, 'no new AI assessment');
});

test('VO-024 deleting the session removes its risk records and overrides with it', async (t) => {
  const { bench, sessionId, snapshotId } = await riskBench(t, { fake: noAiFake });
  await aiReport(bench, sessionId, snapshotId);
  assert.equal((await bench.client.post(overridesUrl(sessionId), body(snapshotId, 'README.md', 'elevated'))).status, 201);
  assert.ok(bench.store.readRiskRuleset(snapshotId), 'there are risk records');
  assert.equal(bench.store.readRiskClassifications(snapshotId).length, Object.keys(RISK_FILES).length);
  assert.ok(bench.store.readLatestOverride(sessionId, 'README.md'));
  const deleted = await bench.client.delete(`/api/sessions/${sessionId}`, { confirm: true });
  assert.equal(deleted.status, 204, deleted.text);
  assert.equal(bench.store.readRiskRuleset(snapshotId), null);
  assert.deepEqual(bench.store.readRiskClassifications(snapshotId), []);
  assert.equal(bench.store.readLatestCompletedRiskRun(snapshotId), null);
  assert.equal(bench.store.readLatestOverride(sessionId, 'README.md'), null);
  assert.equal((await bench.client.get(riskUrl(sessionId, snapshotId))).status, 404);
});
