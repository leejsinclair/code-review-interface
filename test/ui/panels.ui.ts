// US6 (FR-019 to FR-023, FR-042): Ask and Evidence open as panels on wide and medium screens and as full pages on
// narrow ones. Needs the review shell (Phase 11) to mount PanelHost, so it passes only after Phase 11.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles, waitFor } from '../helpers/fake-ai-cli.ts';

const ref = (path: string, startLine: number, endLine: number) => ({ kind: 'code', path, side: 'head', startLine, endLine });
const ANSWER = {
  claims: [{ text: 'The loop is bounded.', label: 'evidence', refs: [ref('src/app.js', 45, 50)] }],
  unsupportedAssumptions: [],
  suggestedFollowUps: [],
};
const diffHash = (id: string, path: string): string => `#/sessions/${id}/diff?path=${encodeURIComponent(path)}`;
const focusIs = (page: import('playwright').Page, id: string) => page.waitForFunction((want) => document.activeElement?.id === want, id);
const active = (page: import('playwright').Page) => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? '');

test('wide: Ask panel beside the diff, Evidence from a claim, Escape and close return focus', async (t) => {
  const b = await useBrowser(t, { prFiles: defaultPrFiles(), fake: { scenario: 'structured', answer: ANSWER } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/app.js'), { width: 1440 });
  await page.getByTestId('diff-line-head-40').getByRole('button').click();
  await page.getByTestId('ask-about-selection').click();
  const panel = page.getByTestId('ask-panel');
  await panel.waitFor();
  assert.match((await panel.getByTestId('scope-indicator').textContent()) ?? '', /src\/app\.js lines 40-40/);
  await page.waitForFunction(() => document.activeElement?.matches('[data-testid="ask-panel"] h2') === true);
  assert.equal(await page.getByTestId('diff-line-head-40').count(), 1, 'the diff stays beside the panel');
  await page.getByLabel('Your question').fill('Why?');
  await page.getByTestId('answer-for-business').check();

  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await focusIs(page, 'ask-about-selection');

  await page.getByTestId('ask-about-selection').click();
  await panel.waitFor();
  assert.equal(await page.getByLabel('Your question').inputValue(), 'Why?', 'the draft survives');
  await page.getByTestId('panel-close').click();
  await panel.waitFor({ state: 'detached' });
  await focusIs(page, 'ask-about-selection');
  await checkA11y(page);
});

test('wide: a claim reference opens the Evidence panel with the full range; focus and scroll return', async (t) => {
  const b = await useBrowser(t, { fake: { scenario: 'structured', answer: ANSWER } });
  const { sessionId } = await b.bench.startSession();
  const asked = await b.bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What does the loop do?' });
  assert.equal(asked.status, 202, asked.text);
  await waitFor(async () => ((await b.bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Array<{ state: string }>).every((q) => q.state === 'completed'), 'the answer');
  const page = await b.openPage(`#/sessions/${sessionId}/diff`, { width: 1440 });
  // From the Questions page the panel is not shown, so open the evidence from a page that shows both.
  await page.goto(`${page.url().split('#')[0]}#/sessions/${sessionId}/ask`);
  await page.getByTestId('claim-ref').first().waitFor();
  await page.getByTestId('claim-ref').first().scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await page.getByTestId('claim-ref').first().click();
  const panel = page.getByTestId('evidence-panel');
  await panel.waitFor();
  await panel.locator('tr[aria-current="true"]').first().waitFor();
  assert.equal(await panel.locator('tr[aria-current="true"]').count(), 6);
  assert.match((await panel.getByTestId('open-full-page').getAttribute('href')) ?? '', /start=45&end=50/);
  await page.waitForFunction(() => document.activeElement?.matches('[data-testid="evidence-panel"] h2') === true);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-testid="claim-ref"]') === true);
  // The page height differs by a few pixels while the panel is open, so the position returns to within 50px.
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - before) <= 50);
});

test('medium overlays, narrow opens full pages, and resizing keeps the draft', async (t) => {
  const b = await useBrowser(t, { prFiles: defaultPrFiles() });
  const { sessionId } = await b.bench.startSession();

  const medium = await b.openPage(diffHash(sessionId, 'src/app.js'), { width: 1000 });
  await medium.getByTestId('diff-line-head-40').click();
  await medium.getByTestId('ask-about-selection').click();
  await medium.getByTestId('ask-panel').waitFor();
  assert.equal(await medium.locator('.panel-host').getAttribute('data-band'), 'medium');
  assert.equal(await medium.getByTestId('ask-panel').evaluate((el) => getComputedStyle(el.parentElement as Element).position), 'fixed');

  const narrow = await b.openPage(diffHash(sessionId, 'src/app.js'), { width: 400 });
  await narrow.getByTestId('diff-line-head-40').click();
  await narrow.getByTestId('ask-about-selection').click();
  await narrow.waitForURL(/\/ask\?/);
  assert.equal(await narrow.getByTestId('ask-panel').count(), 0);
  await assertNoPageScroll(narrow);

  const page = await b.openPage(diffHash(sessionId, 'src/app.js'), { width: 1440 });
  await page.getByTestId('diff-line-head-40').click();
  await page.getByTestId('ask-about-selection').click();
  await page.getByTestId('ask-panel').waitFor();
  await page.getByLabel('Your question').fill('Draft kept');
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByTestId('ask-panel').waitFor();
  assert.equal(await page.getByLabel('Your question').inputValue(), 'Draft kept');
  assert.equal(await page.getByTestId('ask-panel').evaluate((el) => getComputedStyle(el.parentElement as Element).position), 'fixed');
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForURL(/\/ask\?/);
  assert.equal(await page.getByTestId('ask-panel').count(), 0);
  assert.equal(await page.getByLabel('Your question').inputValue(), 'Draft kept');
});

test('ask-about-pr works from Overview', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`, { width: 1440 });
  await page.getByTestId('ask-about-pr').click();
  await page.getByTestId('ask-panel').waitFor();
  assert.match((await page.getByTestId('ask-panel').getByTestId('scope-indicator').textContent()) ?? '', /whole PR/);
});

test('every 001 route opens as a deep link; Sources sub-navigation; markup shows literally', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const detail = (await b.bench.client.get(`/api/sessions/${sessionId}`)).json as { issues: Array<{ platform: string; key: string }> };
  const issue = detail.issues[0];
  assert.ok(issue, 'the session links an issue');
  const html = '<img src=x onerror="window.__pwned=1"><b>bold</b> **md**';
  const page = await b.openPage(`#/sessions/${sessionId}/description`, { width: 1440 });
  await page.route(new RegExp(`/api/sessions/${sessionId}(/open)?$`), async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { description: string; issues: Array<{ descriptionText?: string }> };
    json.description = html;
    for (const i of json.issues) i.descriptionText = html;
    await route.fulfill({ response: res, json });
  });
  await page.reload();
  await page.locator('h1').waitFor();
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('h1').textContent(), 'Description');
  const nav = page.getByTestId('sources-nav');
  await nav.waitFor();
  assert.equal(await nav.getByTestId('sources-description').getAttribute('aria-current'), 'page');
  assert.equal(await nav.getByTestId(`sources-issue-${issue.key}`).count(), 1);
  assert.equal(await page.getByTestId('pr-description').locator('pre').textContent(), html);
  assert.equal(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), undefined);
  await checkA11y(page);

  await nav.getByTestId(`sources-issue-${issue.key}`).click();
  await page.getByTestId('issue-view').waitFor();
  assert.equal(await page.locator('h1').textContent(), issue.key);
  assert.equal(await page.getByTestId(`sources-issue-${issue.key}`).getAttribute('aria-current'), 'page');
  assert.equal(await page.getByTestId('issue-view').locator('pre').textContent(), html);
  await checkA11y(page);
});
