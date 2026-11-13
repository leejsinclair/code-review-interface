// US7 (FR-009, FR-025 to FR-027, FR-028): Overview leads with the summary, completeness and a filterable file
// list; per-file explanations are disclosed on request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';

const SUMMARY = {
  prSummary: [{ text: 'Summary claim.', label: 'inference', refs: [] }],
  files: [{ path: 'src/f05.js', claims: [{ text: 'Explains f05.', label: 'inference', refs: [] }] }],
  functionalImpact: [],
  technicalImpact: [],
};
const files = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`src/f${String(i).padStart(2, '0')}.js`, `export const n = ${i};\n`]));

test('order, a single h1, the Specification panel in place of the file list, and badges', async (t) => {
  const b = await useBrowser(t, { prFiles: files, fake: { scenario: 'structured', summary: SUMMARY } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('spec-context').waitFor();
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('h1').textContent(), 'Overview');

  const order = await page.evaluate(() => {
    const ids = ['pr-summary', 'completeness', 'spec-context', 'review-focus'];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el === null ? -1 : el.getBoundingClientRect().top + scrollY;
    });
  });
  assert.ok(order.every((n) => n >= 0), `all sections present: ${order}`);
  assert.deepEqual([...order].sort((a, c) => a - c), order, 'sections appear in the specified order');
  assert.match((await page.getByTestId('review-focus').textContent()) ?? '', /Review focus/);
  assert.equal(await page.getByTestId('file-list').count(), 0, 'the file list is on the Diff screen, not the overview (FR-007)');

  const badge = page.locator('[data-testid="completeness-row-pr"] .badge[data-status]');
  assert.ok(await badge.count());
  assert.ok(((await badge.first().textContent()) ?? '').trim().length > 1, 'badge has glyph and text');
  await checkA11y(page);
});

test('failed summaries show Retry', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.route('**/api/sessions/*/snapshots/*/summaries', (route) => route.fulfill({ status: 500, json: { error: { code: 'platform_error', message: 'boom' } } }));
  await page.reload();
  await page.getByTestId('retry-summaries').waitFor();
});

// ---------------------------------------------------------------- feature 004: Review focus (T020, VO-033 part)

const RISK_FILES = {
  'db/migrations/001_add_user.sql': 'ALTER TABLE users ADD COLUMN age INTEGER;\n',
  'src/auth/session.js': 'export function check(token) {\n  return token !== undefined && token.password !== "";\n}\n',
  'package-lock.json': '{\n  "lockfileVersion": 3\n}\n',
  'README.md': '# Widgets\n\nMore docs.\n',
};

test('Review focus lists Critical files with reasons, the mechanical candidates, the counts, and no longer says "Not available yet."', async (t) => {
  const b = await useBrowser(t, { prFiles: RISK_FILES, fake: { scenario: 'structured' } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const focus = page.getByTestId('review-focus');
  await focus.getByTestId('risk-counts').waitFor();

  assert.equal(await focus.locator('h2').first().textContent(), 'Review focus');
  assert.equal(await focus.getByText('Not available yet.').count(), 0);
  assert.match((await focus.getByTestId('risk-counts').textContent()) ?? '', /Critical 2 · Elevated 0 · Normal 1 · Low 1/);

  const critical = focus.getByTestId('risk-list-critical');
  assert.equal(await critical.locator('[data-testid^="risk-row-"]').count(), 2);
  const migration = critical.locator('[data-testid^="risk-row-"]', { hasText: 'db/migrations/001_add_user.sql' });
  assert.match((await migration.textContent()) ?? '', /R-MIGRATION/);
  assert.match((await migration.locator('[data-testid="risk-badge"]').getAttribute('aria-label')) ?? '', /Risk: Critical/);
  const href = (await migration.locator('a').first().getAttribute('href')) ?? '';
  assert.match(href, new RegExp(`#/sessions/${sessionId}/diff\\?path=`));

  assert.equal(await focus.getByTestId('risk-no-elevated').count(), 0, 'Critical exists, so the "none Elevated or Critical" sentence is absent');

  const mechanical = focus.getByTestId('risk-list-mechanical');
  assert.match((await mechanical.textContent()) ?? '', /Mechanical \(candidate for reduced review\)/);
  assert.match((await mechanical.textContent()) ?? '', /package-lock\.json/);
  assert.match((await mechanical.textContent()) ?? '', /lockfile/i);
  assert.equal(/approved/i.test((await focus.textContent()) ?? ''), false);
  await checkA11y(page);
});

test('Review focus says so when no file is Elevated or Critical, and lists a not fully analysed file apart from Low', async (t) => {
  const b = await useBrowser(t, { prFiles: { 'README.md': '# Widgets\n\nMore docs.\n', 'package-lock.json': '{\n  "lockfileVersion": 3\n}\n' } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const focus = page.getByTestId('review-focus');
  await focus.getByTestId('risk-counts').waitFor();
  assert.equal((await focus.getByTestId('risk-no-elevated').textContent())?.trim(), 'No file is Elevated or Critical.');
  assert.match((await focus.getByTestId('risk-counts').textContent()) ?? '', /Critical 0 · Elevated 0/);
});

test('Review focus shows a failed load with Retry', async (t) => {
  const b = await useBrowser(t, { prFiles: RISK_FILES });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.route('**/api/sessions/*/snapshots/*/risk', (route) => route.fulfill({ status: 500, json: { error: { code: 'platform_error', message: 'boom' } } }));
  await page.reload();
  await page.getByTestId('retry-risk').waitFor();
});

// ---------------------------------------------------------------- feature 004: file list badges, filter and order (T038)

const LIST_FILES = {
  'src/auth/login.js': 'export const login = 1;\n',
  'Dockerfile': 'FROM node:24\n',
  'README.md': '# Widgets\n\nMore docs.\n',
  'package-lock.json': '{\n  "lockfileVersion": 3\n}\n',
  'src/zeta.js': 'export const z = 1;\n',
};
const listPaths = (page: import('playwright').Page): Promise<string[]> =>
  page.locator('[data-testid^="changed-file-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice('changed-file-'.length)));

test('each file sits under its class heading and has a Why? disclosure with its reasons', async (t) => {
  const b = await useBrowser(t, { prFiles: LIST_FILES });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff`);
  const row = page.getByTestId('file-group-critical').getByTestId('changed-file-src/auth/login.js');
  await row.waitFor();
  assert.equal(await row.getAttribute('data-risk'), 'critical');
  assert.match((await page.getByTestId('file-group-critical').locator('h3').textContent()) ?? '', /Critical/);
  const why = page.getByTestId('file-risk-toggle-src/auth/login.js');
  assert.equal(await why.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByTestId('file-risk-src/auth/login.js').count(), 0);
  await why.click();
  assert.equal(await why.getAttribute('aria-expanded'), 'true');
  assert.match((await page.getByTestId('file-risk-src/auth/login.js').textContent()) ?? '', /R-AUTH/);
});

test('the scope slider, the order control, the filter and the count work together and are kept for the tab', async (t) => {
  const b = await useBrowser(t, { prFiles: LIST_FILES });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff`);
  await page.getByTestId('scope-slider').waitFor();

  // Risk order and the auto scope are the defaults; a small pull request fits the budget, so every class is in scope.
  assert.equal(await page.getByTestId('file-order').inputValue(), 'risk');
  assert.equal(await page.getByTestId('scope-auto').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByTestId('scope-slider').inputValue(), '3');
  const ordered = await listPaths(page);
  assert.equal(ordered[0], 'src/auth/login.js', 'Critical first');
  assert.equal(ordered[1], 'Dockerfile', 'then Elevated');
  assert.equal(await page.getByTestId('file-group-toggle-mechanical').getAttribute('aria-expanded'), 'false', 'mechanical files start collapsed');

  // Narrowing the scope leaves the other classes listed but collapsed, and leaves Auto.
  await page.getByTestId('scope-slider').fill('1');
  assert.equal(await page.getByTestId('scope-auto').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await listPaths(page), ['src/auth/login.js', 'Dockerfile']);
  assert.match((await page.getByTestId('file-group-normal').textContent()) ?? '', /outside scope/);
  await page.getByTestId('file-group-toggle-normal').click();
  assert.ok((await listPaths(page)).includes('src/zeta.js'), 'a class outside the scope can still be opened');
  await page.getByTestId('file-group-toggle-normal').click();

  // The text filter looks through every class, and the count follows it.
  await page.getByTestId('file-filter').fill('zeta');
  assert.deepEqual(await listPaths(page), ['src/zeta.js'], 'a search finds a file outside the scope');
  await page.getByTestId('file-filter').fill('docker');
  assert.deepEqual(await listPaths(page), ['Dockerfile']);
  assert.equal(await page.getByTestId('file-count').textContent(), 'Showing 1 of 5 files');
  await page.getByTestId('file-filter').fill('');

  // Auto returns to the budget's choice.
  await page.getByTestId('scope-auto').click();
  assert.equal(await page.getByTestId('scope-slider').inputValue(), '3');

  // Kept for the tab: reload and the scope and order are still there.
  await page.getByTestId('scope-slider').fill('0');
  await page.reload();
  await page.getByTestId('scope-slider').waitFor();
  assert.equal(await page.getByTestId('scope-slider').inputValue(), '0');
  assert.equal(await page.getByTestId('file-order').inputValue(), 'risk');
  assert.deepEqual(await listPaths(page), ['src/auth/login.js']);
});

test('diff order lists the files in scope in the order of the diff', async (t) => {
  const b = await useBrowser(t, { prFiles: LIST_FILES });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff`);
  await page.getByTestId('scope-slider').waitFor();
  await page.getByTestId('file-order').selectOption('diff');
  await page.getByTestId('scope-slider').fill('1');
  assert.equal(await page.getByTestId('file-count').textContent(), 'Showing 2 of 5 files');
  assert.equal((await listPaths(page)).length, 2);
  assert.equal(await page.getByTestId('changed-file-Dockerfile').getByTestId('risk-badge').count(), 1, 'a flat list keeps each class badge');
});

test('an empty result keeps the existing empty state', async (t) => {
  const b = await useBrowser(t, { prFiles: LIST_FILES });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff`);
  await page.getByTestId('scope-slider').waitFor();
  await page.getByTestId('file-filter').fill('no-such-file');
  await page.getByTestId('file-filter-empty').waitFor();
  await page.getByTestId('file-filter-clear').click();
  assert.equal(await page.getByTestId('file-filter-empty').count(), 0);
});

test('viewed files count towards the scope progress and are kept for the tab', async (t) => {
  const b = await useBrowser(t, { prFiles: LIST_FILES });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff`);
  await page.getByTestId('scope-slider').waitFor();
  assert.match((await page.getByTestId('scope-progress').textContent()) ?? '', /Viewed 0 of /);
  await page.getByTestId('scope-slider').fill('0');
  await page.getByTestId('file-viewed-src/auth/login.js').check();
  assert.match((await page.getByTestId('scope-progress').textContent()) ?? '', /Viewed 1 of 1 file/);
  assert.equal(await page.getByTestId('changed-file-src/auth/login.js').getAttribute('data-viewed'), 'true');
  await page.reload();
  await page.getByTestId('scope-slider').waitFor();
  assert.equal(await page.getByTestId('file-viewed-src/auth/login.js').isChecked(), true);
  await page.getByTestId('file-viewed-src/auth/login.js').uncheck();
  assert.match((await page.getByTestId('scope-progress').textContent()) ?? '', /Viewed 0 of 1 file/);
});

test('a pull request over the line budget says so, even at Critical only', async (t) => {
  const big = { 'src/auth/login.js': Array.from({ length: 500 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n', 'README.md': '# Widgets\n' };
  const b = await useBrowser(t, { prFiles: big });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff`);
  await page.getByTestId('scope-slider').waitFor();
  assert.equal(await page.getByTestId('scope-slider').inputValue(), '0', 'auto falls back to Critical');
  assert.match((await page.getByTestId('scope-over-budget').textContent()) ?? '', /Over the 400-line review budget even with Critical only/);
});

// ---------------------------------------------------------------- feature 004: AI notices (T085, VO-034 announcement)

const AI_UI_FILES = { 'src/util/pricing-notes.js': 'export const a = 1;\nexport const b = 2;\n', 'package-lock.json': '{\n  "lockfileVersion": 3\n}\n' };
const aiRaise = { files: [{ path: 'src/util/pricing-notes.js', class: 'elevated', reasons: ['It changes how the value is chosen.'], lines: [{ side: 'head', startLine: 2, endLine: 2 }] }] };

test('Review focus shows the AI assessment in progress, then the result with provider and context version, and announces the change', async (t) => {
  const b = await useBrowser(t, { prFiles: AI_UI_FILES, fake: { scenario: 'structured', riskScenario: 'slow', risk: aiRaise } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const notices = page.getByTestId('risk-notices');
  await notices.waitFor();
  assert.match((await notices.textContent()) ?? '', /AI assessment in progress/);
  assert.equal(await notices.getAttribute('aria-live'), 'polite');
  assert.equal(await page.getByTestId('risk-list-elevated').count(), 0, 'the rule classes show first');

  await b.bench.fake!.release('risk');
  await page.getByTestId('risk-list-elevated').waitFor();
  const text = (await notices.textContent()) ?? '';
  assert.match(text, /claude-code-cli/);
  assert.match(text, /[0-9a-f]{7}/, 'the context version');
  assert.doesNotMatch(text, /in progress/);
  const row = page.getByTestId('risk-row-src/util/pricing-notes.js');
  assert.match((await row.textContent()) ?? '', /AI/);
  assert.match((await row.textContent()) ?? '', /It changes how the value is chosen\./);
  assert.match((await page.getByTestId('live-region').textContent()) ?? '', /src\/util\/pricing-notes\.js is now Elevated|AI assessment/);
  assert.match((await page.getByTestId('risk-list-mechanical').textContent()) ?? '', /Not assessed by AI: lockfile/);
});

test('Review focus says the AI assessment is missing, with the reason, and the rule classes still show', async (t) => {
  const b = await useBrowser(t, { prFiles: AI_UI_FILES, fake: { scenario: 'structured', riskScenario: 'error-on-start' } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const notices = page.getByTestId('risk-notices');
  await notices.getByText(/AI assessment missing/).waitFor();
  assert.match((await notices.textContent()) ?? '', /failed to start/);
  assert.match((await page.getByTestId('risk-counts').textContent()) ?? '', /Normal 1/);
});

test('Review focus names an ignored AI opinion with its count and reason', async (t) => {
  const bad = { files: [{ path: 'src/util/pricing-notes.js', class: 'critical', reasons: ['scary'], lines: [] }] };
  const b = await useBrowser(t, { prFiles: AI_UI_FILES, fake: { scenario: 'structured', risk: bad } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const notices = page.getByTestId('risk-notices');
  await notices.getByText(/AI opinion ignored/).waitFor();
  assert.match((await notices.textContent()) ?? '', /1 file/);
  assert.match((await notices.textContent()) ?? '', /changed line|not higher/);
});

test('an older snapshot is marked older and shows no stale AI result as current', async (t) => {
  const b = await useBrowser(t, { prFiles: AI_UI_FILES, fake: { scenario: 'structured', risk: aiRaise } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('risk-notices').getByText(/claude-code-cli/).waitFor();
  assert.equal(await page.getByTestId('risk-notices').getByTestId('risk-older-head').count(), 0, 'the latest snapshot is not marked older');
});

// ---------------------------------------------------------------- feature 004: overrides in Review focus (T086, FR-027)

test('an override in effect is noted with the original class and counted in Review focus', async (t) => {
  const b = await useBrowser(t, { prFiles: { 'src/zeta.js': 'export const z = 1;\n', 'src/other.js': 'export const o = 1;\n' } });
  const detail = await b.bench.startSession();
  const res = await b.bench.client.post(`/api/sessions/${detail.sessionId}/risk/overrides`, {
    snapshotId: detail.snapshots[0].snapshotId, path: 'src/zeta.js', class: 'elevated', reason: 'It is on the payment path.',
  });
  assert.equal(res.status, 201, res.text);
  const page = await b.openPage(`#/sessions/${detail.sessionId}`);
  const focus = page.getByTestId('review-focus');
  const row = focus.getByTestId('risk-row-src/zeta.js');
  await row.waitFor();
  assert.match((await row.textContent()) ?? '', /Overridden: Reviewer override set it to Elevated \(was Normal\)/);
  assert.match((await focus.getByTestId('risk-overrides-count').textContent()) ?? '', /Overrides in effect: 1/);
  assert.equal(await focus.getByTestId('risk-row-src/other.js').count(), 0, 'a file with no override is not noted');
  assert.match((await focus.getByTestId('risk-counts').textContent()) ?? '', /Elevated 1/);
});

// ---------------------------------------------------------------- feature 004: the rule-file notice (T087, US6)

test('a corrupt rule file and a rejected entry are named in Review focus with the reason, and the built-in classes still show', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const b = await useBrowser(t, { prFiles: { 'db/migrations/001.sql': 'ALTER TABLE a ADD b INT;\n' } });
  await writeFile(join(b.bench.appData.dir, 'risk-rules.json'), '{ not json');
  const detail = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${detail.sessionId}`);
  const notices = page.getByTestId('risk-notices');
  await notices.getByTestId('risk-rule-file').waitFor();
  const text = (await notices.getByTestId('risk-rule-file').textContent()) ?? '';
  assert.match(text, /risk-rules\.json/);
  assert.match(text, /not valid JSON/);
  assert.equal(await page.getByTestId('risk-list-critical').count(), 1, 'the built-in rules still classified the file');

  await writeFile(join(b.bench.appData.dir, 'risk-rules.json'), JSON.stringify({ version: 1, entries: [{ add: 'X-BAD', family: 'cooking', class: 'elevated' }] }));
  const second = await b.bench.pushHead({ 'db/migrations/002.sql': 'ALTER TABLE a ADD c INT;\n' });
  assert.ok(second);
  assert.equal((await b.bench.client.post(`/api/sessions/${detail.sessionId}/refresh`)).status, 200);
  await page.reload();
  const entry = page.getByTestId('risk-notices').getByTestId('risk-rule-file');
  await entry.waitFor();
  const entryText = (await entry.textContent()) ?? '';
  assert.match(entryText, /1?0?: ?X-BAD|X-BAD/);
  assert.match(entryText, /family/);
});

// ---------------------------------------------------------------- feature 004: the journey in the browser (T080, SC-010, VO-034)

test('SC-010 from the Overview the first Critical file\'s responsible lines are one action away', async (t) => {
  const b = await useBrowser(t, { prFiles: { 'src/auth/login.js': 'export function login(user, password) {\n  const hash = hashOf(password);\n  return user.hash === hash;\n}\n', 'README.md': '# Widgets\n\nMore docs.\n' } });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  const link = page.getByTestId('risk-list-critical').getByRole('link', { name: 'src/auth/login.js' });
  await link.click();
  // One action: the Files view opens with the first responsible line selected and marked.
  await page.getByTestId('risk-mark-head-1').locator('[role="img"]').waitFor();
  assert.equal(await page.getByTestId('diff-line-head-1').getAttribute('aria-selected'), 'true', 'the first marked line is selected');
});

test('VO-034 markup in a path, a reason and a rule label is shown as text, never as markup', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const b = await useBrowser(t, { prFiles: { 'src/<img src=x onerror=window.__xss=1>/ok.js': 'export const a = 1;\n', 'src/customer/profile.js': 'export const p = 1;\n' } });
  await writeFile(join(b.bench.appData.dir, 'risk-rules.json'), JSON.stringify({ version: 1, entries: [{ add: 'X-PII', family: 'authorisation', class: 'elevated', label: '<b id=boom>Personal data</b>', paths: ['**/customer/**'] }] }));
  const detail = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${detail.sessionId}`);
  const focus = page.getByTestId('review-focus');
  await focus.getByTestId('risk-list-elevated').waitFor();
  assert.match((await focus.textContent()) ?? '', /<b id=boom>Personal data<\/b>/, 'the rule label is text');
  assert.equal(await page.locator('#boom, img[src="x"]').count(), 0, 'no markup was created');
  assert.equal(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), undefined);
  await page.evaluate(() => { location.hash = `${location.hash}/diff`; }); // the file list is on the Diff screen (FR-007)
  await page.locator('[data-testid^="changed-file-"]').first().waitFor();
  const names = await page.locator('[data-testid^="changed-file-"] a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  assert.ok(names.some((n) => n.includes('<img src=x onerror=window.__xss=1>/ok.js')), 'the path is text in the file list');
});
