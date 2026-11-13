// US1 (FR-007, FR-008): the Overview shows the Specification panel in place of "Changed files": both summaries,
// where each document was read from, and the full text on request, read-only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { seedSpec, SPEC_TEXT } from '../helpers/spec-seed.ts';

async function open(t: Parameters<typeof useBrowser>[0], seed: Parameters<typeof seedSpec>[2] = {}) {
  const b = await useBrowser(t);
  const detail = await b.bench.startSession();
  const sessionId = detail['sessionId'] as string;
  const snapshotId = (detail['snapshots'] as Array<Record<string, unknown>>).at(-1)?.['snapshotId'] as string;
  const seeded = seedSpec(b.bench.store, snapshotId, seed);
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('spec-context').waitFor();
  return { b, page, seeded };
}

test('the panel replaces "Changed files": summaries, sources and no file list', async (t) => {
  const { page } = await open(t);
  await page.getByTestId('spec-summary-specification').getByText('The specification asks for five behaviours.').waitFor();
  assert.match((await page.getByTestId('spec-summary-tdd').textContent()) ?? '', /Four of them have a test\./);
  assert.match((await page.getByTestId('spec-source-specification').textContent()) ?? '', /project-hd-v3.*develop.*11111111.*specs\/006-ABC-12-x/);
  assert.match((await page.getByTestId('spec-source-tdd').textContent()) ?? '', /tdd-evidence\.md/);
  assert.equal(await page.getByRole('heading', { name: 'Changed files' }).count(), 0, 'no "Changed files" heading');
  assert.equal(await page.getByTestId('file-list').count(), 0, 'no file list on the overview');
  assert.ok((await page.getByTestId('spec-summary-specification').textContent())?.includes('Inferred'), 'summaries are labelled Inferred');
  assert.doesNotMatch((await page.getByTestId('spec-context').innerText()).toLowerCase(), /\b(verified|approved)\b/);
});

test('"Read in full" opens a Markdown preview, with the raw text one click away, read-only, and Escape closes it', async (t) => {
  const { page } = await open(t);
  await page.getByTestId('spec-open-specification').click();
  const preview = page.getByTestId('spec-document-preview');
  await preview.waitFor();
  assert.equal(await page.getByTestId('spec-view-preview').getAttribute('aria-pressed'), 'true');
  assert.equal((await preview.locator('h1').textContent())?.trim(), 'Spec');
  assert.equal((await preview.locator('strong').first().textContent())?.trim(), 'FR-001');
  assert.equal(await page.getByTestId('spec-document-text').count(), 0, 'raw text is not shown in preview');
  await checkA11y(page);
  await page.getByTestId('spec-view-raw').click();
  const text = page.getByTestId('spec-document-text');
  await text.waitFor();
  assert.ok(((await text.textContent()) ?? '').includes('FR-001'));
  assert.equal(await text.evaluate((el) => el.textContent?.replace(/\s+/g, ' ').trim()), SPEC_TEXT.replace(/\s+/g, ' ').trim());
  assert.equal(await page.getByTestId('spec-document').locator('textarea, input, [contenteditable="true"]').count(), 0, 'no edit control');
  await page.keyboard.press('Escape');
  await page.getByTestId('spec-document').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'spec-open-specification', 'focus returns to the opener');
});

test('a matching branch is named and the develop copy is mentioned', async (t) => {
  const { page } = await open(t, { branch: 'feature/ABC-12-x' });
  assert.match((await page.getByTestId('spec-source-specification').textContent()) ?? '', /feature\/ABC-12-x/);
  assert.match((await page.getByTestId('spec-other-copy').first().textContent()) ?? '', /develop also has a copy/);
  assert.match((await page.getByTestId('spec-rule').first().textContent()) ?? '', /matching branch/i);
  await checkA11y(page);
});
