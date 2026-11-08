// Exercises the test-server client against a stub server, since src/server/http.ts
// is built later (T044).
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { test } from 'node:test';
import { startTestServer, type StartServer } from './server.ts';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

function stub(seen: Seen[]): StartServer {
  return async ({ launchToken }) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        if (req.url === '/api/auth') {
          const token = (JSON.parse(body) as { token?: string }).token;
          if (token !== launchToken) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'unauthenticated', message: 'no' } }));
            return;
          }
          res.writeHead(204, { 'set-cookie': `prwb_session=${launchToken}; HttpOnly; SameSite=Strict; Path=/` });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return {
      port: address.port,
      close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    };
  };
}

test('exchanges the launch token and sends cookie, Host and Origin', async (t) => {
  const seen: Seen[] = [];
  const client = await startTestServer({ start: stub(seen) });
  t.after(() => client.close());

  const auth = seen[0];
  assert.ok(auth);
  assert.equal(auth.method, 'POST');
  assert.equal(auth.url, '/api/auth');
  assert.deepEqual(JSON.parse(auth.body), { token: client.launchToken });
  assert.equal(auth.headers.cookie, undefined);
  assert.equal(client.cookie, client.launchToken);

  const res = await client.post('/api/x', { a: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, path: '/api/x' });
  const sent = seen[1];
  assert.ok(sent);
  assert.equal(sent.headers.host, `127.0.0.1:${client.port}`);
  assert.equal(sent.headers.origin, `http://127.0.0.1:${client.port}`);
  assert.equal(sent.headers.cookie, `prwb_session=${client.launchToken}`);
  assert.equal(sent.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(sent.body), { a: 1 });
});

test('lets a test send a foreign Host, no Origin, and no or a wrong cookie', async (t) => {
  const seen: Seen[] = [];
  const client = await startTestServer({ start: stub(seen) });
  t.after(() => client.close());

  await client.get('/a', { host: 'evil.example:80', origin: null, cookie: false });
  await client.get('/b', { origin: 'http://evil.example', cookieValue: 'wrong' });
  const [a, b] = seen.slice(1);
  assert.ok(a && b);
  assert.equal(a.headers.host, 'evil.example:80');
  assert.equal(a.headers.origin, undefined);
  assert.equal(a.headers.cookie, undefined);
  assert.equal(b.headers.origin, 'http://evil.example');
  assert.equal(b.headers.cookie, 'prwb_session=wrong');
});

test('can skip the exchange, and fails start-up when the exchange is refused', async () => {
  const seen: Seen[] = [];
  const unauthenticated = await startTestServer({ start: stub(seen), authenticate: false });
  assert.equal(unauthenticated.cookie, undefined);
  assert.equal(seen.length, 0);
  await unauthenticated.close();

  const refusing: StartServer = async (options) => stub([])({ ...options, launchToken: 'other' });
  await assert.rejects(startTestServer({ start: refusing }), /\/api\/auth exchange failed with 401/);
});
