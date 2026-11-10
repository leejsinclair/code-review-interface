// VO-039 (FR-027, VIII.3): the read-only HTTP layer refuses every method but GET before any network call.
//
// API required from src/adapters/read-only-http.ts (T035):
//
//   export function createReadOnlyFetch(options: {
//     platform: PlatformId;                                                     // string
//     fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;  // the network
//   }): ReadOnlyFetch;
//
//   ReadOnlyFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>
//   (contracts/provider-contracts.md). Any other method that reaches it at runtime, through `init.method`
//   or a `Request` passed as the url, rejects with an Error whose message contains the method and
//   "read-only", and the network fetch is never called. A GET returns the network Response as is for
//   2xx; 401 and 403 reject with AdapterError code `unauthorized`, 404 with `not_found`, 5xx and a
//   network failure with `unavailable`, each carrying `platform`.
//
// And from src/contracts/shared.ts (T021): `export class AdapterError extends Error { code; platform }`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as ReadOnlyHttpModule from '../../src/adapters/read-only-http.ts';
import type * as SharedModule from '../../src/contracts/shared.ts';
import { recordedFetch, type FixtureEntry, type RecordedFetch } from '../helpers/recorded-fetch.ts';

type ReadOnlyHttp = typeof ReadOnlyHttpModule;
type Shared = typeof SharedModule;

const BASE = 'https://api.example.test';
const PLATFORM = 'scm-test';

const entries: FixtureEntry[] = [
  { request: { url: `${BASE}/repos/o/r` }, response: { status: 200, body: { name: 'r' } } },
  { request: { url: `${BASE}/unauthorized` }, response: { status: 401, body: { message: 'Bad credentials' } } },
  { request: { url: `${BASE}/forbidden` }, response: { status: 403, body: { message: 'Forbidden' } } },
  { request: { url: `${BASE}/missing` }, response: { status: 404, body: { message: 'Not Found' } } },
  { request: { url: `${BASE}/broken` }, response: { status: 503, body: 'down' } },
  { request: { url: `${BASE}/offline` }, response: { networkError: 'ECONNREFUSED' } },
  // Recordings exist for the write methods too, so a refusal cannot be explained by a missing recording.
  ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => ({
    request: { method, url: `${BASE}/repos/o/r/pulls/1` },
    response: { status: 200, body: { ok: true } },
  })),
];

async function setup(): Promise<{ mod: ReadOnlyHttp; rec: RecordedFetch; calls: () => number; ro: ReturnType<ReadOnlyHttp['createReadOnlyFetch']> }> {
  const mod = (await import('../../src/adapters/read-only-http.ts')) as ReadOnlyHttp;
  const rec = recordedFetch([], { entries });
  let count = 0;
  const network = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    count += 1;
    return rec.fetch(input, init);
  };
  const ro = mod.createReadOnlyFetch({ platform: PLATFORM, fetch: network });
  return { mod, rec, calls: () => count, ro };
}

// The contract type has no `method`; these simulate a caller that bypasses it.
type AnyInit = { headers?: Record<string, string> };
const withMethod = (method: string): AnyInit => ({ method } as unknown as AnyInit);

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`VO-039 ${method} is refused before any network call`, async () => {
    const { rec, calls, ro } = await setup();
    await assert.rejects(
      async () => ro(`${BASE}/repos/o/r/pulls/1`, withMethod(method)),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'rejects with an Error');
        assert.match(err.message, new RegExp(method));
        assert.match(err.message, /read-only/i);
        return true;
      },
    );
    assert.equal(calls(), 0, 'the network fetch was never called');
    assert.equal(rec.requests.length, 0, 'nothing reached the recorded log');
  });
}

test('VO-039 lower-case and other non-GET methods are refused too', async () => {
  const { rec, calls, ro } = await setup();
  for (const method of ['post', 'delete', 'HEAD', 'OPTIONS']) {
    await assert.rejects(async () => ro(`${BASE}/repos/o/r/pulls/1`, withMethod(method)), /read-only/i, method);
  }
  assert.equal(calls(), 0);
  assert.equal(rec.requests.length, 0);
});

test('VO-039 a Request carrying a write method is refused before any network call', async () => {
  const { rec, calls, ro } = await setup();
  const request = new Request(`${BASE}/repos/o/r/pulls/1`, { method: 'POST', body: '{}' });
  await assert.rejects(async () => ro(request as unknown as string), /POST/);
  assert.equal(calls(), 0);
  assert.equal(rec.requests.length, 0);
});

test('VO-039 GET passes through with its headers', async () => {
  const { rec, calls, ro } = await setup();
  const res = await ro(`${BASE}/repos/o/r`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { name: 'r' });
  assert.equal(calls(), 1);
  assert.equal(rec.requests.length, 1);
  assert.equal(rec.requests[0]?.method, 'GET');
  assert.equal(rec.requests[0]?.headers['accept'], 'application/json');

  const explicit = await ro(`${BASE}/repos/o/r`, withMethod('GET'));
  assert.equal(explicit.status, 200);
  rec.assertAllRecorded();
});

test('VO-039 failures map to AdapterError codes for the platform', async () => {
  const { ro } = await setup();
  const { AdapterError } = (await import('../../src/contracts/shared.ts')) as Shared;
  const cases: Array<[string, string]> = [
    ['/unauthorized', 'unauthorized'],
    ['/forbidden', 'unauthorized'],
    ['/missing', 'not_found'],
    ['/broken', 'unavailable'],
    ['/offline', 'unavailable'],
  ];
  for (const [path, code] of cases) {
    await assert.rejects(
      async () => ro(`${BASE}${path}`),
      (err: unknown) => {
        assert.ok(err instanceof AdapterError, `${path} rejects with AdapterError`);
        assert.equal((err as { code: string }).code, code, path);
        assert.equal((err as { platform: string }).platform, PLATFORM, path);
        return true;
      },
    );
  }
});

test('VO-039 after a mix of reads and refused writes the recorded log holds only GETs', async () => {
  const { rec, ro } = await setup();
  await ro(`${BASE}/repos/o/r`);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await ro(`${BASE}/repos/o/r/pulls/1`, withMethod(method)).catch(() => undefined);
  }
  await ro(`${BASE}/missing`).catch(() => undefined);
  assert.equal(rec.requests.length, 2);
  assert.ok(rec.requests.every((r) => r.method === 'GET'), 'only GET requests were sent');
  rec.assertAllRecorded();
});

// FR-043, FR-044 (ADR 0002): the layer sends GET with `redirect: 'manual'` and follows a 301, 302, 303,
// 307 or 308 only when `Location` (resolved against the current URL) keeps the scheme, host and port.
// It repeats the GET with the same headers for at most 5 hops. A cross-origin `Location`, a missing
// `Location` or a 6th hop rejects with AdapterError `unavailable` before any request leaves the origin,
// so the credential header never reaches another host.

const CREDENTIAL = { authorization: 'Bearer redirect-secret', accept: 'application/json' };

type NetworkCall = { url: string; redirect: RequestRedirect | undefined; headers: Record<string, string> };

function redirectEntry(from: string, status: number, location: string | null): FixtureEntry {
  return {
    request: { url: from },
    response: { status, headers: location === null ? {} : { location }, body: '' },
  };
}

async function redirectSetup(redirectEntries: FixtureEntry[]): Promise<{
  rec: RecordedFetch;
  calls: NetworkCall[];
  ro: ReturnType<ReadOnlyHttp['createReadOnlyFetch']>;
  AdapterError: Shared['AdapterError'];
}> {
  const mod = (await import('../../src/adapters/read-only-http.ts')) as ReadOnlyHttp;
  const { AdapterError } = (await import('../../src/contracts/shared.ts')) as Shared;
  const rec = recordedFetch([], { entries: redirectEntries });
  const calls: NetworkCall[] = [];
  const network = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => { headers[name] = value; });
    calls.push({ url: input instanceof Request ? input.url : String(input), redirect: init?.redirect, headers });
    return rec.fetch(input, init);
  };
  const ro = mod.createReadOnlyFetch({ platform: PLATFORM, fetch: network });
  return { rec, calls, ro, AdapterError };
}

function assertUnavailable(AdapterError: Shared['AdapterError']): (err: unknown) => boolean {
  return (err: unknown) => {
    assert.ok(err instanceof AdapterError, 'rejects with AdapterError');
    assert.equal((err as { code: string }).code, 'unavailable');
    assert.equal((err as { platform: string }).platform, PLATFORM);
    return true;
  };
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`FR-043 a same-origin ${status} is followed with the same headers`, async () => {
    const { rec, calls, ro } = await redirectSetup([
      redirectEntry(`${BASE}/projects/old%2Fpath`, status, `${BASE}/projects/new%2Fpath`),
      { request: { url: `${BASE}/projects/new%2Fpath` }, response: { status: 200, body: { id: 7 } } },
    ]);
    const res = await ro(`${BASE}/projects/old%2Fpath`, { headers: CREDENTIAL });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 7 });
    assert.deepEqual(calls.map((c) => c.url), [`${BASE}/projects/old%2Fpath`, `${BASE}/projects/new%2Fpath`]);
    for (const call of calls) {
      assert.equal(call.redirect, 'manual', 'the network never follows redirects on its own');
      assert.equal(call.headers['authorization'], CREDENTIAL.authorization);
      assert.equal(call.headers['accept'], CREDENTIAL.accept);
    }
    assert.ok(rec.requests.every((r) => r.method === 'GET'), 'every hop is a GET');
    rec.assertAllRecorded();
  });
}

test('FR-043 a relative Location resolves against the current URL and is followed', async () => {
  const { rec, calls, ro } = await redirectSetup([
    redirectEntry(`${BASE}/api/v4/projects/1`, 301, '/api/v4/projects/2'),
    redirectEntry(`${BASE}/api/v4/projects/2`, 302, 'three'),
    { request: { url: `${BASE}/api/v4/projects/three` }, response: { status: 200, body: { id: 3 } } },
  ]);
  const res = await ro(`${BASE}/api/v4/projects/1`, { headers: CREDENTIAL });
  assert.deepEqual(await res.json(), { id: 3 });
  assert.deepEqual(calls.map((c) => c.url), [
    `${BASE}/api/v4/projects/1`,
    `${BASE}/api/v4/projects/2`,
    `${BASE}/api/v4/projects/three`,
  ]);
  rec.assertAllRecorded();
});

test('FR-043 five same-origin hops are followed', async () => {
  const chain = [0, 1, 2, 3, 4].map((n) => redirectEntry(`${BASE}/hop/${n}`, 302, `${BASE}/hop/${n + 1}`));
  const { calls, ro } = await redirectSetup([
    ...chain,
    { request: { url: `${BASE}/hop/5` }, response: { status: 200, body: { done: true } } },
  ]);
  const res = await ro(`${BASE}/hop/0`, { headers: CREDENTIAL });
  assert.deepEqual(await res.json(), { done: true });
  assert.equal(calls.length, 6, 'the first request plus five followed hops');
});

test('FR-044 a 6th hop is refused as unavailable and never sent', async () => {
  const chain = [0, 1, 2, 3, 4, 5].map((n) => redirectEntry(`${BASE}/hop/${n}`, 302, `${BASE}/hop/${n + 1}`));
  const { calls, ro, AdapterError } = await redirectSetup([
    ...chain,
    { request: { url: `${BASE}/hop/6` }, response: { status: 200, body: { done: true } } },
  ]);
  await assert.rejects(async () => ro(`${BASE}/hop/0`, { headers: CREDENTIAL }), assertUnavailable(AdapterError));
  assert.equal(calls.length, 6, 'the first request plus five followed hops, no sixth');
  assert.ok(!calls.some((c) => c.url === `${BASE}/hop/6`), 'the 6th hop target was never requested');
});

test('FR-044 a redirect with no Location is refused as unavailable', async () => {
  const { calls, ro, AdapterError } = await redirectSetup([redirectEntry(`${BASE}/moved`, 301, null)]);
  await assert.rejects(async () => ro(`${BASE}/moved`, { headers: CREDENTIAL }), assertUnavailable(AdapterError));
  assert.equal(calls.length, 1);
});

for (const [label, target] of [
  ['another host', 'https://evil.example.test/steal'],
  ['another scheme', 'http://api.example.test/repos/o/r'],
  ['another port', 'https://api.example.test:8443/repos/o/r'],
  ['a protocol-relative host', '//evil.example.test/steal'],
] as const) {
  test(`FR-044 a cross-origin redirect to ${label} is refused and the credential never leaves`, async () => {
    const resolved = new URL(target, BASE).href;
    const { rec, calls, ro, AdapterError } = await redirectSetup([
      redirectEntry(`${BASE}/repos/o/r`, 302, target),
      // A recording exists for the target, so a refusal cannot be explained by a missing recording.
      { request: { url: resolved }, response: { status: 200, body: { leaked: true } } },
    ]);
    await assert.rejects(async () => ro(`${BASE}/repos/o/r`, { headers: CREDENTIAL }), assertUnavailable(AdapterError));
    assert.equal(calls.length, 1, 'only the original request was sent');
    const origin = new URL(BASE).origin;
    assert.ok(rec.requests.every((r) => new URL(r.url).origin === origin), 'no request reached another origin');
    assert.ok(
      !calls.some((c) => new URL(c.url).origin !== origin && c.headers['authorization'] !== undefined),
      'the credential was never sent to another origin',
    );
  });
}

test('FR-044 a cross-origin hop after a same-origin hop is refused before it is sent', async () => {
  const { calls, ro, AdapterError } = await redirectSetup([
    redirectEntry(`${BASE}/a`, 301, `${BASE}/b`),
    redirectEntry(`${BASE}/b`, 307, 'https://other.example.test/c'),
    { request: { url: 'https://other.example.test/c' }, response: { status: 200, body: { leaked: true } } },
  ]);
  await assert.rejects(async () => ro(`${BASE}/a`, { headers: CREDENTIAL }), assertUnavailable(AdapterError));
  assert.deepEqual(calls.map((c) => c.url), [`${BASE}/a`, `${BASE}/b`]);
});
