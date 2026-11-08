// VO-052 (FR-039, research R4): configuration is saved with all fields, refused
// with the field named when the clone path is missing or a token is added, and
// the saved file holds no credential. Limits and log retention take defaults.
//
// Contract this test sets for `src/config.ts` (T036), shaped on the `Config`
// wire type in contracts/http-api.md section 4 plus `logRetentionDays` from
// data-model.md:
//
//   saveConfig(appDataDir: string, body: unknown, platforms: RegisteredPlatforms): Promise<Config>
//     validates, applies defaults, writes `<appDataDir>/config.json`; on refusal
//     throws an error carrying `code` ('invalid_request' | 'unknown_field') and
//     `field` (dotted path), whose message names the field, and writes nothing.
//   loadConfig(appDataDir: string, platforms: RegisteredPlatforms): Promise<Config | null>
//   RegisteredPlatforms = { sourceControl: readonly string[]; issueTrackers: readonly string[] }
//
// The module is loaded inside each test body so this file runs before it exists.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { useTempAppData } from '../helpers/app-data.ts';

const PLATFORMS = {
  sourceControl: ['github', 'bitbucket-cloud'],
  issueTrackers: ['github-issues', 'jira-cloud'],
} as const;

const SECRET = 'ghp_SECRETtokenValue1234567890abcdefABCDEF';

function completeConfig(clonePath: string) {
  return {
    repository: { platform: 'github', id: 'acme/widgets', clonePath },
    issueTracker: { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC', 'OPS2'] },
    limits: { maxFileBytes: 2_000_000, maxChangedLines: 1_000, maxPromptChars: 100_000 },
    logRetentionDays: 14,
  };
}

const ALLOWED_PATHS = new Set([
  'repository',
  'repository.platform',
  'repository.id',
  'repository.clonePath',
  'issueTracker',
  'issueTracker.platform',
  'issueTracker.site',
  'issueTracker.projectKeys',
  'limits',
  'limits.maxFileBytes',
  'limits.maxChangedLines',
  'limits.maxPromptChars',
  'logRetentionDays',
]);

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    out.push(path, ...keyPaths(child, path));
  }
  return out;
}

function refusal(code: string, field: string) {
  return (error: unknown): boolean => {
    const e = error as { code?: unknown; field?: unknown; message?: unknown };
    assert.equal(e.code, code, `error code for ${field}`);
    assert.equal(e.field, field);
    assert.equal(typeof e.message, 'string');
    const last = field.split('.').at(-1) ?? field;
    assert.ok(String(e.message).includes(last), `message names the field: ${String(e.message)}`);
    return true;
  };
}

async function readAll(dir: string): Promise<string> {
  if (!existsSync(dir)) return '';
  const parts: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) parts.push(await readFile(join(entry.parentPath, entry.name), 'utf8'));
  }
  return parts.join('\n');
}

test('VO-052 a complete config is accepted, saved to config.json and loaded back', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig, loadConfig } = await import('../../src/config.ts');
  const clonePath = join(appData.root, 'elsewhere', 'widgets');

  assert.equal(await loadConfig(appData.dir, PLATFORMS), null, 'no config before set-up');

  const body = completeConfig(clonePath);
  const saved = await saveConfig(appData.dir, body, PLATFORMS);
  assert.deepEqual(saved, body);

  const file = join(appData.dir, 'config.json');
  assert.ok(existsSync(file), 'config.json written in the app-data directory');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), body);
  assert.deepEqual(await loadConfig(appData.dir, PLATFORMS), body);
});

test('VO-052 a config with no clonePath is refused naming the field, and nothing is written', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(join(appData.root, 'clone'));
  const { clonePath: _omitted, ...repository } = body.repository;

  await assert.rejects(
    saveConfig(appData.dir, { ...body, repository }, PLATFORMS),
    refusal('invalid_request', 'repository.clonePath'),
  );
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});

test('VO-052 an extra token field is refused with unknown_field, and no credential reaches the file', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig, loadConfig } = await import('../../src/config.ts');
  const body = completeConfig(join(appData.root, 'clone'));

  await assert.rejects(
    saveConfig(appData.dir, { ...body, token: SECRET }, PLATFORMS),
    refusal('unknown_field', 'token'),
  );
  assert.equal(existsSync(join(appData.dir, 'config.json')), false, 'refused save writes nothing');

  await saveConfig(appData.dir, body, PLATFORMS);
  const before = await readFile(join(appData.dir, 'config.json'), 'utf8');

  await assert.rejects(
    saveConfig(appData.dir, { ...body, repository: { ...body.repository, token: SECRET } }, PLATFORMS),
    refusal('unknown_field', 'repository.token'),
  );
  assert.equal(await readFile(join(appData.dir, 'config.json'), 'utf8'), before, 'earlier config unchanged');
  assert.deepEqual(await loadConfig(appData.dir, PLATFORMS), body);

  assert.equal((await readAll(appData.dir)).includes(SECRET), false, 'the token is nowhere under app-data');
  const saved: unknown = JSON.parse(before);
  for (const path of keyPaths(saved)) {
    assert.ok(ALLOWED_PATHS.has(path), `saved config holds only known fields, found ${path}`);
  }
});

test('VO-052 limits default to 1,048,576 / 5,000 / 400,000 and log retention to 7 days', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig, loadConfig } = await import('../../src/config.ts');
  const { limits: _limits, logRetentionDays: _days, ...body } = completeConfig(join(appData.root, 'clone'));

  const saved = await saveConfig(appData.dir, body, PLATFORMS);
  assert.deepEqual(saved.limits, { maxFileBytes: 1_048_576, maxChangedLines: 5_000, maxPromptChars: 400_000 });
  assert.equal(saved.logRetentionDays, 7);
  assert.deepEqual(await loadConfig(appData.dir, PLATFORMS), saved);

  const partial = await saveConfig(appData.dir, { ...body, limits: { maxChangedLines: 250 } }, PLATFORMS);
  assert.deepEqual(partial.limits, { maxFileBytes: 1_048_576, maxChangedLines: 250, maxPromptChars: 400_000 });
});

test('VO-052 platform ids are checked against the registered ids passed in', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(join(appData.root, 'clone'));

  await assert.rejects(
    saveConfig(appData.dir, { ...body, repository: { ...body.repository, platform: 'gitlab' } }, PLATFORMS),
    refusal('invalid_request', 'repository.platform'),
  );
  await assert.rejects(
    saveConfig(appData.dir, { ...body, issueTracker: { ...body.issueTracker, platform: 'github' } }, PLATFORMS),
    refusal('invalid_request', 'issueTracker.platform'),
  );
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});
