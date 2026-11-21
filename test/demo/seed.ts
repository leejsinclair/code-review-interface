// `npm run gitlab:demo` (008 US2; FR-005 to FR-007): seeds the README demo on the local GitLab.
//
// Test-only (constitution XI.4): it writes to the loopback test instance with its root token, never through an
// adapter. Every item is found by a fixed key before it is created (R3), so a second run creates nothing. Branch
// content is pushed only when the branch is missing. Merge requests, notes and the approval are made as the demo
// users with short-lived tokens that are revoked before the command ends.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { GITLAB_TOKEN, GITLAB_URL, START_HINT, probeGitlab } from '../gitlab/env.ts';
import { GitlabAdmin, until } from '../seeder/gitlab-seeder.ts';
import { DEMO_GROUP, DEMO_PARENT, DEMO_USER_PREFIX, demoUsers, projects, scenarios, type DemoProject, type Role } from './scenarios.ts';

const run = promisify(execFile);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DemoOptions = { group?: string; userPrefix?: string; gitlabUrl?: string };
export type SeedLine = { status: 'created' | 'exists'; kind: string; key: string; purpose: string };
export type DemoTarget = { admin: GitlabAdmin; group: string; userPrefix: string };

const DEVELOPER = 30;

/**
 * The checked target for seed and clean: a group of the form `prwb-demo/<name>` and a loopback GitLab, refused before
 * any request (VO-009), then a probe that stops with the start command when GitLab does not answer (VO-008).
 */
export async function demoTarget(options: DemoOptions = {}): Promise<DemoTarget> {
  const group = options.group ?? DEMO_GROUP;
  if (!new RegExp(`^${DEMO_PARENT}/[a-z0-9][a-z0-9-]*$`).test(group)) throw new Error(`refusing group ${group}: the demo group must have the form ${DEMO_PARENT}/<name>`);
  const url = options.gitlabUrl ?? GITLAB_URL;
  const admin = new GitlabAdmin({ baseUrl: url, token: GITLAB_TOKEN }); // throws on a non-loopback URL
  const ready = await probeGitlab(url, GITLAB_TOKEN);
  if (!ready.ready) throw new Error(`${ready.cause}; ${START_HINT}`);
  return { admin, group, userPrefix: options.userPrefix ?? DEMO_USER_PREFIX };
}

export async function seed(options: DemoOptions = {}): Promise<SeedLine[]> {
  const { admin, group, userPrefix } = await demoTarget(options);
  const lines: SeedLine[] = [];
  const report: Report = (kind, key, result, purpose = '') => {
    lines.push({ status: result.status, kind, key, purpose });
    return result.item;
  };

  const parent = report('group', DEMO_PARENT, await admin.ensure(() => admin.findGroup(DEMO_PARENT), () => admin.call('POST', '/groups', { name: DEMO_PARENT, path: DEMO_PARENT, visibility: 'private' })));
  const name = group.slice(DEMO_PARENT.length + 1);
  const sub = report('group', group, await admin.ensure(() => admin.findGroup(group), () => admin.call('POST', '/groups', { name, path: name, parent_id: parent.id, visibility: 'private' })));

  const users = new Map<Role, Json>();
  for (const u of demoUsers(userPrefix)) {
    const created = await admin.ensure(
      () => admin.findUser(u.username),
      () => admin.call('POST', '/users', { username: u.username, name: u.name, email: u.email, password: `${randomBytes(18).toString('base64url')}Aa1!`, skip_confirmation: true, admin: false }),
    );
    users.set(u.role, report('user', u.username, created));
  }

  const tokenIds: number[] = [];
  const workDir = await mkdtemp(join(tmpdir(), 'prwb-demo-seed-'));
  try {
    const as = new Map<Role, GitlabAdmin>();
    for (const [role, user] of users) {
      const pat = await admin.call('POST', `/users/${user.id}/personal_access_tokens`, { name: 'prwb-demo-seed', scopes: ['api'], expires_at: tomorrow() });
      tokenIds.push(pat.id);
      as.set(role, new GitlabAdmin({ baseUrl: admin.baseUrl, token: pat.token }));
    }
    const client = (role: Role): GitlabAdmin => as.get(role) as GitlabAdmin;
    for (const project of projects) await seedProject(admin, client, { group, groupId: sub.id, project, users, workDir }, report);
  } finally {
    for (const id of tokenIds) await admin.call('DELETE', `/personal_access_tokens/${id}`).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true });
  }
  return lines;
}

type Report = (kind: string, key: string, result: { status: 'created' | 'exists'; item: Json }, purpose?: string) => Json;
type ProjectInput = { group: string; groupId: number; project: DemoProject; users: Map<Role, Json>; workDir: string };

async function seedProject(admin: GitlabAdmin, as: (role: Role) => GitlabAdmin, input: ProjectInput, report: Report): Promise<void> {
  const { project } = input;
  const fullPath = `${input.group}/${project.path}`;
  const p = report(
    'project',
    fullPath,
    await admin.ensure(
      () => admin.findProject(fullPath),
      () => admin.call('POST', '/projects', { name: project.path, path: project.path, namespace_id: input.groupId, visibility: 'private', default_branch: 'main', description: project.description }),
    ),
  );
  for (const user of input.users.values()) {
    if ((await admin.call('GET', `/projects/${p.id}/members/${user.id}`)) === null) await admin.call('POST', `/projects/${p.id}/members`, { user_id: user.id, access_level: DEVELOPER });
  }

  const repo = await gitClone(admin, p.http_url_to_repo as string, join(input.workDir, project.path));
  if (!(await branchExists(admin, p.id, 'main'))) await repo.push('main', null, project.baseFiles, `Start ${project.path}`);

  for (const issue of project.issues) {
    report('issue', `${fullPath}#${issue.title}`, await admin.ensure(() => admin.findIssue(p.id, issue.title), () => as('author').call('POST', `/projects/${p.id}/issues`, issue)));
  }

  for (const m of project.mergeRequests) {
    if (!(await branchExists(admin, p.id, m.sourceBranch))) await repo.push(m.sourceBranch, 'main', m.files, m.title);
    const purpose = scenarios.filter((s) => s.project === project.path && s.sourceBranch === m.sourceBranch).map((s) => s.purpose).join('; ');
    const mr = report(
      'merge_request',
      `${fullPath}:${m.sourceBranch}`,
      await admin.ensure(
        () => admin.findMergeRequest(p.id, m.sourceBranch),
        () =>
          // Just after a push GitLab can still say the source branch does not exist; retry that refusal only.
          until(
            () =>
              as('author')
                .call('POST', `/projects/${p.id}/merge_requests`, { source_branch: m.sourceBranch, target_branch: 'main', title: m.title, description: m.description })
                .catch((error: Error) => (/ failed: 400 .*does not exist/.test(error.message) ? null : Promise.reject(error))),
            `${m.sourceBranch} to be accepted as a merge request source`,
          ),
      ),
      purpose,
    );

    const discussions: string[] = [];
    for (const note of m.notes ?? []) {
      const found = await admin.findNote(p.id, mr.iid, note.body);
      if (found !== undefined) {
        discussions.push(found.discussionId);
        report('note', `${fullPath}!${mr.iid}:${note.by}`, { status: 'exists', item: found.note });
        continue;
      }
      const writer = as(note.by);
      const parent = note.replyTo === undefined ? undefined : discussions[note.replyTo];
      const created =
        parent !== undefined
          ? await writer.call('POST', `/projects/${p.id}/merge_requests/${mr.iid}/discussions/${parent}/notes`, { body: note.body })
          : note.path !== undefined && note.line !== undefined
            ? await writer.openDiffDiscussion(p.id, mr.iid, { path: note.path, line: note.line, body: note.body })
            : await writer.call('POST', `/projects/${p.id}/merge_requests/${mr.iid}/discussions`, { body: note.body });
      discussions.push(created.id);
      report('note', `${fullPath}!${mr.iid}:${note.by}`, { status: 'created', item: created });
    }

    if (m.approvedBy !== undefined) {
      const username = input.users.get(m.approvedBy)?.username as string;
      const approved = await admin.approvedBy(p.id, mr.iid, username);
      if (!approved) await as(m.approvedBy).call('POST', `/projects/${p.id}/merge_requests/${mr.iid}/approve`, {});
      report('approval', `${fullPath}!${mr.iid}:${username}`, { status: approved ? 'exists' : 'created', item: {} });
    }
  }
}

async function branchExists(admin: GitlabAdmin, projectId: number, branch: string): Promise<boolean> {
  return (await admin.call('GET', `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`)) !== null;
}

function tomorrow(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
}

/** A working copy of the project, pushing as the root token; the token never reaches an error message. */
async function gitClone(admin: GitlabAdmin, httpUrl: string, dir: string) {
  const url = new URL(httpUrl);
  url.username = 'oauth2';
  url.password = admin.token;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    try {
      return (await run('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 })).stdout;
    } catch (error) {
      throw new Error(`git ${args[0]} failed: ${(error as Error).message.split(admin.token).join('[redacted]')}`);
    }
  };
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '--quiet', '--initial-branch=main');
  await git(dir, 'remote', 'add', 'origin', url.toString());
  await git(dir, 'config', 'user.name', 'Demo Author');
  await git(dir, 'config', 'user.email', 'demo-author@prwb.invalid');
  return {
    /** Commits `files` on `branch`, starting from `from` (or an empty history), and pushes it. */
    async push(branch: string, from: string | null, files: Record<string, string>, message: string): Promise<void> {
      if (from === null) await git(dir, 'checkout', '--quiet', '--orphan', branch);
      else {
        await git(dir, 'fetch', '--quiet', 'origin', from);
        await git(dir, 'checkout', '--quiet', '-B', branch, 'FETCH_HEAD');
      }
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), content);
      }
      await git(dir, 'add', '--all');
      await git(dir, 'commit', '--quiet', '-m', message);
      await git(dir, 'push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`);
    },
  };
}

// Not import.meta.main: Node 24.2 reports false for a .ts entry file.
if (process.argv[1] === import.meta.filename) {
  try {
    for (const l of await seed()) console.log(`${l.status} ${l.kind} ${l.key}${l.purpose === '' ? '' : ` — ${l.purpose}`}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
