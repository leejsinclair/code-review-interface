// T029 (US2 AS1-AS7; FR-019, FR-022, FR-032, FR-034; SC-005, SC-006): the full review journey
// against the local GitLab, with the real server, store and Git and the fake AI CLI.
//
// The reviewer's clone is an HTTP clone whose git credential lives in a temp HOME (liveClone), the
// way a reviewer's own git would hold it; the product reads that HOME when it fetches. The product
// gets the run's reviewer token only through its credential store.
//
// Reopen (AS5): the product keeps a closed session read-only and marks it "reopened on platform"
// once the platform reports the merge request open again (001, VO-076). This file asserts that note.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { startWorkbench, waitFor, type Workbench } from '../helpers/fake-ai-cli.ts';
import type { CloneFingerprint } from '../helpers/git-sandbox.ts';
import { liveClone, type LiveClone } from '../helpers/git-sandbox.ts';
import { loggedFetch } from '../helpers/logged-fetch.ts';
import { GitlabAdmin, GitlabSeeder } from '../seeder/gitlab-seeder.ts';
import type { SeededPull } from '../seeder/platform-seeder.ts';
import { ownedBy } from '../seeder/run-name.ts';
import { GITLAB_TOKEN, GITLAB_URL, gitlabGate } from './env.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CLEANUP_TIMEOUT_MS = 300_000;
const STEP_MS = 60_000;
const ANSWER = {
  claims: [{ text: 'The reset counter is scaled for a second reset.', label: 'evidence', refs: [{ kind: 'pr' }] }],
  unsupportedAssumptions: [],
  suggestedFollowUps: [],
};
const SUMMARY = { prSummary: [], files: [], functionalImpact: [], technicalImpact: [] };
const APP_V1 = Array.from({ length: 60 }, (_, i) => `export const value${i + 1} = ${i + 1};`).join('\n') + '\n';
const APP_V2 = Array.from({ length: 60 }, (_, i) => (i + 1 >= 40 ? `export const value${i + 1} = ${(i + 1) * 10}; // reset` : `export const value${i + 1} = ${i + 1};`)).join('\n') + '\n';

const gate = await gitlabGate();

if (gate.skip !== undefined) {
  test('GitLab review lifecycle', gate, () => {});
} else {
  const seeder = new GitlabSeeder({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const admin = new GitlabAdmin({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  let runName = '';
  let clone: LiveClone | null = null;
  const savedHome = process.env.HOME;

  after(
    async () => {
      process.env.HOME = savedHome;
      await clone?.cleanup();
      if (runName === '') return;
      await seeder.cleanup();
      const items = await admin.listRunItems();
      const mine = [...items.projects.map((p) => p.path), ...items.groups.map((g) => g.path), ...items.users.map((u) => u.username)].filter((n) => ownedBy(runName, n));
      assert.deepEqual(mine, [], `run ${runName} left items behind`);
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  );

  test('GitLab review lifecycle: open, ask, new head, close, merge, delete, reopen, restart', { timeout: 10 * STEP_MS }, async (t) => {
    // ---------------------------------------------------------------- seeding
    const run = await seeder.begin('lifecycle');
    runName = run.name;
    const review = await seeder.createRepository('review');
    await seeder.pushCommit(review, 'main', [
      { kind: 'add', path: 'src/app.js', content: APP_V1 },
      { kind: 'add', path: 'src/util.js', content: 'export const version = 1;\n' },
    ]);
    const issue = await seeder.createIssue(review, { title: 'Customers cannot reset a password twice', description: 'Steps:\n1. Reset once.\n2. Reset again.' });
    await seeder.pushCommit(review, 'feature/reset', [{ kind: 'edit', path: 'src/app.js', content: APP_V2 }]);
    const main = await seeder.openPullRequest(review, { source: 'feature/reset', target: 'main', title: 'Allow a second password reset', description: `Closes #${issue.number}` });
    const others: SeededPull[] = [];
    for (const name of ['close', 'merge', 'delete']) {
      await seeder.pushCommit(review, `chore/${name}`, [{ kind: 'add', path: `docs/${name}.md`, content: `# ${name}\n` }]);
      others.push(await seeder.openPullRequest(review, { source: `chore/${name}`, target: 'main', title: `Chore: ${name}` }));
    }
    const [toClose, toMerge, toDelete] = others as [SeededPull, SeededPull, SeededPull];

    // ---------------------------------------------------------------- reviewer side
    const reviewerClone = await liveClone(review.httpUrl, run.reviewer.token);
    clone = reviewerClone;
    process.env.HOME = reviewerClone.home;
    const before: CloneFingerprint = await reviewerClone.fingerprint();
    const unchanged = async (step: string): Promise<void> => assert.deepEqual(await reviewerClone.fingerprint(), before, `the reviewer clone is unchanged after ${step}`);

    const network = loggedFetch();
    const credential = { secret: run.reviewer.token, scheme: 'bearer' as const };
    const bench: Workbench = await startWorkbench(t, {
      fake: { scenario: 'structured', answer: ANSWER, summary: SUMMARY },
      live: {
        repository: { platform: 'gitlab', id: review.id, baseUrl: GITLAB_URL },
        issueTracker: { platform: 'gitlab-issues', site: GITLAB_URL },
        credentials: { gitlab: credential, 'gitlab-issues': credential },
        clonePath: reviewerClone.clone,
        fetch: network.fetch,
      },
    });
    const api = bench.client;
    const detailOf = async (sessionId: string): Promise<Json> => (await api.get(`/api/sessions/${sessionId}`)).json as Json;
    const check = async (sessionId: string): Promise<Json> => {
      const res = await api.post(`/api/sessions/${sessionId}/open`);
      assert.equal(res.status, 200, res.text);
      return res.json as Json;
    };
    const ask = async (sessionId: string, body: Json): Promise<Json> => {
      const res = await api.post(`/api/sessions/${sessionId}/questions`, body);
      assert.equal(res.status, 202, res.text);
      const asked = res.json as Json;
      return waitFor(
        async () => {
          const q = ((await api.get(`/api/sessions/${sessionId}/questions`)).json as Json[]).find((x) => x.questionId === asked.questionId);
          return q !== undefined && ['completed', 'failed', 'cancelled'].includes(q.state) && q;
        },
        `question ${asked.questionId} to finish`,
        STEP_MS,
      );
    };
    const questionsOf = async (sessionId: string): Promise<Json[]> => (await api.get(`/api/sessions/${sessionId}/questions`)).json as Json[];

    await t.test('FR-016 a non-loopback http base address is refused with the validator message', async () => {
      const current = (await api.get('/api/config')).json as Json;
      const res = await api.put('/api/config', { ...current, workspace: { ...current.workspace, baseUrl: 'http://gitlab.example.com' } });
      assert.equal(res.status, 400, res.text);
      assert.match((res.json as Json).error.message, /must use https, or http on a loopback address/);
    });

    let sessionId = '';
    let firstQuestion: Json = {};
    await t.test('AS1 opening the merge request starts one session with its commits, files, linked issue and summaries', async () => {
      const detail = await bench.startSession(main.number, review.id);
      sessionId = detail.sessionId;
      assert.equal(detail.platform, 'gitlab');
      assert.equal(detail.repository, review.id);
      assert.equal(detail.title, main.title);
      assert.equal(detail.latestHeadCommit, main.headCommit);
      assert.equal(detail.snapshots.length, 1);
      const snapshot = (await api.get(`/api/sessions/${sessionId}/snapshots/${detail.snapshots[0].snapshotId}`)).json as Json;
      assert.deepEqual(snapshot.commits.map((c: Json) => c.sha).at(-1), main.headCommit);
      assert.deepEqual(snapshot.files.map((f: Json) => [f.path, f.status]), [['src/app.js', 'modified']]);
      const linked = (detail.issues as Json[]).find((i) => i.kind === 'issue');
      assert.ok(linked, `the linked issue is referenced: ${JSON.stringify(detail.issues)}`);
      assert.equal(linked.platform, 'gitlab-issues');
      assert.equal(linked.status, 'found');
      assert.equal(linked.title, issue.title);
      const [summary] = await waitFor(
        async () => {
          const list = (await api.get(`/api/sessions/${sessionId}/snapshots/${detail.snapshots[0].snapshotId}/summaries`)).json as Json[];
          return list.length > 0 && list[0]?.state === 'completed' && list;
        },
        'the summary to complete',
        STEP_MS,
      );
      assert.equal(summary?.headCommit, main.headCommit);
      const again = await bench.startSession(main.number, review.id);
      assert.equal(again.sessionId, sessionId, 'opening it again reuses the one session');
      await unchanged('opening a session');
    });

    await t.test('AS2 a line-range question is stored against that range and the head commit', async () => {
      firstQuestion = await ask(sessionId, { scope: { type: 'range', path: 'src/app.js', side: 'head', startLine: 40, endLine: 50 }, category: 'why', text: 'Why are these values scaled?' });
      assert.equal(firstQuestion.state, 'completed');
      assert.equal(firstQuestion.headCommit, main.headCommit);
      assert.deepEqual(bench.store.readQuestion(firstQuestion.questionId)?.scope, { type: 'range', path: 'src/app.js', side: 'new', startLine: 40, endLine: 50, label: null });
      await unchanged('asking a question');
    });

    await t.test('AS3 a pushed commit gives a new snapshot; the earlier answer stays on the old head', async () => {
      const newHead = await seeder.pushCommit(review, 'feature/reset', [{ kind: 'edit', path: 'src/util.js', content: 'export const version = 2;\n' }]);
      const opened = await check(sessionId);
      assert.equal(opened.headMoved, true);
      assert.equal(opened.platformHeadCommit, newHead);
      const refreshed = await api.post(`/api/sessions/${sessionId}/refresh`);
      assert.ok([200, 201].includes(refreshed.status), refreshed.text);
      const detail = await detailOf(sessionId);
      assert.equal(detail.snapshots.length, 2);
      assert.equal(detail.snapshots[1].headCommit, newHead);
      assert.equal(detail.latestHeadCommit, newHead);
      const old = (await questionsOf(sessionId)).find((q) => q.questionId === firstQuestion.questionId);
      assert.equal(old?.headCommit, main.headCommit);
      assert.equal(old?.isLatestSnapshot, false);
      await unchanged('refreshing to a new head');
    });

    const sessions = new Map<SeededPull, { id: string; question: string }>();
    await t.test('AS4 closed, merged and deleted merge requests show their state and keep their answers', async () => {
      for (const pull of others) {
        const detail = await bench.startSession(pull.number, review.id);
        const asked = await ask(detail.sessionId, { scope: { type: 'pr' }, category: 'what', text: `What does ${pull.title} change?` });
        sessions.set(pull, { id: detail.sessionId, question: asked.questionId });
      }
      await seeder.closePullRequest(toClose);
      await seeder.mergePullRequest(toMerge);
      await seeder.deletePullRequest(toDelete);
      const closed = await check(sessions.get(toClose)!.id);
      assert.deepEqual([closed.prStatus, closed.readOnly], ['closed', true]);
      const merged = await check(sessions.get(toMerge)!.id);
      assert.deepEqual([merged.prStatus, merged.readOnly], ['merged', true]);
      const deleted = await check(sessions.get(toDelete)!.id);
      assert.deepEqual([deleted.prStatus, deleted.readOnly, deleted.statusNote], ['closed', true, 'deleted on platform']);
      for (const [, s] of sessions) assert.ok((await questionsOf(s.id)).some((q) => q.questionId === s.question), 'the stored answer is kept');
      await unchanged('state changes');
    });

    await t.test('AS5 a reopened merge request is reported as reopened on the platform', async () => {
      await seeder.reopenPullRequest(toClose);
      const reopened = await check(sessions.get(toClose)!.id);
      assert.equal(reopened.statusNote, 'reopened on platform');
      await unchanged('a reopen');
    });

    await t.test('AS6 sessions and answers survive a restart on the same store', async () => {
      await bench.restart();
      const listed = (await bench.client.get('/api/sessions')).json as Json[];
      assert.deepEqual(listed.map((s) => s.prNumber).sort((a, b) => a - b), [main.number, ...others.map((p) => p.number)].sort((a, b) => a - b));
      const kept = (await bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Json[];
      assert.ok(kept.some((q) => q.questionId === firstQuestion.questionId));
      await unchanged('a restart');
    });

    await t.test('SC-005 / FR-022 every request was a GET to GitLab, and the token is nowhere on disk', async () => {
      network.assertOnlyGets();
      network.assertHosts([new URL(GITLAB_URL).host]);
      assert.ok(network.requests.length > 0);
      for (const file of await filesUnder(bench.appData.dir)) {
        const bytes = await readFile(file);
        assert.equal(bytes.includes(run.reviewer.token), false, `the token is not in ${file}`);
      }
      const config = (await bench.client.get('/api/config')).text;
      assert.equal(config.includes(run.reviewer.token), false, 'the token is not in an API response');
    });
  });
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath, entry.name));
  }
  return out;
}
