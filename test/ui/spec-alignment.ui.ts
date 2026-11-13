// US2 (FR-011, FR-012, FR-014): one row per criterion, the test column, a flagged mismatch, the sufficiency verdict
// with its two lists, "Inferred" on every statement, and citations that open the stored text or the diff.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { seedSpec } from '../helpers/spec-seed.ts';

async function open(t: Parameters<typeof useBrowser>[0], seed: Parameters<typeof seedSpec>[2] = {}) {
  const b = await useBrowser(t);
  const detail = await b.bench.startSession();
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Array<Record<string, unknown>>).at(-1)?.['snapshotId'] as string;
  seedSpec(b.bench.store, snapshotId, seed);
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('spec-rows').waitFor();
  return { page, sessionId };
}

test('five rows, the uncovered one and the mismatch flagged, and an incomplete verdict with its lists', async (t) => {
  const { page } = await open(t);
  const rows = page.getByTestId('spec-row');
  assert.equal(await rows.count(), 5);
  assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-criterion-id'))), ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005']);
  const fr5 = page.locator('[data-testid="spec-row"][data-criterion-id="FR-005"]');
  assert.equal(await fr5.getAttribute('data-test'), 'none');
  assert.match((await fr5.textContent()) ?? '', /No test shown.*No test/s);
  const fr3 = page.locator('[data-testid="spec-row"][data-criterion-id="FR-003"]');
  assert.equal(await fr3.getAttribute('data-mismatch'), 'true');
  assert.match((await fr3.textContent()) ?? '', /May not test the right thing/);
  assert.match((await fr3.textContent()) ?? '', /Requires verification/);

  const verdict = page.getByTestId('spec-verdict');
  assert.equal(await verdict.getAttribute('data-outcome'), 'incomplete');
  assert.match((await verdict.textContent()) ?? '', /Testing looks incomplete/);
  assert.match((await page.getByTestId('spec-uncovered').textContent()) ?? '', /FR-005/);
  assert.match((await page.getByTestId('spec-mismatched').textContent()) ?? '', /third test checks a different behaviour/);
});

test('every row and the verdict are labelled Inferred, and the page never says Verified or approved', async (t) => {
  const { page } = await open(t);
  const labels = await page.getByTestId('spec-row').evaluateAll((els) => els.map((e) => (e.textContent ?? '').includes('Inferred')));
  assert.deepEqual(labels, [true, true, true, true, true]);
  assert.match((await page.getByTestId('spec-verdict').textContent()) ?? '', /Inferred/);
  assert.doesNotMatch((await page.getByTestId('spec-context').innerText()).toLowerCase(), /\b(verified|approved)\b/);
});

test('a spec citation opens the cited lines of the stored text and a code citation links to the diff', async (t) => {
  const { page, sessionId } = await open(t);
  await page.locator('[data-testid="spec-row"][data-criterion-id="FR-001"]').getByTestId('spec-citation').first().click();
  const cited = page.getByTestId('spec-cited-lines');
  await cited.waitFor();
  assert.equal(await page.getByTestId('spec-view-raw').getAttribute('aria-pressed'), 'true');
  assert.match((await cited.textContent()) ?? '', /FR-001/);
  await page.keyboard.press('Escape');
  const code = page.locator('[data-testid="spec-row"][data-criterion-id="FR-005"]').locator('a[data-testid="spec-citation"]');
  assert.match((await code.getAttribute('href')) ?? '', new RegExp(`#/sessions/${sessionId}/diff\\?path=src%2Futil\\.js`));
});

test('the table is accessible and flags are text, not colour only', async (t) => {
  const { page } = await open(t);
  assert.ok(await page.locator('[data-testid="spec-rows"] th[scope="col"]').count());
  await checkA11y(page);
});
