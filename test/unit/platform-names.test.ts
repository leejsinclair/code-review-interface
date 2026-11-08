// VO-036 (FR-025, constitution VIII.2): no platform or provider name appears in
// `src/` outside `src/adapters/`. Core and UI code depend only on the neutral
// contracts in `src/contracts/`, so `PlatformId` is a plain string there.
//
// The scan is written here, proved against a planted tree, then run on the real
// tree. The real-tree test also requires the neutral shared contract (T021), so
// the tree it passes on is one that has the contracts the guard protects.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Names that may appear only under `src/adapters/`. Matched case-insensitively, anywhere in a word. */
const FORBIDDEN = ['github', 'bitbucket', 'jira', 'atlassian', 'claude'] as const;

interface Finding {
  /** Path relative to the scanned `src/`, `/`-separated. */
  file: string;
  name: (typeof FORBIDDEN)[number];
  /** 1-based line number, or 0 when the name is in the file's path. */
  line: number;
}

const toPosix = (p: string): string => p.split(sep).join('/');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Scans `<root>/src`, skipping `<root>/src/adapters/`, for any forbidden name in a path or in file content. */
async function findPlatformNames(root: string): Promise<Finding[]> {
  const src = join(root, 'src');
  const findings: Finding[] = [];
  if (!existsSync(src)) return findings;
  for await (const full of walk(src)) {
    const rel = toPosix(relative(src, full));
    if (rel === 'adapters' || rel.startsWith('adapters/')) continue;
    const lowerPath = rel.toLowerCase();
    for (const name of FORBIDDEN) if (lowerPath.includes(name)) findings.push({ file: rel, name, line: 0 });
    const lines = (await readFile(full, 'utf8')).split(/\r?\n/);
    lines.forEach((text, i) => {
      const lower = text.toLowerCase();
      for (const name of FORBIDDEN) if (lower.includes(name)) findings.push({ file: rel, name, line: i + 1 });
    });
  }
  return findings;
}

async function plantTree(t: { after(fn: () => unknown): void }, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prwb-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, ...path.split('/'));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test('VO-036 the platform-name check fails on a name planted in core code, in any case', async (t) => {
  const root = await plantTree(t, {
    'src/core/sessions.ts': 'export const ok = 1;\nconst host = "api.GitHub.com";\n',
    'src/ui/labels.ts': '// Ask CLAUDE about it\n',
    'src/store/db.ts': 'export const x = "JiraKey";\n',
    'src/server/routes.ts': 'const site = "x.atlassian.net"; const b = "BitBucket";\n',
  });
  const findings = await findPlatformNames(root);
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line}:${f.name}`).sort(),
    [
      'core/sessions.ts:2:github',
      'server/routes.ts:1:atlassian',
      'server/routes.ts:1:bitbucket',
      'store/db.ts:1:jira',
      'ui/labels.ts:1:claude',
    ],
  );
});

test('VO-036 the platform-name check fails on a name in a file or directory path', async (t) => {
  const root = await plantTree(t, {
    'src/core/github-helpers.ts': 'export const neutral = 1;\n',
    'src/ui/Jira/view.tsx': 'export const neutral = 2;\n',
  });
  const findings = await findPlatformNames(root);
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line}:${f.name}`).sort(),
    ['core/github-helpers.ts:0:github', 'ui/Jira/view.tsx:0:jira'],
  );
});

test('VO-036 the platform-name check skips src/adapters/ and passes on a neutral tree', async (t) => {
  const root = await plantTree(t, {
    'src/adapters/github/source-control.ts': 'export const id = "github";\n',
    'src/adapters/registry.ts': 'import "./bitbucket/source-control.ts"; // jira, atlassian, claude\n',
    'src/adapters/claude-code-cli/adapter.ts': 'export const id = "claude-code-cli";\n',
    'src/core/sessions.ts': 'export type PlatformId = string;\n',
    'src/ui/app.css': 'body { color: black; }\n',
  });
  assert.deepEqual(await findPlatformNames(root), []);

  // A directory that only starts like `adapters` is not skipped.
  const lookalike = await plantTree(t, { 'src/adapters-old/x.ts': 'const h = "github";\n' });
  assert.deepEqual(
    (await findPlatformNames(lookalike)).map((f) => `${f.file}:${f.line}:${f.name}`),
    ['adapters-old/x.ts:1:github'],
  );
});

test('VO-036 the real src/ tree has the neutral shared contract and names no platform outside src/adapters/', async () => {
  // The neutral contracts must exist: core and UI code name platforms through them, never directly (T021).
  const shared = await import('../../src/contracts/shared.ts');
  assert.equal(typeof shared.AdapterError, 'function', 'src/contracts/shared.ts exports the AdapterError class');
  assert.ok(shared.AdapterError.prototype instanceof Error, 'AdapterError extends Error');

  const findings = await findPlatformNames(REPO_ROOT);
  assert.deepEqual(
    findings.map((f) => `src/${f.file}${f.line ? `:${f.line}` : ''} names ${f.name}`),
    [],
    'platform and provider names belong only under src/adapters/',
  );
});
