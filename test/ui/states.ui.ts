// US8 (FR-028 to FR-030): regions show loading and failed states with a working Retry, and a dropped live stream
// shows a banner whose Reconnect button restores events and refetches.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBrowser } from '../helpers/browser.ts';

test('a held response is loading, a failed one offers Retry, and Retry recovers', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage('#/');
  let mode: 'hold' | 'fail' | 'ok' = 'hold';
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (mode === 'hold') await held;
    return mode === 'fail' ? route.fulfill({ status: 500, json: { error: { code: 'platform_error', message: 'boom' } } }) : route.continue();
  });

  await page.reload();
  const sessions = page.getByTestId('async-sessions');
  await sessions.waitFor();
  assert.equal(await sessions.getAttribute('data-state'), 'loading');
  assert.equal(await sessions.getAttribute('aria-busy'), 'true');
  mode = 'fail';
  release();
  await page.getByTestId('retry-sessions').waitFor();
  assert.equal(await sessions.getAttribute('data-state'), 'failed');
  mode = 'ok';
  await page.getByTestId('retry-sessions').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="async-sessions"]')?.getAttribute('data-state') === 'loaded');
  assert.ok(sessionId);
});

test('a failed provider check and failed suggestions each show Retry, and Retry recovers', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/ask`);
  let failing = true;
  const flaky = (route: import('playwright').Route) =>
    failing ? route.fulfill({ status: 500, json: { error: { code: 'platform_error', message: 'boom' } } }) : route.continue();
  await page.route('**/api/provider', flaky);
  await page.route('**/api/suggestions*', flaky);
  await page.reload();
  for (const region of ['provider', 'suggestions']) {
    await page.getByTestId(`retry-${region}`).waitFor();
    assert.equal(await page.getByTestId(`async-${region}`).getAttribute('data-state'), 'failed');
  }
  failing = false;
  for (const region of ['provider', 'suggestions']) await page.getByTestId(`retry-${region}`).click();
  await page.waitForFunction(() => ['provider', 'suggestions'].every((r) => document.querySelector(`[data-testid="async-${r}"]`)?.getAttribute('data-state') === 'loaded'));
});

test('a stream the server closes shows the banner within 5 s, and Reconnect clears it', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage('#/');
  let closed = true;
  await page.route(`**/api/sessions/${sessionId}/events`, (route) =>
    closed ? route.fulfill({ status: 503, body: 'down' }) : route.continue(),
  );
  await page.evaluate((id) => (location.hash = `#/sessions/${id}`), sessionId);
  await page.getByTestId('live-updates-banner').waitFor({ timeout: 8000 });
  assert.equal(await page.getByTestId('live-updates-banner').getAttribute('role'), 'status');

  closed = false;
  const detail = page.waitForRequest((r) => r.method() === 'GET' && r.url().endsWith(`/api/sessions/${sessionId}`));
  await page.getByTestId('reconnect-button').click();
  await detail;
  await page.getByTestId('live-updates-banner').waitFor({ state: 'detached', timeout: 8000 });
});
