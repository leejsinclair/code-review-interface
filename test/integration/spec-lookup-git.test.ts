// Feature 006 (T006; FR-006, SC-006): the specification lookup's git reads, against real git in the spec sandbox
// (test/helpers/spec-sandbox.ts). A full lookup fetches only into `refs/prwb/<session>/<snapshot>/spec-<n>`, reads
// each file at the last commit that touched it, and leaves the reviewer's branch, index, stash and working files
// as they were. The refs go with the existing session-ref delete.
//
// APIs required (T015, T020; contracts/git-commands.md):
//   src/repo/manager.ts  RepositoryManager gains
//     listRemoteBranches(clonePath, remoteUrl): Promise<Array<{ branch: string; commit: string }>>
//         `ls-remote --heads` of the remote URL; `branch` has no `refs/heads/` prefix.
//     fetchSpecRef(input: { clonePath; remoteUrl; branch; sessionId; snapshotId; n }): Promise<{ ref: string; commit: string }>
//         fetches into `refs/prwb/<sessionId>/<snapshotId>/spec-<n>` and returns that ref and the commit it holds.
//     listSpecFiles(clonePath, commit): Promise<string[]>          every path under `specs/` in the commit's tree
//     readSpecFile(input: { clonePath; commit; path; maxBytes }): Promise<{ commit: string; content: string }>
//         `commit` is the last commit touching `path` from `commit`, and `content` is the file at it.
//         Rejects with a message naming the size when the file is over `maxBytes`, and for a path or commit that fails validation.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { useTempAppData } from '../helpers/app-data.ts';
import { createSpecSandbox, specFolder, type SpecSandbox } from '../helpers/spec-sandbox.ts';

const SESSION = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = '22222222-2222-4222-8222-222222222222';
const PREFIX = `refs/prwb/${SESSION}/${SNAPSHOT}/`;

async function harness(t: { after(fn: () => unknown): void }) {
  const { createRepositoryManager } = await import('../../src/repo/manager.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const appData = await useTempAppData(t);
  const paths = await ensureAppData({ dir: appData.dir });
  const sandbox = await createSpecSandbox();
  t.after(() => sandbox.cleanup());
  const git = createGit({ hooksPath: paths.emptyHooks });
  const manager = createRepositoryManager({ git, workspacesDir: paths.workspaces });
  return { sandbox, manager };
}

/** Everything a lookup must leave alone: checked-out branch, HEAD, index, stash, working files, and every non-prwb ref. */
async function reviewerState(s: SpecSandbox) {
  const git = (...args: string[]) => s.git(s.project, ...args);
  const refs = (await s.refs()).filter((r) => !r.startsWith('refs/prwb/'));
  const refValues = await git('for-each-ref', '--format=%(refname) %(objectname)', ...['refs/heads/', 'refs/remotes/', 'refs/tags/']);
  return {
    branch: await git('symbolic-ref', 'HEAD'),
    head: await git('rev-parse', 'HEAD'),
    index: await git('ls-files', '-s'),
    status: await git('status', '--porcelain', '--untracked-files=all'),
    stash: await git('stash', 'list'),
    refs,
    refValues,
    readme: await readFile(join(s.project, 'README.md'), 'utf8'),
    staged: await readFile(join(s.project, 'staged.txt'), 'utf8'),
  };
}

test('a full lookup writes only product-owned spec refs, reads at the last-touching commit, and leaves the working copy unchanged (FR-006, SC-006)', async (t) => {
  const { sandbox, manager } = await harness(t);
  const key = 'ENG-12-data-request';
  await sandbox.commitSpec('develop', specFolder(key, { spec: '# Develop copy\n- **FR-001**: develop.\n' }));
  await sandbox.commitSpec('feature/ENG-12-data', specFolder(key, { spec: '# Branch copy\n- **FR-001**: branch.\n' }));
  // The branch moves on: the spec file's last-touching commit is older than the branch head.
  const specCommit = await sandbox.moveDocument('feature/ENG-12-data', `specs/${key}/spec.md`, '# Branch copy\n- **FR-001**: branch v2.\n');
  const headCommit = await sandbox.commitSpec('feature/ENG-12-data', { 'src/unrelated.txt': 'not a spec\n' });
  assert.notEqual(specCommit, headCommit);

  // Reviewer work in progress: a staged file, an unstaged edit, a stash.
  await writeFile(join(sandbox.project, 'README.md'), '# project\nstashed edit\n');
  await sandbox.git(sandbox.project, 'stash', 'push', '-q');
  await writeFile(join(sandbox.project, 'README.md'), '# project\nunstaged edit\n');
  await writeFile(join(sandbox.project, 'staged.txt'), 'staged\n');
  await sandbox.git(sandbox.project, 'add', 'staged.txt');
  const before = await reviewerState(sandbox);
  assert.notEqual(before.stash, '', 'the sandbox holds a stash to protect');

  const heads = await manager.listRemoteBranches(sandbox.project, sandbox.remote);
  const names = heads.map((h) => h.branch).sort();
  assert.deepEqual(names, ['develop', 'feature/ENG-12-data']);
  assert.equal(heads.find((h) => h.branch === 'feature/ENG-12-data')?.commit, headCommit);

  const fetched = [];
  for (const [n, h] of heads.entries()) {
    fetched.push({ ...h, ...(await manager.fetchSpecRef({ clonePath: sandbox.project, remoteUrl: sandbox.remote, branch: h.branch, sessionId: SESSION, snapshotId: SNAPSHOT, n })) });
  }
  for (const f of fetched) assert.ok(f.ref.startsWith(PREFIX + 'spec-'), `${f.ref} is a product-owned spec ref`);
  assert.deepEqual(
    (await sandbox.refs()).filter((r) => r.startsWith('refs/prwb/')).sort(),
    fetched.map((f) => f.ref).sort(),
    'only the spec refs were written under refs/prwb/',
  );
  for (const f of fetched) assert.equal(await sandbox.git(sandbox.project, 'rev-parse', f.ref), f.commit, 'the ref holds the branch head');

  const branch = fetched.find((f) => f.branch === 'feature/ENG-12-data')!;
  const paths = await manager.listSpecFiles(sandbox.project, branch.commit);
  assert.deepEqual(paths.filter((p) => p.startsWith('specs/')).sort(), [`specs/${key}/spec.md`, `specs/${key}/tdd-evidence.md`]);
  assert.ok(!paths.includes('src/unrelated.txt'), 'only the specs tree is listed');

  const read = await manager.readSpecFile({ clonePath: sandbox.project, commit: branch.commit, path: `specs/${key}/spec.md`, maxBytes: 1_048_576 });
  assert.equal(read.commit, specCommit, 'read at the commit that last touched the file, not the branch head');
  assert.equal(read.content, '# Branch copy\n- **FR-001**: branch v2.\n');
  const evidence = await manager.readSpecFile({ clonePath: sandbox.project, commit: branch.commit, path: `specs/${key}/tdd-evidence.md`, maxBytes: 1_048_576 });
  assert.notEqual(evidence.commit, specCommit, 'each document carries its own last-touching commit');

  assert.deepEqual(await reviewerState(sandbox), before, 'branch, HEAD, index, stash, working files and the reviewer\'s own refs are unchanged');
});

test('a document over the size limit and an unsafe path or commit are refused before reading', async (t) => {
  const { sandbox, manager } = await harness(t);
  const commit = await sandbox.commitSpec('develop', specFolder('ENG-12-x', { spec: 'x'.repeat(5000) }));
  const base = { clonePath: sandbox.project, commit, maxBytes: 1_048_576 };
  await manager.fetchSpecRef({ clonePath: sandbox.project, remoteUrl: sandbox.remote, branch: 'develop', sessionId: SESSION, snapshotId: SNAPSHOT, n: 0 });
  await assert.rejects(manager.readSpecFile({ ...base, path: 'specs/ENG-12-x/spec.md', maxBytes: 1000 }), /1000|size|large/i);
  await assert.rejects(manager.readSpecFile({ ...base, path: 'specs/../README.md' }), /path/i);
  await assert.rejects(manager.readSpecFile({ ...base, path: 'README.md' }), /path/i);
  await assert.rejects(manager.readSpecFile({ ...base, commit: '--upload-pack=x', path: 'specs/ENG-12-x/spec.md' }), /commit/i);
  await assert.rejects(manager.listSpecFiles(sandbox.project, 'main; rm -rf /'), /commit/i);
});

test('a remote that cannot be reached fails with the first git error line, and writes no ref', async (t) => {
  const { sandbox, manager } = await harness(t);
  const before = await sandbox.refs();
  await assert.rejects(manager.listRemoteBranches(sandbox.project, join(sandbox.root, 'no-such.git')), (error: Error) => error.message.trim() !== '' && !error.message.includes('\n'));
  assert.deepEqual(await sandbox.refs(), before);
});

test('the spec refs are removed with the session, and no other ref is touched', async (t) => {
  const { sandbox, manager } = await harness(t);
  await sandbox.commitSpec('develop', specFolder('ENG-12-x'));
  const before = (await sandbox.refs()).filter((r) => !r.startsWith('refs/prwb/'));
  await manager.fetchSpecRef({ clonePath: sandbox.project, remoteUrl: sandbox.remote, branch: 'develop', sessionId: SESSION, snapshotId: SNAPSHOT, n: 0 });
  // A second session's ref must survive the first session's delete.
  const other = '33333333-3333-4333-8333-333333333333';
  await manager.fetchSpecRef({ clonePath: sandbox.project, remoteUrl: sandbox.remote, branch: 'develop', sessionId: other, snapshotId: SNAPSHOT, n: 0 });
  assert.equal((await sandbox.refs()).filter((r) => r.startsWith(PREFIX)).length, 1);

  await manager.deleteSessionRefs(sandbox.project, SESSION);
  const after = await sandbox.refs();
  assert.deepEqual(after.filter((r) => r.startsWith(PREFIX)), [], 'the session\'s spec refs are gone');
  assert.deepEqual(after.filter((r) => r.startsWith(`refs/prwb/${other}/`)).length, 1, 'another session\'s ref stays');
  assert.deepEqual(after.filter((r) => !r.startsWith('refs/prwb/')), before);
});
