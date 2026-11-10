// T022 (FR-012, FR-013): GitLab Issues reference parsing.
//
// `#12` and `!12` resolve against the configured project; `path#12` and `path!12` name a project
// at any depth of nested group. Keys are lower-cased `path#N` / `path!N`, so an issue and a merge
// request with the same number never collide. A `!` reference is a merge request: it resolves as
// a pull request without any request. Nothing inside a URL, an HTML entity or a word matches.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGitlabIssuesTracker, GITLAB_ISSUES_ID } from '../../src/adapters/gitlab/issues.ts';
import { createReadOnlyFetch } from '../../src/adapters/read-only-http.ts';
import type { IssueTracker } from '../../src/contracts/issue-tracker.ts';
import { loggedFetch, type LoggedFetch } from '../helpers/logged-fetch.ts';

function tracker(): { tr: IssueTracker; network: LoggedFetch } {
  const network = loggedFetch(() => Promise.reject(new Error('no request is expected')));
  const tr = createGitlabIssuesTracker(
    { fetch: createReadOnlyFetch({ platform: GITLAB_ISSUES_ID, fetch: network.fetch }), authorize: (r) => r },
    { site: 'http://localhost:8929', repository: 'Acme/Widgets' },
  );
  return { tr, network };
}

const pick = (tr: IssueTracker, text: string) => tr.extractReferences(text).map(({ key, form, text: t }) => ({ key, form, text: t }));

test('T022 gitlab-issues: issue references in the configured project, a qualified project and a nested group', () => {
  const { tr } = tracker();
  assert.deepEqual(pick(tr, 'Fixes #12, acme/tools#12 and Group/Sub/Project#7.'), [
    { key: 'acme/widgets#12', form: '#123', text: '#12' },
    { key: 'acme/tools#12', form: 'owner/repo#123', text: 'acme/tools#12' },
    { key: 'group/sub/project#7', form: 'owner/repo#123', text: 'Group/Sub/Project#7' },
  ]);
});

test('T022 gitlab-issues: merge-request references in short and qualified form', () => {
  const { tr } = tracker();
  assert.deepEqual(pick(tr, 'Builds on !12 and group/project!3'), [
    { key: 'acme/widgets!12', form: '!123', text: '!12' },
    { key: 'group/project!3', form: 'owner/repo!123', text: 'group/project!3' },
  ]);
});

test('T022 gitlab-issues: #12 and !12 in one text give two keys', () => {
  const { tr } = tracker();
  assert.deepEqual(tr.extractReferences('#12 and !12').map((r) => r.key), ['acme/widgets#12', 'acme/widgets!12']);
});

test('T022 gitlab-issues: a ! reference resolves as a pull request with no request', async () => {
  const { tr, network } = tracker();
  for (const ref of tr.extractReferences('!12 and group/sub/project!4')) {
    assert.deepEqual(await tr.lookup(ref), { status: 'resolved', kind: 'pull-request' });
  }
  assert.equal(network.requests.length, 0);
});

test('T022 gitlab-issues: no match inside a URL, an HTML entity or a word', () => {
  const { tr } = tracker();
  const text = [
    'http://localhost:8929/acme/widgets/-/issues/12#note_3',
    'https://x.test/a#12 and https://x.test/group/project!12',
    '&#12; and &#x21;',
    'C#7, README#install, wow!12, issue#12, a!3',
  ].join('\n');
  assert.deepEqual(tr.extractReferences(text), []);
});
