// US2 (feature 005, FR-002 to FR-004, FR-009, FR-013, FR-018): finish a review from the overview. Approve,
// request changes, general comment and withdraw each post on one click. The reviewer's own decision is shown
// with its commit and time and never as readiness. Written first (constitution XI).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoPageScroll, checkA11y, useBrowser } from '../helpers/browser.ts';
import { fakeGithubReviews } from '../helpers/fake-github-reviews.ts';

async function setup(t: Parameters<typeof useBrowser>[0], reviewer = 'rita-reviewer') {
  const platform = fakeGithubReviews({ reviewer });
  const b = await useBrowser(t, { reviewer, intercept: platform.intercept });
  const { sessionId } = await b.bench.startSession();
  return { b, platform, sessionId, url: `#/sessions/${sessionId}` };
}

test('approve with and without a message posts at once and shows the decision', async (t) => {
  const { b, platform, url } = await setup(t);
  const page = await b.openPage(url);
  await page.getByTestId('decision-panel').waitFor();
  assert.match((await page.getByTestId('decision-state').textContent()) ?? '', /no decision/i);

  await page.getByTestId('decision-approve').click();
  await page.waitForFunction(() => /You approved/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(platform.reviews.at(-1)?.state, 'APPROVED');
  assert.equal(platform.reviews.at(-1)?.body, '');
  const text = (await page.getByTestId('decision-state').textContent()) ?? '';
  assert.match(text, /You approved on [0-9a-f]{8}, /, 'shows the commit and the time');

  await page.getByTestId('decision-message').fill('Looks good to me.');
  await page.getByTestId('decision-approve').click();
  await page.waitForFunction(() => /Looks good to me\./.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(platform.reviews.at(-1)?.body, 'Looks good to me.');
});

test('request changes is blocked until a message is typed, then posts at once', async (t) => {
  const { b, platform, url } = await setup(t);
  const page = await b.openPage(url);
  await page.getByTestId('decision-panel').waitFor();
  assert.equal(await page.getByTestId('decision-request-changes').isDisabled(), true);
  await page.getByTestId('decision-message').fill('Please add a test.');
  assert.equal(await page.getByTestId('decision-request-changes').isDisabled(), false);
  await page.getByTestId('decision-request-changes').click();
  await page.waitForFunction(() => /requested changes/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(platform.reviews.at(-1)?.state, 'CHANGES_REQUESTED');
});

test('the decision is the reviewer’s own, never readiness', async (t) => {
  const { b, url } = await setup(t);
  const page = await b.openPage(url);
  await page.getByTestId('decision-approve').click();
  await page.waitForFunction(() => /You approved/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.match((await page.getByTestId('decision-panel').textContent()) ?? '', /your own decision/i);
  assert.equal(await page.getByTestId('decision-panel').locator('[data-testid*="readiness"]').count(), 0);
  const focus = (await page.getByTestId('review-focus').textContent().catch(() => '')) ?? '';
  assert.doesNotMatch(focus, /You approved/, 'the review focus does not carry the decision');
});

test('withdraw is one click', async (t) => {
  const { b, platform, url } = await setup(t);
  const page = await b.openPage(url);
  await page.getByTestId('decision-approve').click();
  await page.getByTestId('decision-withdraw').waitFor();
  await page.getByTestId('decision-withdraw').click();
  await page.waitForFunction(() => /no decision/.test(document.querySelector('[data-testid="decision-state"]')?.textContent ?? ''));
  assert.equal(platform.reviews.at(-1)?.state, 'DISMISSED');
  assert.equal(await page.getByTestId('decision-withdraw').count(), 0);
});

test('a general comment posts to the pull request and is listed', async (t) => {
  const { b, platform, url } = await setup(t);
  const page = await b.openPage(url);
  await page.getByTestId('decision-message').fill('Thanks for the clean-up.');
  await page.getByTestId('decision-comment').click();
  await page.getByText('Thanks for the clean-up.').nth(0).waitFor();
  assert.deepEqual(platform.writes, ['POST /issues/1/comments']);
  await page.getByTestId('comment-thread').waitFor();
  assert.equal(await page.getByTestId('decision-message').inputValue(), '');
});

test('the author cannot review their own pull request, and the reason is shown', async (t) => {
  const { b, platform, url } = await setup(t, 'alice-dev');
  const page = await b.openPage(url);
  await page.getByTestId('review-disabled-reason').waitFor();
  assert.match((await page.getByTestId('review-disabled-reason').textContent()) ?? '', /author/i);
  assert.equal(await page.getByTestId('decision-approve').isDisabled(), true);
  assert.equal(await page.getByTestId('decision-comment').isDisabled(), true);
  assert.deepEqual(platform.writes, []);
});

test('approve, request changes, general comment and withdraw complete by keyboard only, announced', async (t) => {
  const { b, platform, url } = await setup(t);
  const page = await b.openPage(url);
  await page.getByTestId('decision-approve').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Approved/.test(document.querySelector('[data-testid="live-region"]')?.textContent ?? ''));
  await page.getByTestId('decision-message').focus();
  await page.keyboard.type('Needs a test');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'decision-approve');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'decision-request-changes');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Changes requested/.test(document.querySelector('[data-testid="live-region"]')?.textContent ?? ''));
  await page.getByTestId('decision-message').focus();
  await page.keyboard.type('One more thing');
  await page.getByTestId('decision-comment').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Comment posted/.test(document.querySelector('[data-testid="live-region"]')?.textContent ?? ''));
  await page.getByTestId('decision-withdraw').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /withdrawn/.test(document.querySelector('[data-testid="live-region"]')?.textContent ?? ''));
  assert.equal(platform.reviews.at(-1)?.state, 'DISMISSED');
  await assertNoPageScroll(page);
  await checkA11y(page);
});

test('a merged pull request disables every action with a reason', async (t) => {
  const platform = fakeGithubReviews();
  const b = await useBrowser(t, { reviewer: 'rita-reviewer', intercept: platform.intercept, prStates: ['open', 'merged'] });
  const { sessionId } = await b.bench.startSession();
  const page = await b.openPage(`#/sessions/${sessionId}`);
  await page.getByTestId('review-disabled-reason').waitFor();
  assert.match((await page.getByTestId('review-disabled-reason').textContent()) ?? '', /not open/i);
  assert.equal(await page.getByTestId('decision-approve').isDisabled(), true);
  assert.deepEqual(platform.writes, []);
});
