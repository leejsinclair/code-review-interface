// VO-011 (FR-012), VO-021 (FR-051, FR-053), VO-046 (FR-032, EC-02), VO-065 (FR-032, EC-08) and the
// US2 half of VO-026 (FR-005, EC-01): summaries over HTTP with the fake AI CLI.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUE_URL, startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const code = (path: string, side: 'head' | 'base', startLine: number, endLine: number) => ({ kind: 'code', path, side, startLine, endLine });

const SUMMARY = {
  prSummary: [{ text: 'Reset tokens become reusable.', label: 'evidence', intent: 'documented', refs: [{ kind: 'issue', platform: 'jira-cloud', key: 'ABC-12' }] }],
  files: [
    { path: 'src/app.js', claims: [{ text: 'Values 40 to 60 are scaled by ten.', label: 'evidence', refs: [code('src/app.js', 'head', 40, 60)] }] },
    { path: 'src/util.js', claims: [{ text: 'The sub helper is removed.', label: 'evidence', refs: [code('src/util.js', 'base', 5, 7)] }] },
  ],
  functionalImpact: [{ text: 'A customer can reset a password twice.', label: 'inference', intent: 'documented', refs: [{ kind: 'pr' }] }],
  technicalImpact: [{ text: 'Callers of sub break.', label: 'evidence', refs: [code('src/missing.js', 'head', 1, 1)] }],
};
const ANSWER = { claims: [{ text: 'Values are scaled.', label: 'evidence', refs: [code('src/app.js', 'head', 45, 46)] }], unsupportedAssumptions: [], suggestedFollowUps: [] };

async function summaries(bench: Workbench, sessionId: string, snapshotId: string): Promise<Json[]> {
  const res = await bench.client.get(`/api/sessions/${sessionId}/snapshots/${snapshotId}/summaries`);
  assert.equal(res.status, 200, res.text);
  return res.json as Json[];
}

const settled = (s: Json | undefined) => s !== undefined && ['completed', 'failed', 'cancelled'].includes(s.state);

test('VO-011 a new snapshot generates summaries without a request: a PR summary, one per changed file, and functional and technical impact as labelled claims', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', summary: SUMMARY } });
  const detail = await bench.startSession();
  const snapshotId = detail.snapshots[0].snapshotId;
  const [summary] = await waitFor(async () => {
    const list = await summaries(bench, detail.sessionId, snapshotId);
    return settled(list[0]) && list;
  }, 'the summary to complete');

  assert.equal(summary?.state, 'completed');
  assert.equal(summary?.snapshotId, snapshotId);
  assert.equal(summary?.headCommit, detail.latestHeadCommit);
  assert.equal(summary?.provider, 'claude-code-cli');
  assert.match(summary?.contextVersion, new RegExp(`^${detail.latestHeadCommit}:[0-9a-f]{64}$`));
  assert.equal(summary?.rawText, undefined, 'completed: no raw text');
  assert.ok(summary?.completedAt);

  assert.deepEqual(summary?.prSummary.map((c: Json) => [c.text, c.label, c.intent]), [['Reset tokens become reusable.', 'evidence', 'documented']]);
  assert.deepEqual(summary?.files.map((f: Json) => f.path).sort(), ['src/app.js', 'src/util.js'], 'one per changed file');
  for (const file of summary?.files as Json[]) {
    assert.equal(file.claims.length, 1);
    assert.equal(file.claims[0].label, 'evidence', `${file.path}: its code ref resolves`);
    assert.equal(file.claims[0].refs[0].resolved, true);
  }
  assert.deepEqual(summary?.functionalImpact.map((c: Json) => [c.label, c.intent]), [['inference', 'documented']]);
  const [technical] = summary?.technicalImpact as Json[];
  assert.equal(technical?.label, 'inference', 'the workbench downgrades an Evidence claim whose ref does not resolve');
  assert.equal(technical?.labelledByProvider, 'evidence');
  assert.equal(technical?.refs[0].unresolvedReason, 'no such file at commit');

  const runs = await bench.fake!.invocations();
  assert.equal(runs.length, 1, 'one summary run, started by the snapshot alone');
});

test('VO-021 after a refresh new summaries are generated, older answers and summaries keep their head commit, and new questions use the new snapshot', async (t) => {
  const bench = await startWorkbench(t, { fake: { scenario: 'structured', summary: SUMMARY, answer: ANSWER } });
  const detail = await bench.startSession();
  const sessionId = detail.sessionId;
  const first = detail.snapshots[0];
  await waitFor(async () => settled((await summaries(bench, sessionId, first.snapshotId))[0]), 'the first summary');

  const asked = await bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What changes?' });
  assert.equal(asked.status, 202, asked.text);
  const oldQuestion = (asked.json as Json).questionId;
  await waitFor(async () => ((await bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Json[])[0]?.state === 'completed', 'the first answer');

  const newHead = await bench.pushHead({ 'docs/notes.md': '# notes\n' });
  const refreshed = await bench.client.post(`/api/sessions/${sessionId}/refresh`);
  assert.equal(refreshed.status, 200, refreshed.text);
  const second = (refreshed.json as Json).snapshots[1];
  assert.equal(second.headCommit, newHead);

  const [latest] = await waitFor(async () => {
    const list = await summaries(bench, sessionId, second.snapshotId);
    return settled(list[0]) && list;
  }, 'the new snapshot summary, generated without a request');
  assert.equal(latest?.state, 'completed');
  assert.equal(latest?.headCommit, newHead);

  const older = await summaries(bench, sessionId, first.snapshotId);
  assert.equal(older.length, 1, 'the earlier summary is kept');
  assert.equal(older[0]?.headCommit, first.headCommit, 'with its own head commit');

  const next = await bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'risk', text: 'What could break?' });
  assert.equal(next.status, 202, next.text);
  assert.equal((next.json as Json).snapshotId, second.snapshotId, 'a new question applies to the new snapshot');
  const listed = (await bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Json[];
  const old = listed.find((q) => q.questionId === oldQuestion);
  assert.equal(old?.isLatestSnapshot, false, 'the earlier answer is marked older');
  assert.equal(old?.headCommit, first.headCommit);
  assert.equal(old?.state, 'completed');
});

test('VO-046 with the tracker returning 500 and the provider failing on start, summaries show failed with the reason while PR, diff and repository rows return', async (t) => {
  const bench = await startWorkbench(t, {
    fake: { scenario: 'error-on-start' },
    drop: (url) => url === ISSUE_URL,
    extra: [{ request: { url: ISSUE_URL }, response: { status: 500, body: { errorMessages: ['Internal server error'] } } }],
  });
  const detail = await bench.startSession();
  const snapshotId = detail.snapshots[0].snapshotId;
  const [summary] = await waitFor(async () => {
    const list = await summaries(bench, detail.sessionId, snapshotId);
    return settled(list[0]) && list;
  }, 'the summary to fail');
  assert.equal(summary?.state, 'failed');
  assert.match(summary?.failureReason ?? '', /failed to start/, 'the provider error is the reason');

  const read = (await bench.client.get(`/api/sessions/${detail.sessionId}`)).json as Json;
  const row = (source: string) => (read.completeness as Json[]).find((r) => r.source === source);
  assert.equal(row('pr')?.status, 'found');
  assert.equal(row('repository')?.status, 'found');
  const issue = (read.issues as Json[]).find((i) => i.key === 'ABC-12');
  assert.equal(issue?.status, 'missing');
  assert.ok(issue?.reason, 'the issue row carries the failure reason');
  const diff = await bench.client.get(`/api/sessions/${detail.sessionId}/snapshots/${snapshotId}/diff?path=src%2Futil.js`);
  assert.equal(diff.status, 200, 'the diff still returns');
});

test('VO-065 with the CLI missing, and with it not signed in, the provider is unavailable with the reason while PR context loads', async (t) => {
  await t.test('VO-065 CLI not installed', async (t) => {
    const bench = await startWorkbench(t, { fake: null });
    const provider = (await bench.client.get('/api/provider')).json as Json;
    assert.equal(provider.id, 'claude-code-cli');
    assert.equal(provider.installed, false);
    assert.equal(provider.available, false);
    assert.match(provider.unavailableReason, /not installed/);
    const detail = await bench.startSession();
    assert.equal((await bench.client.get(`/api/sessions/${detail.sessionId}`)).status, 200, 'context loads');
    const asked = await bench.client.post(`/api/sessions/${detail.sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What?' });
    assert.equal(asked.status, 503);
    assert.equal((asked.json as Json).error.code, 'provider_unavailable');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await summaries(bench, detail.sessionId, detail.snapshots[0].snapshotId), [], 'no summary run is queued');
  });

  await t.test('VO-065 CLI not signed in', async (t) => {
    const bench = await startWorkbench(t, { fake: { scenario: 'not-signed-in' } });
    const provider = (await bench.client.get('/api/provider')).json as Json;
    assert.equal(provider.installed, true);
    assert.equal(provider.available, false);
    assert.match(provider.unavailableReason, /not signed in/);
    const detail = await bench.startSession();
    assert.equal((await bench.client.get(`/api/sessions/${detail.sessionId}`)).status, 200, 'context loads');
    const asked = await bench.client.post(`/api/sessions/${detail.sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What?' });
    assert.equal(asked.status, 503);
    assert.equal((asked.json as Json).error.code, 'provider_unavailable');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await summaries(bench, detail.sessionId, detail.snapshots[0].snapshotId), []);
    assert.equal((await bench.fake!.invocations()).length, 0, 'no provider run started');
  });
});

test('VO-026 a session without an isolated workspace queues no summary and reports the repository row reason', async (t) => {
  const bench = await startWorkbench(t, { clone: 'missing', fake: { scenario: 'structured', summary: SUMMARY } });
  const detail = await bench.startSession();
  const repository = (detail.completeness as Json[]).find((r) => r.source === 'repository');
  assert.equal(repository?.status, 'missing');
  assert.ok(repository?.reason, 'the repository row has a reason');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await summaries(bench, detail.sessionId, detail.snapshots[0].snapshotId), [], 'no summary run');
  assert.equal((await bench.fake!.invocations()).length, 0, 'the provider never ran');
});
