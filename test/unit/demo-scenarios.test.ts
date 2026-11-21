// T002 (VO-005, VO-013): the demo as data. Every README feature has a view, every FR-006 scenario has a merge
// request whose content shows it, and every scripted AI citation points at seeded content.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLOR_SCHEME, DEMO_GROUP, DEMO_USER_PREFIX, VIEWPORT, demoUsers, projects, scenarios, views, type DemoMergeRequest, type DemoView } from '../demo/scenarios.ts';

const FEATURES = ['review-queue', 'overview-summary', 'review-focus', 'diff-risk', 'ask-question', 'spec-alignment', 'comments', 'review-decision'];

const storefront = () => {
  const p = projects.find((x) => x.path === 'storefront');
  assert.ok(p, 'storefront project');
  return p;
};
const mr = (iid: number, project = 'storefront'): DemoMergeRequest => {
  const found = projects.find((p) => p.path === project)?.mergeRequests.find((m) => m.iid === iid);
  assert.ok(found, `${project}!${iid}`);
  return found;
};

test('eight views, one per headline feature, with unique kebab-case png files and alt text', () => {
  assert.deepEqual(views.map((v) => v.name), FEATURES);
  const files = views.map((v) => v.file);
  assert.equal(new Set(files).size, files.length);
  for (const v of views) {
    assert.match(v.file, /^[a-z0-9]+(-[a-z0-9]+)*\.png$/, v.file);
    assert.ok(v.alt.trim().length > 0, `${v.name} has alt text`);
    assert.ok(v.ready.trim().length > 0, `${v.name} has a ready selector`);
    assert.match(v.route('s1'), /^#\//, `${v.name} routes by hash`);
  }
});

test('every FR-006 scenario exists and names a merge request', () => {
  const ids: string[] = scenarios.map((s) => s.id);
  for (const id of ['critical-risk', 'reduced-review', 'spec-linked', 'issue-linked', 'discussion', 'approved']) assert.ok(ids.includes(id), id);
  for (const s of scenarios) {
    const project = projects.find((p) => p.path === s.project);
    assert.ok(project?.mergeRequests.some((m) => m.sourceBranch === s.sourceBranch), `${s.id} has its merge request`);
    assert.ok(s.purpose.length > 0);
  }
});

test('names stay in the demo group and never start with it-', () => {
  assert.match(DEMO_GROUP, /^prwb-demo\/[a-z0-9-]+$/);
  const names = [DEMO_GROUP.split('/')[1] ?? '', DEMO_USER_PREFIX, ...demoUsers().map((u) => u.username), ...projects.map((p) => p.path)];
  for (const n of names) assert.ok(!n.startsWith('it-'), n);
  for (const u of demoUsers()) assert.match(u.email, /@prwb\.invalid$/);
  assert.deepEqual(demoUsers().map((u) => u.role).sort(), ['author', 'reviewer']);
  assert.equal(projects.length, 2);
});

test('!1 holds an auth file, a migration, an ordinary file and a generated file', () => {
  const paths = Object.keys(mr(1).files);
  assert.ok(paths.some((p) => p.startsWith('src/auth/')));
  assert.ok(paths.some((p) => p.startsWith('db/migrations/')));
  assert.ok(paths.some((p) => p.startsWith('src/generated/')));
  assert.ok(paths.some((p) => !/^(src\/auth|db\/migrations|src\/generated)\//.test(p)), 'an ordinary file');
});

test('!2 holds only a lockfile and generated files', () => {
  for (const p of Object.keys(mr(2).files)) assert.ok(p === 'package-lock.json' || p.startsWith('src/generated/'), p);
});

test('!3 is on 014-discount-codes with a spec and TDD evidence, and references no issue', () => {
  const m = mr(3);
  assert.equal(m.sourceBranch, '014-discount-codes');
  assert.ok('specs/014-discount-codes/discount-codes.spec.md' in m.files);
  assert.ok('specs/014-discount-codes/tests/tdd-evidence.md' in m.files);
  assert.match(m.files['specs/014-discount-codes/discount-codes.spec.md'] ?? '', /Acceptance criteria/i);
  assert.doesNotMatch(`${m.sourceBranch} ${m.title} ${m.description}`, /#\d|closes|fixes/i);
});

test('!4 closes #1, changes total.ts, and its first note is on a line it changes with one reviewer reply', () => {
  const m = mr(4);
  assert.match(m.description, /Closes #1/);
  assert.ok('src/cart/total.ts' in m.files);
  assert.equal(storefront().issues.length, 1);
  const [first, reply, ...rest] = m.notes ?? [];
  assert.equal(rest.length, 0);
  assert.equal(first?.by, 'author');
  assert.equal(first?.path, 'src/cart/total.ts');
  assert.ok(first?.line !== undefined && changedLines(storefront().baseFiles['src/cart/total.ts'], m.files['src/cart/total.ts']).has(first.line), 'the note sits on a changed line');
  assert.equal(reply?.by, 'reviewer');
  assert.equal(reply?.replyTo, 0);
});

test('!5 is approved by the reviewer', () => {
  assert.equal(mr(5).approvedBy, 'reviewer');
});

test('every view uses the fixed viewport, the light scheme and its own AI text', () => {
  assert.deepEqual(VIEWPORT, { width: 1440, height: 900 });
  assert.equal(COLOR_SCHEME, 'light');
  for (const v of views) assert.equal(typeof v.ai, 'object', v.name);
});

test('every scripted AI citation points at seeded lines the merge request changes', () => {
  for (const v of views) {
    if (v.mergeRequest === undefined) continue;
    const m = mr(v.mergeRequest, v.project);
    const base = projects.find((p) => p.path === v.project)?.baseFiles ?? {};
    for (const c of citations(v)) {
      const head = m.files[c.path];
      assert.ok(head !== undefined, `${v.name}: ${c.path} is in ${v.project}!${m.iid}`);
      const changed = changedLines(base[c.path], head);
      const hits = [...changed].some((n) => n >= c.startLine && n <= c.endLine);
      assert.ok(hits, `${v.name}: ${c.path}:${c.startLine}-${c.endLine} covers a changed line`);
    }
  }
});

/** New-side lines of `head` that differ from `base` at the same index (every line when the file is new). */
function changedLines(base: string | undefined, head: string | undefined): Set<number> {
  const b = (base ?? '').split('\n');
  const h = (head ?? '').replace(/\n$/, '').split('\n');
  return new Set(h.flatMap((line, i) => (base === undefined || b[i] !== line ? [i + 1] : [])));
}

type CodeCitation = { path: string; startLine: number; endLine: number };
function citations(view: DemoView): CodeCitation[] {
  const out: CodeCitation[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ((o['kind'] === 'code' || o['type'] === 'code') && typeof o['path'] === 'string') {
        out.push({ path: o['path'], startLine: Number(o['startLine']), endLine: Number(o['endLine'] ?? o['startLine']) });
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(view.ai);
  return out;
}
