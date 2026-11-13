// T009 (VO-007, VO-008, RR-2): which changed lines are behavioural. Comment-only and blank lines are not,
// for a language in the comment table; an unknown extension has no comments; a reindent is whitespace-only
// except in whitespace-significant languages; an added or deleted file is always behavioural.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseChange, type ChangeInput } from '../../src/core/risk/comments.ts';

const file = (path: string, patch: string, status: ChangeInput['status'] = 'modified'): ChangeInput => ({ path, status, patch });

test('comment-only and blank lines are not behavioural in a tabled language', () => {
  const r = analyseChange(file('src/a.ts', '@@ -1,2 +1,5 @@\n keep\n+// a note\n+\n+/* more */\n keep2\n'));
  assert.equal(r.hasBehaviouralChange, false);
  assert.equal(r.lines.length, 3);
});

test('a trailing comment after code is code', () => {
  const r = analyseChange(file('src/a.ts', '@@ -1 +1,2 @@\n keep\n+run(); // why\n'));
  assert.equal(r.hasBehaviouralChange, true);
  assert.equal(r.behaviouralLines.length, 1);
  assert.equal(r.behaviouralLines[0]?.text, 'run(); // why');
});

test('block-comment state carries across the lines of a hunk', () => {
  const comment = '@@ -1 +1,5 @@\n keep\n+/**\n+ * Explains the thing.\n+ * More words.\n+ */\n';
  assert.equal(analyseChange(file('src/a.ts', comment)).hasBehaviouralChange, false);
  const afterClose = '@@ -1 +1,4 @@\n keep\n+/* c */\n+call();\n+/* open\n';
  const r = analyseChange(file('src/a.ts', afterClose));
  assert.deepEqual(r.behaviouralLines.map((l) => l.text), ['call();']);
});

test('code after a block comment closes on the same line is code', () => {
  const r = analyseChange(file('src/a.ts', '@@ -1 +1,2 @@\n keep\n+/* x */ run();\n'));
  assert.equal(r.hasBehaviouralChange, true);
});

test('removed comment lines are tracked on the base side', () => {
  const r = analyseChange(file('src/a.ts', '@@ -1,4 +1 @@\n keep\n-/*\n- * gone\n- */\n'));
  assert.equal(r.hasBehaviouralChange, false);
});

test('an unknown extension has no comments: every non-blank changed line is behavioural', () => {
  const r = analyseChange(file('src/a.weird', '@@ -1 +1,4 @@\n keep\n+// looks like a comment\n+\n+# so does this\n'));
  assert.equal(r.hasBehaviouralChange, true);
  assert.equal(r.behaviouralLines.length, 2);
});

test('hash comments count in a language that has them', () => {
  assert.equal(analyseChange(file('scripts/x.sh', '@@ -1 +1,2 @@\n keep\n+# note\n')).hasBehaviouralChange, false);
  assert.equal(analyseChange(file('db/x.sql', '@@ -1 +1,2 @@\n keep\n+-- note\n')).hasBehaviouralChange, false);
  assert.equal(analyseChange(file('a/b.md', '@@ -1 +1,2 @@\n keep\n+<!-- note -->\n')).hasBehaviouralChange, false);
});

test('a TypeScript reindent is whitespace-only', () => {
  const r = analyseChange(file('src/a.ts', '@@ -1,2 +1,2 @@\n-if (a) {\n-run();\n+  if (a) {\n+    run();\n'));
  assert.equal(r.hasBehaviouralChange, false);
});

test('a Python or YAML reindent is behavioural', () => {
  const patch = '@@ -1,2 +1,2 @@\n-if a:\n-    run()\n+if a:\n+        run()\n';
  assert.equal(analyseChange(file('a.py', patch)).hasBehaviouralChange, true);
  assert.equal(analyseChange(file('a.yml', patch)).hasBehaviouralChange, true);
});

test('reordering statements is behavioural', () => {
  const patch = '@@ -1,2 +1,2 @@\n-first();\n-second();\n+second();\n+first();\n';
  assert.equal(analyseChange(file('src/a.ts', patch)).hasBehaviouralChange, true);
});

test('added and deleted files are always behavioural, whatever the content', () => {
  const comments = '@@ -0,0 +1,2 @@\n+// only\n+// comments\n';
  assert.equal(analyseChange(file('src/a.ts', comments, 'added')).hasBehaviouralChange, true);
  assert.equal(analyseChange(file('src/a.ts', '@@ -1,2 +0,0 @@\n-// only\n-// comments\n', 'deleted')).hasBehaviouralChange, true);
  assert.equal(analyseChange(file('src/a.ts', '', 'added')).hasBehaviouralChange, true);
});

test('a file with no patch (skipped) is treated as behavioural', () => {
  assert.equal(analyseChange({ path: 'a.ts', status: 'modified', patch: null }).hasBehaviouralChange, true);
});

test('a rename with no changed lines has no changes at all', () => {
  const r = analyseChange({ path: 'a.ts', status: 'renamed', patch: '' });
  assert.equal(r.hasAnyChange, false);
  assert.equal(r.hasBehaviouralChange, false);
});
