// US1 routes (contracts/http-api.md sections 4 to 6 and 9): configuration, platforms, sign-ins, open
// pull requests, sessions, snapshots and the session event stream. Dependencies come in as arguments;
// this module composes the registry, sign-ins, repository manager and session service from them.
//
// A platform failure is a gap everywhere (FR-032) except `GET /api/pulls` and `POST /api/sessions`,
// which cannot proceed without the platform and answer `platform_error`. A rejected token marks that
// platform's sign-in expired and answers `signin_required` naming it (FR-040, EC-13).
//
// GET handlers receive only the reader; every state change is behind a non-GET route (X.5).

import type { ServerResponse } from 'node:http';
import {
  adapterDeps,
  createIssueTracker,
  createSourceControl,
  descriptorOf,
  platformDescriptors,
  registeredPlatforms,
  verifySignIn,
  type TrackerSettings,
} from '../../adapters/registry.ts';
import type { NetworkFetch } from '../../adapters/read-only-http.ts';
import { appDataPaths } from '../../appdata.ts';
import { ConfigError, loadConfig, saveConfig, type Config } from '../../config.ts';
import type { Platforms, PullSummary, SessionDetail, SessionSummary, SignIn, SnapshotDetail } from '../../contracts/http.ts';
import { AdapterError, type PlatformId } from '../../contracts/shared.ts';
import type { CredentialStore } from '../../credentials.ts';
import { createSessions, SessionError, type SessionEnvironment } from '../../core/sessions.ts';
import { createSignIns, SignInError } from '../../core/signins.ts';
import type { Git } from '../../repo/git.ts';
import { createRepositoryManager } from '../../repo/manager.ts';
import type { ReviewStore } from '../../store/review-store.ts';
import type { EventHub } from '../events.ts';
import {
  defineRoutes,
  HttpError,
  optionalString,
  requireObject,
  requirePositiveInt,
  requireString,
  type RouteContext,
  type RouteModule,
} from '../routes.ts';

export type ContextRouteDeps = {
  appDataDir: string;
  store: ReviewStore;
  credentials: CredentialStore;
  /** The network fetch every adapter's read-only fetch wraps. */
  network: NetworkFetch;
  git: Git;
  events?: EventHub;
  /** Registered AI provider ids, listed by `/api/platforms`. */
  aiProviders?: readonly string[];
  onSnapshot?: (sessionId: string, snapshotId: string) => void;
  onClose?: (sessionId: string) => void;
  afterRunning?: (sessionId: string) => Promise<void>;
};

/** What GET handlers may call: reads only. */
export interface ContextReader {
  config(): Promise<Config | null>;
  platforms(): Platforms;
  signIns(): Promise<SignIn[]>;
  pulls(): Promise<PullSummary[]>;
  sessions(): SessionSummary[];
  detail(sessionId: string): SessionDetail;
  snapshot(sessionId: string, snapshotId: string): SnapshotDetail;
  subscribe(sessionId: string, res: ServerResponse): void;
}

/** What the other methods may call. */
export interface ContextWriter {
  saveConfig(body: unknown): Promise<Config>;
  signIn(platform: PlatformId, body: { account?: string; secret: string }): Promise<SignIn>;
  start(prNumber: number): Promise<{ created: boolean; detail: SessionDetail }>;
  open(sessionId: string): Promise<SessionDetail>;
  refresh(sessionId: string): Promise<SessionDetail>;
  close(sessionId: string): Promise<void>;
  delete(sessionId: string, confirm: unknown): Promise<void>;
}

type Views = { reader: ContextReader; writer: ContextWriter | null };

class NotConfiguredError extends Error {}

const SESSION_CODES = { not_found: 'not_found', read_only: 'read_only', confirmation_required: 'confirmation_required' } as const;

export function createContextRoutes(deps: ContextRouteDeps): RouteModule<Views> {
  const registered = registeredPlatforms();
  const config = (): Promise<Config | null> => loadConfig(deps.appDataDir, registered);
  const trackerSettings = (c: Config): TrackerSettings => {
    const settings: TrackerSettings = { repository: { platform: c.repository.platform, id: c.repository.id } };
    if (c.issueTracker.site !== undefined) settings.site = c.issueTracker.site;
    if (c.issueTracker.projectKeys !== undefined) settings.projectKeys = c.issueTracker.projectKeys;
    return settings;
  };
  const requireConfig = async (): Promise<Config> => {
    const c = await config();
    if (c === null) throw new NotConfiguredError('No repository is configured yet.');
    return c;
  };

  const signIns = createSignIns({
    credentials: deps.credentials,
    descriptor: descriptorOf,
    verify: async (platform, authorize) => {
      const c = await config();
      const settings: TrackerSettings = c === null ? { repository: { platform: '', id: '' } } : trackerSettings(c);
      return verifySignIn(platform, adapterDeps(platform, deps.network, authorize), settings);
    },
  });

  const environment = async (): Promise<SessionEnvironment> => {
    const c = await requireConfig();
    const sc = c.repository.platform;
    const tr = c.issueTracker.platform;
    return {
      sourceControl: createSourceControl(sc, adapterDeps(sc, deps.network, deps.credentials.authorize(sc))),
      tracker: createIssueTracker(tr, adapterDeps(tr, deps.network, deps.credentials.authorize(tr)), trackerSettings(c)),
      repository: { platform: sc, id: c.repository.id },
      clonePath: c.repository.clonePath,
      limits: c.limits,
    };
  };

  const sessions = createSessions({
    store: deps.store,
    manager: createRepositoryManager({ git: deps.git, workspacesDir: appDataPaths(deps.appDataDir).workspaces }),
    environment,
    onPlatformError: (error) => signIns.noteFailure(error),
    ...(deps.onSnapshot === undefined ? {} : { onSnapshot: deps.onSnapshot }),
    ...(deps.onClose === undefined ? {} : { onClose: deps.onClose }),
    ...(deps.afterRunning === undefined ? {} : { afterRunning: deps.afterRunning }),
  });

  /** Refuses before any platform call when the source-control sign-in is missing or expired. */
  const requireSignedIn = async (): Promise<void> => {
    const platform = (await requireConfig()).repository.platform;
    const state = await signIns.state(platform);
    if (state !== 'signed-in') {
      throw new HttpError('signin_required', state === 'expired' ? 'The sign-in has expired; sign in again.' : 'Sign in first.', { platform });
    }
  };

  /** Maps service errors to the contract's error codes; `platformCritical` allows `platform_error`. */
  const mapped = async <T>(platformCritical: boolean, work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof NotConfiguredError) throw new HttpError('not_configured', error.message);
      if (error instanceof SessionError) throw new HttpError(SESSION_CODES[error.code], error.message);
      if (error instanceof ConfigError) throw new HttpError(error.code, error.message);
      if (error instanceof SignInError) throw new HttpError(error.code, error.message, { platform: error.platform });
      if (error instanceof AdapterError) {
        if (error.code === 'unauthorized') {
          signIns.noteFailure(error);
          throw new HttpError('signin_required', 'The platform rejected the sign-in; sign in again.', { platform: error.platform });
        }
        if (error.code === 'not_found') throw new HttpError('not_found', 'The platform has no such pull request.', { platform: error.platform });
        if (platformCritical) throw new HttpError('platform_error', `The platform could not be reached (${error.code}).`, { platform: error.platform });
      }
      throw error;
    }
  };

  const reader: ContextReader = {
    config,
    platforms: () => ({
      sourceControl: [...registered.sourceControl],
      issueTrackers: [...registered.issueTrackers],
      ai: [...(deps.aiProviders ?? [])],
      descriptors: platformDescriptors(),
    }),
    async signIns() {
      const c = await config();
      return c === null ? [] : signIns.list([c.repository.platform, c.issueTracker.platform]);
    },
    async pulls() {
      await requireSignedIn();
      return sessions.listPulls();
    },
    sessions: () => sessions.list(),
    detail: (id) => sessions.detail(id),
    snapshot: (id, snapshotId) => sessions.snapshot(id, snapshotId),
    subscribe(id, res) {
      sessions.detail(id);
      if (deps.events === undefined) throw new HttpError('not_found', 'No event stream is available.');
      deps.events.subscribe(id, res);
    },
  };

  const writer: ContextWriter = {
    saveConfig: (body) => saveConfig(deps.appDataDir, body, registered),
    signIn: (platform, body) => signIns.signIn(platform, body),
    async start(prNumber) {
      await requireSignedIn();
      return sessions.start(prNumber);
    },
    open: (id) => sessions.open(id),
    refresh: (id) => sessions.refresh(id),
    close: (id) => sessions.close(id),
    delete: (id, confirm) => sessions.delete(id, { confirm }),
  };

  const write = (ctx: RouteContext<Views>): ContextWriter => {
    if (ctx.deps.writer === null) throw new HttpError('not_found', 'No such route.');
    return ctx.deps.writer;
  };
  const id = (ctx: RouteContext<Views>): string => ctx.params['sessionId'] ?? '';

  return defineRoutes<Views>(
    [
      { method: 'GET', pattern: '/api/config', handler: (ctx) => mapped(false, async () => (await ctx.deps.reader.config()) ?? null).then((c) => ctx.json(c)) },
      { method: 'PUT', pattern: '/api/config', handler: (ctx) => mapped(false, () => write(ctx).saveConfig(ctx.body)) },
      { method: 'GET', pattern: '/api/platforms', handler: (ctx) => ctx.deps.reader.platforms() },
      { method: 'GET', pattern: '/api/signins', handler: (ctx) => mapped(false, () => ctx.deps.reader.signIns()) },
      {
        method: 'PUT',
        pattern: '/api/signins/:platform',
        handler: (ctx) =>
          mapped(false, () => {
            const body = requireObject(ctx.body, 'The sign-in', ['account', 'secret']);
            const secret = requireString(body, 'secret', { maxLength: 4096 });
            const account = optionalString(body, 'account', { maxLength: 320 });
            return write(ctx).signIn(ctx.params['platform'] ?? '', account === undefined ? { secret } : { account, secret });
          }),
      },
      { method: 'GET', pattern: '/api/pulls', handler: (ctx) => mapped(true, () => ctx.deps.reader.pulls()) },
      { method: 'GET', pattern: '/api/sessions', handler: (ctx) => ctx.deps.reader.sessions() },
      {
        method: 'POST',
        pattern: '/api/sessions',
        handler: async (ctx) => {
          const body = requireObject(ctx.body, 'The request', ['prNumber']);
          const prNumber = requirePositiveInt(body, 'prNumber');
          const { created, detail } = await mapped(true, () => write(ctx).start(prNumber));
          ctx.json(detail, created ? 201 : 200);
        },
      },
      { method: 'GET', pattern: '/api/sessions/:sessionId', handler: (ctx) => mapped(false, () => ctx.deps.reader.detail(id(ctx))) },
      { method: 'POST', pattern: '/api/sessions/:sessionId/open', handler: (ctx) => mapped(false, () => write(ctx).open(id(ctx))) },
      { method: 'POST', pattern: '/api/sessions/:sessionId/refresh', handler: (ctx) => mapped(false, () => write(ctx).refresh(id(ctx))) },
      {
        method: 'POST',
        pattern: '/api/sessions/:sessionId/close',
        handler: async (ctx) => {
          await mapped(false, () => write(ctx).close(id(ctx)));
          ctx.noContent();
        },
      },
      {
        method: 'DELETE',
        pattern: '/api/sessions/:sessionId',
        handler: async (ctx) => {
          const confirm = ctx.body !== null && typeof ctx.body === 'object' ? (ctx.body as { confirm?: unknown }).confirm : undefined;
          await mapped(false, () => write(ctx).delete(id(ctx), confirm));
          ctx.noContent();
        },
      },
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/snapshots/:snapshotId',
        handler: (ctx) => mapped(false, () => ctx.deps.reader.snapshot(id(ctx), ctx.params['snapshotId'] ?? '')),
      },
      {
        method: 'GET',
        pattern: '/api/sessions/:sessionId/events',
        handler: (ctx) => mapped(false, () => ctx.deps.reader.subscribe(id(ctx), ctx.res)),
      },
    ],
    { read: { reader, writer: null }, write: { reader, writer } },
  );
}
