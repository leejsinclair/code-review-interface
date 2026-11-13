// US2 end to end (FR-011, FR-012, FR-014, FR-016): an alignment run through the composed server and the fake AI
// CLI over seeded documents: rows in the order the AI returned, the verdict from what the rows show, every statement
// labelled Inferred, an unresolved citation downgraded and kept, a new run adding a record, and no score anywhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { startWorkbench, waitFor } from '../helpers/fake-ai-cli.ts';
import { seedSpec } from '../helpers/spec-seed.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const stmt = (text: string, citations: unknown[] = []) => ({ text, citations });
const row = (n: number, state: string, test: string, mismatch = false, citations: unknown[] = []) => ({
  criterionId: `FR-00${n}`, criterion: `The system MUST do thing ${n}.`, state, test, testMismatch: mismatch, reason: stmt(`Reason ${n}.`, citations),
});
const ALIGNMENT = {
  summaries: { specification: stmt('Asks for five things.'), tddEvidence: stmt('Four tests.') },
  rows: [
    row(1, 'Implementation and test identified', 'test-shown', false, [{ type: 'spec', documentId: '__SPEC__', startLine: 3, endLine: 3 }]),
    row(2, 'Implementation and test identified', 'test-shown', false, [{ type: 'spec', documentId: 'not-a-stored-document', startLine: 1, endLine: 1 }]),
    row(3, 'Implementation and test identified', 'test-shown', true),
    row(4, 'Implementation identified', 'test-shown'),
    row(5, 'Not found', 'no-test-shown'),
  ],
  verdict: { outcome: 'incomplete', statement: stmt('FR-005 has no test.'), uncovered: ['FR-005'], mismatched: [stmt('The third test checks something else.')] },
  deviations: { implementedNotRequested: [], requestedNotImplemented: [] },
};

async function bench(t: Parameters<typeof startWorkbench>[0], ai: unknown) {
  const b = await startWorkbench(t, { composed: true, fake: { scenario: 'structured', alignment: ai } } as never);
  const detail = await b.startSession(1);
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Json[]).at(-1)!['snapshotId'] as string;
  const seeded = seedSpec(b.store, snapshotId, { run: 'none' });
  const base = `/api/sessions/${sessionId}/snapshots/${snapshotId}/spec-context`;
  const quiet = async (): Promise<Json> => waitFor(async () => {
    const r = (await b.client.get(base)).json as Json;
    return r['status'] !== 'searching' && !['pending', 'running'].includes(r['alignment']?.state) ? r : undefined;
  }, 'the lookup and any run to end');
  await quiet();
  return { b, base, seeded, quiet };
}

test('a run returns one row per criterion in order, an incomplete verdict, every statement Inferred, and no score', async (t) => {
  const { b, base, seeded, quiet } = await bench(t, JSON.parse(JSON.stringify(ALIGNMENT).replace('__SPEC__', 'PLACEHOLDER')));
  // The AI cites the stored specification by id; the id is known only now, so re-configure the fake with it.
  await b.fake!.configure({ scenario: 'structured', alignment: JSON.parse(JSON.stringify(ALIGNMENT).replace('__SPEC__', seeded.specDocumentId)) });
  const retry = await b.client.post(`${base}/retry`, {});
  assert.equal(retry.status, 202, retry.text);
  const report = await waitFor(async () => {
    const r = await quiet();
    return r['alignment']?.runId === (retry.json as Json)['runId'] && r['alignment'].state === 'completed' ? r : undefined;
  }, 'the retried run to complete');
  const a = report['alignment'] as Json;
  assert.deepEqual(a['rows'].map((r: Json) => r['criterionId']), ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005']);
  assert.equal(a['verdict'].outcome, 'incomplete');
  assert.deepEqual(a['verdict'].uncovered, ['FR-005']);
  assert.equal(a['verdict'].mismatched.length, 1);
  assert.equal(a['rows'][2].testMismatch, true);
  assert.equal(a['rows'][2].state, 'Requires verification', 'a mismatched test cannot count as implementation and test identified');
  const statements = [...a['rows'].map((r: Json) => r['statement']), ...a['verdict'].mismatched];
  assert.ok(statements.every((s: Json) => s['label'] === 'Inferred'));
  assert.equal(a['rows'][0].statement.citationStatus, 'resolved');
  assert.equal(a['rows'][1].statement.citationStatus, 'unverified', 'an unresolvable citation is downgraded, not dropped');
  assert.equal(a['rows'][1].statement.text, 'Reason 2.');
  assert.doesNotMatch(JSON.stringify(report), /"(score|percent|percentage|coverage)"|"Verified"/i);
});

test('a new run adds a record and the earlier one is kept (FR-016)', async (t) => {
  const { b, base, quiet } = await bench(t, ALIGNMENT);
  const count = (): number => {
    const db = new DatabaseSync(join(b.appData.dir, 'review.db'), { readOnly: true });
    try {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM spec_alignment_run').get() as { n: number }).n);
    } finally {
      db.close();
    }
  };
  const before = count();
  for (let i = 0; i < 2; i += 1) {
    const retry = await b.client.post(`${base}/retry`, {});
    assert.equal(retry.status, 202, retry.text);
    await waitFor(async () => ((await quiet())['alignment']?.runId === (retry.json as Json)['runId'] ? true : undefined), 'the run');
  }
  assert.equal(count(), before + 2, 'two more records, none removed');
});

test('output the workbench cannot read is kept as one inference with a warning, never as rows', async (t) => {
  const { b, base, quiet } = await bench(t, { not: 'an alignment' });
  const retry = await b.client.post(`${base}/retry`, {});
  const report = await waitFor(async () => {
    const r = await quiet();
    return r['alignment']?.runId === (retry.json as Json)['runId'] ? r : undefined;
  }, 'the run');
  assert.equal(report['alignment'].state, 'completed');
  assert.equal(report['alignment'].warning, 'unparseable-output');
  assert.deepEqual(report['alignment'].rows, []);
  assert.equal(report['alignment'].verdict.outcome, 'cannot-judge');
});
