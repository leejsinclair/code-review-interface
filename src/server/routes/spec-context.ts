// Specification context routes (specs/006-spec-context/contracts/http-api.md): the snapshot's report, a stored
// document's text and the retry POST. GET handlers hold the reader only; the POST is behind the write view, so
// the Origin check covers it (X.5). Document text is served as text/plain with nosniff, never as HTML (FR-008).

import type { SpecContextReport, SpecContextRetryResult } from '../../contracts/http.ts';
import { SpecContextError, type SpecContextService } from '../../core/spec-context.ts';
import { defineRoutes, HttpError, requireObject, type RouteContext, type RouteModule } from '../routes.ts';

export type SpecContextRouteDeps = { specContext: SpecContextService };

export interface SpecContextReader {
  report(sessionId: string, snapshotId: string): Promise<SpecContextReport>;
  document(sessionId: string, snapshotId: string, documentId: string): string;
}

export interface SpecContextWriter {
  retry(sessionId: string, snapshotId: string): Promise<SpecContextRetryResult>;
}

type Views = { reader: SpecContextReader; writer: SpecContextWriter | null };

/** The service's refusals as the contract's error codes. */
async function mapped<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SpecContextError) throw new HttpError(error.code, error.message);
    throw error;
  }
}

export function createSpecContextRoutes(deps: SpecContextRouteDeps): RouteModule<Views> {
  const { specContext } = deps;

  const reader: SpecContextReader = {
    report: (sessionId, snapshotId) => mapped(() => specContext.report(sessionId, snapshotId)),
    document(sessionId, snapshotId, documentId) {
      const found = specContext.document(sessionId, snapshotId, documentId);
      if (found === null) throw new HttpError('not_found', 'No such document.');
      return found.text;
    },
  };
  const writer: SpecContextWriter = { retry: (sessionId, snapshotId) => mapped(() => specContext.retry(sessionId, snapshotId)) };

  const param = (ctx: RouteContext<Views>, name: string): string => ctx.params[name] ?? '';
  const base = '/api/sessions/:sessionId/snapshots/:snapshotId/spec-context';

  return defineRoutes<Views>(
    [
      { method: 'GET', pattern: base, handler: (ctx) => ctx.deps.reader.report(param(ctx, 'sessionId'), param(ctx, 'snapshotId')) },
      {
        method: 'GET',
        pattern: `${base}/documents/:documentId`,
        handler: async (ctx) => {
          const text = await mapped(() => ctx.deps.reader.document(param(ctx, 'sessionId'), param(ctx, 'snapshotId'), param(ctx, 'documentId')));
          const data = Buffer.from(text, 'utf8');
          ctx.res.statusCode = 200;
          ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
          ctx.res.setHeader('Content-Length', String(data.length));
          ctx.res.setHeader('Cache-Control', 'no-store');
          ctx.res.end(data);
        },
      },
      {
        method: 'POST',
        pattern: `${base}/retry`,
        handler: async (ctx) => {
          requireObject(ctx.body ?? {}, 'The retry', [], 'unknown_field');
          if (ctx.deps.writer === null) throw new HttpError('not_found', 'No such route.');
          ctx.json(await ctx.deps.writer.retry(param(ctx, 'sessionId'), param(ctx, 'snapshotId')), 202);
        },
      },
    ],
    { read: { reader, writer: null }, write: { reader, writer } },
  );
}
