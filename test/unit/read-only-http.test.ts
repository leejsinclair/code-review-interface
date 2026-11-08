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
