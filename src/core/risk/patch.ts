// Stored patches as changed lines, and the change fingerprint (research RR-2, RR-7). Pure: reads only the
// strings it is given.

import { createHash } from 'node:crypto';
import { parseUnifiedDiff, type DiffHunk } from '../../repo/unified-diff.ts';
import type { Side } from '../../contracts/http.ts';

export type ChangedLine = { side: Side; line: number; text: string };

/** The hunks of a stored patch (which starts at its first `@@`). */
export function hunksOf(patch: string | null): DiffHunk[] {
  if (patch === null || patch.trim() === '') return [];
  return parseUnifiedDiff(`diff --git a/f b/f\n--- a/f\n+++ b/f\n${patch}`)[0]?.hunks ?? [];
}

/** Every added (head side) and removed (base side) line of a patch, with its number on that side. */
export function changedLines(patch: string | null): ChangedLine[] {
  const out: ChangedLine[] = [];
  for (const hunk of hunksOf(patch)) {
    for (const l of hunk.lines) {
      if (l.type === 'add' && l.newLine !== undefined) out.push({ side: 'head', line: l.newLine, text: l.text });
      else if (l.type === 'remove' && l.oldLine !== undefined) out.push({ side: 'base', line: l.oldLine, text: l.text });
    }
  }
  return out;
}

export type FingerprintInput = {
  status: string;
  oldPath: string | null;
  path: string;
  patch: string | null;
  additions: number;
  deletions: number;
  sizeBytes: number | null;
};

/**
 * Identifies one file's change: status, both paths and the ordered changed lines of every hunk, with hunk
 * headers, context and line numbers left out, so the same change at other positions, or under another head
 * commit, has the same fingerprint. A file with no patch (skipped for a limit) falls back to its counts and
 * size, a coarse comparison (RR-7).
 */
export function changeFingerprint(file: FingerprintInput): string {
  const hash = createHash('sha256');
  hash.update(`${file.status}\0${file.oldPath ?? ''}\0${file.path}\n`);
  if (file.patch === null || file.patch.trim() === '') {
    hash.update(`coarse\0${file.additions}\0${file.deletions}\0${file.sizeBytes ?? ''}\n`);
    return hash.digest('hex');
  }
  for (const hunk of hunksOf(file.patch)) {
    for (const l of hunk.lines) {
      if (l.type === 'add') hash.update(`+${l.text}\n`);
      else if (l.type === 'remove') hash.update(`-${l.text}\n`);
    }
  }
  return hash.digest('hex');
}
