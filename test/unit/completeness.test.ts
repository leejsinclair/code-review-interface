// VO-027 (FR-007, FR-049): the context-completeness list derived from the session status, the latest
// snapshot and the latest Evidence per issue. The PR and repository rows are derived, never read from
// Evidence; the repository row lists every file left out of prompts with its reason.
//
// API required from src/core/completeness.ts (T066):
//
//   export type CompletenessInput = {
//     status: SessionStatus;               // src/store/review-store.ts records
//     latest: PrSnapshot;
//     changedFiles: ChangedFile[];         // the latest snapshot's, in diff order
//     references: IssueReference[];        // the latest snapshot's
//     evidence: Evidence[];                // every Evidence record of the session, oldest first
//     promptExclusions: ExcludedFile[];    // the latest completed summary prompt's excludedFiles
//   };
//   export function deriveCompleteness(input: CompletenessInput):
//     { completeness: CompletenessRow[]; issues: IssueReference[] };      // wire types, src/contracts/http.ts
//   export function readCompleteness(store: ReviewStore, sessionId: string):
//     { completeness: CompletenessRow[]; issues: IssueReference[] } | null; // null for an unknown session

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompletenessRow, IssueReference as WireIssueReference } from '../../src/contracts/http.ts';
import type {
  ChangedFile,
  Evidence,
  IssueReference,
  PrSnapshot,
  SessionStatus,
} from '../../src/store/review-store.ts';

type CompletenessModule = typeof import('../../src/core/completeness.ts');
const load = (): Promise<CompletenessModule> => import('../../src/core/completeness.ts');

const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const SESSION = '00000000-0000-4000-8000-000000000001';
const SNAPSHOT = '00000000-0000-4000-8000-000000000002';
const REPO = { platform: 'source-a', identifier: 'acme/widgets' };

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: SESSION,
    prStatus: 'open',
    statusNote: null,
    lastCheckedAt: '2026-11-07T10:00:00.000Z',
    lastCheckedHead: HEAD,
    lastCheckOutcome: 'ok',
    lastCheckError: null,
    lastOpenedAt: '2026-11-07T10:00:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    id: SNAPSHOT,
    sessionId: SESSION,
    seq: 1,
    takenAt: '2026-11-07T09:00:00.000Z',
    headCommit: HEAD,
    title: 'Allow password reset more than once',
    description: 'Fixes ABC-12.',
    author: 'alice',
    sourceBranch: { repo: REPO, name: 'feature/ABC-12-reset' },
    targetBranch: { repo: REPO, name: 'main' },
    targetCommit: 'c'.repeat(40),
    baseCommit: 'd'.repeat(40),
    diffSource: 'local',
    diffFingerprint: 'e'.repeat(64),
    repositoryStatus: 'found',
    repositoryReason: null,
    headRef: `refs/prwb/${SESSION}/${SNAPSHOT}/head`,
    targetRef: `refs/prwb/${SESSION}/${SNAPSHOT}/target`,
    ...overrides,
  };
}

function missingRepository(reason: string): PrSnapshot {
  return snapshot({
    diffSource: 'platform',
    repositoryStatus: 'missing',
    repositoryReason: reason,
    baseCommit: null,
    targetCommit: null,
    headRef: null,
    targetRef: null,
  });
}

function file(ordinal: number, path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    snapshotId: SNAPSHOT,
    ordinal,
    path,
    oldPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    sizeBytes: 100,
    language: null,
    patch: '@@ -1 +1 @@\n-a\n+b\n',
    excludedReason: null,
    ...overrides,
  };
}

function reference(key: string, kind: IssueReference['kind'] = 'issue'): IssueReference {
  return {
    snapshotId: SNAPSHOT,
    issue: { platform: 'tracker-a', key },
    kind,
    origins: [{ field: 'description', text: key }],
  };
}

let evidenceSeq = 0;
function evidence(key: string, overrides: Partial<Evidence> = {}): Evidence {
  evidenceSeq += 1;
  const status = overrides.status ?? 'current';
  return {
    id: `00000000-0000-4000-8000-1000000000${String(evidenceSeq).padStart(2, '0')}`,
    sessionId: SESSION,
    snapshotId: SNAPSHOT,
    kind: 'issue',
    source: { platform: 'tracker-a', key },
    capturedAt: `2026-11-07T09:00:${String(evidenceSeq).padStart(2, '0')}.000Z`,
    commit: HEAD,
    commitBound: false,
    status,
    reason: null,
    lastGoodId: null,
    payload:
      status === 'current'
        ? { platform: 'tracker-a', key, title: `Title of ${key}`, descriptionText: `Text of ${key}`, webUrl: '' }
        : null,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<CompletenessModule['deriveCompleteness']>[0]> = {}) {
  return {
    status: status(),
    latest: snapshot(),
    changedFiles: [file(0, 'src/a.ts')],
    references: [] as IssueReference[],
    evidence: [] as Evidence[],
    promptExclusions: [] as { path: string; reason: string }[],
    ...overrides,
  };
}

function row<S extends CompletenessRow['source']>(rows: CompletenessRow[], source: S): Extract<CompletenessRow, { source: S }> {
  const found = rows.find((r) => r.source === source);
  assert.ok(found, `a ${source} row`);
  return found as Extract<CompletenessRow, { source: S }>;
}

function issue(issues: WireIssueReference[], key: string): WireIssueReference {
  const found = issues.find((i) => i.key === key);
  assert.ok(found, `issue ${key}`);
  return found;
}

// ---------------------------------------------------------------- PR row

test('VO-027 the PR row is found when the last check saw the latest snapshot head', async () => {
  const { deriveCompleteness } = await load();
  const { completeness } = deriveCompleteness(input());
  assert.deepEqual(
    completeness.map((r) => r.source),
    ['pr', 'repository', 'issue'],
    'exactly the three rows this feature checks',
  );
  assert.equal(row(completeness, 'pr').status, 'found');
});

test('VO-027 the PR row is stale with a reason when the platform head moved past the latest snapshot', async () => {
  const { deriveCompleteness } = await load();
  const pr = row(deriveCompleteness(input({ status: status({ lastCheckedHead: MOVED }) })).completeness, 'pr');
  assert.equal(pr.status, 'stale');
  assert.ok(pr.reason && pr.reason.length > 0, 'the stale PR row says why');
});

test('VO-027 the PR row is stale with the check error when the platform could not be reached', async () => {
  const { deriveCompleteness } = await load();
  const pr = row(
    deriveCompleteness(
      input({
        status: status({ lastCheckOutcome: 'unreachable', lastCheckedHead: null, lastCheckError: 'platform unreachable: HTTP 503' }),
      }),
    ).completeness,
    'pr',
  );
  assert.equal(pr.status, 'stale');
  assert.equal(pr.reason, 'platform unreachable: HTTP 503');
});

// ---------------------------------------------------------------- repository row

test('VO-027 the repository row is found when a matching clone was found and the head fetched', async () => {
  const { deriveCompleteness } = await load();
  const repository = row(deriveCompleteness(input()).completeness, 'repository');
  assert.equal(repository.status, 'found');
  assert.equal(repository.reason, undefined);
  assert.deepEqual(repository.skippedFiles, []);
});

test('VO-027 the repository row is missing with the reason when no clone was found', async () => {
  const { deriveCompleteness } = await load();
  const repository = row(
    deriveCompleteness(input({ latest: missingRepository('no clone at the configured path') })).completeness,
    'repository',
  );
  assert.equal(repository.status, 'missing');
  assert.equal(repository.reason, 'no clone at the configured path');
});

test('VO-027 the repository row lists per-file and prompt-limit skipped files in diff order', async () => {
  const { deriveCompleteness } = await load();
  const changedFiles = [
    file(0, 'assets/logo.png', { binary: true, excludedReason: 'binary', patch: null }),
    file(1, 'src/a.ts'),
    file(2, 'data/huge.json', { sizeBytes: 2_000_000, excludedReason: 'file size' }),
    file(3, 'src/generated.ts', { additions: 6000, excludedReason: 'changed lines' }),
    file(4, 'src/z.ts'),
  ];
  const repository = row(
    deriveCompleteness(
      input({
        changedFiles,
        // A stored prompt lists every file it left out: the per-file ones and the budget cut.
        promptExclusions: [
          { path: 'assets/logo.png', reason: 'binary' },
          { path: 'data/huge.json', reason: 'file size' },
          { path: 'src/generated.ts', reason: 'changed lines' },
          { path: 'src/z.ts', reason: 'prompt limit' },
        ],
      }),
    ).completeness,
    'repository',
  );
  assert.deepEqual(repository.skippedFiles, [
    { path: 'assets/logo.png', reason: 'binary' },
    { path: 'data/huge.json', reason: 'file-too-large' },
    { path: 'src/generated.ts', reason: 'too-many-changed-lines' },
    { path: 'src/z.ts', reason: 'prompt limit' },
  ]);
});

// ---------------------------------------------------------------- issue row

test('VO-027 the issue row is missing when the PR has no issue reference', async () => {
  const { deriveCompleteness } = await load();
  const { completeness, issues } = deriveCompleteness(input({ references: [reference('#7', 'pull-request')] }));
  const issueRow = row(completeness, 'issue');
  assert.equal(issueRow.status, 'missing');
  assert.ok(issueRow.reason && issueRow.reason.length > 0, 'the missing issue row says why');
  assert.deepEqual(issueRow.issues, [], 'a pull-request reference is not counted as an issue');
  assert.equal(issue(issues, '#7').kind, 'pull-request', 'it is still returned as a PR reference');
});

test('VO-027 a fetched issue is found with its title and plain-text description', async () => {
  const { deriveCompleteness } = await load();
  const { completeness, issues } = deriveCompleteness(
    input({ references: [reference('ABC-12')], evidence: [evidence('ABC-12')] }),
  );
  const issueRow = row(completeness, 'issue');
  assert.equal(issueRow.status, 'found');
  const abc = issue(issueRow.issues, 'ABC-12');
  assert.equal(abc.status, 'found');
  assert.equal(abc.title, 'Title of ABC-12');
  assert.equal(abc.descriptionText, 'Text of ABC-12');
  assert.deepEqual(abc.origins, ['description']);
  assert.equal(abc.evidence?.status, 'current');
  assert.deepEqual(issue(issues, 'ABC-12'), abc);
});

test('VO-027 an unresolved issue is missing with its reason and is not dropped', async () => {
  const { deriveCompleteness } = await load();
  const { completeness } = deriveCompleteness(
    input({
      references: [reference('ABC-12'), reference('ABC-999')],
      evidence: [evidence('ABC-12'), evidence('ABC-999', { status: 'missing', reason: 'not found' })],
    }),
  );
  const issueRow = row(completeness, 'issue');
  assert.equal(issueRow.issues.length, 2);
  const wrong = issue(issueRow.issues, 'ABC-999');
  assert.equal(wrong.status, 'missing');
  assert.equal(wrong.reason, 'not found');
  assert.equal(issue(issueRow.issues, 'ABC-12').status, 'found');
  assert.notEqual(issueRow.status, 'found', 'the row is not found while one issue is missing');
});

test('VO-027 a failed re-fetch shows the issue stale with the reason and the last fetched text', async () => {
  const { deriveCompleteness } = await load();
  const good = evidence('ABC-12');
  const stale = evidence('ABC-12', { status: 'stale', reason: 'tracker unreachable', lastGoodId: good.id });
  const issueRow = row(
    deriveCompleteness(input({ references: [reference('ABC-12')], evidence: [good, stale] })).completeness,
    'issue',
  );
  assert.equal(issueRow.status, 'stale');
  const abc = issue(issueRow.issues, 'ABC-12');
  assert.equal(abc.status, 'stale');
  assert.equal(abc.reason, 'tracker unreachable');
  assert.equal(abc.title, 'Title of ABC-12', 'the last fetched record is shown');
  assert.equal(abc.descriptionText, 'Text of ABC-12');
});

test('VO-027 the latest Evidence record per issue decides its status', async () => {
  const { deriveCompleteness } = await load();
  const failed = evidence('ABC-12', { status: 'missing', reason: 'tracker unreachable' });
  const fetched = evidence('ABC-12');
  const abc = issue(
    row(deriveCompleteness(input({ references: [reference('ABC-12')], evidence: [failed, fetched] })).completeness, 'issue')
      .issues,
    'ABC-12',
  );
  assert.equal(abc.status, 'found');
});

// ---------------------------------------------------------------- not from Evidence

test('VO-027 the PR and repository rows are never read from Evidence', async () => {
  const { deriveCompleteness } = await load();
  const base = input({ latest: missingRepository('fetch failed: remote hung up') });
  const without = deriveCompleteness(base).completeness;
  // Evidence records that, if the rows were read from Evidence, would change them.
  const misleading: Evidence[] = [
    evidence('pr', { kind: 'custom', commitBound: true, status: 'current' }),
    evidence('repository', { kind: 'custom', commitBound: true, status: 'current' }),
    evidence('ABC-1', { kind: 'custom', commitBound: true, status: 'missing', reason: 'x', commit: MOVED }),
  ];
  const withEvidence = deriveCompleteness({ ...base, evidence: misleading }).completeness;
  assert.deepEqual(row(withEvidence, 'pr'), row(without, 'pr'));
  assert.deepEqual(row(withEvidence, 'repository'), row(without, 'repository'));
});

test('VO-027 readCompleteness takes prompt-limit files from the latest completed summary prompt in the store', async () => {
  const { readCompleteness } = await load();
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const db = openDatabase(':memory:');
  try {
    const store = createReviewStore(db);
    store.appendSession({ id: SESSION, pr: { repo: REPO, number: 1 }, createdAt: '2026-11-07T09:00:00.000Z' });
    store.upsertSessionStatus(status());
    store.appendSnapshot(snapshot());
    store.appendChangedFile(file(0, 'src/a.ts'));
    store.appendChangedFile(file(1, 'src/b.ts'));
    store.appendChangedFile(file(2, 'src/c.ts'));

    const prompt = (id: string, runId: string, cut: string) => ({
      id,
      summaryRunId: runId,
      instructions: 'instructions',
      data: 'data',
      contextVersion: `${HEAD}:${'f'.repeat(64)}`,
      excludedFiles: [{ path: cut, reason: 'prompt limit' }],
      dataChars: 10,
      restrictionsNotEnforced: [],
      sentAt: '2026-11-07T09:10:00.000Z',
    });
    const done = (id: string, runId: string, outcome: 'completed' | 'failed') => ({
      id,
      summaryRunId: runId,
      outcome,
      cancelReason: null,
      failureReason: outcome === 'failed' ? 'provider error' : null,
      warning: null,
      rawText: null,
      contextVersion: `${HEAD}:${'f'.repeat(64)}`,
      restrictionsNotEnforced: [],
      finishedAt: '2026-11-07T09:20:00.000Z',
    });
    const run1 = '00000000-0000-4000-8000-200000000001';
    const run2 = '00000000-0000-4000-8000-200000000002';
    store.appendSummaryRun({ id: run1, snapshotId: SNAPSHOT, requestedAt: '2026-11-07T09:01:00.000Z', provider: 'ai-a' });
    store.appendStoredPrompt(prompt('00000000-0000-4000-8000-300000000001', run1, 'src/c.ts'));
    store.appendSummary(done('00000000-0000-4000-8000-400000000001', run1, 'completed'));
    // A later run that failed does not replace the completed one's exclusions.
    store.appendSummaryRun({ id: run2, snapshotId: SNAPSHOT, requestedAt: '2026-11-07T09:30:00.000Z', provider: 'ai-a' });
    store.appendStoredPrompt(prompt('00000000-0000-4000-8000-300000000002', run2, 'src/b.ts'));
    store.appendSummary(done('00000000-0000-4000-8000-400000000002', run2, 'failed'));

    const result = readCompleteness(store, SESSION);
    assert.ok(result);
    assert.deepEqual(row(result.completeness, 'repository').skippedFiles, [{ path: 'src/c.ts', reason: 'prompt limit' }]);
    assert.equal(readCompleteness(store, '00000000-0000-4000-8000-999999999999'), null);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------------------------------------
// T035 (specs/006-spec-context, FR-009, FR-010): the `specification` and `tdd-evidence` rows, derived on read from
// the latest lookup. `CompletenessInput` gains `spec?: SpecLookupWithParts | null` (absent: no rows, as before;
// null: no lookup stored, both rows missing) and the two rows follow the issue row.
// ---------------------------------------------------------------------------------------------------------

type SpecInput = NonNullable<import('../../src/core/completeness.ts').CompletenessInput['spec']>;

function lookup(documents: SpecInput['documents'], over: Partial<SpecInput['lookup']> = {}): SpecInput {
  return {
    lookup: {
      id: 'l1', snapshotId: SNAPSHOT, lookedAt: '2026-11-07T10:00:00.000Z', trigger: 'snapshot', keys: ['ABC-12'], searched: [],
      enclosingNote: 'found', outcome: 'found', reason: null, ...over,
    },
    sources: [],
    documents,
  };
}
const doc = (key: string, kind: 'specification' | 'tdd-evidence', found: boolean, reason = 'no folder'): SpecInput['documents'][number] => ({
  id: `${key}-${kind}`, key, kind, status: found ? 'found' : 'missing', sourceId: found ? 's' : null, filePath: found ? `specs/${key}/x.md` : null,
  commitSha: found ? '1'.repeat(40) : null, content: found ? 'text' : null, contentSha256: found ? 'a'.repeat(64) : null, otherFiles: [], missingReason: found ? null : reason,
});
const specRows = (rows: CompletenessRow[]): CompletenessRow[] => rows.filter((r) => r.source === 'specification' || r.source === 'tdd-evidence');

test('no spec input leaves the three rows as they were', async () => {
  const { deriveCompleteness } = await load();
  const { completeness } = deriveCompleteness({ status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [] });
  assert.deepEqual(completeness.map((r) => r.source), ['pr', 'repository', 'issue']);
});

test('no stored lookup: both rows are missing, never found', async () => {
  const { deriveCompleteness } = await load();
  const { completeness } = deriveCompleteness({ status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [], spec: null });
  assert.deepEqual(completeness.map((r) => r.source), ['pr', 'repository', 'issue', 'specification', 'tdd-evidence']);
  for (const row of specRows(completeness)) {
    assert.equal(row.status, 'missing');
    assert.ok((row as { reason?: string }).reason, 'a reason is given');
  }
});

test('found documents give found rows; a missing evidence file gives a missing row with its reason', async () => {
  const { deriveCompleteness } = await load();
  const both = deriveCompleteness({ status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [], spec: lookup([doc('ABC-12', 'specification', true), doc('ABC-12', 'tdd-evidence', true)]) });
  assert.deepEqual(specRows(both.completeness).map((r) => r.status), ['found', 'found']);
  const noEvidence = deriveCompleteness({ status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [], spec: lookup([doc('ABC-12', 'specification', true), doc('ABC-12', 'tdd-evidence', false, 'no evidence file')], { outcome: 'partial', reason: 'x' }) });
  const [spec, tdd] = specRows(noEvidence.completeness) as Array<{ status: string; reason?: string }>;
  assert.equal(spec?.status, 'found');
  assert.equal(tdd?.status, 'missing');
  assert.match(tdd?.reason ?? '', /no evidence file/);
});

test('no key and a failed read are missing with their reasons', async () => {
  const { deriveCompleteness } = await load();
  const noKey = deriveCompleteness({ status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [], spec: lookup([], { keys: [], outcome: 'no-key', reason: 'No key was found to search with.' }) });
  assert.match((specRows(noKey.completeness)[0] as { reason?: string }).reason ?? '', /no key/i);
  const failed = deriveCompleteness({ status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [], spec: lookup([doc('ABC-12', 'specification', false, 'read failed: fatal: unable to access'), doc('ABC-12', 'tdd-evidence', false, 'read failed: fatal: unable to access')], { outcome: 'failed', reason: 'fatal: unable to access' }) });
  assert.match((specRows(failed.completeness)[0] as { reason?: string }).reason ?? '', /unable to access/);
});

test('several keys: the row is missing and names the key whose document is missing', async () => {
  const { deriveCompleteness } = await load();
  const { completeness } = deriveCompleteness({
    status: status(), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [],
    spec: lookup([doc('ABC-12', 'specification', true), doc('ABC-12', 'tdd-evidence', true), doc('ABC-99', 'specification', false), doc('ABC-99', 'tdd-evidence', true)], { keys: ['ABC-12', 'ABC-99'], outcome: 'partial', reason: 'x' }),
  });
  const [spec, tdd] = specRows(completeness) as Array<{ status: string; reason?: string }>;
  assert.equal(spec?.status, 'missing');
  assert.match(spec?.reason ?? '', /ABC-99/);
  assert.equal(tdd?.status, 'found');
});

test('a head that moved past the snapshot marks found documents stale, with the reason', async () => {
  const { deriveCompleteness, HEAD_MOVED_REASON } = await load();
  const { completeness } = deriveCompleteness({
    status: status({ lastCheckedHead: MOVED }), latest: snapshot(), changedFiles: [], references: [], evidence: [], promptExclusions: [],
    spec: lookup([doc('ABC-12', 'specification', true), doc('ABC-12', 'tdd-evidence', false, 'no evidence file')], { outcome: 'partial', reason: 'x' }),
  });
  const [spec, tdd] = specRows(completeness) as Array<{ status: string; reason?: string }>;
  assert.equal(spec?.status, 'stale');
  assert.equal(spec?.reason, HEAD_MOVED_REASON);
  assert.equal(tdd?.status, 'missing', 'a missing document is never turned into stale');
});
