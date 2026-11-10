import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  clearSession,
  DRAFT_MAX,
  readDashboard,
  readSession,
  SCROLL_MAX_ENTRIES,
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
  assert.equal(s.panel, null);
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
  const allowed = new Set(['v', 'draft', 'category', 'answerFor', 'scope', 'scroll', 'panel', 'lastDiffPath']);
  for (const k of Object.keys(raw)) assert.ok(allowed.has(k), k);
  assert.equal(raw.v, 1);
  writeDashboard({ text: 'q', token: 'z' } as any);
  const d = JSON.parse(store.data.get('prwb:view:dashboard')!);
  for (const k of Object.keys(d)) assert.ok(['v', 'text', 'repository', 'scroll'].includes(k), k);
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
    scroll: { r: -1, ok: 10, f: 1.5 }, panel: { kind: 'zzz' }, lastDiffPath: 7,
  }));
  const s = readSession('a');
  assert.equal(s.draft, 'keep');
  assert.equal(s.category, 'what');
  assert.equal(s.answerFor, 'technical');
  assert.deepEqual(s.scope, { type: 'pr' });
  assert.deepEqual(s.scroll, { ok: 10 });
  assert.equal(s.panel, null);
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

test('valid range scope and panels are kept', () => {
  const scope = { type: 'range', path: 'a.ts', side: 'base', startLine: 2, endLine: 4, label: 'fn' } as const;
  writeSession('a', { scope, panel: { kind: 'evidence', ref: { kind: 'pr', resolved: true } } });
  const s = readSession('a');
  assert.deepEqual(s.scope, scope);
  assert.deepEqual(s.panel, { kind: 'evidence', ref: { kind: 'pr', resolved: true } });
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
