// Risk routes (specs/004-risk-review-focus/contracts/http-api.md): the snapshot's risk report, the reviewer the
// platform would record, a file's override history and the override POST. Same guard and conventions as every
// other module: GET handlers hold the reader only; the POST is behind the write view, so the Origin check covers
// it (X.5). There is no PUT, PATCH or DELETE and no listing across files or by reviewer (FR-021, FR-025).

import type { OverrideBody, OverrideHistory, OverrideRecord, RiskReport, RiskReviewer } from '../../contracts/http.ts';
import { RiskError, type RiskService } from '../../core/risk-service.ts';
import { defineRoutes, HttpError, requireEnum, requireObject, requireString, type RouteContext, type RouteModule } from '../routes.ts';

export type RiskRouteDeps = { risk: RiskService };

export interface RiskReader {
  report(sessionId: string, snapshotId: string): RiskReport;
  reviewer(sessionId: string): Promise<RiskReviewer>;
  history(sessionId: string, path: string): OverrideHistory;
}

export interface RiskWriter {
  override(sessionId: string, body: OverrideBody): Promise<OverrideRecord>;
}

type Views = { reader: RiskReader; writer: RiskWriter | null };

const CLASSES = ['low', 'normal', 'elevated', 'critical'] as const;
const MAX_PATH = 4096;
const MAX_SNAPSHOT = 64;
/** The service trims and limits the reason itself; the boundary only bounds what it will read. */
const MAX_REASON_READ = 20_000;

/** Validates the override body at the boundary: exactly these four fields, so a `reviewer` is refused. */
export function parseOverrideBody(value: unknown): OverrideBody {
  const raw = requireObject(value, 'The override', ['snapshotId', 'path', 'class', 'reason'], 'unknown_field');
  return {
    snapshotId: requireString(raw, 'snapshotId', { maxLength: MAX_SNAPSHOT }),
    path: requireString(raw, 'path', { maxLength: MAX_PATH }),
    class: requireEnum(raw, 'class', CLASSES),
    reason: requireString(raw, 'reason', { allowEmpty: true, maxLength: MAX_REASON_READ }),
  };
}

/** The service's refusals as the contract's error codes. */
async function mapped<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RiskError) throw new HttpError(error.code, error.message, error.platform === undefined ? {} : { platform: error.platform });
    throw error;
  }
}

export function createRiskRoutes(deps: RiskRouteDeps): RouteModule<Views> {
  const { risk } = deps;

  const reader: RiskReader = {
    report(sessionId, snapshotId) {
      const report = risk.getReport(sessionId, snapshotId);
      if (report === null) throw new HttpError('not_found', 'No such snapshot.');
      return report;
    },
    reviewer: (sessionId) => mapped(() => risk.currentReviewer(sessionId)),
    history: (sessionId, path) => ({ records: risk.overrideHistory(sessionId, path) }),
  };
  const writer: RiskWriter = { override: (sessionId, body) => mapped(() => risk.createOverride(sessionId, body)) };

  const sessionId = (ctx: RouteContext<Views>): string => ctx.params['sessionId'] ?? '';
  const snapshotId = (ctx: RouteContext<Views>): string => ctx.params['snapshotId'] ?? '';
  const queryPath = (ctx: RouteContext<Views>): string => {
    const value = ctx.query.get('path');
    if (value === null || value === '') throw new HttpError('invalid_request', 'path is required.');
    if (value.length > MAX_PATH) throw new HttpError('invalid_request', 'path is too long.');
    return value;
  };

  return defineRoutes<Views>(
    [
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/snapshots/:snapshotId/risk',
        handler: (ctx) => mapped(() => ctx.deps.reader.report(sessionId(ctx), snapshotId(ctx))),
      },
      { method: 'GET', pattern: '/api/sessions/:sessionId/risk/reviewer', handler: (ctx) => ctx.deps.reader.reviewer(sessionId(ctx)) },
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/risk/overrides',
        handler: (ctx) => mapped(() => ctx.deps.reader.history(sessionId(ctx), queryPath(ctx))),
      },
      {
        method: 'POST',
        pattern: '/api/sessions/:sessionId/risk/overrides',
        handler: async (ctx) => {
          const body = parseOverrideBody(ctx.body);
          if (ctx.deps.writer === null) throw new HttpError('not_found', 'No such route.');
          ctx.json(await ctx.deps.writer.override(sessionId(ctx), body), 201);
        },
      },
    ],
    { read: { reader, writer: null }, write: { reader, writer } },
  );
}
