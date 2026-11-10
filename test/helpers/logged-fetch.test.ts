// T014: the logged fetch records method, URL and host of every request and forwards to real fetch.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { loggedFetch } from './logged-fetch.ts';

let server: Server;
let base: string;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/plain');
    res.end(`${req.method} ${req.url}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('T014 logged fetch forwards to real fetch and records method, URL and host', async () => {
  const network = loggedFetch();
  const response = await network.fetch(`${base}/api/v4/version`);
  assert.equal(await response.text(), 'GET /api/v4/version');
  assert.deepEqual(network.requests, [
    { method: 'GET', url: `${base}/api/v4/version`, host: new URL(base).host },
  ]);
  network.assertOnlyGets();
  network.assertHosts([new URL(base).host]);
});

test('T014 logged fetch reads the method from init or from a Request, and never logs headers', async () => {
  const network = loggedFetch();
  await network.fetch(new Request(`${base}/a`, { method: 'POST', headers: { authorization: 'secret' } }));
  await network.fetch(new URL(`${base}/b`), { method: 'delete', headers: { 'private-token': 'secret' } });
  assert.deepEqual(
    network.requests.map((r) => r.method),
    ['POST', 'DELETE'],
  );
  assert.ok(!JSON.stringify(network.requests).includes('secret'), 'no credential in the log');
  assert.throws(() => network.assertOnlyGets(), /POST .*\/a[\s\S]*DELETE .*\/b/);
});

test('T014 logged fetch logs a request whose fetch rejects, and flags an unexpected host', async () => {
  const network = loggedFetch(() => Promise.reject(new TypeError('connection refused')));
  await assert.rejects(network.fetch('https://elsewhere.test/x'), /connection refused/);
  assert.equal(network.requests.length, 1);
  assert.throws(() => network.assertHosts(['127.0.0.1']), /elsewhere\.test/);
});
