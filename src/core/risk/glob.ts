// A small glob matcher for the risk rules (research RR-3, RR-4). Patterns are matched against `/`-separated
// repository paths, case-insensitively. `*` stays within a path segment, `**` as a whole segment crosses any
// number of segments (including none), `?` is exactly one character. A pattern with no `/` matches the file
// name at any depth; one with a `/` is anchored at the repository root. No regular expression is built from a
// pattern, so a rule file cannot cause catastrophic backtracking: matching is bounded by pattern x path length.

export const MAX_GLOB_LENGTH = 200;

/** Why a pattern is not usable, or null when it is. */
export function validateGlob(pattern: string): string | null {
  if (pattern.length === 0) return 'the pattern is empty';
  if (pattern.length > MAX_GLOB_LENGTH) return `the pattern is longer than ${MAX_GLOB_LENGTH} characters`;
  if (pattern.includes('\0')) return 'the pattern contains a NUL character';
  if (pattern.includes('\\')) return 'the pattern contains a backslash; use / between folders';
  for (const segment of pattern.split('/')) {
    if (segment.includes('**') && segment !== '**') return `"${segment}" mixes ** with other characters`;
  }
  return null;
}

/** One path segment against one pattern segment (`*` and `?` only); iterative, no recursion. */
function matchSegment(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p += 1;
      t += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      resume = t;
      p += 1;
    } else if (star !== -1) {
      p = star + 1;
      resume += 1;
      t = resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/** True when `path` matches `pattern`; an invalid pattern matches nothing. */
export function matchGlob(pattern: string, path: string): boolean {
  if (validateGlob(pattern) !== null) return false;
  const lower = pattern.toLowerCase();
  const segments = path.toLowerCase().split('/');
  const parts = lower.split('/');
  // No slash: match the file name at any depth.
  if (parts.length === 1) return matchSegment(lower, segments[segments.length - 1] ?? '');

  const memo = new Map<number, boolean>();
  const walk = (pi: number, si: number): boolean => {
    const key = pi * (segments.length + 1) + si;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (pi === parts.length) {
      result = si === segments.length;
    } else if (parts[pi] === '**') {
      result = walk(pi + 1, si) || (si < segments.length && walk(pi, si + 1));
    } else {
      result = si < segments.length && matchSegment(parts[pi]!, segments[si]!) && walk(pi + 1, si + 1);
    }
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}
