// Feature 007 (T012; VO-027, FR-017, research R8): the request scope and GET memo. Inside
// `withRequestScope` one in-flight promise serves every GET of the same URL and credential; outside a
// scope nothing is cached; a failed read is evicted so a retry reads again; clearing empties the scope;
// two concurrent scopes never share. Written first: it fails until src/adapters/request-memo.ts (T018) exists.
// The module is loaded inside each test body so this file runs before it does.
//
// ASSUMED API of src/adapters/request-memo.ts (the T018 builder must match, or tell the test owner):
//
//   export function withRequestScope<T>(fn: () => Promise<T>): Promise<T>;
//   export function memoGet<T>(key: string, load: () => Promise<T>): Promise<T>;   // read layer only
//   export function memoKey(url: string, credential: string): string;             // URL plus credential identity
//   export function clearRequestMemo(): void;                                      // write layer only; no-op outside a scope

import assert from 'node:assert/strict';
import { test } from 'node:test';

async function load() {
  return import('../../src/adapters/request-memo.ts');
}

function counter() {
  let n = 0;
  return { calls: () => n, load: async (): Promise<string> => { n += 1; return `body-${n}`; } };
}

test('VO-027 inside a scope one read per URL and credential serves every caller', async () => {
  const { withRequestScope, memoGet, memoKey } = await load();
  const c = counter();
  await withRequestScope(async () => {
    const key = memoKey('https://api.example.com/pulls/1', 'token-a');
    const [a, b] = await Promise.all([memoGet(key, c.load), memoGet(key, c.load)]);
    const later = await memoGet(key, c.load);
    assert.equal(c.calls(), 1, 'one network read');
    assert.equal(a, 'body-1');
    assert.equal(b, 'body-1');
    assert.equal(later, 'body-1');
  });
});

test('VO-027 a different URL or a different credential is a different read', async () => {
  const { withRequestScope, memoGet, memoKey } = await load();
  const c = counter();
  await withRequestScope(async () => {
    await memoGet(memoKey('https://api.example.com/pulls/1', 'token-a'), c.load);
    await memoGet(memoKey('https://api.example.com/pulls/2', 'token-a'), c.load);
    await memoGet(memoKey('https://api.example.com/pulls/1', 'token-b'), c.load);
    assert.equal(c.calls(), 3);
  });
  assert.notEqual(memoKey('https://a/x', 'one'), memoKey('https://a/x', 'two'));
  assert.equal(memoKey('https://a/x', 'one'), memoKey('https://a/x', 'one'));
});

test('VO-027 outside a scope nothing is cached', async () => {
  const { memoGet, memoKey } = await load();
  const c = counter();
  const key = memoKey('https://api.example.com/pulls/1', 'token-a');
  assert.equal(await memoGet(key, c.load), 'body-1');
  assert.equal(await memoGet(key, c.load), 'body-2');
  assert.equal(c.calls(), 2);
});

test('VO-027 a failed read is evicted so the next read in the scope retries', async () => {
  const { withRequestScope, memoGet, memoKey } = await load();
  let n = 0;
  const flaky = async (): Promise<string> => {
    n += 1;
    if (n === 1) throw new Error('network down');
    return 'ok';
  };
  await withRequestScope(async () => {
    const key = memoKey('https://api.example.com/pulls/1', 'token-a');
    await assert.rejects(memoGet(key, flaky), /network down/);
    assert.equal(await memoGet(key, flaky), 'ok');
    assert.equal(await memoGet(key, flaky), 'ok');
    assert.equal(n, 2, 'one failure, one retry, then served from the memo');
  });
});

test('VO-027 clearing empties the scope so the next read goes to the network', async () => {
  const { withRequestScope, memoGet, memoKey, clearRequestMemo } = await load();
  const c = counter();
  await withRequestScope(async () => {
    const key = memoKey('https://api.example.com/pulls/1', 'token-a');
    await memoGet(key, c.load);
    clearRequestMemo();
    assert.equal(await memoGet(key, c.load), 'body-2');
    assert.equal(c.calls(), 2);
  });
});

test('VO-027 clearing outside a scope does nothing and does not throw', async () => {
  const { clearRequestMemo } = await load();
  assert.doesNotThrow(() => clearRequestMemo());
});

test('VO-027 concurrent scopes do not share entries or clears', async () => {
  const { withRequestScope, memoGet, memoKey, clearRequestMemo } = await load();
  const key = memoKey('https://api.example.com/pulls/1', 'token-a');
  const c = counter();
  let releaseA = (): void => {};
  const gateA = new Promise<void>((r) => { releaseA = r; });
  let sawB = '';
  const a = withRequestScope(async () => {
    const first = await memoGet(key, c.load);
    await gateA;
    const again = await memoGet(key, c.load);
    return [first, again];
  });
  const b = withRequestScope(async () => {
    sawB = await memoGet(key, c.load);
    clearRequestMemo();
    releaseA();
    return sawB;
  });
  const [resA] = await Promise.all([a, b]);
  assert.equal(c.calls(), 2, 'each scope read once');
  assert.notEqual(sawB, resA![0], 'scope B did not receive scope A\'s body');
  assert.deepEqual(resA, [resA![0], resA![0]], 'scope B\'s clear did not empty scope A');
});
