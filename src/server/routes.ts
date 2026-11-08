// Router for the local HTTP API (research R2, contracts/http-api.md section 2).
//
// Route modules are plain lists of `{ method, pattern, handler }`; patterns use
// `:name` segments (`/api/sessions/:sessionId/snapshots/:snapshotId`). The router
// matches the path, parses a size-capped JSON body on non-GET requests, and calls
// the handler with the params, query and body. Every refusal is an `ErrorBody`
// with the status of its `ErrorCode`; an unknown route is `404 not_found`.
//
// GET never changes state (X.5): a module's dependencies come in two views, and
// the router hands a GET handler the read view and every other method the write
// view, so a GET handler never holds anything that can write.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ERROR_STATUS, type ErrorBody, type ErrorCode } from '../contracts/http.ts';

// ---------------------------------------------------------------- errors

/** A refusal with a contract error code; the router turns it into an `ErrorBody`. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly platform: string | undefined;

  constructor(code: ErrorCode, message: string, options: { platform?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HttpError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.platform = options.platform;
  }
}

/** Code sent with a 500 for an error no handler expected. Not an `ErrorCode`. */
export const INTERNAL_ERROR_CODE = 'internal_error';

// The error code each response was sent with, for the request log.
const sentErrorCodes = new WeakMap<ServerResponse, string>();

/** The error code `res` was answered with, if it was an error response. */
export function errorCodeOf(res: ServerResponse): string | undefined {
  return sentErrorCodes.get(res);
}

// ---------------------------------------------------------------- responses

/** Writes `body` as JSON with `status`; never cached. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body) ?? 'null', 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(data);
}

/** Ends `res` with `204 No Content`. */
export function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/** Writes the `ErrorBody` for `error`. A response already started is cut off instead. */
export function sendError(res: ServerResponse, error: HttpError): void {
  sentErrorCodes.set(res, error.code);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body: ErrorBody = { error: { code: error.code, message: error.message } };
  if (error.platform !== undefined) body.error.platform = error.platform;
  sendJson(res, error.status, body);
}

/** Answers an unexpected failure with a 500 whose message reveals nothing. */
export function sendInternalError(res: ServerResponse): void {
  sentErrorCodes.set(res, INTERNAL_ERROR_CODE);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, 500, { error: { code: INTERNAL_ERROR_CODE, message: 'The workbench hit an unexpected error.' } });
}

// ---------------------------------------------------------------- request URL and body

export interface RequestTarget {
  pathname: string;
  query: URLSearchParams;
}

/**
 * Splits an origin-form request target (`/path?query`). Anything else, such as
 * an absolute-form target, returns null.
 */
export function splitTarget(url: string | undefined): RequestTarget | null {
  if (url === undefined || !url.startsWith('/') || url.startsWith('//')) return null;
  const hash = url.indexOf('#');
  const target = hash === -1 ? url : url.slice(0, hash);
  const q = target.indexOf('?');
  return {
    pathname: q === -1 ? target : target.slice(0, q),
    query: new URLSearchParams(q === -1 ? '' : target.slice(q + 1)),
  };
}

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

function isJsonMediaType(header: string | undefined): boolean {
  const type = (header ?? '').split(';', 1)[0]?.trim().toLowerCase();
  return type === 'application/json';
}

/**
 * Reads a JSON request body of at most `maxBytes`. An empty body is `undefined`.
 * A non-empty body must be `application/json` and valid JSON, else 400.
 */
export function readJsonBody(req: IncomingMessage, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<unknown> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    req.resume();
    return Promise.reject(new HttpError('invalid_request', `The request body is larger than ${maxBytes} bytes.`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      req.resume(); // discard the rest so the response can still be written
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpError('invalid_request', `The request body is larger than ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (size === 0) {
        resolve(undefined);
        return;
      }
      if (!isJsonMediaType(req.headers['content-type'])) {
        reject(new HttpError('invalid_request', 'The request body must be application/json.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError('invalid_request', 'The request body is not valid JSON.'));
      }
    };
    const onError = (error: unknown): void => fail(error);
    const cleanup = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

// ---------------------------------------------------------------- boundary validation
//
// Messages name the field, never echo the value (it may be a secret).

/** `value` as a plain object; with `knownKeys`, any other key is refused with `unknownCode`. */
export function requireObject(
  value: unknown,
  what: string,
  knownKeys?: readonly string[],
  unknownCode: 'invalid_request' | 'unknown_field' = 'invalid_request',
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError('invalid_request', `${what} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  if (knownKeys !== undefined) {
    for (const key of Object.keys(record)) {
      if (!knownKeys.includes(key)) throw new HttpError(unknownCode, `${what} has an unknown field: ${key}.`);
    }
  }
  return record;
}

export interface StringRule {
  /** Accept the empty string (default false). */
  allowEmpty?: boolean;
  maxLength?: number;
}

/** `obj[key]` as a string. */
export function requireString(obj: Record<string, unknown>, key: string, rule: StringRule = {}): string {
  const value = obj[key];
  if (typeof value !== 'string') throw new HttpError('invalid_request', `${key} must be a string.`);
  if (!rule.allowEmpty && value.length === 0) throw new HttpError('invalid_request', `${key} must not be empty.`);
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    throw new HttpError('invalid_request', `${key} must be at most ${rule.maxLength} characters.`);
  }
  return value;
}

/** `obj[key]` as a string, or undefined when absent. */
export function optionalString(obj: Record<string, unknown>, key: string, rule: StringRule = {}): string | undefined {
  return obj[key] === undefined ? undefined : requireString(obj, key, rule);
}

/** `obj[key]` as a positive safe integer. */
export function requirePositiveInt(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpError('invalid_request', `${key} must be a positive integer.`);
  }
  return value;
}

/** `obj[key]` as a boolean. */
export function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') throw new HttpError('invalid_request', `${key} must be true or false.`);
  return value;
}

/** `obj[key]` as one of `members`. */
export function requireEnum<T extends string>(obj: Record<string, unknown>, key: string, members: readonly T[]): T {
  const value = obj[key];
  if (typeof value !== 'string' || !(members as readonly string[]).includes(value)) {
    throw new HttpError('invalid_request', `${key} must be one of: ${members.join(', ')}.`);
  }
  return value as T;
}

/** A path parameter or query value written in decimal, as a positive safe integer. */
export function parsePositiveInt(text: string | null | undefined, what: string): number {
  const value = text !== null && text !== undefined && /^[1-9]\d{0,15}$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value)) throw new HttpError('invalid_request', `${what} must be a positive integer.`);
  return value;
}

// ---------------------------------------------------------------- routes

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContext<D = unknown> {
  method: HttpMethod;
  /** The matched pattern, e.g. `/api/sessions/:sessionId`. */
  pattern: string;
  /** Decoded `:name` segments. */
  params: Readonly<Record<string, string>>;
  query: URLSearchParams;
  /** The parsed JSON body; always undefined on GET. */
  body: unknown;
  /** True on GET: `deps` is the module's read-only view. */
  readOnly: boolean;
  /** The module's `deps.read` on GET, `deps.write` otherwise (undefined when the module has none). */
  deps: D;
  req: IncomingMessage;
  res: ServerResponse;
  /** Sends a JSON response (default status 200). */
  json(body: unknown, status?: number): void;
  /** Sends 204. */
  noContent(): void;
}

/**
 * A handler either sends through `ctx` (or takes over `ctx.res`, as an event
 * stream does) or returns a value: a returned value is sent as 200 JSON, and
 * returning nothing without sending sends 204. Throw `HttpError` to refuse.
 */
export type RouteHandler<D = unknown> = (ctx: RouteContext<D>) => unknown;

export interface Route<D = unknown> {
  method: HttpMethod;
  pattern: string;
  handler: RouteHandler<D>;
  /** Body cap for this route; default `DEFAULT_MAX_BODY_BYTES`. */
  maxBodyBytes?: number;
}

/**
 * A group of routes and the dependencies they share. The composition root
 * supplies `deps.read` (read-only store view) for GET handlers and `deps.write`
 * for the others.
 */
export interface RouteModule<D = unknown> {
  readonly routes: readonly Route<D>[];
  readonly deps?: { readonly read: D; readonly write: D };
}

// Modules differ in their deps type; the router only passes them through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouteModule = RouteModule<any>;

/** Builds a `RouteModule`; `deps` is optional for modules that need none. */
export function defineRoutes<D>(routes: readonly Route<D>[], deps?: { read: D; write: D }): RouteModule<D> {
  return deps === undefined ? { routes } : { routes, deps };
}

interface CompiledRoute {
  route: Route<unknown>;
  module: RouteModule<unknown>;
  segments: readonly string[];
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').slice(1);
}

function compile(pattern: string): string[] {
  if (!pattern.startsWith('/')) throw new Error(`route pattern must start with "/": ${pattern}`);
  const segments = splitPath(pattern);
  const names = new Set<string>();
  for (const segment of segments) {
    if (!segment.startsWith(':')) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(name)) {
      throw new Error(`bad parameter "${segment}" in route pattern ${pattern}`);
    }
    names.add(name);
  }
  return segments;
}

/** Matches `pathname` against compiled `segments`; returns the decoded params. */
function matchSegments(segments: readonly string[], pathname: string): Record<string, string> | null {
  const parts = splitPath(pathname);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as string;
    const part = parts[i] as string;
    if (segment.startsWith(':')) {
      if (part.length === 0) return null;
      let decoded: string;
      try {
        decoded = decodeURIComponent(part);
      } catch {
        return null;
      }
      params[segment.slice(1)] = decoded;
    } else if (segment !== part) {
      return null;
    }
  }
  return params;
}

export interface RouteMatch {
  route: Route<unknown>;
  module: RouteModule<unknown>;
  params: Record<string, string>;
}

export interface Router {
  /** The route for `method` and `pathname`, or null. */
  match(method: string, pathname: string): RouteMatch | null;
  /**
   * Answers the request: 404 when no route matches, else the handler's response.
   * Resolves with the matched pattern (null when none) for the request log.
   */
  handle(req: IncomingMessage, res: ServerResponse, target: RequestTarget): Promise<string | null>;
}

export function createRouter(modules: readonly AnyRouteModule[]): Router {
  const table: CompiledRoute[] = [];
  const seen = new Set<string>();
  for (const module of modules as readonly RouteModule<unknown>[]) {
    for (const route of module.routes) {
      const segments = compile(route.pattern);
      const key = `${route.method} ${segments.map((s) => (s.startsWith(':') ? ':' : s)).join('/')}`;
      if (seen.has(key)) throw new Error(`duplicate route: ${route.method} ${route.pattern}`);
      seen.add(key);
      table.push({ route, module, segments });
    }
  }
  // Literal segments win over parameters at the same position.
  const literalRank = (segments: readonly string[]): string =>
    segments.map((s) => (s.startsWith(':') ? '1' : '0')).join('');
  table.sort((a, b) => {
    const ra = literalRank(a.segments);
    const rb = literalRank(b.segments);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });

  const match = (method: string, pathname: string): RouteMatch | null => {
    for (const entry of table) {
      if (entry.route.method !== method) continue;
      const params = matchSegments(entry.segments, pathname);
      if (params !== null) return { route: entry.route, module: entry.module, params };
    }
    return null;
  };

  return {
    match,
    async handle(req, res, target) {
      const method = req.method ?? '';
      const found = match(method, target.pathname);
      if (found === null) {
        sendError(res, new HttpError('not_found', 'No such route.'));
        return null;
      }
      const { route, module, params } = found;
      try {
        const readOnly = route.method === 'GET';
        const body = readOnly ? undefined : await readJsonBody(req, route.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        const ctx: RouteContext<unknown> = {
          method: route.method,
          pattern: route.pattern,
          params: Object.freeze(params),
          query: target.query,
          body,
          readOnly,
          deps: readOnly ? module.deps?.read : module.deps?.write,
          req,
          res,
          json: (value, status = 200) => sendJson(res, status, value),
          noContent: () => sendNoContent(res),
        };
        const result = await route.handler(ctx);
        if (!res.headersSent && !res.writableEnded) {
          if (result === undefined) sendNoContent(res);
          else sendJson(res, 200, result);
        }
      } catch (error) {
        if (error instanceof HttpError) sendError(res, error);
        else sendInternalError(res);
      }
      return route.pattern;
    },
  };
}
