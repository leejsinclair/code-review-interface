// US3 (FR-013): the two deviation lists, each statement cited (changed lines or a specification passage), and a
// line saying so when there are none.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { seedSpec, type SeedOptions } from '../helpers/spec-seed.ts';

async function open(t: Parameters<typeof useBrowser>[0], seed: SeedOptions) {
  const b = await useBrowser(t);
  const detail = await b.bench.startSession();
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Array<Record<string, unknown>>).at(-1)?.['snapshotId'] as string;
  seedSpec(b.bench.store, snapshotId, seed);
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('spec-deviations').waitFor();
  return { page, sessionId };
}

test('implemented-but-not-requested cites changed lines and requested-but-not-implemented is listed too', async (t) => {
  const { page, sessionId } = await open(t, { deviations: true });
  const unrequested = page.getByTestId('spec-dev-unrequested');
  assert.match((await unrequested.textContent()) ?? '', /Adds a cache the specification never mentions/);
  assert.match((await unrequested.textContent()) ?? '', /Inferred/);
  const link = unrequested.locator('a[data-testid="spec-citation"]');
  assert.match((await link.getAttribute('href')) ?? '', new RegExp(`#/sessions/${sessionId}/diff\\?path=src%2Futil\\.js`));
  const unimplemented = page.getByTestId('spec-dev-unimplemented');
  assert.match((await unimplemented.textContent()) ?? '', /FR-005 asks for a behaviour no change provides/);
  assert.match((await unimplemented.textContent()) ?? '', /Source not found in the stored text|Inferred/, 'an uncited statement is kept and marked, not dropped');
  assert.match((await page.getByTestId('spec-deviations').textContent()) ?? '', /Implemented but not requested/);
  assert.match((await page.getByTestId('spec-deviations').textContent()) ?? '', /Requested but not implemented/);
  await checkA11y(page);
});

test('no deviations: the panel says so rather than leaving the lists blank', async (t) => {
  const { page } = await open(t, { deviations: false });
  assert.match((await page.getByTestId('spec-deviations').textContent()) ?? '', /No deviations were found\./);
  assert.equal(await page.getByTestId('spec-dev-unrequested').count(), 0);
});
