// T006 (VO-001 to VO-004): the README's Features section matches the demo views, its images exist, and nothing in
// the README contradicts the product (read-only with reviewer actions as the exception, GitLab supported).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { views } from '../demo/scenarios.ts';

const ROOT = new URL('../../', import.meta.url);
const README = readFileSync(new URL('README.md', ROOT), 'utf8');

/** The text under the `## ` heading named `name`, up to the next `## `. */
function section(name: string): string {
  const start = README.indexOf(`\n## ${name}\n`);
  assert.ok(start !== -1, `README has a "${name}" section`);
  const next = README.indexOf('\n## ', start + 1);
  return README.slice(start, next === -1 ? undefined : next);
}

const headings = (): string[] => [...README.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? '');

test('Features is the first section, before Requirements, and the original sections keep their order', () => {
  assert.equal(headings()[0], 'Features');
  assert.deepEqual(
    headings().filter((h) => h !== 'Features'),
    ['Requirements', 'Start', 'Configure', 'Sign in', 'Review focus', 'Specification', 'What the workbench never does', 'Where data lives', 'Development'],
  );
});

test('one Features entry per view, each with a description and its screenshot by relative path with alt text', () => {
  const features = section('Features');
  const entries = features.split('\n### ').slice(1);
  assert.equal(entries.length, views.length);
  for (const view of views) {
    const entry = entries.find((e) => e.includes(`](docs/screenshots/${view.file})`));
    assert.ok(entry !== undefined, `an entry links docs/screenshots/${view.file}`);
    const image = entry.match(/!\[([^\]]*)\]\(docs\/screenshots\/[^)]+\)/);
    assert.ok(image !== null && (image[1] ?? '').trim().length > 0, `${view.file} has alt text`);
    const prose = entry.split('\n').slice(1).filter((l) => l.trim() !== '' && !l.startsWith('!['));
    assert.ok(prose.length > 0, `${view.name} has a description`);
  }
});

test('every linked screenshot exists in the repository', () => {
  for (const [, path] of section('Features').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    assert.ok(path !== undefined && !path.startsWith('/') && !/^[a-z]+:/.test(path), `${path} is relative`);
    assert.ok(existsSync(new URL(path, ROOT)), `${path} exists`);
  }
});

test('no text says the workbench never comments or approves, and reviewer actions are the exception to read-only', () => {
  assert.doesNotMatch(README, /never[^.\n]*\b(approves|comments on)\b/i);
  assert.match(README, /read-only, with one exception: the reviewer actions/);
});

test('GitLab and GitLab Issues sit beside GitHub, Bitbucket Cloud and Jira in the sign-in table', () => {
  const rows = section('Sign in').split('\n').filter((l) => l.startsWith('| ')).map((l) => l.split('|')[1]?.trim() ?? '');
  for (const name of ['GitHub', 'Bitbucket Cloud', 'Jira Cloud', 'GitLab', 'GitLab Issues']) {
    assert.ok(rows.some((r) => r.startsWith(name)), `${name} is in the sign-in table`);
  }
});

test('the review decision entry says GitLab approves and withdraws and shows Request changes as unavailable', () => {
  const entry = section('Features').split('\n### ').find((e) => e.includes('review-decision.png')) ?? '';
  assert.match(entry, /GitLab/);
  assert.match(entry, /withdraw/i);
  assert.match(entry, /Request changes[^.]*unavailable/);
});

test('the Specification section names the branch-name fallback', () => {
  assert.match(section('Specification'), /branch name/i);
  assert.doesNotMatch(section('Specification'), /For each Jira key/);
});

test('Development names the demo seed, clean and screenshot commands', () => {
  const dev = section('Development');
  for (const command of ['npm run gitlab:demo', 'npm run gitlab:demo:clean', 'npm run screenshots']) assert.ok(dev.includes(command), command);
});
