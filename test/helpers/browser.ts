// Browser test helper (T002): starts the workbench through the fake-AI-CLI harness (recorded fetch,
// fake `claude`), builds the UI bundle once, launches Chromium and hands out signed-in pages.
//
//   const b = await useBrowser(t);
//   const page = await b.openPage('#/', { width: 1440, colorScheme: 'dark' });
//   await checkA11y(page);
//   await assertNoPageScroll(page);

import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { startWorkbench, type Workbench, type WorkbenchOptions } from './fake-ai-cli.ts';
import { SESSION_COOKIE } from './server.ts';

const run = promisify(execFile);
type AfterHook = Parameters<typeof startWorkbench>[0];

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] as const;

export type OpenPageOptions = { width?: number; height?: number; colorScheme?: 'light' | 'dark'; reducedMotion?: 'reduce' | 'no-preference'; now?: string };

/** The page's clock is pinned so age-based dashboard grouping (stale, older) does not drift as the fixtures age. */
export const PINNED_NOW = '2026-11-10T12:00:00Z';

export interface BrowserHarness {
  bench: Workbench;
  browser: Browser;
  /** A new page in its own signed-in context, already at `hash` (e.g. `#/`). */
  openPage(hash?: string, options?: OpenPageOptions): Promise<Page>;
}

let built: Promise<unknown> | undefined;
/** Builds `dist/ui` once per process, so the page runs the current source. */
function buildUi(): Promise<unknown> {
  built ??= run('npm', ['run', 'build:ui'], { cwd: new URL('../../', import.meta.url).pathname });
  return built;
}

export async function useBrowser(t: AfterHook, options: WorkbenchOptions = {}): Promise<BrowserHarness> {
  await buildUi();
  // Registered first, so the pages close before the server shuts down and removes its data.
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const bench = await startWorkbench(t, options);

  const openPage = async (hash = '#/', opts: OpenPageOptions = {}): Promise<Page> => {
    const { client } = bench;
    assert.ok(client.cookie !== undefined, 'the test client is signed in');
    const context = await browser.newContext({
      viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
      colorScheme: opts.colorScheme ?? 'light',
      reducedMotion: opts.reducedMotion ?? 'no-preference',
    });
    await context.clock.setFixedTime(new Date(opts.now ?? PINNED_NOW));
    await context.addCookies([{ name: SESSION_COOKIE, value: client.cookie, url: client.origin }]);
    const page = await context.newPage();
    await page.goto(`${client.origin}/${hash}`);
    await page.waitForSelector('main, [data-testid="signin-required"], body');
    return page;
  };
  return { bench, browser, openPage };
}

/** Fails with the rule ids and targets when axe finds a violation. */
export async function checkA11y(page: Page, extraRules: readonly string[] = []): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]);
  if (extraRules.length > 0) builder.withRules([...extraRules]);
  const { violations } = await builder.analyze();
  assert.deepEqual(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    [],
    'axe found no violations',
  );
}

/** The page must not scroll sideways. */
export async function assertNoPageScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(scrollWidth <= innerWidth, `page scrolls sideways: scrollWidth ${scrollWidth} > ${innerWidth}`);
}
