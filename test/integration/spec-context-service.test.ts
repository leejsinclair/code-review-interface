// Feature 006 (T010; FR-002, FR-015, FR-016, FR-018): the specification-context service against real git in the
// spec sandbox, the real store and lanes, and the real Claude Code provider driven by the fake CLI
// (`alignment`, `alignmentScenario`, `riskInvocations` style helpers in test/helpers/fake-ai-cli.ts).
//
// The pull request's own repository is the sandbox's nested clone (`acme/job`); the enclosing project repository
// is the sandbox's project clone (`acme/project`). Keys come from the stand-in tracker below, as in production
// where the core holds no key pattern.
//
// APIs required (T022, T023; plan.md "How it fits together"):
//   src/core/spec-context.ts  createSpecContextService(deps): SpecContextService
//     deps: { store, manager, lanes, provider, events: { publish(sessionId, event, data) }, now?,
//             workspace: { cloneFor(repositoryId): string | null; enclosingOf(repositoryId): string | null },
//             environmentFor(sessionId): { repositoryId: string; clonePath: string | null; tracker: IssueTracker; limits } | null,
//             workspacePath(sessionId, snapshotId): string }
//     SpecContextService:
//       onSnapshotStored(sessionId, snapshotId): void            starts the lookup; returns at once (never blocks the snapshot)
//       onSnapshot(sessionId, snapshotId): void                  once the workspace exists: waits for the lookup, queues one run
//       onRefreshed(sessionId, snapshotId): void                 same-head refresh: re-checks commits, acts only on a change
//       report(sessionId, snapshotId): Promise<SpecContextReport>   (contracts/http-api.md), derived on read, never throws for git or AI
//       retry(sessionId, snapshotId): Promise<{ runId: string | null }>
//       settled(sessionId): Promise<void>                        every lookup and run the service started has ended
//   src/core/sessions.ts  `onRefreshed?: (sessionId, snapshotId) => void` in SessionsDeps (T023, tested with the service wiring in T011/T-end-to-end)

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import type { IssueTracker } from '../../src/contracts/issue-tracker.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { useFakeAiCli, type FakeAiCli, type FakeConfig } from '../helpers/fake-ai-cli.ts';
import { seedSession } from '../helpers/risk-seed.ts';
import { createSpecSandbox, specFolder, type SpecSandbox } from '../helpers/spec-sandbox.ts';

const OWN = 'acme/job';
const ENCLOSING = 'acme/project';
const FOLDER = 'ENG-12-data-request';

const tracker: IssueTracker = {
  id: 'tracker-a',
  async verifySignIn() {
    return { ok: true, account: 'reviewer' };
  },
  extractReferences: (text: string) => [...text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => ({ platform: 'tracker-a', key: m[0] })) as never,
  async lookup() {
    return { status: 'unresolved', reason: 'not used here' };
  },
};

async function harness(t: { after(fn: () => unknown): void }, ai: FakeConfig = { scenario: 'structured' }) {
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { createSpecContextService } = await import('../../src/core/spec-context.ts');
  const { createLanes } = await import('../../src/core/lanes.ts');
  const { createRepositoryManager } = await import('../../src/repo/manager.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { createAiProvider } = await import('../../src/adapters/ai-registry.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const { DEFAULT_LIMITS } = await import('../../src/core/limits.ts');

  const appData = await useTempAppData(t);
  const fake = await useFakeAiCli(t, ai);
  const paths = await ensureAppData({ dir: appData.dir });
  const sandbox = await createSpecSandbox();
  t.after(() => sandbox.cleanup());
  const db = openDatabase(join(appData.dir, 'review.db'));
  t.after(() => db.close());
  const store = createReviewStore(db);
  const manager = createRepositoryManager({ git: createGit({ hooksPath: paths.emptyHooks }), workspacesDir: paths.workspaces });
  const provider = createAiProvider('claude-code-cli', { providerHome: paths.providerHome });
  const published: Array<{ sessionId: string; event: string; data: unknown }> = [];
  const events = {
    publish(sessionId: string, event: string, data: unknown): number {
      published.push({ sessionId, event, data });
      return 1;
    },
  };
  const clones = new Map([[OWN, sandbox.nested], [ENCLOSING, sandbox.project]]);
  const build = () => {
    const lanes = createLanes();
    const service = createSpecContextService({
      store, manager, lanes, provider, events,
      workspace: { cloneFor: (id: string) => clones.get(id) ?? null, enclosingOf: (id: string) => (id === OWN ? ENCLOSING : null) },
      environmentFor: () => ({ repositoryId: OWN, clonePath: sandbox.nested, tracker, limits: { ...DEFAULT_LIMITS } }),
      workspacePath: () => sandbox.nested,
    });
    return { service, lanes };
  };
  const { service, lanes } = build();
  const { sessionId } = seedSession(store);
  let seq = 0;
  /** Appends a snapshot for a pull request whose title holds the key. */
  const snapshot = (title = 'ENG-12 data request', head = String(seq + 1).repeat(40).slice(0, 40)): string => {
    seq += 1;
    const id = randomUUID();
    const repo = { platform: 'scm-test', identifier: 'acme/job' };
    store.appendSnapshot({
      id, sessionId, seq, takenAt: `2026-11-07T10:0${seq}:00.000Z`, headCommit: head, title, description: 'Implements it.', author: 'Ana',
      sourceBranch: { repo, name: 'feature/data' }, targetBranch: { repo, name: 'develop' },
      targetCommit: 'b'.repeat(40), baseCommit: 'c'.repeat(40), diffSource: 'local', diffFingerprint: String(seq).repeat(64).slice(0, 64),
      repositoryStatus: 'found', repositoryReason: null, headRef: `refs/prwb/${sessionId}/${id}/head`, targetRef: `refs/prwb/${sessionId}/${id}/target`,
    });
    return id;
  };
  /** The service's two entry points for a new snapshot, then waits until it is done. */
  const open = async (snapshotId: string): Promise<void> => {
    service.onSnapshotStored(sessionId, snapshotId);
    service.onSnapshot(sessionId, snapshotId);
    await service.settled(sessionId);
  };
  const runs = async (): Promise<number> => (await fake.alignmentInvocations()).length;
  return { sandbox, store, service, lanes, fake, sessionId, snapshot, open, runs, build, published, db };
}

const ownSpec = (s: SpecSandbox, files = specFolder(FOLDER, { spec: '# Own copy\n- **FR-001**: own.\n' })) => s.commitNestedSpec('develop', files);

test('the own repository is searched first, then the enclosing one, and both are reported as searched (FR-002)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  await h.open(snap);
  const report = await h.service.report(h.sessionId, snap);
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.searched.map((s) => s.repository), [OWN, ENCLOSING], 'own first, then the enclosing project repository');
  const [key] = report.keys;
  assert.equal(key?.key, 'ENG-12');
  assert.equal(key?.documents[0]?.kind, 'specification');
  assert.equal(key?.documents[0]?.status, 'found');
  assert.equal(key?.documents[0]?.source?.used.repository, ENCLOSING, 'found only in the enclosing repository');
  assert.equal(key?.documents[1]?.kind, 'tdd-evidence');
  assert.equal(key?.documents[1]?.status, 'found');
  assert.equal(await h.runs(), 1, 'one alignment run for the specification');
});

test('a copy in the own repository wins over the enclosing one, which is listed as another copy (FR-002, FR-004)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  await ownSpec(h.sandbox);
  const snap = h.snapshot();
  await h.open(snap);
  const source = (await h.service.report(h.sessionId, snap)).keys[0]?.documents[0]?.source;
  assert.equal(source?.used.repository, OWN);
  assert.equal(source?.rule, 'own-repository-first');
  assert.deepEqual(source?.others.map((o) => o.repository), [ENCLOSING]);
});

test('the lookup does not block the snapshot: the entry point returns at once and the report says it is searching (FR-018)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  const returned = h.service.onSnapshotStored(h.sessionId, snap);
  assert.equal(returned, undefined, 'nothing to wait on');
  assert.equal((await h.service.report(h.sessionId, snap)).status, 'searching');
  h.service.onSnapshot(h.sessionId, snap);
  await h.service.settled(h.sessionId);
  assert.equal((await h.service.report(h.sessionId, snap)).status, 'ready');
});

test('no key on the pull request gives a gap and no run (FR-015)', async (t) => {
  const h = await harness(t);
  const snap = h.snapshot('Tidy up the readme');
  await h.open(snap);
  const report = await h.service.report(h.sessionId, snap);
  assert.equal(report.status, 'none');
  assert.deepEqual(report.gaps.map((g) => g.kind), ['no-key']);
  assert.equal(report.alignment, undefined);
  assert.equal(await h.runs(), 0);
});

test('a same-head refresh with nothing moved stores nothing and starts no run (FR-016)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  await h.open(snap);
  const before = await h.service.report(h.sessionId, snap);
  assert.equal(before.alignment?.state, 'completed');
  const lookups = h.db.prepare('SELECT COUNT(*) AS n FROM spec_lookup').get() as { n: number };

  h.service.onRefreshed(h.sessionId, snap);
  await h.service.settled(h.sessionId);

  const after = await h.service.report(h.sessionId, snap);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM spec_lookup').get() as { n: number }).n, lookups.n, 'no new lookup row');
  assert.equal(after.revision, before.revision, 'nothing a client shows has changed');
  assert.equal(after.alignment?.runId, before.alignment?.runId);
  assert.equal(after.stale, false);
  assert.equal(await h.runs(), 1);
});

test('a same-head refresh stores a new lookup and queues a new run when a document\'s commit moved (FR-016)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  await h.open(snap);
  const before = await h.service.report(h.sessionId, snap);
  const oldCommit = before.keys[0]?.documents[0]?.source?.used.commit;

  await h.sandbox.moveDocument('develop', `specs/${FOLDER}/spec.md`, '# Changed\n- **FR-001**: changed.\n');
  h.service.onRefreshed(h.sessionId, snap);
  await h.service.settled(h.sessionId);

  const after = await h.service.report(h.sessionId, snap);
  assert.notEqual(after.keys[0]?.documents[0]?.source?.used.commit, oldCommit, 'the new commit is stored');
  assert.notEqual(after.alignment?.runId, before.alignment?.runId, 'a new run');
  assert.equal(await h.runs(), 2);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM spec_alignment_run').get() as { n: number }).n, 2, 'the earlier run is kept');
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM spec_lookup').get() as { n: number }).n, 2, 'the earlier lookup is kept');
});

test('a matching branch that appeared since the lookup makes a new lookup and run, and the branch copy now wins (FR-016, R4)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  await h.open(snap);
  assert.equal((await h.service.report(h.sessionId, snap)).keys[0]?.documents[0]?.source?.used.branch, 'develop');

  await h.sandbox.commitSpec('feature/ENG-12-data', specFolder(FOLDER, { spec: '# Branch\n- **FR-001**: branch.\n' }));
  h.service.onRefreshed(h.sessionId, snap);
  await h.service.settled(h.sessionId);

  const after = await h.service.report(h.sessionId, snap);
  const source = after.keys[0]?.documents[0]?.source;
  assert.equal(source?.used.branch, 'feature/ENG-12-data');
  assert.equal(source?.rule, 'matching-branch-over-develop');
  assert.equal(await h.runs(), 2);
});

test('a git failure becomes a read-failed gap with the first error line, and the report still loads (FR-018)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  for (const repo of [h.sandbox.nested, h.sandbox.project]) await h.sandbox.git(repo, 'remote', 'set-url', 'origin', join(h.sandbox.root, 'gone.git'));
  const snap = h.snapshot();
  await h.open(snap);
  const report = await h.service.report(h.sessionId, snap);
  assert.equal(report.status, 'failed');
  const gap = report.gaps.find((g) => g.kind === 'read-failed');
  assert.ok(gap, 'a read-failed gap');
  assert.ok(gap.message.trim() !== '' && !gap.message.includes('\n'), 'the first git error line only');
  assert.equal(report.alignment, undefined, 'no run without a specification');
  assert.equal(await h.runs(), 0);
});

test('an AI failure keeps the documents, shows the failure, and a retry makes a new run on the same documents (FR-018)', async (t) => {
  const h = await harness(t, { scenario: 'structured', alignmentScenario: 'error-on-start' });
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  await h.open(snap);
  const failed = await h.service.report(h.sessionId, snap);
  assert.equal(failed.alignment?.state, 'failed');
  assert.ok((failed.alignment?.reason ?? '') !== '', 'the reason is shown');
  assert.equal(failed.keys[0]?.documents[0]?.status, 'found', 'the documents are kept');
  assert.equal(failed.canRetry.allowed, true);

  await h.fake.configure({ scenario: 'structured' });
  const { runId } = await h.service.retry(h.sessionId, snap);
  assert.ok(runId, 'a run id for the new attempt');
  await h.service.settled(h.sessionId);

  const retried = await h.service.report(h.sessionId, snap);
  assert.equal(retried.alignment?.state, 'completed');
  assert.notEqual(retried.alignment?.runId, failed.alignment?.runId);
  assert.equal(retried.keys[0]?.documents[0]?.documentId, failed.keys[0]?.documents[0]?.documentId, 'the same stored document, not a new lookup');
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM spec_alignment_run').get() as { n: number }).n, 2, 'the failed run is kept');
});

test('a restart leaves no run behind and the report shows the restart notice and allows a retry (FR-016)', async (t) => {
  const h = await harness(t, { scenario: 'structured', alignmentScenario: 'slow' });
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  h.service.onSnapshotStored(h.sessionId, snap);
  h.service.onSnapshot(h.sessionId, snap);
  await h.fake.waitForInvocations(1);
  // The run is held mid-way; the process "restarts": a new service and lanes over the same store, with nothing running.
  const restarted = h.build();
  const report = await restarted.service.report(h.sessionId, snap);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM spec_alignment_run').get() as { n: number }).n, 0, 'no run row for interrupted work');
  assert.match(JSON.stringify(report), /Alignment assessment missing: the workbench was restarted/);
  assert.deepEqual(report.alignment?.rows ?? [], []);
  assert.equal(report.keys[0]?.documents[0]?.status, 'found', 'the documents remain');
  assert.equal(report.canRetry.allowed, true);

  await h.fake.release();
  await h.lanes.settledRunning(h.sessionId);
});

test('a newer snapshot cancels the earlier run as superseded and runs its own (FR-016)', async (t) => {
  const h = await harness(t, { scenario: 'structured', alignmentScenario: 'slow' });
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const first = h.snapshot();
  h.service.onSnapshotStored(h.sessionId, first);
  h.service.onSnapshot(h.sessionId, first);
  await h.fake.waitForInvocations(1);

  const second = h.snapshot('ENG-12 data request', 'd'.repeat(40));
  h.service.onSnapshotStored(h.sessionId, second);
  h.service.onSnapshot(h.sessionId, second);
  await h.fake.release();
  await h.service.settled(h.sessionId);

  const earlier = await h.service.report(h.sessionId, first);
  assert.equal(earlier.alignment?.state, 'cancelled');
  assert.match(earlier.alignment?.reason ?? '', /superseded|newer/i);
  assert.equal(earlier.stale, true, 'an older snapshot is never shown as current');
  const later = await h.service.report(h.sessionId, second);
  assert.equal(later.alignment?.state, 'completed');
  assert.equal(later.stale, false);
});

test('a same-head refresh that cannot read keeps the stored documents and the assessment (FR-010, FR-018)', async (t) => {
  const h = await harness(t);
  await h.sandbox.commitSpec('develop', specFolder(FOLDER));
  const snap = h.snapshot();
  await h.open(snap);
  const before = await h.service.report(h.sessionId, snap);
  assert.equal(before.alignment?.state, 'completed');
  const lookups = (h.db.prepare('SELECT COUNT(*) AS n FROM spec_lookup').get() as { n: number }).n;

  for (const repo of [h.sandbox.nested, h.sandbox.project]) await h.sandbox.git(repo, 'remote', 'set-url', 'origin', join(h.sandbox.root, 'gone.git'));
  h.service.onRefreshed(h.sessionId, snap);
  await h.service.settled(h.sessionId);

  const after = await h.service.report(h.sessionId, snap);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM spec_lookup').get() as { n: number }).n, lookups, 'a failed re-check stores nothing');
  assert.equal(after.keys[0]?.documents[0]?.status, 'found');
  assert.equal(after.alignment?.runId, before.alignment?.runId);
  assert.equal(await h.runs(), 1);
});
