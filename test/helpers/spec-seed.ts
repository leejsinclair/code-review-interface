// Seeds the specification records for a snapshot of a composed workbench (feature 006). The git lookup is proved in
// spec-lookup-git.test.ts and spec-context-service.test.ts; the browser and end-to-end tests here seed what a lookup
// and an AI run would have stored, so each journey is deterministic and does not depend on a project clone.

import { randomUUID } from 'node:crypto';
import type { ReviewStore } from '../../src/store/review-store.ts';

export const SPEC_TEXT = '# Spec\n\n- **FR-001**: The system MUST do the first thing.\n- **FR-002**: The system MUST do the second thing.\n- **FR-003**: The system MUST do the third thing.\n- **FR-004**: The system MUST do the fourth thing.\n- **FR-005**: The system MUST do the fifth thing.\n';
export const TDD_TEXT = '# TDD evidence\n\n- FR-001: test `first` fails then passes.\n- FR-002: test `second` fails then passes.\n- FR-003: test `third` fails then passes.\n- FR-004: test `fourth` fails then passes.\n';

type Rec = Record<string, unknown>;
export type SeedOptions = {
  key?: string;
  /** No tdd-evidence document (missing, with its reason). */
  evidence?: boolean;
  /** Which run to store: a completed five-criteria run, a failed one, or none. */
  run?: 'completed' | 'failed' | 'none';
  /** Branch the specification was read from; a `develop` copy is listed when it is not `develop`. */
  branch?: string;
  /** Deviations in the completed run. */
  deviations?: boolean;
  outcome?: 'found' | 'not-found' | 'no-key' | 'partial' | 'failed';
  enclosingNote?: 'found' | 'not-inside-project';
  commit?: string;
};

export type SeededSpec = { lookupId: string; specDocumentId: string; tddDocumentId: string | null; runId: string | null };

/** Later than any lookup the workbench makes itself, so the seeded lookup is the latest. */
const LATER = (): string => new Date(Date.now() + 3_600_000).toISOString();

export function seedSpec(store: ReviewStore, snapshotId: string, options: SeedOptions = {}): SeededSpec {
  const key = options.key ?? 'ABC-12';
  const evidence = options.evidence ?? true;
  const branch = options.branch ?? 'develop';
  const commit = options.commit ?? '1'.repeat(40);
  const outcome = options.outcome ?? (evidence ? 'found' : 'partial');
  const folder = `specs/006-${key}-x`;
  const ids = { lookupId: randomUUID(), sourceId: randomUUID(), specDocumentId: randomUUID(), tddDocumentId: randomUUID() };
  const noSpec = outcome === 'not-found' || outcome === 'no-key' || outcome === 'failed';
  const keys = outcome === 'no-key' ? [] : [key];
  const missingDoc = (kind: string, reason: string): Rec => ({
    id: randomUUID(), key, kind, status: 'missing', sourceId: null, filePath: null, commitSha: null, content: null, contentSha256: null, otherFiles: [], missingReason: reason,
  });
  const found = (id: string, kind: string, file: string, content: string, sha: string): Rec => ({
    id, key, kind, status: 'found', sourceId: ids.sourceId, filePath: `${folder}/${file}`, commitSha: commit, content, contentSha256: sha.repeat(64), otherFiles: [], missingReason: null,
  });
  const documents: Rec[] = noSpec
    ? keys.length === 0 ? [] : [missingDoc('specification', 'no folder'), missingDoc('tdd-evidence', 'no folder')]
    : [found(ids.specDocumentId, 'specification', 'spec.md', SPEC_TEXT, 'a'), evidence ? found(ids.tddDocumentId, 'tdd-evidence', 'tdd-evidence.md', TDD_TEXT, 'b') : missingDoc('tdd-evidence', 'no evidence file')];
  const sources: Rec[] = noSpec
    ? []
    : [{
        id: ids.sourceId, key, repository: 'project-hd-v3', branch, commitSha: commit, folder,
        ruleUsed: branch === 'develop' ? 'develop' : 'matching-branch',
        otherCopies: branch === 'develop' ? [] : [{ repository: 'project-hd-v3', branch: 'develop', commitSha: '2'.repeat(40), folder }],
        developCopyExists: branch !== 'develop', matchesKey: true,
      }];
  store.appendSpecLookup({
    lookup: {
      id: ids.lookupId, snapshotId, lookedAt: LATER(), trigger: 'snapshot', keys,
      searched: [{ repository: 'project-hd-v3', role: 'enclosing', heads: ['develop'] }],
      enclosingNote: options.enclosingNote ?? 'found', outcome,
      reason: outcome === 'found' ? null : outcome === 'no-key' ? 'No key was found to search with.' : outcome === 'failed' ? 'fatal: unable to access the remote' : 'no evidence or folder',
    },
    sources, documents,
  } as never);

  const run = options.run ?? (noSpec ? 'none' : 'completed');
  if (noSpec || run === 'none') return { lookupId: ids.lookupId, specDocumentId: ids.specDocumentId, tddDocumentId: evidence ? ids.tddDocumentId : null, runId: null };
  const runId = randomUUID();
  const t = LATER();
  const base = {
    id: runId, snapshotId, lookupId: ids.lookupId, specDocumentId: ids.specDocumentId, tddDocumentId: evidence ? ids.tddDocumentId : null,
    requestedAt: t, finishedAt: t, provider: 'fake', contextVersion: `${'a'.repeat(40)}:${'d'.repeat(64)}`, leftOut: [], restrictionsNotEnforced: [], warning: null,
  };
  if (run === 'failed') {
    store.appendSpecAlignmentRun({ ...base, outcome: 'failed', cancelReason: null, failureReason: 'the provider failed to start', specSummary: null, tddSummary: null, verdict: null, verdictText: null, rows: [], items: [] } as never);
    return { lookupId: ids.lookupId, specDocumentId: ids.specDocumentId, tddDocumentId: evidence ? ids.tddDocumentId : null, runId };
  }
  const cite = (line: number): Rec => ({ type: 'spec', documentId: ids.specDocumentId, quote: `FR-00${line - 2}`, startLine: line, endLine: line, resolved: true });
  const tdd = (line: number): Rec => ({ type: 'tdd', documentId: ids.tddDocumentId, startLine: line, endLine: line, resolved: true });
  const row = (n: number, state: string, test: string, mismatch: boolean, citations: Rec[], unverified = false): Rec => ({
    ordinal: n - 1, criterionRef: `FR-00${n}`, criterionText: `The system MUST do thing ${n}.`, implementationState: state,
    testShown: evidence ? test : 'no-evidence-available', testMismatch: evidence && mismatch, note: `Reason for FR-00${n}.`, unverified, citations,
  });
  const rows = [
    row(1, 'implementation-and-test', 'shown', false, [cite(3), tdd(3)]),
    row(2, 'implementation-and-test', 'shown', false, [cite(4), tdd(4)]),
    row(3, 'requires-verification', 'shown', true, [cite(5), tdd(5)]),
    row(4, 'implementation', 'shown', false, [cite(6)]),
    row(5, 'implementation', 'none', false, [{ type: 'code', path: 'src/util.js', side: 'head', startLine: 1, endLine: 2, resolved: true }]),
  ];
  const items: Rec[] = evidence
    ? [
        { ordinal: 0, kind: 'uncovered-criterion', rowOrdinal: 4, text: 'Criterion FR-005 has no test shown.', unverified: false, citations: rows[4]?.['citations'] },
        { ordinal: 1, kind: 'test-may-not-test-right-thing', rowOrdinal: 2, text: 'The third test checks a different behaviour.', unverified: false, citations: [tdd(5)] },
      ]
    : [];
  if (options.deviations === true) {
    items.push(
      { ordinal: items.length, kind: 'implemented-not-requested', rowOrdinal: null, text: 'Adds a cache the specification never mentions.', unverified: false, citations: [{ type: 'code', path: 'src/util.js', side: 'head', startLine: 1, endLine: 2, resolved: true }] },
      { ordinal: items.length + 1, kind: 'requested-not-implemented', rowOrdinal: 4, text: 'FR-005 asks for a behaviour no change provides.', unverified: true, citations: [] },
    );
  }
  store.appendSpecAlignmentRun({
    ...base, outcome: 'completed', cancelReason: null, failureReason: null,
    specSummary: 'The specification asks for five behaviours.', tddSummary: evidence ? 'Four of them have a test.' : null,
    verdict: evidence ? 'incomplete' : 'cannot-judge', verdictText: evidence ? 'One criterion has no test.' : 'The TDD evidence is missing.',
    rows: rows.map((r) => (evidence ? r : { ...r, testShown: 'no-evidence-available', testMismatch: false, implementationState: r['implementationState'] === 'implementation-and-test' ? 'implementation' : r['implementationState'] })),
    items,
  } as never);
  return { lookupId: ids.lookupId, specDocumentId: ids.specDocumentId, tddDocumentId: evidence ? ids.tddDocumentId : null, runId };
}
