// T009 (VO-008, VO-009): seed and clean refuse an unsafe target before sending anything, and stop with the start
// command when GitLab does not answer. fetch is stubbed, so no GitLab is needed.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clean } from '../demo/clean.ts';
import { seed } from '../demo/seed.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Every request fails as an unreachable host would; returns the methods sent. */
function unreachable(): string[] {
  const sent: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push(init?.method ?? 'GET');
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  return sent;
}

for (const [name, run] of [['seed', seed], ['clean', clean]] as const) {
  test(`${name} stops with the start command when GitLab is unreachable, and writes nothing`, async () => {
    const sent = unreachable();
    await assert.rejects(run({ gitlabUrl: 'http://127.0.0.1:9' }), /npm run gitlab:up/);
    assert.ok(sent.length > 0, 'the probe was sent');
    assert.deepEqual([...new Set(sent)], ['GET'], 'only the probe, never a write');
  });

  test(`${name} refuses a non-loopback GitLab before any request`, async () => {
    const sent = unreachable();
    await assert.rejects(run({ gitlabUrl: 'http://gitlab.example.com' }), /non-loopback/);
    assert.equal(sent.length, 0);
  });

  test(`${name} refuses a group outside prwb-demo before any request`, async () => {
    const sent = unreachable();
    for (const group of ['prwb-it/x', 'prwb-demo', 'prwb-demo/a/b', 'other/acme']) {
      await assert.rejects(run({ group, gitlabUrl: 'http://127.0.0.1:9' }), /prwb-demo\/<name>/, group);
    }
    assert.equal(sent.length, 0);
  });
}
