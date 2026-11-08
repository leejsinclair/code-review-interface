// Local HTTP server (research R2 and R3, contracts/http-api.md section 1).
//
// Binds 127.0.0.1 on a port the OS picks (X.1). Every request goes through the
// guard first, then the static UI files (`/launch`, `/launch.js`, `/`, `/app.js`,
// `/app.css` from `dist/ui/`), then the route modules. Each request writes one
// log line naming the route pattern and the status, never the URL or headers.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appDataPaths } from '../appdata.ts';
import { createLogger, registerSecret, type Logger } from '../log.ts';
import type { EventHub } from './events.ts';
import { CONTENT_SECURITY_POLICY, createGuard, type Guard } from './guard.ts';
import {
  createRouter,
  errorCodeOf,
  HttpError,
  sendError,
  sendInternalError,
  splitTarget,
  type AnyRouteModule,
} from './routes.ts';

export const HOST = '127.0.0.1';

/** The bundled UI, `<package root>/dist/ui/`. */
export const DEFAULT_UI_DIR = fileURLToPath(new URL('../../dist/ui/', import.meta.url));

/** Static files served from the UI directory: request path -> file and type. */
export const STATIC_FILES: Readonly<Record<string, { file: string; type: string }>> = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/launch': { file: 'launch.html', type: 'text/html; charset=utf-8' },
  '/launch.js': { file: 'launch.js', type: 'text/javascript; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
});

export interface ServerOptions {
  routes: readonly AnyRouteModule[];
  /** The per-launch token (R3); registered with the log scrubber. */
  launchToken: string;
  /** Directory of the static UI files; default `DEFAULT_UI_DIR`. */
  uiDir?: string;
  /** Request logger; default a `src/log.ts` logger writing to `<app-data>/logs`. */
  logger?: Logger;
  /** Event hub used by the stream routes; closed with the server. */
  events?: EventHub;
}

export interface RunningServer {
  port: number;
  /** `http://127.0.0.1:<port>` */
  origin: string;
  close(): Promise<void>;
}

async function serveStatic(res: ServerResponse, uiDir: string, entry: { file: string; type: string }): Promise<void> {
  let data: Buffer;
  try {
    data = await readFile(join(uiDir, entry.file));
  } catch {
    sendError(res, new HttpError('not_found', 'The workbench UI is not built.'));
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', entry.type);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(data);
}

// A malformed request never reaches the handler; answer it with the same headers.
const BAD_REQUEST =
  'HTTP/1.1 400 Bad Request\r\n' +
  `Content-Security-Policy: ${CONTENT_SECURITY_POLICY}\r\n` +
  'X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n' +
  'Content-Length: 0\r\nConnection: close\r\n\r\n';

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { launchToken } = options;
  if (typeof launchToken !== 'string' || launchToken.length === 0) throw new Error('launchToken must be a non-empty string');
  registerSecret(launchToken);
  const uiDir = options.uiDir ?? DEFAULT_UI_DIR;
  const logger = options.logger ?? createLogger({ dir: appDataPaths().logs });
  const router = createRouter(options.routes);
  let guard: Guard | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<string> => {
    if (guard === null) {
      res.statusCode = 503;
      res.end();
      return 'starting';
    }
    const checked = await guard(req, res);
    if (checked.kind === 'handled') return checked.op;

    const method = req.method ?? '';
    const target = splitTarget(req.url);
    if (target === null) {
      sendError(res, new HttpError('invalid_request', 'Unsupported request target.'));
      return `${method} (bad target)`;
    }
    const file = method === 'GET' ? STATIC_FILES[target.pathname] : undefined;
    if (file !== undefined) {
      await serveStatic(res, uiDir, file);
      return `${method} ${target.pathname}`;
    }
    const pattern = await router.handle(req, res, target);
    if (pattern !== null) routed.set(req, router.match(method, target.pathname)?.params ?? {});
    return `${method} ${pattern ?? '(no route)'}`;
  };

  // Session and snapshot ids of a request that passed the guard and matched a route (FR-054). Only
  // id-shaped values are kept, so a path segment can never carry text into the log.
  const routed = new WeakMap<IncomingMessage, Record<string, string>>();
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const idsOf = (req: IncomingMessage): { sessionId?: string; snapshotId?: string } => {
    const { sessionId, snapshotId } = routed.get(req) ?? {};
    return {
      ...(sessionId !== undefined && ID.test(sessionId) ? { sessionId } : {}),
      ...(snapshotId !== undefined && ID.test(snapshotId) ? { snapshotId } : {}),
    };
  };

  const server = createServer((req, res) => {
    const started = performance.now();
    const requestId = randomUUID();
    // Log once both the response has closed and the handler has named its op.
    const closed = new Promise<void>((resolve) => res.once('close', () => resolve()));
    const op = handle(req, res).catch(() => {
      sendInternalError(res);
      return `${req.method ?? ''} (failed)`;
    });
    void Promise.all([op, closed]).then(([name]) => {
      const errorCode = errorCodeOf(res);
      return logger.log({
        op: `http ${name}`,
        outcome: res.writableFinished ? String(res.statusCode) : 'aborted',
        durationMs: Math.round(performance.now() - started),
        requestId,
        ...idsOf(req),
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    });
  });
  server.on('clientError', (_error: Error, socket: Socket) => {
    if (socket.writable) socket.end(BAD_REQUEST);
    else socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  guard = createGuard({ launchToken, port });

  let closing: Promise<void> | null = null;
  return {
    port,
    origin: `http://${HOST}:${port}`,
    close() {
      closing ??= new Promise<void>((resolve) => {
        options.events?.close();
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
