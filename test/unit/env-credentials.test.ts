// VO-044, VO-045 (FR-032, US9): GitHub and GitLab sign in from the environment, so a devcontainer with
// a `.env` file needs no keychain. Bitbucket and Jira are unchanged.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envCredential } from '../../src/adapters/env-credentials.ts';

const parsed = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

test('VO-044 GitHub reads GITHUB_TOKEN, then GH_TOKEN, as a write-scoped bearer token', () => {
  const bearer = (secret: string) => ({ secret, scheme: 'bearer', scope: 'write' });
  assert.deepEqual(parsed(envCredential('github', { GITHUB_TOKEN: 'ghp_a', GH_TOKEN: 'ghp_b' })), bearer('ghp_a'));
  assert.deepEqual(parsed(envCredential('github', { GH_TOKEN: 'ghp_b' })), bearer('ghp_b'));
});

test('VO-044 GitLab reads GITLAB_TOKEN as a write-scoped bearer token', () => {
  assert.deepEqual(parsed(envCredential('gitlab', { GITLAB_TOKEN: 'glpat_a' })), { secret: 'glpat_a', scheme: 'bearer', scope: 'write' });
});

test('VO-044 an empty or unset token is absent', () => {
  assert.equal(envCredential('github', {}), null);
  assert.equal(envCredential('github', { GITHUB_TOKEN: '  ', GH_TOKEN: '' }), null);
  assert.equal(envCredential('gitlab', { GITLAB_TOKEN: '' }), null);
});

test('VO-045 Bitbucket and Jira are unchanged, and a GitHub token does not sign in to them', () => {
  assert.deepEqual(parsed(envCredential('bitbucket-cloud', { BITBUCKET_USERNAME: 'u', BITBUCKET_API_TOKEN: 't' })), {
    account: 'u',
    secret: 't',
    scheme: 'basic',
    scope: 'write',
  });
  assert.deepEqual(parsed(envCredential('jira-cloud', { JIRA_EMAIL: 'e@x.test', JIRA_API_TOKEN: 't' })), {
    account: 'e@x.test',
    secret: 't',
    scheme: 'basic',
    scope: 'write',
  });
  assert.equal(envCredential('bitbucket-cloud', { GITHUB_TOKEN: 'ghp_a' }), null);
});
