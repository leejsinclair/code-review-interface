// R17: throttled polite announcements. Module under test: src/ui/state/announcer.ts (T007).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnnouncer } from '../../src/ui/state/announcer.ts';

const setup = () => {
  const out: string[] = [];
  return { out, a: createAnnouncer((t) => out.push(t), { intervalMs: 2000 }) };
};

test('now writes at once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { out, a } = setup();
  a.now('Selected: a.ts lines 1–2 (new side)');
  assert.deepEqual(out, ['Selected: a.ts lines 1–2 (new side)']);
});

test('stream announces at most once every 2 s, only the added text', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { out, a } = setup();
  a.stream('Hello');
  assert.deepEqual(out, ['Hello']);
  a.stream('Hello there');
  a.stream('Hello there world');
  assert.deepEqual(out, ['Hello']);
  t.mock.timers.tick(1999);
  assert.deepEqual(out, ['Hello']);
  t.mock.timers.tick(1);
  assert.deepEqual(out, ['Hello', ' there world']);
  t.mock.timers.tick(5000);
  assert.equal(out.length, 2);
});

test('done says Answer complete and drops pending text', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { out, a } = setup();
  a.stream('One');
  a.stream('One two');
  a.done();
  t.mock.timers.tick(5000);
  assert.deepEqual(out, ['One', 'Answer complete']);
});
