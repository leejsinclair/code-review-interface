// Test server (T008): starts `src/server/http.ts` with the route modules a test
// passes in, performs the `/api/auth` launch-token exchange, and returns a client
// that sends the `prwb_session` cookie, `Host` and `Origin` on every request
// (contracts/http-api.md section 1).
//
// The client uses `node:http` rather than `fetch`, because `fetch` will not send a
// chosen `Host` header and the guard tests need to send a foreign one.
//
// Contract this helper expects of `src/server/http.ts` (T044):
//
//   export function startServer(options: {
//     routes: readonly RouteModule[];   // from src/server/routes.ts (T042)
//     launchToken: string;
//     ...anything passed through `serverOptions`
//   }): Promise<{ port: number; close(): Promise<void> }>;
//
// The module is loaded by a computed path so this helper type-checks before
// `http.ts` exists; a test can also pass `start` to use another server.

import { randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';

export const SESSION_COOKIE = 'prwb_session';
export const HOST = '127.0.0.1';

export interface StartedServer {
  port: number;
  close(): Promise<void>;
}

export type StartServer = (options: {
  routes: readonly unknown[];
  launchToken: string;
  [key: string]: unknown;
}) => Promise<StartedServer>;

export interface TestServerOptions {
  /** Route modules handed to the server, e.g. the context or interrogation routes. */
  routes?: readonly unknown[];
  /** Extra options passed through to `startServer` (store, logger, ui directory...). */
  serverOptions?: Record<string, unknown>;
  /** Launch token; a fresh 32-byte token by default. */
  launchToken?: string;
  /** Skip the `/api/auth` exchange (guard tests that check the unauthenticated path). */
  authenticate?: boolean;
  /** Server to start instead of `src/server/http.ts`. */
  start?: StartServer;
}

export interface RequestOptions {
  /** JSON-encoded unless a string or Buffer. */
  body?: unknown;
  /** Extra headers; override the defaults below. */
  headers?: Record<string, string>;
  /** Send the session cookie (default true, once authenticated). */
  cookie?: boolean;
  /** Cookie value to send instead of the session token. */
  cookieValue?: string;
  /** `Host` to send; defaults to `127.0.0.1:<port>`. */
  host?: string;
  /** `Origin` to send; defaults to the server origin, `null` sends none. */
  origin?: string | null;
}

export interface TestResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  /** The body parsed as JSON, or undefined when it is empty or not JSON. */
  json: unknown;
}

export interface TestClient {
  readonly port: number;
  readonly origin: string;
  readonly launchToken: string;
  /** The session cookie set by `/api/auth`, or undefined when not authenticated. */
  cookie: string | undefined;
  request(method: string, path: string, options?: RequestOptions): Promise<TestResponse>;
  get(path: string, options?: RequestOptions): Promise<TestResponse>;
  post(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>;
  put(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>;
  delete(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>;
  /** Opens a response without reading its body, for `text/event-stream` routes. */
  open(method: string, path: string, options?: RequestOptions): Promise<IncomingMessage>;
  /** Runs the launch-token exchange and stores the cookie. */
  authenticate(): Promise<void>;
  close(): Promise<void>;
}

async function loadStartServer(): Promise<StartServer> {
  const modulePath = new URL('../../src/server/http.ts', import.meta.url).href;
  const mod = (await import(modulePath)) as { startServer?: StartServer };
  if (typeof mod.startServer !== 'function') {
    throw new Error('src/server/http.ts does not export startServer()');
  }
  return mod.startServer;
}

function encodeBody(body: unknown): { data: Buffer; json: boolean } | undefined {
  if (body === undefined) return undefined;
  if (Buffer.isBuffer(body)) return { data: body, json: false };
  if (typeof body === 'string') return { data: Buffer.from(body), json: false };
  return { data: Buffer.from(JSON.stringify(body)), json: true };
}

function readCookie(setCookie: string[] | undefined): string | undefined {
  for (const line of setCookie ?? []) {
    const first = line.split(';', 1)[0] ?? '';
    const eq = first.indexOf('=');
    if (eq > 0 && first.slice(0, eq).trim() === SESSION_COOKIE) return first.slice(eq + 1).trim();
  }
  return undefined;
}

/** Starts the server, authenticates, and returns a client. Close it in `t.after`. */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestClient> {
  const start = options.start ?? (await loadStartServer());
  const launchToken = options.launchToken ?? randomBytes(32).toString('base64url');
  const server = await start({
    ...options.serverOptions,
    routes: options.routes ?? [],
    launchToken,
  });
  const { port } = server;
  const origin = `http://${HOST}:${port}`;

  const open = (method: string, path: string, o: RequestOptions = {}): Promise<IncomingMessage> => {
    const headers: Record<string, string> = { host: o.host ?? `${HOST}:${port}` };
    const sendOrigin = o.origin === undefined ? origin : o.origin;
    if (sendOrigin !== null) headers['origin'] = sendOrigin;
    const cookieValue = o.cookieValue ?? (o.cookie === false ? undefined : client.cookie);
    if (cookieValue !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${cookieValue}`;
    const body = encodeBody(o.body);
    if (body) {
      if (body.json) headers['content-type'] = 'application/json';
      headers['content-length'] = String(body.data.length);
    }
    Object.assign(headers, o.headers);
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: HOST, port, method, path, headers, agent: false }, resolve);
      req.on('error', reject);
      req.end(body?.data);
    });
  };

  const request = async (method: string, path: string, o?: RequestOptions): Promise<TestResponse> => {
    const res = await open(method, path, o);
    const chunks: Buffer[] = [];
    for await (const chunk of res) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    let json: unknown;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    return { status: res.statusCode ?? 0, headers: res.headers, text, json };
  };

  const client: TestClient = {
    port,
    origin,
    launchToken,
    cookie: undefined,
    request,
    open,
    get: (path, o) => request('GET', path, o),
    post: (path, body, o) => request('POST', path, { ...o, body }),
    put: (path, body, o) => request('PUT', path, { ...o, body }),
    delete: (path, body, o) => request('DELETE', path, { ...o, body }),
    async authenticate() {
      const res = await request('POST', '/api/auth', { body: { token: launchToken }, cookie: false });
      if (res.status !== 204) {
        throw new Error(`/api/auth exchange failed with ${res.status}: ${res.text}`);
      }
      const cookie = readCookie(res.headers['set-cookie']);
      if (cookie === undefined) throw new Error(`/api/auth did not set ${SESSION_COOKIE}`);
      client.cookie = cookie;
    },
    close: () => server.close(),
  };

  if (options.authenticate !== false) {
    try {
      await client.authenticate();
    } catch (error) {
      await server.close();
      throw error;
    }
  }
  return client;
}
