// US1 (feature 005, FR-001, FR-005, FR-007, FR-016, FR-019): a reviewer comments on a changed line or range
// from the file view. "Post comment" posts at once, with no preview and no confirmation. Written first
// (constitution XI): it fails until diff.tsx offers the comment action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';
import { defaultPrFiles } from '../helpers/fake-ai-cli.ts';
import { fakeGithubReviews } from '../helpers/fake-github-reviews.ts';

const diffHash = (id: string): string => `#/sessions/${id}/diff?path=${encodeURIComponent('src/app.js')}`;

async function setup(t: Parameters<typeof useBrowser>[0]) {
  const platform = fakeGithubReviews();
  const b = await useBrowser(t, { prFiles: defaultPrFiles(), reviewer: 'rita-reviewer', intercept: platform.intercept });
  const { sessionId } = await b.bench.startSession();
  return { b, platform, sessionId };
}

test('a line comment posts at once and shows beside the line', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.getByTestId('diff-line-head-45').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  await page.getByTestId('comment-input').fill('Why 450 here?');
  assert.equal(platform.writes.length, 0, 'nothing is posted before the click');
  await page.getByTestId('comment-submit').click();
  await page.getByTestId('comment-thread').waitFor();
  assert.match((await page.getByTestId('comment').textContent()) ?? '', /Why 450 here\?/);
  assert.deepEqual(platform.writes, ['POST /pulls/1/comments']);
  assert.equal(platform.comments[0]?.line, 45);
  assert.equal(platform.comments[0]?.side, 'RIGHT');
  assert.equal(await page.getByTestId('comment-box').count(), 0, 'the box closes after the post');
});

test('a range posts with both ends, and the base side is commentable', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.getByTestId('diff-line-head-45').getByRole('button').click();
  await page.getByTestId('diff-line-head-47').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  await page.getByTestId('comment-input').fill('This block repeats the reset.');
  await page.getByTestId('comment-submit').click();
  await page.getByTestId('comment-thread').waitFor();
  assert.equal(platform.comments[0]?.start_line, 45);
  assert.equal(platform.comments[0]?.line, 47);

  await page.getByTestId('diff-line-base-42').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  await page.getByTestId('comment-input').fill('Was this 42 before?');
  await page.getByTestId('comment-submit').click();
  await page.getByText('Was this 42 before?').waitFor();
  assert.equal(platform.comments[1]?.side, 'LEFT');
});

test('cancel posts nothing, and Post comment is off for empty text', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.getByTestId('diff-line-head-45').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  assert.equal(await page.getByTestId('comment-submit').isDisabled(), true);
  await page.getByTestId('comment-input').fill('   ');
  assert.equal(await page.getByTestId('comment-submit').isDisabled(), true);
  await page.getByTestId('comment-input').fill('draft I will drop');
  await page.getByTestId('comment-cancel').click();
  assert.equal(await page.getByTestId('comment-box').count(), 0);
  assert.deepEqual(platform.writes, []);
});

test('a refusal shows the platform reason, keeps the text, and a retry posts', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.getByTestId('diff-line-head-45').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  await page.getByTestId('comment-input').fill('Keep this text');
  platform.failNext(403, 'Resource not accessible by personal access token');
  await page.getByTestId('comment-submit').click();
  const error = page.getByTestId('comment-error');
  await error.waitFor();
  assert.equal(await error.getAttribute('role'), 'alert');
  assert.match((await error.textContent()) ?? '', /Resource not accessible by personal access token/);
  assert.equal(await page.getByTestId('comment-input').inputValue(), 'Keep this text');
  await page.getByTestId('comment-submit').click();
  await page.getByTestId('comment-thread').waitFor();
  assert.equal(platform.comments.length, 1);
});

test('a double click posts once', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.getByTestId('diff-line-head-45').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  await page.getByTestId('comment-input').fill('Once only');
  await page.getByTestId('comment-submit').dblclick();
  await page.getByTestId('comment-thread').waitFor();
  assert.equal(platform.comments.length, 1);
});

test('an out-of-date head posts nothing and says so', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.getByTestId('diff-line-head-45').getByRole('button').click();
  await page.getByTestId('line-comment-button').click();
  await page.getByTestId('comment-input').fill('Too late');
  await b.bench.pushHead({ 'src/extra.js': 'export const extra = 1;\n' });
  await page.getByTestId('comment-submit').click();
  await page.getByTestId('review-out-of-date').waitFor();
  assert.equal(platform.comments.length, 0);
  assert.equal(await page.getByTestId('comment-input').inputValue(), 'Too late');
});

test('the whole flow works from the keyboard, and the page passes axe', async (t) => {
  const { b, platform, sessionId } = await setup(t);
  const page = await b.openPage(diffHash(sessionId));
  await page.locator('[data-cursor="true"]').focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByTestId('line-comment-button').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('comment-input').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'comment-input', 'focus moves into the box');
  await page.keyboard.type('Keyboard only');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'comment-submit');
  await page.keyboard.press('Enter');
  await page.getByTestId('comment-thread').waitFor();
  assert.equal(platform.comments.length, 1);
  await assertNoPageScroll(page);
  await checkA11y(page);
});

test('a skipped or binary file offers no comment, and the decision panel is in the file view', async (t) => {
  const platform = fakeGithubReviews();
  const b = await useBrowser(t, { prFiles: { ...defaultPrFiles(), 'assets/logo.bin': 'PNG\u0000\u0001\u0002binary\u0000data' }, reviewer: 'rita-reviewer', intercept: platform.intercept });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}/diff?path=${encodeURIComponent('assets/logo.bin')}`);
  await page.getByTestId('skipped-file-assets/logo.bin').waitFor();
  assert.equal(await page.getByTestId('line-comment-button').count(), 0);
  await page.getByTestId('decision-panel').waitFor();
});
