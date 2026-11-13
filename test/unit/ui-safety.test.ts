// Static UI checks (SC-007, SC-008, FR-016, FR-042, FR-043, FR-046): text is never HTML, no interface string
// claims a PR is ready, safe or approved, the UI talks only to local routes, and the 001 test identifiers survive.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const UI = new URL('../../src/ui/', import.meta.url).pathname;
const CONTRACT = new URL('../../specs/001-pr-review-workbench/contracts/ui.md', import.meta.url).pathname;

function sources(dir: string): Array<{ file: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(e.name) ? [{ file: path.slice(UI.length), text: readFileSync(path, 'utf8') }] : [];
  });
}
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const files = sources(UI).map((s) => ({ ...s, code: stripComments(s.text) }));

test('no HTML injection (SC-008)', () => {
  for (const f of files) assert.doesNotMatch(f.code, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML/, f.file);
});

// The only strings allowed to say "approved": they report the signed-in reviewer's OWN recorded approval on
// the platform (dashboard "Approved by you"), never a verdict from this tool about the PR (FR-016).
// Feature 005 adds the reviewer's own decision text ("You approved on <commit>"), also labelled as theirs.
// The dashboard filter "Hide pull requests I approved" is the same kind: it is about the reviewer's own approvals.
const OWN_APPROVAL_STRINGS = new Set(["'Approved by you'", "'Approved'", "'You approved'", "'Hide pull requests I approved'"]);

test('no interface string says ready, safe or approved (SC-007)', () => {
  const word = /\b(ready|safe|approved)\b/i;
  for (const f of files) {
    const literals = f.code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
    const jsxText = [...f.code.matchAll(/>([^<>{}\n]+)</g)].map((m) => m[1]!);
    for (const s of [...literals, ...jsxText]) {
      if (/^\s*(import|export)\b/.test(s) || /^['"`][a-z-]+['"`]$/.test(s)) continue;
      if (f.file === 'labels.ts' && OWN_APPROVAL_STRINGS.has(s)) continue;
      assert.doesNotMatch(s, word, `${f.file}: ${s}`);
    }
  }
});

test('the UI calls only local /api/ routes (FR-043)', () => {
  for (const f of files) {
    for (const m of f.code.matchAll(/https?:\/\/[^\s'"`)]+/g)) assert.match(m[0], /example\.(com|org)|localhost|127\.0\.0\.1/, `${f.file}: ${m[0]}`);
  }
  const api = files.find((f) => f.file === 'api.ts')!.code;
  for (const m of api.matchAll(/request(?:<[^>]*>)?\(\s*'[A-Z]+',\s*(['`])([^'`]*)/g)) assert.ok(m[2]!.startsWith('/api/') || m[2]!.startsWith('${'), m[2]);
});

test('every 001 test identifier still appears in src/ui (FR-046)', () => {
  const table = readFileSync(CONTRACT, 'utf8').split('## Test identifiers')[1]!.split(/\n## /)[0]!;
  const ids = [...table.split('\n').filter((l) => l.startsWith('| `')).flatMap((l) => [...l.split('|')[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!))];
  assert.ok(ids.length > 40, `read ${ids.length} identifiers`);
  const all = files.map((f) => f.code).join('\n');
  for (const id of ids) {
    if (id === 'pr-item-<number>') continue;
    const prefix = id.split('<')[0]!;
    // Built from a value (`completeness-row-${row.source}`, `diff-line-${side}-${n}`) counts as present.
    const parts = prefix.split('-').filter((p) => p !== '');
    const dynamic = parts.some((_, i) => i > 0 && all.includes(`${parts.slice(0, i).join('-')}-$` + '{'));
    assert.ok(all.includes(prefix) || dynamic, `${id} is gone from src/ui`);
  }
});
