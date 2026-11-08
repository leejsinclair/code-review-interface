// Git sandbox for repository-safety and fetch tests (XI.3).
//
// Builds, under one temporary directory:
//   platform.git  a bare repository standing in for the hosting platform (the PR's base repo)
//   fork.git      a bare fork of it, for PRs whose head lives in another repository
//   author/       a scratch working clone the sandbox uses to make commits and push them
//   clone/        the reviewer's clone, with `origin` pointing at the platform
//
// PRs are modelled both ways a platform exposes a head: as `refs/pull/<n>/head` on the base
// repository, and as the source branch on the repository it was pushed to (base or fork).
//
// `fingerprint(clone)` captures everything repository safety (IX.1, IX.2) says must not change.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** A file's new content; `null` deletes it; `executable` sets mode 100755. */
export type FileChange = string | null | { content: string; executable: true };
export type FileChanges = Record<string, FileChange>;

/** Where a PR head can be fetched from: a repository URL and a ref in it. */
export interface HeadLocation {
  remoteUrl: string;
  ref: string;
}

export interface SandboxPr {
  number: number;
  branch: string;
  targetBranch: string;
  fromFork: boolean;
  /** Current head commit. */
  head: string;
  /** Every head the PR has had, oldest first (includes `head`). */
  heads: string[];
  /** Tip of the target branch on the platform when the PR was last updated. */
  target: string;
  /** The base repository's `refs/pull/<n>/head`, which covers forks. */
  pullRef: HeadLocation;
  /** The source branch in the repository it was pushed to (the fork for a fork PR). */
  sourceBranch: HeadLocation;
}

export interface OpenPrOptions {
  number: number;
  branch: string;
  files: FileChanges;
  message?: string;
  targetBranch?: string;
  fromFork?: boolean;
}

export interface CloneFingerprint {
  /** Checked-out branch name, or `null` when HEAD is detached. */
  branch: string | null;
  head: string;
  /** SHA-256 of `git ls-files -s`. */
  indexHash: string;
  /** `git status --porcelain=v2 --untracked-files=all`. */
  status: string;
  /** `git stash list`, one line per entry with its commit. */
  stash: string;
  /** Every ref outside `refs/prwb/`, as `<refname> <object>`, sorted. */
  refs: string[];
  /** Contents of FETCH_HEAD, or `null` when it does not exist. */
  fetchHead: string | null;
  /** SHA-256 over the paths and contents of modified and untracked files. */
  workingFilesHash: string;
}

export interface DirtyState {
  branch: string;
  staged: string;
  unstaged: string;
  untracked: string;
}

export interface GitSandbox {
  root: string;
  /** Bare base repository (the "platform"). */
  platform: string;
  /** Bare fork of the platform repository. */
  fork: string;
  /** The reviewer's clone. */
  clone: string;
  /** Environment the sandbox runs git with: no system or user config, fixed identity. */
  env: NodeJS.ProcessEnv;
  /** Tip of `main` on the platform after setup. */
  initialCommit: string;
  /** Runs git in `cwd` with the sandbox environment and returns trimmed stdout. */
  git(cwd: string, ...args: string[]): Promise<string>;
  openPr(options: OpenPrOptions): Promise<SandboxPr>;
  /** Adds a commit on top of the PR head and pushes it. */
  pushCommit(number: number, files: FileChanges, message?: string): Promise<SandboxPr>;
  /** Replaces the PR's history with one new commit on the target tip and force-pushes it. */
  forcePush(number: number, files: FileChanges, message?: string): Promise<SandboxPr>;
  /** Adds a commit to a branch on the platform (moves the PR target forward). */
  advanceTarget(files: FileChanges, branch?: string, message?: string): Promise<string>;
  pr(number: number): SandboxPr;
  /** Expires reflogs and prunes unreachable objects in a bare repository. */
  prune(repo: string): Promise<void>;
  /** Moves the fork away so fetches from it fail; returns a function that restores it. */
  makeForkUnreachable(): Promise<() => Promise<void>>;
  /** Puts the reviewer's clone on another branch with a stash, staged, unstaged and untracked changes. */
  dirtyClone(): Promise<DirtyState>;
  /** Checks out a PR's branch in the reviewer's clone, as a reviewer might before starting. */
  checkoutPrBranch(number: number): Promise<void>;
  fingerprint(repo?: string): Promise<CloneFingerprint>;
  cleanup(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

const sha256 = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

function baseFiles(): FileChanges {
  const lines = Array.from({ length: 80 }, (_, i) => `export const value${i + 1} = ${i + 1};`);
  return {
    "README.md": "# widgets\n\nSandbox repository.\n",
    "src/app.js": `${lines.join("\n")}\n`,
    "src/util.js": "export function add(a, b) {\n  return a + b;\n}\n",
  };
}

export async function createGitSandbox(): Promise<GitSandbox> {
  const root = await mkdtemp(join(tmpdir(), "prwb-git-"));
  const platform = join(root, "platform.git");
  const fork = join(root, "fork.git");
  const author = join(root, "author");
  const clone = join(root, "clone");
  const globalConfig = join(root, "gitconfig");

  await writeFile(
    globalConfig,
    [
      "[user]",
      "\tname = Sandbox Author",
      "\temail = author@sandbox.invalid",
      "[init]",
      "\tdefaultBranch = main",
      "[commit]",
      "\tgpgsign = false",
      "[tag]",
      "\tgpgsign = false",
      "[gc]",
      "\tauto = 0",
      "[maintenance]",
      "\tauto = false",
      "",
    ].join("\n"),
  );

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };

  async function gitRaw(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    try {
      const { stdout } = await run("git", args, { cwd, env: { ...env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      const e = error as { stderr?: string; message: string };
      throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${e.stderr?.trim() || e.message}`);
    }
  }
  const git = async (cwd: string, ...args: string[]): Promise<string> => (await gitRaw(cwd, args)).trim();

  async function applyFiles(workdir: string, files: FileChanges): Promise<void> {
    for (const [path, change] of Object.entries(files)) {
      const full = join(workdir, path);
      if (change === null) {
        await git(workdir, "rm", "-q", "--", path);
        continue;
      }
      await mkdir(dirname(full), { recursive: true });
      const content = typeof change === "string" ? change : change.content;
      await writeFile(full, content);
      if (typeof change !== "string") await chmod(full, 0o755);
      await git(workdir, "add", "--", path);
    }
  }

  async function commit(workdir: string, files: FileChanges, message: string): Promise<string> {
    await applyFiles(workdir, files);
    await git(workdir, "commit", "-q", "--allow-empty", "-m", message);
    return git(workdir, "rev-parse", "HEAD");
  }

  // Platform with an initial history on main, a fork of it, and the two working clones.
  await git(root, "init", "-q", "--bare", platform);
  await git(root, "clone", "-q", platform, author);
  await git(author, "remote", "add", "fork", fork);
  await commit(author, baseFiles(), "Initial commit");
  await commit(author, { "src/util.js": "export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n" }, "Add sub");
  await git(author, "push", "-q", "origin", "main");
  await git(platform, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(root, "clone", "-q", "--bare", platform, fork);
  await git(root, "clone", "-q", platform, clone);
  const initialCommit = await git(platform, "rev-parse", "refs/heads/main");

  const prs = new Map<number, SandboxPr>();

  function pr(number: number): SandboxPr {
    const found = prs.get(number);
    if (!found) throw new Error(`no sandbox PR #${number}`);
    return found;
  }

  async function publish(state: SandboxPr, force: boolean): Promise<SandboxPr> {
    const head = await git(author, "rev-parse", "HEAD");
    const remote = state.fromFork ? "fork" : "origin";
    const plus = force ? "+" : "";
    await git(author, "push", "-q", remote, `${plus}HEAD:refs/heads/${state.branch}`);
    // The base repository always carries the PR head, as GitHub does with refs/pull/<n>/head.
    await git(author, "push", "-q", "origin", `+HEAD:refs/pull/${state.number}/head`);
    const target = await git(platform, "rev-parse", `refs/heads/${state.targetBranch}`);
    const next: SandboxPr = { ...state, head, target, heads: [...state.heads, head] };
    prs.set(state.number, next);
    return next;
  }

  const sandbox: GitSandbox = {
    root,
    platform,
    fork,
    clone,
    env,
    initialCommit,
    git,

    async openPr(options) {
      if (prs.has(options.number)) throw new Error(`sandbox PR #${options.number} already exists`);
      const targetBranch = options.targetBranch ?? "main";
      const fromFork = options.fromFork ?? false;
      await git(author, "fetch", "-q", "origin");
      await git(author, "checkout", "-q", "-B", options.branch, `origin/${targetBranch}`);
      await commit(author, options.files, options.message ?? `PR #${options.number}`);
      const state: SandboxPr = {
        number: options.number,
        branch: options.branch,
        targetBranch,
        fromFork,
        head: "",
        heads: [],
        target: "",
        pullRef: { remoteUrl: platform, ref: `refs/pull/${options.number}/head` },
        sourceBranch: { remoteUrl: fromFork ? fork : platform, ref: `refs/heads/${options.branch}` },
      };
      return publish(state, false);
    },

    async pushCommit(number, files, message) {
      const state = pr(number);
      await git(author, "checkout", "-q", "-B", state.branch, state.head);
      await commit(author, files, message ?? `PR #${number} update ${state.heads.length + 1}`);
      return publish(state, false);
    },

    async forcePush(number, files, message) {
      const state = pr(number);
      await git(author, "fetch", "-q", "origin");
      await git(author, "checkout", "-q", "-B", state.branch, `origin/${state.targetBranch}`);
      await commit(author, files, message ?? `PR #${number} rewritten ${state.heads.length + 1}`);
      return publish(state, true);
    },

    async advanceTarget(files, branch = "main", message) {
      await git(author, "fetch", "-q", "origin");
      await git(author, "checkout", "-q", "-B", branch, `origin/${branch}`);
      const head = await commit(author, files, message ?? `Advance ${branch}`);
      await git(author, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
      return head;
    },

    pr,

    async prune(repo) {
      await git(repo, "reflog", "expire", "--expire=now", "--all");
      await git(repo, "gc", "-q", "--prune=now");
    },

    async makeForkUnreachable() {
      const away = `${fork}.unreachable`;
      await rename(fork, away);
      return async () => {
        await rename(away, fork);
      };
    },

    async dirtyClone() {
      const branch = "local-work";
      await git(clone, "checkout", "-q", "-b", branch);
      await writeFile(join(clone, "README.md"), "# widgets\n\nStashed edit.\n");
      await git(clone, "stash", "push", "-q", "-m", "reviewer stash");
      const staged = "src/util.js";
      await writeFile(join(clone, staged), "export function add(a, b) {\n  return b + a;\n}\n");
      await git(clone, "add", "--", staged);
      const unstaged = "src/app.js";
      const app = await readFile(join(clone, unstaged), "utf8");
      await writeFile(join(clone, unstaged), `${app}// unsaved reviewer edit\n`);
      const untracked = "notes.txt";
      await writeFile(join(clone, untracked), "reviewer notes\n");
      return { branch, staged, unstaged, untracked };
    },

    async checkoutPrBranch(number) {
      const state = pr(number);
      const remoteUrl = state.sourceBranch.remoteUrl;
      await git(clone, "fetch", "-q", remoteUrl, `+refs/heads/${state.branch}:refs/remotes/origin/${state.branch}`);
      await git(clone, "checkout", "-q", "-B", state.branch, `refs/remotes/origin/${state.branch}`);
    },

    async fingerprint(repo = clone) {
      return fingerprint(repo, gitRaw);
    },

    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },

    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };

  return sandbox;
}

type GitRunner = (cwd: string, args: string[], extraEnv?: NodeJS.ProcessEnv) => Promise<string>;

async function defaultRunner(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await run("git", args, { cwd, env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Captures the state repository safety protects: current branch, HEAD, index, status, stash,
 * every ref outside `refs/prwb/`, FETCH_HEAD and the contents of modified and untracked files.
 * Reading never takes optional locks, so taking a fingerprint does not itself rewrite the index.
 */
export async function fingerprint(repo: string, runner: GitRunner = defaultRunner): Promise<CloneFingerprint> {
  const noLocks: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0" };
  const g = (...args: string[]) => runner(repo, args, noLocks);

  const branch = (await g("branch", "--show-current")).trim() || null;
  const head = (await g("rev-parse", "HEAD")).trim();
  const indexHash = sha256(await g("ls-files", "-s"));
  const status = await g("status", "--porcelain=v2", "--untracked-files=all");
  const stash = await g("stash", "list", "--format=%gd %H %gs");
  const refs = (await g("for-each-ref", "--format=%(refname) %(objectname)"))
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("refs/prwb/"))
    .sort();

  const gitDir = (await g("rev-parse", "--absolute-git-dir")).trim();
  let fetchHead: string | null = null;
  try {
    fetchHead = await readFile(join(gitDir, "FETCH_HEAD"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const topLevel = (await g("rev-parse", "--show-toplevel")).trim();
  const paths = (await g("ls-files", "-z", "--modified", "--others", "--exclude-standard"))
    .split("\0")
    .filter((p) => p !== "");
  const unique = [...new Set(paths)].sort();
  const files = createHash("sha256");
  for (const path of unique) {
    files.update(`${path}\0`);
    try {
      files.update(await readFile(join(topLevel, path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.update("<deleted>");
    }
    files.update("\0");
  }

  return { branch, head, indexHash, status, stash, refs, fetchHead, workingFilesHash: files.digest("hex") };
}
