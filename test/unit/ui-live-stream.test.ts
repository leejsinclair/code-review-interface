import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createLiveStream, type LiveState } from '../../src/ui/state/live-stream.ts';

function make() {
  const seen: LiveState[] = [];
  return { live: createLiveStream((s) => seen.push(s)), seen };
}

test('connecting to open, then error retries inside the grace period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { live, seen } = make();
  assert.equal(live.state, 'connecting');
  live.opened();
  live.errored(0);
  assert.equal(live.state, 'retrying');
  t.mock.timers.tick(4999);
  live.opened();
  t.mock.timers.tick(10000);
  assert.deepEqual(seen, ['open', 'retrying', 'open']);
});

test('retrying drops after 5 s, and Reconnect goes back to connecting', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { live, seen } = make();
  live.opened();
  live.errored(0);
  t.mock.timers.tick(5000);
  assert.equal(live.state, 'dropped');
  live.reconnect();
  assert.equal(live.state, 'connecting');
  assert.deepEqual(seen, ['open', 'retrying', 'dropped', 'connecting']);
});

test('CLOSED drops from any state', () => {
  for (const setup of [(l: ReturnType<typeof make>['live']) => undefined, (l: ReturnType<typeof make>['live']) => l.opened()]) {
    const { live } = make();
    setup(live);
    live.errored(2);
    assert.equal(live.state, 'dropped');
  }
  mock.reset();
});
