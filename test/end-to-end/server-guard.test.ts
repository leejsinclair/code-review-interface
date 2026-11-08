// VO-043, VO-044, VO-045 (FR-030, research R3, contracts/http-api.md sections 1
// and 2): the real request guard (`src/server/guard.ts`, T040) running inside the
// real server (`src/server/http.ts`, T044), driven over HTTP.
//
// Contract this test sets beyond test/helpers/server.ts:
//
//   startServer({ routes, launchToken, uiDir }) where `uiDir` is the directory
//   the static UI files are served from (default `dist/ui/`): `/launch` serves
//   `launch.html`, `/launch.js`, `/` serves `index.html`, `/app.js`, `/app.css`.
//   With no `logger` option, the server logs through `src/log.ts` (T023) into
//   `<app-data>/logs/`, resolved from the environment by `src/appdata.ts`, and
//   writes at least one line per request (the route pattern, never the URL or
//   headers).
//
// One app-data directory is set for the whole file, before the server module is
// first loaded, so the logger resolves it whenever it is read. Every launch token
// used in the file is checked against every log file at the end.

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createTempAppData, type TempAppData } from '../helpers/app-data.ts';
import { HOST, SESSION_COOKIE, startTestServer, type TestClient, type TestResponse } from '../helpers/server.ts';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const UI_FILES: Record<string, string> = {
  'launch.html': '<!doctype html><title>launch</title><script type="module" src="/launch.js"></script>',
  'launch.js': 'console.log("launch script");',
  'index.html': '<!doctype html><title>workbench</title><script type="module" src="/app.js"></script>',
  'app.js': 'console.log("app bundle");',
  'app.css': 'body { margin: 0; }',
};

let appData: TempAppData;
let uiDir: string;
const tokensUsed: string[] = [];

before(async () => {
  appData = await createTempAppData();
  uiDir = await mkdtemp(join(tmpdir(), 'prwb-ui-'));
  for (const [name, content] of Object.entries(UI_FILES)) await writeFile(join(uiDir, name), content);
});

after(async () => {
  // A name-filtered run that selects nothing here skips `before`, so both may be unset.
  if (uiDir) await rm(uiDir, { recursive: true, force: true });
  await appData?.cleanup();
});

interface AfterHook {
  after(fn: () => unknown): void;
}

async function serve(t: AfterHook, authenticate: boolean): Promise<TestClient> {
  const client = await startTestServer({ serverOptions: { uiDir }, authenticate });
  tokensUsed.push(client.launchToken);
  t.after(() => client.close());
  return client;
}

function errorCode(res: TestResponse): unknown {
  return (res.json as { error?: { code?: unknown } } | undefined)?.error?.code;
}

function assertRefused(res: TestResponse, status: number, code: string, what: string): void {
  assert.equal(res.status, status, `${what}: status`);
  assert.equal(errorCode(res), code, `${what}: error code`);
  assert.equal(typeof (res.json as { error?: { message?: unknown } } | undefined)?.error?.message, 'string', `${what}: message`);
}

function assertSecurityHeaders(res: TestResponse, what: string): void {
  assert.equal(res.headers['content-security-policy'], CSP, `${what}: Content-Security-Policy`);
  assert.equal(res.headers['x-content-type-options'], 'nosniff', `${what}: X-Content-Type-Options`);
  assert.equal(res.headers['referrer-policy'], 'no-referrer', `${what}: Referrer-Policy`);
  const cors = Object.keys(res.headers).filter((name) => name.toLowerCase().startsWith('access-control-'));
  assert.deepEqual(cors, [], `${what}: no CORS header`);
}

async function readLogs(): Promise<string[]> {
  const dir = join(appData.dir, 'logs');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) out.push(await readFile(join(dir, name), 'utf8'));
  return out;
}

test('VO-043 requests with no cookie or a wrong cookie get 401', async (t) => {
  const client = await serve(t, false);

  for (const path of ['/', '/app.js', '/app.css', '/api/sessions', '/api/config']) {
    assertRefused(await client.get(path, { cookie: false }), 401, 'unauthenticated', `GET ${path} with no cookie`);
  }
  const sameLength = client.launchToken.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
  for (const wrong of ['wrong', sameLength, `${client.launchToken}x`, '']) {
    assertRefused(await client.get('/', { cookieValue: wrong }), 401, 'unauthenticated', `cookie "${wrong}"`);
  }
  assertRefused(
    await client.get('/', { cookie: false, headers: { cookie: `other=${client.launchToken}` } }),
    401,
    'unauthenticated',
    'token under another cookie name',
  );
  assertRefused(
    await client.post('/api/sessions', { prNumber: 1 }, { cookie: false }),
    401,
    'unauthenticated',
    'POST with no cookie',
  );

  for (const [path, name] of [['/launch', 'launch.html'], ['/launch.js', 'launch.js']] as const) {
    const res = await client.get(path, { cookie: false });
    assert.equal(res.status, 200, `GET ${path} needs no cookie`);
    assert.equal(res.text, UI_FILES[name]);
  }
});

test('VO-043 the POST /api/auth exchange sets an HttpOnly SameSite=Strict cookie that opens the UI', async (t) => {
  const client = await serve(t, false);

  const wrong = await client.post('/api/auth', { token: 'not-the-token' }, { cookie: false });
  assertRefused(wrong, 401, 'unauthenticated', 'exchange with a wrong token');
  assert.equal(wrong.headers['set-cookie'], undefined, 'a wrong token sets no cookie');

  const missing = await client.post('/api/auth', {}, { cookie: false });
  assert.equal(missing.status >= 400, true, 'exchange with no token is refused');
  assert.equal(missing.headers['set-cookie'], undefined);

  const viaGet = await client.get(`/api/auth?token=${client.launchToken}`, { cookie: false });
  assert.notEqual(viaGet.status, 204, 'GET does not exchange the token');
  assert.equal(viaGet.headers['set-cookie'], undefined, 'GET sets no cookie');

  const res = await client.post('/api/auth', { token: client.launchToken }, { cookie: false });
  assert.equal(res.status, 204);
  const setCookie = res.headers['set-cookie'] ?? [];
  assert.equal(setCookie.length, 1);
  const parts = (setCookie[0] ?? '').split(';').map((p) => p.trim());
  assert.equal(parts[0], `${SESSION_COOKIE}=${client.launchToken}`);
  const attributes = parts.slice(1).map((p) => p.toLowerCase());
  assert.ok(attributes.includes('httponly'), 'HttpOnly');
  assert.ok(attributes.includes('samesite=strict'), 'SameSite=Strict');
  assert.ok(attributes.includes('path=/'), 'Path=/');

  await client.authenticate();
  for (const [path, name] of [['/', 'index.html'], ['/app.js', 'app.js'], ['/app.css', 'app.css']] as const) {
    const ok = await client.get(path);
    assert.equal(ok.status, 200, `GET ${path} with the cookie`);
    assert.equal(ok.text, UI_FILES[name]);
  }
  const unknown = await client.get('/api/no-such-route');
  assertRefused(unknown, 404, 'not_found', 'authenticated GET of an unknown route passes the guard');
});

test('VO-043 the launch token never appears in the logs', async (t) => {
  const client = await serve(t, false);
  const token = client.launchToken;

  await client.post('/api/auth', { token: 'not-the-token' }, { cookie: false });
  await client.get(`/launch?token=${token}`, { cookie: false });
  await client.get(`/api/${token}`, { cookie: false, headers: { 'x-probe': token } });
  await client.authenticate();
  await client.get('/');
  await client.get(`/api/no-such-route?token=${token}`, { headers: { authorization: `Bearer ${token}` } });
  await client.get('/', { host: `evil.example:${client.port}`, cookieValue: token });
  await client.post('/api/no-such-route', { token }, { origin: 'http://evil.example' });

  let logs: string[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    logs = await readLogs();
    if (logs.join('').trim().length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(logs.join('').trim().length > 0, 'the server logged its requests under <app-data>/logs');
  for (const used of tokensUsed) {
    for (const text of logs) assert.equal(text.includes(used), false, 'a launch token appears in a log file');
  }
});

test('VO-044 a foreign Host gets 421 on every route, before the cookie is checked', async (t) => {
  const client = await serve(t, true);
  const foreignHosts = [`evil.example:${client.port}`, `localhost:${client.port}`, `${HOST}:1`, HOST, `[::1]:${client.port}`];

  for (const host of foreignHosts) {
    assertRefused(await client.get('/', { host }), 421, 'bad_host', `GET / with Host ${host}`);
    assertRefused(await client.get('/launch', { host, cookie: false }), 421, 'bad_host', `GET /launch with Host ${host}`);
    const auth = await client.post('/api/auth', { token: client.launchToken }, { host, cookie: false });
    assertRefused(auth, 421, 'bad_host', `POST /api/auth with Host ${host}`);
    assert.equal(auth.headers['set-cookie'], undefined);
  }
  assertRefused(
    await client.get('/api/sessions', { host: 'evil.example', cookie: false }),
    421,
    'bad_host',
    'foreign Host with no cookie',
  );

  assert.equal((await client.get('/')).status, 200, 'the right Host passes');
});

test('VO-044 a foreign Origin gets 403 on GET and POST, and a non-GET with no Origin gets 403', async (t) => {
  const client = await serve(t, true);
  const foreignOrigins = ['http://evil.example', `http://localhost:${client.port}`, `http://${HOST}:1`, `https://${HOST}:${client.port}`, 'null'];

  for (const origin of foreignOrigins) {
    assertRefused(await client.get('/', { origin }), 403, 'bad_origin', `GET with Origin ${origin}`);
    assertRefused(await client.get('/api/sessions', { origin }), 403, 'bad_origin', `GET /api/sessions with Origin ${origin}`);
    assertRefused(
      await client.post('/api/sessions', { prNumber: 1 }, { origin }),
      403,
      'bad_origin',
      `POST with Origin ${origin}`,
    );
    const auth = await client.post('/api/auth', { token: client.launchToken }, { origin, cookie: false });
    assertRefused(auth, 403, 'bad_origin', `POST /api/auth with Origin ${origin}`);
    assert.equal(auth.headers['set-cookie'], undefined);
  }

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assertRefused(
      await client.request(method, '/api/sessions', { body: {}, origin: null }),
      403,
      'bad_origin',
      `${method} with no Origin`,
    );
  }
  const authNoOrigin = await client.post('/api/auth', { token: client.launchToken }, { origin: null, cookie: false });
  assertRefused(authNoOrigin, 403, 'bad_origin', 'POST /api/auth with no Origin');
  assert.equal(authNoOrigin.headers['set-cookie'], undefined);

  assert.equal((await client.get('/', { origin: null })).status, 200, 'a GET with no Origin passes');
  assert.equal((await client.get('/', { origin: client.origin })).status, 200, 'a GET with the server Origin passes');
  assertRefused(
    await client.post('/api/no-such-route', {}, { origin: client.origin }),
    404,
    'not_found',
    'a POST with the server Origin passes the guard',
  );
});

test('VO-045 every response carries the CSP, nosniff and no-referrer, and no Access-Control-* header', async (t) => {
  const client = await serve(t, false);
  const seen: Array<[TestResponse, string]> = [];
  const check = async (what: string, res: Promise<TestResponse>): Promise<void> => {
    seen.push([await res, what]);
  };

  await check('GET /launch', client.get('/launch', { cookie: false }));
  await check('GET /launch.js', client.get('/launch.js', { cookie: false }));
  await check('GET / with no cookie', client.get('/', { cookie: false }));
  await check('wrong token exchange', client.post('/api/auth', { token: 'nope' }, { cookie: false }));
  await check('token exchange', client.post('/api/auth', { token: client.launchToken }, { cookie: false }));
  await client.authenticate();
  await check('GET /', client.get('/'));
  await check('GET /app.js', client.get('/app.js'));
  await check('GET /app.css', client.get('/app.css'));
  await check('unknown route', client.get('/api/no-such-route'));
  await check('foreign Host', client.get('/', { host: 'evil.example' }));
  await check('foreign Origin', client.get('/', { origin: 'http://evil.example' }));
  await check('POST with no Origin', client.post('/api/sessions', {}, { origin: null }));
  await check(
    'CORS preflight',
    client.request('OPTIONS', '/api/sessions', {
      origin: 'http://evil.example',
      headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    }),
  );
  await check(
    'same-origin preflight',
    client.request('OPTIONS', '/api/sessions', {
      headers: { 'access-control-request-method': 'POST' },
    }),
  );

  assert.deepEqual(
    seen.slice(0, 13).map(([res, what]) => [what, res.status]),
    [
      ['GET /launch', 200],
      ['GET /launch.js', 200],
      ['GET / with no cookie', 401],
      ['wrong token exchange', 401],
      ['token exchange', 204],
      ['GET /', 200],
      ['GET /app.js', 200],
      ['GET /app.css', 200],
      ['unknown route', 404],
      ['foreign Host', 421],
      ['foreign Origin', 403],
      ['POST with no Origin', 403],
      ['CORS preflight', 403],
    ],
  );
  for (const [res, what] of seen) assertSecurityHeaders(res, what);
  const preflight = seen[13]?.[0];
  assert.ok(preflight && preflight.status >= 400, 'a same-origin preflight is never answered with success');
});
