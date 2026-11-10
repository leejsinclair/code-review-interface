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
  type SourceControlSettings,
  type TrackerSettings,
} from '../../adapters/registry.ts';
import type { NetworkFetch } from '../../adapters/read-only-http.ts';
import { appDataPaths } from '../../appdata.ts';
import { ConfigError, loadConfig, saveConfig, type Config, type RegisteredPlatforms } from '../../config.ts';
import type { Platforms, PullGroup, SessionDetail, SessionSummary, SignIn, SnapshotDetail, Workspace as WireWorkspace } from '../../contracts/http.ts';
import { AdapterError, type PlatformId } from '../../contracts/shared.ts';
import type { RepoRef } from '../../contracts/source-control.ts';
import type { CredentialStore } from '../../credentials.ts';
import { createSessions, SessionError, type SessionEnvironment } from '../../core/sessions.ts';
import type { Workspace } from '../../core/workspace.ts';
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

/** The registered ids plus what each tracker declares in `settingsFields`, for configuration validation (R14). */
export function configPlatforms(): RegisteredPlatforms {
  const settingsFields: Record<PlatformId, readonly ('site' | 'projectKeys')[]> = {};
  for (const d of platformDescriptors()) settingsFields[d.id] = d.settingsFields ?? [];
  return { ...registeredPlatforms(), settingsFields };
}

export type ContextRouteDeps = {
  appDataDir: string;
  /** The base folder's discovery result; a config save starts a new run (FR-056). */
  workspace: Workspace;
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
  workspace(): WireWorkspace;
  /** One group per matched repository, or the one named (Retry). */
  pulls(repository?: string): Promise<PullGroup[]>;
  sessions(): SessionSummary[];
  detail(sessionId: string): SessionDetail;
  snapshot(sessionId: string, snapshotId: string): SnapshotDetail;
  subscribe(sessionId: string, res: ServerResponse): void;
}

/** What the other methods may call. */
export interface ContextWriter {
  saveConfig(body: unknown): Promise<Config>;
  signIn(platform: PlatformId, body: { account?: string; secret: string }): Promise<SignIn>;
  rescan(): WireWorkspace;
  cancelDiscovery(): Promise<{ wasRunning: boolean; workspace: WireWorkspace }>;
  start(repository: string, prNumber: number): Promise<{ created: boolean; detail: SessionDetail }>;
  open(sessionId: string): Promise<SessionDetail>;
  refresh(sessionId: string): Promise<SessionDetail>;
  close(sessionId: string): Promise<void>;
  delete(sessionId: string, confirm: unknown): Promise<void>;
}

type Views = { reader: ContextReader; writer: ContextWriter | null };

class NotConfiguredError extends Error {}

const SESSION_CODES = {
  not_found: 'not_found',
  read_only: 'read_only',
  confirmation_required: 'confirmation_required',
  repository_unavailable: 'repository_unavailable',
} as const;

export function createContextRoutes(deps: ContextRouteDeps): RouteModule<Views> {
  const registered = configPlatforms();
  const config = (): Promise<Config | null> => loadConfig(deps.appDataDir, registered);
  const trackerSettings = (c: Config, repo: RepoRef): TrackerSettings => {
    const settings: TrackerSettings = { repository: repo };
    if (c.issueTracker.site !== undefined) settings.site = c.issueTracker.site;
    if (c.issueTracker.projectKeys !== undefined) settings.projectKeys = c.issueTracker.projectKeys;
    return settings;
  };
  /** Source-control adapters match remotes and read a repository; `repo` is a placeholder where no repository is involved. */
  const sourceControlSettings = (c: Config, repo: RepoRef): SourceControlSettings => {
    const settings: SourceControlSettings = { repository: repo };
    if (c.workspace.baseUrl !== undefined) settings.baseUrl = c.workspace.baseUrl;
    return settings;
  };
  const requireConfig = async (): Promise<Config> => {
    const c = await config();
    if (c === null) throw new NotConfiguredError('No base folder is configured yet.');
    return c;
  };

  const signIns = createSignIns({
    credentials: deps.credentials,
    descriptor: descriptorOf,
    verify: async (platform, authorize) => {
      const c = await config();
      const none: RepoRef = { platform: '', id: '' };
      const settings = c === null ? { repository: none } : { ...trackerSettings(c, none), ...sourceControlSettings(c, none) };
      return verifySignIn(platform, adapterDeps(platform, deps.network, authorize), settings);
    },
  });

  /** One repository's environment: the adapters, built for it, and the clone the workspace found (R13). */
  const environmentFor = async (repo: RepoRef): Promise<SessionEnvironment> => {
    const c = await requireConfig();
    const sc = c.workspace.platform;
    const tr = c.issueTracker.platform;
    const repository: RepoRef = { platform: sc, id: repo.id };
    const availability = deps.workspace.availability(repository);
    const out: SessionEnvironment = {
      sourceControl: createSourceControl(sc, adapterDeps(sc, deps.network, deps.credentials.authorize(sc)), sourceControlSettings(c, repository)),
      tracker: createIssueTracker(tr, adapterDeps(tr, deps.network, deps.credentials.authorize(tr)), trackerSettings(c, repository)),
      repository,
      clonePath: deps.workspace.cloneFor(repo.id),
      limits: c.limits,
    };
    if (!availability.available) out.unavailableReason = availability.reason;
    return out;
  };

  const sessions = createSessions({
    store: deps.store,
    manager: createRepositoryManager({ git: deps.git, workspacesDir: appDataPaths(deps.appDataDir).workspaces }),
    environmentFor,
    matched: () => deps.workspace.matched(),
    availability: (repo) => deps.workspace.availability(repo),
    onPlatformError: (error) => signIns.noteFailure(error),
    ...(deps.onSnapshot === undefined ? {} : { onSnapshot: deps.onSnapshot }),
    ...(deps.onClose === undefined ? {} : { onClose: deps.onClose }),
    ...(deps.afterRunning === undefined ? {} : { afterRunning: deps.afterRunning }),
  });

  /** Refuses before any platform call when the source-control sign-in is missing or expired. */
  const requireSignedIn = async (): Promise<void> => {
    const platform = (await requireConfig()).workspace.platform;
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
      return c === null ? [] : signIns.list([c.workspace.platform, c.issueTracker.platform]);
    },
    workspace() {
      const snapshot = deps.workspace.snapshot();
      if (snapshot === null) throw new NotConfiguredError('No base folder is configured yet.');
      return snapshot;
    },
    async pulls(repository) {
      await requireSignedIn();
      return sessions.listPulls(repository);
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
    async saveConfig(body) {
      const saved = await saveConfig(deps.appDataDir, body, registered);
      // A save starts discovery, cancelling a running scan (FR-056).
      deps.workspace.configure(saved.workspace);
      return saved;
    },
    rescan() {
      deps.workspace.rescan();
      return reader.workspace();
    },
    async cancelDiscovery() {
      const wasRunning = await deps.workspace.cancel();
      return { wasRunning, workspace: reader.workspace() };
    },
    signIn: (platform, body) => signIns.signIn(platform, body),
    async start(repository, prNumber) {
      const platform = (await requireConfig()).workspace.platform;
      await requireSignedIn();
      return sessions.start({ platform, id: repository }, prNumber);
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
      { method: 'GET', pattern: '/api/workspace', handler: (ctx) => mapped(false, () => ctx.deps.reader.workspace()) },
      {
        method: 'POST',
        pattern: '/api/workspace/rescan',
        handler: async (ctx) => ctx.json(await mapped(false, () => write(ctx).rescan()), 202),
      },
      {
        method: 'POST',
        pattern: '/api/workspace/cancel',
        handler: async (ctx) => {
          const { wasRunning, workspace } = await mapped(false, () => write(ctx).cancelDiscovery());
          ctx.json(workspace, wasRunning ? 202 : 200);
        },
      },
      {
        method: 'GET',
        pattern: '/api/pulls',
        handler: async (ctx) => {
          const repository = ctx.query.get('repository');
          const groups = await mapped(true, () => ctx.deps.reader.pulls(repository ?? undefined));
          if (repository === null) return ctx.json(groups);
          const group = groups[0];
          if (group === undefined) throw new HttpError('not_found', 'No such repository under the base folder.');
          ctx.json(group);
        },
      },
      { method: 'GET', pattern: '/api/sessions', handler: (ctx) => ctx.deps.reader.sessions() },
      {
        method: 'POST',
        pattern: '/api/sessions',
        handler: async (ctx) => {
          const body = requireObject(ctx.body, 'The request', ['repository', 'prNumber']);
          const repository = requireString(body, 'repository', { maxLength: 512 });
          const prNumber = requirePositiveInt(body, 'prNumber');
          const { created, detail } = await mapped(true, () => write(ctx).start(repository, prNumber));
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
