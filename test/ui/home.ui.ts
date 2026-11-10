// US12 and US11 (FR-039, FR-052 to FR-055, SC-010): the Home dashboard over a base folder holding several
// repositories. Rows carry their repository, a failing repository fails alone and can be retried, the
// filters and the scroll position come back on returning to `#/`.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { useBrowser } from '../helpers/browser.ts';
import { loadFixtures } from '../helpers/recorded-fetch.ts';

const OTHERS = ['acme/gadgets', 'acme/gizmos', 'acme/sprockets', 'acme/broken'];
const LIST = (repo: string) => `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`;
const byId = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

/** A 200 list served for acme/broken after its first (500) answer, so Retry loads it. */
function brokenRecovers() {
  const sprockets = loadFixtures('github').find((e) => e.request.url === LIST('acme/sprockets'))!;
  return [{ request: { method: 'GET', url: LIST('acme/broken') }, response: sprockets.response }];
}

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
  // Same update time everywhere: ordered by repository, then number.
  const sorted = [...ids].sort((a, c) => {
    const [ra, na] = [a!.replace(/^pr-item-/, '').replace(/-\d+$/, ''), Number(/-(\d+)$/.exec(a!)![1])];
    const [rc, nc] = [c!.replace(/^pr-item-/, '').replace(/-\d+$/, ''), Number(/-(\d+)$/.exec(c!)![1])];
    return ra < rc ? -1 : ra > rc ? 1 : na - nc;
  });
  const dates = await page.locator('[data-testid="pr-list"] time').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')!));
  assert.deepEqual(dates, [...dates].sort().reverse(), 'most recently updated first');
  if (new Set(dates).size === 1) assert.deepEqual(ids, sorted);

  const row = byId(page, 'pr-item-acme/gizmos-20');
  const text = (await row.textContent()) ?? '';
  for (const part of ['acme/gizmos', '#20', 'Gizmo retry policy', 'feature/pr-20']) assert.ok(text.includes(part), `${part} in ${text}`);
  assert.equal(await row.locator('[data-testid="start-review"]').count(), 1);
  assert.equal(await row.locator('[data-testid="start-review"]').textContent(), 'Start review');
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
  assert.deepEqual(await rowIds(page), ['pr-item-acme/gadgets-10', 'pr-item-acme/gadgets-11']);
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
  assert.match((await item.textContent()) ?? '', /Open \(read only\)/);

  // Back to the sandbox folder: its other clones (no remote on this platform) are skipped.
  await b.bench.client.put('/api/config', { workspace: { baseFolder: b.bench.baseFolder, platform: 'github' }, issueTracker: { platform: 'jira-cloud', site: 'https://acme.atlassian.net', projectKeys: ['ABC'] } });
  await b.bench.discovered();
  await page.reload();
  await byId(page, 'skipped-repositories').waitFor();
  assert.equal(await byId(page, 'skipped-repositories').getAttribute('href'), '#/setup');
  assert.doesNotMatch((await byId(page, `session-item-${sessionId}`).textContent()) ?? '', /read only/);
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
