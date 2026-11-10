// US9 (FR-032, FR-033, FR-047): Close and Delete sit in a menu; Delete asks first. Passes once the review shell
// (Phase 11) mounts SessionActions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBrowser } from '../helpers/browser.ts';

test('Escape and Cancel delete nothing; confirm deletes and goes Home', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const button = page.getByTestId('session-actions-button');
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  await button.click();
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  await page.getByTestId('close-session-button').waitFor();

  await page.getByTestId('delete-session-button').click();
  const dialog = page.getByTestId('delete-session-dialog');
  await dialog.waitFor();
  assert.match((await dialog.textContent()) ?? '', /questions, answers, summaries and snapshots/);
  assert.equal(await page.getByTestId('delete-session-cancel').evaluate((el) => el === document.activeElement), true);
  assert.match((await page.getByTestId('delete-session-confirm').getAttribute('class')) ?? '', /danger/);

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await b.bench.client.get(`/api/sessions/${sessionId}`)).status, 200);
  assert.equal(await button.evaluate((el) => el === document.activeElement), true);

  await button.click();
  await page.getByTestId('delete-session-button').click();
  await page.getByTestId('delete-session-cancel').click();
  assert.equal((await b.bench.client.get(`/api/sessions/${sessionId}`)).status, 200);
  assert.equal(await button.evaluate((el) => el === document.activeElement), true);

  await page.evaluate((id) => sessionStorage.setItem(`prwb:view:${id}`, '{"v":1}'), sessionId);
  await button.click();
  await page.getByTestId('delete-session-button').click();
  await page.getByTestId('delete-session-confirm').click();
  await page.waitForURL(/#\/$/);
  assert.equal((await b.bench.client.get(`/api/sessions/${sessionId}`)).status, 404);
  assert.equal(await page.evaluate((id) => sessionStorage.getItem(`prwb:view:${id}`), sessionId), null);
});
