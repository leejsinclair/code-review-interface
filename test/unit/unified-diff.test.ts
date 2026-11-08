// VO-047 (FR-033, research R11): one unified-diff parser for local (`git diff -M
// --patch`) and platform diffs returns each file's status, lines added and
// removed, and hunks with old and new line numbers.
//
// Contract this test sets for `src/repo/unified-diff.ts` (T024), shaped on the
// Changed file entity in data-model.md and `FileDiff` in contracts/http-api.md:
//
//   parseUnifiedDiff(text: string): DiffFile[]          // files in diff order
//   DiffFile = {
//     path: string;                 // path at head; for a deleted file, the path at base
//     oldPath: string | null;       // set for renamed and copied, else null
//     status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
//     additions: number; deletions: number; binary: boolean;
//     patch: string | null;         // the file's hunks from the first `@@`, null for binary
//     hunks: DiffHunk[];
//   }
//   DiffHunk = { oldStart; oldLines; newStart; newLines;
//                lines: { type: 'context' | 'add' | 'remove'; oldLine?: number; newLine?: number; text: string }[] }
//
// The module is loaded inside each test body so this file runs before it exists.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// The shape the parser's result must be assignable to.
interface ParsedLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}
interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: ParsedLine[];
}
interface ParsedFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
  binary: boolean;
  patch: string | null;
  hunks: ParsedHunk[];
}

const DIFF = [
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  'index 0000000..3b18e51',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+export const a = 1;',
  '+export const b = 2;',
  'diff --git a/src/app.ts b/src/app.ts',
  'index 83db48f..bf269f4 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,4 @@',
  ' import x from "x";',
  '-const y = 1;',
  '+const y = 2;',
  ' ',
  ' export { y };',
  '@@ -10,3 +10,4 @@ function tail() {',
  ' a();',
  ' b();',
  '+c();',
  ' end();',
  '\\ No newline at end of file',
  'diff --git a/lib/old-name.ts b/lib/new-name.ts',
  'similarity index 88%',
  'rename from lib/old-name.ts',
  'rename to lib/new-name.ts',
  'index 1111111..2222222 100644',
  '--- a/lib/old-name.ts',
  '+++ b/lib/new-name.ts',
  '@@ -3,2 +3,2 @@',
  ' keep();',
  '-old();',
  '+renamed();',
  'diff --git a/docs/moved.md b/docs/guide/moved.md',
  'similarity index 100%',
  'rename from docs/moved.md',
  'rename to docs/guide/moved.md',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  'index 5d0f9a1..0000000',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export const gone = true;',
  'diff --git a/assets/logo.png b/assets/logo.png',
  'index 9f1c2aa..7e3d4bb 100644',
  'Binary files a/assets/logo.png and b/assets/logo.png differ',
  'diff --git a/assets/icon.png b/assets/icon.png',
  'new file mode 100644',
  'index 0000000..ab12cd3',
  'Binary files /dev/null and b/assets/icon.png differ',
  '',
].join('\n');

test('VO-047 each file of a unified diff gets its path, status and lines added and removed, in diff order', async () => {
  const { parseUnifiedDiff } = await import('../../src/repo/unified-diff.ts');
  const files: readonly ParsedFile[] = parseUnifiedDiff(DIFF);
  assert.deepEqual(
    files.map(({ path, oldPath, status, additions, deletions, binary }) => ({
      path, oldPath, status, additions, deletions, binary,
    })),
    [
      { path: 'src/new.ts', oldPath: null, status: 'added', additions: 2, deletions: 0, binary: false },
      { path: 'src/app.ts', oldPath: null, status: 'modified', additions: 2, deletions: 1, binary: false },
      { path: 'lib/new-name.ts', oldPath: 'lib/old-name.ts', status: 'renamed', additions: 1, deletions: 1, binary: false },
      { path: 'docs/guide/moved.md', oldPath: 'docs/moved.md', status: 'renamed', additions: 0, deletions: 0, binary: false },
      { path: 'src/gone.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 1, binary: false },
      { path: 'assets/logo.png', oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: true },
      { path: 'assets/icon.png', oldPath: null, status: 'added', additions: 0, deletions: 0, binary: true },
    ],
  );
});

test('VO-047 hunks carry their headers and old and new line numbers per line', async () => {
  const { parseUnifiedDiff } = await import('../../src/repo/unified-diff.ts');
  const files: readonly ParsedFile[] = parseUnifiedDiff(DIFF);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const added = byPath.get('src/new.ts');
  assert.ok(added);
  assert.deepEqual(added.hunks, [
    {
      oldStart: 0, oldLines: 0, newStart: 1, newLines: 2,
      lines: [
        { type: 'add', newLine: 1, text: 'export const a = 1;' },
        { type: 'add', newLine: 2, text: 'export const b = 2;' },
      ],
    },
  ]);

  const modified = byPath.get('src/app.ts');
  assert.ok(modified);
  assert.deepEqual(modified.hunks, [
    {
      oldStart: 1, oldLines: 4, newStart: 1, newLines: 4,
      lines: [
        { type: 'context', oldLine: 1, newLine: 1, text: 'import x from "x";' },
        { type: 'remove', oldLine: 2, text: 'const y = 1;' },
        { type: 'add', newLine: 2, text: 'const y = 2;' },
        { type: 'context', oldLine: 3, newLine: 3, text: '' },
        { type: 'context', oldLine: 4, newLine: 4, text: 'export { y };' },
      ],
    },
    {
      oldStart: 10, oldLines: 3, newStart: 10, newLines: 4,
      lines: [
        { type: 'context', oldLine: 10, newLine: 10, text: 'a();' },
        { type: 'context', oldLine: 11, newLine: 11, text: 'b();' },
        { type: 'add', newLine: 12, text: 'c();' },
        { type: 'context', oldLine: 12, newLine: 13, text: 'end();' },
      ],
    },
  ]);

  const renamed = byPath.get('lib/new-name.ts');
  assert.ok(renamed);
  assert.deepEqual(renamed.hunks, [
    {
      oldStart: 3, oldLines: 2, newStart: 3, newLines: 2,
      lines: [
        { type: 'context', oldLine: 3, newLine: 3, text: 'keep();' },
        { type: 'remove', oldLine: 4, text: 'old();' },
        { type: 'add', newLine: 4, text: 'renamed();' },
      ],
    },
  ]);

  const deleted = byPath.get('src/gone.ts');
  assert.ok(deleted);
  assert.deepEqual(deleted.hunks, [
    {
      oldStart: 1, oldLines: 1, newStart: 0, newLines: 0,
      lines: [{ type: 'remove', oldLine: 1, text: 'export const gone = true;' }],
    },
  ]);

  assert.deepEqual(byPath.get('docs/guide/moved.md')?.hunks, []);
  assert.deepEqual(byPath.get('assets/logo.png')?.hunks, []);
});

test('VO-047 each text file keeps its hunks as its patch; binary files have none', async () => {
  const { parseUnifiedDiff } = await import('../../src/repo/unified-diff.ts');
  const files: readonly ParsedFile[] = parseUnifiedDiff(DIFF);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const modified = byPath.get('src/app.ts');
  assert.ok(modified);
  assert.equal(typeof modified.patch, 'string');
  const patch = modified.patch ?? '';
  assert.ok(patch.startsWith('@@ -1,4 +1,4 @@'), 'patch starts at the first hunk header');
  assert.ok(patch.includes('@@ -10,3 +10,4 @@ function tail() {'));
  assert.ok(patch.includes('+c();'));
  assert.ok(!patch.includes('diff --git'), 'patch holds no other file');

  assert.equal(byPath.get('assets/logo.png')?.patch, null);
  assert.equal(byPath.get('assets/icon.png')?.patch, null);
});

test('VO-047 a diff with no files parses to an empty list', async () => {
  const { parseUnifiedDiff } = await import('../../src/repo/unified-diff.ts');
  assert.deepEqual(parseUnifiedDiff(''), []);
});
