// US4 (FR-012, FR-029, FR-031): the Ask form has names, groups, linked errors and honest failed states.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';

const ANSWER = { claims: [{ text: 'Streamed claim.', label: 'inference', refs: [] }], unsupportedAssumptions: [], suggestedFollowUps: [] };

test('names, groups, default, disabled-with-reason, forced failure and reload', async (t) => {
  const b = await useBrowser(t, { fake: { scenario: 'structured', answer: ANSWER } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/ask`);
  const input = page.getByLabel('Your question');
  await input.waitFor();
  assert.ok(await page.getByRole('group', { name: 'Category' }).count());
  assert.ok(await page.getByRole('group', { name: 'Answer for' }).count());
  assert.equal(await page.getByTestId('answer-for-technical').isChecked(), true);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('h1').textContent(), 'Questions');

  const button = page.getByTestId('ask-button');
  assert.equal(await button.getAttribute('aria-disabled'), 'true');
  assert.equal(await button.getAttribute('aria-describedby'), 'ask-unavailable-reason');
  assert.match((await page.getByTestId('ask-unavailable-reason').textContent()) ?? '', /question/i);
  await button.focus();
  assert.equal(await button.evaluate((el) => el === document.activeElement), true, 'the unavailable button stays focusable');

  await page.route('**/api/sessions/*/questions', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 400, json: { error: { code: 'invalid_request', message: 'The question was refused.' } } }) : route.continue(),
  );
  await input.fill('What changed?');
  await page.getByTestId('category-why').check();
  await page.getByTestId('answer-for-business').check();
  await button.click();
  const alert = page.getByTestId('ask-error');
  await alert.waitFor();
  assert.equal(await alert.getAttribute('role'), 'alert');
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.equal(await input.getAttribute('aria-describedby'), 'ask-error');

  await page.reload();
  assert.equal(await page.getByLabel('Your question').inputValue(), 'What changed?');
  assert.equal(await page.getByTestId('category-why').isChecked(), true);
  assert.equal(await page.getByTestId('answer-for-business').isChecked(), true);
  await assertNoPageScroll(page);
  await checkA11y(page);
});

test('a streamed answer is announced and then complete; failed regions offer Retry', async (t) => {
  const b = await useBrowser(t, { fake: { scenario: 'structured', answer: ANSWER, chunks: 6, delayMs: 150 } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/ask`);
  await page.route('**/api/suggestions*', (route) => route.fulfill({ status: 500, json: { error: { code: 'platform_error', message: 'boom' } } }));
  await page.reload();
  await page.getByTestId('retry-suggestions').waitFor();

  await page.getByLabel('Your question').fill('Stream please');
  await page.getByTestId('ask-button').click();
  await page.getByText('Answer complete').waitFor({ timeout: 15000 });
  assert.equal(await page.getByTestId('live-region').textContent(), 'Answer complete');
});

test('an unavailable provider is a stated reason, and a failed provider check can be retried', async (t) => {
  const b = await useBrowser(t, { fake: null });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/ask`);
  await page.getByLabel('Your question').fill('Hello');
  assert.equal(await page.getByTestId('ask-button').getAttribute('aria-disabled'), 'true');
  assert.match((await page.getByTestId('ask-unavailable-reason').textContent()) ?? '', /provider/i);
  await page.route('**/api/provider', (route) => route.abort());
  await page.reload();
  await page.getByTestId('retry-provider').waitFor();
});
