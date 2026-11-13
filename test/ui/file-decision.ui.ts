// US3 (feature 005, FR-005, SC-003): deciding from the file view behaves like the overview, and both views
// show one decision. The behaviour comes from the shared decision panel and state (T029, T030, T033).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles } from '../helpers/fake-ai-cli.ts';
import { fakeGithubReviews } from '../helpers/fake-github-reviews.ts';


async function setup(t: Parameters<typeof useBrowser>[0]) {
  const platform = fakeGithubReviews();
  const b = await useBrowser(t, { prFiles: defaultPrFiles(), reviewer: 'rita-reviewer', intercept: platform.intercept });
  const { sessionId } = await b.bench.startSession();
  return { b, platform, file: `#/sessions/${sessionId}/diff?path=${encodeURIComponent('src/app.js')}`, overview: `#/sessions/${sessionId}` };
}

test('approve from the file view posts at once, then the overview shows the same decision', async (t) => {
  const { b, platform, file, overview } = await setup(t);
  const page = await b.openPage(file);
  await page.getByTestId('decision-approve').click();
  await page.waitForFunction(() => /You approved/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(platform.reviews.length, 1);
  const here = await page.getByTestId('decision-state').textContent();

  await page.evaluate((hash) => { location.hash = hash; }, overview);
  await page.getByTestId('overview').waitFor();
  await page.waitForFunction(() => /You approved/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(await page.getByTestId('decision-state').textContent(), here);
  assert.equal(platform.reviews.length, 1, 'viewing posts nothing');
});

test('request changes on the overview shows on the file view', async (t) => {
  const { b, file, overview } = await setup(t);
  const page = await b.openPage(overview);
  await page.getByTestId('decision-message').fill('Please add a test.');
  await page.getByTestId('decision-request-changes').click();
  await page.waitForFunction(() => /requested changes/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  await page.evaluate((hash) => { location.hash = hash; }, file);
  await page.getByTestId('diff-line-head-45').waitFor();
  await page.waitForFunction(() => /requested changes/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
});

test('the file view decision works from the keyboard', async (t) => {
  const { b, platform, file } = await setup(t);
  const page = await b.openPage(file);
  await page.getByTestId('decision-approve').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /You approved/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(platform.reviews.length, 1);
});
