// T035 (US4 AS1-AS3; FR-022, FR-041, FR-042): recording mode. Real GitLab responses are saved in the
// format `recordedFetch` replays, with credentials stripped, then replayed offline through the same
// adapter calls, which must return the same results. This is how Bitbucket and Jira fixtures could
// later be refreshed from real responses; nothing recorded here is committed.

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createGitlabSourceControl } from '../../src/adapters/gitlab/source-control.ts';
import { adapterDeps } from '../../src/adapters/registry.ts';
import type { Authorize } from '../../src/contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../../src/contracts/source-control.ts';
import { recordedFetch, recordingFetch } from '../helpers/recorded-fetch.ts';
import { GitlabAdmin, GitlabSeeder } from '../seeder/gitlab-seeder.ts';
import type { SeededPull, SeededRepo } from '../seeder/platform-seeder.ts';
import { ownedBy } from '../seeder/run-name.ts';
import { GITLAB_TOKEN, GITLAB_URL, gitlabGate } from './env.ts';

const CLEANUP_TIMEOUT_MS = 300_000;
const PLATFORM_DIR = 'gitlab';

const gate = await gitlabGate();

const bearer = (token: string): Authorize => (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${token}`);
  return new Request(request, { headers });
};

/** Every read-only call the source-control contract makes for one merge request. */
async function exercise(sc: SourceControlProvider, repo: RepoRef, number: number): Promise<unknown> {
  const pr = await sc.getPullRequest(repo, number);
  return {
    signIn: await sc.verifySignIn(),
    open: await sc.listOpenPullRequests(repo),
    pr,
    commits: await sc.listCommits(repo, number),
    files: await sc.listChangedFiles(repo, number),
    diff: await sc.getUnifiedDiff(repo, number),
    head: await sc.headLocation(repo, pr),
    target: await sc.targetLocation(repo, pr),
  };
}

if (gate.skip !== undefined) {
  test('GitLab recording mode', gate, () => {});
} else {
  const seeder = new GitlabSeeder({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const admin = new GitlabAdmin({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  let runName = '';
  let reviewer = '';
  let repo = {} as SeededRepo;
  let pull = {} as SeededPull;
  let root = '';

  after(
    async () => {
      if (root !== '') await rm(root, { recursive: true, force: true });
      if (runName === '') return;
      await seeder.cleanup();
      const items = await admin.listRunItems();
      const mine = [...items.projects.map((p) => p.path), ...items.groups.map((g) => g.path), ...items.users.map((u) => u.username)].filter((n) => ownedBy(runName, n));
      assert.deepEqual(mine, [], `run ${runName} left items behind`);
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  );

  before(
    async () => {
      root = await mkdtemp(join(tmpdir(), 'prwb-recording-'));
      const run = await seeder.begin('recording');
      runName = run.name;
      reviewer = run.reviewer.token;
      repo = await seeder.createRepository('rec');
      await seeder.pushCommit(repo, 'main', [{ kind: 'add', path: 'src/a.js', content: 'export const a = 1;\n' }]);
      await seeder.pushCommit(repo, 'topic/rec', [
        { kind: 'edit', path: 'src/a.js', content: 'export const a = 2;\n' },
        { kind: 'add', path: 'src/b.js', content: 'export const b = 1;\n' },
      ]);
      pull = await seeder.openPullRequest(repo, { source: 'topic/rec', target: 'main', title: 'Recorded change', description: 'Recorded for replay.' });
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  );

  const adapterOver = (network: typeof fetch): SourceControlProvider =>
    createGitlabSourceControl(adapterDeps('gitlab', network, bearer(reviewer)), { repository: { platform: 'gitlab', id: repo.id }, baseUrl: GITLAB_URL });

  test('AS1-AS2 real responses are saved as replayable fixtures with no token, authorization header or cookie, and replay gives the same results', async () => {
    const dir = join(root, PLATFORM_DIR);
    const ref: RepoRef = { platform: 'gitlab', id: repo.id };
    const live = await exercise(adapterOver(recordingFetch(fetch, { dir, secrets: [reviewer, GITLAB_TOKEN] })), ref, pull.number);

    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    assert.ok(files.length >= 6, `one fixture per request: ${files.join(', ')}`);
    for (const name of files) {
      const text = await readFile(join(dir, name), 'utf8');
      assert.equal(text.includes(reviewer), false, `${name} holds no reviewer token`);
      assert.equal(text.includes(GITLAB_TOKEN), false, `${name} holds no root token`);
      assert.doesNotMatch(text, /authorization|private-token|cookie/i, `${name} holds no credential header or cookie`);
    }

    const replay = recordedFetch(PLATFORM_DIR, { fixturesDir: root });
    const offline = await exercise(adapterOver(replay.fetch), ref, pull.number);
    replay.assertAllRecorded();
    assert.deepEqual(offline, live, 'the recorded fixtures replay to the same results');
  });

  test('AS3 with recording off, nothing is written', async () => {
    const saved = process.env.PRWB_RECORD_FIXTURES;
    delete process.env.PRWB_RECORD_FIXTURES;
    try {
      const network = recordingFetch(fetch, { secrets: [reviewer] });
      assert.equal(network, fetch, 'recording off hands back the network unchanged');
      const before = await readdir(root);
      await exercise(adapterOver(network), { platform: 'gitlab', id: repo.id }, pull.number);
      assert.deepEqual(await readdir(root), before, 'no fixture file was written');
    } finally {
      if (saved !== undefined) process.env.PRWB_RECORD_FIXTURES = saved;
    }
  });
}
