// US12 and US11 (FR-039, FR-052 to FR-055, SC-010): the Home dashboard over a base folder holding several
// repositories. Rows carry their repository, a failing repository fails alone and can be retried, the
// filters and the scroll position come back on returning to `#/`.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { loadFixtures } from '../helpers/recorded-fetch.ts';

const OTHERS = ['acme/gadgets', 'acme/gizmos', 'acme/sprockets', 'acme/broken'];
const LIST = (repo: string) => `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`;
const byId = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

/** A 200 list served for acme/broken after its first (500) answer, so Retry loads it. */
function brokenRecovers() {
  const sprockets = loadFixtures('github').find((e) => e.request.url === LIST('acme/sprockets'))!;
  return [{ request: { method: 'GET', url: LIST('acme/broken') }, response: sprockets.response }];
}

const allRowIds = (page: Page) => page.locator('li[data-testid^="pr-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
const rowIds = (page: Page) => page.locator('[data-testid="pr-list"] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));

test('your sessions come before the open pull requests, and rows name their repository', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/gizmos-20').waitFor();

  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('h1').textContent(), 'Home');
  const headings = await page.locator('h2').allTextContents();
  assert.deepEqual(headings, ['Your review sessions', 'Open pull requests']);

  const ids = await rowIds(page);
  assert.ok(ids.includes('pr-item-acme/widgets-1') && ids.includes('pr-item-acme/gadgets-10') && ids.includes('pr-item-acme/sprockets-30'));
  assert.equal(ids.includes('pr-item-acme/broken-30'), false, 'the failing repository shows no rows');
  // Rows sit in issue groups; inside each group the most recently updated come first.
  const groupDates = await page.locator('[data-testid^="pr-group-"]:not([data-testid^="pr-group-failed-"])').evaluateAll((els) =>
    els.map((g) => [...g.querySelectorAll('time')].map((t) => t.getAttribute('datetime')!)),
  );
  for (const dates of groupDates) assert.deepEqual(dates, [...dates].sort().reverse(), 'most recently updated first');

  const row = byId(page, 'pr-item-acme/gizmos-20');
  const text = (await row.textContent()) ?? '';
  for (const part of ['acme/gizmos', '#20', 'Gizmo retry policy', 'feature/pr-20']) assert.ok(text.includes(part), `${part} in ${text}`);
  assert.equal(await row.locator('[data-testid="start-review"]').count(), 1);
  assert.equal(await row.locator('[data-testid="start-review"]').getAttribute('aria-label'), 'Start review');
  assert.equal(((await row.locator('[data-testid="start-review"]').textContent()) ?? '').trim(), '', 'the button shows an icon, not text');
});

test('a failing repository shows its failure and Retry beside the other rows, and Retry loads it (FR-054)', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'pr-group-failed-acme/broken').waitFor();
  assert.ok(await byId(page, 'pr-item-acme/gizmos-20').isVisible(), 'the other rows stay');
  await byId(page, 'retry-pulls-acme/broken').click();
  await byId(page, 'pr-item-acme/broken-30').waitFor();
  assert.equal(await byId(page, 'pr-group-failed-acme/broken').count(), 0);
  assert.ok(await byId(page, 'pr-item-acme/gizmos-20').isVisible());
});

test('the text and repository filters narrow the rows; an empty result offers Clear', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/gizmos-20').waitFor();

  await byId(page, 'dashboard-filter').fill('retry');
  assert.deepEqual(await rowIds(page), ['pr-item-acme/gizmos-20']);
  await byId(page, 'dashboard-filter').fill('zzz-nothing');
  await byId(page, 'dashboard-filter-empty').waitFor();
  await byId(page, 'dashboard-filter-clear').click();
  assert.ok((await rowIds(page)).length > 4);
  assert.equal(await byId(page, 'dashboard-filter').inputValue(), '');

  const select = byId(page, 'dashboard-repository-filter');
  assert.equal(await select.locator('option').first().textContent(), 'All repositories');
  await select.selectOption('acme/gadgets');
  assert.deepEqual(await allRowIds(page), ['pr-item-acme/gadgets-10'], 'the approved one is hidden by default');
  // gadgets-11 is approved by the signed-in user, so it sits below the current rows.
  await byId(page, 'dashboard-hide-approved').uncheck();
  assert.deepEqual(await allRowIds(page), ['pr-item-acme/gadgets-10', 'pr-item-acme/gadgets-11']);
});

test('dashboard-empty names the base folder when no repository has an open pull request', async (t) => {
  const url = LIST('acme/widgets');
  const b = await useBrowser(t, { drop: (u) => u === url, extra: [{ request: { method: 'GET', url }, response: { status: 200, body: [] } }] });
  const page = await b.openPage('#/');
  await byId(page, 'dashboard-empty').waitFor();
  assert.equal(await byId(page, 'dashboard-empty').textContent(), `No open pull requests in ${b.bench.baseFolder}`);
});

test('a base folder with no repository on the chosen platform shows dashboard-no-repositories linking to Setup', async (t) => {
  const b = await useBrowser(t, { clone: 'none' });
  const page = await b.openPage('#/');
  await byId(page, 'dashboard-no-repositories').waitFor();
  assert.equal(await byId(page, 'dashboard-no-repositories').locator('a').getAttribute('href'), '#/setup');
});

test('only the starting row is busy', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/widgets-2').waitFor();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await held;
    return route.fallback();
  });
  await byId(page, 'pr-item-acme/widgets-1').locator('[data-testid="start-review"]').click();
  await page.waitForSelector('[aria-busy="true"]');
  assert.deepEqual(await page.locator('[data-testid="pr-list"] > li[aria-busy="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))), ['pr-item-acme/widgets-1']);
  assert.equal(await byId(page, 'pr-item-acme/widgets-2').getAttribute('aria-busy'), null);
  release();
  await page.waitForURL(/#\/sessions\//);
});

test('a failed session list shows a failed state with Retry, never an empty list', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/widgets-1').waitFor();
  await page.route('**/api/sessions', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"boom"}}' }) : route.fallback()));
  await page.reload();
  const region = byId(page, 'async-sessions');
  await region.waitFor();
  await page.waitForSelector('[data-testid="async-sessions"][data-state="failed"]');
  await page.unroute('**/api/sessions');
  await byId(page, 'retry-sessions').click();
  await page.waitForSelector('[data-testid="async-sessions"]:not([data-state="failed"])');
});

test('a session whose repository is no longer found says Open (read only); skipped folders link to Setup', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession();
  const empty = join(b.bench.appData.root, 'empty-base');
  await mkdir(empty, { recursive: true });
  await b.bench.client.put('/api/config', { workspace: { baseFolder: empty, platform: 'github' }, issueTracker: { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC'] } });
  await b.bench.discovered();
  const page = await b.openPage('#/');
  const item = byId(page, `session-item-${sessionId}`);
  await item.waitFor();
  assert.equal(await item.getByRole('link', { name: 'Open (read only)' }).count(), 1);

  // Back to the sandbox folder: its other clones (no remote on this platform) are skipped.
  await b.bench.client.put('/api/config', { workspace: { baseFolder: b.bench.baseFolder, platform: 'github' }, issueTracker: { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC'] } });
  await b.bench.discovered();
  await page.reload();
  await byId(page, 'skipped-repositories').waitFor();
  assert.equal(await byId(page, 'skipped-repositories').getAttribute('href'), '#/setup');
  assert.equal(await byId(page, `session-item-${sessionId}`).getByRole('link', { name: 'Open (read only)' }).count(), 0);
});

test('the filter and scroll position are restored on returning to #/ (FR-055)', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/', { height: 260 });
  await byId(page, 'pr-item-acme/gizmos-20').waitFor();
  await byId(page, 'dashboard-repository-filter').selectOption('acme/gadgets');
  await byId(page, 'dashboard-filter').fill('gadget');
  await byId(page, 'dashboard-filter').fill('');
  await byId(page, 'dashboard-repository-filter').selectOption('');
  await byId(page, 'dashboard-filter').fill('pr-');
  await page.evaluate(() => window.scrollTo(0, 120));
  const before = await page.evaluate(() => window.scrollY);
  assert.ok(before > 0, 'the page can scroll');
  await page.waitForTimeout(250);

  await page.evaluate(() => (location.hash = '#/setup'));
  await page.waitForSelector('[data-testid="setup-base-folder"]');
  await page.evaluate(() => (location.hash = '#/'));
  await byId(page, 'dashboard-filter').waitFor();
  assert.equal(await byId(page, 'dashboard-filter').inputValue(), 'pr-');
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, before);
});

test('pull requests are grouped by issue key with a count, the keyless ones last, and an approved one keeps its indicator', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'dashboard-hide-approved').uncheck();
  await byId(page, 'pr-item-acme/gadgets-11').waitFor();

  // widgets #1 is on branch feature/ABC-12-reset; the other fixture pull requests name no ticket.
  const jira = byId(page, 'pr-group-ABC-12');
  assert.equal(((await jira.locator('summary').textContent()) ?? '').trim(), 'ABC-12 (1)');
  assert.equal(await jira.locator('[data-testid="pr-item-acme/widgets-1"]').count(), 1);
  assert.equal(await jira.evaluate((el) => (el as HTMLDetailsElement).open), true, 'groups are open by default');

  const none = byId(page, 'pr-group-none');
  const count = await none.locator('li[data-testid^="pr-item-"]').count();
  assert.equal(((await none.locator('summary').textContent()) ?? '').trim(), `No issue key (${count})`);
  assert.equal(await none.locator('[data-testid="pr-item-acme/gadgets-11"]').count(), 1);
  const order = await page.locator('details.pr-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  assert.equal(order[order.length - 1], 'pr-group-none', 'the group with no issue key is last');

  assert.equal(((await byId(page, 'pr-item-acme/gadgets-11').locator('[data-testid="pr-approved"]').textContent()) ?? '').trim(), 'Approved');
  assert.equal(await byId(page, 'pr-item-acme/gadgets-10').locator('[data-testid="pr-approved"]').count(), 0, 'a PR you only have not reviewed is not marked');
  await checkA11y(page);
});

test('pull requests you approved are hidden by default, counted, and shown again when the box is unticked; the choice is remembered', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/gadgets-10').waitFor();

  const box = byId(page, 'dashboard-hide-approved');
  assert.equal(await box.isChecked(), true);
  assert.equal(await byId(page, 'pr-item-acme/gadgets-11').count(), 0);
  assert.equal(((await byId(page, 'dashboard-approved-hidden').textContent()) ?? '').trim(), '1 hidden');

  await box.uncheck();
  await byId(page, 'pr-item-acme/gadgets-11').waitFor();
  assert.equal(await byId(page, 'dashboard-approved-hidden').count(), 0);
  assert.equal(await byId(page, 'pr-item-acme/gadgets-11').locator('[data-testid="pr-approved"]').count(), 1);

  await page.goto(`${b.bench.client.origin}/#/setup`);
  await page.goBack();
  await byId(page, 'pr-item-acme/gadgets-11').waitFor();
  assert.equal(await byId(page, 'dashboard-hide-approved').isChecked(), false, 'kept after leaving and returning');
  await page.reload();
  await byId(page, 'pr-item-acme/gadgets-11').waitFor();
  assert.equal(await byId(page, 'dashboard-hide-approved').isChecked(), false, 'kept after a reload');
});

test('the last known list shows at once while a fresh one loads, then is replaced', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/gadgets-10').waitFor();
  assert.equal(await byId(page, 'pulls-refreshing').count(), 0, 'nothing is cached on the first visit, so there is no refresh note');

  // Hold the fresh list back; the cached one is not held.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/pulls*', async (route) => {
    if (!route.request().url().includes('cached=1')) await gate;
    await route.continue();
  });
  await page.reload();
  await byId(page, 'pr-item-acme/gadgets-10').waitFor();
  await byId(page, 'pulls-refreshing').waitFor();
  assert.equal(await byId(page, 'pr-item-acme/gadgets-10').locator('[data-testid="start-review"], [data-testid="resume-review"]').count(), 1, 'cached rows can be acted on');

  release();
  await byId(page, 'pulls-refreshing').waitFor({ state: 'detached' });
  await byId(page, 'pr-item-acme/gadgets-10').waitFor();
});

test('when the fresh list fails, the last known list stays and says so', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/gadgets-10').waitFor();
  await page.route('**/api/pulls*', async (route) => {
    if (route.request().url().includes('cached=1')) await route.continue();
    else await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'platform_error', message: 'down' } }) });
  });
  await page.reload();
  await byId(page, 'pulls-refresh-failed').waitFor();
  assert.equal(await byId(page, 'pr-item-acme/gadgets-10').count(), 1, 'the cached rows are still shown');
});

test('a pull request with no activity for more than 5 days is marked stale', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/widgets-1').waitFor();
  // Pinned to 2026-11-10 12:00 UTC: #1 was updated 7 days earlier, #3 just under 5.
  assert.equal(await byId(page, 'pr-item-acme/widgets-1').locator('[data-testid="pr-stale"]').count(), 1);
  assert.match((await byId(page, 'pr-item-acme/widgets-1').locator('[data-testid="pr-stale"]').getAttribute('title')) ?? '', /No activity for 7 days/);
  assert.equal(await byId(page, 'pr-item-acme/widgets-3').locator('[data-testid="pr-stale"]').count(), 0);
});

test('collapsing an issue group hides its rows and is remembered on returning and reloading', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/');
  await byId(page, 'pr-item-acme/widgets-1').waitFor();

  const group = byId(page, 'pr-group-ABC-12');
  assert.equal(await byId(page, 'pr-item-acme/widgets-1').isVisible(), true);
  await group.locator('summary').click();
  await byId(page, 'pr-item-acme/widgets-1').waitFor({ state: 'hidden' });
  // The toggle event writes the state a moment after the click; wait for it before leaving.
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('prwb:view:dashboard') ?? '{}').collapsedGroups?.includes('ABC-12'));

  await page.goto(`${b.bench.client.origin}/#/setup`);
  await page.goBack();
  await group.waitFor();
  assert.equal(await group.evaluate((el) => (el as HTMLDetailsElement).open), false, 'still collapsed after leaving and returning');
  assert.equal(((await group.locator('summary').textContent()) ?? '').trim(), 'ABC-12 (1)', 'the count shows while collapsed');

  await group.locator('summary').click();
  await page.waitForFunction(() => !JSON.parse(sessionStorage.getItem('prwb:view:dashboard') ?? '{}').collapsedGroups?.includes('ABC-12'));
  await page.reload();
  await byId(page, 'pr-item-acme/widgets-1').waitFor();
  assert.equal(await byId(page, 'pr-group-ABC-12').evaluate((el) => (el as HTMLDetailsElement).open), true, 'opening is remembered too');
});

test('your sessions form a review queue: lanes with counts, approved collapsed, and each row links to the platform in a new tab', async (t) => {
  const b = await useBrowser(t, { extraClones: OTHERS, extra: brokenRecovers() });
  const { sessionId } = await b.bench.startSession(1, 'acme/widgets');
  const page = await b.openPage('#/');
  // The lane comes from the pull request list, so wait for it before reading the lanes.
  await byId(page, 'pr-item-acme/gizmos-20').waitFor();
  await byId(page, 'queue-lane-in-progress').waitFor();
  assert.ok(((await byId(page, 'queue-count-in-progress').textContent()) ?? '').endsWith('1 in progress'));
  assert.ok(((await byId(page, 'queue-count-new-commits').textContent()) ?? '').endsWith('0 with new commits'));
  const lane = byId(page, 'queue-lane-in-progress');
  assert.equal(await lane.evaluate((el) => (el as HTMLDetailsElement).open), true, 'in progress is open');
  assert.equal(await byId(page, 'queue-lane-new-commits').count(), 0, 'an empty lane is not shown');

  const row = byId(page, `session-item-${sessionId}`);
  const link = row.locator('[data-testid="session-open-on-platform"]');
  assert.equal(await link.getAttribute('href'), 'https://github.com/acme/widgets/pull/1');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await link.getAttribute('aria-label'), 'Open on GitHub');
  assert.equal(await row.locator('[data-testid="resume-review"]').getAttribute('href'), `#/sessions/${encodeURIComponent(sessionId)}`);
  const pullLink = byId(page, 'pr-item-acme/gizmos-20').locator('[data-testid="pr-open-on-platform"]');
  assert.equal(await pullLink.getAttribute('href'), 'https://github.com/acme/gizmos/pull/20');
  assert.equal(await pullLink.getAttribute('target'), '_blank');
  await checkA11y(page);

  // Once you approve it the session moves to the approved lane, collapsed by default; opening it is remembered.
  await page.route('**/api/pulls', async (route) => {
    const response = await route.fetch();
    const groups = (await response.json()) as { pulls: { repository: string; number: number; approvedByMe?: boolean }[] }[];
    for (const g of groups) for (const p of g.pulls) if (p.repository === 'acme/widgets' && p.number === 1) p.approvedByMe = true;
    await route.fulfill({ response, json: groups });
  });
  await page.reload();
  await byId(page, 'queue-lane-approved').waitFor();
  const approved = byId(page, 'queue-lane-approved');
  assert.equal(await approved.evaluate((el) => (el as HTMLDetailsElement).open), false, 'approved is collapsed by default');
  assert.equal(await approved.locator(`[data-testid="session-item-${sessionId}"]`).count(), 1);
  await approved.locator('summary').click();
  await page.evaluate(() => (location.hash = '#/setup'));
  await page.waitForSelector('[data-testid="setup-base-folder"]');
  await page.evaluate(() => (location.hash = '#/'));
  await byId(page, 'queue-lane-approved').waitFor();
  assert.equal(await byId(page, 'queue-lane-approved').evaluate((el) => (el as HTMLDetailsElement).open), true);
});

test('a moved head puts the session in the new commits lane, first', async (t) => {
  const b = await useBrowser(t);
  const { sessionId } = await b.bench.startSession(1, 'acme/widgets');
  const page = await b.openPage('#/');
  await page.route('**/api/pulls', async (route) => {
    const response = await route.fetch();
    const groups = (await response.json()) as { pulls: { repository: string; number: number; headCommit?: string }[] }[];
    for (const g of groups) for (const p of g.pulls) if (p.number === 1) p.headCommit = 'f'.repeat(40);
    await route.fulfill({ response, json: groups });
  });
  await page.reload();
  const lane = byId(page, 'queue-lane-new-commits');
  await lane.waitFor();
  assert.equal(await page.locator('details.queue-lane').first().getAttribute('data-lane'), 'new-commits');
  assert.equal(await lane.locator(`[data-testid="session-item-${sessionId}"] [data-testid="session-new-commits"]`).count(), 1);
});
