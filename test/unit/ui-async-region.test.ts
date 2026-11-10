// T015: AsyncRegion renders each state with the contract's testids and data-state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VNode } from 'preact';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

// Node cannot load .tsx directly, so bundle the component with the project's JSX settings first.
const dir = await mkdtemp(join(tmpdir(), 'prwb-async-'));
const outfile = join(dir, 'async-region.mjs');
await build({
  entryPoints: ['src/ui/components/async-region.tsx'], outfile, bundle: true, format: 'esm', jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'silent',
});
const { AsyncRegion } = (await import(outfile)) as typeof import('../../src/ui/components/async-region.tsx');

const props = (v: VNode): Record<string, unknown> => v.props as Record<string, unknown>;
const text = (n: unknown): string =>
  Array.isArray(n) ? n.map(text).join('') : typeof n === 'object' && n !== null ? text((n as VNode).props?.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
function find(n: unknown, pred: (p: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(n)) { for (const c of n) { const r = find(c, pred); if (r) return r; } return undefined; }
  if (typeof n !== 'object' || n === null) return undefined;
  const p = (n as VNode).props as Record<string, unknown> | undefined;
  if (!p) return undefined;
  return pred(p) ? p : find(p.children, pred);
}

test('section carries data-testid and data-state for every state', () => {
  const base = { region: 'pulls', label: 'pull requests' };
  const cases = [
    { state: 'loading' }, { state: 'loaded' },
    { state: 'empty', explanation: 'None' }, { state: 'failed', reason: 'x', retry: () => {} },
    { state: 'unknown', reason: 'y' }, { state: 'stale', staleAgainst: 'head moved' },
  ] as const;
  for (const c of cases) {
    const v = AsyncRegion({ ...base, ...c });
    assert.equal(v.type, 'section');
    assert.equal(props(v)['data-testid'], 'async-pulls');
    assert.equal(props(v)['data-state'], c.state);
  }
});

test('failed offers retry-<region> that calls retry', () => {
  let n = 0;
  const v = AsyncRegion({ region: 'sessions', label: 'sessions', state: 'failed', reason: 'boom', retry: () => { n++; } });
  const btn = find(v, (p) => p['data-testid'] === 'retry-sessions');
  assert.ok(btn);
  (btn.onClick as () => void)();
  assert.equal(n, 1);
  assert.match(text(v), /boom/);
});

test('retrySuffix, empty next step and stale content', () => {
  const f = AsyncRegion({ region: 'pulls', label: 'x', state: 'failed', reason: 'r', retry: () => {}, retrySuffix: 'acme/api' });
  assert.ok(find(f, (p) => p['data-testid'] === 'retry-pulls-acme/api'));
  const e = AsyncRegion({ region: 'pulls', label: 'x', state: 'empty', explanation: 'No open pull requests', nextStep: 'Rescan' });
  assert.match(text(e), /No open pull requestsRescan/);
  const s = AsyncRegion({ region: 'pulls', label: 'x', state: 'stale', staleAgainst: 'newer head', children: 'CONTENT' });
  assert.match(text(s), /Stale/);
  assert.match(text(s), /CONTENT/);
});
