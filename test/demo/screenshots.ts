// `npm run screenshots` (008 US3; FR-009 to FR-012): captures every README Features view from the real workbench
// against the seeded GitLab demo (`npm run gitlab:demo` first).
//
// The workbench runs through the test harness: temp app data, the fake keyring, and the fake `claude` CLI with fixed
// demo text per view (FR-010). The root token only mints a short-lived token for demo-reviewer, revoked at the end.
// The clones live in <os tmpdir>/prwb-demo/, and their git credential in a temp HOME, so nothing of the user's is
// read or changed. A view that does not reach its ready state keeps its previous image and fails the command (FR-012).

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Page } from 'playwright';
import { useBrowser } from '../helpers/browser.ts';
import type { LiveWorkbench, WorkbenchOptions } from '../helpers/fake-ai-cli.ts';
import { createAfterHooks, type AfterHooks } from './after-hooks.ts';
import { COLOR_SCHEME, DEMO_GROUP, VIEWPORT, demoUsers, projects, views, type DemoView } from './scenarios.ts';
import { demoTarget } from './seed.ts';

const run = promisify(execFile);
const READY_MS = 15_000;
const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname;

/** Waits for `view.ready`, writes `<file>.tmp`, and renames it over `file` only on success (R10). */
export async function captureTo(file: string, view: DemoView, page: Page): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tmp = `${file}.tmp`;
  try {
    const ready = page.locator(view.ready).first();
    await ready.waitFor({ state: 'visible', timeout: READY_MS });
    // Best effort: let other panels finish loading, so a rerun shows the same settled page.
    await page.waitForFunction(() => !/Loading|assessment in progress/.test(document.body.innerText), undefined, { timeout: READY_MS }).catch(() => undefined);
    // Scroll only when the view's subject starts below the fold, so a top-of-page view keeps its header.
    await ready.evaluate((el) => {
      if (el.getBoundingClientRect().top > window.innerHeight - 100) el.scrollIntoView({ block: 'start' });
    });
    await page.screenshot({ path: tmp, type: 'png' });
    await rename(tmp, file);
    return { ok: true };
  } catch (error) {
    await rm(tmp, { force: true });
    return { ok: false, reason: `${view.ready} not ready: ${((error as Error).message.split('\n')[0] ?? '').trim()}` };
  }
}

/** The run's workbench setup: HOME points at the clones' credential home until `hooks` run (FR-009). */
export function workbenchOptions(hooks: AfterHooks, input: { home: string; live: LiveWorkbench }): WorkbenchOptions {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'HOME');
  const previous = process.env.HOME;
  hooks.after(() => {
    if (had) process.env.HOME = previous;
    else delete process.env.HOME;
  });
  process.env.HOME = input.home;
  return { fake: { scenario: 'structured' }, live: input.live };
}

/** Clones every demo project into `base`, with the reviewer's credential in `home` as their own git would hold it. */
async function cloneDemo(baseUrl: string, token: string, base: string, home: string): Promise<void> {
  const host = new URL(baseUrl);
  await writeFile(join(home, '.gitconfig'), '[credential]\n\thelper = store\n[gc]\n\tauto = 0\n');
  await writeFile(join(home, '.git-credentials'), `${host.protocol}//oauth2:${token}@${host.host}\n`, { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  for (const p of projects) {
    await run('git', ['clone', '--quiet', `${baseUrl.replace(/\/+$/, '')}/${DEMO_GROUP}/${p.path}.git`, join(base, p.path)], { env }).catch((error: Error) => {
      throw new Error(`cloning ${p.path} failed (run \`npm run gitlab:demo\` first): ${error.message.split(token).join('[redacted]')}`);
    });
  }
}

async function main(): Promise<boolean> {
  const { admin } = await demoTarget();
  const reviewer = demoUsers().find((u) => u.role === 'reviewer');
  const user = reviewer === undefined ? undefined : await admin.findUser(reviewer.username);
  if (user === undefined) throw new Error('the demo is not seeded: run `npm run gitlab:demo` first');

  const hooks = createAfterHooks();
  try {
    const pat = await admin.call('POST', `/users/${user.id}/personal_access_tokens`, {
      name: 'prwb-demo-screenshots',
      scopes: ['api'],
      expires_at: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    });
    hooks.after(() => admin.call('DELETE', `/personal_access_tokens/${pat.id}`));

    const base = join(tmpdir(), 'prwb-demo');
    await rm(base, { recursive: true, force: true });
    await mkdir(base);
    hooks.after(() => rm(base, { recursive: true, force: true }));
    const home = await mkdtemp(join(tmpdir(), 'prwb-demo-home-'));
    hooks.after(() => rm(home, { recursive: true, force: true }));
    await cloneDemo(admin.baseUrl, pat.token, base, home);

    // The merge requests' iids, and the newest one's creation plus an hour as the page clock (R9).
    const iids = new Map<string, number>();
    let newest = 0;
    for (const p of projects) {
      const found = await admin.findProject(`${DEMO_GROUP}/${p.path}`);
      for (const m of p.mergeRequests) {
        const mr = found === null ? undefined : await admin.findMergeRequest(found.id, m.sourceBranch);
        if (mr === undefined) throw new Error(`${p.path}:${m.sourceBranch} is missing: run \`npm run gitlab:demo\` first`);
        iids.set(`${p.path}!${m.iid}`, mr.iid);
        newest = Math.max(newest, Date.parse(mr.created_at));
      }
    }
    const now = new Date(newest + 3_600_000).toISOString();

    const credential = { secret: pat.token as string, scheme: 'bearer' as const };
    const b = await useBrowser(
      hooks,
      workbenchOptions(hooks, {
        home,
        live: {
          repository: { platform: 'gitlab', id: `${DEMO_GROUP}/storefront`, baseUrl: admin.baseUrl },
          issueTracker: { platform: 'gitlab-issues', site: admin.baseUrl },
          credentials: { gitlab: credential, 'gitlab-issues': credential },
          clonePath: join(base, 'storefront'),
          fetch,
        },
      }),
    );

    await mkdir(OUT, { recursive: true });
    const failed: string[] = [];
    // The queue is captured last, so it shows the sessions the other views opened.
    for (const view of [...views].sort((x, y) => Number(x.mergeRequest === undefined) - Number(y.mergeRequest === undefined))) {
      await b.bench.fake?.configure(view.ai);
      let sessionId = '';
      if (view.mergeRequest !== undefined) {
        const iid = iids.get(`${view.project}!${view.mergeRequest}`) as number;
        sessionId = (await b.bench.startSession(iid, `${DEMO_GROUP}/${view.project}`))['sessionId'] as string;
      }
      const page = await b.openPage(view.route(sessionId), { ...VIEWPORT, colorScheme: COLOR_SCHEME, now });
      try {
        for (const action of view.actions ?? []) {
          if ('fill' in action) await page.locator(action.fill).fill(action.text);
          else await page.locator(action.click).click();
        }
        const result = await captureTo(join(OUT, view.file), view, page);
        if (result.ok) console.log(`docs/screenshots/${view.file}`);
        else failed.push(`${view.name}: ${result.reason}`);
      } finally {
        await page.context().close();
      }
    }
    for (const f of failed) console.error(f);
    return failed.length === 0;
  } finally {
    await hooks.run();
  }
}

// Not import.meta.main: Node 24.2 reports false for a .ts entry file.
if (process.argv[1] === import.meta.filename) {
  try {
    if (!(await main())) process.exitCode = 1;
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
