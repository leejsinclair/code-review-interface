// US2 routes (contracts/http-api.md sections 4, 6, 7 and 8): the AI provider's status, summaries,
// one file's diff, a file at a snapshot's head or base commit, suggested questions, and questions.
// Dependencies come in as arguments; src/main.ts wires them (and points the context routes'
// `onSnapshot` at the same summaries). `AskBody` and its scope are validated here, at the boundary.
//
// GET handlers receive only the reader; asking and cancelling are behind POST routes (X.5).

import { RESTRICTION_IDS, type AiProvider } from '../../contracts/ai-provider.ts';
import type { AskBody, Category, FileContent, FileDiff, ProviderStatus, Question, Scope, ScopeType, Side, Suggestion, Summary } from '../../contracts/http.ts';
import { AiWorkError, patchHunks, type AiEnvironment, type Interrogation } from '../../core/interrogation.ts';
import { suggestionsFor } from '../../core/suggestions.ts';
import type { Summaries } from '../../core/summaries.ts';
import { createFileReader, isRepositoryPath } from '../../repo/files.ts';
import type { Git } from '../../repo/git.ts';
import type { ReviewStore } from '../../store/review-store.ts';
import {
  defineRoutes,
  HttpError,
  optionalString,
  requireEnum,
  requireObject,
  requirePositiveInt,
  requireString,
  type RouteContext,
  type RouteModule,
} from '../routes.ts';

export type InterrogationRouteDeps = {
  store: ReviewStore;
  git: Git;
  provider: AiProvider;
  interrogation: Interrogation;
  summaries: Summaries;
  environmentFor(repo: { platform: string; id: string }): Promise<AiEnvironment>;
};

/** What GET handlers may call: reads only. */
export interface InterrogationReader {
  provider(): Promise<ProviderStatus>;
  summaries(sessionId: string, snapshotId: string): Summary[];
  diff(sessionId: string, snapshotId: string, path: string): FileDiff;
  file(sessionId: string, snapshotId: string, side: Side, path: string): Promise<FileContent>;
  suggestions(scope: ScopeType, category?: Category): Suggestion[];
  questions(sessionId: string): Question[];
}

/** What the other methods may call. */
export interface InterrogationWriter {
  ask(sessionId: string, body: AskBody): Promise<Question>;
  cancel(sessionId: string, questionId: string): Promise<Question>;
}

type Views = { reader: InterrogationReader; writer: InterrogationWriter | null };

const CATEGORIES: readonly Category[] = ['what', 'why', 'how', 'whatif', 'risk', 'requirement'];
const SCOPE_TYPES: readonly ScopeType[] = ['pr', 'file', 'range'];
const SIDES: readonly Side[] = ['head', 'base'];
const MAX_PATH = 4096;
const MAX_TEXT = 10_000;
const MAX_LABEL = 200;

/** Validates a scope at the boundary; the service then checks it against the latest snapshot. */
function parseScope(value: unknown): Scope {
  const raw = requireObject(value, 'scope');
  const type = requireEnum(raw, 'type', SCOPE_TYPES);
  if (type === 'pr') {
    requireObject(value, 'scope', ['type']);
    return { type };
  }
  if (type === 'file') {
    requireObject(value, 'scope', ['type', 'path']);
    return { type, path: requireString(raw, 'path', { maxLength: MAX_PATH }) };
  }
  requireObject(value, 'scope', ['type', 'path', 'side', 'startLine', 'endLine', 'label']);
  const scope: Scope = {
    type,
    path: requireString(raw, 'path', { maxLength: MAX_PATH }),
    side: requireEnum(raw, 'side', SIDES),
    startLine: requirePositiveInt(raw, 'startLine'),
    endLine: requirePositiveInt(raw, 'endLine'),
  };
  if (scope.startLine > scope.endLine) throw new HttpError('invalid_request', 'startLine must not be after endLine.');
  const label = optionalString(raw, 'label', { allowEmpty: true, maxLength: MAX_LABEL });
  if (label !== undefined) scope.label = label;
  return scope;
}

export function parseAskBody(value: unknown): AskBody {
  const raw = requireObject(value, 'The question', ['scope', 'category', 'text', 'answerFor', 'followsQuestionId']);
  const text = requireString(raw, 'text', { maxLength: MAX_TEXT });
  if (text.trim() === '') throw new HttpError('invalid_request', 'text must not be empty.');
  const body: AskBody = { scope: parseScope(raw['scope']), category: requireEnum(raw, 'category', CATEGORIES), text };
  if (raw['answerFor'] !== undefined) body.answerFor = requireEnum(raw, 'answerFor', ['technical', 'business'] as const);
  const follows = optionalString(raw, 'followsQuestionId', { maxLength: 64 });
  if (follows !== undefined) body.followsQuestionId = follows;
  return body;
}

export function createInterrogationRoutes(deps: InterrogationRouteDeps): RouteModule<Views> {
  const { store } = deps;

  const requireSnapshot = (sessionId: string, snapshotId: string) => {
    const snapshot = store.readSnapshot(snapshotId);
    if (snapshot === null || snapshot.sessionId !== sessionId) throw new HttpError('not_found', 'No such snapshot.');
    return snapshot;
  };

  const mapped = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AiWorkError) throw new HttpError(error.code, error.message);
      throw error;
    }
  };

  const reader: InterrogationReader = {
    async provider() {
      const caps = await deps.provider.capabilities();
      const status: ProviderStatus = {
        id: deps.provider.id,
        installed: caps.installed,
        available: caps.unavailableReason === undefined,
        restrictionsNotEnforced: caps.installed ? RESTRICTION_IDS.filter((id) => !caps.restrictionsEnforced[id]) : [],
      };
      if (caps.unavailableReason !== undefined) status.unavailableReason = caps.unavailableReason;
      return status;
    },
    summaries: (sessionId, snapshotId) => deps.summaries.list(sessionId, snapshotId),
    diff(sessionId, snapshotId, path) {
      requireSnapshot(sessionId, snapshotId);
      const file = store.readChangedFile(snapshotId, path);
      if (file === null) throw new HttpError('not_found', 'No such changed file in the snapshot.');
      const out: FileDiff = {
        path: file.path,
        status: file.status,
        linesAdded: file.additions,
        linesRemoved: file.deletions,
        binary: file.binary,
        hunks: file.binary ? [] : patchHunks(file.patch),
      };
      if (file.oldPath !== null) out.previousPath = file.oldPath;
      return out;
    },
    async file(sessionId, snapshotId, side, path) {
      const snapshot = requireSnapshot(sessionId, snapshotId);
      if (!isRepositoryPath(path)) throw new HttpError('invalid_request', 'path must be a repository-relative path.');
      const commit = side === 'head' ? snapshot.headCommit : snapshot.baseCommit;
      if (commit === null) throw new HttpError('not_found', 'The snapshot has no base commit (its diff came from the platform).');
      const session = store.readSession(sessionId);
      const env = await deps.environmentFor({ platform: session?.pr.repo.platform ?? '', id: session?.pr.repo.identifier ?? '' });
      // Reading stays available whatever the repository's availability, but file content comes from the clone.
      if (env.clonePath === null) throw new HttpError('not_found', env.unavailableReason ?? 'The repository is not found under the base folder.');
      const found = await createFileReader(deps.git, env.clonePath).read(commit, path);
      if (found.status === 'not_found') throw new HttpError('not_found', 'The file, or its commit, is not in the local clone.');
      return { path, side, commit, lines: found.lines };
    },
    suggestions: (scope, category) => suggestionsFor(scope, category),
    questions(sessionId) {
      if (store.readSession(sessionId) === null) throw new HttpError('not_found', 'No such session.');
      return deps.interrogation.list(sessionId);
    },
  };

  const writer: InterrogationWriter = {
    ask: (sessionId, body) => deps.interrogation.ask(sessionId, body),
    cancel: (sessionId, questionId) => deps.interrogation.cancel(sessionId, questionId),
  };

  const write = (ctx: RouteContext<Views>): InterrogationWriter => {
    if (ctx.deps.writer === null) throw new HttpError('not_found', 'No such route.');
    return ctx.deps.writer;
  };
  const id = (ctx: RouteContext<Views>): string => ctx.params['sessionId'] ?? '';
  const snapshotId = (ctx: RouteContext<Views>): string => ctx.params['snapshotId'] ?? '';
  const query = (ctx: RouteContext<Views>, name: string): string => {
    const value = ctx.query.get(name);
    if (value === null || value === '') throw new HttpError('invalid_request', `${name} is required.`);
    if (value.length > MAX_PATH) throw new HttpError('invalid_request', `${name} is too long.`);
    return value;
  };
  const oneOf = <T extends string>(ctx: RouteContext<Views>, name: string, members: readonly T[]): T => {
    const value = query(ctx, name);
    if (!(members as readonly string[]).includes(value)) throw new HttpError('invalid_request', `${name} must be one of: ${members.join(', ')}.`);
    return value as T;
  };

  return defineRoutes<Views>(
    [
      { method: 'GET', pattern: '/api/provider', handler: (ctx) => ctx.deps.reader.provider() },
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/snapshots/:snapshotId/summaries',
        handler: (ctx) => mapped(() => ctx.deps.reader.summaries(id(ctx), snapshotId(ctx))),
      },
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/snapshots/:snapshotId/diff',
        handler: (ctx) => ctx.deps.reader.diff(id(ctx), snapshotId(ctx), query(ctx, 'path')),
      },
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/snapshots/:snapshotId/file',
        handler: (ctx) => ctx.deps.reader.file(id(ctx), snapshotId(ctx), oneOf(ctx, 'side', SIDES), query(ctx, 'path')),
      },
      {
        method: 'GET',
        pattern: '/api/suggestions',
        handler: (ctx) => {
          const scope = oneOf(ctx, 'scope', SCOPE_TYPES);
          const category = ctx.query.get('category');
          return ctx.deps.reader.suggestions(scope, category === null || category === '' ? undefined : oneOf(ctx, 'category', CATEGORIES));
        },
      },
      { method: 'GET', pattern: '/api/sessions/:sessionId/questions', handler: (ctx) => ctx.deps.reader.questions(id(ctx)) },
      {
        method: 'POST',
        pattern: '/api/sessions/:sessionId/questions',
        handler: async (ctx) => {
          const body = parseAskBody(ctx.body);
          ctx.json(await mapped(() => write(ctx).ask(id(ctx), body)), 202);
        },
      },
      {
        method: 'POST',
        pattern: '/api/sessions/:sessionId/questions/:questionId/cancel',
        handler: async (ctx) => {
          ctx.json(await mapped(() => write(ctx).cancel(id(ctx), ctx.params['questionId'] ?? '')), 202);
        },
      },
    ],
    { read: { reader, writer: null }, write: { reader, writer } },
  );
}
