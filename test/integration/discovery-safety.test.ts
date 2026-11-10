// IX, XI.3 (feature 003 data-model 2.2): a scan of the base folder changes nothing in any clone it
// finds. Branch, HEAD, index, status and stash of every discovered repository (and every ref,
// FETCH_HEAD and the working files) are the same after the scan as before it; the scan creates no
// `refs/prwb/` ref and no file in a clone's git directory beyond what git itself reads.

import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGithubSourceControl } from '../../src/adapters/github/source-control.ts';
import { discoverRepositories } from '../../src/repo/discovery.ts';
import { createGit } from '../../src/repo/git.ts';
import { createRepositoryManager } from '../../src/repo/manager.ts';
import { fingerprint, makeBaseFolder } from '../helpers/git-sandbox.ts';

const github = createGithubSourceControl({
  fetch: async () => {
    throw new Error('discovery must not touch the network');
  },
  authorize: (request) => request,
});

async function gitDirListing(folder: string): Promise<string[]> {
  const entries = await readdir(join(folder, '.git'), { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.map((e) => join(e.parentPath, e.name)).sort();
}

test('IX XI.3 scanning leaves branch, HEAD, index, status and stash of every discovered repository unchanged', async () => {
  await using box = await makeBaseFolder();
  // Give two clones a dirty state worth protecting: a staged change, an untracked file, a stash.
  const dirty = box.folders.widgets;
  await writeFile(join(dirty, 'README.md'), 'changed\n');
  await box.git(dirty, 'stash', 'push', '-q', '-m', 'wip');
  await writeFile(join(dirty, 'README.md'), 'staged\n');
  await box.git(dirty, 'add', 'README.md');
  await writeFile(join(dirty, 'untracked.txt'), 'new\n');
  await box.git(box.folders.gizmos, 'checkout', '-q', '-b', 'topic');

  const before = new Map<string, Awaited<ReturnType<typeof fingerprint>>>();
  const listingBefore = new Map<string, string[]>();
  for (const repo of box.repositories) {
    before.set(repo, await fingerprint(repo));
    listingBefore.set(repo, await gitDirListing(repo));
  }
  const configBefore = await readFile(join(dirty, '.git', 'config'), 'utf8');

  const git = createGit({ hooksPath: join(box.root, 'no-hooks') });
  const manager = createRepositoryManager({ git, workspacesDir: join(box.root, 'workspaces') });
  const result = await discoverRepositories({
    baseFolder: box.base,
    appDataDir: box.appData,
    platform: 'github',
    manager,
    repositoryForRemote: (remote) => github.repositoryForRemote(remote),
  });
  assert.equal(result.state, 'complete');
  assert.ok(result.entries.length >= box.expectedMatched.length, 'the scan found the repositories');

  for (const repo of box.repositories) {
    if (repo === box.folders.broken) continue;
    const after = await fingerprint(repo);
    const was = before.get(repo)!;
    assert.equal(after.branch, was.branch, `${repo}: branch`);
    assert.equal(after.head, was.head, `${repo}: HEAD`);
    assert.equal(after.indexHash, was.indexHash, `${repo}: index`);
    assert.equal(after.status, was.status, `${repo}: status`);
    assert.equal(after.stash, was.stash, `${repo}: stash`);
    assert.deepEqual(after, was, `${repo}: everything the fingerprint covers`);
    assert.deepEqual(await gitDirListing(repo), listingBefore.get(repo), `${repo}: no file added or removed under .git`);
  }
  assert.equal(await readFile(join(dirty, '.git', 'config'), 'utf8'), configBefore, 'config untouched');
});
