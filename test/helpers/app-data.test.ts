import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { appDataEnvFor, createTempAppData, useTempAppData } from './app-data.ts';

test('points the platform env var at a fresh directory and restores it', async () => {
  const before = { ...process.env };
  const appData = await createTempAppData();
  assert.equal(process.env[appData.envVar], appData.root);
  assert.ok(existsSync(appData.root));
  assert.ok(appData.dir.startsWith(appData.root));
  assert.ok(appData.dir.endsWith('pr-review-workbench'));
  await writeFile(join(appData.root, 'file'), 'x');
  await appData.cleanup();
  await appData.cleanup();
  assert.equal(existsSync(appData.root), false);
  assert.equal(process.env[appData.envVar], before[appData.envVar]);
});

test('names the variable appdata.ts reads on each OS', () => {
  assert.deepEqual(appDataEnvFor('linux', '/r'), { envVar: 'XDG_DATA_HOME', dir: join('/r', 'pr-review-workbench') });
  assert.equal(appDataEnvFor('win32', '/r').envVar, 'LOCALAPPDATA');
  assert.deepEqual(appDataEnvFor('darwin', '/r'), {
    envVar: 'HOME',
    dir: join('/r', 'Library', 'Application Support', 'pr-review-workbench'),
  });
});

let firstRoot = '';

test('gives each test its own directory', async (t) => {
  const a = await useTempAppData(t);
  firstRoot = a.root;
  assert.ok(existsSync(firstRoot));
  assert.equal(process.env[a.envVar], a.root);
});

test('removed the previous test\'s directory after it ended', async (t) => {
  assert.ok(firstRoot);
  assert.equal(existsSync(firstRoot), false);
  const b = await useTempAppData(t);
  assert.notEqual(b.root, firstRoot);
});
