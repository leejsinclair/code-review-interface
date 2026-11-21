// Spec 007 (T015, VO-030, FR-013, FR-014): the shared "approved by me" check over several pull requests.
// Written first: it fails until src/adapters/approved-by-me.ts exists (T019).
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { approvedAcross } from '../../src/adapters/approved-by-me.ts';
import { AdapterError } from '../../src/contracts/shared.ts';

const PLATFORM = 'github';
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function captureWarnings(): { lines: string[] } {
  const lines: string[] = [];
  mock.method(console, 'warn', (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  return { lines };
}

test('at most four checks run at once, and every pull request is checked', async (t) => {
  t.after(() => mock.restoreAll());
  let inFlight = 0;
  let peak = 0;
  const seen: number[] = [];
  const numbers = Array.from({ length: 12 }, (_, i) => i + 1);
  const result = await approvedAcross(PLATFORM, numbers, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    seen.push(n);
    await tick();
    await tick();
    inFlight -= 1;
    return n % 2 === 0;
  });
  assert.equal(peak, 4, 'concurrency is exactly the limit of 4');
  assert.deepEqual([...seen].sort((a, b) => a - b), numbers);
  assert.deepEqual([...result].sort((a, b) => a - b), [2, 4, 6, 8, 10, 12]);
});

test('a partial failure returns the successes and logs each failure with its pull request number and error code', async (t) => {
  t.after(() => mock.restoreAll());
  const { lines } = captureWarnings();
  const result = await approvedAcross(PLATFORM, [1, 2, 3, 4], async (n) => {
    if (n === 2) throw new AdapterError('rate_limited', PLATFORM, 'slow down');
    if (n === 4) throw new AdapterError('forbidden', PLATFORM, 'no access');
    return n === 1 || n === 3;
  });
  assert.deepEqual([...result].sort(), [1, 3]);
  assert.equal(lines.length, 2, 'one log line per failure');
  assert.ok(lines.some((l) => /\b2\b/.test(l) && l.includes('rate_limited')), 'pull request 2 with rate_limited');
  assert.ok(lines.some((l) => /\b4\b/.test(l) && l.includes('forbidden')), 'pull request 4 with forbidden');
});

test('a failure does not stop the checks after it', async (t) => {
  t.after(() => mock.restoreAll());
  captureWarnings();
  const seen: number[] = [];
  await approvedAcross(PLATFORM, [1, 2, 3, 4, 5, 6], async (n) => {
    seen.push(n);
    if (n === 1) throw new AdapterError('unavailable', PLATFORM);
    return true;
  });
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

test('every check failing throws unavailable for the platform', async (t) => {
  t.after(() => mock.restoreAll());
  const { lines } = captureWarnings();
  await assert.rejects(
    approvedAcross(PLATFORM, [7, 8, 9], async () => { throw new AdapterError('rate_limited', PLATFORM); }),
    (err: unknown) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.code, 'unavailable');
      assert.equal(err.platform, PLATFORM);
      return true;
    },
  );
  assert.equal(lines.length, 3, 'each failure is still logged');
});

test('a failure that is not an AdapterError counts as a failure and still lets the others through', async (t) => {
  t.after(() => mock.restoreAll());
  captureWarnings();
  const result = await approvedAcross(PLATFORM, [1, 2], async (n) => {
    if (n === 1) throw new Error('boom');
    return true;
  });
  assert.deepEqual([...result], [2]);
});

test('no pull requests gives an empty set, without calling the check or throwing', async () => {
  let calls = 0;
  const result = await approvedAcross(PLATFORM, [], async () => { calls += 1; return true; });
  assert.equal(result.size, 0);
  assert.equal(calls, 0);
});

test('checks that all succeed with no approvals give an empty set, not an error', async () => {
  const result = await approvedAcross(PLATFORM, [1, 2], async () => false);
  assert.equal(result.size, 0);
});
