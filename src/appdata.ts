// Application-data directory (research R4, FR-043).
//
// Resolved per OS by hand: %LOCALAPPDATA% on Windows, ~/Library/Application
// Support on macOS, $XDG_DATA_HOME (default ~/.local/share) elsewhere. The
// directory must never overlap the repository clone, in either direction.

import { mkdir } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import { join, posix, resolve, sep, win32 } from 'node:path';

export const APP_DIR_NAME = 'pr-review-workbench';

export interface ResolveAppDataOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  homedir?: string;
}

export interface AppDataPaths {
  dir: string;
  config: string;
  db: string;
  logs: string;
  workspaces: string;
  providerHome: string;
  emptyHooks: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

export function resolveAppDataDir(options: ResolveAppDataOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homedir ?? osHomedir();
  switch (platform) {
    case 'win32': {
      const base = nonEmpty(env['LOCALAPPDATA']) ?? win32.join(home, 'AppData', 'Local');
      return win32.join(base, APP_DIR_NAME);
    }
    case 'darwin':
      return posix.join(home, 'Library', 'Application Support', APP_DIR_NAME);
    default: {
      const base = nonEmpty(env['XDG_DATA_HOME']) ?? posix.join(home, '.local', 'share');
      return posix.join(base, APP_DIR_NAME);
    }
  }
}

export function appDataPaths(dir: string = resolveAppDataDir()): AppDataPaths {
  return {
    dir,
    config: join(dir, 'config.json'),
    db: join(dir, 'review.db'),
    logs: join(dir, 'logs'),
    workspaces: join(dir, 'workspaces'),
    providerHome: join(dir, 'provider-home'),
    emptyHooks: join(dir, 'empty-hooks'),
  };
}

function comparable(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
}

/** Throws when the clone and the app-data directory overlap in either direction. */
export function assertOutsideClone(clonePath: string, dir: string = resolveAppDataDir()): void {
  const clone = comparable(clonePath);
  const data = comparable(dir);
  if (isSameOrInside(clone, data)) {
    throw new Error('clonePath must not be inside the application-data directory');
  }
  if (isSameOrInside(data, clone)) {
    throw new Error('clonePath must not contain the application-data directory');
  }
}

/** Creates the app-data directory and its subdirectories; idempotent. */
export async function ensureAppData(
  options: { dir?: string; clonePath?: string } = {},
): Promise<AppDataPaths> {
  const paths = appDataPaths(options.dir ?? resolveAppDataDir());
  if (options.clonePath !== undefined) assertOutsideClone(options.clonePath, paths.dir);
  for (const sub of [paths.logs, paths.workspaces, paths.providerHome, paths.emptyHooks]) {
    await mkdir(sub, { recursive: true });
  }
  return paths;
}
