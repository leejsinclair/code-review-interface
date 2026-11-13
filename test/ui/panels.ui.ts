// US6 (FR-019 to FR-023, FR-042): code citations open the Files view with the cited lines selected (the code page
// when the diff cannot show them), and Ask about the PR opens the Questions page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles, waitFor } from '../helpers/fake-ai-cli.ts';

const ref = (path: string, startLine: number, endLine: number) => ({ kind: 'code', path, side: 'head', startLine, endLine });
const ANSWER = {
  claims: [{ text: 'The loop is bounded.', label: 'evidence', refs: [ref('src/app.js', 45, 50)] }],
  unsupportedAssumptions: [],
  suggestedFollowUps: [],
};
const diffHash = (id: string, path: string): string => `#/sessions/${id}/diff?path=${encodeURIComponent(path)}`;

test('a code citation opens the Files view with the cited lines selected; one outside the diff opens the code page', async (t) => {
  const b = await useBrowser(t, { fake: { scenario: 'structured', answer: ANSWER } });
  const { sessionId } = await b.bench.startSession();
  const asked = await b.bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What does the loop do?' });
  assert.equal(asked.status, 202, asked.text);
  await waitFor(async () => ((await b.bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Array<{ state: string }>).every((q) => q.state === 'completed'), 'the answer');
  const page = await b.openPage(`#/sessions/${sessionId}/ask`, { width: 1440 });
  await page.getByTestId('claim-ref').first().waitFor();
  await page.getByTestId('claim-ref').first().click();
  await page.getByTestId('diff-line-head-45').waitFor();
  assert.match(page.url(), /\/diff\?path=src%2Fapp\.js/);
  assert.match(page.url(), /start=45&end=50/);
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 6);
  assert.equal(await page.getByTestId('evidence-panel').count(), 0);
  assert.ok(await page.getByTestId('diff-line-head-45').isVisible());

  // A range the diff cannot show lands on the code page.
  const snapshot = ((await b.bench.client.get(`/api/sessions/${sessionId}`)).json as { snapshots: Array<{ snapshotId: string }> }).snapshots.at(-1)!.snapshotId;
  await page.goto(`${page.url().split('#')[0]}#/sessions/${sessionId}/diff?path=src%2Fapp.js&snapshot=${snapshot}&side=head&start=78&end=90`);
  await page.getByTestId('code-range-notice').waitFor();
  assert.match(page.url(), /\/code\?/);
});

test('ask-about-pr opens the Questions page for the whole PR, from Overview and from Files', async (t) => {
  const b = await useBrowser(t, { prFiles: defaultPrFiles() });
  const { sessionId } = await b.bench.startSession();
  for (const hash of [`#/sessions/${sessionId}`, diffHash(sessionId, 'src/app.js')]) {
    const page = await b.openPage(hash, { width: 1440 });
    await page.getByTestId('ask-about-pr').click();
    await page.waitForURL(/\/ask/);
    assert.match((await page.getByTestId('scope-indicator').textContent()) ?? '', /whole PR/);
    assert.equal(await page.locator('[data-panel]').count(), 0, 'there is no side panel');
    await page.context().close();
  }
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
