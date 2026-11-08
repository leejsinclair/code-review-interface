// VO-054 (FR-043): the application-data directory is resolved per OS, outside every repository.
//
// API required from src/appdata.ts (T022):
//
//   export const APP_DIR_NAME: 'pr-review-workbench';
//   export function resolveAppDataDir(options?: {
//     platform?: NodeJS.Platform;                 // default process.platform
//     env?: Record<string, string | undefined>;   // default process.env
//     homedir?: string;                           // default os.homedir()
//   }): string;
//   export interface AppDataPaths {
//     dir: string; config: string; db: string;
//     logs: string; workspaces: string; providerHome: string; emptyHooks: string;
//   }
//   export function appDataPaths(dir?: string): AppDataPaths;          // dir defaults to resolveAppDataDir()
//   export function assertOutsideClone(clonePath: string, dir?: string): void;  // throws an Error naming clonePath
//   export function ensureAppData(options?: { dir?: string; clonePath?: string }): Promise<AppDataPaths>;
//
// Runtime code is loaded inside each test so a missing module fails only these tests.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { test } from 'node:test';
import type * as AppDataModule from '../../src/appdata.ts';
import { useTempAppData } from '../helpers/app-data.ts';

type AppData = typeof AppDataModule;

async function load(): Promise<AppData> {
  return (await import('../../src/appdata.ts')) as AppData;
}

const APP = 'pr-review-workbench';

test('VO-054 windows resolves under LOCALAPPDATA', async () => {
  const { resolveAppDataDir, APP_DIR_NAME } = await load();
  assert.equal(APP_DIR_NAME, APP);
  const dir = resolveAppDataDir({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local', XDG_DATA_HOME: '/ignored' },
    homedir: 'C:\\Users\\ana',
  });
  assert.equal(dir, win32.join('C:\\Users\\ana\\AppData\\Local', APP));
});

test('VO-054 windows without LOCALAPPDATA falls back to the per-user AppData\\Local', async () => {
  const { resolveAppDataDir } = await load();
  const dir = resolveAppDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\ana' });
  assert.equal(dir, win32.join('C:\\Users\\ana', 'AppData', 'Local', APP));
});

test('VO-054 macos resolves under ~/Library/Application Support', async () => {
  const { resolveAppDataDir } = await load();
  const dir = resolveAppDataDir({
    platform: 'darwin',
    env: { XDG_DATA_HOME: '/ignored', LOCALAPPDATA: '/ignored' },
    homedir: '/Users/ana',
  });
  assert.equal(dir, posix.join('/Users/ana', 'Library', 'Application Support', APP));
});

test('VO-054 linux uses XDG_DATA_HOME', async () => {
  const { resolveAppDataDir } = await load();
  const dir = resolveAppDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/xdg' }, homedir: '/home/ana' });
  assert.equal(dir, posix.join('/data/xdg', APP));
});

test('VO-054 linux defaults to ~/.local/share when XDG_DATA_HOME is unset or empty', async () => {
  const { resolveAppDataDir } = await load();
  const expected = posix.join('/home/ana', '.local', 'share', APP);
  assert.equal(resolveAppDataDir({ platform: 'linux', env: {}, homedir: '/home/ana' }), expected);
  assert.equal(resolveAppDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '' }, homedir: '/home/ana' }), expected);
});

test('VO-054 with no options it reads the current process environment', async (t) => {
  const appData = await useTempAppData(t);
  const { resolveAppDataDir } = await load();
  assert.equal(resolveAppDataDir(), appData.dir);
});

test('VO-054 appDataPaths lays out the store, config, logs and workspaces inside the app-data dir', async (t) => {
  const appData = await useTempAppData(t);
  const { appDataPaths } = await load();
  const paths = appDataPaths();
  assert.deepEqual(paths, {
    dir: appData.dir,
    config: join(appData.dir, 'config.json'),
    db: join(appData.dir, 'review.db'),
    logs: join(appData.dir, 'logs'),
    workspaces: join(appData.dir, 'workspaces'),
    providerHome: join(appData.dir, 'provider-home'),
    emptyHooks: join(appData.dir, 'empty-hooks'),
  });
  assert.equal(appDataPaths('/elsewhere/x').db, join('/elsewhere/x', 'review.db'));
});

test('VO-054 ensureAppData creates the app-data directories', async (t) => {
  const appData = await useTempAppData(t);
  const { ensureAppData } = await load();
  const paths = await ensureAppData();
  assert.equal(paths.dir, appData.dir);
  for (const sub of ['logs', 'workspaces', 'provider-home', 'empty-hooks']) {
    const info = await stat(join(appData.dir, sub));
    assert.ok(info.isDirectory(), `${sub} is a directory`);
  }
  // Idempotent: a second call succeeds and keeps the same layout.
  assert.deepEqual(await ensureAppData(), paths);
});

test('VO-054 a clone path inside the app-data dir is refused', async (t) => {
  const appData = await useTempAppData(t);
  const { assertOutsideClone, ensureAppData } = await load();
  const clone = join(appData.dir, 'workspaces', 'my-clone');
  assert.throws(() => assertOutsideClone(clone), /clonePath/);
  assert.throws(() => assertOutsideClone(appData.dir), /clonePath/, 'the app-data dir itself is refused as a clone');
  assert.throws(() => assertOutsideClone(join(appData.dir, 'logs', '..', 'x')), /clonePath/, 'paths are normalised');
  await assert.rejects(ensureAppData({ clonePath: clone }), /clonePath/);
});

test('VO-054 an app-data dir inside the clone is refused, so the store and workspaces never resolve inside it', async (t) => {
  const clone = await mkdtemp(join(tmpdir(), 'prwb-clone-'));
  t.after(() => rm(clone, { recursive: true, force: true }));
  await mkdir(join(clone, '.git'));
  const { assertOutsideClone, ensureAppData } = await load();

  const inside = join(clone, '.local', 'share', APP);
  assert.throws(() => assertOutsideClone(clone, inside), /clonePath/);
  assert.throws(() => assertOutsideClone(clone + '/', inside), /clonePath/, 'a trailing separator does not hide it');

  await assert.rejects(ensureAppData({ dir: inside, clonePath: clone }), /clonePath/);
  assert.equal(existsSync(join(clone, '.local')), false, 'nothing was created inside the clone');
  assert.deepEqual((await readdir(clone)).sort(), ['.git']);
});

test('VO-054 a clone beside the app-data dir is accepted, including a sibling sharing its name prefix', async (t) => {
  const appData = await useTempAppData(t);
  const { assertOutsideClone, ensureAppData } = await load();
  assert.doesNotThrow(() => assertOutsideClone(join(appData.root, 'projects', 'repo')));
  assert.doesNotThrow(() => assertOutsideClone(appData.dir + '-clone'));
  const paths = await ensureAppData({ clonePath: join(appData.root, 'projects', 'repo') });
  assert.equal(paths.dir, appData.dir);
  assert.ok(existsSync(paths.workspaces));
});
