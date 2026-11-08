// VO-074 (FR-022): the provider starts the CLI in restricted mode with read and search tools only,
// strict MCP configuration and the session's worktree as its one added directory; its working
// directory is an empty directory under provider-home/, outside the worktree and the clone; its
// environment holds no platform token; PR, issue and code text reach it only on standard input.

import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, relative, isAbsolute } from 'node:path';
import { test } from 'node:test';
import { registerSecret } from '../../src/log.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { useFakeAiCli } from '../helpers/fake-ai-cli.ts';
import { createFakeKeyring } from '../helpers/fake-keyring.ts';
import { createGitSandbox } from '../helpers/git-sandbox.ts';

const TOKEN = 'ghp_fakeKeyringToken0123456789abcdef';
const PR_TEXT = 'PR-TEXT-7f3a reset tokens are reusable';
const ISSUE_TEXT = 'ISSUE-TEXT-91b2 customers reset twice';
const CODE_TEXT = 'CODE-TEXT-c4d5';

const inside = (child: string, parent: string): boolean => {
  const rel = relative(realpathSync(parent), child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

test('VO-074 the CLI runs restricted with read and search tools, one added directory, an empty cwd, no token, and data only on stdin', async (t) => {
  const appData = await useTempAppData(t);
  const fake = await useFakeAiCli(t, {
    scenario: 'structured',
    answer: { claims: [{ text: 'Tokens are reusable.', label: 'inference', refs: [] }], unsupportedAssumptions: [], suggestedFollowUps: [] },
  });
  const { createAiProvider, registeredAiProviders } = await import('../../src/adapters/ai-registry.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const { createCredentials } = await import('../../src/credentials.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { createRepositoryManager } = await import('../../src/repo/manager.ts');
  const { buildPrompt } = await import('../../src/core/prompt.ts');
  const { DEFAULT_LIMITS } = await import('../../src/core/limits.ts');

  const paths = await ensureAppData({ dir: appData.dir });
  const credentials = createCredentials({ keyring: createFakeKeyring(), registerSecret });
  await credentials.save('github', { secret: TOKEN, scheme: 'bearer' });
  const savedEnv = { GITHUB_TOKEN: process.env['GITHUB_TOKEN'], GH_TOKEN: process.env['GH_TOKEN'], PRWB_PLATFORM_SECRET: process.env['PRWB_PLATFORM_SECRET'] };
  t.after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  // Tokens a careless provider might pass on: the workbench process's own environment.
  process.env['GITHUB_TOKEN'] = TOKEN;
  process.env['GH_TOKEN'] = TOKEN;
  process.env['PRWB_PLATFORM_SECRET'] = TOKEN;

  const sandbox = await createGitSandbox();
  t.after(() => sandbox.cleanup());
  const git = createGit({ hooksPath: paths.emptyHooks });
  const manager = createRepositoryManager({ git, workspacesDir: paths.workspaces });
  const head = await sandbox.git(sandbox.clone, 'rev-parse', 'HEAD');
  const worktree = await manager.createWorkspace(sandbox.clone, 'session-1', 'snapshot-1', head);

  const prompt = buildPrompt({
    output: 'answer',
    snapshot: { headCommit: head, title: 'Allow password reset more than once', description: PR_TEXT },
    question: {
      text: 'Why are tokens reusable?',
      category: 'why',
      audience: 'technical',
      scope: { type: 'pr', path: null, side: null, startLine: null, endLine: null, label: null },
    },
    issues: [{ platform: 'tracker-a', key: 'ABC-12', title: 'Reset twice', descriptionText: ISSUE_TEXT }],
    files: [{ path: 'src/util.js', oldPath: null, status: 'modified', additions: 1, deletions: 0, patch: `@@ -1 +1 @@\n-a\n+${CODE_TEXT}\n`, excludedReason: null }],
    limits: DEFAULT_LIMITS,
  });

  assert.deepEqual(registeredAiProviders(), ['claude-code-cli']);
  const provider = createAiProvider('claude-code-cli', { providerHome: paths.providerHome });
  const caps = await provider.capabilities();
  assert.equal(caps.installed, true);
  assert.equal(caps.unavailableReason, undefined);

  const events = [];
  for await (const event of provider.ask({ requestId: randomUUID(), workspacePath: worktree, instructions: prompt.instructions, data: prompt.data, output: 'answer' })) {
    events.push(event);
  }
  assert.equal(events.at(-1)?.type, 'result', JSON.stringify(events.at(-1)));

  const [run] = await fake.invocations();
  assert.ok(run, 'one run recorded');
  const argv = run.argv;
  const valueOf = (flag: string) => argv[argv.indexOf(flag) + 1];
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes('--restricted'), 'restricted mode');
  assert.equal(valueOf('--tools'), 'Read,Grep,Glob', 'read and search tools only');
  assert.ok(argv.includes('--strict-mcp-config'));
  assert.ok(argv.includes('--disable-slash-commands'));
  assert.equal(argv.filter((a) => a === '--add-dir').length, 1, 'one --add-dir');
  assert.equal(valueOf('--add-dir'), worktree, 'the worktree is the only added directory');
  for (const flag of ['--mcp-config', '--settings', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--plugin-dir']) {
    assert.ok(!argv.includes(flag), `no ${flag}`);
  }

  assert.ok(inside(run.cwd, paths.providerHome), `cwd ${run.cwd} is under provider-home/`);
  assert.ok(!inside(run.cwd, worktree) && !inside(run.cwd, sandbox.clone), 'cwd is outside the worktree and the clone');
  assert.deepEqual(run.cwdEntries, [], 'cwd was empty');
  assert.equal(existsSync(run.cwd), false, 'cwd is removed after the run');

  for (const [key, value] of Object.entries(run.env)) {
    assert.ok(!String(value).includes(TOKEN), `env ${key} holds no platform token`);
  }
  assert.ok(run.env['PATH'], 'PATH is passed so the CLI runs');

  const joined = argv.join('\n');
  for (const text of [PR_TEXT, ISSUE_TEXT, CODE_TEXT]) {
    assert.ok(run.stdin.includes(text), `stdin carries ${text}`);
    assert.ok(!joined.includes(text), `argv never carries ${text}`);
  }
  assert.equal(run.stdin, prompt.data, 'stdin is exactly the data block');
  assert.ok(joined.includes(prompt.instructions), 'the instructions go in as the appended system prompt');
});
