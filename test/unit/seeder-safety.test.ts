// T006 (FR-027, FR-028, FR-045): the test-only seeder's safety rules.
//
// - Run names are `it-<suite>-<UTC yyyymmddhhmmssSSS>`.
// - Ownership accepts only the run's own name (the user) or `<run name>-<label>`
//   (its projects), never another run of the same suite and never a bare `it-`.
// - Leftover filtering lists other runs' `it-*` items and excludes the current run.
// - `GitlabSeeder` refuses a non-loopback address in its constructor, before any
//   request leaves the process.
//
// The modules under test are `test/seeder/run-name.ts` (T012) and
// `test/seeder/gitlab-seeder.ts` (T019). They are loaded inside each test body
// through a path variable, so this file loads and typechecks before they exist.
// The shapes below are the exports this file expects.

import assert from 'node:assert/strict';
import { test } from 'node:test';

interface RunNameModule {
  /** `it-<suite>-<UTC yyyymmddhhmmssSSS>`; `now` defaults to the current time. */
  makeRunName(suite: string, now?: Date): string;
  /** True only for `runName` itself or `<runName>-<label>`. */
  ownedBy(runName: string, name: string): boolean;
  /** The `it-*` names that do not belong to `runName`, in input order. */
  filterLeftovers(runName: string, names: readonly string[]): string[];
}

interface GitlabSeederModule {
  GitlabSeeder: new (options: { baseUrl: string; token: string }) => unknown;
}

const RUN_NAME_PATH = '../seeder/run-name.ts';
const GITLAB_SEEDER_PATH = '../seeder/gitlab-seeder.ts';

const loadRunName = async (): Promise<RunNameModule> => (await import(RUN_NAME_PATH)) as RunNameModule;
const loadGitlabSeeder = async (): Promise<GitlabSeederModule> =>
  (await import(GITLAB_SEEDER_PATH)) as GitlabSeederModule;

const RUN_NAME_SHAPE = /^it-([a-z0-9-]+)-(\d{17})$/;

test('run name is it-<suite>-<UTC yyyymmddhhmmssSSS>', async () => {
  const { makeRunName } = await loadRunName();
  const at = new Date(Date.UTC(2026, 10, 8, 9, 5, 7, 42));
  assert.equal(makeRunName('contract', at), 'it-contract-20261108090507042');
});

test('run name uses UTC and zero-pads every field', async () => {
  const { makeRunName } = await loadRunName();
  const at = new Date(Date.UTC(2027, 0, 2, 3, 4, 5, 6));
  assert.equal(makeRunName('lifecycle', at), 'it-lifecycle-20270102030405006');
});

test('run name defaults to the current time', async () => {
  const { makeRunName } = await loadRunName();
  const before = Date.now();
  const name = makeRunName('errors');
  const after = Date.now();
  const match = RUN_NAME_SHAPE.exec(name);
  assert.ok(match, `run name ${name} does not match it-<suite>-<17 digits>`);
  assert.equal(match[1], 'errors');
  const ts = match[2] ?? '';
  const parsed = Date.UTC(
    Number(ts.slice(0, 4)),
    Number(ts.slice(4, 6)) - 1,
    Number(ts.slice(6, 8)),
    Number(ts.slice(8, 10)),
    Number(ts.slice(10, 12)),
    Number(ts.slice(12, 14)),
    Number(ts.slice(14, 17)),
  );
  assert.ok(parsed >= before && parsed <= after, `timestamp ${ts} is not the current UTC time`);
});

test('ownership accepts the run name and its own labelled items', async () => {
  const { ownedBy } = await loadRunName();
  const run = 'it-contract-20261108090507042';
  assert.equal(ownedBy(run, run), true, 'the run user');
  assert.equal(ownedBy(run, `${run}-review`), true, 'a run project');
  assert.equal(ownedBy(run, `${run}-review-fork`), true, 'a fork of a run project');
});

test('ownership refuses another run of the same suite', async () => {
  const { ownedBy } = await loadRunName();
  const run = 'it-contract-20261108090507042';
  assert.equal(ownedBy(run, 'it-contract-20261108090507043'), false);
  assert.equal(ownedBy(run, 'it-contract-20261108090507043-review'), false);
  assert.equal(ownedBy(run, 'it-contract-20251108090507042'), false);
});

test('ownership refuses a name that only extends the run name without a separator', async () => {
  const { ownedBy } = await loadRunName();
  const run = 'it-contract-20261108090507042';
  assert.equal(ownedBy(run, `${run}0`), false);
  assert.equal(ownedBy(run, `${run}x-review`), false);
});

test('ownership refuses a bare it- prefix, other suites and unrelated names', async () => {
  const { ownedBy } = await loadRunName();
  const run = 'it-contract-20261108090507042';
  assert.equal(ownedBy(run, 'it-'), false);
  assert.equal(ownedBy(run, 'it-contract'), false);
  assert.equal(ownedBy(run, 'it-contract-'), false);
  assert.equal(ownedBy(run, 'it-lifecycle-20261108090507042'), false);
  assert.equal(ownedBy(run, 'root'), false);
  assert.equal(ownedBy(run, ''), false);
});

test('ownership never trusts a bare it- run name', async () => {
  const { ownedBy } = await loadRunName();
  assert.equal(ownedBy('it-', 'it-contract-20261108090507042'), false);
  assert.equal(ownedBy('', 'it-contract-20261108090507042'), false);
});

test('leftover filtering lists other runs and excludes the current run', async () => {
  const { filterLeftovers } = await loadRunName();
  const run = 'it-contract-20261108090507042';
  const names = [
    run,
    `${run}-review`,
    'it-contract-20261107010101001',
    'it-contract-20261107010101001-review',
    'it-lifecycle-20261108090507042',
    'root',
    'demo-project',
    'kit-contract-20261107010101001',
  ];
  assert.deepEqual(filterLeftovers(run, names), [
    'it-contract-20261107010101001',
    'it-contract-20261107010101001-review',
    'it-lifecycle-20261108090507042',
  ]);
});

test('leftover filtering returns nothing when only the current run exists', async () => {
  const { filterLeftovers } = await loadRunName();
  const run = 'it-errors-20261108090507042';
  assert.deepEqual(filterLeftovers(run, [run, `${run}-hidden`, 'root']), []);
});

/** Replaces global `fetch` for one test, recording every call. */
function trapFetch(t: { after(fn: () => void): void }): { calls: unknown[] } {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (...args: unknown[]) => {
    calls.push(args[0]);
    throw new Error('seeder-safety: no request may leave the process');
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return { calls };
}

const NON_LOOPBACK = [
  'http://gitlab.example.com',
  'https://gitlab.example.com',
  'http://localhost.example.com',
  'http://10.0.0.5',
  'http://192.168.1.10:8929',
  'http://128.0.0.1',
  'http://[::2]',
];

for (const baseUrl of NON_LOOPBACK) {
  test(`GitlabSeeder refuses non-loopback ${baseUrl} before any request`, async (t) => {
    const { calls } = trapFetch(t);
    const { GitlabSeeder } = await loadGitlabSeeder();
    assert.throws(() => new GitlabSeeder({ baseUrl, token: 'root-token' }));
    assert.deepEqual(calls, [], 'a request was sent');
  });
}

const LOOPBACK = ['http://localhost:8929', 'http://127.0.0.1:8929', 'http://[::1]:8929', 'http://127.1.2.3'];

for (const baseUrl of LOOPBACK) {
  test(`GitlabSeeder accepts loopback ${baseUrl} without sending a request`, async (t) => {
    const { calls } = trapFetch(t);
    const { GitlabSeeder } = await loadGitlabSeeder();
    assert.doesNotThrow(() => new GitlabSeeder({ baseUrl, token: 'root-token' }));
    assert.deepEqual(calls, [], 'constructing the seeder sent a request');
  });
}
