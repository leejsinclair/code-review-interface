// Interrogation over HTTP with the fake AI CLI: VO-012 (FR-013, FR-014, FR-034), VO-015 (FR-048,
// FR-024), VO-016 (FR-020), VO-019 (FR-035, FR-016), VO-020 (FR-047, FR-050), VO-032 (FR-021),
// VO-056 (FR-045), VO-057 (FR-046), VO-059 (FR-053), VO-070 (FR-021), VO-073 (FR-008), and the US2
// halves of VO-008 (FR-041) and VO-026 (FR-005).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invocationKind, startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const code = (path: string, side: 'head' | 'base', startLine: number, endLine: number) => ({ kind: 'code', path, side, startLine, endLine });
const ANSWER = {
  claims: [
    { text: 'Values 40 to 60 are scaled by ten to support a second reset.', label: 'evidence', refs: [code('src/app.js', 'head', 45, 50), { kind: 'issue', platform: 'jira-cloud', key: 'ABC-12' }] },
    { text: 'The PR says tokens are reusable.', label: 'inference', intent: 'documented', refs: [{ kind: 'pr' }] },
  ],
  unsupportedAssumptions: ['Reset tokens are stored server side.'],
  suggestedFollowUps: ['What expires a reset token?'],
};
const SUMMARY = { prSummary: [], files: [], functionalImpact: [], technicalImpact: [] };

const ask = (bench: Workbench, sessionId: string, body: Json) => bench.client.post(`/api/sessions/${sessionId}/questions`, body);
const questions = async (bench: Workbench, sessionId: string) => (await bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Json[];
const question = async (bench: Workbench, sessionId: string, id: string) => (await questions(bench, sessionId)).find((q) => q.questionId === id);
const settled = (q: Json | undefined) => q !== undefined && ['completed', 'failed', 'cancelled'].includes(q.state);
const answered = (bench: Workbench, sessionId: string, id: string) =>
  waitFor(async () => {
    const q = await question(bench, sessionId, id);
    return settled(q) && q;
  }, `question ${id} to finish`);

async function started(bench: Workbench): Promise<{ sessionId: string; detail: Json }> {
  const detail = await bench.startSession();
  return { sessionId: detail.sessionId, detail };
}

test('VO-012 a range 40-60 Why question is stored with its scope and category, its prompt is scoped to the range, and each cited line opens in the diff', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId, detail } = await started(bench);
  const res = await ask(bench, sessionId, {
    scope: { type: 'range', path: 'src/app.js', side: 'head', startLine: 40, endLine: 60, label: 'resetValues' },
    category: 'why',
    text: 'Why are these values scaled?',
  });
  assert.equal(res.status, 202, res.text);
  const asked = res.json as Json;
  assert.ok(['queued', 'in_progress'].includes(asked.state));
  assert.deepEqual(asked.scope, { type: 'range', path: 'src/app.js', side: 'head', startLine: 40, endLine: 60, label: 'resetValues' });
  assert.equal(asked.category, 'why');
  assert.equal(asked.answerFor, 'technical', 'Answer for defaults to Technical');
  const done = await answered(bench, sessionId, asked.questionId);
  assert.equal(done.state, 'completed');

  const stored = bench.store.readQuestion(asked.questionId);
  assert.deepEqual(stored?.scope, { type: 'range', path: 'src/app.js', side: 'new', startLine: 40, endLine: 60, label: 'resetValues' });
  assert.equal(stored?.category, 'why');
  const prompt = bench.store.readStoredPrompt({ questionId: asked.questionId });
  assert.match(prompt?.data ?? '', /Scope: lines 40-60 of src\/app\.js \(new side\), labelled "resetValues"/);
  assert.match(prompt?.data ?? '', /Category: Why/);
  assert.ok(!(prompt?.data ?? '').includes('export const version = 2;'), 'other files are not in a range-scoped prompt');

  const ref = done.answer.claims[0].refs[0];
  assert.deepEqual([ref.kind, ref.path, ref.side, ref.startLine, ref.resolved], ['code', 'src/app.js', 'head', 45, true]);
  const diff = (await bench.client.get(`/api/sessions/${sessionId}/snapshots/${detail.snapshots[0].snapshotId}/diff?path=src%2Fapp.js`)).json as Json;
  const lines = (diff.hunks as Json[]).flatMap((h) => h.lines).filter((l: Json) => l.newLine !== undefined).map((l: Json) => l.newLine);
  assert.ok(lines.includes(45) && lines.includes(50), 'the cited lines are in the diff');

  const outside = await ask(bench, sessionId, { scope: { type: 'range', path: 'src/app.js', side: 'head', startLine: 1, endLine: 5 }, category: 'why', text: 'Why?' });
  assert.equal(outside.status, 400, 'a range outside the lines the diff shows is refused');
  assert.equal((outside.json as Json).error.code, 'invalid_request');
  const notChanged = await ask(bench, sessionId, { scope: { type: 'file', path: 'README.md' }, category: 'what', text: 'What?' });
  assert.equal(notChanged.status, 400, 'a file scope must be a changed file');
});

test('VO-015 a Business question is stored with Business, its prompt carries the business-reader rule, and it keeps the claims, labels and references', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const body = { scope: { type: 'pr' }, category: 'requirement', text: 'Can a customer reset a password more than once?' };
  const technical = (await ask(bench, sessionId, body)).json as Json;
  const business = (await ask(bench, sessionId, { ...body, answerFor: 'business' })).json as Json;
  assert.equal(business.answerFor, 'business');
  const [t1, b1] = [await answered(bench, sessionId, technical.questionId), await answered(bench, sessionId, business.questionId)];

  assert.equal(bench.store.readQuestion(business.questionId)?.audience, 'business');
  const businessPrompt = bench.store.readStoredPrompt({ questionId: business.questionId });
  const technicalPrompt = bench.store.readStoredPrompt({ questionId: technical.questionId });
  assert.match(businessPrompt?.instructions ?? '', /business reader/i);
  assert.match(businessPrompt?.instructions ?? '', /code identifiers/i);
  assert.doesNotMatch(technicalPrompt?.instructions ?? '', /business reader/i);
  const shape = (q: Json) => q.answer.claims.map((c: Json) => [c.label, c.refs.map((r: Json) => [r.kind, r.resolved])]);
  assert.deepEqual(shape(b1), shape(t1), 'the same claims, labels and references');
  assert.ok(!(businessPrompt?.data ?? '').includes('export const value45'), 'a Requirements question draws only on issue text');
  assert.ok((businessPrompt?.data ?? '').includes('Customers cannot reset a password'), 'it carries the issue text');
});

test('VO-016 after a server restart on the same store the answer returns with provider, time and context version', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const asked = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What changes?' })).json as Json;
  const before = await answered(bench, sessionId, asked.questionId);

  await bench.restart();
  const after = await question(bench, sessionId, asked.questionId);
  assert.equal(after?.state, 'completed');
  assert.equal(after?.answer.provider, 'claude-code-cli');
  assert.equal(after?.answer.completedAt, before.answer.completedAt);
  assert.match(after?.answer.contextVersion, /^[0-9a-f]{40}:[0-9a-f]{64}$/);
  assert.equal(after?.answer.contextVersion, before.answer.contextVersion);
  assert.ok(after?.askedAt);
  assert.ok(bench.store.readStoredPrompt({ questionId: asked.questionId }), 'the stored prompt is kept');
});

test('VO-019 a cited removed line opens at the base commit and a file outside the diff at the head commit', async (t) => {
  const bench = await startWorkbench(t, {
    fake: {
      scenario: 'structured',
      summary: SUMMARY,
      answer: { claims: [{ text: 'sub was removed and the README is unchanged.', label: 'evidence', refs: [code('src/util.js', 'base', 5, 7), code('README.md', 'head', 1, 1)] }], unsupportedAssumptions: [], suggestedFollowUps: [] },
    },
  });
  const { sessionId, detail } = await started(bench);
  const asked = (await ask(bench, sessionId, { scope: { type: 'file', path: 'src/util.js' }, category: 'what', text: 'What was removed?' })).json as Json;
  const done = await answered(bench, sessionId, asked.questionId);
  const [removed, other] = done.answer.claims[0].refs as Json[];
  assert.equal(removed?.resolved, true);
  assert.equal(other?.resolved, true);

  const snapshot = detail.snapshots[0];
  const base = await bench.client.get(`/api/sessions/${sessionId}/snapshots/${snapshot.snapshotId}/file?side=base&path=src%2Futil.js`);
  assert.equal(base.status, 200, base.text);
  assert.equal((base.json as Json).commit, snapshot.baseCommit);
  assert.equal((base.json as Json).lines[4], 'export function sub(a, b) {', 'line 5 at base is the removed line');
  const head = await bench.client.get(`/api/sessions/${sessionId}/snapshots/${snapshot.snapshotId}/file?side=head&path=README.md`);
  assert.equal(head.status, 200, head.text);
  assert.equal((head.json as Json).commit, snapshot.headCommit);
  assert.equal((head.json as Json).lines[0], '# widgets');
  const gone = await bench.client.get(`/api/sessions/${sessionId}/snapshots/${snapshot.snapshotId}/file?side=head&path=no%2Fsuch.js`);
  assert.equal(gone.status, 404);
});

test('VO-020 a follow-up stores its parent, copies its scope, and its prompt holds the parent and its claims but not the first question', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const first = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'FIRST question about the change?' })).json as Json;
  await answered(bench, sessionId, first.questionId);
  await bench.fake!.configure({
    scenario: 'structured',
    summary: SUMMARY,
    answer: { claims: [{ text: 'SECOND-CLAIM tokens are reused.', label: 'inference', refs: [] }], unsupportedAssumptions: [], suggestedFollowUps: ['What expires a reset token?'] },
  });
  const secondScope = { type: 'file', path: 'src/util.js' };
  const second = (await ask(bench, sessionId, { scope: secondScope, category: 'how', text: 'SECOND question about util?' })).json as Json;
  const secondDone = await answered(bench, sessionId, second.questionId);
  const followText = secondDone.answer.suggestedFollowUps[0];

  const res = await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: followText, followsQuestionId: second.questionId });
  assert.equal(res.status, 202, res.text);
  const follow = res.json as Json;
  assert.equal(follow.followsQuestionId, second.questionId);
  assert.deepEqual(follow.scope, secondScope, 'the same scope as its parent');
  assert.equal(follow.text, 'What expires a reset token?');
  await answered(bench, sessionId, follow.questionId);
  const stored = bench.store.readQuestion(follow.questionId);
  assert.equal(stored?.followsQuestionId, second.questionId);
  assert.equal(stored?.origin, 'follow-up');
  const data = bench.store.readStoredPrompt({ questionId: follow.questionId })?.data ?? '';
  assert.ok(data.includes('SECOND question about util?'), 'the parent question');
  assert.ok(data.includes('SECOND-CLAIM tokens are reused.'), "the parent answer's claims");
  assert.ok(!data.includes('FIRST question'), 'not the first question');
  assert.ok(!data.includes('Values 40 to 60 are scaled'), "not the first answer's claims");
});

test('VO-032 deltas arrive marked in progress and are then replaced by the labelled claims', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'slow', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const stream = await bench.subscribe(sessionId);
  t.after(() => stream.close());
  await bench.fake!.waitForInvocations(1); // the summary run, held
  const asked = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What changes?' })).json as Json;
  await bench.fake!.waitForInvocations(2);

  const delta = await waitFor(() => stream.events.find((e) => e.event === 'answer-delta' && (e.data as Json).questionId === asked.questionId), 'an answer-delta event');
  assert.ok(((delta.data as Json).text as string).length > 0);
  const running = await question(bench, sessionId, asked.questionId);
  assert.equal(running?.state, 'in_progress', 'marked in progress');
  assert.ok((running?.answer.rawText as string).length > 0, 'the raw text so far, not yet checked');
  assert.deepEqual(running?.answer.claims, []);

  await bench.fake!.release();
  const done = await answered(bench, sessionId, asked.questionId);
  assert.equal(done.state, 'completed');
  assert.equal(done.answer.rawText, undefined, 'the raw text is replaced');
  assert.equal(done.answer.claims.length, 2);
  const completedEvent = await waitFor(
    () => stream.events.find((e) => e.event === 'question' && (e.data as Json).questionId === asked.questionId && (e.data as Json).state === 'completed'),
    'the completed question event',
  );
  assert.equal((completedEvent.data as Json).answer.claims.length, 2);
  assert.equal((completedEvent.data as Json).answer.rawText, undefined);
});

test('VO-056 a question cancelled mid-answer keeps the text received as one cancelled Inference', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'slow', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  await bench.fake!.waitForInvocations(1);
  const asked = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What changes?' })).json as Json;
  await waitFor(() => bench.store.listStreamChunks({ questionId: asked.questionId }).length > 0, 'the first chunk');

  const cancelled = await bench.client.post(`/api/sessions/${sessionId}/questions/${asked.questionId}/cancel`);
  assert.equal(cancelled.status, 202, cancelled.text);
  const body = cancelled.json as Json;
  assert.equal(body.state, 'cancelled');
  assert.equal(body.answer.warning, 'cancelled');
  assert.equal(body.answer.claims.length, 1, 'one claim');
  assert.equal(body.answer.claims[0].label, 'inference');
  const received = bench.store.listStreamChunks({ questionId: asked.questionId }).map((c) => c.text).join('');
  assert.equal(body.answer.claims[0].text, received, 'holding the text received');
  assert.equal(bench.store.readAnswer(asked.questionId)?.cancelReason, 'user');

  const again = await bench.client.post(`/api/sessions/${sessionId}/questions/${asked.questionId}/cancel`);
  assert.equal(again.status, 409);
  assert.equal((again.json as Json).error.code, 'not_cancellable');
});

test('VO-057 unsupported assumptions are returned apart from the claims', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const asked = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'risk', text: 'What could break?' })).json as Json;
  const done = await answered(bench, sessionId, asked.questionId);
  assert.deepEqual(done.answer.unsupportedAssumptions, ['Reset tokens are stored server side.']);
  assert.ok(!(done.answer.claims as Json[]).some((c) => c.text === 'Reset tokens are stored server side.'), 'not among the claims');
  assert.deepEqual(done.answer.suggestedFollowUps, ['What expires a reset token?']);
});

test('VO-059 three questions during a summary run one at a time in order, and a cancelled queued one never runs', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'slow', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  await bench.fake!.waitForInvocations(1); // the summary run, held
  const ids: string[] = [];
  for (const text of ['Q-ONE first?', 'Q-TWO second?', 'Q-THREE third?']) {
    const res = await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text });
    assert.equal(res.status, 202, res.text);
    ids.push((res.json as Json).questionId);
  }
  const runs = await bench.fake!.waitForInvocations(2);
  assert.equal(invocationKind(runs[1]!), 'answer');
  assert.ok(runs[1]!.stdin.includes('Q-ONE'), 'the first question runs alongside the summary');
  const states = async () => Promise.all(ids.map(async (id) => (await question(bench, sessionId, id))?.state));
  assert.deepEqual(await states(), ['in_progress', 'queued', 'queued'], 'the others wait in order');

  const cancelled = await bench.client.post(`/api/sessions/${sessionId}/questions/${ids[1]}/cancel`);
  assert.equal(cancelled.status, 202, cancelled.text);
  assert.equal((cancelled.json as Json).state, 'cancelled');
  assert.equal((cancelled.json as Json).answer.claims.length, 0, 'a queued question has no claims');

  await bench.fake!.release(2);
  await answered(bench, sessionId, ids[0]!);
  const third = await bench.fake!.waitForInvocations(3);
  assert.ok(third[2]!.stdin.includes('Q-THREE'), 'the third question runs next');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await bench.fake!.invocations()).length, 3, 'only one question runs at a time');
  await bench.fake!.release();
  await answered(bench, sessionId, ids[2]!);
  const all = await bench.fake!.invocations();
  assert.ok(!all.some((run) => run.stdin.includes('Q-TWO')), 'the cancelled queued question never ran');
  assert.deepEqual(await states(), ['completed', 'cancelled', 'completed']);
});

test('VO-070 a completed answer read back has checked references and nothing marked in progress', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const asked = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'how', text: 'How does it work?' })).json as Json;
  await answered(bench, sessionId, asked.questionId);
  const [read] = await questions(bench, sessionId);
  assert.equal(read?.state, 'completed');
  assert.equal(read?.answer.rawText, undefined);
  assert.ok(read?.answer.completedAt);
  assert.equal(read?.answer.warning, undefined);
  for (const claim of read?.answer.claims as Json[]) {
    for (const ref of claim.refs as Json[]) assert.equal(typeof ref.resolved, 'boolean', 'every reference was checked');
  }
  assert.equal(read?.answer.claims[0].refs[1].resolved, true, 'the fetched issue resolves');
});

test('VO-073 the clone fingerprint is unchanged across a question answered and a question cancelled mid-answer', async (t) => {
  const bench = await startWorkbench(t, { dirty: true, fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const before = await bench.sandbox!.fingerprint();
  const answeredQ = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What changes?' })).json as Json;
  await answered(bench, sessionId, answeredQ.questionId);
  assert.deepEqual(await bench.sandbox!.fingerprint(), before, 'unchanged after an answer');

  await bench.fake!.configure({ scenario: 'slow', answer: ANSWER, summary: SUMMARY });
  const cancelledQ = (await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'why', text: 'Why?' })).json as Json;
  await waitFor(() => bench.store.listStreamChunks({ questionId: cancelledQ.questionId }).length > 0, 'the first chunk');
  const res = await bench.client.post(`/api/sessions/${sessionId}/questions/${cancelledQ.questionId}/cancel`);
  assert.equal((res.json as Json).state, 'cancelled');
  assert.deepEqual(await bench.sandbox!.fingerprint(), before, 'unchanged after a cancel mid-answer');
});

test('VO-008 a read-only session refuses questions with read_only', async (t) => {
  const bench = await startWorkbench(t, { prStates: ['open', 'merged'], fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId } = await started(bench);
  const opened = await bench.client.post(`/api/sessions/${sessionId}/open`);
  assert.equal((opened.json as Json).readOnly, true);
  const res = await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What?' });
  assert.equal(res.status, 409);
  assert.equal((res.json as Json).error.code, 'read_only');
});

test('VO-026 a no-clone session refuses questions with workspace_unavailable and the repository row reason', async (t) => {
  const bench = await startWorkbench(t, { clone: 'missing', fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY } });
  const { sessionId, detail } = await started(bench);
  const reason = (detail.completeness as Json[]).find((r) => r.source === 'repository')?.reason;
  const res = await ask(bench, sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What?' });
  assert.equal(res.status, 409);
  assert.equal((res.json as Json).error.code, 'workspace_unavailable');
  assert.equal((res.json as Json).error.message, reason);
  assert.equal((await bench.fake!.invocations()).length, 0);
});
