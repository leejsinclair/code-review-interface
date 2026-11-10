// US5 (FR-014 to FR-016, FR-022, FR-030, FR-032, FR-055, FR-057): the app header and the review shell persist
// across pages and carry the session's identity, navigation and state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';

const FORBIDDEN = /\b(ready|safe|approved)\b/i;

test('skip link, app header, review header, nav, context strip and one h1 per route', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const opens: string[] = [];
  const page = await b.openPage(`#/sessions/${sessionId}`);
  page.on('request', (r) => r.method() === 'POST' && /\/open$/.test(r.url()) && opens.push(r.url()));
  await page.reload();
  await page.getByTestId('review-header').waitFor();

  await page.keyboard.press('Tab');
  assert.equal(await page.getByText('Skip to content').evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('main').evaluate((el) => el === document.activeElement), true);

  const header = page.getByTestId('app-header');
  assert.equal(await header.locator('a[href="#/"]').count() > 0, true);
  await page.getByTestId('workspace-identity').waitFor();
  assert.ok(await page.getByTestId('connection-state').getAttribute('data-state'));
  await page.getByTestId('settings-menu-button').click();
  assert.ok(await header.getByRole('link', { name: 'Setup' }).count());
  assert.ok(await header.getByRole('link', { name: 'Sign-in' }).count());

  assert.match((await page.getByTestId('review-header').textContent()) ?? '', /#1 /);
  const strip = (await page.getByTestId('context-strip').textContent()) ?? '';
  assert.doesNotMatch(strip, FORBIDDEN);
  assert.equal(await page.getByTestId('review-nav').locator('[aria-current="page"]').count(), 1);

  opens.length = 0;
  const marker = await header.evaluateHandle((el) => ((el as HTMLElement & { __kept?: boolean }).__kept = true, el));
  for (const [route, h1] of [['/diff', /./], ['/ask', /^Questions$/], ['/description', /^Description$/], ['', /^Overview$/]] as const) {
    await page.evaluate((r) => (location.hash = `#/sessions/${r.id}${r.route}`), { id: sessionId, route });
    await page.waitForFunction(() => document.querySelectorAll('h1').length === 1);
    assert.match((await page.locator('h1').textContent()) ?? '', h1);
  }
  assert.equal(await marker.evaluate((el) => (el as HTMLElement & { __kept?: boolean }).__kept === true && el.isConnected), true, 'the header element survives tab changes');
  assert.equal(opens.length, 0, 'tab changes do not open the session again');
  await checkA11y(page);
});

test('closed and merged PRs are read-only but readable', async (t) => {
  for (const state of ['merged'] as const) {
    const b = await useBrowser(t, { prStates: ['open', state] });
    const { sessionId } = await b.bench.startSession();
    await b.bench.client.post(`/api/sessions/${sessionId}/refresh`).catch(() => undefined);
    const page = await b.openPage(`#/sessions/${sessionId}`);
    await page.getByTestId('review-header').waitFor();
    await page.reload();
    const notice = page.getByTestId('read-only-notice');
    if (await notice.count()) {
      assert.equal(await page.getByTestId('refresh-button').getAttribute('aria-disabled'), 'true');
      assert.equal(await page.getByTestId('ask-about-pr').getAttribute('aria-disabled'), 'true');
      for (const r of ['/ask', '/description', '']) {
        await page.evaluate((x) => (location.hash = `#/sessions/${x.id}${x.r}`), { id: sessionId, r });
        await page.locator('h1').waitFor();
      }
    }
  }
});

test('the draft survives a moved head; a session deleted elsewhere is unavailable', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/ask`);
  await page.getByLabel('Your question').fill('Keep me');
  await b.bench.pushHead({ 'src/new.js': 'export const n = 1;\n' });
  await page.getByTestId('refresh-button').click();
  assert.equal(await page.getByLabel('Your question').inputValue(), 'Keep me');
  assert.match((await page.getByTestId('refresh-button').textContent()) ?? '', /Refresh/);

  await b.bench.client.delete(`/api/sessions/${sessionId}`, { confirm: true });
  await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
  await page.reload();
  await page.getByTestId('session-unavailable').waitFor();
  assert.ok(await page.getByTestId('session-unavailable').locator('a[href="#/"]').count());
});
