// US3 (FR-009 to FR-011, SC-004): labels are visible without colour, and following a cited range marks every
// line of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles, waitFor } from '../helpers/fake-ai-cli.ts';

const ref = (path: string, startLine: number, endLine: number) => ({ kind: 'code', path, side: 'head', startLine, endLine });
const ANSWER = {
  claims: [
    { text: 'The loop is bounded.', label: 'evidence', refs: [ref('src/app.js', 45, 50)] },
    { text: 'It probably retries.', label: 'inference', refs: [] },
    { text: 'Past the end.', label: 'evidence', refs: [ref('src/app.js', 78, 90)] },
  ],
  unsupportedAssumptions: [],
  suggestedFollowUps: [],
};
const files = { ...defaultPrFiles(), 'src/indent.js': 'function f() {\n\t\tif (x) {\n    return 1;\n  }\n}\n// ' + 'long '.repeat(80) + '\n' };

test('badges, six highlighted lines, one-line link, long lines, range past the end', async (t) => {
  const b = await useBrowser(t, { prFiles: files, fake: { scenario: 'structured', answer: ANSWER } });
  const { sessionId, snapshots } = await b.bench.startSession();
  const snapshot = snapshots[snapshots.length - 1].snapshotId as string;
  const asked = await b.bench.client.post(`/api/sessions/${sessionId}/questions`, {
    scope: { type: 'pr' },
    category: 'what',
    text: 'What does the loop do?',
  });
  assert.equal(asked.status, 202, asked.text);
  await waitFor(async () => {
    const list = (await b.bench.client.get(`/api/sessions/${sessionId}/questions`)).json as Array<{ state: string }>;
    return list.every((q) => q.state === 'completed');
  }, 'the answer');

  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await b.openPage(`#/sessions/${sessionId}/ask`, { colorScheme });
    await page.getByTestId('claim').first().waitFor();
    const evidence = page.locator('[data-testid="claim"] .badge[data-label="evidence"]').first();
    assert.match((await evidence.textContent()) ?? '', /Evidence/);
    // The past-the-end citation cannot be verified, so the server labels it inference too.
    assert.equal(await page.locator('.badge[data-label="inference"]').count(), 2);
    const href = (await page.getByTestId('claim-ref').first().getAttribute('href')) ?? '';
    assert.match(href, /\/diff\?path=/);
    assert.match(href, /start=45/);
    assert.match(href, /end=50/);
    await checkA11y(page);
    await page.context().close();
  }

  const code = (query: string) => `#/sessions/${sessionId}/code?snapshot=${snapshot}&side=head&path=src%2Fapp.js&${query}`;
  let page = await b.openPage(code('start=45&end=50'));
  await page.getByTestId('code-line-45').waitFor();
  assert.equal(await page.locator('tr[aria-current="true"]').count(), 6);
  assert.equal(await page.getByTestId('code-line-45').getAttribute('aria-current'), 'true');

  page = await b.openPage(code('line=47'));
  await page.getByTestId('code-line-47').waitFor();
  assert.equal(await page.locator('tr[aria-current="true"]').count(), 1);

  page = await b.openPage(code('start=78&end=90'));
  await page.getByTestId('code-range-notice').waitFor();

  page = await b.openPage(`#/sessions/${sessionId}/code?snapshot=${snapshot}&side=head&path=src%2Findent.js&start=2&end=3`, { width: 400 });
  await page.getByTestId('code-line-2').waitFor();
  const ws = await page.getByTestId('code-line-3').locator('.code-text').evaluate((el) => getComputedStyle(el).whiteSpace);
  assert.equal(ws, 'pre');
  assert.match((await page.getByTestId('code-line-2').locator('.code-text').textContent()) ?? '', /^\t\t/);
  await assertNoPageScroll(page);
  await checkA11y(page);
});

test('a commit that is no longer available is a state, not an error', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/code?snapshot=does-not-exist&side=head&path=src%2Fapp.js&start=1&end=2`);
  const region = page.getByTestId('async-code');
  await region.waitFor();
  await waitFor(async () => (await region.getAttribute('data-state')) !== 'loading', 'the code region to settle');
  assert.equal(await region.getAttribute('data-state'), 'unknown');
});
