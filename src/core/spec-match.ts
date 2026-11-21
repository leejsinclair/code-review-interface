// Pure rules that match a issue key to spec folders and files and choose which copy of a document to read
// (specs/006-spec-context R3, R4). No I/O; the key pattern and platform are known elsewhere (VIII.2).

import type { SpecRule } from '../contracts/http.ts';

export type SpecCandidate = {
  repository: string;
  role: 'own' | 'enclosing';
  branch: string;
  commit: string;
  committedAt: string;
  folder: string;
};

export type SpecChoice = { used: SpecCandidate; rule: SpecRule; others: SpecCandidate[] };

const isLetterOrDigit = (c: string | undefined): boolean => c !== undefined && /[a-z0-9]/i.test(c);

/** The name contains the key, ignoring case, with no letter or digit directly before or after it (test fixture "ENG-1213X" must not match). */
export function keyMatchesName(key: string, name: string): boolean {
  if (key.length === 0) return false;
  const k = key.toLowerCase();
  const n = name.toLowerCase();
  for (let at = n.indexOf(k); at !== -1; at = n.indexOf(k, at + 1)) {
    if (!isLetterOrDigit(n[at - 1]) && !isLetterOrDigit(n[at + k.length])) return true;
  }
  return false;
}

/** A search term: a tracker key, or (with no key on the pull request) the branch name or its last segment. */
export type SpecTerm = { kind: 'key' | 'branch'; value: string };

/**
 * The terms to search with (feature 007, R12): each tracker key as written; with none, the branch name and its last
 * segment after `/`, de-duplicated ignoring case, empty values dropped.
 */
export function buildTerms(keys: readonly string[], branchName: string): SpecTerm[] {
  if (keys.length > 0) return keys.map((value) => ({ kind: 'key', value }));
  const terms: SpecTerm[] = [];
  const seen = new Set<string>();
  for (const value of [branchName, branchName.slice(branchName.lastIndexOf('/') + 1)]) {
    if (value === '' || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    terms.push({ kind: 'branch', value });
  }
  return terms;
}

/** A key matches as in feature 006; a branch term matches only a name that equals it, ignoring case. */
export function termMatchesName(term: SpecTerm, name: string): boolean {
  if (term.kind === 'key') return keyMatchesName(term.value, name);
  return term.value !== '' && term.value.toLowerCase() === name.toLowerCase();
}

/** Distinct `specs/<name>` folders holding a file whose name matches the term (a key, or a term), in first-seen order. */
export function matchingFolders(term: string | SpecTerm, treePaths: readonly string[]): string[] {
  const t: SpecTerm = typeof term === 'string' ? { kind: 'key', value: term } : term;
  const folders: string[] = [];
  for (const path of treePaths) {
    const parts = path.split('/');
    if (parts.length < 3 || parts[0] !== 'specs') continue;
    const folder = `specs/${parts[1]}`;
    if (!folders.includes(folder) && termMatchesName(t, parts[1] as string)) folders.push(folder);
  }
  return folders;
}

/**
 * Choose the specification file directly inside one folder, and the evidence file directly inside it or, failing
 * that, in its `tests/` subfolder (the layout project-hd-v3 uses: `specs/<f>/tests/tdd-evidence.md`).
 */
export function chooseDocumentFiles(folderPaths: readonly string[]): {
  specFile: string | null;
  otherSpecFiles: string[];
  evidenceFile: string | null;
} {
  // Paths of one folder: the direct children are the shallowest ones.
  const shallowest = Math.min(...folderPaths.map((p) => p.split('/').length));
  const direct = folderPaths.filter((p) => p.split('/').length === shallowest);
  const specs = direct.filter((p) => baseName(p).endsWith('spec.md')).sort();
  const inTests = (p: string): boolean => {
    const parts = p.split('/');
    return parts.length === shallowest + 1 && parts[parts.length - 2] === 'tests';
  };
  const evidence =
    direct.find((p) => baseName(p) === 'tdd-evidence.md') ??
    folderPaths.find((p) => inTests(p) && baseName(p) === 'tdd-evidence.md') ??
    null;
  return { specFile: specs[0] ?? null, otherSpecFiles: specs.slice(1), evidenceFile: evidence };
}

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Rank by repository, then a matching branch over others, then the most recent commit. */
export function chooseCopy(matcher: string | ((branch: string) => boolean), candidates: readonly SpecCandidate[]): SpecChoice | null {
  const matches = typeof matcher === 'string' ? (branch: string): boolean => keyMatchesName(matcher, branch) : matcher;
  if (candidates.length === 0) return null;
  const roleRank = (c: SpecCandidate): number => (c.role === 'own' ? 0 : 1);
  const branchRank = (c: SpecCandidate): number => (matches(c.branch) ? 0 : 1);
  const ranked = [...candidates].sort(
    (a, b) =>
      roleRank(a) - roleRank(b) ||
      branchRank(a) - branchRank(b) ||
      Date.parse(b.committedAt) - Date.parse(a.committedAt),
  );
  const [used, ...others] = ranked as [SpecCandidate, ...SpecCandidate[]];
  let rule: SpecRule;
  if (others.length === 0) rule = 'only-candidate';
  else if (others.some((o) => roleRank(o) !== roleRank(used))) rule = 'own-repository-first';
  else if (others.some((o) => branchRank(o) !== branchRank(used))) rule = 'matching-branch-over-develop';
  else rule = 'most-recent-commit';
  return { used, rule, others };
}
