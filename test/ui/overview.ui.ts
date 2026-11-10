// US7 (FR-009, FR-025 to FR-027, FR-028): Overview leads with the summary, completeness and a filterable file
// list; per-file explanations are disclosed on request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';

const SUMMARY = {
  prSummary: [{ text: 'Summary claim.', label: 'inference', refs: [] }],
  files: [{ path: 'src/f05.js', claims: [{ text: 'Explains f05.', label: 'inference', refs: [] }] }],
  functionalImpact: [],
  technicalImpact: [],
};
const files = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`src/f${String(i).padStart(2, '0')}.js`, `export const n = ${i};\n`]));

test('order, reachability, filter, explanations, badges and a single h1', async (t) => {
  const b = await useBrowser(t, { prFiles: files, fake: { scenario: 'structured', summary: SUMMARY } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('file-list').waitFor();
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('h1').textContent(), 'Overview');

  const order = await page.evaluate(() => {
    const ids = ['pr-summary', 'completeness', 'file-list', 'review-focus'];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el === null ? -1 : el.getBoundingClientRect().top + scrollY;
    });
  });
  assert.ok(order.every((n) => n >= 0), `all sections present: ${order}`);
  assert.deepEqual([...order].sort((a, c) => a - c), order, 'sections appear in the specified order');
  assert.match((await page.getByTestId('review-focus').textContent()) ?? '', /Review focus\s*Not available yet\./);

  for (let i = 0; i < 32; i += 1) assert.equal(await page.getByTestId(`changed-file-src/f${String(i).padStart(2, '0')}.js`).count(), 1);
  assert.equal(await page.locator('[data-testid^="file-summary-"]:visible').count(), 0, 'per-file summaries are not listed');

  const toggle = page.getByTestId('file-explanation-src/f05.js');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.getByTestId('file-summary-src/f05.js').waitFor();

  await page.getByTestId('file-filter').fill('f1');
  assert.equal(await page.locator('[data-testid^="changed-file-"]').count(), 10);
  await page.getByTestId('file-filter').fill('zzz');
  await page.getByTestId('file-filter-empty').waitFor();
  await page.getByTestId('file-filter-clear').click();
  assert.equal(await page.locator('[data-testid^="changed-file-"]').count(), 32);

  const badge = page.locator('[data-testid="completeness-row-pr"] .badge[data-status]');
  assert.ok(await badge.count());
  assert.ok(((await badge.first().textContent()) ?? '').trim().length > 1, 'badge has glyph and text');
  await checkA11y(page);
});

test('failed summaries show Retry', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.route('**/api/sessions/*/snapshots/*/summaries', (route) => route.fulfill({ status: 500, json: { error: { code: 'platform_error', message: 'boom' } } }));
  await page.reload();
  await page.getByTestId('retry-summaries').waitFor();
});
