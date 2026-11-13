// US2 (FR-005 to FR-008, FR-022, FR-024, FR-031): the diff is readable without colour and a range is
// selectable entirely by keyboard.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles } from '../helpers/fake-ai-cli.ts';

const files = { ...defaultPrFiles(), 'assets/logo.bin': 'PNG\u0000\u0001\u0002binary\u0000data' };
const diffHash = (id: string, path: string): string => `#/sessions/${id}/diff?path=${encodeURIComponent(path)}`;

test('marks, keyboard selection, scope bar and live region move together', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/app.js'), { width: 1440 });
  await page.getByTestId('diff-line-head-40').waitFor();

  assert.equal(await page.getByTestId('diff-line-head-40').getAttribute('data-type'), 'add');
  assert.match((await page.getByTestId('diff-line-head-40').locator('.mark').textContent()) ?? '', /\+/);

  // One Tab stop for the whole diff: focus the first line button, Tab leaves the diff.
  await page.locator('[data-cursor="true"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  const scope = (await page.getByTestId('scope-indicator').textContent()) ?? '';
  assert.match(scope, /^Selected: src\/app\.js lines \d+–\d+ \(new side\)$/);
  assert.equal(await page.getByTestId('live-region').textContent(), scope);
  assert.equal(await page.getByTestId('live-region').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 3);

  // The notes column's Ask form is always there, scoped to the selection; the button takes you to it.
  await page.getByTestId('ask-about-selection').click();
  await page.waitForFunction(() => document.activeElement?.id === 'notes-question-input');
  assert.match((await page.getByTestId('notes-scope-indicator').textContent()) ?? '', /src\/app\.js lines \d+.\d+/);
  await page.getByTestId('diff-line-head-40').waitFor();
});

test('Escape clears the selection', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/app.js'));
  await page.getByTestId('diff-line-head-40').getByRole('button').click();
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 1);
  await page.locator('[data-cursor="true"]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('tr[aria-selected="true"]').count(), 0);
});

test('layout per band, binary files, axe and no page scroll in both themes', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [1440, 1000, 400]) {
      const page = await b.openPage(diffHash(sessionId, 'src/app.js'), { width, colorScheme });
      await page.getByTestId('diff-line-head-40').waitFor();
      if (width === 1440 || width === 1000) {
        const toggle = page.getByTestId('file-list-toggle');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await toggle.click();
        assert.equal(await page.getByTestId('file-list').count(), 1);
        assert.equal(await page.getByTestId('file-notes').count(), 1);
        const widths = await page.locator('.diff-hunk .diff').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
        const box = await page.locator('.diff-hunk').first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
        for (const w of widths) assert.ok(w >= box - 2, `hunk narrower than its box: ${w} < ${box}`);
      } else {
        assert.ok((await page.getByTestId('next-file').count()) + (await page.getByTestId('prev-file').count()) >= 1);
        assert.equal(await page.getByTestId('all-changed-files').count(), 1);
      }
      await assertNoPageScroll(page);
      await checkA11y(page);
      await page.context().close();
    }
  }
  const page = await b.openPage(diffHash(sessionId, 'assets/logo.bin'));
  await page.getByTestId('skipped-file-assets/logo.bin').waitFor();
  assert.match((await page.getByTestId('skipped-file-assets/logo.bin').textContent()) ?? '', /[Bb]inary/);
});

// ---------------------------------------------------------------- feature 004: risk reasons and marks (T032, VO-029 part)

const LOGIN = [
  'export function login(user, password) {',
  '  const hash = hashOf(password);',
  "  if (hash !== user.hash) throw new Error('bad');",
  '  const credential = issue(user);',
  '  return credential;',
  '}',
].join('\n');
const riskFiles = {
  'src/auth/login.js': `${LOGIN}\n`,
  'src/billing/auth/guard.js': 'export const guard = 1;\n',
  'README.md': '# widgets\n\nSandbox repository.\n<!-- only a comment -->\n',
};

test('a path-and-lines match marks each responsible line with an accessible name, in both themes', async (t) => {
  const b = await useBrowser(t, { prFiles: riskFiles });
  const { sessionId } = await b.bench.startSession();
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await b.openPage(diffHash(sessionId, 'src/auth/login.js'), { width: 1440, colorScheme });
    await page.getByTestId('file-risk').waitFor();
    assert.match((await page.getByTestId('file-risk').getByTestId('risk-badge').getAttribute('aria-label')) ?? '', /Risk: Critical/);
    assert.match((await page.getByTestId('risk-reasons').textContent()) ?? '', /R-AUTH/);
    // Lines 1, 2, 4 and 5 mention a rule term; 3 and 6 do not.
    for (const n of [1, 2, 4, 5]) {
      const mark = page.getByTestId(`risk-mark-head-${n}`).locator('[role="img"]');
      assert.match((await mark.getAttribute('aria-label')) ?? '', /^Risk mark: R-AUTH: /, `line ${n}`);
      assert.ok(((await mark.textContent()) ?? '').length + (await mark.locator('svg').count()) > 0, 'a glyph, not only colour');
    }
    for (const n of [3, 6]) assert.equal(await page.getByTestId(`risk-mark-head-${n}`).locator('[role="img"]').count(), 0, `line ${n} is not marked`);
    await checkA11y(page);
  }
});

test('a file matching two rules lists both with their IDs and shows the higher class; a path-only match says so and marks nothing', async (t) => {
  const b = await useBrowser(t, { prFiles: riskFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/billing/auth/guard.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  const reasons = (await page.getByTestId('risk-reasons').textContent()) ?? '';
  assert.match(reasons, /R-AUTH/);
  assert.match(reasons, /R-FINANCE/);
  assert.match(reasons, /Matched on the path; no changed lines/);
  assert.match((await page.getByTestId('file-risk').getByTestId('risk-badge').getAttribute('aria-label')) ?? '', /Risk: Critical/);
  assert.equal(await page.locator('[data-testid^="risk-mark-"] [role="img"]').count(), 0);
});

test('Next and Previous risk mark reach every mark by keyboard and announce the ends', async (t) => {
  const b = await useBrowser(t, { prFiles: riskFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/auth/login.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  const live = page.getByTestId('live-region');
  const next = page.getByTestId('next-risk-mark');
  const prev = page.getByTestId('prev-risk-mark');

  await prev.focus();
  await page.keyboard.press('Enter');
  assert.match((await live.textContent()) ?? '', /No previous risk mark/);

  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await next.focus();
    await page.keyboard.press('Enter');
    const text = (await live.textContent()) ?? '';
    assert.match(text, new RegExp(`^Risk mark ${i + 1} of 4: R-AUTH: `));
    const expected = ['diff-line-head-1', 'diff-line-head-2', 'diff-line-head-4', 'diff-line-head-5'][i]!;
    await page.waitForFunction((id) => document.activeElement?.closest('tr')?.getAttribute('data-testid') === id, expected);
    seen.push(expected);
  }
  assert.deepEqual(seen, ['diff-line-head-1', 'diff-line-head-2', 'diff-line-head-4', 'diff-line-head-5']);
  await next.focus();
  await page.keyboard.press('Enter');
  assert.match((await live.textContent()) ?? '', /No further risk mark/);
  await prev.focus();
  await page.keyboard.press('Enter');
  assert.match((await live.textContent()) ?? '', /^Risk mark 3 of 4/);
});

test('risk marks coexist with the selection highlight', async (t) => {
  const b = await useBrowser(t, { prFiles: riskFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/auth/login.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  await page.getByTestId('diff-line-head-2').getByRole('button').click();
  assert.equal(await page.getByTestId('diff-line-head-2').getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByTestId('risk-mark-head-2').locator('[role="img"]').count(), 1, 'the mark stays on a selected line');
});

test('a comment-only file is Low and its comment lines are not marked as risk', async (t) => {
  const b = await useBrowser(t, { prFiles: riskFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'README.md'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  assert.match((await page.getByTestId('file-risk').getByTestId('risk-badge').getAttribute('aria-label')) ?? '', /Risk: Low/);
  assert.equal(await page.locator('[data-testid^="risk-mark-"] [role="img"]').count(), 0);
});

// ---------------------------------------------------------------- feature 004: Next and Previous follow the chosen order (T088, FR-030)

const orderFiles = {
  'README.md': '# widgets\n\nSandbox repository.\nMore.\n',
  'src/auth/login.js': 'export const login = 1;\n',
  'Dockerfile': 'FROM node:24\n',
  'src/zeta.js': 'export const z = 1;\n',
};

test('Next and Previous follow the chosen order and review scope, work from the keyboard and stop at the ends', async (t) => {
  const b = await useBrowser(t, { prFiles: orderFiles });
  const { sessionId } = await b.bench.startSession();
  // The choice is kept for the tab, so it is made and read in one page: the wide Files view first, then the narrow one.
  const page = await b.openPage(diffHash(sessionId, 'src/auth/login.js'));
  await page.getByTestId('scope-slider').waitFor();
  await page.getByTestId('scope-slider').fill('1');
  await page.setViewportSize({ width: 400, height: 900 });
  await page.evaluate((h) => { location.hash = h; }, diffHash(sessionId, 'src/auth/login.js'));
  await page.getByTestId('file-risk').waitFor();
  assert.equal(await page.getByTestId('prev-file').count(), 0, 'Critical comes first, so nothing before it');
  assert.match((await page.getByTestId('no-prev-file').textContent()) ?? '', /No previous file/);
  const next = page.getByTestId('next-file');
  await next.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/path=Dockerfile/);
  await page.getByTestId('file-risk').waitFor();
  assert.equal(await page.getByTestId('next-file').count(), 0, 'the review scope leaves Dockerfile last');
  assert.match((await page.getByTestId('no-next-file').textContent()) ?? '', /No further file/);
  await page.getByTestId('prev-file').focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/path=src%2Fauth%2Flogin\.js/);
});

// ---------------------------------------------------------------- feature 004: overriding a class (T068, VO-035)

const overrideFiles = {
  'src/auth/login.js': 'export function login(user, password) {\n  return user.hash === password;\n}\n',
  'src/zeta.js': 'export const z = 1;\n',
};
const classOfBadge = async (page: import('playwright').Page): Promise<string> => (await page.getByTestId('file-risk').getByTestId('risk-badge').getAttribute('aria-label')) ?? '';

test('the Override class button opens the dialog with focus on the first field; Escape closes it and returns focus', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/zeta.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  const button = page.getByTestId('override-class-button');
  await button.click();
  await page.getByTestId('override-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'override-class-select');
  assert.deepEqual(await page.getByTestId('override-class-select').locator('option').allTextContents(), ['Low', 'Elevated', 'Critical'], 'the other three classes');
  await checkA11y(page);
  await page.keyboard.press('Escape');
  await page.getByTestId('override-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'override-class-button');
});

test('a reason is required, a saved override changes the class, announces the change and shows its record', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/zeta.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  assert.match(await classOfBadge(page), /Risk: Normal/);
  await page.getByTestId('override-class-button').click();
  await page.getByTestId('override-class-select').selectOption('elevated');
  assert.equal(await page.getByTestId('override-reviewer').count(), 0, 'no name is needed to raise a class');
  assert.match((await page.getByTestId('override-reason-count').textContent()) ?? '', /0 \/ 2,?000/);
  await page.getByTestId('override-save').click();
  assert.match((await page.getByTestId('override-error').textContent()) ?? '', /reason/i, 'the reason is required');
  await page.getByTestId('override-reason').fill('Only the constant is renamed.');
  await page.getByTestId('override-save').click();
  await page.getByTestId('override-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('live-region').textContent(), 'Class changed from Normal to Elevated');
  await page.waitForFunction(() => document.querySelector('[data-testid="file-risk"] [data-testid="risk-badge"]')?.getAttribute('aria-label') === 'Risk: Elevated');
  const state = (await page.getByTestId('override-state').textContent()) ?? '';
  assert.match(state, /Reviewer override/);
  assert.match(state, /was Normal/);
  assert.match(state, /Only the constant is renamed\./);
  assert.equal(await page.getByTestId('file-risk').getByText(/overrides by|total overrides|ranking/i).count(), 0, 'no count, total or ranking of overrides or reviewers');
});

test('lowering a Critical class shows who will be recorded, read only', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/auth/login.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  await page.getByTestId('override-class-button').click();
  await page.getByTestId('override-class-select').selectOption('normal');
  await page.getByTestId('override-reviewer').waitFor();
  assert.equal((await page.getByTestId('override-reviewer').textContent())?.trim(), 'Recorded as: Alice Developer (alice-dev)');
  assert.equal(await page.getByTestId('override-reviewer').locator('input, textarea, select').count(), 0, 'read only');
  await page.getByTestId('override-reason').fill('The check is covered elsewhere.');
  await page.getByTestId('override-save').click();
  await page.getByTestId('override-dialog').waitFor({ state: 'hidden' });
  assert.match(await classOfBadge(page), /Risk: Normal/);
  assert.match((await page.getByTestId('override-state').textContent()) ?? '', /Alice Developer \(alice-dev\)/);
  assert.match((await page.getByTestId('file-risk').getByTestId('risk-reasons').textContent()) ?? '', /R-AUTH/, 'the original reasons stay visible');
});

test('an unreadable account shows the reason and the fix, disables Save, and says other overrides remain possible', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/auth/login.js'), { width: 1440 });
  await page.route('**/api/sessions/*/risk/reviewer', (route) => route.fulfill({ json: { ok: false, reason: 'The platform did not accept your sign-in.', fix: 'Sign in to the platform again' } }));
  await page.getByTestId('file-risk').waitFor();
  await page.getByTestId('override-class-button').click();
  await page.getByTestId('override-class-select').selectOption('low');
  const problem = page.getByTestId('override-reviewer-problem');
  await problem.waitFor();
  const text = (await problem.textContent()) ?? '';
  assert.match(text, /did not accept your sign-in/);
  assert.match(text, /Sign in to the platform again/);
  assert.match(text, /Other overrides remain possible/i);
  await page.getByTestId('override-reason').fill('A reason.');
  assert.equal(await page.getByTestId('override-save').isDisabled(), true);
});

test('the server refusal is shown inside the dialog and the dialog stays open', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/zeta.js'), { width: 1440 });
  await page.route('**/api/sessions/*/risk/overrides', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: { code: 'read_only', message: 'This is an older snapshot.' } } }) : route.continue());
  await page.getByTestId('file-risk').waitFor();
  await page.getByTestId('override-class-button').click();
  await page.getByTestId('override-reason').fill('Because.');
  await page.getByTestId('override-save').click();
  await page.getByTestId('override-error').getByText('This is an older snapshot.').waitFor();
  assert.equal(await page.getByTestId('override-dialog').isVisible(), true);
});

test('the History disclosure lists the records for the file oldest first', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/zeta.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  for (const [cls, reason] of [['elevated', 'First view.'], ['low', 'Second view.']] as const) {
    await page.getByTestId('override-class-button').click();
    await page.getByTestId('override-class-select').selectOption(cls);
    await page.getByTestId('override-reason').fill(reason);
    await page.getByTestId('override-save').click();
    await page.getByTestId('override-dialog').waitFor({ state: 'hidden' });
  }
  const toggle = page.getByTestId('override-history-toggle');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.getByTestId('override-history').locator('li').nth(1).waitFor();
  const items = await page.getByTestId('override-history').locator('li').allTextContents();
  assert.equal(items.length, 2);
  assert.match(items[0] ?? '', /First view\./);
  assert.match(items[0] ?? '', /Normal/, 'the class it replaced');
  assert.match(items[1] ?? '', /Second view\./);
});

test('a lapsed override says so, with the recorded reason, and the recalculated class is in force', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/zeta.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  await page.getByTestId('override-class-button').click();
  await page.getByTestId('override-class-select').selectOption('low');
  await page.getByTestId('override-reason').fill('Trivial constant.');
  await page.getByTestId('override-save').click();
  await page.getByTestId('override-dialog').waitFor({ state: 'hidden' });
  await b.bench.pushHead({ 'src/zeta.js': 'export const z = 2;\nexport const y = 3;\n' });
  assert.equal((await b.bench.client.post(`/api/sessions/${sessionId}/refresh`)).status, 200);
  await page.reload();
  await page.getByTestId('file-risk').waitFor();
  const text = (await page.getByTestId('override-state').textContent()) ?? '';
  assert.match(text, /Override lapsed: this file's change differs\. Recorded reason: Trivial constant\./);
  assert.match(await classOfBadge(page), /Risk: Normal/);
});

test('a closed session offers no override controls and says why; reading still works', async (t) => {
  const b = await useBrowser(t, { prFiles: overrideFiles, prStates: ['open', 'merged'] });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(diffHash(sessionId, 'src/zeta.js'), { width: 1440 });
  await page.getByTestId('file-risk').waitFor();
  assert.equal(await page.getByTestId('override-class-button').count(), 0);
  assert.match((await page.getByTestId('override-unavailable').textContent()) ?? '', /merged|read-only/i);
  assert.match(await classOfBadge(page), /Risk: Normal/);
});
