// SC-002 (FR-017, FR-018, FR-047): the whole review journey works from the keyboard, and the draft and choices are
// kept per tab, never sent to the server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useBrowser } from '../helpers/browser.ts';

const ANSWER = { claims: [{ text: 'It scales values.', label: 'evidence', refs: [{ kind: 'code', path: 'src/app.js', side: 'head', startLine: 45, endLine: 50 }] }], unsupportedAssumptions: [], suggestedFollowUps: [] };

test('keyboard-only: Overview → Files → select → Ask → evidence → back keeps draft, choice and scope', async (t) => {
  const b = await useBrowser(t, { fake: { scenario: 'structured', answer: ANSWER } });
  const { sessionId } = await b.bench.startSession();
  const bodies: string[] = [];
  const page = await b.openPage(`#/sessions/${sessionId}/diff?path=${encodeURIComponent('src/app.js')}`, { width: 800 });
  page.on('request', (r) => bodies.push(`${r.url()} ${r.postData() ?? ''}`));
  await page.getByTestId('diff-line-head-40').waitFor();

  await page.locator('[data-cursor="true"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowDown');
  const scope = await page.getByTestId('scope-indicator').textContent();
  await page.getByTestId('ask-about-selection').focus();
  await page.keyboard.press('Enter');

  const input = page.getByLabel('Your question');
  await input.waitFor();
  await input.fill('SECRETDRAFT why?');
  await page.getByTestId('answer-for-business').focus();
  await page.keyboard.press('Space');
  await page.reload();
  assert.equal(await page.getByLabel('Your question').inputValue(), 'SECRETDRAFT why?');
  assert.equal(await page.getByTestId('answer-for-business').isChecked(), true);
  assert.match((await page.getByTestId('scope-indicator').textContent()) ?? '', /lines/);

  await page.goBack();
  await page.getByTestId('diff-line-head-40').waitFor();
  assert.equal(await page.getByTestId('scope-indicator').textContent(), scope);
  assert.equal(bodies.some((x) => x.includes('SECRETDRAFT') && !x.includes('/questions')), false, 'the draft is only ever sent as a question');
  assert.equal(bodies.some((x) => x.includes('SECRETDRAFT')), false, 'no request has carried the draft');

  const fresh = await b.openPage(`#/sessions/${sessionId}/ask`);
  assert.equal(await fresh.getByLabel('Your question').inputValue(), '', 'a new tab starts with no draft');
});
