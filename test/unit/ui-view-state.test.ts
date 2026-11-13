import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  clearSession,
  DRAFT_MAX,
  readDashboard,
  readSession,
  SCROLL_MAX_ENTRIES,
  VIEWED_MAX,
  writeDashboard,
  writeSession,
} from '../../src/ui/state/view-state.ts';

class FakeStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  (globalThis as any).sessionStorage = store;
});

test('defaults when nothing stored', () => {
  const s = readSession('a');
  assert.equal(s.draft, '');
  assert.equal(s.category, 'what');
  assert.equal(s.answerFor, 'technical');
  assert.deepEqual(s.scope, { type: 'pr' });
  assert.deepEqual(s.scroll, {});
  assert.equal(s.lastDiffPath, undefined);
  assert.equal(store.data.size, 0);
});

test('write then read round-trips under the right key', () => {
  writeSession('a', { draft: 'hi', category: 'risk', answerFor: 'business', lastDiffPath: 'x.ts' });
  assert.ok(store.data.has('prwb:view:a'));
  const s = readSession('a');
  assert.equal(s.draft, 'hi');
  assert.equal(s.category, 'risk');
  assert.equal(s.answerFor, 'business');
  assert.equal(s.lastDiffPath, 'x.ts');
  assert.equal(readSession('b').draft, '');
});

test('stored JSON holds only allowlisted keys', () => {
  writeSession('a', { draft: 'x', password: 'secret', token: 't' } as any);
  const raw = JSON.parse(store.data.get('prwb:view:a')!);
  const allowed = new Set(['v', 'draft', 'category', 'answerFor', 'scope', 'scroll', 'lastDiffPath', 'fileListCollapsed', 'fileOrder', 'riskScope', 'viewed']);
  for (const k of Object.keys(raw)) assert.ok(allowed.has(k), k);
  assert.equal(raw.v, 1);
  writeDashboard({ text: 'q', token: 'z' } as any);
  const d = JSON.parse(store.data.get('prwb:view:dashboard')!);
  for (const k of Object.keys(d)) assert.ok(['v', 'text', 'repository', 'scroll', 'collapsedGroups', 'hideApproved'].includes(k), k);
});

test('unknown stored keys are dropped on read', () => {
  store.setItem('prwb:view:a', JSON.stringify({ v: 1, draft: 'd', evil: 1 }));
  const s = readSession('a') as any;
  assert.equal(s.draft, 'd');
  assert.equal(s.evil, undefined);
});

test('bad values fall back per field', () => {
  store.setItem('prwb:view:a', JSON.stringify({
    v: 1, draft: 'keep', category: 'nope', answerFor: 5, scope: { type: 'range', path: 'p', side: 'head', startLine: 9, endLine: 2 },
    scroll: { r: -1, ok: 10, f: 1.5 }, lastDiffPath: 7,
  }));
  const s = readSession('a');
  assert.equal(s.draft, 'keep');
  assert.equal(s.category, 'what');
  assert.equal(s.answerFor, 'technical');
  assert.deepEqual(s.scope, { type: 'pr' });
  assert.deepEqual(s.scroll, { ok: 10 });
  assert.equal(s.lastDiffPath, undefined);
});

test('wrong version or corrupt JSON gives defaults without throwing', () => {
  store.setItem('prwb:view:a', JSON.stringify({ v: 2, draft: 'x' }));
  assert.equal(readSession('a').draft, '');
  store.setItem('prwb:view:a', '{not json');
  assert.equal(readSession('a').draft, '');
  store.setItem('prwb:view:dashboard', 'null');
  assert.equal(readDashboard().text, '');
});

test('a valid range scope is kept', () => {
  const scope = { type: 'range', path: 'a.ts', side: 'base', startLine: 2, endLine: 4, label: 'fn' } as const;
  writeSession('a', { scope });
  const s = readSession('a');
  assert.deepEqual(s.scope, scope);
});

test('a panel stored by an older version is ignored', () => {
  store.setItem('prwb:view:a', JSON.stringify({ v: 1, draft: 'kept', panel: { kind: 'ask' } }));
  const s = readSession('a');
  assert.equal(s.draft, 'kept');
  assert.equal('panel' in s, false);
});

test('draft is capped', () => {
  writeSession('a', { draft: 'x'.repeat(DRAFT_MAX + 50) });
  assert.equal(readSession('a').draft.length, DRAFT_MAX);
});

test('scroll keeps at most 50 entries, oldest dropped', () => {
  for (let i = 0; i < SCROLL_MAX_ENTRIES + 5; i++) writeSession('a', { scroll: { [`r${i}`]: i } });
  const keys = Object.keys(readSession('a').scroll);
  assert.equal(keys.length, SCROLL_MAX_ENTRIES);
  assert.ok(!keys.includes('r0'));
  assert.ok(keys.includes(`r${SCROLL_MAX_ENTRIES + 4}`));
});

test('clearSession removes the key', () => {
  writeSession('a', { draft: 'x' });
  clearSession('a');
  assert.equal(store.data.has('prwb:view:a'), false);
  assert.equal(readSession('a').draft, '');
});

test('dashboard text trimmed and capped; scroll validated', () => {
  writeDashboard({ text: `  ${'y'.repeat(300)}  `, repository: 'r1', scroll: 40 });
  const d = readDashboard();
  assert.equal(d.text.length, 200);
  assert.equal(d.repository, 'r1');
  assert.equal(d.scroll, 40);
  store.setItem('prwb:view:dashboard', JSON.stringify({ v: 1, scroll: -3, repository: 4 }));
  const e = readDashboard();
  assert.equal(e.scroll, 0);
  assert.equal(e.repository, null);
});

test('blocked storage falls back to memory', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  (globalThis as any).sessionStorage = blocked;
  writeSession('mem', { draft: 'kept' });
  assert.equal(readSession('mem').draft, 'kept');
  writeDashboard({ text: 'm' });
  assert.equal(readDashboard().text, 'm');
  clearSession('mem');
  assert.equal(readSession('mem').draft, '');
});

test('collapsed issue groups default to none, round-trip, and drop junk and duplicates', () => {
  assert.deepEqual(readDashboard().collapsedGroups, []);
  writeDashboard({ collapsedGroups: ['ABC-1', 'none'] });
  assert.deepEqual(readDashboard().collapsedGroups, ['ABC-1', 'none']);
  writeDashboard({ text: 'q' });
  assert.deepEqual(readDashboard().collapsedGroups, ['ABC-1', 'none'], 'other writes keep it');
  store.setItem('prwb:view:dashboard', JSON.stringify({ v: 1, collapsedGroups: ['ABC-1', 7, null, 'ABC-1', 'X-2'] }));
  assert.deepEqual(readDashboard().collapsedGroups, ['ABC-1', 'X-2']);
  store.setItem('prwb:view:dashboard', JSON.stringify({ v: 1, collapsedGroups: 'ABC-1' }));
  assert.deepEqual(readDashboard().collapsedGroups, []);
});

test('hideApproved defaults on, round-trips, and junk reads as on', () => {
  assert.equal(readDashboard().hideApproved, true);
  writeDashboard({ hideApproved: false });
  assert.equal(readDashboard().hideApproved, false);
  writeDashboard({ text: 'q' });
  assert.equal(readDashboard().hideApproved, false, 'other writes keep it');
  store.setItem('prwb:view:dashboard', JSON.stringify({ v: 1, hideApproved: 'no' }));
  assert.equal(readDashboard().hideApproved, true);
  store.setItem('prwb:view:dashboard', JSON.stringify({ v: 1, hideApproved: 0 }));
  assert.equal(readDashboard().hideApproved, true);
});

// feature 004 (VO-028, FR-032): the file order, the review scope and the viewed files live in the tab only.

test('fileOrder, riskScope and viewed default, round-trip and are restored in the same tab', () => {
  assert.equal(readSession('a').fileOrder, 'risk');
  assert.equal(readSession('a').riskScope, 'auto');
  assert.deepEqual(readSession('a').viewed, []);
  writeSession('a', { fileOrder: 'diff', riskScope: 'elevated', viewed: ['x.ts', 'y.ts'] });
  assert.equal(readSession('a').fileOrder, 'diff');
  assert.equal(readSession('a').riskScope, 'elevated');
  assert.deepEqual(readSession('a').viewed, ['x.ts', 'y.ts']);
  writeSession('a', { draft: 'x' });
  assert.equal(readSession('a').riskScope, 'elevated', 'other writes keep it');
  assert.equal(readSession('b').riskScope, 'auto', 'per session');
  const raw = JSON.parse(store.data.get('prwb:view:a')!);
  assert.deepEqual(Object.keys(raw).filter((k) => ['fileOrder', 'riskScope', 'viewed'].includes(k)).sort(), ['fileOrder', 'riskScope', 'viewed']);
});

test('invalid fileOrder, riskScope and viewed fall back to the defaults on read', () => {
  store.setItem('prwb:view:a', JSON.stringify({ v: 1, fileOrder: 'alphabetical', riskScope: 'urgent', viewed: ['a', 'a', 3, 'b'] }));
  assert.equal(readSession('a').fileOrder, 'risk');
  assert.equal(readSession('a').riskScope, 'auto');
  assert.deepEqual(readSession('a').viewed, ['a', 'b'], 'non-strings and repeats are dropped');
  store.setItem('prwb:view:a', JSON.stringify({ v: 1, riskScope: ['critical'], viewed: 'a' }));
  assert.equal(readSession('a').riskScope, 'auto');
  assert.deepEqual(readSession('a').viewed, []);
});

test('an old stored class filter is ignored', () => {
  store.setItem('prwb:view:a', JSON.stringify({ v: 1, riskClasses: ['critical'] }));
  assert.equal(readSession('a').riskScope, 'auto');
  assert.equal('riskClasses' in readSession('a'), false);
});

test('viewed is capped', () => {
  writeSession('a', { viewed: Array.from({ length: VIEWED_MAX + 50 }, (_, i) => `f${i}.ts`) });
  assert.equal(readSession('a').viewed.length, VIEWED_MAX);
});

test('view-state.ts imports nothing from api.ts, so neither choice can reach a server request', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../src/ui/state/view-state.ts', import.meta.url), 'utf8');
  assert.equal(/from ['"][^'"]*api(\.ts)?['"]/.test(source), false);
  assert.equal(/\bfetch\b|EventSource|XMLHttpRequest/.test(source), false);
});
