// US10 (FR-034 to FR-037, FR-048, FR-056): Setup shows only the declared fields, limits in human units, the
// discovery result and a checklist.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';

type Descriptor = { id: string; displayName: string; needsBaseUrl?: boolean; settingsFields?: string[] };
type Platforms = { sourceControl: string[]; issueTrackers: string[]; descriptors: Descriptor[] };

test('fields follow the descriptors, and limits are collapsed in KB and lines', async (t) => {
  const b = await useBrowser(t);
  const platforms = (await b.bench.client.get('/api/platforms')).json as Platforms;
  const by = (id: string) => platforms.descriptors.find((d) => d.id === id)!;
  const page = await b.openPage('#/setup');
  await page.getByTestId('setup-base-folder').waitFor();
  assert.equal(await page.getByLabel('Base folder').count(), 1);

  for (const id of platforms.sourceControl) {
    await page.getByTestId('setup-platform').selectOption(id);
    assert.equal(await page.getByTestId('setup-base-url').count(), by(id).needsBaseUrl === true ? 1 : 0, `base url for ${id}`);
  }
  for (const id of platforms.issueTrackers) {
    await page.getByTestId('setup-tracker').selectOption(id);
    const fields = by(id).settingsFields ?? [];
    assert.equal(await page.getByTestId('setup-site').count(), fields.includes('site') ? 1 : 0, `site for ${id}`);
    assert.equal(await page.getByTestId('setup-project-keys').count(), fields.includes('projectKeys') ? 1 : 0, `keys for ${id}`);
  }

  const limits = page.getByTestId('advanced-limits');
  assert.equal(await limits.evaluate((el) => (el as HTMLDetailsElement).open), false);
  await limits.locator('summary').click();
  assert.equal(await page.getByTestId('setup-max-file-kb').inputValue(), '1024');
  assert.match((await limits.textContent()) ?? '', /default 5,000/);
  await checkA11y(page);
});

test('a refusal shows at its field and in the summary; a save shows discovery and the checklist', async (t) => {
  const b = await useBrowser(t);
  const page = await b.openPage('#/setup');
  await page.getByTestId('setup-base-folder').waitFor();
  const original = await page.getByTestId('setup-base-folder').inputValue();

  await page.getByTestId('setup-base-folder').fill('not/absolute');
  await page.getByRole('button', { name: 'Save' }).click();
  const summary = page.getByTestId('setup-error');
  await summary.waitFor();
  assert.equal(await page.getByTestId('setup-base-folder').getAttribute('aria-invalid'), 'true');
  assert.ok(await page.getByTestId('setup-base-folder-error').count());
  assert.ok(await summary.locator('a').count(), 'the summary links to the field');

  await page.getByTestId('setup-base-folder').fill(original);
  await page.getByRole('button', { name: 'Save' }).click();
  const result = page.getByTestId('discovery-result');
  await result.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="discovery-result"]')?.getAttribute('data-state') === 'complete');
  await page.getByTestId('rescan-button').waitFor();
  const checklist = page.getByTestId('connection-checklist');
  await checklist.waitFor();
  for (const id of ['check-base-folder', 'check-repositories', 'check-provider']) {
    assert.match((await page.getByTestId(id).getAttribute('data-status')) ?? '', /^(ok|failed|not-checked)$/);
  }
});

test('a base folder with no repositories gives a complete result that says so', async (t) => {
  const b = await useBrowser(t);
  const emptyFolder = mkdtempSync(join(tmpdir(), 'prwb-empty-'));
  t.after(() => rmSync(emptyFolder, { recursive: true, force: true }));
  const page = await b.openPage('#/setup');
  await page.getByTestId('setup-base-folder').waitFor();
  await page.getByTestId('setup-base-folder').fill(emptyFolder);
  await page.getByRole('button', { name: 'Save' }).click();
  // The first scan of the old folder was already complete, so wait for the result of the new one.
  await page.getByTestId('discovery-result').getByText(/No .* repositories were found/).waitFor({ timeout: 15000 });
  assert.equal(await page.getByTestId('discovery-result').getAttribute('data-state'), 'complete');
});
