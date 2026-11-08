// VO-066 (FR-009, FR-045, EC-11): after the workbench was killed while an answer streamed, another
// question waited and a summary run streamed, start-up recovery appends `cancelled` with `restart` for
// each: streamed chunks become one Inference, the queued question gets no claims, and the session
// still reads from storage. Recovery is idempotent.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { useTempAppData } from '../helpers/app-data.ts';

const HEAD = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';
const AT = '2026-11-07T00:00:00.000Z';
const ids = {
  session: '00000000-0000-4000-8000-000000000001',
  snapshot: '00000000-0000-4000-8000-000000000002',
  streaming: '00000000-0000-4000-8000-000000000003',
  queued: '00000000-0000-4000-8000-000000000004',
  run: '00000000-0000-4000-8000-000000000005',
};

test('VO-066 recovery appends cancelled with restart: chunks become one Inference, the queued question is cancelled with no claims', async (t) => {
  const appData = await useTempAppData(t);
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { recoverInterruptedWork } = await import('../../src/core/work-recovery.ts');

  const file = join(appData.dir, 'review.db');
  let db = openDatabase(file);
  let store = createReviewStore(db);
  const repo = { platform: 'scm-a', identifier: 'acme/widgets' };
  store.appendSession({ id: ids.session, pr: { repo, number: 1 }, createdAt: AT });
  store.upsertSessionStatus({ sessionId: ids.session, prStatus: 'open', statusNote: null, lastCheckedAt: AT, lastCheckedHead: HEAD, lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: AT });
  store.appendSnapshot({
    id: ids.snapshot, sessionId: ids.session, seq: 1, takenAt: AT, headCommit: HEAD, title: 't', description: 'd', author: 'a',
    sourceBranch: { repo, name: 'f' }, targetBranch: { repo, name: 'main' }, targetCommit: HEAD, baseCommit: HEAD,
    diffSource: 'local', diffFingerprint: 'f', repositoryStatus: 'found', repositoryReason: null, headRef: 'refs/prwb/x/y/head', targetRef: 'refs/prwb/x/y/target',
  });
  const question = (id: string, seq: number) => ({
    id, sessionId: ids.session, snapshotId: ids.snapshot, seq, askedAt: AT, text: `Question ${seq}?`, category: 'what' as const,
    audience: 'technical' as const, scope: { type: 'pr' as const, path: null, side: null, startLine: null, endLine: null, label: null },
    followsQuestionId: null, origin: 'typed' as const, provider: 'provider-one',
  });
  const prompt = { instructions: 'i', data: 'd', contextVersion: `${HEAD}:abc`, excludedFiles: [], dataChars: 1, restrictionsNotEnforced: ['a', 'b'], sentAt: AT };
  store.appendQuestion(question(ids.streaming, 1));
  store.appendStoredPrompt({ id: '00000000-0000-4000-8000-0000000000a1', questionId: ids.streaming, ...prompt });
  store.appendStreamChunk({ questionId: ids.streaming, seq: 0, text: 'The token is ', receivedAt: AT });
  store.appendStreamChunk({ questionId: ids.streaming, seq: 1, text: 'now reusable.', receivedAt: AT });
  store.appendQuestion(question(ids.queued, 2));
  store.appendSummaryRun({ id: ids.run, snapshotId: ids.snapshot, requestedAt: AT, provider: 'provider-one' });
  store.appendStoredPrompt({ id: '00000000-0000-4000-8000-0000000000a2', summaryRunId: ids.run, ...prompt });
  store.appendStreamChunk({ summaryRunId: ids.run, seq: 0, text: 'Summary so far', receivedAt: AT });
  db.close();

  // The workbench restarts on the same store.
  db = openDatabase(file);
  t.after(() => db.close());
  store = createReviewStore(db);
  const recovered = recoverInterruptedWork({ store });
  assert.deepEqual([...recovered.questions].sort(), [ids.streaming, ids.queued].sort());
  assert.deepEqual(recovered.summaryRuns, [ids.run]);

  const streamed = store.readAnswer(ids.streaming);
  assert.equal(streamed?.outcome, 'cancelled');
  assert.equal(streamed?.cancelReason, 'restart');
  assert.equal(streamed?.warning, 'cancelled');
  assert.equal(streamed?.rawText, 'The token is now reusable.');
  assert.equal(streamed?.contextVersion, `${HEAD}:abc`);
  const streamedClaims = store.listClaimsWithReferences({ answerId: streamed?.id ?? '' });
  assert.equal(streamedClaims.length, 1, 'the chunks became one claim');
  assert.equal(streamedClaims[0]?.text, 'The token is now reusable.');
  assert.equal(streamedClaims[0]?.label, 'inference');

  const queued = store.readAnswer(ids.queued);
  assert.equal(queued?.outcome, 'cancelled');
  assert.equal(queued?.cancelReason, 'restart');
  assert.equal(queued?.contextVersion, null, 'it never started');
  assert.equal(store.listClaims({ answerId: queued?.id ?? '' }).length, 0, 'no claims');

  const summary = store.readSummary(ids.run);
  assert.equal(summary?.outcome, 'cancelled');
  assert.equal(summary?.cancelReason, 'restart');
  const sections = store.listSummarySections(summary?.id ?? '');
  assert.deepEqual(sections.map((s) => s.kind), ['pr']);
  const summaryClaims = store.listClaims({ summarySectionId: sections[0]?.id ?? '' });
  assert.deepEqual(summaryClaims.map((c) => [c.text, c.label]), [['Summary so far', 'inference']]);

  assert.deepEqual(recoverInterruptedWork({ store }), { questions: [], summaryRuns: [] }, 'nothing left to recover');
  assert.ok(store.readSession(ids.session), 'the session reads from storage');
  assert.equal(store.listQuestions(ids.session).length, 2);
});
