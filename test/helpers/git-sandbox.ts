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
import { appendFile, chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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

/** A reviewer's clone of a live HTTP repository, with git credentials kept outside it (R11). */
export interface LiveClone {
  /** Temp directory holding `home/` and `clone/`. */
  root: string;
  /** The reviewer's working clone. */
  clone: string;
  /** Temp `HOME` whose `.gitconfig` uses `credential.helper=store` and whose `.git-credentials` holds the token. */
  home: string;
  /** Environment to run git (or the product) with: `HOME` points at `home`, no system config. */
  env: NodeJS.ProcessEnv;
  /** Runs git in `cwd` with `env` and returns trimmed stdout. */
  git(cwd: string, ...args: string[]): Promise<string>;
  fingerprint(): Promise<CloneFingerprint>;
  cleanup(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Clones `httpUrl` over HTTP into a temp directory, the way a reviewer with stored git credentials
 * would (R11, FR-033). The token lives only in the temp `HOME`'s `.git-credentials`; it never enters
 * the clone's config or its remote URL. `httpUrl` must not carry user info.
 */
export async function liveClone(httpUrl: string, token: string): Promise<LiveClone> {
  const url = new URL(httpUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`liveClone needs an http(s) URL, got ${url.protocol}`);
  if (url.username !== "" || url.password !== "") throw new Error("liveClone: the clone URL must not carry credentials");

  const root = await mkdtemp(join(tmpdir(), "prwb-live-"));
  const home = join(root, "home");
  const clone = join(root, "clone");
  await mkdir(home, { recursive: true });

  await writeFile(
    join(home, ".gitconfig"),
    [
      "[credential]",
      "\thelper = store",
      "[user]",
      "\tname = Live Reviewer",
      "\temail = reviewer@live.invalid",
      "[init]",
      "\tdefaultBranch = main",
      "[gc]",
      "\tauto = 0",
      "[maintenance]",
      "\tauto = false",
      "",
    ].join("\n"),
  );
  const credential = new URL(`${url.protocol}//${url.host}`);
  credential.username = "oauth2";
  credential.password = token;
  await writeFile(join(home, ".git-credentials"), `${credential.href.replace(/\/$/, "")}\n`, { mode: 0o600 });

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
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
      const detail = (e.stderr?.trim() || e.message).split(token).join("[redacted]");
      throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${detail}`);
    }
  }
  const git = async (cwd: string, ...args: string[]): Promise<string> => (await gitRaw(cwd, args)).trim();

  try {
    await git(root, "clone", "-q", url.href, clone);
    const config = await readFile(join(clone, ".git", "config"), "utf8");
    if (config.includes(token)) throw new Error("liveClone: the token reached the clone's config");
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  const dispose = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true });
  };
  return {
    root,
    clone,
    home,
    env,
    git,
    fingerprint: () => fingerprint(clone, gitRaw),
    cleanup: dispose,
    [Symbol.asyncDispose]: dispose,
  };
}

// ---------------------------------------------------------------------------------------------
// Base folder (feature 003, T032): a folder of clones for workspace discovery tests.

/** Named folders of a {@link BaseFolder}, absolute. */
export interface BaseFolderPaths {
  /** Depth 1: `Acme/Widgets` (HTTPS remote). */
  widgets: string;
  /** Depth 2: `acme/gizmos` (scp-style remote). */
  gizmos: string;
  /** Depth 3: `acme/gadgets`. */
  gadgets: string;
  /** Inside `widgets`: `acme/inner`. */
  inner: string;
  /** Same repository as `widgets`, three levels deeper. */
  widgetsCopy: string;
  /** Two folders for `acme/twins` at the same depth; `twinA` sorts first in code-point order. */
  twinA: string;
  twinB: string;
  /** A clone on another host. */
  otherHost: string;
  /** A clone with no remote. */
  noRemote: string;
  /** A fork clone: `origin` is `me/widgets-fork`, `upstream` is `acme/forked`. */
  fork: string;
  /** A folder whose `.git` is a file (separate git directory): `acme/gitfile`. */
  gitFile: string;
  /** A folder with an unreadable `.git`. */
  broken: string;
  /** A symbolic link, inside the base folder, to a repository outside it (`acme/linked`). */
  link: string;
  /** The repository the link points at. */
  linkTarget: string;
  /** A repository in the app-data folder inside the base folder (`acme/appdata`). */
  appDataRepo: string;
}

export interface BaseFolder {
  /** Temp directory holding the base folder and what sits outside it. */
  root: string;
  /** The base folder. */
  base: string;
  /** An application-data folder inside the base folder. */
  appData: string;
  folders: BaseFolderPaths;
  /** Platform repository ids a GitHub-style discovery matches, lower-case. */
  expectedMatched: string[];
  /** Every real repository folder (links excluded), for before and after fingerprints. */
  repositories: string[];
  git(cwd: string, ...args: string[]): Promise<string>;
  cleanup(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Builds a base folder holding clones at depths 1 to 3, a repository inside another's folder, a clone
 * on another host, one with no remote, a fork naming two repositories, the same repository in two
 * folders, a symbolic link to a repository, and the application-data folder with a repository in it.
 * Remotes point at github.com addresses that are never contacted; nothing here touches the network.
 */
export async function makeBaseFolder(): Promise<BaseFolder> {
  const root = await mkdtemp(join(tmpdir(), "prwb-base-"));
  const base = join(root, "base");
  const appData = join(base, "app-data");
  const globalConfig = join(root, "gitconfig");
  await mkdir(base, { recursive: true });
  await writeFile(
    globalConfig,
    ["[user]", "\tname = Base Author", "\temail = author@base.invalid", "[init]", "\tdefaultBranch = main", "[commit]", "\tgpgsign = false", "[gc]", "\tauto = 0", ""].join("\n"),
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
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    try {
      const { stdout } = await run("git", args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
      return stdout.trim();
    } catch (error) {
      const e = error as { stderr?: string; message: string };
      throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${e.stderr?.trim() || e.message}`);
    }
  };

  const repositories: string[] = [];
  /** A repository with one commit and the given remotes (name to URL). */
  async function repo(path: string, remotes: Record<string, string>, gitDir?: string): Promise<string> {
    await mkdir(path, { recursive: true });
    if (gitDir !== undefined) await mkdir(dirname(gitDir), { recursive: true });
    await git(path, "init", "-q", ...(gitDir === undefined ? [] : ["--separate-git-dir", gitDir]));
    for (const [name, url] of Object.entries(remotes)) await git(path, "remote", "add", name, url);
    await writeFile(join(path, "README.md"), `# ${path}\n`);
    await git(path, "add", "README.md");
    await git(path, "commit", "-q", "-m", "initial");
    repositories.push(path);
    return path;
  }

  const widgets = await repo(join(base, "widgets"), { origin: "https://github.com/Acme/Widgets.git" });
  const gizmos = await repo(join(base, "team", "gizmos"), { origin: "git@github.com:acme/gizmos.git" });
  const gadgets = await repo(join(base, "team", "deep", "gadgets"), { origin: "https://github.com/acme/gadgets" });
  const inner = await repo(join(widgets, "vendor", "inner"), { origin: "https://github.com/acme/inner.git" });
  // The nested clone must not show up as an untracked directory of its parent (fingerprints read untracked files).
  await appendFile(join(widgets, ".git", "info", "exclude"), "vendor/\n");
  const widgetsCopy = await repo(join(base, "copies", "old", "widgets-copy"), { origin: "https://github.com/acme/widgets.git" });
  const twinA = await repo(join(base, "twins", "a"), { origin: "https://github.com/acme/twins.git" });
  const twinB = await repo(join(base, "twins", "b"), { origin: "https://github.com/acme/twins.git" });
  const otherHost = await repo(join(base, "elsewhere"), { origin: "https://gitlab.example.com/acme/other.git" });
  const noRemote = await repo(join(base, "no-remote"), {});
  const fork = await repo(join(base, "fork"), {
    origin: "https://github.com/me/widgets-fork.git",
    upstream: "https://github.com/acme/forked.git",
  });
  const gitFile = await repo(join(base, "gitfile"), { origin: "https://github.com/acme/gitfile.git" }, join(root, "git-dirs", "gitfile"));
  const broken = join(base, "broken");
  await mkdir(join(broken, ".git"), { recursive: true });
  const linkTarget = await repo(join(root, "outside", "linked"), { origin: "https://github.com/acme/linked.git" });
  const link = join(base, "link-to-linked");
  await symlink(linkTarget, link, "dir");
  const appDataRepo = await repo(join(appData, "clones", "appdata"), { origin: "https://github.com/acme/appdata.git" });
  // Outside repositories (the link target) are not under the base folder, so they are not scanned or listed.
  repositories.splice(repositories.indexOf(linkTarget), 1);
  repositories.splice(repositories.indexOf(appDataRepo), 1);

  const dispose = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true });
  };
  return {
    root,
    base,
    appData,
    folders: { widgets, gizmos, gadgets, inner, widgetsCopy, twinA, twinB, otherHost, noRemote, fork, gitFile, broken, link, linkTarget, appDataRepo },
    expectedMatched: ["acme/forked", "acme/gadgets", "acme/gitfile", "acme/gizmos", "acme/inner", "acme/twins", "acme/widgets", "me/widgets-fork"],
    repositories,
    git,
    cleanup: dispose,
    [Symbol.asyncDispose]: dispose,
  };
}

/**
 * A clone that discovery matches to a repository but whose head cannot be fetched: `origin` names the
 * repository, and the address a fetch would use is rewritten to `nowhere`, a folder that does not
 * exist, so the fetch fails at once and no network is touched. Used where a test needs a matched clone
 * whose snapshot has no local head (its diff then comes from the platform).
 */
export async function makeUnfetchableClone(folder: string, remoteUrl: string, fetchUrl: string, nowhere: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: dirname(folder), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const git = (...args: string[]) => run("git", args, { cwd: folder, env });
  await git("init", "-q");
  await git("remote", "add", "origin", remoteUrl);
  await git("config", `url.file://${nowhere}.insteadOf`, fetchUrl);
}
