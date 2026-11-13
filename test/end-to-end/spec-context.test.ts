// US1 end to end (FR-004, FR-005, FR-008): through the composed server, the report names where each document was
// read from, a matching branch beats `develop` and the `develop` copy is named, and the stored text is served exactly.
// The git lookup itself (own repository first, enclosing second, working copy untouched) is proved in
// test/integration/spec-lookup-git.test.ts and spec-context-service.test.ts; here the stored records are seeded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWorkbench, waitFor } from '../helpers/fake-ai-cli.ts';
import { seedSpec, SPEC_TEXT, TDD_TEXT } from '../helpers/spec-seed.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function bench(t: Parameters<typeof startWorkbench>[0], seed: Parameters<typeof seedSpec>[2] = {}) {
  const b = await startWorkbench(t, { composed: true } as never);
  const detail = await b.startSession(1);
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Json[]).at(-1)!['snapshotId'] as string;
  const seeded = seedSpec(b.store, snapshotId, seed);
  const base = `/api/sessions/${sessionId}/snapshots/${snapshotId}/spec-context`;
  // The session's own lookup runs in the background and reports `searching` until it ends.
  await waitFor(async () => {
    const r = (await b.client.get(base)).json as Json;
    return r['status'] !== 'searching' && !['pending', 'running'].includes(r['alignment']?.state);
  }, 'the session\'s own lookup and run to end');
  return { b, base, seeded };
}

test('a specification on develop is reported with its repository, branch, commit and folder', async (t) => {
  const { b, base, seeded } = await bench(t);
  const report = (await b.client.get(base)).json as Json;
  assert.equal(report['status'], 'ready');
  const [spec, tdd] = report["keys"][0].documents as [Json, Json];
  assert.equal(spec['status'], 'found');
  assert.equal(spec['source'].used.repository, 'project-hd-v3');
  assert.equal(spec['source'].used.branch, 'develop');
  assert.equal(spec['source'].used.commit, '1'.repeat(40));
  assert.equal(spec['source'].used.folder, 'specs/006-ABC-12-x');
  assert.equal(spec['fileName'], 'spec.md');
  assert.equal(tdd['fileName'], 'tdd-evidence.md');
  assert.equal(spec['documentId'], seeded.specDocumentId);
});

test('a matching branch beats develop and the develop copy is named (FR-004)', async (t) => {
  const { b, base } = await bench(t, { branch: 'feature/ABC-12-x' });
  const spec = ((await b.client.get(base)).json as Json)['keys'][0].documents[0] as Json;
  assert.equal(spec['source'].used.branch, 'feature/ABC-12-x');
  assert.equal(spec['source'].rule, 'matching-branch-over-develop');
  assert.deepEqual(spec['source'].others.map((o: Json) => o['branch']), ['develop']);
});

test('the stored text is served exactly as read, as plain text, for both documents (FR-008)', async (t) => {
  const { b, base, seeded } = await bench(t);
  for (const [id, text] of [[seeded.specDocumentId, SPEC_TEXT], [seeded.tddDocumentId, TDD_TEXT]] as const) {
    const res = await b.client.get(`${base}/documents/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.text, text);
    assert.match(String(res.headers?.['content-type'] ?? ''), /^text\/plain/);
  }
});

test('the report holds both summaries as inferences with their source, and no score', async (t) => {
  const { b, base } = await bench(t);
  const report = (await b.client.get(base)).json as Json;
  assert.equal(report['alignment'].state, 'completed');
  assert.ok(report['alignment'].summaries.specification.length > 0);
  assert.ok(report['alignment'].summaries.tddEvidence.length > 0);
  assert.doesNotMatch(JSON.stringify(report), /"(score|percent|percentage|coverage)"/i);
});
