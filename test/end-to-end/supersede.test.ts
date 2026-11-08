// VO-075 (FR-051, FR-053): when a refresh takes a newer snapshot, the question running on the older
// snapshot finishes against it, while the question and the summary run still waiting for it are kept,
// cancelled as superseded, and never run; the newer snapshot's summaries are queued.
//
// For the older snapshot's summary run to be waiting, the summary lane must be busy: the session's
// first snapshot's run is held in the fake CLI, so "snapshot 1" here is the session's second snapshot
// and "snapshot 2" its third.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { invocationKind, startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ANSWER = { claims: [{ text: 'Tokens are reusable.', label: 'inference', refs: [] }], unsupportedAssumptions: [], suggestedFollowUps: [] };
const SUMMARY = { prSummary: [{ text: 'Summary.', label: 'inference', refs: [] }], files: [], functionalImpact: [], technicalImpact: [] };

const summaries = async (bench: Workbench, sessionId: string, snapshotId: string) =>
  (await bench.client.get(`/api/sessions/${sessionId}/snapshots/${snapshotId}/summaries`)).json as Json[];
const questionOf = async (bench: Workbench, sessionId: string, id: string) =>
  ((await bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Json[]).find((q) => q.questionId === id);

test('VO-075 a refresh supersedes the waiting question and summary run of the older snapshot, while its running question completes', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'slow', answer: ANSWER, summary: SUMMARY } });
  const detail = await bench.startSession();
  const sessionId = detail.sessionId as string;
  await bench.fake!.waitForInvocations(1); // the first snapshot's summary run holds the summary lane

  const headOne = await bench.pushHead({ 'docs/one.md': '# one\n' });
  const one = ((await bench.client.post(`/api/sessions/${sessionId}/refresh`)).json as Json).snapshots[1];
  assert.equal(one.headCommit, headOne);
  const [waitingRun] = await waitFor(async () => {
    const list = await summaries(bench, sessionId, one.snapshotId);
    return list.length > 0 && list;
  }, "snapshot 1's summary run to be queued");
  assert.equal(waitingRun?.state, 'queued', "snapshot 1's summary run waits");

  const running = ((await bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'RUNNING question?' })).json as Json);
  await bench.fake!.waitForInvocations(2);
  const waiting = ((await bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'why', text: 'WAITING question?' })).json as Json);
  assert.equal(running.snapshotId, one.snapshotId);
  assert.equal((await questionOf(bench, sessionId, running.questionId))?.state, 'in_progress');
  assert.equal((await questionOf(bench, sessionId, waiting.questionId))?.state, 'queued');

  const headTwo = await bench.pushHead({ 'docs/two.md': '# two\n' });
  const two = ((await bench.client.post(`/api/sessions/${sessionId}/refresh`)).json as Json).snapshots[2];
  assert.equal(two.headCommit, headTwo);

  const superseded = await waitFor(async () => {
    const q = await questionOf(bench, sessionId, waiting.questionId);
    return q?.state === 'cancelled' && q;
  }, 'the waiting question to be cancelled');
  assert.equal(superseded.answer.claims.length, 0);
  assert.equal(bench.store.readAnswer(waiting.questionId)?.cancelReason, 'superseded');
  const [oldRun] = await summaries(bench, sessionId, one.snapshotId);
  assert.equal(oldRun?.state, 'cancelled', "snapshot 1's summary run is kept, cancelled");
  assert.equal(bench.store.readSummary(oldRun?.summaryId)?.cancelReason, 'superseded');
  const [newRun] = await waitFor(async () => {
    const list = await summaries(bench, sessionId, two.snapshotId);
    return list.length > 0 && list;
  }, "snapshot 2's summaries to be queued");
  assert.equal(newRun?.state, 'queued', "snapshot 2's summaries are queued");

  // Running work keeps its own snapshot's worktree until it ends (FR-051); only then is it removed.
  const answerRun = (await bench.fake!.invocations()).find((run) => invocationKind(run) === 'answer');
  const worktree = answerRun?.argv[answerRun.argv.indexOf('--add-dir') + 1] ?? '';
  assert.ok(existsSync(worktree), "the running question's worktree outlives the refresh");

  await bench.fake!.release(2);
  const finished = await waitFor(async () => {
    const q = await questionOf(bench, sessionId, running.questionId);
    return q?.state === 'completed' && q;
  }, 'the running question to complete');
  assert.equal(finished.snapshotId, one.snapshotId, 'against its own snapshot');
  assert.equal(finished.headCommit, headOne);
  assert.equal(finished.isLatestSnapshot, false);
  assert.ok((finished.answer.contextVersion as string).startsWith(`${headOne}:`));

  await bench.fake!.release();
  await waitFor(async () => (await summaries(bench, sessionId, two.snapshotId))[0]?.state === 'completed', "snapshot 2's summary to complete");
  const runs = await bench.fake!.invocations();
  assert.deepEqual(runs.map(invocationKind), ['summary', 'answer', 'summary'], 'no run for the superseded question or summary run');
  assert.ok(!runs.some((run) => run.stdin.includes('WAITING question?')));
  await waitFor(async () => !existsSync(worktree), 'the older worktree to be removed once the work running at refresh ended');
});
