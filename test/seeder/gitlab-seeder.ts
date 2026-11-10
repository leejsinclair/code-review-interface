// T019: the GitLab implementation of the neutral PlatformSeeder (FR-023 to FR-029).
//
// Test-only. It writes to a disposable loopback GitLab with the root token over plain global
// `fetch` and the git CLI, and never imports `src/adapters/` or the read-only layer (FR-024).
// Everything it creates carries the run name (`ownedBy`), and cleanup touches nothing else.
//
// Layout of one run, so every project path has nested groups (FR-008, FR-012):
//   user   <run>                         the reviewer, non-administrator
//   group  prwb-it/<run>                 private; `prwb-it` is shared and never deleted
//   repo   prwb-it/<run>/<run>-<label>   reviewer is Reporter, except the hidden one
// GitLab 19 can permanently remove only subgroups; a top-level group stays "deletion scheduled"
// for days under a name that still carries the run's. So each run's group sits under `prwb-it`,
// which no run owns (it does not start with `it-`).

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { isLoopbackHost } from '../../src/config.ts';
import type { FileChange, PlatformSeeder, SeededIssue, SeededPull, SeededRepo, SeededRun } from './platform-seeder.ts';
import { filterLeftovers, makeRunName, ownedBy } from './run-name.ts';

const run = promisify(execFile);
const WAIT_MS = 30_000;
const POLL_MS = 250;
/** Cleanup waits: under parallel runs GitLab's background removal can take minutes. */
const REMOVAL_MS = 180_000;
const REPORTER = 20;
const PARENT_GROUP = 'prwb-it';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Polls `probe` every 250 ms until it returns a value, failing after ~30 s with `what` (FR-026). */
async function until<T>(probe: () => Promise<T | undefined | null | false>, what: string, timeoutMs = WAIT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The root-token REST client, shared with `gitlab:clean`. */
export class GitlabAdmin {
  readonly baseUrl: string;
  readonly #token: string;

  constructor(options: { baseUrl: string; token: string }) {
    const url = new URL(options.baseUrl);
    if (!isLoopbackHost(url.hostname)) throw new Error(`refusing to write to a non-loopback GitLab: ${url.host} (FR-027)`);
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.token;
  }

  get token(): string {
    return this.#token;
  }

  /** One call. Returns the parsed body, or null for 404. Throws on any other failure. */
  async call(method: string, path: string, body?: Json): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const headers: Record<string, string> = { 'private-token': this.#token };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${this.baseUrl}/api/v4${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`GitLab ${method} ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 300)}`);
    return text === '' ? {} : JSON.parse(text);
  }

  async list(path: string): Promise<Json[]> {
    const out: Json[] = [];
    for (let page = 1; ; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = (await this.call('GET', `${path}${sep}per_page=100&page=${page}`)) as Json[] | null;
      if (batch === null || batch.length === 0) return out;
      out.push(...batch);
      if (batch.length < 100) return out;
    }
  }

  /** GitLab only schedules deletion and renames the path, so delete again permanently (R9). */
  async deleteProject(id: number): Promise<void> {
    await this.#removeTwoStep(`/projects/${id}`, (scheduled) => scheduled.path_with_namespace, `project ${id}`);
  }

  /** Subgroups only: GitLab refuses to permanently remove a top-level group. */
  async deleteGroup(id: number): Promise<void> {
    await this.#removeTwoStep(`/groups/${id}`, (scheduled) => scheduled.full_path, `group ${id}`);
  }

  /**
   * GitLab's first DELETE only schedules removal and renames the item; a second DELETE with the new
   * full path removes it (R9). Under load the first DELETE can answer 500 (a Gitaly timeout, or a
   * foreign-key race right after child projects go), so that is retried within the bound. A 400
   * means removal is already scheduled, which the second step finishes.
   */
  async #removeTwoStep(path: string, fullPathOf: (scheduled: Json) => string, label: string): Promise<void> {
    const first = await until(
      () =>
        this.call('DELETE', path).then(
          (body) => ({ body }),
          (error: Error) => {
            if (/ failed: 5\d\d /.test(error.message)) return null;
            if (/ failed: 400 /.test(error.message)) return { body: {} };
            throw error;
          },
        ),
      `${label} to accept deletion`,
    );
    if (first.body === null) return;
    const scheduled = await this.call('GET', path);
    if (scheduled !== null) await this.call('DELETE', `${path}?permanently_remove=true&full_path=${encodeURIComponent(fullPathOf(scheduled))}`);
    await until(async () => (await this.call('GET', path)) === null, `${label} to be removed`, REMOVAL_MS);
  }

  async deleteUser(id: number): Promise<void> {
    if ((await this.call('DELETE', `/users/${id}?hard_delete=true`)) === null) return;
    // GitLab blocks the user at once (its tokens stop working) but removes it in a background job
    // that took about two minutes on 19.5.
    await until(async () => (await this.call('GET', `/users/${id}`)) === null, `user ${id} to be removed`, REMOVAL_MS);
  }

  /** Every `it-*` project, group and user on the instance. */
  async listRunItems(): Promise<{ projects: Json[]; groups: Json[]; users: Json[] }> {
    const isRun = (name: string): boolean => name.startsWith('it-');
    const projects = (await this.list('/projects?search=it-&simple=true')).filter((p) => isRun(p.path));
    const groups = (await this.list('/groups?search=it-&all_available=true')).filter((g) => isRun(g.path));
    const users = (await this.list('/users?search=it-')).filter((u) => isRun(u.username));
    return { projects, groups, users };
  }
}

type RunState = SeededRun & { userId: number; groupId: number };

export class GitlabSeeder implements PlatformSeeder {
  readonly #api: GitlabAdmin;
  #run: RunState | null = null;
  #workDir: string | null = null;
  readonly #tokenIds = new Map<string, number>();
  readonly #clones = new Map<number, string>();
  #hidden: SeededRepo | null = null;

  constructor(options: { baseUrl: string; token: string }) {
    this.#api = new GitlabAdmin(options);
  }

  get #active(): RunState {
    if (this.#run === null) throw new Error('call begin() first');
    return this.#run;
  }

  #owned(name: string): void {
    if (!ownedBy(this.#active.name, name)) throw new Error(`refusing to touch ${name}: not owned by run ${this.#active.name}`);
  }

  async begin(suite: string): Promise<SeededRun> {
    if (this.#run !== null) throw new Error('begin() was already called');
    const name = makeRunName(suite);
    this.#workDir = await mkdtemp(join(tmpdir(), `${name}-`));
    const user = await this.#api.call('POST', '/users', {
      username: name,
      name,
      email: `${name}@prwb.invalid`,
      password: `${randomBytes(18).toString('base64url')}Aa1!`,
      skip_confirmation: true,
      admin: false,
    });
    const parent =
      (await this.#api.call('GET', `/groups/${PARENT_GROUP}`)) ??
      (await this.#api.call('POST', '/groups', { name: PARENT_GROUP, path: PARENT_GROUP, visibility: 'private' }));
    const group = await this.#api.call('POST', '/groups', { name, path: name, parent_id: parent.id, visibility: 'private' });
    this.#run = {
      name,
      baseUrl: this.#api.baseUrl,
      reviewer: { username: name, token: '' },
      repositories: [],
      startedAt: new Date().toISOString(),
      userId: user.id,
      groupId: group.id,
    };
    this.#run.reviewer.token = await this.createReviewerToken();
    return this.#run;
  }

  async cleanup(): Promise<void> {
    const state = this.#run;
    if (state === null) return;
    const failures: string[] = [];
    const attempt = async (label: string, work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message}`);
      }
    };
    for (const repo of [...state.repositories].reverse()) {
      await attempt(repo.id, async () => {
        this.#owned(repo.id.split('/').pop() ?? '');
        await this.#api.deleteProject(repo.platformId);
      });
    }
    await attempt(`group ${PARENT_GROUP}/${state.name}`, () => this.#api.deleteGroup(state.groupId));
    await attempt(`user ${state.name}`, () => this.#api.deleteUser(state.userId));
    if (this.#workDir !== null) await rm(this.#workDir, { recursive: true, force: true });
    const left = await this.#api.listRunItems().catch(() => null);
    if (left !== null) {
      const mine = [...left.projects.map((p) => p.path), ...left.groups.map((g) => g.path), ...left.users.map((u) => u.username)].filter((n) =>
        ownedBy(state.name, n),
      );
      if (mine.length > 0) failures.push(`still present: ${mine.join(', ')}`);
    }
    if (failures.length > 0) console.warn(`[seeder] cleanup of ${state.name} left items behind (remove with npm run gitlab:clean):\n  ${failures.join('\n  ')}`);
  }

  async createRepository(name: string): Promise<SeededRepo> {
    return this.#createProject(name, 'review');
  }

  async #createProject(label: string, kind: SeededRepo['kind']): Promise<SeededRepo> {
    const state = this.#active;
    const path = `${state.name}-${label}`;
    const p = await this.#api.call('POST', '/projects', {
      name: path,
      path,
      namespace_id: state.groupId,
      visibility: 'private',
      default_branch: 'main',
    });
    if (kind !== 'hidden') await this.#api.call('POST', `/projects/${p.id}/members`, { user_id: state.userId, access_level: REPORTER });
    const repo = toRepo(p, kind);
    state.repositories.push(repo);
    // The first commit is pushed, not `initialize_with_readme`: with several projects created at once,
    // GitLab's README commit can time out in Gitaly and the project stays empty with no error.
    await this.pushCommit(repo, 'main', [{ kind: 'add', path: 'README.md', content: `# ${path}\n` }]);
    return repo;
  }

  async deleteRepository(repo: SeededRepo): Promise<void> {
    this.#owned(repo.id.split('/').pop() ?? '');
    await this.#api.deleteProject(repo.platformId);
    this.#active.repositories = this.#active.repositories.filter((r) => r.platformId !== repo.platformId);
  }

  async renameRepository(repo: SeededRepo, newName: string): Promise<SeededRepo> {
    const path = `${this.#active.name}-${newName}`;
    const p = await this.#api.call('PUT', `/projects/${repo.platformId}`, { name: path, path });
    const renamed: SeededRepo = { ...toRepo(p, repo.kind), previousPaths: [...repo.previousPaths, repo.id] };
    this.#replace(renamed);
    const clone = this.#clones.get(repo.platformId);
    if (clone !== undefined) await this.#git(clone, 'remote', 'set-url', 'origin', this.#authUrl(renamed.httpUrl));
    return renamed;
  }

  async forkRepository(repo: SeededRepo): Promise<SeededRepo> {
    const state = this.#active;
    const path = `${repo.id.split('/').pop()}-fork`;
    this.#owned(path);
    const p = await this.#api.call('POST', `/projects/${repo.platformId}/fork`, { namespace_id: state.groupId, name: path, path });
    await until(async () => (await this.#api.call('GET', `/projects/${p.id}`))?.import_status === 'finished' || false, `fork ${path} to finish`);
    await this.#api.call('POST', `/projects/${p.id}/members`, { user_id: state.userId, access_level: REPORTER });
    const fork = toRepo(await this.#api.call('GET', `/projects/${p.id}`), 'fork');
    state.repositories.push(fork);
    return fork;
  }

  async pushCommit(repo: SeededRepo, branch: string, changes: FileChange[]): Promise<string> {
    const dir = await this.#clone(repo);
    await this.#git(dir, 'fetch', '--quiet', 'origin');
    const heads = await this.#git(dir, 'ls-remote', '--heads', 'origin');
    const has = (name: string): boolean => heads.includes(`\trefs/heads/${name}\n`) || heads.endsWith(`\trefs/heads/${name}`);
    if (has(branch)) await this.#git(dir, 'checkout', '--quiet', '-B', branch, `origin/${branch}`);
    else if (has(repo.defaultBranch)) await this.#git(dir, 'checkout', '--quiet', '-B', branch, `origin/${repo.defaultBranch}`);
    else await this.#git(dir, 'checkout', '--quiet', '--orphan', branch); // an empty project's first commit
    for (const change of changes) {
      if (change.kind === 'delete') {
        await this.#git(dir, 'rm', '--quiet', change.path);
      } else if (change.kind === 'rename') {
        await mkdir(dirname(join(dir, change.to)), { recursive: true });
        await this.#git(dir, 'mv', change.from, change.to);
        if (change.content !== undefined) await writeFile(join(dir, change.to), change.content);
      } else {
        await mkdir(dirname(join(dir, change.path)), { recursive: true });
        await writeFile(join(dir, change.path), change.content);
      }
    }
    await this.#git(dir, 'add', '--all');
    await this.#git(dir, 'commit', '--quiet', '--allow-empty', '-m', `seed: ${changes.length} change(s) on ${branch}`);
    const sha = (await this.#git(dir, 'rev-parse', 'HEAD')).trim();
    await this.#git(dir, 'push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`);
    const project = repo.platformId;
    await until(
      async () => (await this.#api.call('GET', `/projects/${project}/repository/branches/${encodeURIComponent(branch)}`))?.commit?.id === sha,
      `branch ${branch} to show ${sha.slice(0, 8)} in ${repo.id}`,
    );
    // An open merge request on this branch picks the push up asynchronously; wait so callers read the new head.
    const open = (await this.#api.call('GET', `/projects/${project}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`)) as Json[];
    for (const mr of open ?? []) await this.#ready(project, mr.iid, sha);
    return sha;
  }

  async openPullRequest(
    repo: SeededRepo,
    input: { source: string; target: string; title: string; description?: string; sourceRepo?: SeededRepo },
  ): Promise<SeededPull> {
    const from = input.sourceRepo ?? repo;
    const body = {
      source_branch: input.source,
      target_branch: input.target,
      title: input.title,
      description: input.description ?? '',
      target_project_id: repo.platformId,
    };
    // Even once the branch API shows a pushed branch, merge request creation can still answer
    // "source_branch does not exist" for a moment; retry that refusal only, within the bound.
    const mr = await until(
      () =>
        this.#api.call('POST', `/projects/${from.platformId}/merge_requests`, body).catch((error: Error) => {
          if (/ failed: 400 .*does not exist/.test(error.message)) return null;
          throw error;
        }),
      `${input.source} to be accepted as a merge request source in ${from.id}`,
    );
    const ready = await this.#ready(repo.platformId, mr.iid);
    return toPull(ready, repo, from);
  }

  async updatePullRequest(pull: SeededPull, input: { title?: string; description?: string }): Promise<SeededPull> {
    const mr = await this.#api.call('PUT', `/projects/${pull.repo.platformId}/merge_requests/${pull.number}`, input);
    return toPull(mr, pull.repo, pull.sourceRepo);
  }

  async closePullRequest(pull: SeededPull): Promise<void> {
    await this.#stateEvent(pull, 'close', 'closed');
  }

  async reopenPullRequest(pull: SeededPull): Promise<void> {
    await this.#stateEvent(pull, 'reopen', 'opened');
  }

  async mergePullRequest(pull: SeededPull): Promise<void> {
    const path = `/projects/${pull.repo.platformId}/merge_requests/${pull.number}`;
    const pending = new Set(['unchecked', 'checking', 'preparing', 'approvals_syncing', 'cannot_be_merged_recheck']);
    await until(async () => {
      const mr = await this.#api.call('GET', path);
      return mr !== null && !pending.has(mr.detailed_merge_status) && mr.merge_status !== 'checking' && mr.merge_status !== 'unchecked';
    }, `mergeability of !${pull.number} in ${pull.repo.id}`);
    await this.#api.call('PUT', `${path}/merge`, {});
    await until(async () => (await this.#api.call('GET', path))?.state === 'merged', `!${pull.number} to be merged`);
  }

  async deletePullRequest(pull: SeededPull): Promise<void> {
    const path = `/projects/${pull.repo.platformId}/merge_requests/${pull.number}`;
    await this.#api.call('DELETE', path);
    await until(async () => (await this.#api.call('GET', path)) === null, `!${pull.number} to be deleted`);
  }

  async createIssue(repo: SeededRepo, input: { title: string; description?: string }): Promise<SeededIssue> {
    const issue = await this.#api.call('POST', `/projects/${repo.platformId}/issues`, { title: input.title, description: input.description ?? '' });
    return toIssue(issue, repo, repo.kind === 'hidden' ? 'hidden' : 'visible');
  }

  async createHiddenIssue(input: { title: string }): Promise<SeededIssue> {
    this.#hidden ??= await this.#createProject('hidden', 'hidden');
    return this.createIssue(this.#hidden, input);
  }

  async createReviewerToken(): Promise<string> {
    const state = this.#active;
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const pat = await this.#api.call('POST', `/users/${state.userId}/personal_access_tokens`, {
      name: `${state.name}-${this.#tokenIds.size + 1}`,
      scopes: ['read_api', 'read_repository'],
      expires_at: tomorrow,
    });
    this.#tokenIds.set(pat.token, pat.id);
    return pat.token as string;
  }

  async revokeReviewerToken(token: string): Promise<void> {
    const id = this.#tokenIds.get(token);
    if (id === undefined) throw new Error('not a token this run created');
    await this.#api.call('DELETE', `/personal_access_tokens/${id}`);
  }

  async listLeftovers(): Promise<{ projects: string[]; users: string[] }> {
    const name = this.#active.name;
    const items = await this.#api.listRunItems();
    const projects = filterLeftovers(name, items.projects.map((p) => p.path)).map(
      (path) => items.projects.find((p) => p.path === path)?.path_with_namespace ?? path,
    );
    const groups = filterLeftovers(name, items.groups.map((g) => g.path));
    return { projects: [...projects, ...groups.map((g) => `${g} (group)`)], users: filterLeftovers(name, items.users.map((u) => u.username)) };
  }

  async #stateEvent(pull: SeededPull, event: 'close' | 'reopen', want: string): Promise<void> {
    const path = `/projects/${pull.repo.platformId}/merge_requests/${pull.number}`;
    await this.#api.call('PUT', path, { state_event: event });
    await until(async () => (await this.#api.call('GET', path))?.state === want, `!${pull.number} to be ${want}`);
  }

  /** Waits until the merge request has diff refs (and, when given, shows `sha` as its head). */
  async #ready(project: number, iid: number, sha?: string): Promise<Json> {
    return until(async () => {
      const mr = await this.#api.call('GET', `/projects/${project}/merge_requests/${iid}`);
      if (mr === null || mr.diff_refs === null || mr.diff_refs?.head_sha == null) return null;
      if (sha !== undefined && (mr.sha !== sha || mr.diff_refs.head_sha !== sha)) return null;
      return mr as Json;
    }, `!${iid} in project ${project} to be ready${sha === undefined ? '' : ` at ${sha.slice(0, 8)}`}`);
  }

  #replace(repo: SeededRepo): void {
    const state = this.#active;
    state.repositories = state.repositories.map((r) => (r.platformId === repo.platformId ? repo : r));
  }

  #authUrl(httpUrl: string): string {
    const url = new URL(httpUrl);
    url.username = 'oauth2';
    url.password = this.#api.token;
    return url.toString();
  }

  /** The seeder's own author clone of `repo`, never the reviewer's. */
  async #clone(repo: SeededRepo): Promise<string> {
    const existing = this.#clones.get(repo.platformId);
    if (existing !== undefined) return existing;
    const dir = join(this.#workDir ?? tmpdir(), `author-${repo.platformId}`);
    await run('git', ['clone', '--quiet', this.#authUrl(repo.httpUrl), dir], { env: gitEnv() }).catch((error: Error) => {
      throw new Error(this.#scrub(error.message));
    });
    await this.#git(dir, 'config', 'user.name', 'PRWB Seeder');
    await this.#git(dir, 'config', 'user.email', 'seeder@prwb.invalid');
    this.#clones.set(repo.platformId, dir);
    return dir;
  }

  async #git(cwd: string, ...args: string[]): Promise<string> {
    try {
      return (await run('git', args, { cwd, env: gitEnv(), maxBuffer: 64 * 1024 * 1024 })).stdout;
    } catch (error) {
      throw new Error(this.#scrub(`git ${args[0]} failed: ${(error as Error).message}`));
    }
  }

  #scrub(text: string): string {
    return text.split(this.#api.token).join('[redacted]');
  }
}

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
}

function toRepo(p: Json, kind: SeededRepo['kind']): SeededRepo {
  return {
    id: p.path_with_namespace,
    platformId: p.id,
    kind,
    httpUrl: p.http_url_to_repo,
    sshUrl: p.ssh_url_to_repo,
    defaultBranch: p.default_branch ?? 'main',
    previousPaths: [],
  };
}

function toPull(mr: Json, repo: SeededRepo, sourceRepo: SeededRepo): SeededPull {
  const state = mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open';
  return {
    repo,
    sourceRepo,
    number: mr.iid,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    headCommit: mr.sha,
    title: mr.title,
    description: mr.description ?? '',
    author: mr.author?.username ?? '',
    webUrl: mr.web_url,
    state,
  };
}

function toIssue(issue: Json, repo: SeededRepo, visibility: SeededIssue['visibility']): SeededIssue {
  return { repo, number: issue.iid, title: issue.title, description: issue.description ?? '', webUrl: issue.web_url, visibility };
}
