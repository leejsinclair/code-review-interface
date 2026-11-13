// US3 end to end (FR-013, FR-014): both deviation kinds come back with their citations, an empty list stores no row,
// and an uncited statement is kept as unverified rather than dropped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWorkbench, waitFor } from '../helpers/fake-ai-cli.ts';
import { seedSpec } from '../helpers/spec-seed.ts';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const stmt = (text: string, citations: unknown[] = []) => ({ text, citations });
const output = (deviations: Json) => ({
  summaries: { specification: stmt('Asks for one thing.'), tddEvidence: stmt('One test.') },
  rows: [{ criterionId: 'FR-001', criterion: 'Do it.', state: 'Implementation and test identified', test: 'test-shown', testMismatch: false, reason: stmt('Done.') }],
  verdict: { outcome: 'sufficient', statement: stmt('Fine.'), uncovered: [], mismatched: [] },
  deviations,
});

async function run(t: Parameters<typeof startWorkbench>[0], deviations: Json) {
  const b = await startWorkbench(t, { composed: true, fake: { scenario: 'structured', alignment: output(deviations) } } as never);
  const detail = await b.startSession(1);
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Json[]).at(-1)!['snapshotId'] as string;
  seedSpec(b.store, snapshotId, { run: 'none' });
  const base = `/api/sessions/${sessionId}/snapshots/${snapshotId}/spec-context`;
  const quiet = (): Promise<Json> => waitFor(async () => {
    const r = (await b.client.get(base)).json as Json;
    return r['status'] !== 'searching' && !['pending', 'running'].includes(r['alignment']?.state) ? r : undefined;
  }, 'the lookup and any run to end');
  await quiet();
  const retry = await b.client.post(`${base}/retry`, {});
  assert.equal(retry.status, 202, retry.text);
  const report = await waitFor(async () => {
    const r = await quiet();
    return r['alignment']?.runId === (retry.json as Json)['runId'] ? r : undefined;
  }, 'the run');
  const items = (): Json[] => {
    const db = new DatabaseSync(join(b.appData.dir, 'review.db'), { readOnly: true });
    try {
      return db.prepare('SELECT kind, unverified FROM spec_alignment_item WHERE run_id = ?').all(report['alignment'].runId) as Json[];
    } finally {
      db.close();
    }
  };
  return { report, items };
}

test('both deviation kinds are returned with their citations, and an uncited one is kept as unverified', async (t) => {
  const { report, items } = await run(t, {
    implementedNotRequested: [stmt('Adds a cache.', [{ type: 'code', path: 'src/util.js', side: 'head', startLine: 1, endLine: 1 }])],
    requestedNotImplemented: [stmt('FR-001 is only half done.')],
  });
  const d = report['alignment'].deviations as Json;
  assert.equal(d['noneFound'], false);
  assert.equal(d['implementedNotRequested'][0].label, 'Inferred');
  assert.equal(d['implementedNotRequested'][0].citations[0].path, 'src/util.js');
  assert.equal(d['requestedNotImplemented'][0].citationStatus, 'unverified');
  assert.equal(d['requestedNotImplemented'][0].text, 'FR-001 is only half done.', 'kept, not dropped');
  assert.deepEqual(items().map((i) => i['kind']).sort(), ['implemented-not-requested', 'requested-not-implemented']);
});

test('no deviations: noneFound is true and no item row is stored', async (t) => {
  const { report, items } = await run(t, { implementedNotRequested: [], requestedNotImplemented: [] });
  assert.equal(report['alignment'].deviations.noneFound, true);
  assert.deepEqual(items(), []);
});
