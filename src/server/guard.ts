// Request guard (constitution X.1 to X.5, research R3, contracts/http-api.md section 1).
//
// Runs before anything else on every request, in this order:
//   1. security headers on the response (CSP, nosniff, no-referrer; never CORS);
//   2. Host must be exactly `127.0.0.1:<port>`             -> 421 bad_host;
//   3. Origin, when present, must be the server origin, and
//      every non-GET must carry one                        -> 403 bad_origin;
//   4. the `prwb_session` cookie must equal the launch token, compared in
//      constant time, except on GET /launch, GET /launch.js and POST /api/auth
//                                                          -> 401 unauthenticated;
//   5. POST /api/auth exchanges the token in its body for the cookie.
// Only the three bootstrap routes skip step 4 (plan.md Complexity Tracking, X.2).

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJsonBody, requireObject, sendError, splitTarget } from './routes.ts';

export const SESSION_COOKIE = 'prwb_session';
export const AUTH_PATH = '/api/auth';

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

/** The routes reached without the session cookie (X.2). */
export const COOKIE_EXEMPT: readonly { method: string; path: string }[] = Object.freeze([
  { method: 'GET', path: '/launch' },
  { method: 'GET', path: '/launch.js' },
  { method: 'POST', path: AUTH_PATH },
]);

const AUTH_BODY_MAX_BYTES = 4_096;

/**
 * Sets the security headers on `res` and makes it refuse any `Access-Control-*`
 * header afterwards, so no code path can answer a cross-origin request.
 */
export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    name.toLowerCase().startsWith('access-control-') ? res : setHeader(name, value)) as ServerResponse['setHeader'];
}

/** Constant-time string equality; inputs of different lengths take the same time. */
export function tokensEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

/** The value of the first `name` cookie in a `Cookie` header, or undefined. */
export function readCookie(header: string | undefined, name: string = SESSION_COOKIE): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

export interface GuardOptions {
  launchToken: string;
  /** The port the server listens on; Host and Origin are checked against it. */
  port: number;
}

/**
 * `pass`: the request may go on to the static files and the router.
 * `handled`: the guard answered it; `op` names what it did, for the request log
 * (a fixed label, never the URL).
 */
export type GuardResult = { kind: 'pass' } | { kind: 'handled'; op: string };

export type Guard = (req: IncomingMessage, res: ServerResponse) => Promise<GuardResult>;

export function createGuard(options: GuardOptions): Guard {
  const { launchToken, port } = options;
  if (typeof launchToken !== 'string' || launchToken.length === 0) throw new Error('launchToken must be a non-empty string');
  const expectedHost = `127.0.0.1:${port}`;
  const expectedOrigin = `http://${expectedHost}`;

  const refuse = (res: ServerResponse, op: string, error: HttpError): GuardResult => {
    sendError(res, error);
    return { kind: 'handled', op };
  };

  return async (req, res) => {
    applySecurityHeaders(res);
    const method = req.method ?? '';

    if (req.headers.host !== expectedHost) {
      return refuse(res, 'guard host', new HttpError('bad_host', 'This server only answers requests for its own address.'));
    }

    const origin = req.headers.origin;
    if (origin !== undefined ? origin !== expectedOrigin : method !== 'GET') {
      return refuse(
        res,
        'guard origin',
        new HttpError('bad_origin', origin === undefined ? 'This request must carry an Origin header.' : 'Cross-origin requests are refused.'),
      );
    }

    const target = splitTarget(req.url);
    const pathname = target?.pathname;
    const exempt = COOKIE_EXEMPT.some((r) => r.method === method && r.path === pathname);
    if (!exempt) {
      const cookie = readCookie(req.headers.cookie);
      if (cookie === undefined || !tokensEqual(cookie, launchToken)) {
        return refuse(res, 'guard cookie', new HttpError('unauthenticated', 'Open the workbench from the link printed in the terminal.'));
      }
    }

    if (method === 'POST' && pathname === AUTH_PATH) {
      const op = `POST ${AUTH_PATH}`;
      try {
        const body = requireObject(await readJsonBody(req, AUTH_BODY_MAX_BYTES), 'The request body');
        const token = body['token'];
        if (typeof token !== 'string' || token.length === 0) {
          return refuse(res, op, new HttpError('invalid_request', 'token must be a non-empty string.'));
        }
        if (!tokensEqual(token, launchToken)) {
          return refuse(res, op, new HttpError('unauthenticated', 'This launch link is not valid for the running workbench.'));
        }
      } catch (error) {
        return refuse(res, op, error instanceof HttpError ? error : new HttpError('invalid_request', 'The request body could not be read.'));
      }
      res.statusCode = 204;
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${launchToken}; HttpOnly; SameSite=Strict; Path=/`);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return { kind: 'handled', op };
    }

    return { kind: 'pass' };
  };
}
