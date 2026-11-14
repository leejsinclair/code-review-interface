// T003 (specs/006-spec-context, R3, R4, data-model.md "Validation rules"): the pure rules that match a Jira key
// to spec folders and files and choose which copy of a document to read. Written first (constitution XI):
// src/core/spec-match.ts arrives in Wave 2 (T016), so this fails until then with a missing module.
//
// API required from src/core/spec-match.ts (no I/O, no platform or key-pattern knowledge, VIII.2):
//
//   export function keyMatchesName(key: string, name: string): boolean;
//     The name contains the key, case-insensitively, with no letter or digit directly before it and no digit
//     directly after it (R3).
//   export function matchingFolders(key: string, treePaths: readonly string[]): string[];
//     From `ls-tree -r --name-only` paths, the distinct `specs/<name>` folders that hold at least one file and
//     whose <name> matches the key, in first-seen order. Only direct children of `specs/` count.
//   export function chooseDocumentFiles(folderPaths: readonly string[]): {
//     specFile: string | null; otherSpecFiles: string[]; evidenceFile: string | null;
//   };
//     `folderPaths` are file paths inside one folder. `specFile` is a file whose name ends in `spec.md` (the
//     first in path order when there are several, the rest listed in `otherSpecFiles`); `evidenceFile` is the
//     file named exactly `tdd-evidence.md`, directly in the folder or else in its `tests/` subfolder. Names are
//     compared as written (lower case).
//   export type SpecCandidate = {
//     repository: string; role: 'own' | 'enclosing'; branch: string; commit: string; committedAt: string; folder: string;
//   };
//   export type SpecChoice = { used: SpecCandidate; rule: SpecRule; others: SpecCandidate[] };
//     where SpecRule is the wire union of contracts/http-api.md: 'own-repository-first' |
//     'matching-branch-over-develop' | 'most-recent-commit' | 'only-candidate'.
//   export function chooseCopy(key: string, candidates: readonly SpecCandidate[]): SpecChoice | null;
//     Ranks by repository (own before enclosing), then a branch matching the key over `develop`, then the most
//     recent `committedAt`. `rule` names the step that decided; `others` holds every other candidate in rank
//     order; null for no candidates. Never mutates its input.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpecCandidate } from '../../src/core/spec-match.ts';
import { chooseCopy, chooseDocumentFiles, keyMatchesName, matchingFolders } from '../../src/core/spec-match.ts';
import * as match from '../../src/core/spec-match.ts';

const KEY = 'ENG-1213';

function candidate(over: Partial<SpecCandidate> = {}): SpecCandidate {
  return {
    repository: 'project-hd-v3', role: 'enclosing', branch: 'develop', commit: 'a'.repeat(40),
    committedAt: '2026-11-01T10:00:00.000Z', folder: 'specs/006-ENG-1213-data-request', ...over,
  };
}

test('the whole key matches: a longer number or a glued letter or digit does not', () => {
  assert.equal(keyMatchesName(KEY, 'specs/006-ENG-1213-data-request'), true);
  assert.equal(keyMatchesName(KEY, 'ENG-1213'), true);
  assert.equal(keyMatchesName(KEY, 'feature/ENG-1213'), true);
  assert.equal(keyMatchesName(KEY, 'ENG-1213_follow-up'), true, 'an underscore or hyphen after the key is a boundary');
  assert.equal(keyMatchesName('ENG-12', 'ENG-1213-x'), false, 'ENG-12 is not inside ENG-1213');
  assert.equal(keyMatchesName(KEY, 'ENG-12134-x'), false, 'a digit after the key');
  assert.equal(keyMatchesName(KEY, 'XENG-1213'), false, 'a letter before the key');
  assert.equal(keyMatchesName(KEY, '9ENG-1213'), false, 'a digit before the key');
  assert.equal(keyMatchesName(KEY, 'ENG-1214-data'), false);
});

test('matching is case-insensitive in both directions', () => {
  assert.equal(keyMatchesName(KEY, 'eng-1213-data-request'), true);
  assert.equal(keyMatchesName('eng-1213', '006-ENG-1213-x'), true);
  assert.equal(keyMatchesName('Eng-1213', 'ENG-1213'), true);
});

test('matchingFolders takes spec folders named after the whole key and ignores the rest', () => {
  const paths = [
    'specs/006-ENG-1213-data-request/spec.md',
    'specs/006-ENG-1213-data-request/tdd-evidence.md',
    'specs/007-ENG-12-other/spec.md',
    'specs/008-ENG-1213X/spec.md',
    'specs/eng-1213-lower/spec.md',
    'docs/ENG-1213/spec.md',
    'specs/README.md',
    'specs/006-ENG-1213-data-request/contracts/api.md',
  ];
  assert.deepEqual(matchingFolders(KEY, paths), ['specs/006-ENG-1213-data-request', 'specs/eng-1213-lower']);
  assert.deepEqual(matchingFolders('ENG-12', paths), ['specs/007-ENG-12-other']);
  assert.deepEqual(matchingFolders('ENG-9', paths), []);
});

test('files: one file ending in spec.md and tdd-evidence.md', () => {
  assert.deepEqual(chooseDocumentFiles(['specs/f/spec.md', 'specs/f/tdd-evidence.md', 'specs/f/plan.md']), {
    specFile: 'specs/f/spec.md', otherSpecFiles: [], evidenceFile: 'specs/f/tdd-evidence.md',
  });
  assert.deepEqual(chooseDocumentFiles(['specs/f/ENG-1213.spec.md']), {
    specFile: 'specs/f/ENG-1213.spec.md', otherSpecFiles: [], evidenceFile: null,
  });
});

test('files: evidence in the tests/ subfolder is found; one directly in the folder wins over it', () => {
  assert.equal(
    chooseDocumentFiles(['specs/f/spec.md', 'specs/f/plan.md', 'specs/f/tests/tdd-evidence.md']).evidenceFile,
    'specs/f/tests/tdd-evidence.md',
  );
  assert.equal(
    chooseDocumentFiles(['specs/f/spec.md', 'specs/f/tests/tdd-evidence.md', 'specs/f/tdd-evidence.md']).evidenceFile,
    'specs/f/tdd-evidence.md',
  );
  assert.equal(chooseDocumentFiles(['specs/f/spec.md', 'specs/f/other/tdd-evidence.md']).evidenceFile, null, 'only tests/ is looked in');
  assert.equal(chooseDocumentFiles(['specs/f/spec.md', 'specs/f/tests/deep/tdd-evidence.md']).evidenceFile, null, 'one level only');
});

test('files: several spec.md files name the one used and list the others', () => {
  const found = chooseDocumentFiles(['specs/f/spec.md', 'specs/f/ui.spec.md', 'specs/f/api.spec.md', 'specs/f/notes.md']);
  assert.equal(found.specFile, 'specs/f/api.spec.md', 'first in path order');
  assert.deepEqual(found.otherSpecFiles, ['specs/f/spec.md', 'specs/f/ui.spec.md']);
  assert.equal(found.evidenceFile, null);
});

test('files: lookalike names are not documents', () => {
  const found = chooseDocumentFiles(['specs/f/spec.md.bak', 'specs/f/specs.md', 'specs/f/old-tdd-evidence.md', 'specs/f/tdd-evidence.txt', 'specs/f/sub/spec.md']);
  assert.equal(found.specFile, null);
  assert.deepEqual(found.otherSpecFiles, []);
  assert.equal(found.evidenceFile, null);
  assert.deepEqual(chooseDocumentFiles([]), { specFile: null, otherSpecFiles: [], evidenceFile: null });
});

test('a single candidate is the only candidate', () => {
  const only = candidate();
  const choice = chooseCopy(KEY, [only]);
  assert.deepEqual(choice, { used: only, rule: 'only-candidate', others: [] });
  assert.equal(chooseCopy(KEY, []), null);
});

test('the pull request\'s own repository is searched and used first', () => {
  const own = candidate({ repository: 'job', role: 'own', branch: 'develop', committedAt: '2026-10-01T00:00:00.000Z' });
  const newerEnclosing = candidate({ role: 'enclosing', branch: `feature/${KEY}-x`, committedAt: '2026-11-09T00:00:00.000Z' });
  const choice = chooseCopy(KEY, [newerEnclosing, own]);
  assert.equal(choice?.used, own);
  assert.equal(choice?.rule, 'own-repository-first');
  assert.deepEqual(choice?.others, [newerEnclosing]);
});

test('a branch matching the key beats develop, even when develop is newer', () => {
  const develop = candidate({ branch: 'develop', commit: 'b'.repeat(40), committedAt: '2026-11-09T00:00:00.000Z' });
  const matching = candidate({ branch: 'feature/eng-1213-data-request', commit: 'c'.repeat(40), committedAt: '2026-10-01T00:00:00.000Z' });
  const choice = chooseCopy(KEY, [develop, matching]);
  assert.equal(choice?.used, matching);
  assert.equal(choice?.rule, 'matching-branch-over-develop');
  assert.deepEqual(choice?.others, [develop], 'the develop copy is listed for the panel (FR-004)');
});

test('a branch for a longer key does not count as matching', () => {
  const develop = candidate({ branch: 'develop', committedAt: '2026-11-09T00:00:00.000Z' });
  const other = candidate({ branch: 'feature/ENG-12134-x', committedAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(chooseCopy(KEY, [develop, other])?.used, develop);
});

test('between equals the most recent commit wins, and the rest are listed in order', () => {
  const a = candidate({ branch: 'feature/ENG-1213-a', commit: '1'.repeat(40), committedAt: '2026-10-01T00:00:00.000Z' });
  const b = candidate({ branch: 'feature/ENG-1213-b', commit: '2'.repeat(40), committedAt: '2026-11-05T00:00:00.000Z' });
  const c = candidate({ branch: 'feature/ENG-1213-c', commit: '3'.repeat(40), committedAt: '2026-10-20T00:00:00.000Z' });
  const choice = chooseCopy(KEY, [a, b, c]);
  assert.equal(choice?.used, b);
  assert.equal(choice?.rule, 'most-recent-commit');
  assert.deepEqual(choice?.others, [c, a]);
});

test('the repository step outranks the branch step, and the input is not changed', () => {
  const ownDevelop = candidate({ repository: 'job', role: 'own', branch: 'develop' });
  const enclosingMatching = candidate({ branch: 'feature/ENG-1213-x' });
  const input = [enclosingMatching, ownDevelop];
  const snapshot = structuredClone(input);
  assert.equal(chooseCopy(KEY, input)?.used, ownDevelop);
  assert.deepEqual(input, snapshot);
});

// Feature 007 (T042; FR-032, FR-035, VO-036): search terms. Required of src/core/spec-match.ts (T050):
//   export type SpecTerm = { kind: 'key' | 'branch'; value: string };
//   export function buildTerms(keys: readonly string[], branchName: string): SpecTerm[];
//     keys present: one `key` term each (as written). None: the branch name and its last segment after `/` as
//     `branch` terms, de-duplicated ignoring case, empty values dropped.
//   export function termMatchesName(term: SpecTerm, name: string): boolean;
//     key: keyMatchesName. branch: the whole name equals the value, ignoring case.
//   matchingFolders(term | key, paths) and chooseCopy(matcher | key, candidates) accept a term / a branch matcher.

type Term = { kind: 'key' | 'branch'; value: string };
const api = match as unknown as {
  buildTerms: (keys: readonly string[], branch: string) => Term[];
  termMatchesName: (term: Term, name: string) => boolean;
  matchingFolders: (term: Term, paths: readonly string[]) => string[];
  chooseCopy: (matcher: (branch: string) => boolean, candidates: readonly SpecCandidate[]) => ReturnType<typeof chooseCopy>;
};

test('007 with no tracker key the terms are the branch name and its last segment, de-duplicated ignoring case', () => {
  assert.deepEqual(api.buildTerms([], 'feature/007-review-actions-parity'), [
    { kind: 'branch', value: 'feature/007-review-actions-parity' },
    { kind: 'branch', value: '007-review-actions-parity' },
  ]);
  assert.deepEqual(api.buildTerms([], 'main'), [{ kind: 'branch', value: 'main' }], 'no slash: one term');
  assert.deepEqual(api.buildTerms([], 'Feature/Feature'), [{ kind: 'branch', value: 'Feature/Feature' }, { kind: 'branch', value: 'Feature' }]);
  assert.deepEqual(api.buildTerms([], 'Dup/dup').map((t) => t.value.toLowerCase()), ['dup/dup', 'dup']);
  assert.deepEqual(api.buildTerms([], 'a/b/c').map((t) => t.value), ['a/b/c', 'c']);
  assert.deepEqual(api.buildTerms([], ''), [], 'no branch name, no term');
});

test('007 a tracker key still gives the key terms and no branch term', () => {
  assert.deepEqual(api.buildTerms(['ENG-1213', 'ENG-9'], 'feature/ENG-1213-x'), [
    { kind: 'key', value: 'ENG-1213' },
    { kind: 'key', value: 'ENG-9' },
  ]);
});

test('007 a branch term matches a whole folder name only, ignoring case', () => {
  const term = { kind: 'branch', value: '007-review-actions-parity' } as const;
  assert.equal(api.termMatchesName(term, '007-review-actions-parity'), true);
  assert.equal(api.termMatchesName(term, '007-Review-Actions-Parity'), true);
  assert.equal(api.termMatchesName({ kind: 'branch', value: '007-review' }, '007-review-actions-parity'), false);
  assert.equal(api.termMatchesName(term, '007-review-actions-parity-2'), false);
  assert.equal(api.termMatchesName(term, 'x007-review-actions-parity'), false);
  assert.equal(api.termMatchesName({ kind: 'key', value: KEY }, '006-ENG-1213-data-request'), true, 'a key matches as in feature 006');
  assert.equal(api.termMatchesName({ kind: 'key', value: 'ENG-12' }, 'ENG-1213-x'), false);
});

test('007 matchingFolders takes a branch term as a whole folder name', () => {
  const paths = ['specs/007-review-actions-parity/spec.md', 'specs/007-review/spec.md', 'specs/007-review-actions-parity-b/spec.md'];
  assert.deepEqual(api.matchingFolders({ kind: 'branch', value: '007-review-actions-parity' }, paths), ['specs/007-review-actions-parity']);
  assert.deepEqual(api.matchingFolders({ kind: 'branch', value: '007-review' }, paths), ['specs/007-review']);
  assert.deepEqual(api.matchingFolders({ kind: 'branch', value: 'feature/007-review-actions-parity' }, paths), []);
});

test('007 chooseCopy takes a branch matcher and ranks as before', () => {
  const main = candidate({ role: 'own', branch: 'main', committedAt: '2026-11-02T00:00:00.000Z' });
  const feature = candidate({ role: 'own', branch: 'feature/x', committedAt: '2026-11-01T00:00:00.000Z' });
  const choice = api.chooseCopy((b) => b === 'feature/x', [main, feature]);
  assert.equal(choice?.used.branch, 'feature/x');
  assert.equal(choice?.rule, 'matching-branch-over-develop');
  assert.deepEqual(choice?.others.map((o) => o.branch), ['main']);
  assert.equal(api.chooseCopy(() => false, [main, feature])?.used.branch, 'main');
  assert.equal(api.chooseCopy(() => false, [main, feature])?.rule, 'most-recent-commit');
});
