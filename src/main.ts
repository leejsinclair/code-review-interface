// Composition root and launcher (plan "Structure", research R3, R17, R18). Resolves the app-data
// directory, the logger and its daily retention, the review store, the credentials, the adapters
// (built per request by the context routes over the read-only fetch), the AI provider, the work
// lanes and the two route modules, then sweeps what a killed run left behind, starts the server on
// 127.0.0.1 and opens the browser on the launch URL. Stopping cancels running AI work as `restart`
// and removes every session's isolated workspace (FR-042); the review store keeps everything else.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createAiProvider, registeredAiProviders } from './adapters/ai-registry.ts';
import type { NetworkFetch } from './adapters/read-only-http.ts';
import { registeredPlatforms } from './adapters/registry.ts';
import { ensureAppData } from './appdata.ts';
import { loadConfig } from './config.ts';
import { createInterrogation } from './core/interrogation.ts';
import { createLanes } from './core/lanes.ts';
import { sweepWorkspaces } from './core/recovery.ts';
import { createSummaries } from './core/summaries.ts';
import { recoverInterruptedWork } from './core/work-recovery.ts';
import { createCredentials, type KeyringModuleLike } from './credentials.ts';
import { createLogger, registerSecret } from './log.ts';
import { createGit } from './repo/git.ts';
import { createRepositoryManager } from './repo/manager.ts';
import { createEventHub } from './server/events.ts';
import { startServer } from './server/http.ts';
import { createContextRoutes } from './server/routes/context.ts';
import { createInterrogationRoutes } from './server/routes/interrogation.ts';
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
  const configured = await loadConfig(paths.dir, registeredPlatforms()).catch(() => null);
  const logger = createLogger({ dir: paths.logs, ...(configured === null ? {} : { retentionDays: configured.logRetentionDays }) });
  await logger.sweep();
  const retention = setInterval(() => void logger.sweep(), DAY_MS);
  retention.unref();

  const db = openDatabase(paths.db);
  const store = createReviewStore(db);
  const keyring = options.keyring ?? ((await import('@napi-rs/keyring')) as KeyringModuleLike);
  const credentials = createCredentials({ keyring, registerSecret });
  const git = createGit({ hooksPath: paths.emptyHooks });
  const manager = createRepositoryManager({ git, workspacesDir: paths.workspaces });
  const environment = async () => {
    const config = await loadConfig(paths.dir, registeredPlatforms());
    if (config === null) throw new Error('not configured');
    return { clonePath: config.repository.clonePath, limits: config.limits };
  };

  // Start-up sweep: leftover worktrees first, then AI work a killed run left unfinished (FR-009, FR-045).
  await sweepWorkspaces({ manager, workspacesDir: paths.workspaces });
  recoverInterruptedWork({ store });

  const events = createEventHub();
  const lanes = createLanes();
  const aiProviders = registeredAiProviders();
  const provider = createAiProvider(aiProviders[0]!, { providerHome: paths.providerHome });
  const core = { store, lanes, provider, events, git, workspacePath: manager.workspacePath, environment };
  const interrogation = createInterrogation(core);
  const summaries = createSummaries(core);
  const contextRoutes = createContextRoutes({
    appDataDir: paths.dir,
    store,
    credentials,
    network: options.fetch ?? fetch,
    git,
    events,
    aiProviders,
    onSnapshot: summaries.onSnapshot,
    onClose: (sessionId) => lanes.close(sessionId),
    afterRunning: (sessionId) => lanes.settledRunning(sessionId),
  });
  const interrogationRoutes = createInterrogationRoutes({ store, git, provider, interrogation, summaries, environment });

  const launchToken = options.launchToken ?? randomBytes(32).toString('base64url');
  const server = await startServer({ routes: [contextRoutes, interrogationRoutes], launchToken, logger, events });
  // The token stays in the fragment, so the browser never sends it to the server (R3).
  const url = `${server.origin}/launch#${launchToken}`;

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      clearInterval(retention);
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
