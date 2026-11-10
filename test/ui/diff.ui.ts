// US2 (FR-005 to FR-008, FR-022, FR-024, FR-031): the diff is readable without colour and a range is
// selectable entirely by keyboard.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles } from '../helpers/fake-ai-cli.ts';

const files = { ...defaultPrFiles(), 'assets/logo.bin': 'PNG\u0000\u0001\u0002binary\u0000data' };
const diffHash = (id: string, path: string): string => `#/sessions/${id}/diff?path=${encodeURIComponent(path)}`;

test('marks, keyboard selection, scope bar and live region move together', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/app.js'), { width: 1440 });
  await page.getByTestId('diff-line-head-40').waitFor();

  assert.equal(await page.getByTestId('diff-line-head-40').getAttribute('data-type'), 'add');
  assert.match((await page.getByTestId('diff-line-head-40').locator('.mark').textContent()) ?? '', /\+/);

  // One Tab stop for the whole diff: focus the first line button, Tab leaves the diff.
  await page.locator('[data-cursor="true"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  const scope = (await page.getByTestId('scope-indicator').textContent()) ?? '';
  assert.match(scope, /^Selected: src\/app\.js lines \d+–\d+ \(new side\)$/);
  assert.equal(await page.getByTestId('live-region').textContent(), scope);
  assert.equal(await page.getByTestId('live-region').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 3);

  // At this width Ask opens beside the diff, so the diff and its cursor stay put.
  await page.getByTestId('ask-about-selection').click();
  await page.locator('[data-panel="ask"]').waitFor();
  await page.getByTestId('diff-line-head-40').waitFor();
});

test('Escape clears the selection', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/app.js'));
  await page.getByTestId('diff-line-head-40').getByRole('button').click();
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 1);
  await page.locator('[data-cursor="true"]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 0);
});

test('layout per band, binary files, axe and no page scroll in both themes', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [1440, 1000, 400]) {
      const page = await b.openPage(diffHash(sessionId, 'src/app.js'), { width, colorScheme });
      await page.getByTestId('diff-line-head-40').waitFor();
      if (width === 1440) {
        const toggle = page.getByTestId('file-list-toggle');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await toggle.click();
        assert.equal(await page.getByTestId('file-list').count(), 1);
      } else if (width === 1000) {
        assert.equal(await page.getByTestId('file-list').count(), 0);
        await page.getByTestId('file-list-toggle').click();
        assert.equal(await page.getByTestId('file-list').count(), 1);
      } else {
        assert.ok((await page.getByTestId('next-file').count()) + (await page.getByTestId('prev-file').count()) >= 1);
        assert.equal(await page.getByTestId('all-changed-files').count(), 1);
      }
      await assertNoPageScroll(page);
      await checkA11y(page);
      await page.context().close();
    }
  }
  const page = await b.openPage(diffHash(sessionId, 'assets/logo.bin'));
  await page.getByTestId('skipped-file-assets/logo.bin').waitFor();
  assert.match((await page.getByTestId('skipped-file-assets/logo.bin').textContent()) ?? '', /[Bb]inary/);
});
