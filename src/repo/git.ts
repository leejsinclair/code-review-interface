// Git runner (research R9, constitution IX.1 and IX.2).
//
// The only module under src/repo/ that starts a process. Every git invocation the
// workbench makes is an entry in GIT_COMMANDS; `run` fills the entry's `{name}`
// placeholders and calls execFile('git', [...hardened -c options, ...args]) with an
// argument array, never a shell, and an allowlisted environment.
//
// Refusals happen before git runs: an unknown command, a missing parameter, a
// parameter value that starts with `-` (argument injection) or holds a NUL, and a
// `refs/prwb/` ref that is not a well-formed ref once filled (`..`, `//`, a
// component starting with `.`, and so on). Every ref the table writes starts with
// the literal `refs/prwb/`, so a well-formed filled ref cannot leave that namespace.

import { execFile as nodeExecFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

export interface GitCommand {
  /** `args[0]` is the literal subcommand; `{name}` tokens are filled from params. */
  readonly args: readonly string[];
}

/** The ref namespace the workbench owns; it never writes a ref outside it. */
export const PRWB_REF_PREFIX = 'refs/prwb/';

/**
 * The only git invocations the workbench makes (R9). Later tasks call them by name.
 * No entry runs checkout, switch, pull, merge, rebase, reset, stash, clean or
 * worktree prune.
 */
export const GIT_COMMANDS = Object.freeze({
  /** Lists the clone's remotes, to match it to the PR's repository. */
  listRemotes: { args: ['remote', '-v'] },
  /** Fetches one PR ref (head or target) into refs/prwb/<session>/<snapshot>/<side>. */
  fetchToPrwbRef: {
    args: [
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--no-recurse-submodules',
      '{url}',
      '+{sourceRef}:refs/prwb/{sessionId}/{snapshotId}/{side}',
    ],
  },
  /** Prints the merge base of the target and head commits. */
  mergeBase: { args: ['merge-base', '{targetCommit}', '{headCommit}'] },
  /** Per-file added/deleted counts, NUL separated; `-` counts mark binary files. */
  diffNumstat: {
    args: ['diff', '-M', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--no-color', '{baseCommit}', '{headCommit}'],
  },
  /** The unified patch between base and head, for unified-diff.ts. */
  diffPatch: {
    args: ['diff', '-M', '--patch', '--no-ext-diff', '--no-textconv', '--no-color', '{baseCommit}', '{headCommit}'],
  },
  /** Prints an object's type (`commit`, `tree`, `blob`, `tag`); fails when it is absent. */
  objectType: { args: ['cat-file', '-t', '{object}'] },
  /** Exits 0 when the path exists at the commit. */
  fileExistsAtCommit: { args: ['cat-file', '-e', '{commit}:{path}'] },
  /** Prints the size in bytes of the file at the commit. */
  fileSizeAtCommit: { args: ['cat-file', '-s', '{commit}:{path}'] },
  /** Prints the raw content of the file at the commit (see readFileAtCommit). */
  readFileAtCommit: { args: ['cat-file', '-p', '{commit}:{path}'] },
  /** `show <commit>:<path>` with no textconv filter, the same bytes as readFileAtCommit. */
  showFileAtCommit: { args: ['show', '--no-textconv', '{commit}:{path}'] },
  /** Adds a detached worktree at a path in the app-data workspaces directory. */
  addWorktree: { args: ['worktree', 'add', '--detach', '{worktreePath}', '{commit}'] },
  /** Removes one workbench worktree by its path (never a global prune). */
  removeWorktree: { args: ['worktree', 'remove', '--force', '{worktreePath}'] },
  /** Lists the clone's worktrees in porcelain form. */
  listWorktrees: { args: ['worktree', 'list', '--porcelain'] },
  /** Deletes one ref under refs/prwb/ (`ref` is the part after the prefix). */
  deletePrwbRef: { args: ['update-ref', '-d', 'refs/prwb/{ref}'] },
  /** Lists every workbench ref as `<refname> <objectname>` lines. */
  listPrwbRefs: { args: ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/prwb/'] },
  /** Lists one session's workbench refs as `<refname> <objectname>` lines. */
  listSessionPrwbRefs: {
    args: ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/prwb/{sessionId}/'],
  },
  /** Resolves a revision to a full object id; fails when it does not exist. */
  resolveRevision: { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', '{rev}'] },
  /** Prints the clone's top-level directory, to confirm a path is a work tree. */
  showTopLevel: { args: ['rev-parse', '--show-toplevel'] },
} satisfies Record<string, GitCommand>) as Readonly<Record<GitCommandName, GitCommand>>;

export type GitCommandName =
  | 'listRemotes'
  | 'fetchToPrwbRef'
  | 'mergeBase'
  | 'diffNumstat'
  | 'diffPatch'
  | 'objectType'
  | 'fileExistsAtCommit'
  | 'fileSizeAtCommit'
  | 'readFileAtCommit'
  | 'showFileAtCommit'
  | 'addWorktree'
  | 'removeWorktree'
  | 'listWorktrees'
  | 'deletePrwbRef'
  | 'listPrwbRefs'
  | 'listSessionPrwbRefs'
  | 'resolveRevision'
  | 'showTopLevel';

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface GitRunOptions {
  cwd: string;
  /** `buffer` returns stdout as bytes (file content); default text. */
  encoding?: 'utf8' | 'buffer';
}

export interface GitResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export interface Git {
  run(command: string, params: Readonly<Record<string, string>>, options: GitRunOptions): Promise<GitResult>;
}

export interface CreateGitOptions {
  /** `<app-data>/empty-hooks`, so no repository hook ever runs. */
  hooksPath: string;
  execFile?: ExecFileLike;
}

/** Raised for a call refused before git runs. */
export class GitCommandError extends Error {
  readonly command: string;
  constructor(command: string, message: string) {
    super(`git ${command}: ${message}`);
    this.name = 'GitCommandError';
    this.command = command;
  }
}

/** Variables passed through to git; everything else (GIT_DIR, GIT_CONFIG_*, secrets) is dropped. */
const ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_SSH_VARIANT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
]);

const HARDENED_CONFIG = [
  'core.fsmonitor=false',
  'protocol.file.allow=user',
  'protocol.ext.allow=never',
  'submodule.recurse=false',
];

const MAX_BUFFER = 512 * 1024 * 1024;

const PLACEHOLDER = /\{(\w+)\}/g;

export function gitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && ENV_ALLOWLIST.has(key.toUpperCase())) env[key] = value;
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

function fill(command: string, template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined) throw new GitCommandError(command, `missing parameter ${name}`);
    return value;
  });
}

/** git check-ref-format rules, for a filled ref under refs/prwb/. */
function checkPrwbRef(command: string, ref: string, isPattern: boolean): void {
  const fail = (): never => {
    throw new GitCommandError(command, `refuses ref ${JSON.stringify(ref)}: not a well-formed ref under ${PRWB_REF_PREFIX}`);
  };
  if (!ref.startsWith(PRWB_REF_PREFIX)) fail();
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(ref) || ref.includes('..') || ref.includes('@{')) fail();
  const body = isPattern && ref.endsWith('/') ? ref.slice(0, -1) : ref;
  for (const component of body.split('/')) {
    if (component === '' || component.startsWith('.') || component.endsWith('.lock')) fail();
  }
  if (body.endsWith('.')) fail();
}

function defaultExecFile(): ExecFileLike {
  const run = promisify(nodeExecFile);
  return (file, args, options) => run(file, [...args], options);
}

export function createGit(options: CreateGitOptions): Git {
  const execFile = options.execFile ?? defaultExecFile();
  const prefix = ['-c', `core.hooksPath=${options.hooksPath}`];
  for (const config of HARDENED_CONFIG) prefix.push('-c', config);

  return {
    async run(command, params, runOptions) {
      if (!Object.hasOwn(GIT_COMMANDS, command)) throw new GitCommandError(command, 'is not in the command table');
      const entry = (GIT_COMMANDS as Readonly<Record<string, GitCommand>>)[command] as GitCommand;

      for (const [name, value] of Object.entries(params)) {
        if (value.startsWith('-')) throw new GitCommandError(command, `parameter ${name} must not start with "-"`);
        if (value.includes('\0')) throw new GitCommandError(command, `parameter ${name} holds a NUL character`);
      }

      const isPattern = entry.args[0] === 'for-each-ref';
      const args = entry.args.map((template) => {
        const filled = fill(command, template, params);
        const at = template.indexOf(PRWB_REF_PREFIX);
        if (at >= 0) checkPrwbRef(command, fill(command, template.slice(at), params), isPattern);
        return filled;
      });

      const execOptions: ExecFileOptions = {
        cwd: runOptions.cwd,
        env: gitEnv(),
        shell: false,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        encoding: runOptions.encoding ?? 'utf8',
      };
      return execFile('git', [...prefix, ...args], execOptions);
    },
  };
}

/** Number of lines in a file's content: newline count, plus one for an unterminated last line. */
export function countLines(content: string | Buffer): number {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  if (text === '') return 0;
  let lines = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines += 1;
  return text.endsWith('\n') ? lines : lines + 1;
}

/** The file's bytes at a commit (cat-file -p, no filters). */
export async function readFileAtCommit(git: Git, cwd: string, commit: string, path: string): Promise<Buffer> {
  const { stdout } = await git.run('readFileAtCommit', { commit, path }, { cwd, encoding: 'buffer' });
  return typeof stdout === 'string' ? Buffer.from(stdout, 'utf8') : stdout;
}

/** The file's line count at a commit, for checking that a cited range is inside the file. */
export async function countLinesAtCommit(git: Git, cwd: string, commit: string, path: string): Promise<number> {
  return countLines(await readFileAtCommit(git, cwd, commit, path));
}
