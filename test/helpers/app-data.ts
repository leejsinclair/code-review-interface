// Temporary application-data directory per test (T004).
//
// `src/appdata.ts` resolves the app-data directory per OS from the environment
// (research R4): `LOCALAPPDATA` on Windows, `HOME` (via os.homedir) on macOS,
// and `XDG_DATA_HOME` on Linux. This helper points that variable at a fresh
// temporary directory, so every path `appdata.ts` resolves lands inside it, and
// restores the variable and removes the directory when the test ends.
//
// `node --test` runs each test file in its own process, so mutating
// `process.env` is safe across files. Within one file, do not run tests that use
// this helper with `{ concurrency: true }`.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const APP_DIR_NAME = 'pr-review-workbench';

export interface TempAppData {
  /** The temporary root the env var points at. */
  readonly root: string;
  /** Where `appdata.ts` resolves the app-data directory (not created here). */
  readonly dir: string;
  /** The env var that was set. */
  readonly envVar: string;
  /** The env entries set, for passing to a child process. */
  readonly env: Readonly<Record<string, string>>;
  /** Restores the env var and removes `root`. Safe to call more than once. */
  cleanup(): Promise<void>;
}

interface AfterHook {
  after(fn: () => unknown): void;
}

/** The env var `appdata.ts` reads on this platform, and the app dir under it. */
export function appDataEnvFor(
  platform: NodeJS.Platform,
  root: string,
): { envVar: string; dir: string } {
  switch (platform) {
    case 'win32':
      return { envVar: 'LOCALAPPDATA', dir: join(root, APP_DIR_NAME) };
    case 'darwin':
      return { envVar: 'HOME', dir: join(root, 'Library', 'Application Support', APP_DIR_NAME) };
    default:
      return { envVar: 'XDG_DATA_HOME', dir: join(root, APP_DIR_NAME) };
  }
}

/** Creates a temporary app-data root and points the env var at it. */
export async function createTempAppData(): Promise<TempAppData> {
  const root = await mkdtemp(join(tmpdir(), 'prwb-appdata-'));
  const { envVar, dir } = appDataEnvFor(process.platform, root);
  const had = Object.prototype.hasOwnProperty.call(process.env, envVar);
  const previous = process.env[envVar];
  process.env[envVar] = root;
  let done = false;
  return {
    root,
    dir,
    envVar,
    env: { [envVar]: root },
    async cleanup() {
      if (done) return;
      done = true;
      if (had && previous !== undefined) process.env[envVar] = previous;
      else delete process.env[envVar];
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Creates a temporary app-data directory for the current test and registers its
 * cleanup on the test context, so it is removed after the test.
 *
 *   test('x', async (t) => { const appData = await useTempAppData(t); ... });
 */
export async function useTempAppData(t: AfterHook): Promise<TempAppData> {
  const appData = await createTempAppData();
  t.after(() => appData.cleanup());
  return appData;
}
