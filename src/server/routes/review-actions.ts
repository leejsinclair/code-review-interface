// Review-action routes (feature 005, contracts/http.md): one POST performs one action at once; the two GETs
// read the comments and the reviewer's own decision. There is no preview, confirm or drafts route, and no
// route merges, declines or closes (FR-012). GET handlers hold the reader only; the POST is behind the write
// view, so the Origin check covers it (X.5). Bodies reject every field the contract does not name.

import type { ReviewActionBody, ReviewCommentItem, ReviewDecisionState, ReviewAction } from '../../contracts/http.ts';
import type { Anchor } from '../../contracts/source-control-writer.ts';
import { ReviewActionError, type ReviewActions } from '../../core/review-actions.ts';
import { defineRoutes, HttpError, type RouteContext, type RouteModule } from '../routes.ts';

export type ReviewActionsRouteDeps = { actionsFor: (sessionId: string) => Promise<ReviewActions> };

export interface ReviewActionsReader {
  comments(sessionId: string): Promise<ReviewCommentItem[]>;
  decision(sessionId: string): Promise<ReviewDecisionState>;
}
export interface ReviewActionsWriter {
  perform(sessionId: string, body: ReviewActionBody): ReturnType<ReviewActions['perform']>;
}
type Views = { reader: ReviewActionsReader; writer: ReviewActionsWriter | null };

const MAX_TEXT = 65_536;
const MAX_ID = 256;
const MAX_PATH = 4096;
const invalid = (message: string): HttpError => new HttpError('invalid_body', message);

function object(value: unknown, what: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${what} must be a JSON object.`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw invalid(`${what} has an unknown field: ${key}.`);
  return record;
}
function text(o: Record<string, unknown>, key: string, optional = false, max = MAX_TEXT): string | undefined {
  const v = o[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string') throw invalid(`${key} must be a string.`);
  if (v.length > max) throw invalid(`${key} is too long.`);
  return v;
}
function int(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw invalid(`${key} must be an integer.`);
  return v;
}

function parseAnchor(value: unknown): Anchor {
  const o = object(value, 'The anchor', ['path', 'side', 'startLine', 'endLine', 'commit']);
  const side = o['side'];
  if (side !== 'base' && side !== 'head') throw invalid('side must be base or head.');
  return { path: text(o, 'path', false, MAX_PATH)!, side, startLine: int(o, 'startLine'), endLine: int(o, 'endLine'), commit: text(o, 'commit', false, MAX_ID)! };
}

const COMMENT_FIELDS = ['kind', 'destination', 'body', 'anchor', 'threadId', 'commentId'] as const;

export function parseReviewAction(value: unknown): ReviewAction {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid('The action must be a JSON object.');
  const kind = (value as Record<string, unknown>)['kind'];
  switch (kind) {
    case 'approve': {
      const o = object(value, 'The action', ['kind', 'body']);
      const body = text(o, 'body', true);
      return body === undefined ? { kind } : { kind, body };
    }
    case 'request_changes': {
      const o = object(value, 'The action', ['kind', 'body']);
      return { kind, body: text(o, 'body')! };
    }
    case 'withdraw_decision':
      object(value, 'The action', ['kind']);
      return { kind };
    case 'comment': {
      const o = object(value, 'The action', COMMENT_FIELDS);
      const destination = o['destination'];
      if (destination !== 'pull_request' && destination !== 'line' && destination !== 'reply' && destination !== 'edit' && destination !== 'delete') {
        throw invalid('destination must be pull_request, line, reply, edit or delete.');
      }
      const body = text(o, 'body', true);
      const threadId = text(o, 'threadId', true, MAX_ID);
      const commentId = text(o, 'commentId', true, MAX_ID);
      return {
        kind,
        destination,
        ...(body === undefined ? {} : { body }),
        ...(o['anchor'] === undefined ? {} : { anchor: parseAnchor(o['anchor']) }),
        ...(threadId === undefined ? {} : { threadId }),
        ...(commentId === undefined ? {} : { commentId }),
      };
    }
    default:
      throw invalid('kind must be comment, approve, request_changes or withdraw_decision.');
  }
}

export function parseReviewActionBody(value: unknown): ReviewActionBody {
  const o = object(value, 'The request', ['action', 'expectedHead', 'requestId']);
  return { action: parseReviewAction(o['action']), expectedHead: text(o, 'expectedHead', false, MAX_ID)!, requestId: text(o, 'requestId', false, MAX_ID)! };
}

async function mapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReviewActionError) {
      throw new HttpError(error.code, error.message, error.platformMessage === undefined ? {} : { platformMessage: error.platformMessage });
    }
    throw error;
  }
}

export function createReviewActionsRoutes(deps: ReviewActionsRouteDeps): RouteModule<Views> {
  const forSession = async (sessionId: string): Promise<ReviewActions> => {
    try {
      return await deps.actionsFor(sessionId);
    } catch {
      throw new HttpError('not_found', 'No such session.');
    }
  };
  const reader: ReviewActionsReader = {
    comments: (id) => mapped(async () => (await forSession(id)).comments()),
    decision: (id) => mapped(async () => (await forSession(id)).decision()),
  };
  const writer: ReviewActionsWriter = { perform: (id, body) => mapped(async () => (await forSession(id)).perform(body)) };
  const sessionId = (ctx: RouteContext<Views>): string => ctx.params['sessionId'] ?? '';

  return defineRoutes<Views>(
    [
      { method: 'GET', pattern: '/api/sessions/:sessionId/review-actions/comments', handler: async (ctx) => ({ comments: await ctx.deps.reader.comments(sessionId(ctx)) }) },
      { method: 'GET', pattern: '/api/sessions/:sessionId/review-actions/decision', handler: (ctx) => ctx.deps.reader.decision(sessionId(ctx)) },
      {
        method: 'POST',
        pattern: '/api/sessions/:sessionId/review-actions',
        handler: async (ctx) => {
          const body = parseReviewActionBody(ctx.body);
          if (ctx.deps.writer === null) throw new HttpError('not_found', 'No such route.');
          ctx.json(await ctx.deps.writer.perform(sessionId(ctx), body), 200);
        },
      },
    ],
    { read: { reader, writer: null }, write: { reader, writer } },
  );
}
