// T011 (specs/006-spec-context, contracts/http-api.md): the specification routes over HTTP, through the composed
// app (src/main.ts, recorded platform, fake AI CLI). Written first (constitution XI): the routes arrive in
// Wave 5 (T024, T025), so these fail until then with 404s for the new paths.
//
//   GET  /api/sessions/:sessionId/snapshots/:snapshotId/spec-context                      -> SpecContextReport
//   GET  /api/sessions/:sessionId/snapshots/:snapshotId/spec-context/documents/:documentId -> text/plain
//   POST /api/sessions/:sessionId/snapshots/:snapshotId/spec-context/retry                -> 202 { runId }
//   SSE  `spec-context` { snapshotId, revision, cause }
//
// The stored lookup is seeded through the review store (the test's view of the composed app's database file),
// with the store API listed in test/integration/review-store.test.ts (T007): appendSpecLookup and
// appendSpecAlignmentRun. The pull request's own repository has no project folder around it in this sandbox,
// so the app's own lookup finds no specification; the seeded rows are what the routes then serve.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Rec = Record<string, unknown>;
type Hook = { after(fn: () => unknown): void };

const SPEC_TEXT = '# Spec\n- FR-001 The system MUST do x.\n- FR-002 <script>alert(1)</script> & "quoted"\n';
const TDD_TEXT = '# Evidence\n- FR-001: test `x` fails then passes.\n';
const SPEC_TABLES = ['spec_lookup', 'spec_source', 'spec_document', 'spec_alignment_run', 'spec_alignment_row', 'spec_alignment_item'];
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';
const sha = (c: string): string => c.repeat(40);
// Later than any lookup the composed session makes itself, so the seeded one is always the latest.
const T0 = new Date(Date.now() + 3_600_000).toISOString();

interface Seeded { lookupId: string; specDocumentId: string; tddDocumentId: string }

async function seed(b: Workbench, snapshotId: string, key = 'ABC-12'): Promise<Seeded> {
  const store = b.store as unknown as Record<string, (arg: Rec) => unknown>;
  const ids = { lookupId: randomUUID(), sourceId: randomUUID(), specDocumentId: randomUUID(), tddDocumentId: randomUUID() };
  const folder = `specs/006-${key}-x`;
  await store['appendSpecLookup']!({
    lookup: { id: ids.lookupId, snapshotId, lookedAt: T0, trigger: 'snapshot', keys: [key], searched: [{ repository: 'project-hd-v3', role: 'enclosing', heads: ['develop'] }], enclosingNote: 'found', outcome: 'found', reason: null },
    sources: [{ id: ids.sourceId, key, repository: 'project-hd-v3', branch: 'develop', commitSha: sha('1'), folder, ruleUsed: 'develop', otherCopies: [], developCopyExists: false, matchesKey: true }],
    documents: [
      { id: ids.specDocumentId, key, kind: 'specification', status: 'found', sourceId: ids.sourceId, filePath: `${folder}/spec.md`, commitSha: sha('1'), content: SPEC_TEXT, contentSha256: 'a'.repeat(64), otherFiles: [], missingReason: null },
      { id: ids.tddDocumentId, key, kind: 'tdd-evidence', status: 'found', sourceId: ids.sourceId, filePath: `${folder}/tdd-evidence.md`, commitSha: sha('1'), content: TDD_TEXT, contentSha256: 'b'.repeat(64), otherFiles: [], missingReason: null },
    ],
  });
  return ids;
}

async function bench(t: Hook, fake: Rec = {}) {
  const b = await startWorkbench(t, { composed: true, fake: { alignment: { summaries: { specification: { text: 'Asks for x.', citations: [] } }, rows: [], verdict: { outcome: 'incomplete', statement: { text: 'Gaps.', citations: [] }, uncovered: [], mismatched: [] }, deviations: { implementedNotRequested: [], requestedNotImplemented: [] } }, ...fake } as never });
  const detail = await b.startSession(1);
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Json[]).at(-1)!['snapshotId'] as string;
  const base = `/api/sessions/${sessionId}/snapshots/${snapshotId}/spec-context`;
  // Seed once the session's own background lookup has ended, so it cannot start a run of its own on the seeded documents.
  await waitFor(async () => ((await b.client.get(base)).json as Json)['status'] !== 'searching', 'the session\'s own lookup to end');
  const docs = await seed(b, snapshotId);
  const specRows = (): number => {
    const db = new DatabaseSync(join(b.appData.dir, 'review.db'), { readOnly: true });
    try {
      return SPEC_TABLES.reduce((n, table) => n + Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n), 0);
    } finally {
      db.close();
    }
  };
  return { b, sessionId, snapshotId, docs, base, specRows };
}

test('the report is served for a known snapshot and holds no score or percentage (FR-015)', async (t) => {
  const { b, base, snapshotId, docs } = await bench(t);
  const res = await b.client.get(base);
  assert.equal(res.status, 200, res.text);
  const report = res.json as Json;
  assert.equal(report['snapshotId'], snapshotId);
  assert.equal(typeof report['revision'], 'number');
  assert.ok(['searching', 'ready', 'none', 'failed'].includes(report['status']));
  assert.equal(report['keys'][0].key, 'ABC-12');
  assert.deepEqual(report['keys'][0].documents.map((d: Json) => d['kind']), ['specification', 'tdd-evidence'], 'in that order');
  assert.equal(report['keys'][0].documents[0].documentId, docs.specDocumentId);
  assert.ok(['own-repository-first', 'matching-branch-over-develop', 'most-recent-commit', 'only-candidate'].includes(report['keys'][0].documents[0].source.rule));
  assert.equal(typeof report['canRetry'].allowed, 'boolean');
  assert.doesNotMatch(res.text, /"(coverage|score|percent|percentage)"/i);
  assert.doesNotMatch(res.text, /"Verified"/, 'nothing is labelled Verified');
});

test('every route is behind the guard: no cookie, a foreign host and a foreign Origin are refused', async (t) => {
  const { b, base, docs, specRows } = await bench(t);
  const doc = `${base}/documents/${docs.specDocumentId}`;
  const before = specRows();
  for (const path of [base, doc]) {
    assert.equal((await b.client.get(path, { cookie: false })).status, 401, path);
    assert.equal((await b.client.get(path, { host: 'evil.example:80' })).status, 421, path);
    assert.equal((await b.client.get(path, { origin: 'http://evil.example' })).status, 403, path);
  }
  const retry = `${base}/retry`;
  assert.notEqual((await b.client.post(retry, {}, { cookie: false })).status, 404, 'the route exists');
  assert.equal((await b.client.post(retry, {}, { cookie: false })).status, 401);
  for (const origin of ['http://evil.example', `http://localhost:${b.client.port}`, 'null', null]) {
    const res = await b.client.post(retry, {}, { origin });
    assert.equal(res.status, 403, `Origin ${String(origin)}: ${res.text}`);
    assert.equal((res.json as Json)['error'].code, 'bad_origin');
  }
  assert.equal(specRows(), before, 'a refused request wrote nothing');
});

test('an unknown session or snapshot is 404 not_found on all three routes', async (t) => {
  const { b, sessionId, snapshotId, docs } = await bench(t);
  const bad = [
    `/api/sessions/${ZERO_UUID}/snapshots/${snapshotId}/spec-context`,
    `/api/sessions/${sessionId}/snapshots/${ZERO_UUID}/spec-context`,
    `/api/sessions/${ZERO_UUID}/snapshots/${snapshotId}/spec-context/documents/${docs.specDocumentId}`,
    `/api/sessions/${sessionId}/snapshots/${ZERO_UUID}/spec-context/documents/${docs.specDocumentId}`,
  ];
  for (const path of bad) {
    const res = await b.client.get(path);
    assert.equal(res.status, 404, `${path}: ${res.text}`);
    assert.equal((res.json as Json)['error'].code, 'not_found');
  }
  for (const path of [`/api/sessions/${ZERO_UUID}/snapshots/${snapshotId}/spec-context/retry`, `/api/sessions/${sessionId}/snapshots/${ZERO_UUID}/spec-context/retry`]) {
    const res = await b.client.post(path, {});
    assert.equal(res.status, 404, `${path}: ${res.text}`);
    assert.equal((res.json as Json)['error'].code, 'not_found');
  }
});

test('document text is the stored text, text/plain with nosniff, never HTML', async (t) => {
  const { b, base, docs } = await bench(t);
  const spec = await b.client.get(`${base}/documents/${docs.specDocumentId}`);
  assert.equal(spec.status, 200, spec.text);
  assert.match(String(spec.headers['content-type']), /^text\/plain; charset=utf-8$/i);
  assert.equal(spec.headers['x-content-type-options'], 'nosniff');
  assert.equal(spec.text, SPEC_TEXT, 'exactly as read: markup is not escaped, rendered or changed');
  const tdd = await b.client.get(`${base}/documents/${docs.tddDocumentId}`);
  assert.equal(tdd.text, TDD_TEXT);
});

test('an unknown document, or one of another snapshot\'s lookup, is 404 and its text is not leaked', async (t) => {
  const { b, base, docs } = await bench(t);
  const other = await b.startSession(2);
  const otherSnapshot = (other['snapshots'] as Json[]).at(-1)!['snapshotId'] as string;
  const foreign = await seed(b, otherSnapshot, 'ABC-12');
  const unknown = await b.client.get(`${base}/documents/${ZERO_UUID}`);
  assert.equal(unknown.status, 404, unknown.text);
  assert.equal((unknown.json as Json)['error'].code, 'not_found');
  const across = await b.client.get(`${base}/documents/${foreign.specDocumentId}`);
  assert.equal(across.status, 404, across.text);
  assert.equal((across.json as Json)['error'].code, 'not_found');
  assert.doesNotMatch(across.text, /FR-001/);
  assert.equal((await b.client.get(`${base}/documents/${docs.specDocumentId}`)).status, 200, 'the own document still reads');
  const notAnId = await b.client.get(`${base}/documents/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(notAnId.status, 404, notAnId.text);
});

test('an older snapshot stays readable and is marked stale, and cannot be retried (409 read_only)', async (t) => {
  const { b, sessionId, snapshotId, base, docs } = await bench(t);
  await b.pushHead({ 'docs/notes.md': '# notes\n' });
  const refreshed = await b.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  const older = await b.client.get(base);
  assert.equal(older.status, 200, older.text);
  const report = older.json as Json;
  assert.equal(report['snapshotId'], snapshotId);
  assert.equal(report['stale'], true);
  assert.match(String(report['staleReason']), /older|latest|newer/i);
  assert.equal(report['canRetry'].allowed, false);
  assert.equal((await b.client.get(`${base}/documents/${docs.specDocumentId}`)).status, 200, 'old citations still open');
  const retry = await b.client.post(`${base}/retry`, {});
  assert.equal(retry.status, 409, retry.text);
  assert.equal((retry.json as Json)['error'].code, 'read_only');
  assert.match(String((retry.json as Json)['error'].message), /older|latest|newer|read.only/i, 'the message names the cause');
});

test('retry refuses extra fields with 400 unknown_field and writes nothing', async (t) => {
  const { b, base, specRows } = await bench(t);
  const before = specRows();
  for (const body of [{ extra: 1 }, { runId: 'x' }, { force: true }]) {
    const res = await b.client.post(`${base}/retry`, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.text}`);
    assert.equal((res.json as Json)['error'].code, 'unknown_field');
  }
  assert.equal(specRows(), before);
  assert.deepEqual((await b.fake!.alignmentInvocations()).length, 0, 'no AI run was started');
});

test('retry answers 202 with a runId, publishes spec-context, and a second retry while it runs is 409 conflict', async (t) => {
  const { b, sessionId, snapshotId, base } = await bench(t, { alignmentScenario: 'slow' });
  const stream = await b.subscribe(sessionId);
  t.after(() => stream.close());
  const first = await b.client.post(`${base}/retry`, {});
  assert.equal(first.status, 202, first.text);
  assert.equal(typeof (first.json as Json)['runId'], 'string');
  assert.ok(((first.json as Json)['runId'] as string).length > 0);

  const second = await b.client.post(`${base}/retry`, {});
  assert.equal(second.status, 409, second.text);
  assert.equal((second.json as Json)['error'].code, 'conflict');
  assert.match(String((second.json as Json)['error'].message), /already running/i);

  const running = (await b.client.get(base)).json as Json;
  assert.ok(['pending', 'running'].includes(running['alignment'].state), `the report shows the run: ${running['alignment']?.state}`);
  assert.equal(running['canRetry'].allowed, false);

  await waitFor(() => stream.events.some((e) => e.event === 'spec-context'), 'the spec-context event');
  const event = stream.events.find((e) => e.event === 'spec-context')!.data as Json;
  assert.equal(event['snapshotId'], snapshotId);
  assert.equal(typeof event['revision'], 'number');
  assert.ok(['lookup', 'documents', 'alignment', 'stale'].includes(event['cause']));
  assert.deepEqual(Object.keys(event).sort(), ['cause', 'revision', 'snapshotId'], 'no document text, no other field');

  await b.fake!.release('alignment');
  const done = await waitFor(async () => {
    const r = (await b.client.get(base)).json as Json;
    return r['alignment']?.state === 'completed' && r['alignment'].runId === (first.json as Json)['runId'] ? r : undefined;
  }, 'the run to complete');
  assert.equal(done['alignment'].runId, (first.json as Json)['runId']);
  const last = stream.events.filter((e) => e.event === 'spec-context').at(-1)!.data as Json;
  assert.equal(last['cause'], 'alignment');
  assert.equal(last['revision'], done['revision'], 'the event revision is the report revision');

  // The composed session may have queued a run of its own behind this one; retry is allowed once it has ended too.
  await waitFor(async () => (((await b.client.get(base)).json as Json)['canRetry'].allowed ? true : undefined), 'every run to end');
  const again = await b.client.post(`${base}/retry`, {});
  assert.equal(again.status, 202, 'a finished run can be retried');
  assert.notEqual((again.json as Json)['runId'], (first.json as Json)['runId']);
});

test('GET never writes: reading the report and documents any number of times adds no rows', async (t) => {
  const { b, base, docs, specRows } = await bench(t);
  const before = specRows();
  const invocations = (await b.fake!.alignmentInvocations()).length;
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await b.client.get(base)).status, 200);
    assert.equal((await b.client.get(`${base}/documents/${docs.specDocumentId}`)).status, 200);
    assert.equal((await b.client.get(`${base}/documents/${docs.tddDocumentId}`)).status, 200);
  }
  assert.equal(specRows(), before, 'no lookup, document or run was written by a GET');
  assert.equal((await b.fake!.alignmentInvocations()).length, invocations, 'no AI run was started by a GET');
});

test('a git or provider failure is a gap or a failed run in the report, never a 500', async (t) => {
  const { b, base } = await bench(t, { alignmentScenario: 'error-on-start' });
  const retry = await b.client.post(`${base}/retry`, {});
  assert.equal(retry.status, 202, retry.text);
  const failed = await waitFor(async () => {
    const r = (await b.client.get(base)).json as Json;
    return r['alignment']?.state === 'failed' ? r : undefined;
  }, 'the failed run');
  assert.equal(typeof failed['alignment'].reason, 'string');
  assert.equal(failed['keys'][0].documents[0].status, 'found', 'the documents are kept when the AI fails');
  assert.equal(failed['canRetry'].allowed, true);
});
