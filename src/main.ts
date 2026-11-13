// Composition root and launcher (plan "Structure", research R3, R17, R18). Resolves the app-data
// directory, the logger and its daily retention, the review store, the credentials, the adapters
// (built per request by the context routes over the read-only fetch), the AI provider, the work
// lanes and the two route modules, then sweeps what a killed run left behind, starts the server on
// 127.0.0.1 and opens the browser on the launch URL. Stopping cancels running AI work as `restart`
// and removes every session's isolated workspace (FR-042); the review store keeps everything else.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createAiProvider, registeredAiProviders } from './adapters/ai-registry.ts';
import type { NetworkFetch } from './adapters/read-only-http.ts';
import { adapterDeps, createIssueTracker, createSourceControl, registeredPlatforms, type TrackerSettings } from './adapters/registry.ts';
import { ensureAppData } from './appdata.ts';
import { CONFIG_FILE_NAME, loadConfig, validateConfig } from './config.ts';
import { createInterrogation } from './core/interrogation.ts';
import { createLanes } from './core/lanes.ts';
import { createSpecContextService, type SpecContextEnvironment } from './core/spec-context.ts';
import { createRiskService } from './core/risk-service.ts';
import { sweepWorkspaces } from './core/recovery.ts';
import { createSummaries } from './core/summaries.ts';
import { createWorkspace } from './core/workspace.ts';
import { recoverInterruptedWork } from './core/work-recovery.ts';
import { createCredentials, type KeyringModuleLike } from './credentials.ts';
import { withEnvFallback } from './credentials-env.ts';
import { envCredential } from './adapters/env-credentials.ts';
import { createLogger, registerSecret } from './log.ts';
import { createGit } from './repo/git.ts';
import { createRepositoryManager } from './repo/manager.ts';
import { createEventHub } from './server/events.ts';
import { createPullCache } from './core/pull-cache.ts';
import { createReviewActionsLookup, createReviewerLookup } from './server/reviewer.ts';
import { startServer } from './server/http.ts';
import { configPlatforms, createContextRoutes } from './server/routes/context.ts';
import { createInterrogationRoutes } from './server/routes/interrogation.ts';
import { createReviewActionsRoutes } from './server/routes/review-actions.ts';
import { createRiskRoutes } from './server/routes/risk.ts';
import { createSpecContextRoutes } from './server/routes/spec-context.ts';
import { openDatabase } from './store/db.ts';
import { createReviewStore } from './store/review-store.ts';

export type WorkbenchOptions = {
  /** The OS keychain module; default `@napi-rs/keyring`. */
  keyring?: KeyringModuleLike;
  /** The network fetch every adapter's read-only fetch wraps; default the global `fetch`. */
  fetch?: NetworkFetch;
  /** The per-launch token; default 32 random bytes. */
  launchToken?: string;
};

export type RunningWorkbench = { port: number; close(): Promise<void> };

const DAY_MS = 86_400_000;

/** The operating system's browser opener, run without a shell (research R19). */
function browserCommand(url: string): [string, string[]] {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

export async function startWorkbench(options: WorkbenchOptions = {}): Promise<RunningWorkbench> {
  const paths = await ensureAppData();
  const platforms = configPlatforms();
  const network: NetworkFetch = options.fetch ?? fetch;
  const configured = await loadConfig(paths.dir, platforms).catch(() => null);
  const logger = createLogger({ dir: paths.logs, ...(configured === null ? {} : { retentionDays: configured.logRetentionDays }) });
  await logger.sweep();
  const retention = setInterval(() => void logger.sweep(), DAY_MS);
  retention.unref();

  const db = openDatabase(paths.db);
  const store = createReviewStore(db);
  // A `.env` in the working directory (devcontainers have no OS keychain) feeds the credential fallback.
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: nothing to load.
  }
  const realKeyring = options.keyring ?? ((await import('@napi-rs/keyring').catch(() => null)) as KeyringModuleLike | null);
  const keyring = options.keyring ?? withEnvFallback(realKeyring, envCredential);
  const credentials = createCredentials({ keyring, registerSecret });
  const git = createGit({ hooksPath: paths.emptyHooks });
  const manager = createRepositoryManager({ git, workspacesDir: paths.workspaces });
  // The workspace finds the clones under the base folder; discovery starts now and again on every save (FR-056).
  const events = createEventHub();
  const workspace = createWorkspace({
    manager,
    appDataDir: paths.dir,
    // Open review pages re-read the session, so Refresh enables once the clone is found.
    onSettled: () => void events.broadcast('session', { reason: 'repository-availability' }),
    matcherFor: ({ platform, baseUrl }) => {
      const repository = { platform, id: '' };
      const sourceControl = createSourceControl(platform, adapterDeps(platform, network, (request) => request), {
        repository,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      });
      return (remote) => sourceControl.repositoryForRemote(remote);
    },
  });
  workspace.configure(configured === null ? null : configured.workspace);
  const environmentFor = async (repo: { platform: string; id: string }) => {
    const config = await loadConfig(paths.dir, platforms);
    if (config === null) throw new Error('not configured');
    const availability = workspace.availability({ platform: repo.platform, id: repo.id });
    return {
      clonePath: workspace.cloneFor(repo.id),
      limits: config.limits,
      ...(availability.available ? {} : { unavailableReason: availability.reason }),
    };
  };

  // Start-up sweep: leftover worktrees first, then AI work a killed run left unfinished (FR-009, FR-045).
  await sweepWorkspaces({ manager, workspacesDir: paths.workspaces });
  recoverInterruptedWork({ store });

  const lanes = createLanes();
  const aiProviders = registeredAiProviders();
  const provider = createAiProvider(aiProviders[0]!, { providerHome: paths.providerHome });
  const core = { store, lanes, provider, events, git, workspacePath: manager.workspacePath, environmentFor };
  const interrogation = createInterrogation(core);
  const summaries = createSummaries(core);
  const risk = createRiskService({ store, events, appDataDir: paths.dir, ai: core, currentUser: createReviewerLookup({ appDataDir: paths.dir, store, credentials, network }) });

  // The spec-context service: documents for the linked issues, aligned to the diff (T025).
  const specContextEnvironment = (sessionId: string): SpecContextEnvironment | null => {
    try {
      const session = store.readSession(sessionId);
      if (session === null) return null;
      const parsed: unknown = JSON.parse(readFileSync(join(paths.dir, CONFIG_FILE_NAME), 'utf8'));
      const c = validateConfig(parsed, platforms, paths.dir, { checkFolder: false });
      const repository = { platform: c.workspace.platform, id: session.pr.repo.identifier };
      const settings: TrackerSettings = { repository };
      if (c.issueTracker.site !== undefined) settings.site = c.issueTracker.site;
      if (c.issueTracker.projectKeys !== undefined) settings.projectKeys = c.issueTracker.projectKeys;
      const tr = c.issueTracker.platform;
      return {
        repositoryId: repository.id,
        clonePath: workspace.cloneFor(repository.id),
        tracker: createIssueTracker(tr, adapterDeps(tr, network, credentials.authorize(tr)), settings),
        limits: c.limits,
      };
    } catch {
      return null;
    }
  };
  const specContext = createSpecContextService({
    store,
    manager,
    lanes,
    provider,
    events,
    workspace: { cloneFor: (id) => workspace.cloneFor(id), enclosingOf: (id) => workspace.enclosingOf(id)?.repository.id ?? null },
    environmentFor: specContextEnvironment,
    workspacePath: manager.workspacePath,
    logger,
  });
  const pullCache = createPullCache();
  const contextRoutes = createContextRoutes({
    pullCache,
    appDataDir: paths.dir,
    workspace,
    store,
    credentials,
    network,
    git,
    events,
    aiProviders,
    onSnapshotStored: (sessionId, snapshotId) => {
      risk.onSnapshotStored(sessionId, snapshotId);
      specContext.onSnapshotStored(sessionId, snapshotId);
    },
    onSnapshot: (sessionId, snapshotId) => {
      summaries.onSnapshot(sessionId, snapshotId);
      risk.onSnapshot(sessionId, snapshotId);
      specContext.onSnapshot(sessionId, snapshotId);
    },
    onRefreshed: specContext.onRefreshed,
    // The effective class (rules, AI, overrides) of the riskiest file, so Home can put risky reviews first.
    highestRisk: (sessionId, snapshotId) => {
      try {
        const counts = risk.getReport(sessionId, snapshotId)?.counts;
        if (counts === undefined) return undefined;
        return (['critical', 'elevated', 'normal', 'low'] as const).find((c) => counts[c] > 0);
      } catch {
        return undefined;
      }
    },
    onClose: (sessionId) => lanes.close(sessionId),
    afterRunning: (sessionId) => lanes.settledRunning(sessionId),
  });
  const interrogationRoutes = createInterrogationRoutes({ store, git, provider, interrogation, summaries, environmentFor });
  const riskRoutes = createRiskRoutes({ risk });
  const specContextRoutes = createSpecContextRoutes({ specContext });
  const reviewActionsRoutes = createReviewActionsRoutes({ actionsFor: createReviewActionsLookup({ appDataDir: paths.dir, store, credentials, network, pullCache }) });

  const launchToken = options.launchToken ?? randomBytes(32).toString('base64url');
  const server = await startServer({ routes: [contextRoutes, interrogationRoutes, riskRoutes, specContextRoutes, reviewActionsRoutes], launchToken, logger, events });
  // The token stays in the fragment, so the browser never sends it to the server (R3).
  const url = `${server.origin}/launch#${launchToken}`;

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      clearInterval(retention);
      await workspace.cancel();
      await server.close();
      const sessionIds = store.listSessions().map((s) => s.id);
      for (const id of sessionIds) lanes.close(id, 'restart');
      await Promise.all(sessionIds.map((id) => lanes.settledRunning(id)));
      await sweepWorkspaces({ manager, workspacesDir: paths.workspaces });
      db.close();
    })();
    return closing;
  };
  const onSignal = (): void => {
    void close().finally(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  console.log(`PR Review Workbench is running. Open ${url}`);
  const [command, args] = browserCommand(url);
  // The URL is printed above, so a missing opener only means the reviewer opens it by hand.
  execFile(command, args, () => undefined);

  return { port: server.port, close };
}

// `node src/main.ts` (npm run dev) starts the workbench; importing it, as bin/prwb.mjs and the tests do, does not.
// Not `import.meta.main`: Node 24.2 leaves it false for a type-stripped .ts entry.
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === import.meta.filename) await startWorkbench();
