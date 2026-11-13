// X.11 (T007): the write layer refuses a method or endpoint not on the allowlist, refuses redirects,
// and the read adapters cannot write.
//
// API required from src/adapters/write-http.ts (T014):
//
//   export type WriteAllow = { method: string; pattern: RegExp };   // pattern tested against URL pathname
//   export function createWriteFetch(options: {
//     platform: PlatformId;
//     fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;  // the network
//     allowlist: readonly WriteAllow[];
//   }): WriteFetch;
//   export type WriteFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string })
//     => Promise<Response>;
//
// A request whose method and path match no allowlist entry rejects with an Error whose message contains
// "not allowed" (and the method), before the network is called. The network is always called with
// redirect: 'manual'; a 3xx is never followed and rejects with AdapterError `unavailable`. Statuses map:
// 2xx pass through; 401 unauthorized; 403 forbidden; 404 not_found; 409 conflict; 422 rejected;
// 429 rate_limited; 5xx and network failure unavailable. Each AdapterError carries the platform and the
// platform's own message text from the JSON body `message` field when present.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as WriteHttpModule from '../../src/adapters/write-http.ts';
import { AdapterError } from '../../src/contracts/shared.ts';
import { loggedWriteFetch } from '../helpers/logged-write-fetch.ts';

type WriteHttp = typeof WriteHttpModule;

const BASE = 'https://api.example.test';
const PLATFORM = 'scm-test';
const ALLOW = [
  { method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/comments$/ },
  { method: 'DELETE', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/comments\/\d+$/ },
];
const OK_URL = `${BASE}/repos/o/r/pulls/1/comments`;

function network(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const inner = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(input), ...(init ? { init } : {}) });
    return respond(String(input), init);
  };
  return { logged: loggedWriteFetch(inner), seen };
}

async function setup(respond: (url: string, init?: RequestInit) => Response | Promise<Response> = () => new Response('{}', { status: 201 })) {
  const mod = (await import('../../src/adapters/write-http.ts')) as WriteHttp;
  const net = network(respond);
  const write = mod.createWriteFetch({ platform: PLATFORM, fetch: net.logged.fetch, allowlist: ALLOW });
  return { write, ...net };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a rejection');
}

test('X.11 an allowlisted method and endpoint reaches the network with redirect manual', async () => {
  const { write, seen, logged } = await setup();
  const res = await write(OK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"body":"x"}' });
  assert.equal(res.status, 201);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.init?.redirect, 'manual');
  logged.assertOnlyAllowedWrites(ALLOW);
});

test('X.11 a method not on the allowlist is refused before the network', async () => {
  const { write, seen } = await setup();
  for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) {
    const error = await rejection(write(OK_URL, { method }));
    assert.ok(error instanceof Error);
    assert.match(error.message, /not allowed/i);
    assert.ok(error.message.includes(method));
  }
  assert.equal(seen.length, 0);
});

test('X.11 an endpoint not on the allowlist is refused before the network, even with an allowed method', async () => {
  const { write, seen } = await setup();
  const targets = [
    `${BASE}/repos/o/r/pulls/1/merge`,
    `${BASE}/repos/o/r/pulls/1`,
    `${BASE}/repos/o/r/pulls/1/comments/extra`,
    `${BASE}/repos/o/r/issues/1/comments`,
  ];
  for (const url of targets) {
    const error = await rejection(write(url, { method: 'POST', body: '{}' }));
    assert.ok(error instanceof Error);
    assert.match(error.message, /not allowed/i);
  }
  // A query string or a trailing path trick does not widen a pattern.
  assert.ok((await rejection(write(`${OK_URL}/../merge`, { method: 'POST', body: '{}' }))) instanceof Error);
  assert.equal(seen.length, 0);
});

test('X.11 a redirect is never followed', async () => {
  for (const status of [301, 302, 307, 308]) {
    const { write, seen } = await setup(() => new Response(null, { status, headers: { location: `${BASE}/elsewhere` } }));
    const error = await rejection(write(OK_URL, { method: 'POST', body: '{}' }));
    assert.ok(error instanceof AdapterError);
    assert.equal(error.code, 'unavailable');
    assert.equal(error.platform, PLATFORM);
    assert.equal(seen.length, 1, `status ${status} was followed`);
  }
});

test('X.11 statuses map to neutral codes carrying the platform message', async () => {
  const table: [number, string][] = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ];
  for (const [status, code] of table) {
    const { write } = await setup(() => new Response(JSON.stringify({ message: `platform said ${status}` }), { status }));
    const error = await rejection(write(OK_URL, { method: 'POST', body: '{}' }));
    assert.ok(error instanceof AdapterError, `status ${status}`);
    assert.equal(error.code, code, `status ${status}`);
    assert.equal(error.platform, PLATFORM);
    assert.ok(error.message.includes(`platform said ${status}`), `status ${status} lost the platform message`);
  }
});

test('X.11 a network failure maps to unavailable', async () => {
  const { write } = await setup(() => {
    throw new TypeError('fetch failed');
  });
  const error = await rejection(write(OK_URL, { method: 'POST', body: '{}' }));
  assert.ok(error instanceof AdapterError);
  assert.equal(error.code, 'unavailable');
});

test('X.11 read adapters cannot write: the read-only layer refuses every write method, even on an allowlisted write endpoint', async () => {
  const { createReadOnlyFetch } = await import('../../src/adapters/read-only-http.ts');
  const net = network(() => new Response('{}', { status: 200 }));
  const ro = createReadOnlyFetch({ platform: PLATFORM, fetch: net.logged.fetch });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const error = await rejection(ro(OK_URL, { method } as unknown as { headers?: Record<string, string> }));
    assert.ok(error instanceof Error);
    assert.match(error.message, /read-only/i);
  }
  assert.equal(net.seen.length, 0);
  assert.equal(net.logged.writes.length, 0);
});

test('X.11 the read layer does not export a write path and the write layer does not reuse it', async () => {
  const readMod = (await import('../../src/adapters/read-only-http.ts')) as Record<string, unknown>;
  assert.equal(readMod['createWriteFetch'], undefined);
  const writeMod = (await import('../../src/adapters/write-http.ts')) as Record<string, unknown>;
  assert.equal(writeMod['createReadOnlyFetch'], undefined);
});
