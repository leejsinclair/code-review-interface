// A finished discovery run tells the app (so open review pages re-read repository availability and
// enable Refresh); a run cancelled by a newer one stays silent. The event hub's `broadcast` reaches
// every session's streams.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ServerResponse } from 'node:http';
import { createWorkspace } from '../../src/core/workspace.ts';
import { createEventHub } from '../../src/server/events.ts';

test('onSettled fires once per completed run, not for a superseded one', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'ws-settled-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  let settled = 0;
  const workspace = createWorkspace({
    manager: { readRemotes: async () => [] },
    appDataDir: base,
    matcherFor: () => () => null,
    onSettled: () => {
      settled += 1;
    },
  });
  const settings = { baseFolder: base, platform: 'github' as const };

  workspace.configure(settings);
  workspace.rescan(); // supersedes the first run before it reports
  await workspace.settled();
  assert.equal(settled, 1);

  workspace.rescan();
  await workspace.settled();
  assert.equal(settled, 2);
});

test('broadcast reaches streams of different sessions and counts them', () => {
  const hub = createEventHub({ heartbeatMs: 0 });
  const stream = () => {
    const written: string[] = [];
    const res = Object.assign(new EventEmitter(), {
      headersSent: true,
      writableEnded: false,
      destroyed: false,
      socket: null,
      write: (chunk: string) => (written.push(chunk), true),
      end() {},
    }) as unknown as ServerResponse;
    return { res, written };
  };
  const a = stream();
  const b = stream();
  hub.subscribe('s1', a.res);
  hub.subscribe('s2', b.res);

  assert.equal(hub.broadcast('session', { reason: 'x' }), 2);
  for (const s of [a, b]) assert.ok(s.written.some((w) => w.startsWith('event: session\n')));
  hub.close();
});
