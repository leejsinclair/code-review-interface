// US4 (feature 005, FR-010, FR-011): reply to a thread, and edit or delete only comments this tool posted.
// The behaviour comes from the thread component and the core's own-comment rule (T021, T028).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBrowser } from '../helpers/browser.ts';
import { fakeGithubReviews } from '../helpers/fake-github-reviews.ts';

const OTHER = { login: 'bob-dev', id: 41002 };
const seeded = [
  { id: 500, body: 'Someone else wrote this.', user: OTHER, created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:00:00Z', review: false },
];

async function setup(t: Parameters<typeof useBrowser>[0]) {
  const platform = fakeGithubReviews({ seed: seeded });
  const b = await useBrowser(t, { reviewer: 'rita-reviewer', intercept: platform.intercept });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByText('Someone else wrote this.').waitFor();
  return { platform, page };
}

const own = (page: import('playwright').Page, text: string) => page.locator('[data-testid="comment"]', { hasText: text });

async function post(page: import('playwright').Page, text: string): Promise<void> {
  await page.getByTestId('decision-message').fill(text);
  await page.getByTestId('decision-comment').click();
  await own(page, text).waitFor();
}

test('edit and delete are offered only on a comment this tool posted', async (t) => {
  const { page } = await setup(t);
  assert.equal(await own(page, 'Someone else wrote this.').getByTestId('comment-edit').count(), 0);
  assert.equal(await own(page, 'Someone else wrote this.').getByTestId('comment-delete').count(), 0);
  await post(page, 'My comment');
  assert.equal(await own(page, 'My comment').getByTestId('comment-edit').count(), 1);
  assert.equal(await own(page, 'My comment').getByTestId('comment-delete').count(), 1);
});

test('a reply appears in the thread', async (t) => {
  const { platform, page } = await setup(t);
  await page.getByTestId('comment-reply').first().click();
  await page.getByTestId('comment-input').fill('Agreed, fixing.');
  await page.getByTestId('comment-submit').click();
  await own(page, 'Agreed, fixing.').waitFor();
  assert.equal(platform.comments.length, 2);
});

test('edit changes the comment on the platform and in the tool', async (t) => {
  const { platform, page } = await setup(t);
  await post(page, 'First draft');
  await own(page, 'First draft').getByTestId('comment-edit').click();
  await page.getByTestId('comment-input').fill('Second draft');
  await page.getByTestId('comment-submit').click();
  await own(page, 'Second draft').waitFor();
  assert.equal(platform.comments.find((c) => c.user.login === 'rita-reviewer')?.body, 'Second draft');
});

test('delete removes the comment on the platform and in the tool', async (t) => {
  const { platform, page } = await setup(t);
  await post(page, 'Delete me');
  await own(page, 'Delete me').getByTestId('comment-delete').click();
  await own(page, 'Delete me').waitFor({ state: 'detached' });
  assert.equal(platform.comments.some((c) => c.body === 'Delete me'), false);
  assert.equal(await own(page, 'Someone else wrote this.').count(), 1, 'the other comment stays');
});

test('reply, edit and delete complete by keyboard only', async (t) => {
  const { platform, page } = await setup(t);
  await post(page, 'Keyboard comment');
  await page.getByTestId('comment-reply').first().focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('comment-input').waitFor();
  await page.keyboard.type('Keyboard reply');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await own(page, 'Keyboard reply').waitFor();
  await own(page, 'Keyboard comment').getByTestId('comment-edit').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('comment-input').fill('Keyboard edited');
  await page.getByTestId('comment-input').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await own(page, 'Keyboard edited').waitFor();
  await own(page, 'Keyboard edited').getByTestId('comment-delete').focus();
  await page.keyboard.press('Enter');
  await own(page, 'Keyboard edited').waitFor({ state: 'detached' });
  assert.equal(platform.comments.some((c) => c.body === 'Keyboard edited'), false);
});
