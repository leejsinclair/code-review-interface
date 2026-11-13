// T078 (VO-031, VO-032, FR-002, FR-025, FR-040, constitution VII): no score, percentage or rank exists anywhere in
// the risk types, tables or screens, and no query reads overrides by reviewer or across files.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRiskRoutes } from '../../src/server/routes/risk.ts';

const root = new URL('../../', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), 'utf8');
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORBIDDEN = /score|percent|\brank|rating|\bpoints\b/i;

test('the RiskReport types carry no score, percentage or rank', async () => {
  const http = await read('src/contracts/http.ts');
  const section = code(http.slice(http.indexOf('// ---------------------------------------------------------------- 10. Risk')));
  assert.ok(section.length > 500);
  assert.equal(FORBIDDEN.test(section), false);
});

test('the risk tables have no score, percentage or rank column', async () => {
  const sql = await read('src/store/schema.sql');
  const section = sql.slice(sql.indexOf('-- Risk-based review focus')).replace(/^--.*$/gm, '');
  assert.ok(section.includes('class_override'));
  assert.equal(FORBIDDEN.test(section), false);
});

test('the risk screens show no score, percentage or rank', async () => {
  for (const file of ['src/ui/components/risk-badge.tsx', 'src/ui/components/review-focus.tsx', 'src/ui/components/risk-reasons.tsx', 'src/ui/components/scope-slider.tsx', 'src/ui/components/override-dialog.tsx', 'src/ui/components/risk-text.ts']) {
    const text = code(await read(file));
    assert.equal(FORBIDDEN.test(text), false, file);
    assert.equal(/\d\s*%/.test(text), false, `${file} shows a percentage`);
  }
});

test('the store has no by-reviewer or cross-file override query', async () => {
  const store = await read('src/store/review-store.ts');
  const iface = store.slice(store.indexOf('export interface ReviewStore'), store.indexOf('// Row mapping'));
  const overrideMethods = [...iface.matchAll(/^\s*(\w*[Oo]verride\w*)\(([^)]*)\)/gm)].map((m) => ({ name: m[1]!, args: m[2]! }));
  assert.deepEqual(overrideMethods.map((m) => m.name).sort(), ['appendClassOverride', 'readLatestOverride', 'readOverrideHistory']);
  for (const m of overrideMethods.filter((x) => x.name.startsWith('read'))) assert.match(m.args, /sessionId.*path/, `${m.name} takes a session and a path`);
  assert.equal(/Reviewer|byReviewer|listOverrides|countOverrides/.test(iface), false);
  const schema = await read('src/store/schema.sql');
  assert.equal(/INDEX[^;]*class_override[^;]*reviewer/i.test(schema), false, 'no index to read overrides by reviewer');
});

test('the HTTP routes expose no listing by reviewer or across files, and no write other than POST', () => {
  const module = createRiskRoutes({ risk: {} as never });
  const routes = module.routes.map((r) => `${r.method} ${r.pattern}`).sort();
  assert.deepEqual(routes, [
    'GET /api/sessions/:sessionId/risk/overrides',
    'GET /api/sessions/:sessionId/risk/reviewer',
    'GET /api/sessions/:sessionId/snapshots/:snapshotId/risk',
    'POST /api/sessions/:sessionId/risk/overrides',
  ]);
});

test('override history requires a path', async () => {
  const module = createRiskRoutes({ risk: { overrideHistory: () => [] } as never });
  const route = module.routes.find((r) => r.method === 'GET' && r.pattern.endsWith('/risk/overrides'))!;
  const ctx = { params: { sessionId: 's' }, query: new URLSearchParams(), deps: module.deps?.read } as never;
  await assert.rejects(async () => route.handler(ctx), (e: unknown) => (e as { code?: string }).code === 'invalid_request');
});
