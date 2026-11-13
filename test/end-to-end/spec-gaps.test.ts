// US4 end to end (FR-009, FR-010, FR-015, FR-018, SC-003, SC-007): every missing, unreadable or incomplete case is an
// explicit gap with its reason, no assessment is made for what is missing, the completeness rows say the same, and the
// rest of the session still loads. The stale cases (a moved commit, a newer snapshot) are proved in
// spec-context-service.test.ts; the git failure itself is proved there too and seeded here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startWorkbench, waitFor } from '../helpers/fake-ai-cli.ts';
import { seedSpec, type SeedOptions } from '../helpers/spec-seed.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function bench(t: Parameters<typeof startWorkbench>[0], seed: SeedOptions, fake: Json = {}) {
  const b = await startWorkbench(t, { composed: true, fake: { scenario: 'structured', ...fake } } as never);
  const detail = await b.startSession(1);
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Json[]).at(-1)!['snapshotId'] as string;
  seedSpec(b.store, snapshotId, seed);
  const base = `/api/sessions/${sessionId}/snapshots/${snapshotId}/spec-context`;
  const report = async (): Promise<Json> => waitFor(async () => {
    const r = (await b.client.get(base)).json as Json;
    return r['status'] !== 'searching' && !['pending', 'running'].includes(r['alignment']?.state) ? r : undefined;
  }, 'the lookup and any run to end');
  const rows = async (): Promise<Json[]> => ((await b.client.get(`/api/sessions/${sessionId}`)).json as Json)['completeness'] as Json[];
  await report();
  return { b, base, report, rows, sessionId };
}
const row = (rows: Json[], source: string): Json => rows.find((r) => r['source'] === source) as Json;

test('no folder anywhere: a gap with where it looked, missing rows with a reason, and no assessment (SC-003)', async (t) => {
  const { report, rows } = await bench(t, { outcome: 'not-found' });
  const r = await report();
  assert.equal(r['status'], 'none');
  assert.equal(r['alignment'], undefined, 'no assessment');
  assert.ok(r['searched'].length > 0, 'where it looked');
  assert.ok(r['keys'][0].documents.every((d: Json) => d['status'] === 'missing' && d['reason']));
  const list = await rows();
  for (const source of ['specification', 'tdd-evidence']) {
    assert.equal(row(list, source)['status'], 'missing');
    assert.ok(row(list, source)['reason']);
  }
});

test('a specification without evidence: criteria are listed and every test says no evidence available (US4-AS2)', async (t) => {
  const { report, rows } = await bench(t, { evidence: false, run: 'completed' });
  const r = await report();
  const a = r['alignment'] as Json;
  assert.equal(a['rows'].length, 5, 'the criteria are still listed');
  assert.ok(a['rows'].every((x: Json) => x['test'] === 'no-evidence-available'), 'never "no test shown"');
  assert.equal(a['verdict'].outcome, 'cannot-judge');
  assert.ok(a['verdict'].notJudged);
  assert.equal(r['keys'][0].documents[1].status, 'missing');
  const list = await rows();
  assert.equal(row(list, 'specification')['status'], 'found');
  assert.equal(row(list, 'tdd-evidence')['status'], 'missing');
  assert.match(row(list, 'tdd-evidence')['reason'], /no evidence file/);
});

test('no key and a repository outside any project are their own gaps', async (t) => {
  const none = await bench(t, { outcome: 'no-key' });
  assert.deepEqual((await none.report())['gaps'].map((g: Json) => g['kind']), ['no-key']);
  const outside = await bench(t, { outcome: 'not-found', enclosingNote: 'not-inside-project' });
  assert.ok((await outside.report())['gaps'].some((g: Json) => g['kind'] === 'no-enclosing-repository'));
});

test('a failed read is a read-failed gap with the first error line, and the session still loads (SC-007, FR-018)', async (t) => {
  const { b, report, sessionId } = await bench(t, { outcome: 'failed' });
  const r = await report();
  assert.equal(r['status'], 'failed');
  assert.deepEqual(r['gaps'].map((g: Json) => g['kind']), ['read-failed']);
  assert.ok(!r['gaps'][0].message.includes('\n'));
  assert.equal((await b.client.get(`/api/sessions/${sessionId}`)).status, 200, 'the rest of the session is unaffected');
});

test('an AI failure keeps the documents, shows the reason, and a retry makes a new run (FR-018)', async (t) => {
  const { b, base, report } = await bench(t, { run: 'failed' });
  const failed = await report();
  assert.equal(failed['alignment'].state, 'failed');
  assert.ok(failed['alignment'].reason);
  assert.equal(failed['keys'][0].documents[0].status, 'found');
  assert.equal(failed['canRetry'].allowed, true);
  await b.fake!.configure({ scenario: 'structured', alignmentScenario: 'structured' });
  const retry = await b.client.post(`${base}/retry`, {});
  assert.equal(retry.status, 202, retry.text);
  // The seeded failed run is dated ahead of anything the workbench writes, so the new run is counted in the store.
  const runs = (): number => {
    const db = new DatabaseSync(join(b.appData.dir, 'review.db'), { readOnly: true });
    try {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM spec_alignment_run').get() as { n: number }).n);
    } finally {
      db.close();
    }
  };
  await waitFor(() => (runs() >= 2 ? true : undefined), 'a new run record beside the failed one');
  assert.ok(runs() >= 2, 'the failed run is kept');
});

test('a missing specification adds no failure to the page: the session and report answer at once (SC-007)', async (t) => {
  const { b, base, sessionId } = await bench(t, { outcome: 'not-found' });
  const started = Date.now();
  const [session, report] = await Promise.all([b.client.get(`/api/sessions/${sessionId}`), b.client.get(base)]);
  assert.equal(session.status, 200);
  assert.equal(report.status, 200);
  assert.ok(Date.now() - started < 2000);
});
