// FR-049 to FR-051, R11 (feature 003 data-model 2.2 and 2.3): discovery walks a base folder with
// `fs.opendir`, finds clones at any depth and inside other clones, counts a `.git` file, never
// follows a symbolic link, skips the application-data folder, reads remotes through the repository
// manager's `readRemotes` (at most 8 at once, only `listRemotes`), matches them through
// `repositoryForRemote`, lists a fork under both ids, keeps the clone nearest the base folder for a
// repository found twice (ties by code-point order), keeps what was found when cancelled, and
// reports `foldersScanned` as it goes.
//
// Contract this test sets for `src/repo/discovery.ts` (T047):
//
//   discoverRepositories(options: {
//     baseFolder: string; appDataDir: string; platform: string;
//     manager: Pick<RepositoryManager, 'readRemotes'>;
//     repositoryForRemote(normalisedRemote: string): string | null;
//     signal?: AbortSignal;
//     onProgress?(foldersScanned: number): void;
//   }): Promise<{ state: 'complete' | 'cancelled' | 'failed'; foldersScanned: number; entries: DiscoveredEntry[]; reason?: string }>
//
//   DiscoveredEntry =
//     | { status: 'matched';   folder; repository: RepoRef; remote }
//     | { status: 'duplicate'; folder; repository: RepoRef; remote; duplicateOf }
//     | { status: 'skipped';   folder; reason: 'no-remote' | 'no-matching-remote' | 'remotes-unreadable'; detail? }
//
//   RepositoryManager.readRemotes(folder): Promise<string[]>   // the clone's remote URLs, as `git remote -v` shows them

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGithubSourceControl } from '../../src/adapters/github/source-control.ts';
import { createGit, type Git } from '../../src/repo/git.ts';
import { createRepositoryManager } from '../../src/repo/manager.ts';
import { discoverRepositories } from '../../src/repo/discovery.ts';
import { makeBaseFolder, type BaseFolder } from '../helpers/git-sandbox.ts';

const github = createGithubSourceControl({
  fetch: async () => {
    throw new Error('discovery must not touch the network');
  },
  authorize: (request) => request,
});

async function scan(box: BaseFolder, extra: { signal?: AbortSignal; onProgress?: (n: number) => void } = {}) {
  const git = createGit({ hooksPath: join(box.root, 'no-hooks') });
  const manager = createRepositoryManager({ git, workspacesDir: join(box.root, 'workspaces') });
  return discoverRepositories({
    baseFolder: box.base,
    appDataDir: box.appData,
    platform: 'github',
    manager,
    repositoryForRemote: (remote) => github.repositoryForRemote(remote),
    ...extra,
  });
}

const matched = (result: Awaited<ReturnType<typeof scan>>) => result.entries.filter((e) => e.status === 'matched');

test('FR-049 clones at every depth and a clone inside another clone are found', async (t) => {
  await using box = await makeBaseFolder();
  const result = await scan(box);
  assert.equal(result.state, 'complete');
  const byId = new Map(matched(result).map((e) => [e.repository.id, e.folder]));
  assert.equal(byId.get('acme/widgets'), box.folders.widgets, 'depth 1');
  assert.equal(byId.get('acme/gizmos'), box.folders.gizmos, 'depth 2');
  assert.equal(byId.get('acme/gadgets'), box.folders.gadgets, 'depth 3');
  assert.equal(byId.get('acme/inner'), box.folders.inner, 'inside another clone');
  assert.deepEqual([...byId.keys()].sort(), box.expectedMatched);
  for (const e of matched(result)) assert.equal(e.repository.platform, 'github');
  t.diagnostic(`${result.foldersScanned} folders scanned`);
});

test('FR-049 a folder whose .git is a file counts as a clone', async () => {
  await using box = await makeBaseFolder();
  const found = matched(await scan(box)).find((e) => e.repository.id === 'acme/gitfile');
  assert.equal(found?.folder, box.folders.gitFile);
});

test('IX symbolic links are not followed', async () => {
  await using box = await makeBaseFolder();
  const result = await scan(box);
  assert.equal(result.entries.some((e) => e.repository?.id === 'acme/linked'), false, 'the linked repository is not listed');
  assert.equal(result.entries.some((e) => e.folder === box.folders.link || e.folder === box.folders.linkTarget), false, 'neither the link nor its target is listed');
});

test('FR-049 the application-data folder is skipped', async () => {
  await using box = await makeBaseFolder();
  const result = await scan(box);
  assert.equal(result.entries.some((e) => e.repository?.id === 'acme/appdata'), false);
  assert.equal(result.entries.some((e) => e.folder.startsWith(box.appData)), false);
});

test('FR-050 skipped clones carry the reasons no-remote, no-matching-remote and remotes-unreadable', async () => {
  await using box = await makeBaseFolder();
  const result = await scan(box);
  const skipped = result.entries.filter((e) => e.status === 'skipped');
  const reasonOf = (folder: string) => skipped.find((e) => e.folder === folder)?.reason;
  assert.equal(reasonOf(box.folders.noRemote), 'no-remote');
  assert.equal(reasonOf(box.folders.otherHost), 'no-matching-remote');
  assert.equal(reasonOf(box.folders.broken), 'remotes-unreadable');
  assert.equal(skipped.length, 3, 'only those three are skipped');
  const other = skipped.find((e) => e.folder === box.folders.otherHost);
  assert.ok(other?.detail?.includes('gitlab.example.com'), 'the detail names the host found');
  const broken = skipped.find((e) => e.folder === box.folders.broken);
  assert.ok((broken?.detail ?? '') !== '', 'an unreadable clone shows its message');
});

test('FR-050 a fork clone is listed under both repositories it names, and is not skipped', async () => {
  await using box = await makeBaseFolder();
  const result = await scan(box);
  const forFork = result.entries.filter((e) => e.folder === box.folders.fork);
  assert.deepEqual(forFork.map((e) => e.status).sort(), ['matched', 'matched']);
  assert.deepEqual(forFork.map((e) => e.repository?.id).sort(), ['acme/forked', 'me/widgets-fork']);
});

test('FR-051 a repository in two folders keeps the clone nearest the base folder; the other is a duplicate', async () => {
  await using box = await makeBaseFolder();
  const result = await scan(box);
  const widgets = result.entries.filter((e) => e.repository?.id === 'acme/widgets');
  assert.equal(widgets.length, 2);
  const kept = widgets.find((e) => e.status === 'matched');
  const dup = widgets.find((e) => e.status === 'duplicate');
  assert.equal(kept?.folder, box.folders.widgets);
  assert.equal(dup?.folder, box.folders.widgetsCopy);
  assert.equal(dup?.status === 'duplicate' && dup.duplicateOf, box.folders.widgets);
});

test('FR-051 equal depth is decided by code-point order of the folder path, and the choice is stable', async () => {
  await using box = await makeBaseFolder();
  const first = await scan(box);
  const second = await scan(box);
  const twins = first.entries.filter((e) => e.repository?.id === 'acme/twins');
  assert.equal(twins.find((e) => e.status === 'matched')?.folder, box.folders.twinA);
  const dup = twins.find((e) => e.status === 'duplicate');
  assert.equal(dup?.folder, box.folders.twinB);
  assert.deepEqual(second.entries, first.entries, 'two scans of an unchanged folder agree');
});

test('FR-049 entries come back sorted by folder path in code-point order', async () => {
  await using box = await makeBaseFolder();
  const folders = (await scan(box)).entries.map((e) => e.folder);
  assert.deepEqual(folders, [...folders].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

test('FR-049 foldersScanned increases while the walk runs and ends at the reported total', async () => {
  await using box = await makeBaseFolder();
  const seen: number[] = [];
  const result = await scan(box, { onProgress: (n) => seen.push(n) });
  assert.ok(seen.length > 5, 'progress is reported more than a few times');
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i]! > seen[i - 1]!, `strictly increasing at ${i}`);
  assert.equal(seen.at(-1), result.foldersScanned);
});

test('FR-049 cancelling keeps what was found so far', async () => {
  await using box = await makeBaseFolder();
  const full = await scan(box);
  const controller = new AbortController();
  const result = await scan(box, {
    signal: controller.signal,
    onProgress: (n) => {
      if (n === 3) controller.abort();
    },
  });
  assert.equal(result.state, 'cancelled');
  assert.ok(result.foldersScanned >= 3 && result.foldersScanned < full.foldersScanned, 'the walk stopped early');
  assert.ok(result.entries.length >= 1, 'entries found before the cancel are kept');
  assert.ok(result.entries.length < full.entries.length);
});

test('FR-049 an unreadable base folder fails the scan with the reason', async () => {
  await using box = await makeBaseFolder();
  const git = createGit({ hooksPath: join(box.root, 'no-hooks') });
  const manager = createRepositoryManager({ git, workspacesDir: join(box.root, 'workspaces') });
  const result = await discoverRepositories({
    baseFolder: join(box.root, 'gone'),
    appDataDir: box.appData,
    platform: 'github',
    manager,
    repositoryForRemote: () => null,
  });
  assert.equal(result.state, 'failed');
  assert.equal(typeof result.reason, 'string');
  assert.deepEqual(result.entries, []);
});

test('IX.2 readRemotes runs only listRemotes, at most 8 at once', async () => {
  const commands: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const git: Git = {
    async run(command) {
      commands.push(command);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { stdout: 'origin\thttps://github.com/acme/x.git (fetch)\norigin\thttps://github.com/acme/x.git (push)\n', stderr: '' };
    },
  } as Git;
  const manager = createRepositoryManager({ git, workspacesDir: '/nowhere' });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => manager.readRemotes(`/clone-${i}`)));
  assert.ok(results.every((r) => r.length === 1 && r[0] === 'https://github.com/acme/x.git'), 'distinct URLs, fetch and push joined');
  assert.deepEqual([...new Set(commands)], ['listRemotes']);
  assert.ok(peak <= 8 && peak > 1, `peak concurrency ${peak}`);
});
