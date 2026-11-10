// SC-001, SC-003, FR-040: every route passes axe in light and dark, never scrolls the page sideways, has one h1,
// one banner and one main, and respects reduced motion.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';

test('every route, in both themes and at three widths', { timeout: 600000 }, async (t) => {
  const b = await useBrowser(t, { fake: { scenario: 'structured', answer: { claims: [{ text: 'It scales values.', label: 'evidence', refs: [{ kind: 'code', path: 'src/app.js', side: 'head', startLine: 45, endLine: 50 }] }], unsupportedAssumptions: [], suggestedFollowUps: [] } } });
  const { sessionId, snapshots } = await b.bench.startSession();
  const snapshot = snapshots[snapshots.length - 1].snapshotId as string;
  const detail = (await b.bench.client.get(`/api/sessions/${sessionId}`)).json as { issues: Array<{ platform: string; key: string }> };
  const issue = detail.issues[0];
  assert.ok(issue, 'the session links an issue');
  const asked = await b.bench.client.post(`/api/sessions/${sessionId}/questions`, { scope: { type: 'pr' }, category: 'what', text: 'What does it do?' });
  assert.equal(asked.status, 202, asked.text);

  const s = `#/sessions/${sessionId}`;
  const routes: Array<[string, string, string]> = [
    ['home', '#/', 'h1'],
    ['setup', '#/setup', 'h1'],
    ['signin', '#/signin', 'h1'],
    ['overview', s, '[data-testid="overview"]'],
    ['files', `${s}/diff?path=src%2Fapp.js`, '[data-testid="diff-line-head-40"]'],
    ['code', `${s}/code?snapshot=${snapshot}&side=head&path=src%2Fapp.js&start=45&end=50`, '[data-testid="code-line-45"]'],
    ['questions', `${s}/ask`, '[data-testid="claim"]'],
    ['description', `${s}/description`, '[data-testid="pr-description"]'],
    ['issue', `${s}/issues/${encodeURIComponent(issue.platform)}/${encodeURIComponent(issue.key)}`, '[data-testid="issue-view"]'],
  ];

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [1440, 1000, 400]) {
      for (const [name, hash, ready] of routes) {
        const page = await b.openPage(hash, { width, colorScheme, reducedMotion: 'reduce' });
        await page.locator(ready).first().waitFor({ timeout: 15000 });
        const where = `${name} at ${width} in ${colorScheme}`;
        assert.equal(await page.locator('h1').count(), 1, `one h1: ${where}`);
        assert.equal(await page.getByRole('banner').count(), 1, `one banner: ${where}`);
        assert.equal(await page.getByRole('main').count(), 1, `one main: ${where}`);
        await assertNoPageScroll(page);
        await checkA11y(page);
        // Tagged best-practice, so the WCAG tags above do not run them.
        await checkA11y(page, ['landmark-one-main', 'region', 'bypass']);
        const motion = await page.evaluate(() => {
          const long = [...document.querySelectorAll('*')].filter((el) => {
            const cs = getComputedStyle(el);
            return cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0.01) || el.getAnimations().length > 0;
          });
          return long.map((el) => el.tagName + '.' + el.className);
        });
        assert.deepEqual(motion, [], `no motion under reduced motion: ${where}`);
        await page.context().close();
      }
    }
  }

  // A panel open beside the diff (wide) keeps the same guarantees.
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await b.openPage(`${s}/diff?path=src%2Fapp.js`, { width: 1440, colorScheme });
    await page.getByTestId('diff-line-head-40').getByRole('button').click();
    await page.getByTestId('ask-about-selection').click();
    await page.getByTestId('ask-panel').waitFor();
    await assertNoPageScroll(page);
    await checkA11y(page);
    await page.context().close();
  }
});
