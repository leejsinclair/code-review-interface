// T012 (VO-010, VO-011; FR-012): a capture writes its image only once the view is ready, and a failed capture keeps
// the previous image byte for byte, leaves no temporary file, and says what it waited for.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { views } from '../demo/scenarios.ts';
import { captureTo } from '../demo/screenshots.ts';

const view = views[0]!;

/** A page whose ready selector appears (or times out) and whose screenshot writes `NEW` (or fails half-way). */
function stubPage(opts: { ready: boolean; screenshotFails?: boolean }): Page {
  const locator = {
    first: () => locator,
    waitFor: async () => {
      if (!opts.ready) throw new Error(`Timeout 15000ms exceeded.\nwaiting for locator('${view.ready}')`);
    },
    evaluate: async () => undefined,
  };
  return {
    locator: () => locator,
    waitForFunction: async () => undefined,
    screenshot: async ({ path }: { path: string }) => {
      await writeFile(path, opts.screenshotFails ? 'PARTIAL' : 'NEW');
      if (opts.screenshotFails) throw new Error('Target page, context or browser has been closed');
    },
  } as unknown as Page;
}

async function folder(t: { after(fn: () => unknown): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prwb-capture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a ready view is written under its final name', async (t) => {
  const dir = await folder(t);
  const file = join(dir, view.file);
  await writeFile(file, 'OLD');
  assert.deepEqual(await captureTo(file, view, stubPage({ ready: true })), { ok: true });
  assert.equal(await readFile(file, 'utf8'), 'NEW');
  assert.deepEqual(await readdir(dir), [view.file]);
});

test('a view that never becomes ready keeps the previous image and names what it waited for', async (t) => {
  const dir = await folder(t);
  const file = join(dir, view.file);
  await writeFile(file, 'OLD');
  const result = await captureTo(file, view, stubPage({ ready: false }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.includes(view.ready) && /timeout/i.test(result.reason), JSON.stringify(result));
  assert.equal(await readFile(file, 'utf8'), 'OLD');
  assert.deepEqual(await readdir(dir), [view.file]);
});

test('a screenshot that fails part-way leaves no temporary file and no new image', async (t) => {
  const dir = await folder(t);
  const file = join(dir, view.file);
  const result = await captureTo(file, view, stubPage({ ready: true, screenshotFails: true }));
  assert.equal(result.ok, false);
  assert.equal(existsSync(file), false, 'no blank or partial image');
  assert.deepEqual(await readdir(dir), []);
});
