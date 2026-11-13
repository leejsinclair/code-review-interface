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

  // The Files view with its notes column (wide) keeps the same guarantees.
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await b.openPage(`${s}/diff?path=src%2Fapp.js`, { width: 1440, colorScheme });
    await page.getByTestId('diff-line-head-40').getByRole('button').click();
    await page.getByTestId('file-notes').waitFor();
    await assertNoPageScroll(page);
    await checkA11y(page);
    await page.context().close();
  }
});

// ---------------------------------------------------------------- feature 004: the risk surfaces (T079, VO-029, SC-008)

const RISK_PR = {
  'src/auth/login.js': 'export function login(user, password) {\n  const hash = hashOf(password);\n  return user.hash === hash;\n}\n',
  'db/migrations/001_add_user.sql': 'ALTER TABLE users ADD COLUMN age INTEGER;\n',
  'Dockerfile': 'FROM node:24\n',
  'package-lock.json': '{\n  "lockfileVersion": 3\n}\n',
  'src/zeta.js': 'export const z = 1;\n',
  'assets/logo.bin': 'PNG\u0000\u0001\u0002binary\u0000data',
};
const RISK_AI = { files: [{ path: 'src/zeta.js', class: 'elevated', reasons: ['It changes how the value is chosen.'], lines: [{ side: 'head', startLine: 1, endLine: 1 }] }] };

test('the risk surfaces pass axe at three widths in both themes, and badges and marks read without colour', { timeout: 600000 }, async (t) => {
  const b = await useBrowser(t, { prFiles: RISK_PR, fake: { scenario: 'structured', risk: RISK_AI } });
  const detail = await b.bench.startSession();
  const sessionId = detail.sessionId as string;
  const snapshotId = detail.snapshots[0].snapshotId as string;
  // An override in effect, so its note and the Overridden row are swept too.
  const posted = await b.bench.client.post(`/api/sessions/${sessionId}/risk/overrides`, { snapshotId, path: 'Dockerfile', class: 'critical', reason: 'It deploys to production.' });
  assert.equal(posted.status, 201, posted.text);
  const s = `#/sessions/${sessionId}`;
  const diff = (path: string) => `${s}/diff?path=${encodeURIComponent(path)}`;

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [1440, 1000, 400]) {
      const where = (name: string) => `${name} at ${width} in ${colorScheme}`;
      const sweep = async (name: string, hash: string, ready: string, before?: (page: import('playwright').Page) => Promise<void>) => {
        const page = await b.openPage(hash, { width, colorScheme, reducedMotion: 'reduce' });
        await page.locator(ready).first().waitFor({ timeout: 15000 });
        await before?.(page);
        assert.equal(await page.locator('h1').count(), 1, `one h1: ${where(name)}`);
        await assertNoPageScroll(page);
        await checkA11y(page);
        await page.context().close();
      };
      await sweep('Review focus', s, '[data-testid="risk-ai-run"]');
      // The changed-file panel is beside the diff; the narrow layout has no panel.
      if (width >= 1000) await sweep('file list with the review scope', diff('src/auth/login.js'), '[data-testid="scope"]', async (page) => {
        await page.getByTestId('scope-slider').fill('0');
        await page.getByTestId('file-risk-toggle-src/auth/login.js').click();
      });
      await sweep('diff risk marks', diff('src/auth/login.js'), '[data-testid="risk-mark-head-1"] [role="img"]', async (page) => {
        await page.getByTestId('next-risk-mark').click();
      });
      await sweep('overridden file and history', diff('Dockerfile'), '[data-testid="override-state"]', async (page) => {
        await page.getByTestId('override-history-toggle').click();
        await page.getByTestId('override-history').waitFor();
      });
      await sweep('the AI-raised file', diff('src/zeta.js'), '[data-testid="risk-reasons"]');
      await sweep('the override dialog', diff('src/auth/login.js'), '[data-testid="override-class-button"]', async (page) => {
        await page.getByTestId('override-class-button').click();
        await page.getByTestId('override-class-select').selectOption('normal');
        await page.getByTestId('override-reviewer').waitFor();
      });
    }
  }

  // Forced colours and greyscale: the class is still told by its word, its icon and its accessible name (FR-028, FR-031).
  for (const mode of ['forced-colors', 'greyscale'] as const) {
    const page = await b.openPage(s, { width: 1440 });
    await page.getByTestId('risk-ai-run').waitFor();
    if (mode === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
    else await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
    const badges = await page.getByTestId('review-focus').getByTestId('risk-badge').evaluateAll((els) =>
      els.map((e) => ({ label: e.getAttribute('aria-label'), text: (e.textContent ?? '').trim(), glyph: e.querySelector('svg') !== null })),
    );
    assert.ok(badges.length >= 3, `${mode}: badges present`);
    for (const badge of badges) {
      assert.match(badge.label ?? '', /^Risk: (Critical|Elevated|Normal|Low)$/, mode);
      assert.ok(badge.text.length > 0 && badge.glyph, `${mode}: a word and a glyph`);
    }
    await page.goto(`${b.bench.client.origin}/${diff('src/auth/login.js')}`);
    await page.getByTestId('risk-mark-head-1').locator('[role="img"]').waitFor();
    const marks = await page.locator('[data-testid^="risk-mark-"] [role="img"]').evaluateAll((els) => els.map((e) => ({ label: e.getAttribute('aria-label'), glyph: e.querySelector('svg') !== null })));
    assert.ok(marks.length >= 2, `${mode}: marks present`);
    for (const m of marks) assert.ok(/^Risk mark: /.test(m.label ?? '') && m.glyph, `${mode}: a glyph and an accessible name`);
    await page.context().close();
  }
});
