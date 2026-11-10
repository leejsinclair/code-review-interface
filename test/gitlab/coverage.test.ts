// T031-T034 (US3 AS1-AS7; FR-009, FR-033, FR-034, FR-043): what recorded fixtures cannot cover,
// against the local GitLab: results across pages and the page cap, a real git fetch over HTTP with
// the reviewer's stored credential, a token that never existed and one revoked after use, and a
// renamed project read at its old path.
//
// Adapters run with the run's reviewer token (never root) through the registry's read-only layer.
// Paging uses the adapter's test-only `pageSize`, so a handful of merge requests spans several pages.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createGitlabSourceControl } from '../../src/adapters/gitlab/source-control.ts';
import { adapterDeps } from '../../src/adapters/registry.ts';
import { ensureAppData } from '../../src/appdata.ts';
import type { Authorize } from '../../src/contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../../src/contracts/source-control.ts';
import { createGit } from '../../src/repo/git.ts';
import { createRepositoryManager } from '../../src/repo/manager.ts';
import { useTempAppData } from '../helpers/app-data.ts';
import { startWorkbench } from '../helpers/fake-ai-cli.ts';
import { liveClone, makeUnfetchableClone } from '../helpers/git-sandbox.ts';
import { loggedFetch } from '../helpers/logged-fetch.ts';
import { GitlabAdmin, GitlabSeeder } from '../seeder/gitlab-seeder.ts';
import type { SeededPull, SeededRepo } from '../seeder/platform-seeder.ts';
import { ownedBy } from '../seeder/run-name.ts';
import { GITLAB_TOKEN, GITLAB_URL, gitlabGate } from './env.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CLEANUP_TIMEOUT_MS = 300_000;
const OPEN_PULLS = 11; // more than the 10-page cap at one per page
const MANY_FILES = 5;

const gate = await gitlabGate();

const bearer = (token: string): Authorize => (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${token}`);
  return new Request(request, { headers });
};

if (gate.skip !== undefined) {
  test('GitLab coverage beyond fixtures', gate, () => {});
} else {
  const seeder = new GitlabSeeder({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const admin = new GitlabAdmin({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const host = new URL(GITLAB_URL).host;
  const network = loggedFetch();
  let runName = '';

  after(
    async () => {
      if (runName === '') return;
      await seeder.cleanup();
      const items = await admin.listRunItems();
      const mine = [...items.projects.map((p) => p.path), ...items.groups.map((g) => g.path), ...items.users.map((u) => u.username)].filter((n) => ownedBy(runName, n));
      assert.deepEqual(mine, [], `run ${runName} left items behind`);
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  );

  // ------------------------------------------------------------------ seeding
  // In a `before` hook, so a seeding failure still runs the `after` cleanup above.
  let reviewer = '';
  let repo = {} as SeededRepo;
  const pulls: SeededPull[] = [];
  before(
    async () => {
      const run = await seeder.begin('coverage');
      runName = run.name;
      reviewer = run.reviewer.token;
      repo = await seeder.createRepository('paging');
      await seeder.pushCommit(repo, 'main', [{ kind: 'add', path: 'src/base.js', content: 'export const base = 1;\n' }]);
      for (let i = 1; i <= OPEN_PULLS; i++) {
        const files = i === 1 ? Array.from({ length: MANY_FILES }, (_, f) => ({ kind: 'add' as const, path: `src/many/file${f + 1}.js`, content: `export const f = ${f + 1};\n` })) : [{ kind: 'add' as const, path: `docs/note${i}.md`, content: `# ${i}\n` }];
        await seeder.pushCommit(repo, `topic/${i}`, files);
        pulls.push(await seeder.openPullRequest(repo, { source: `topic/${i}`, target: 'main', title: `Topic ${i}` }));
      }
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  );
  const ref = (r: SeededRepo): RepoRef => ({ platform: 'gitlab', id: r.id });
  const adapter = (token: string, r: SeededRepo = repo, pageSize?: number): SourceControlProvider =>
    createGitlabSourceControl(adapterDeps('gitlab', network.fetch, bearer(token)), { repository: ref(r), baseUrl: GITLAB_URL }, pageSize === undefined ? {} : { pageSize });

  test('T031 AS1-AS3 merge requests and changed files spanning pages are each returned once; past the cap the result is truncated', async () => {
    const listed = await adapter(reviewer, repo, 2).listOpenPullRequests(ref(repo));
    assert.deepEqual(listed.map((p) => p.number).sort((a, b) => a - b), pulls.map((p) => p.number).sort((a, b) => a - b), 'every open merge request exactly once across six pages');
    const first = pulls[0]!;
    const files = await adapter(reviewer, repo, 2).listChangedFiles(ref(repo), first.number);
    assert.deepEqual(files.map((f) => f.path).sort(), Array.from({ length: MANY_FILES }, (_, f) => `src/many/file${f + 1}.js`).sort(), 'every changed file exactly once across three pages');
    await assert.rejects(adapter(reviewer, repo, 1).listOpenPullRequests(ref(repo)), { code: 'truncated' }, 'eleven pages at one per page pass the 10-page cap');
  });

  test('T032 AS4 the product fetches a merge request head and target over HTTP with the reviewer stored credential, touching only its own refs', async (t) => {
    const clone = await liveClone(repo.httpUrl, reviewer);
    t.after(() => clone.cleanup());
    const savedHome = process.env.HOME;
    process.env.HOME = clone.home;
    t.after(() => {
      process.env.HOME = savedHome;
    });
    const appData = await useTempAppData(t);
    const paths = await ensureAppData({ dir: appData.dir });
    const manager = createRepositoryManager({ git: createGit({ hooksPath: paths.emptyHooks }), workspacesDir: paths.workspaces });
    const sc = adapter(reviewer);
    const pr = await sc.getPullRequest(ref(repo), pulls[0]!.number);

    const refsBefore = new Set((await clone.git(clone.clone, 'for-each-ref', '--format=%(refname) %(objectname)')).split('\n'));
    const before = await clone.fingerprint();
    const outcome = await manager.fetchSnapshot({
      clonePath: clone.clone,
      cloneLocations: sc.cloneLocations(ref(repo)),
      sessionId: 'session-1',
      snapshotId: 'snapshot-1',
      head: await sc.headLocation(ref(repo), pr),
      target: await sc.targetLocation(ref(repo), pr),
      expectedHead: pr.headCommit,
    });
    assert.equal(outcome.status, 'found', JSON.stringify(outcome));
    assert.equal(outcome.status === 'found' && outcome.headCommit, pulls[0]!.headCommit);
    for (const sha of [pr.headCommit, outcome.status === 'found' ? outcome.targetCommit : '']) {
      await clone.git(clone.clone, 'cat-file', '-e', `${sha}^{commit}`);
    }
    const changed = (await clone.git(clone.clone, 'for-each-ref', '--format=%(refname) %(objectname)')).split('\n').filter((line) => !refsBefore.has(line));
    assert.ok(changed.length > 0, 'the fetch wrote refs');
    for (const line of changed) assert.match(line, /^refs\/(prwb|remotes)\//, `only app-owned or remote-tracking refs change: ${line}`);
    assert.deepEqual(await clone.fingerprint(), before, 'the reviewer clone is unchanged');
    assert.equal((await clone.git(clone.clone, 'config', '--list')).includes(reviewer), false, 'the token is not in the clone config');
  });

  test('T033 AS5-AS6 a token that never existed is refused and signed out; a revoked token turns the platform expired', async (t) => {
    // A stub clone, so discovery finds the repository and the pull list is requested (its head is never fetched here).
    const stubRoot = await mkdtemp(join(tmpdir(), 'prwb-stub-'));
    t.after(() => rm(stubRoot, { recursive: true, force: true }));
    const stub = join(stubRoot, 'clone');
    await makeUnfetchableClone(stub, `${GITLAB_URL}/${repo.id}`, `${GITLAB_URL}/${repo.id}.git`, join(stubRoot, 'nowhere'));
    const bench = await startWorkbench(t, {
      live: {
        repository: { platform: 'gitlab', id: repo.id, baseUrl: GITLAB_URL },
        issueTracker: { platform: 'gitlab-issues', site: GITLAB_URL },
        credentials: {},
        clonePath: stub,
        fetch: network.fetch,
      },
    });
    const state = async (): Promise<string | undefined> => ((await bench.client.get('/api/signins')).json as Json[]).find((s) => s.platform === 'gitlab')?.state;

    const never = 'glpat-this-token-never-existed-0000';
    const refused = await bench.client.put('/api/signins/gitlab', { secret: never });
    assert.equal(refused.status, 422, refused.text);
    assert.equal((refused.json as Json).error.code, 'signin_rejected');
    assert.ok(((refused.json as Json).error.message as string).length > 0, 'the refusal carries a reason');
    assert.equal(refused.text.includes(never), false);
    assert.equal(await state(), 'signed-out');

    const token = await seeder.createReviewerToken();
    const signedIn = await bench.client.put('/api/signins/gitlab', { secret: token });
    assert.equal(signedIn.status, 200, signedIn.text);
    assert.equal(await state(), 'signed-in');
    assert.equal((await bench.client.get('/api/pulls')).status, 200, 'the token works before it is revoked');

    await seeder.revokeReviewerToken(token);
    const after = await bench.client.get('/api/pulls');
    assert.notEqual(after.status, 200, after.text);
    assert.equal(await state(), 'expired');
  });

  test('T034 AS7 a renamed project is still read at its old path', async () => {
    const target = await seeder.createRepository('moved');
    await seeder.pushCommit(target, 'main', [{ kind: 'add', path: 'a.txt', content: 'a\n' }]);
    await seeder.pushCommit(target, 'topic/move', [{ kind: 'add', path: 'b.txt', content: 'b\n' }]);
    const pull = await seeder.openPullRequest(target, { source: 'topic/move', target: 'main', title: 'Before the move' });
    const renamed = await seeder.renameRepository(target, 'moved-again');
    assert.notEqual(renamed.id, target.id);
    const pr = await adapter(reviewer, target).getPullRequest(ref(target), pull.number);
    assert.equal(pr.number, pull.number);
    assert.equal(pr.headCommit, pull.headCommit);
  });

  test('SC-005 every adapter request was a GET to GitLab', () => {
    network.assertOnlyGets();
    network.assertHosts([host]);
  });
}
