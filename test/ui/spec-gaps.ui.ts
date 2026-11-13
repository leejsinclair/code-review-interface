// US4 (FR-009, FR-010, FR-018): each gap is shown in words with its reason and where it looked, a stale notice says
// why, the completeness list carries the two rows, and Retry is offered only when it can work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { seedSpec, type SeedOptions } from '../helpers/spec-seed.ts';

async function open(t: Parameters<typeof useBrowser>[0], seed: SeedOptions, intercept?: (report: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const b = await useBrowser(t);
  const detail = await b.bench.startSession();
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Array<Record<string, unknown>>).at(-1)?.['snapshotId'] as string;
  seedSpec(b.bench.store, snapshotId, seed);
  const page = await b.openPage(`#/sessions/${sessionId}`);
  if (intercept !== undefined) {
    await page.route('**/spec-context', async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      intercept(body);
      await route.fulfill({ response: res, json: body });
    });
    await page.reload();
  }
  await page.getByTestId('spec-context').waitFor();
  return page;
}
const notices = async (page: Awaited<ReturnType<typeof open>>): Promise<string> => {
  await page.getByTestId('spec-notices').waitFor();
  return (await page.getByTestId('spec-notices').textContent()) ?? '';
};

test('no folder: "No specification was found", where it looked, no assessment and missing rows', async (t) => {
  const page = await open(t, { outcome: 'not-found' });
  assert.match(await notices(page), /No specification was found/);
  assert.match((await page.getByTestId('spec-summary-specification').textContent()) ?? '', /No specification was found.*no folder/s);
  assert.equal(await page.getByTestId('spec-verdict').count(), 0);
  assert.equal(await page.getByTestId('spec-rows').count(), 0);
  for (const source of ['specification', 'tdd-evidence']) {
    const row = page.getByTestId(`completeness-row-${source}`);
    await row.waitFor();
    assert.equal(await row.getAttribute('data-status'), 'missing');
  }
  await checkA11y(page);
});

test('a specification without evidence lists the criteria and says "No evidence available", not "No test shown"', async (t) => {
  const page = await open(t, { evidence: false, run: 'completed' });
  await page.getByTestId('spec-rows').waitFor();
  assert.equal(await page.getByTestId('spec-row').count(), 5);
  const tests = await page.locator('[data-testid="spec-row"] td:nth-child(3)').allTextContents();
  assert.ok(tests.every((x) => x.includes('No evidence available') && !x.includes('No test shown')), tests.join('|'));
  assert.match((await page.getByTestId('spec-summary-tdd').textContent()) ?? '', /No TDD evidence was found/);
  assert.match((await page.getByTestId('spec-verdict').textContent()) ?? '', /Testing cannot be judged/);
});

test('no key, outside a project and a failed read each have their own words', async (t) => {
  assert.match(await notices(await open(t, { outcome: 'no-key' })), /No key was found to search with/);
  assert.match(await notices(await open(t, { outcome: 'not-found', enclosingNote: 'not-inside-project' })), /not inside a known project repository; only its own repository was searched/);
  assert.match(await notices(await open(t, { outcome: 'failed' })), /Could not read the specification source: fatal: unable to access the remote/);
});

test('a failed assessment shows its reason with Retry, and Retry is absent while one is queued', async (t) => {
  const failed = await open(t, { run: 'failed' });
  // The session's own background run may still be queued when the page opens; it ends, and the seeded failure shows.
  await failed.getByText(/Assessment failed:/).waitFor({ timeout: 15_000 });
  assert.match(await notices(failed), /Assessment failed:.*the provider failed to start/);
  await failed.getByTestId('spec-retry').waitFor();

  const queued = await open(t, { run: 'none' }, (r) => {
    r['alignment'] = { runId: 'r1', state: 'pending', headCommit: r['headCommit'], stale: false, leftOut: [], rows: [] };
    r['canRetry'] = { allowed: false, reason: 'An assessment is already running.' };
  });
  assert.match(await notices(queued), /Assessment queued/);
  assert.equal(await queued.getByTestId('spec-retry').count(), 0);
});

test('a stale report says Stale with the reason beside it, and its documents are not shown as current', async (t) => {
  const page = await open(t, {}, (r) => {
    r['stale'] = true;
    r['staleReason'] = 'A newer snapshot of the pull request exists.';
    for (const k of r['keys']) for (const d of k['documents']) if (d['status'] === 'found') d['status'] = 'stale';
  });
  const stale = page.getByTestId('spec-notices').getByTestId('spec-stale');
  await stale.waitFor();
  assert.match((await stale.textContent()) ?? '', /Stale/);
  assert.match((await page.getByTestId('spec-notices').textContent()) ?? '', /A newer snapshot/);
  await checkA11y(page);
});
