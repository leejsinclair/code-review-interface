// Git sandbox for the specification lookup (feature 006). A project repository with a bare remote, spec folders
// on `develop` and on matching branches, and a nested clone of the pull request repository inside the project
// clone, so "enclosing project repository" is a path fact, as on the reviewer's machine.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type SpecFiles = Record<string, string>;

export interface SpecSandbox {
  root: string;
  /** The bare remote of the project repository. */
  remote: string;
  /** The project repository clone (the enclosing one). */
  project: string;
  /** The nested clone of the pull request repository, at `<project>/apps/job`. */
  nested: string;
  /** Its bare remote. */
  nestedRemote: string;
  git(cwd: string, ...args: string[]): Promise<string>;
  /**
   * Commits `files` (paths relative to the repository root) to `branch` of the project remote, creating the
   * branch from `develop` when it is new, and returns the commit.
   */
  commitSpec(branch: string, files: SpecFiles, message?: string): Promise<string>;
  /** As `commitSpec`, to the nested repository's remote. */
  commitNestedSpec(branch: string, files: SpecFiles, message?: string): Promise<string>;
  /** Moves a document on `branch` forward: a new commit that changes only `path`. */
  moveDocument(branch: string, path: string, content: string): Promise<string>;
  /** Every ref name in the project clone, for "no refs other than prwb/ were written" checks. */
  refs(repo?: string): Promise<string[]>;
  cleanup(): Promise<void>;
}

/** Spec Kit style folder content for one key. */
export function specFolder(folder: string, options: { spec?: string; evidence?: string | null; specName?: string } = {}): SpecFiles {
  const files: SpecFiles = {
    [`specs/${folder}/${options.specName ?? 'spec.md'}`]: options.spec ?? '# Spec\n\n- **FR-001**: The system MUST do the first thing.\n- **FR-002**: The system MUST do the second thing.\n',
  };
  if (options.evidence !== null) {
    files[`specs/${folder}/tdd-evidence.md`] = options.evidence ?? '# TDD evidence\n\n- FR-001: test `first` fails then passes.\n';
  }
  return files;
}

export async function createSpecSandbox(): Promise<SpecSandbox> {
  const root = await mkdtemp(join(tmpdir(), 'prwb-spec-'));
  const globalConfig = join(root, 'gitconfig');
  await writeFile(
    globalConfig,
    ['[user]', '\tname = Spec Author', '\temail = author@spec.invalid', '[init]', '\tdefaultBranch = develop', '[commit]', '\tgpgsign = false', '[protocol "file"]', '\tallow = always', ''].join('\n'),
  );
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    try {
      const { stdout } = await run('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
      return stdout.trim();
    } catch (error) {
      const e = error as { stderr?: string; message: string };
      throw new Error(`git ${args.join(' ')} (in ${cwd}) failed: ${e.stderr?.trim() || e.message}`);
    }
  };

  async function bareWithClone(bare: string, clone: string, readme: string): Promise<void> {
    await mkdir(bare, { recursive: true });
    await git(bare, 'init', '-q', '--bare');
    await git(root, 'clone', '-q', bare, clone);
    await writeFile(join(clone, 'README.md'), readme);
    await git(clone, 'add', 'README.md');
    await git(clone, 'commit', '-q', '-m', 'initial');
    await git(clone, 'push', '-q', 'origin', 'develop');
  }

  const remote = join(root, 'project.git');
  const project = join(root, 'project-hd-v3');
  const nestedRemote = join(root, 'job.git');
  const nested = join(project, 'apps', 'job');
  await bareWithClone(remote, project, '# project\n');
  await git(project, 'config', 'core.excludesFile', join(root, 'ignore'));
  await writeFile(join(root, 'ignore'), 'apps/\n');
  await mkdir(dirname(nested), { recursive: true });
  await bareWithClone(nestedRemote, nested, '# job\n');

  // Commits through a scratch clone so the project clone's own branch, index and working files stay untouched.
  async function commitTo(bare: string, branch: string, files: SpecFiles, message: string): Promise<string> {
    const scratch = await mkdtemp(join(root, 'scratch-'));
    await git(root, 'clone', '-q', bare, scratch);
    const heads = await git(scratch, 'branch', '-r');
    if (branch !== 'develop') {
      if (heads.includes(`origin/${branch}`)) await git(scratch, 'checkout', '-q', '-b', branch, `origin/${branch}`);
      else await git(scratch, 'checkout', '-q', '-b', branch, 'origin/develop');
    }
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(scratch, path)), { recursive: true });
      await writeFile(join(scratch, path), content);
    }
    await git(scratch, 'add', '-A');
    await git(scratch, 'commit', '-q', '-m', message);
    await git(scratch, 'push', '-q', 'origin', branch);
    const sha = await git(scratch, 'rev-parse', 'HEAD');
    await rm(scratch, { recursive: true, force: true });
    return sha;
  }

  return {
    root,
    remote,
    project,
    nested,
    nestedRemote,
    git,
    commitSpec: (branch, files, message = `Add specs on ${branch}`) => commitTo(remote, branch, files, message),
    commitNestedSpec: (branch, files, message = `Add specs on ${branch}`) => commitTo(nestedRemote, branch, files, message),
    moveDocument: (branch, path, content) => commitTo(remote, branch, { [path]: content }, `Change ${path}`),
    refs: async (repo = project) => (await git(repo, 'for-each-ref', '--format=%(refname)')).split('\n').filter((l) => l !== ''),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
