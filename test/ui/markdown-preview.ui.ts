// Markdown preview in the Files view: a Diff | Preview switch on Markdown files only, sanitized output,
// Mermaid diagrams drawn as images (the CSP forbids inline styles), a bad diagram that cannot break the page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles } from '../helpers/fake-ai-cli.ts';

const GUIDE = [
  '# Guide title',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| a | 1 |',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] --> B[End]',
  '```',
  '',
  '```mermaid',
  'this is not a diagram',
  '```',
  '',
  '<img src="x" onerror="window.__pwned = true">',
  '<script>window.__pwned = true</script>',
  '',
  '[bad](javascript:window.__pwned=true) and [good](https://example.com/x)',
  '',
].join('\n');

const files = { ...defaultPrFiles(), 'docs/guide.md': GUIDE, 'docs/other.md': '# Other\n\nText.\n' };
const hash = (id: string, path: string): string => `#/sessions/${id}/diff?path=${encodeURIComponent(path)}`;

test('Markdown files get a Preview that renders safely, with Mermaid diagrams', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(hash(sessionId, 'docs/guide.md'), { width: 1440 });
  const csp: string[] = [];
  page.on('console', (m) => {
    // Not counted: Mermaid's temporary layout nodes carry inline styles, and Chromium logs the inline handler of the
    // hostile <img> while the sanitizer parses it (it is stripped and never runs, asserted below).
    if (/content security policy/i.test(m.text()) && !/inline style|inline event handler/i.test(m.text())) csp.push(m.text());
  });

  await page.getByTestId('md-view-preview').waitFor();
  assert.equal(await page.getByTestId('md-view-diff').getAttribute('aria-pressed'), 'true');
  await page.getByTestId('md-view-preview').click();

  await page.getByTestId('markdown-preview').waitFor();
  assert.equal(await page.locator('.markdown-body h1').textContent(), 'Guide title');
  assert.equal(await page.locator('.markdown-body table').count(), 1);

  const diagram = page.getByTestId('mermaid-diagram');
  await diagram.waitFor({ timeout: 30_000 });
  assert.match((await diagram.getAttribute('src')) ?? '', /^data:image\/svg\+xml/);
  await page.getByTestId('mermaid-error').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('mermaid-diagram').count(), 1);

  assert.equal(await page.locator('.markdown-body [onerror], .markdown-body script').count(), 0);
  assert.equal(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned), undefined);
  assert.equal(await page.locator('.markdown-body a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator('.markdown-body a[href="https://example.com/x"]').getAttribute('rel'), 'noopener noreferrer');
  assert.deepEqual(csp, []);
  await checkA11y(page);

  // The choice is remembered for the tab, and the diff is one click away.
  await page.goto(page.url().replace(/path=[^&]+/, `path=${encodeURIComponent('docs/other.md')}`));
  await page.getByTestId('markdown-preview').waitFor();
  await page.getByTestId('md-view-diff').click();
  await page.getByTestId('markdown-preview').waitFor({ state: 'detached' });
});

test('Non-Markdown files have no Preview switch', async (t) => {
  const b = await useBrowser(t, { prFiles: files });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(hash(sessionId, 'src/util.js'), { width: 1440 });
  await page.locator('[data-testid^="diff-line-"]').first().waitFor();
  assert.equal(await page.getByTestId('md-view-preview').count(), 0);
});
