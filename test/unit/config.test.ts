// VO-052 (FR-039, FR-048, research R4, R10, R14; feature 003 data-model 1.1): configuration is saved
// with all fields, refused with the field path named when the base folder is missing or a token is
// added, and the saved file holds no credential. Limits and log retention take defaults. The workspace
// (a base folder and a platform) replaces the single repository; a config file still in the old
// `repository` shape loads as not configured.
//
// The module is loaded inside each test body so this file runs before it exists.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { useTempAppData } from '../helpers/app-data.ts';

const PLATFORMS = {
  sourceControl: ['github', 'bitbucket-cloud'],
  issueTrackers: ['github-issues', 'jira-cloud'],
  settingsFields: { 'github-issues': [], 'jira-cloud': ['site', 'projectKeys'], 'gitlab-issues': ['site'] },
} as const;

const SECRET = 'ghp_SECRETtokenValue1234567890abcdefABCDEF';

/** An existing base folder; `completeConfig` takes it as its first argument. */
async function makeBase(root: string, name = 'repos'): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

function completeConfig(baseFolder: string) {
  return {
    workspace: { baseFolder, platform: 'github' },
    issueTracker: { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC', 'OPS2'] },
    limits: { maxFileBytes: 2_000_000, maxChangedLines: 1_000, maxPromptChars: 100_000 },
    logRetentionDays: 14,
  };
}

const ALLOWED_PATHS = new Set([
  'workspace',
  'workspace.baseFolder',
  'workspace.platform',
  'workspace.baseUrl',
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
  const baseFolder = await makeBase(appData.root);

  assert.equal(await loadConfig(appData.dir, PLATFORMS), null, 'no config before set-up');

  const body = completeConfig(baseFolder);
  const saved = await saveConfig(appData.dir, body, PLATFORMS);
  assert.deepEqual(saved, body);

  const file = join(appData.dir, 'config.json');
  assert.ok(existsSync(file), 'config.json written in the app-data directory');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), body);
  assert.deepEqual(await loadConfig(appData.dir, PLATFORMS), body);
});

test('FR-048 a config with no baseFolder is refused naming the field path, and nothing is written', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(await makeBase(appData.root));
  const { baseFolder: _omitted, ...workspace } = body.workspace;

  await assert.rejects(saveConfig(appData.dir, { ...body, workspace }, PLATFORMS), refusal('invalid_request', 'workspace.baseFolder'));
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
  await assert.rejects(saveConfig(appData.dir, { ...body, workspace: undefined }, PLATFORMS), refusal('invalid_request', 'workspace'));
});

test('FR-048 baseFolder must be absolute and an existing directory', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(await makeBase(appData.root));
  const file = join(appData.root, 'a-file');
  await writeFile(file, 'x');

  for (const baseFolder of ['relative/folder', '.', join(appData.root, 'does-not-exist'), file]) {
    await assert.rejects(
      saveConfig(appData.dir, { ...body, workspace: { ...body.workspace, baseFolder } }, PLATFORMS),
      refusal('invalid_request', 'workspace.baseFolder'),
      `${baseFolder} refused`,
    );
  }
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});

test('FR-048 baseFolder must neither contain nor sit inside the application-data folder', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(await makeBase(appData.root));
  await mkdir(join(appData.dir, 'inside'), { recursive: true });

  for (const baseFolder of [appData.root, appData.dir, join(appData.dir, 'inside')]) {
    await assert.rejects(
      saveConfig(appData.dir, { ...body, workspace: { ...body.workspace, baseFolder } }, PLATFORMS),
      refusal('invalid_request', 'workspace.baseFolder'),
      `${baseFolder} refused`,
    );
  }
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});

test('VO-052 an extra token field is refused with unknown_field, and no credential reaches the file', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig, loadConfig } = await import('../../src/config.ts');
  const body = completeConfig(await makeBase(appData.root));

  await assert.rejects(saveConfig(appData.dir, { ...body, token: SECRET }, PLATFORMS), refusal('unknown_field', 'token'));
  assert.equal(existsSync(join(appData.dir, 'config.json')), false, 'refused save writes nothing');

  await saveConfig(appData.dir, body, PLATFORMS);
  const before = await readFile(join(appData.dir, 'config.json'), 'utf8');

  await assert.rejects(
    saveConfig(appData.dir, { ...body, workspace: { ...body.workspace, token: SECRET } }, PLATFORMS),
    refusal('unknown_field', 'workspace.token'),
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
  const { limits: _limits, logRetentionDays: _days, ...body } = completeConfig(await makeBase(appData.root));

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
  const body = completeConfig(await makeBase(appData.root));

  await assert.rejects(
    saveConfig(appData.dir, { ...body, workspace: { ...body.workspace, platform: 'gitlab' } }, PLATFORMS),
    refusal('invalid_request', 'workspace.platform'),
  );
  await assert.rejects(
    saveConfig(appData.dir, { ...body, issueTracker: { ...body.issueTracker, platform: 'github' } }, PLATFORMS),
    refusal('invalid_request', 'issueTracker.platform'),
  );
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});

test('R14 a tracker field the tracker does not declare is invalid_request naming the field', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(await makeBase(appData.root));

  await assert.rejects(
    saveConfig(appData.dir, { ...body, issueTracker: { platform: 'github-issues', projectKeys: ['ABC'] } }, PLATFORMS),
    refusal('invalid_request', 'issueTracker.projectKeys'),
  );
  await assert.rejects(
    saveConfig(appData.dir, { ...body, issueTracker: { platform: 'github-issues', site: 'https://acme.atlassian.net' } }, PLATFORMS),
    refusal('invalid_request', 'issueTracker.site'),
  );
  // gitlab-issues declares only `site`.
  const gitlab = { ...PLATFORMS, issueTrackers: [...PLATFORMS.issueTrackers, 'gitlab-issues'] };
  await assert.rejects(
    saveConfig(appData.dir, { ...body, issueTracker: { platform: 'gitlab-issues', site: 'https://git.example.com', projectKeys: ['ABC'] } }, gitlab),
    refusal('invalid_request', 'issueTracker.projectKeys'),
  );
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});

test('R14 a declared site that is missing is refused; a tracker declaring nothing needs nothing', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = completeConfig(await makeBase(appData.root));

  await assert.rejects(
    saveConfig(appData.dir, { ...body, issueTracker: { platform: 'jira-cloud', projectKeys: ['ABC'] } }, PLATFORMS),
    refusal('invalid_request', 'issueTracker.site'),
  );
  const plain = await saveConfig(appData.dir, { ...body, issueTracker: { platform: 'github-issues' } }, PLATFORMS);
  assert.deepEqual(plain.issueTracker, { platform: 'github-issues' });
});

test('R10 a config in the old repository shape loads as not configured', async (t) => {
  const appData = await useTempAppData(t);
  const { loadConfig } = await import('../../src/config.ts');
  await mkdir(appData.dir, { recursive: true });
  const old = {
    repository: { platform: 'github', id: 'acme/widgets', clonePath: join(appData.root, 'clone') },
    issueTracker: { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC'] },
    limits: { maxFileBytes: 2_000_000, maxChangedLines: 1_000, maxPromptChars: 100_000 },
    logRetentionDays: 14,
  };
  await writeFile(join(appData.dir, 'config.json'), JSON.stringify(old));

  assert.equal(await loadConfig(appData.dir, PLATFORMS), null);
});

test('FR-048 a config whose base folder has since gone loads as saved (discovery reports it)', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig, loadConfig } = await import('../../src/config.ts');
  const baseFolder = await makeBase(appData.root);
  const saved = await saveConfig(appData.dir, completeConfig(baseFolder), PLATFORMS);
  await (await import('node:fs/promises')).rm(baseFolder, { recursive: true });

  assert.deepEqual(await loadConfig(appData.dir, PLATFORMS), saved);
});

// FR-016, FR-017, FR-018 (feature 002, contracts/interfaces.md section 4): one address
// rule, `validateBaseUrl(field, value)`, guards both `workspace.baseUrl` and
// `issueTracker.site`. https anywhere; http only on a loopback host (exactly
// `localhost`, `[::1]` or a dotted quad starting `127.`); never user info, a query or a
// fragment. A missing `workspace.baseUrl` is refused when the chosen source-control
// platform is listed in `RegisteredPlatforms.needsBaseUrl`.

const SELF_HOSTED = 'gitlab';

const PLATFORMS_WITH_BASE = {
  sourceControl: ['github', 'bitbucket-cloud', SELF_HOSTED],
  issueTrackers: ['github-issues', 'jira-cloud'],
  settingsFields: { 'github-issues': [], 'jira-cloud': ['site', 'projectKeys'] },
  needsBaseUrl: [SELF_HOSTED],
} as const;

const LOOPBACK_MESSAGE = 'must use https, or http on a loopback address';

const ACCEPTED = ['https://git.example.com/gitlab', 'http://localhost:8929', 'http://127.0.0.1', 'http://[::1]'];

const REFUSED_HTTP = ['http://gitlab.example.com', 'http://localhost.example.com'];

const REFUSED_PARTS = ['https://user:pw@host', 'https://host/?q=1', 'https://host/#x'];

function withRepositoryBase(baseFolder: string, baseUrl: string | undefined) {
  const body = completeConfig(baseFolder);
  const workspace: Record<string, unknown> = { ...body.workspace, platform: SELF_HOSTED };
  if (baseUrl !== undefined) workspace.baseUrl = baseUrl;
  return { ...body, workspace };
}

function withSite(baseFolder: string, site: string) {
  const body = completeConfig(baseFolder);
  return { ...body, issueTracker: { ...body.issueTracker, site } };
}

test('FR-016 FR-017 accepted base addresses are kept as typed on workspace.baseUrl and issueTracker.site', async (t) => {
  const appData = await useTempAppData(t);
  const { validateConfig } = await import('../../src/config.ts');
  const clonePath = await makeBase(appData.root);

  for (const address of ACCEPTED) {
    const repo = validateConfig(withRepositoryBase(clonePath, address), PLATFORMS_WITH_BASE, appData.dir);
    assert.equal(repo.workspace.baseUrl, address, `workspace.baseUrl ${address} accepted and kept`);

    const site = validateConfig(withSite(clonePath, address), PLATFORMS_WITH_BASE, appData.dir);
    assert.equal(site.issueTracker.site, address, `issueTracker.site ${address} accepted and kept`);
  }
});

test('FR-016 a workspace.baseUrl with a sub-path survives a save and load', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig, loadConfig } = await import('../../src/config.ts');
  const body = withRepositoryBase(await makeBase(appData.root), 'https://git.example.com/gitlab');

  const saved = await saveConfig(appData.dir, body, PLATFORMS_WITH_BASE);
  assert.equal(saved.workspace.baseUrl, 'https://git.example.com/gitlab');
  assert.deepEqual(await loadConfig(appData.dir, PLATFORMS_WITH_BASE), saved);
});

test('FR-017 http on a non-loopback host is refused on both fields with the loopback message', async (t) => {
  const appData = await useTempAppData(t);
  const { validateConfig } = await import('../../src/config.ts');
  const clonePath = await makeBase(appData.root);

  for (const address of REFUSED_HTTP) {
    for (const [field, body] of [
      ['workspace.baseUrl', withRepositoryBase(clonePath, address)],
      ['issueTracker.site', withSite(clonePath, address)],
    ] as const) {
      assert.throws(
        () => validateConfig(body, PLATFORMS_WITH_BASE, appData.dir),
        (error: unknown) => {
          refusal('invalid_request', field)(error);
          assert.ok(
            String((error as Error).message).includes(LOOPBACK_MESSAGE),
            `${field} ${address}: message reads "${LOOPBACK_MESSAGE}", got ${String((error as Error).message)}`,
          );
          return true;
        },
        `${field} ${address} refused`,
      );
    }
  }
});

test('FR-018 a base address with user info, a query or a fragment is refused on both fields', async (t) => {
  const appData = await useTempAppData(t);
  const { validateConfig } = await import('../../src/config.ts');
  const clonePath = await makeBase(appData.root);

  for (const address of REFUSED_PARTS) {
    assert.throws(
      () => validateConfig(withRepositoryBase(clonePath, address), PLATFORMS_WITH_BASE, appData.dir),
      refusal('invalid_request', 'workspace.baseUrl'),
      `workspace.baseUrl ${address} refused`,
    );
    assert.throws(
      () => validateConfig(withSite(clonePath, address), PLATFORMS_WITH_BASE, appData.dir),
      refusal('invalid_request', 'issueTracker.site'),
      `issueTracker.site ${address} refused`,
    );
  }
});

test('FR-018 a refused base address writes nothing and keeps the user info out of the message', async (t) => {
  const appData = await useTempAppData(t);
  const { saveConfig } = await import('../../src/config.ts');
  const body = withRepositoryBase(await makeBase(appData.root), `https://user:${SECRET}@host`);

  await assert.rejects(saveConfig(appData.dir, body, PLATFORMS_WITH_BASE), (error: unknown) => {
    refusal('invalid_request', 'workspace.baseUrl')(error);
    assert.equal(String((error as Error).message).includes(SECRET), false, 'the password is not echoed');
    return true;
  });
  assert.equal(existsSync(join(appData.dir, 'config.json')), false);
});

test('FR-016 a missing workspace.baseUrl is refused only when the chosen platform needs one', async (t) => {
  const appData = await useTempAppData(t);
  const { validateConfig } = await import('../../src/config.ts');
  const clonePath = await makeBase(appData.root);

  assert.throws(
    () => validateConfig(withRepositoryBase(clonePath, undefined), PLATFORMS_WITH_BASE, appData.dir),
    refusal('invalid_request', 'workspace.baseUrl'),
  );

  const plain = validateConfig(completeConfig(clonePath), PLATFORMS_WITH_BASE, appData.dir);
  assert.equal(plain.workspace.baseUrl, undefined, 'a platform not in needsBaseUrl needs no baseUrl');
  assert.equal('baseUrl' in plain.workspace, false, 'no baseUrl key is invented');
});

test('FR-016 validateBaseUrl names the field it was given', async () => {
  const { validateBaseUrl } = await import('../../src/config.ts');

  assert.doesNotThrow(() => validateBaseUrl('workspace.baseUrl', 'http://localhost:8929'));
  assert.throws(
    () => validateBaseUrl('issueTracker.site', 'http://gitlab.example.com'),
    refusal('invalid_request', 'issueTracker.site'),
  );
  assert.throws(() => validateBaseUrl('workspace.baseUrl', 'not a url'), refusal('invalid_request', 'workspace.baseUrl'));
});
