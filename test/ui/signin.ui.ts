// US10 (FR-038): Sign-in explains itself and returns to the page that sent the reviewer there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBrowser } from '../helpers/browser.ts';

const signedIn = (platform: string) => ({ status: 200, json: { platform, state: 'signed-in', account: 'me' } });

test('explains why, for which platform, and that access is read-only', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/signin');
  const form = page.locator('[data-testid^="signin-form-"]').first();
  await form.waitFor();
  const text = (await page.getByTestId('signin').textContent()) ?? '';
  assert.match(text, /read-only/i);
  assert.match((await form.textContent()) ?? '', /needs your .* sign-in/);
});

test('a session page that needs sign-in returns there after success', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage('#/');
  await page.route('**/api/signins/*', (route) => (route.request().method() === 'PUT' ? route.fulfill(signedIn('github')) : route.continue()));
  let blocked = true;
  await page.route(new RegExp(`/api/sessions/${sessionId}(/open)?$`), (route) =>
    blocked ? route.fulfill({ status: 409, json: { error: { code: 'signin_required', message: 'Sign in again.', platform: 'github' } } }) : route.continue(),
  );
  await page.evaluate((id) => (location.hash = `#/sessions/${id}`), sessionId);
  await page.waitForURL(/#\/signin\?return=/);
  blocked = false;
  const form = page.getByTestId('signin-form-github');
  await form.waitFor();
  await form.locator('input[type="password"]').fill('token');
  const account = form.locator('input[type="text"]');
  if (await account.count()) await account.fill('me@example.com');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(new RegExp(`#/sessions/${sessionId}$`));
});

test('an outside, setup or sign-in return goes Home', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/');
  await page.route('**/api/signins/*', (route) => (route.request().method() === 'PUT' ? route.fulfill(signedIn('github')) : route.continue()));
  for (const bad of ['https://evil.example/', '#/setup', '#/signin']) {
    await page.evaluate((r) => (location.hash = `#/signin?return=${encodeURIComponent(r)}`), bad);
    const form = page.getByTestId('signin-form-github');
    await form.waitFor();
    await form.locator('input[type="password"]').fill('token');
    const account = form.locator('input[type="text"]');
    if (await account.count()) await account.fill('me@example.com');
    await form.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/#\/$/);
  }
});
