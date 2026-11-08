// VO-067 (FR-008, constitution IX, research R9): the repository manager's git
// command table.
//
// Contract this file requires of `src/repo/git.ts` (T038):
//
//   export interface GitCommand {
//     // Argument template placed after the hardened `-c` options. `args[0]` is the
//     // literal subcommand. `{name}` tokens are replaced by `params[name]`; a token
//     // may be a whole argument or part of one (e.g. `+{src}:refs/prwb/{session}/{snapshot}/{side}`).
//     readonly args: readonly string[];
//   }
//   // The only git invocations the workbench makes, keyed by a name of its choice.
//   export const GIT_COMMANDS: Readonly<Record<string, GitCommand>>;
//
//   export type ExecFileLike = (
//     file: string,
//     args: readonly string[],
//     options: import('node:child_process').ExecFileOptions,
//   ) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
//
//   export function createGit(options: {
//     hooksPath: string;          // `<app-data>/empty-hooks`
//     execFile?: ExecFileLike;    // default: promisified node:child_process execFile
//   }): {
//     // Runs GIT_COMMANDS[command] with its placeholders filled. Calls
//     // execFile('git', ['-c', `core.hooksPath=${hooksPath}`, '-c', 'core.fsmonitor=false',
//     //   '-c', 'protocol.file.allow=user', '-c', 'submodule.recurse=false', ...filledArgs],
//     //   { cwd, env: <allowlisted env with GIT_TERMINAL_PROMPT=0>, no shell }).
//     // Rejects WITHOUT calling execFile when: the command is unknown, a placeholder
//     // has no param, a param value starts with `-` (argument injection), or a ref
//     // written (fetch refspec destination, update-ref target) is not under
//     // `refs/prwb/` once filled (including any `..` path segment).
//     run(
//       command: string,
//       params: Readonly<Record<string, string>>,
//       options: { cwd: string },
//     ): Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
//   };
//
// The fetch entry must accept these sample params: a placeholder whose name
// contains `url` gets an https URL, one whose name contains `side` gets `head`,
// every other placeholder gets `abc123`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecFileOptions } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempAppData } from '../helpers/app-data.ts';
import { createGitSandbox } from '../helpers/git-sandbox.ts';

type GitModule = typeof import('../../src/repo/git.ts');

const loadGit = async (): Promise<GitModule> => import('../../src/repo/git.ts');

const REPO_DIR = fileURLToPath(new URL('../../src/repo/', import.meta.url));
const GIT_TS = join(REPO_DIR, 'git.ts');

const FORBIDDEN = new Set(['checkout', 'switch', 'pull', 'merge', 'rebase', 'reset', 'stash', 'clean']);
const ALLOWED_SUBCOMMANDS = new Set([
  'remote',
  'fetch',
  'merge-base',
  'diff',
  'cat-file',
  'show',
  'worktree',
  'update-ref',
  'for-each-ref',
  'rev-parse',
]);
const REQUIRED_SUBCOMMANDS = [
  'remote',
  'fetch',
  'merge-base',
  'diff',
  'cat-file',
  'show',
  'worktree',
  'update-ref',
  'for-each-ref',
];
const HARDENED = [
  'core.fsmonitor=false',
  'protocol.file.allow=user',
  'submodule.recurse=false',
];
const PREFIX = 'refs/prwb/';
const SAMPLE_URL = 'https://example.test/team/repo.git';

interface Call {
  file: string;
  args: readonly string[];
  options: ExecFileOptions;
}

function fakeExecFile(calls: Call[]) {
  return async (file: string, args: readonly string[], options: ExecFileOptions) => {
    calls.push({ file, args: [...args], options });
    return { stdout: '', stderr: '' };
  };
}

const placeholders = (arg: string): string[] => [...arg.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');

const isOption = (arg: string): boolean => arg.startsWith('-');

function fill(template: readonly string[], params: Record<string, string>): string[] {
  return template.map((arg) => arg.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`));
}

function sampleParams(template: readonly string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const name of template.flatMap(placeholders)) {
    if (/url/i.test(name)) params[name] = SAMPLE_URL;
    else if (/side/i.test(name)) params[name] = 'head';
    else params[name] = 'abc123';
  }
  return params;
}

/** The fetch refspecs in a template or call: `[+]src:dst` arguments, not the url. */
const refspecs = (args: readonly string[]): string[] =>
  args
    .slice(1)
    .filter((arg) => !isOption(arg) && arg.includes(':') && !/^\{\w+\}$/.test(arg) && !/^[a-z][\w+.-]*:\/\//i.test(arg));

const refspecDestination = (spec: string): string => spec.slice(spec.indexOf(':') + 1);

async function entries(): Promise<[string, readonly string[]][]> {
  const { GIT_COMMANDS } = await loadGit();
  return Object.entries(GIT_COMMANDS as Readonly<Record<string, { readonly args: readonly string[] }>>).map(
    ([name, command]) => [name, command.args],
  );
}

function findEntry(
  all: [string, readonly string[]][],
  subcommand: string,
  action?: string,
): [string, readonly string[]] {
  const found = all.find(([, args]) => args[0] === subcommand && (action === undefined || args[1] === action));
  assert.ok(found, `the command table has no ${[subcommand, action].filter(Boolean).join(' ')} entry`);
  return found;
}

test('VO-067 the command table never runs checkout, switch, pull, merge, rebase, reset, stash, clean or worktree prune', async () => {
  const all = await entries();
  assert.ok(all.length > 0, 'the command table is empty');

  for (const [name, args] of all) {
    assert.ok(Array.isArray(args), `${name}: args is not an argument array`);
    assert.ok(args.length > 0, `${name}: args is empty`);
    for (const arg of args) assert.equal(typeof arg, 'string', `${name}: argument ${String(arg)} is not a string`);

    const sub = args[0] ?? '';
    assert.ok(!isOption(sub) && placeholders(sub).length === 0, `${name}: subcommand ${sub} must be a literal`);
    assert.ok(!FORBIDDEN.has(sub), `${name}: runs forbidden subcommand ${sub}`);
    assert.ok(ALLOWED_SUBCOMMANDS.has(sub), `${name}: subcommand ${sub} is not one research R9 allows`);
    if (sub === 'worktree') {
      assert.notEqual(args[1], 'prune', `${name}: runs worktree prune`);
      assert.ok(['add', 'remove', 'list'].includes(args[1] ?? ''), `${name}: worktree ${args[1]} is not allowed`);
    }
    if (sub === 'remote') assert.deepEqual([...args], ['remote', '-v'], `${name}: only "remote -v" is allowed`);
    for (const arg of args) {
      assert.ok(arg !== '-c' && !arg.startsWith('--config'), `${name}: sets git config itself (${arg})`);
      assert.ok(!FORBIDDEN.has(arg), `${name}: argument ${arg} names a forbidden command`);
    }
  }

  const subs = new Set(all.map(([, args]) => args[0]));
  for (const required of REQUIRED_SUBCOMMANDS) {
    assert.ok(subs.has(required), `the command table has no ${required} entry (research R9)`);
  }
});

test('VO-067 every ref the command table writes is under refs/prwb/', async () => {
  const all = await entries();
  let fetchSpecs = 0;

  for (const [name, args] of all) {
    const sub = args[0];
    if (sub === 'fetch') {
      for (const flag of ['--no-tags', '--no-write-fetch-head', '--no-recurse-submodules']) {
        assert.ok(args.includes(flag), `${name}: fetch lacks ${flag}`);
      }
      const specs = refspecs(args);
      assert.ok(specs.length > 0, `${name}: fetch writes no refs/prwb/ ref`);
      for (const spec of specs) {
        fetchSpecs += 1;
        assert.ok(refspecDestination(spec).startsWith(PREFIX), `${name}: refspec ${spec} writes outside ${PREFIX}`);
      }
    }
    if (sub === 'update-ref') {
      assert.ok(!args.includes('--stdin'), `${name}: update-ref --stdin can write any ref`);
      const target = args.slice(1).find((arg) => !isOption(arg));
      assert.ok(target?.startsWith(PREFIX), `${name}: update-ref target ${target} is outside ${PREFIX}`);
    }
    if (sub === 'worktree' && args[1] === 'add') {
      assert.ok(args.includes('--detach'), `${name}: worktree add without --detach`);
      for (const flag of ['-b', '-B', '--orphan', '--track', '--checkout']) {
        assert.ok(!args.includes(flag), `${name}: worktree add with ${flag} writes a branch`);
      }
    }
    if (sub === 'for-each-ref') {
      const pattern = args.slice(1).find((arg) => !isOption(arg));
      assert.ok(pattern?.startsWith(PREFIX), `${name}: for-each-ref reads outside ${PREFIX}`);
    }
  }
  assert.ok(fetchSpecs > 0, 'no fetch refspec found in the command table');
});

test('VO-067 git.ts runs git only through execFile with an argument array, never a shell', async () => {
  const source = await readFile(GIT_TS, 'utf8');
  assert.match(source, /\bexecFile\b/, 'git.ts does not use execFile');
  assert.doesNotMatch(source, /\bexec(Sync)?\s*\(/, 'git.ts calls exec(), which runs a shell');
  assert.doesNotMatch(source, /\bexecSync\b|\bspawnSync\b|\bexecFileSync\b/, 'git.ts uses a synchronous child process call');
  assert.doesNotMatch(source, /\bshell\s*:\s*(true|['"`])/, 'git.ts enables a shell');

  const others = (await readdir(REPO_DIR, { recursive: true }))
    .map(String)
    .filter((file) => file.endsWith('.ts') && file !== 'git.ts');
  for (const file of others) {
    const text = await readFile(join(REPO_DIR, file), 'utf8');
    assert.doesNotMatch(
      text,
      /['"](node:)?child_process['"]/,
      `src/repo/${file} starts processes itself; git runs only through git.ts`,
    );
  }
});

test('VO-067 every git call carries the hardened -c options, an argument array, no shell and an allowlisted environment', async (t) => {
  const { createGit } = await loadGit();
  const planted: Record<string, string> = {
    PRWB_PLANTED_SECRET: 'planted-secret-value',
    GIT_DIR: '/planted/git-dir',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/planted/hooks',
    GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/planted/hooks'",
  };
  const previous = Object.fromEntries(Object.keys(planted).map((key) => [key, process.env[key]]));
  Object.assign(process.env, planted);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const all = await entries();
  const calls: Call[] = [];
  const hooksPath = '/app-data/empty-hooks';
  const git = createGit({ hooksPath, execFile: fakeExecFile(calls) });
  const cwd = '/reviewer/clone';

  const probes: [string, string | undefined][] = [
    ['remote', undefined],
    ['fetch', undefined],
    ['for-each-ref', undefined],
    ['worktree', 'list'],
  ];
  for (const [sub, action] of probes) {
    const [name, template] = findEntry(all, sub, action);
    const params = sampleParams(template);
    await git.run(name, params, { cwd });
    const call = calls.at(-1);
    assert.ok(call, `${name}: execFile was not called`);
    assert.equal(call.file, 'git', `${name}: runs ${call.file}, not git`);
    assert.ok(Array.isArray(call.args), `${name}: args is not an array`);

    const subIndex = call.args.indexOf(sub);
    assert.ok(subIndex > 0, `${name}: subcommand ${sub} missing from ${call.args.join(' ')}`);
    const before = call.args.slice(0, subIndex);
    const configs: string[] = [];
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] === '-c') configs.push(before[i + 1] ?? '');
    }
    assert.ok(configs.includes(`core.hooksPath=${hooksPath}`), `${name}: lacks core.hooksPath=${hooksPath}`);
    for (const option of HARDENED) assert.ok(configs.includes(option), `${name}: lacks -c ${option}`);
    assert.deepEqual(call.args.slice(subIndex), fill(template, params), `${name}: arguments differ from the table`);

    assert.ok(!call.options.shell, `${name}: runs with a shell`);
    assert.equal(call.options.cwd, cwd, `${name}: wrong cwd`);
    const env = call.options.env;
    assert.ok(env, `${name}: inherits the whole environment`);
    assert.equal(env['GIT_TERMINAL_PROMPT'], '0', `${name}: GIT_TERMINAL_PROMPT is not 0`);
    for (const key of Object.keys(planted)) {
      assert.ok(!(key in env), `${name}: passes ${key} through to git`);
    }
  }

  const fetchCall = calls.find((call) => call.args.includes('fetch'));
  const written = fetchCall ? refspecs(fetchCall.args.slice(fetchCall.args.indexOf('fetch'))) : [];
  assert.ok(written.length > 0, 'the fetch call wrote no ref');
  for (const spec of written) assert.ok(refspecDestination(spec).startsWith(PREFIX), `fetch wrote ${spec}`);
});

test('VO-067 the runner refuses ref writes that escape refs/prwb/ and argument injection, before running git', async () => {
  const { createGit } = await loadGit();
  const all = await entries();
  const calls: Call[] = [];
  const git = createGit({ hooksPath: '/app-data/empty-hooks', execFile: fakeExecFile(calls) });
  const cwd = '/reviewer/clone';

  const [fetchName, fetchTemplate] = findEntry(all, 'fetch');
  const destinationNames = refspecs(fetchTemplate).flatMap((spec) => placeholders(refspecDestination(spec)));
  assert.ok(destinationNames.length > 0, `${fetchName}: refspec destination has no placeholder`);
  for (const target of destinationNames) {
    const params = { ...sampleParams(fetchTemplate), [target]: '../../heads/main' };
    await assert.rejects(git.run(fetchName, params, { cwd }), `${fetchName}: accepted ${target}=../../heads/main`);
  }

  const urlName = fetchTemplate.flatMap(placeholders).find((name) => /url/i.test(name));
  assert.ok(urlName, `${fetchName}: no url placeholder`);
  await assert.rejects(
    git.run(fetchName, { ...sampleParams(fetchTemplate), [urlName]: '--upload-pack=touch /tmp/prwb-pwned' }, { cwd }),
    `${fetchName}: accepted an option as the url`,
  );

  const [updateName, updateTemplate] = findEntry(all, 'update-ref');
  const updateNames = updateTemplate.flatMap(placeholders);
  assert.ok(updateNames.length > 0, `${updateName}: update-ref has no placeholder`);
  for (const target of updateNames) {
    const params = { ...sampleParams(updateTemplate), [target]: '../heads/main' };
    await assert.rejects(git.run(updateName, params, { cwd }), `${updateName}: accepted ${target}=../heads/main`);
  }

  await assert.rejects(git.run('checkout', {}, { cwd }), 'ran a command outside the table');
  assert.equal(calls.length, 0, `git ran for a refused call: ${calls.map((c) => c.args.join(' ')).join(' | ')}`);
});

test('VO-067 the default runner runs real git with an argument array', async (t) => {
  const { createGit } = await loadGit();
  const appData = await useTempAppData(t);
  const hooksPath = join(appData.dir, 'empty-hooks');
  await mkdir(hooksPath, { recursive: true });
  const sandbox = await createGitSandbox();
  t.after(() => sandbox.cleanup());

  const [name] = findEntry(await entries(), 'remote');
  const git = createGit({ hooksPath });
  const result = await git.run(name, {}, { cwd: sandbox.clone });
  const stdout = String(result.stdout);
  assert.match(stdout, /\(fetch\)/, `remote -v printed no remotes: ${stdout}`);
  assert.ok(stdout.includes(dirname(sandbox.platform)), `remote -v did not list the platform remote: ${stdout}`);
});
