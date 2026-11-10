import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askHref, buildRoute, codeHref, parseRoute, routeKey, safeReturn, scopeFromQuery } from '../../src/ui/state/routes.ts';

test('parseRoute reads every route', () => {
  assert.deepEqual(parseRoute(''), { name: 'dashboard' });
  assert.deepEqual(parseRoute('#/'), { name: 'dashboard' });
  assert.deepEqual(parseRoute('#/setup'), { name: 'setup' });
  assert.deepEqual(parseRoute('#/signin?return=%23%2Fsessions%2Fa'), { name: 'signin', return: '#/sessions/a' });
  assert.deepEqual(parseRoute('#/sessions/s1'), { name: 'overview', sessionId: 's1' });
  assert.deepEqual(parseRoute('#/sessions/s1/diff?path=src%2Fa.ts'), { name: 'diff', sessionId: 's1', path: 'src/a.ts' });
  assert.deepEqual(parseRoute('#/sessions/s1/description'), { name: 'description', sessionId: 's1' });
  assert.deepEqual(parseRoute('#/sessions/s1/issues/github-issues/ABC-1'), { name: 'issue', sessionId: 's1', platform: 'github-issues', key: 'ABC-1' });
  assert.equal(parseRoute('#/nowhere').name, 'unknown');
});

test('buildRoute round-trips parseRoute', () => {
  for (const hash of ['#/', '#/setup', '#/sessions/s1', '#/sessions/s1/diff?path=src%2Fa.ts', '#/sessions/s1/description', '#/sessions/s1/issues/p/K-1']) {
    assert.equal(buildRoute(parseRoute(hash)), hash);
  }
});

test('routeKey is the name plus identifying parameters and drops return', () => {
  assert.equal(routeKey(parseRoute('#/sessions/s1/diff?path=src/a.ts')), 'diff?path=src/a.ts');
  assert.equal(routeKey(parseRoute('#/sessions/s1')), 'overview');
  assert.equal(routeKey(parseRoute('#/signin?return=%23%2F')), 'signin');
});

test('askHref and scopeFromQuery round-trip each scope', () => {
  const scopes = [
    { type: 'pr' as const },
    { type: 'file' as const, path: 'a.ts' },
    { type: 'range' as const, path: 'a.ts', side: 'head' as const, startLine: 3, endLine: 9, label: 'foo()' },
  ];
  for (const scope of scopes) {
    const href = askHref('s1', scope);
    assert.ok(href.startsWith('#/sessions/s1/ask?'));
    assert.deepEqual(scopeFromQuery(new URLSearchParams(href.split('?')[1])), scope);
  }
  assert.deepEqual(scopeFromQuery(new URLSearchParams('type=range&path=a&side=head&start=5&end=2')), { type: 'pr' });
});

test('codeHref emits start and end', () => {
  const href = codeHref('s1', { snapshot: 'n1', side: 'head', path: 'a.ts', start: 45, end: 50 });
  const query = new URLSearchParams(href.split('?')[1]);
  assert.equal(query.get('start'), '45');
  assert.equal(query.get('end'), '50');
  assert.equal(query.get('line'), null);
  assert.deepEqual(parseRoute(href), { name: 'code', sessionId: 's1', snapshot: 'n1', side: 'head', path: 'a.ts', range: { start: 45, end: 50 } });
});

test('code route: line alone is a one-line range; only start gives end = start', () => {
  const r = (q: string) => parseRoute(`#/sessions/s1/code?snapshot=n&side=head&path=a&${q}`);
  assert.deepEqual((r('line=7') as { range?: unknown }).range, { start: 7, end: 7 });
  assert.deepEqual((r('start=4') as { range?: unknown }).range, { start: 4, end: 4 });
});

test('code route: invalid numbers give no range', () => {
  for (const q of ['start=0&end=3', 'start=x', 'start=5&end=2', 'line=-1', 'line=1.5', 'start=2&end=y', '']) {
    const route = parseRoute(`#/sessions/s1/code?snapshot=n&side=head&path=a&${q}`);
    assert.equal(route.name, 'code');
    assert.equal((route as { range?: unknown }).range, undefined, q);
  }
});

test('safeReturn accepts only parsed app routes other than sign-in and set-up', () => {
  assert.equal(safeReturn('#/sessions/s1/diff?path=a'), '#/sessions/s1/diff?path=a');
  assert.equal(safeReturn('#/'), '#/');
  for (const bad of ['#/signin', '#/setup', '#/signin?return=%23%2F', 'https://evil.test', '//evil.test', 'javascript:alert(1)', '#/nowhere', '/sessions/s1', '', null, undefined]) {
    assert.equal(safeReturn(bad), '#/', String(bad));
  }
});
