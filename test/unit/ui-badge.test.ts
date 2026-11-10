// T014: Badge markup per contracts 4.4.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VNode } from 'preact';
import { build } from 'esbuild';
import type { BadgeProps } from '../../src/ui/components/badge.tsx';

// Node cannot load .tsx, so bundle the component in memory and import the result.
const out = await build({
  entryPoints: ['src/ui/components/badge.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'preact',
});
const { Badge } = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)) as {
  Badge: (p: BadgeProps) => VNode;
};

const render = (props: BadgeProps) => {
  const v = Badge(props) as VNode<Record<string, unknown>>;
  const [glyph, text] = v.props.children as [VNode<Record<string, unknown>>, string];
  return { attrs: v.props, glyph: glyph.props.children as string, glyphHidden: glyph.props['aria-hidden'], text };
};

test('claim badges', () => {
  const e = render({ kind: 'claim', label: 'evidence' });
  assert.equal(e.attrs.class, 'badge');
  assert.equal(e.attrs['data-kind'], 'claim');
  assert.equal(e.attrs['data-label'], 'evidence');
  assert.equal(e.glyphHidden, 'true');
  assert.equal(e.glyph, '✓');
  assert.equal(e.text, 'Evidence');
  const i = render({ kind: 'claim', label: 'inference' });
  assert.deepEqual([i.glyph, i.text], ['≈', 'Inference']);
});

test('intent, completeness, skipped, pr-status carry their attribute', () => {
  const a = render({ kind: 'intent', intent: 'documented' });
  assert.deepEqual([a.attrs['data-intent'], a.glyph, a.text], ['documented', '✎', 'Documented intent']);
  assert.equal(render({ kind: 'intent', intent: 'inferred' }).text, 'Inferred intent');
  const c = render({ kind: 'completeness', status: 'stale' });
  assert.deepEqual([c.attrs['data-status'], c.glyph], ['stale', '⟳']);
  const s = render({ kind: 'skipped', reason: 'binary' });
  assert.deepEqual([s.attrs['data-reason'], s.glyph, s.text], ['binary', '⊘', 'binary']);
  const p = render({ kind: 'pr-status', status: 'merged' });
  assert.deepEqual([p.attrs['data-status'], p.glyph, p.text], ['merged', '●', 'merged']);
});

test('unresolved, older-head, read-only', () => {
  assert.equal(render({ kind: 'unresolved', reason: 'file gone' }).text, 'Unresolved: file gone');
  assert.equal(render({ kind: 'unresolved' }).text, 'Unresolved');
  const o = render({ kind: 'older-head', commit: 'abcdef1234567' });
  assert.deepEqual([o.glyph, o.text], ['⟲', 'Older head abcdef1']);
  assert.deepEqual([render({ kind: 'read-only' }).glyph, render({ kind: 'read-only' }).text], ['🔒︎', 'Read-only']);
});
