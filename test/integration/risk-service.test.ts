// T018 (VO-036 and the classify-on-store behaviour of RR-1), plus the cases later tasks append: AI runs (US4),
// overrides (US5) and the rule file (US6). The service is driven against a real store seeded by
// test/helpers/risk-seed.ts, so no git, workspace or network is involved.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AiProvider, AskEvent, AskRequest } from '../../src/contracts/ai-provider.ts';
import type { RiskEventData } from '../../src/contracts/http.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { edit, referenceFiles, seedSession, seedSnapshot, type SeedFile } from '../helpers/risk-seed.ts';

type After = { after(fn: () => unknown): void };

type AiScript = (req: AskRequest, state: { cancelled: boolean }) => AsyncIterable<AskEvent>;
export type HarnessOptions = {
  ai?: { script: AiScript; unavailableReason?: string; clone?: string | null };
  /** The platform's answer to "who am I"; counts its calls. Absent: no platform is reachable. */
  user?: () => Promise<{ handle: string; displayName: string }>;
};

export async function riskHarness(t: After, options: HarnessOptions = {}) {
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { createRiskService } = await import('../../src/core/risk-service.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const appData = await useTempAppData(t);
  const paths = await ensureAppData({ dir: appData.dir });
  const db = openDatabase(join(appData.dir, 'review.db'));
  t.after(() => db.close());
  const store = createReviewStore(db);
  const published: Array<{ sessionId: string; event: string; data: unknown }> = [];
  const events = {
    publish(sessionId: string, event: string, data: unknown): number {
      published.push({ sessionId, event, data });
      return 1;
    },
  };
  const { createLanes } = await import('../../src/core/lanes.ts');
  const lanes = createLanes();
  const requests: AskRequest[] = [];
  const states = new Map<string, { cancelled: boolean }>();
  const ai = options.ai;
  const provider: AiProvider = {
    id: 'fake-provider',
    async capabilities() {
      return {
        installed: true, streaming: true,
        restrictionsEnforced: { 'workspace-read-search-tools-only': true, 'no-reads-outside-workspace': true, 'no-network-tools': true, 'no-repository-configuration': true, 'untrusted-input-delimited': true },
        ...(ai?.unavailableReason === undefined ? {} : { unavailableReason: ai.unavailableReason }),
      };
    },
    ask(req) {
      requests.push(req);
      const state = { cancelled: false };
      states.set(req.requestId, state);
      return (ai?.script ?? (async function* () { yield { type: 'result', output: { files: [] } } as AskEvent; }))(req, state);
    },
    async cancel(requestId) {
      const state = states.get(requestId);
      if (state !== undefined) state.cancelled = true;
    },
  };
  const userCalls = { count: 0 };
  const service = createRiskService({
    store, events, appDataDir: paths.dir,
    ...(options.user === undefined ? {} : { currentUser: async () => { userCalls.count += 1; return options.user!(); } }),
    ...(ai === undefined
      ? {}
      : {
          ai: {
            store, lanes, provider, events,
            git: undefined as never,
            workspacePath: (sessionId: string, snapshotId: string) => `/workspaces/${sessionId}/${snapshotId}`,
            environmentFor: async () => ({
              clonePath: ai.clone === undefined ? '/clones/widgets' : ai.clone,
              limits: { maxFileBytes: 1_048_576, maxChangedLines: 5_000, maxPromptChars: 400_000 },
            }),
          },
        }),
  });
  return { store, service, published, appData, paths, lanes, requests, provider, userCalls };
}

const sampleFiles = (): SeedFile[] => [
  { path: 'db/migrations/001.sql', patch: edit('ALTER TABLE a ADD b INT;') },
  { path: 'src/auth/session.ts', patch: edit('check();') },
  { path: 'README.md', patch: edit('hello') },
];

test('storing a snapshot writes the ruleset, classes and reasons at once, without a workspace', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, sampleFiles());
  assert.equal(h.store.readRiskRuleset(snapshotId), null, 'nothing before the hook');

  h.service.onSnapshotStored(sessionId, snapshotId);

  const ruleset = h.store.readRiskRuleset(snapshotId);
  assert.match(ruleset?.rulesetVersion ?? '', /^builtin-\d+$/);
  assert.equal(ruleset?.ruleFileStatus, 'absent');
  const rows = h.store.readRiskClassifications(snapshotId);
  assert.deepEqual(rows.map((r) => [r.path, r.ruleClass]), [['db/migrations/001.sql', 'critical'], ['src/auth/session.ts', 'critical'], ['README.md', 'normal']]);
  for (const row of rows) assert.ok(row.reasons.length >= 1);
  const report = h.service.getReport(sessionId, snapshotId);
  assert.equal(report?.files.length, 3);
  assert.equal(report?.counts.critical, 2);
});

test('the hook publishes a risk event with the changed paths and no class', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, sampleFiles());
  h.service.onSnapshotStored(sessionId, snapshotId);
  const risk = h.published.filter((p) => p.event === 'risk');
  assert.equal(risk.length, 1);
  const data = risk[0]?.data as RiskEventData;
  assert.equal(data.snapshotId, snapshotId);
  assert.equal(data.cause, 'classified');
  assert.deepEqual([...data.changedPaths].sort(), ['README.md', 'db/migrations/001.sql', 'src/auth/session.ts']);
  assert.equal(typeof data.revision, 'number');
  assert.equal(JSON.stringify(data).includes('critical'), false, 'the stream carries no class');
});

test('classifying the same snapshot twice, or a failing hook, never breaks anything (V.4)', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, sampleFiles());
  h.service.onSnapshotStored(sessionId, snapshotId);
  assert.doesNotThrow(() => h.service.onSnapshotStored(sessionId, snapshotId), 'a second call is ignored');
  assert.doesNotThrow(() => h.service.onSnapshotStored(sessionId, 'no-such-snapshot'));
  assert.equal(h.store.readRiskClassifications(snapshotId).length, 3, 'no duplicate rows');
});

test('the reference pull request: migration and auth file are Critical, the lockfile mechanical, the binary not fully analysed', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, await referenceFiles());
  h.service.onSnapshotStored(sessionId, snapshotId);
  const report = h.service.getReport(sessionId, snapshotId);
  assert.ok(report);
  const by = (p: string) => report.files.find((f) => f.path === p);
  assert.equal(by('db/migrations/2026_add_ledger.sql')?.effectiveClass, 'critical');
  assert.equal(by('src/auth/session.ts')?.effectiveClass, 'critical');
  assert.equal(by('package-lock.json')?.mechanicalKind, 'lockfile');
  assert.equal(by('src/auth/tokens.ts')?.effectiveClass, 'low', 'a comment-only edit in an auth file');
  assert.equal(by('src/util/names.ts')?.mechanicalKind, 'rename-only');
  assert.equal(by('assets/logo.png')?.notFullyAnalysed, 'binary');
  assert.equal(by('README.md')?.effectiveClass, 'normal');
});

test('an unknown session or snapshot has no report', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, sampleFiles());
  assert.equal(h.service.getReport('nope', snapshotId), null);
  assert.equal(h.service.getReport(sessionId, 'nope'), null);
  const other = seedSession(h.store, 2);
  assert.equal(h.service.getReport(other.sessionId, snapshotId), null, 'a snapshot of another session');
});

test('VO-036 500 files with patches are classified within the bound, with no AI run involved', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const files: SeedFile[] = Array.from({ length: 500 }, (_, i) => ({
    path: i % 7 === 0 ? `src/auth/file${i}.ts` : `src/mod${i % 20}/file${i}.ts`,
    patch: `@@ -1,3 +1,4 @@\n a\n b\n+const v${i} = ${i};\n c\n`,
  }));
  const snapshotId = seedSnapshot(h.store, sessionId, 1, files);
  const started = Date.now();
  h.service.onSnapshotStored(sessionId, snapshotId);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `classified in ${elapsed} ms`);
  assert.equal(h.store.readRiskClassifications(snapshotId).length, 500);
  assert.equal(h.store.readLatestRiskRun(snapshotId), null, 'no AI run was needed');
});


// ---------------------------------------------------------------- AI runs (T047, US4)

const raiseScript = (...files: Array<{ path: string; class: string; lines?: unknown[] }>): AiScript =>
  async function* () {
    yield { type: 'result', output: { files: files.map((f) => ({ reasons: ['It changes how the check decides.'], lines: [{ side: 'head', startLine: 2, endLine: 2 }], ...f })) } } as AskEvent;
  };

const aiFiles = (): SeedFile[] => [
  { path: 'src/util/a.ts', patch: edit('const a = 1;') },
  { path: 'package-lock.json', patch: edit('"lockfileVersion": 3') },
  { path: 'src/gen.generated.ts', patch: edit('const g = 1;') },
  { path: 'README.md', status: 'modified', patch: '@@ -1,2 +1,3 @@\n # Widgets\n \n+<!-- a note -->\n' },
];

async function ranAi(h: Awaited<ReturnType<typeof riskHarness>>, files: SeedFile[] = aiFiles()) {
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, files, undefined, true);
  h.service.onSnapshotStored(sessionId, snapshotId);
  h.service.onSnapshot(sessionId, snapshotId);
  await h.service.whenIdle(snapshotId);
  return { sessionId, snapshotId };
}

test('VO-016 a lockfile and a generated file never reach the prompt and show "Not assessed by AI"', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript() } });
  const { sessionId, snapshotId } = await ranAi(h);
  assert.equal(h.requests.length, 1, 'one risk run');
  const data = h.requests[0]!.data;
  assert.equal(data.includes('lockfileVersion'), false);
  assert.equal(data.includes('const g = 1;'), false);
  assert.ok(data.includes('const a = 1;'));
  const report = h.service.getReport(sessionId, snapshotId)!;
  const by = (p: string) => report.files.find((f) => f.path === p)!;
  assert.deepEqual([by('package-lock.json').ai.state, by('package-lock.json').ai.notAssessedReason], ['not-assessed', 'lockfile']);
  assert.deepEqual([by('src/gen.generated.ts').ai.state, by('src/gen.generated.ts').ai.notAssessedReason], ['not-assessed', 'generated file']);
  assert.deepEqual(h.store.readLatestCompletedRiskRun(snapshotId)?.excludedFiles.map((f) => f.path).sort(), ['package-lock.json', 'src/gen.generated.ts']);
});

test('VO-017 a Normal file raised to Elevated is AI-origin with its rule class visible; a comment-only file raised leaves the mechanical list', async (t) => {
  const h = await riskHarness(t, {
    ai: { script: raiseScript({ path: 'src/util/a.ts', class: 'elevated' }, { path: 'README.md', class: 'elevated', lines: [{ side: 'head', startLine: 3, endLine: 3 }] }) },
  });
  const { sessionId, snapshotId } = await ranAi(h);
  const report = h.service.getReport(sessionId, snapshotId)!;
  const a = report.files.find((f) => f.path === 'src/util/a.ts')!;
  assert.deepEqual([a.ruleClass, a.effectiveClass, a.effectiveOrigin, a.ai.state], ['normal', 'elevated', 'ai', 'applied']);
  const readme = report.files.find((f) => f.path === 'README.md')!;
  assert.equal(readme.ruleClass, 'low');
  assert.equal(readme.effectiveClass, 'elevated');
  assert.equal(readme.mechanical, false);
  assert.equal(report.counts.mechanical, 2, 'only the lockfile and the generated file stay mechanical');
});

test('an AI lowering and an uncited raise change nothing and are reported as ignored', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript({ path: 'src/util/a.ts', class: 'critical', lines: [] }, { path: 'README.md', class: 'low' }) } });
  const { sessionId, snapshotId } = await ranAi(h);
  const report = h.service.getReport(sessionId, snapshotId)!;
  assert.equal(report.files.find((f) => f.path === 'src/util/a.ts')?.effectiveClass, 'normal');
  assert.equal(report.files.find((f) => f.path === 'src/util/a.ts')?.ai.state, 'no-resolvable-line');
  assert.equal(report.files.find((f) => f.path === 'README.md')?.effectiveClass, 'low');
  assert.equal(report.ai.ignoredCount, 2);
});

test('VO-020 a provider that is unavailable leaves rule classes and says the AI assessment is missing, with the reason', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript(), unavailableReason: 'the provider CLI is not installed' } });
  const { sessionId, snapshotId } = await ranAi(h);
  assert.equal(h.requests.length, 0);
  const report = h.service.getReport(sessionId, snapshotId)!;
  assert.equal(report.ai.state, 'failed');
  assert.match(report.ai.reason ?? '', /not installed/);
  assert.equal(report.files.length, 4);
  assert.equal(report.files.find((f) => f.path === 'src/util/a.ts')?.effectiveClass, 'normal');
});

test('VO-020 unreadable output fails the run with a reason and changes no class', async (t) => {
  const h = await riskHarness(t, { ai: { script: async function* () { yield { type: 'result', output: { files: 'nonsense' } } as AskEvent; } } });
  const { sessionId, snapshotId } = await ranAi(h);
  const report = h.service.getReport(sessionId, snapshotId)!;
  assert.equal(report.ai.state, 'failed');
  assert.match(report.ai.reason ?? '', /could not read|unreadable/i);
  assert.equal(report.counts.elevated + report.counts.critical, 0);
});

test('VO-020 a provider error fails the run with the provider message', async (t) => {
  const h = await riskHarness(t, { ai: { script: async function* () { yield { type: 'error', code: 'failed', message: 'the fake provider failed to start' } as AskEvent; } } });
  const { sessionId, snapshotId } = await ranAi(h);
  const report = h.service.getReport(sessionId, snapshotId)!;
  assert.equal(report.ai.state, 'failed');
  assert.match(report.ai.reason ?? '', /failed to start/);
});

test('VO-020 a restart mid-run leaves no run: the report says the AI assessment is missing and why', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript() } });
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, aiFiles(), undefined, true);
  h.service.onSnapshotStored(sessionId, snapshotId); // the hook ran; the run never did (the process stopped)
  const report = h.service.getReport(sessionId, snapshotId)!;
  assert.equal(report.ai.state, 'none');
  assert.match(report.ai.reason ?? '', /restart|did not run/i);
  assert.equal(report.files.length, 4);
});

test('VO-021 a run stores the provider, the context version and the time, and reads only the isolated workspace', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript() } });
  const { snapshotId, sessionId } = await ranAi(h);
  const run = h.store.readLatestCompletedRiskRun(snapshotId)!;
  assert.equal(run.provider, 'fake-provider');
  assert.match(run.contextVersion ?? '', /^a{40}:[0-9a-f]{64}$/);
  assert.ok(run.requestedAt <= run.finishedAt);
  assert.equal(h.requests[0]?.workspacePath, `/workspaces/${sessionId}/${snapshotId}`);
  assert.equal(h.requests[0]?.output, 'risk');
  assert.ok(Array.isArray(run.restrictionsNotEnforced));
});

test('the run publishes a risk event with cause ai, naming the paths whose class it changed', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript({ path: 'src/util/a.ts', class: 'elevated' }) } });
  await ranAi(h);
  const ai = h.published.filter((p) => p.event === 'risk' && (p.data as RiskEventData).cause === 'ai');
  assert.equal(ai.length, 2, 'one when the assessment is queued, one when it ends');
  assert.deepEqual((ai[0]?.data as RiskEventData).changedPaths, []);
  assert.deepEqual((ai[1]?.data as RiskEventData).changedPaths, ['src/util/a.ts']);
  assert.notEqual((ai[0]?.data as RiskEventData).revision, (ai[1]?.data as RiskEventData).revision);
});

test('VO-038 a snapshot replaced mid-run keeps the result on its own snapshot, marked older, and never applies it to the new one', async (t) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const h = await riskHarness(t, {
    ai: { script: async function* () { await held; yield { type: 'result', output: { files: [{ path: 'src/util/a.ts', class: 'critical', reasons: ['r'], lines: [{ side: 'head', startLine: 2, endLine: 2 }] }] } } as AskEvent; } },
  });
  const { sessionId } = seedSession(h.store);
  const first = seedSnapshot(h.store, sessionId, 1, aiFiles(), undefined, true);
  h.service.onSnapshotStored(sessionId, first);
  h.service.onSnapshot(sessionId, first);
  await new Promise((r) => setTimeout(r, 20));
  const second = seedSnapshot(h.store, sessionId, 2, aiFiles(), 'd'.repeat(40), true);
  h.service.onSnapshotStored(sessionId, second);
  h.service.onSnapshot(sessionId, second);
  const duringRun = h.service.getReport(sessionId, first)!;
  assert.equal(duringRun.ai.state, 'running');
  release();
  await h.service.whenIdle(first);
  await h.service.whenIdle(second);
  const older = h.service.getReport(sessionId, first)!;
  assert.equal(older.ai.olderHead, true);
  assert.equal(older.files.find((f) => f.path === 'src/util/a.ts')?.effectiveClass, 'critical');
  const newer = h.service.getReport(sessionId, second)!;
  assert.equal(newer.ai.olderHead, undefined);
  // The second snapshot has its own run, started after the first; the first run's result is not its result.
  assert.equal(h.store.readLatestCompletedRiskRun(second)?.snapshotId, second);
  assert.equal(h.store.readLatestCompletedRiskRun(first)?.snapshotId, first);
});

test('a read-only session or a snapshot with no workspace runs no AI assessment and says why', async (t) => {
  const h = await riskHarness(t, { ai: { script: raiseScript() } });
  const { sessionId } = seedSession(h.store);
  const noWorkspace = seedSnapshot(h.store, sessionId, 1, aiFiles());
  h.service.onSnapshotStored(sessionId, noWorkspace);
  h.service.onSnapshot(sessionId, noWorkspace);
  await h.service.whenIdle(noWorkspace);
  assert.equal(h.requests.length, 0);
  assert.match(h.service.getReport(sessionId, noWorkspace)?.ai.reason ?? '', /workspace/i);

  const closed = seedSession(h.store, 2);
  const snap = seedSnapshot(h.store, closed.sessionId, 1, aiFiles(), undefined, true);
  h.store.upsertSessionStatus({ sessionId: closed.sessionId, prStatus: 'merged', statusNote: null, lastCheckedAt: 't', lastCheckedHead: null, lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: 't' });
  h.service.onSnapshotStored(closed.sessionId, snap);
  h.service.onSnapshot(closed.sessionId, snap);
  await h.service.whenIdle(snap);
  assert.equal(h.requests.length, 0);
  assert.match(h.service.getReport(closed.sessionId, snap)?.ai.reason ?? '', /read-only|merged/i);
});


// ---------------------------------------------------------------- overrides (T064, US5)

import { AdapterError } from '../../src/contracts/shared.ts';
import { RiskError } from '../../src/core/risk-service.ts';

const ANA = { handle: 'ana-dev', displayName: 'Ana Lee' };
const overrideFiles = (): SeedFile[] => [
  { path: 'src/auth/session.ts', patch: edit('check();') },
  { path: 'src/util/a.ts', patch: edit('const a = 1;') },
  { path: 'package-lock.json', patch: edit('"lockfileVersion": 3') },
];
async function overrideSetup(t: After, options: HarnessOptions = { user: async () => ANA }) {
  const h = await riskHarness(t, options);
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, overrideFiles());
  h.service.onSnapshotStored(sessionId, snapshotId);
  const body = (path: string, cls: string, reason = 'Reviewed: only the log line changed.') => ({ snapshotId, path, class: cls as 'low', reason });
  const classOf = (id = snapshotId, p = 'src/auth/session.ts') => h.service.getReport(sessionId, id)?.files.find((f) => f.path === p)?.effectiveClass;
  return { h, sessionId, snapshotId, body, classOf };
}
const refused = async (work: Promise<unknown>, code: string) => assert.rejects(work, (e: unknown) => e instanceof RiskError && e.code === code && (assert.ok(e.message.length > 0), true), code);

test('raising a class, or lowering a non-Critical one, is recorded with no platform call and no reviewer name', async (t) => {
  const { h, sessionId, body, classOf } = await overrideSetup(t);
  const record = await h.service.createOverride(sessionId, body('src/util/a.ts', 'elevated'));
  assert.deepEqual([record.class, record.replacedClass, record.calculatedClass, record.reviewer], ['elevated', 'normal', 'normal', undefined]);
  assert.equal(classOf(undefined, 'src/util/a.ts'), 'elevated');
  await h.service.createOverride(sessionId, body('src/util/a.ts', 'low'));
  assert.equal(h.userCalls.count, 0, 'no platform call');
  assert.equal(h.store.readOverrideHistory(sessionId, 'src/util/a.ts').every((r) => r.reviewer === null), true);
});

test('VO-023 lowering a Critical class with the account readable stores the handle and name', async (t) => {
  const { h, sessionId, snapshotId, body, classOf } = await overrideSetup(t);
  const record = await h.service.createOverride(sessionId, body('src/auth/session.ts', 'normal'));
  assert.deepEqual(record.reviewer, { handle: 'ana-dev', displayName: 'Ana Lee' });
  assert.equal(record.calculatedClass, 'critical');
  assert.equal(record.snapshotId, snapshotId);
  assert.equal(classOf(), 'normal');
  assert.equal(h.userCalls.count, 1);
  const file = h.service.getReport(sessionId, snapshotId)!.files.find((f) => f.path === 'src/auth/session.ts')!;
  assert.equal(file.ruleClass, 'critical', 'the original class stays visible');
  assert.equal(file.override?.record.reviewer?.displayName, 'Ana Lee');
});

test('VO-023 a two-step lowering names the reviewer at both steps and is refused at either when the account is unreadable', async (t) => {
  const { h, sessionId, body, classOf } = await overrideSetup(t);
  await h.service.createOverride(sessionId, body('src/auth/session.ts', 'elevated'));
  const second = await h.service.createOverride(sessionId, body('src/auth/session.ts', 'low'));
  assert.equal(second.reviewer?.handle, 'ana-dev', 'Elevated to Low on a file calculated Critical still names the reviewer');
  assert.equal(second.replacedClass, 'elevated');
  assert.equal(second.calculatedClass, 'critical');
  assert.equal(h.userCalls.count, 2);
  assert.equal(classOf(), 'low');

  const down = await overrideSetup(t, { user: async () => { throw new AdapterError('unauthorized', 'scm-test'); } });
  await refused(down.h.service.createOverride(down.sessionId, down.body('src/auth/session.ts', 'elevated')), 'signin_required');
  await refused(down.h.service.createOverride(down.sessionId, down.body('src/auth/session.ts', 'low')), 'signin_required');
  assert.equal(down.h.store.readOverrideHistory(down.sessionId, 'src/auth/session.ts').length, 0, 'no record');
});

test('VO-023 an unreadable account (401) and an unreachable platform refuse with a reason and write no record; raising still works', async (t) => {
  for (const [error, code] of [[new AdapterError('unauthorized', 'scm-test'), 'signin_required'], [new AdapterError('unavailable', 'scm-test'), 'platform_error'], [new Error('socket hang up'), 'platform_error']] as const) {
    const s = await overrideSetup(t, { user: async () => { throw error; } });
    await refused(s.h.service.createOverride(s.sessionId, s.body('src/auth/session.ts', 'normal')), code);
    assert.equal(s.h.store.readOverrideHistory(s.sessionId, 'src/auth/session.ts').length, 0);
    // Signed out: raising a class and lowering a non-Critical one are still allowed.
    const raised = await s.h.service.createOverride(s.sessionId, s.body('src/util/a.ts', 'critical'));
    assert.equal(raised.class, 'critical');
    assert.equal(s.classOf(undefined, 'src/util/a.ts'), 'critical');
  }
  const noLookup = await overrideSetup(t, {});
  await refused(noLookup.h.service.createOverride(noLookup.sessionId, noLookup.body('src/auth/session.ts', 'low')), 'platform_error');
});

test('the reviewer preview returns the account, or the reason and the fix, and never throws for a platform error', async (t) => {
  const ok = await overrideSetup(t);
  assert.deepEqual(await ok.h.service.currentReviewer(ok.sessionId), { ok: true, handle: 'ana-dev', displayName: 'Ana Lee' });
  const unauthorized = await overrideSetup(t, { user: async () => { throw new AdapterError('unauthorized', 'scm-test'); } });
  const a = await unauthorized.h.service.currentReviewer(unauthorized.sessionId);
  assert.equal(a.ok, false);
  assert.match(a.ok ? '' : a.fix, /Sign in to the platform again/);
  const down = await overrideSetup(t, { user: async () => { throw new Error('offline'); } });
  const d = await down.h.service.currentReviewer(down.sessionId);
  assert.equal(d.ok, false);
  assert.ok(d.ok ? false : d.reason.length > 0 && d.fix.length > 0);
  await assert.rejects(ok.h.service.currentReviewer('nope'), (e: unknown) => e instanceof RiskError && e.code === 'not_found');
});

test('VO-024 an override twice gives two records, the latest applies, the history is readable oldest first, and deleting the session removes them', async (t) => {
  const { h, sessionId, body, classOf } = await overrideSetup(t);
  const first = await h.service.createOverride(sessionId, body('src/util/a.ts', 'elevated', 'First view.'));
  const second = await h.service.createOverride(sessionId, body('src/util/a.ts', 'low', 'Second view.'));
  assert.equal(classOf(undefined, 'src/util/a.ts'), 'low');
  const history = h.service.overrideHistory(sessionId, 'src/util/a.ts');
  assert.deepEqual(history.map((r) => [r.id, r.reason, r.replacedClass]), [[first.id, 'First view.', 'normal'], [second.id, 'Second view.', 'elevated']]);
  assert.equal(h.service.overrideHistory(sessionId, 'src/auth/session.ts').length, 0, 'history is per file');
  h.store.deleteSession(sessionId);
  assert.equal(h.store.readLatestOverride(sessionId, 'src/util/a.ts'), null);
});

test('VO-025 the same change under a new head and shifted lines keeps the override in force', async (t) => {
  const { h, sessionId, body } = await overrideSetup(t);
  await h.service.createOverride(sessionId, body('src/util/a.ts', 'elevated'));
  const shifted = '@@ -200,3 +205,4 @@ elsewhere\n context one\n context two\n+const a = 1;\n context three\n';
  const second = seedSnapshot(h.store, sessionId, 2, overrideFiles().map((f) => (f.path === 'src/util/a.ts' ? { ...f, patch: shifted } : f)), 'd'.repeat(40));
  h.service.onSnapshotStored(sessionId, second);
  const file = h.service.getReport(sessionId, second)!.files.find((f) => f.path === 'src/util/a.ts')!;
  assert.equal(file.effectiveClass, 'elevated');
  assert.equal(file.effectiveOrigin, 'override');
  assert.equal(file.override?.applies, true);
});

test('VO-026 a differing change lapses the override visibly; a removed file keeps its overrides in the history only', async (t) => {
  const { h, sessionId, body } = await overrideSetup(t);
  await h.service.createOverride(sessionId, body('src/util/a.ts', 'low', 'Trivial.'));
  const changed = seedSnapshot(h.store, sessionId, 2, overrideFiles().map((f) => (f.path === 'src/util/a.ts' ? { ...f, patch: edit('const a = 2;') } : f)), 'd'.repeat(40));
  h.service.onSnapshotStored(sessionId, changed);
  const file = h.service.getReport(sessionId, changed)!.files.find((f) => f.path === 'src/util/a.ts')!;
  assert.deepEqual([file.effectiveClass, file.override?.applies, file.override?.record.reason], ['normal', false, 'Trivial.']);

  const removed = seedSnapshot(h.store, sessionId, 3, overrideFiles().filter((f) => f.path !== 'src/util/a.ts'), 'e'.repeat(40));
  h.service.onSnapshotStored(sessionId, removed);
  assert.equal(h.service.getReport(sessionId, removed)!.files.some((f) => f.path === 'src/util/a.ts'), false);
  assert.equal(h.service.overrideHistory(sessionId, 'src/util/a.ts').length, 1, 'still in the history');
});

test('overrides are refused on an older snapshot, a closed session and bad input, with no record written', async (t) => {
  const { h, sessionId, snapshotId, body } = await overrideSetup(t);
  const newer = seedSnapshot(h.store, sessionId, 2, overrideFiles(), 'd'.repeat(40));
  h.service.onSnapshotStored(sessionId, newer);
  await refused(h.service.createOverride(sessionId, body('src/util/a.ts', 'elevated')), 'read_only');
  const latest = { snapshotId: newer, path: 'src/util/a.ts', class: 'elevated' as const, reason: 'Because.' };
  await refused(h.service.createOverride(sessionId, { ...latest, reason: '   ' }), 'invalid_request');
  await refused(h.service.createOverride(sessionId, { ...latest, reason: 'x'.repeat(2001) }), 'invalid_request');
  await refused(h.service.createOverride(sessionId, { ...latest, class: 'normal' }), 'invalid_request');
  await refused(h.service.createOverride(sessionId, { ...latest, path: 'src/not-changed.ts' }), 'not_found');
  await refused(h.service.createOverride('nope', latest), 'not_found');
  assert.equal(h.store.readOverrideHistory(sessionId, 'src/util/a.ts').length, 0);
  const ok = await h.service.createOverride(sessionId, { ...latest, reason: ` ${'x'.repeat(2000)} ` });
  assert.equal(ok.reason.length, 2000, 'the reason is trimmed, up to 2,000 characters');

  h.store.upsertSessionStatus({ sessionId, prStatus: 'closed', statusNote: null, lastCheckedAt: 't', lastCheckedHead: null, lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: 't' });
  await refused(h.service.createOverride(sessionId, { ...latest, path: 'src/auth/session.ts', class: 'elevated' }), 'read_only');
  const report = h.service.getReport(sessionId, newer)!;
  assert.equal(report.canOverride.allowed, false);
  assert.match(report.canOverride.reason ?? '', /read-only|closed/i);
  void snapshotId;
});

test('an override publishes a risk event with cause override and the path', async (t) => {
  const { h, sessionId, body } = await overrideSetup(t);
  await h.service.createOverride(sessionId, body('src/util/a.ts', 'elevated'));
  const events = h.published.filter((p) => p.event === 'risk' && (p.data as RiskEventData).cause === 'override');
  assert.equal(events.length, 1);
  assert.deepEqual((events[0]?.data as RiskEventData).changedPaths, ['src/util/a.ts']);
});

// ---------------------------------------------------------------- the rule file (T074, VO-015, US6)

import { writeFile } from 'node:fs/promises';

const RULE_FILE = 'risk-rules.json';

test('VO-015 a valid extend and add classify matching files under their IDs, and the snapshot records the ruleset version', async (t) => {
  const h = await riskHarness(t);
  await writeFile(join(h.paths.dir, RULE_FILE), JSON.stringify({
    version: 1,
    entries: [
      { extend: 'R-FINANCE', paths: ['billing-v2/**'] },
      { add: 'X-PII', family: 'authorisation', class: 'elevated', label: 'Personal data handling', paths: ['**/customer/**'] },
    ],
  }));
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, [{ path: 'billing-v2/total.ts' }, { path: 'src/customer/profile.ts' }, { path: 'src/util/x.ts' }]);
  h.service.onSnapshotStored(sessionId, snapshotId);
  const report = h.service.getReport(sessionId, snapshotId)!;
  const by = (p: string) => report.files.find((f) => f.path === p)!;
  assert.deepEqual([by('billing-v2/total.ts').effectiveClass, by('billing-v2/total.ts').reasons[0]?.ruleId], ['critical', 'R-FINANCE']);
  assert.deepEqual([by('src/customer/profile.ts').effectiveClass, by('src/customer/profile.ts').reasons[0]?.ruleId], ['elevated', 'X-PII']);
  assert.equal(by('src/util/x.ts').effectiveClass, 'normal');
  assert.equal(report.ruleset.ruleFile, 'used');
  assert.match(report.ruleset.version, /^builtin-\d+\+[0-9a-f]{12}$/);
  assert.equal(h.store.readRiskRuleset(snapshotId)?.rulesetVersion, report.ruleset.version);
});

test('VO-015 changing the file between snapshots gives each snapshot its own ruleset version and notice', async (t) => {
  const h = await riskHarness(t);
  const { sessionId } = seedSession(h.store);
  const first = seedSnapshot(h.store, sessionId, 1, [{ path: 'billing-v2/total.ts' }]);
  h.service.onSnapshotStored(sessionId, first);
  await writeFile(join(h.paths.dir, RULE_FILE), JSON.stringify({ version: 1, entries: [{ extend: 'R-FINANCE', paths: ['billing-v2/**'] }, { add: 'X-BAD', family: 'cooking', class: 'elevated' }] }));
  const second = seedSnapshot(h.store, sessionId, 2, [{ path: 'billing-v2/total.ts' }], 'd'.repeat(40));
  h.service.onSnapshotStored(sessionId, second);
  const a = h.service.getReport(sessionId, first)!;
  const b = h.service.getReport(sessionId, second)!;
  assert.equal(a.ruleset.ruleFile, 'absent');
  assert.equal(a.files[0]?.effectiveClass, 'normal', 'the first snapshot keeps its own classes');
  assert.equal(b.ruleset.ruleFile, 'partly-ignored');
  assert.deepEqual(b.ruleset.notice.map((n) => n.entry), ['1: X-BAD']);
  assert.equal(b.files[0]?.effectiveClass, 'critical');
  assert.notEqual(a.ruleset.version, b.ruleset.version);
});

test('VO-014 a corrupt rule file never blocks classification: the built-ins apply and the notice names the file', async (t) => {
  const h = await riskHarness(t);
  await writeFile(join(h.paths.dir, RULE_FILE), '{ this is not json');
  const { sessionId } = seedSession(h.store);
  const snapshotId = seedSnapshot(h.store, sessionId, 1, sampleFiles());
  h.service.onSnapshotStored(sessionId, snapshotId);
  const report = h.service.getReport(sessionId, snapshotId)!;
  assert.equal(report.ruleset.ruleFile, 'ignored');
  assert.deepEqual(report.ruleset.notice.map((n) => n.entry), ['(file)']);
  assert.equal(report.counts.critical, 2, 'the built-in rules still classified every file');
  assert.equal(report.ruleset.version, h.service.getReport(sessionId, snapshotId)!.ruleset.version);
});
