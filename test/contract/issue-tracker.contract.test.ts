// VO-037 (FR-025), VO-023 and VO-024 (FR-003), VO-025 (FR-004), VO-064 (FR-004, EC-07): the shared
// IssueTracker suite (`runIssueTrackerContract`, issue-tracker.suite.ts) run against every tracker
// adapter over its recorded fixtures, plus the rules particular to each tracker's reference forms.
//
// Fixture targets build each adapter with its factory directly, over the read-only fetch and
// `recordedFetch`. A tracker reads its credential only through `authorize`: when `authorize` adds no
// Authorization header, no credential is stored for it.
//
// Acceptance (FR-003): a candidate is a reference when it does not need confirmation, or when its
// lookup resolves (RawIssueReference.needsConfirmation).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadOnlyFetch, type NetworkFetch } from '../../src/adapters/read-only-http.ts';
import { createGithubIssuesTracker } from '../../src/adapters/github/issues.ts';
import { createJiraCloudTracker } from '../../src/adapters/jira/issues.ts';
import type { IssueTracker, RawIssueReference } from '../../src/contracts/issue-tracker.ts';
import type { Authorize } from '../../src/contracts/shared.ts';
import { recordedFetch, type FixtureEntry, type RecordedFetch } from '../helpers/recorded-fetch.ts';
import { runIssueTrackerContract, type IssueTrackerTarget } from './issue-tracker.suite.ts';

const withCredential: Authorize = (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', 'Basic Y29udHJhY3Q6dGVzdA==');
  return new Request(request, { headers });
};
const noCredential: Authorize = (request) => request;

const ADF_TEXT = [
  'Customers cannot reset a password a second time.',
  'Steps',
  '1. Request a reset\n2. Request another reset',
  '- Seen on web and mobile',
  'resetToken.used = true;\nreturn false;',
  'Reported by @Bob Developer.\nSee the runbook (https://wiki.acme.example/reset).',
  '<script>alert(1)</script> is just text.',
].join('\n\n');

type FixtureTarget = IssueTrackerTarget & {
  fixtures: string;
  build(fetch: NetworkFetch, authorize: Authorize): IssueTracker;
};

function fixtureTarget(t: Omit<FixtureTarget, 'network' | 'create'>): FixtureTarget {
  return {
    ...t,
    network: () => {
      const recorded = recordedFetch(t.fixtures);
      return { fetch: recorded.fetch, requests: recorded.requests, check: () => recorded.assertAllRecorded() };
    },
    create: (fetch) => t.build(fetch, withCredential),
  };
}

const JIRA = fixtureTarget({
  platform: 'jira-cloud',
  fixtures: 'jira',
  build: (fetch, authorize) =>
    createJiraCloudTracker(
      { fetch: createReadOnlyFetch({ platform: 'jira-cloud', fetch }), authorize },
      { site: 'https://acme.atlassian.net', projectKeys: ['ABC'] },
    ),
  expected: {
    host: 'acme.atlassian.net',
    account: 'Alice Developer',
    sameIssue: { text: 'feature/abc-12-reset fixes ABC-12', key: 'ABC-12', forms: ['abc-12', 'ABC-12'] },
    issue: { key: 'ABC-12', title: 'Customers cannot reset a password twice', descriptionText: ADF_TEXT },
    wrongKey: 'ABC-999',
    noAccess: { key: 'ABC-77', reason: 'forbidden' },
  },
});

const ISSUES = fixtureTarget({
  platform: 'github-issues',
  fixtures: 'github',
  build: (fetch, authorize) =>
    createGithubIssuesTracker(
      { fetch: createReadOnlyFetch({ platform: 'github-issues', fetch }), authorize },
      { repository: 'acme/widgets' },
    ),
  expected: {
    host: 'api.github.com',
    account: 'alice-dev',
    sameIssue: { text: 'Closes #45, see also Acme/Widgets#45', key: 'acme/widgets#45', forms: ['#45', 'Acme/Widgets#45'] },
    issue: {
      key: 'acme/widgets#45',
      title: 'Customers cannot reset a password twice',
      descriptionText: '**Steps**\n\n1. Request a reset\n2. Request another reset\n\n<b>Expected</b>: both work.',
    },
    wrongKey: 'acme/widgets#999',
    noAccess: { key: 'acme/secret#7', reason: 'forbidden' },
    pullRequestRef: {
      text: 'Builds on #123 and fixes acme/widgets#45.',
      pull: { key: 'acme/widgets#123', form: '#123' },
      issue: { key: 'acme/widgets#45', form: 'owner/repo#123', title: 'Customers cannot reset a password twice' },
    },
  },
});

// ---------------------------------------------------------------- the shared suite (VO-037, VO-064, VO-024)

for (const target of [JIRA, ISSUES]) runIssueTrackerContract(target);

// ---------------------------------------------------------------- fixture-only helpers

async function tracker(
  t: FixtureTarget,
  options: { authorize?: Authorize; entries?: FixtureEntry[] } = {},
): Promise<{ tracker: IssueTracker; recorded: RecordedFetch }> {
  const recorded = recordedFetch([t.fixtures], { entries: options.entries ?? [] });
  return { tracker: t.build(recorded.fetch, options.authorize ?? withCredential), recorded };
}

function only(refs: RawIssueReference[], key: string): RawIssueReference {
  const found = refs.find((r) => r.key === key);
  assert.ok(found, `a reference ${key} in ${JSON.stringify(refs)}`);
  return found;
}

function onlyGets(t: FixtureTarget, recorded: RecordedFetch): void {
  recorded.assertAllRecorded();
  for (const request of recorded.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.host, t.expected.host);
  }
}

// ---------------------------------------------------------------- project-key tracker (VO-023, VO-025)

test('VO-023 jira-cloud: a configured key is accepted, an unconfigured key only when lookup confirms it', async () => {
  const { tracker: tr, recorded } = await tracker(JIRA);
  const refs = tr.extractReferences('Fixes ABC-12, depends on XYZ-7, unlike QQQ-1.');
  const configured = only(refs, 'ABC-12');
  const confirmed = only(refs, 'XYZ-7');
  const unknown = only(refs, 'QQQ-1');
  assert.ok(!configured.needsConfirmation, 'a configured project key needs no confirmation');
  assert.equal(confirmed.needsConfirmation, true);
  assert.equal(unknown.needsConfirmation, true);

  const accepted = async (ref: RawIssueReference): Promise<boolean> =>
    !ref.needsConfirmation || (await tr.lookup(ref)).status === 'resolved';
  assert.equal(await accepted(configured), true);
  assert.equal(await accepted(confirmed), true, 'the tracker confirms XYZ-7 exists');
  assert.equal(await accepted(unknown), false, 'the tracker does not know QQQ-1');
  onlyGets(JIRA, recorded);
});

test('VO-023 jira-cloud: with no project keys configured every key needs confirmation', () => {
  const recorded = recordedFetch('jira');
  const tr = createJiraCloudTracker(
    { fetch: createReadOnlyFetch({ platform: 'jira-cloud', fetch: recorded.fetch }), authorize: withCredential },
    { site: 'https://acme.atlassian.net', projectKeys: [] },
  );
  assert.equal(only(tr.extractReferences('ABC-12'), 'ABC-12').needsConfirmation, true);
});

test('VO-025 jira-cloud: a rich-text (ADF) description is returned as plain text', async () => {
  const { tracker: tr } = await tracker(JIRA);
  const result = await tr.lookup(only(tr.extractReferences('ABC-12'), 'ABC-12'));
  assert.ok(result.status === 'resolved' && result.kind === 'issue');
  assert.equal(result.descriptionText, ADF_TEXT);
  assert.ok(!result.descriptionText.includes('"type"'), 'no ADF structure leaks into the text');
});

test('VO-025 jira-cloud: with no credential each issue is unresolved with "no Jira access configured" and no request is sent', async () => {
  const { tracker: tr, recorded } = await tracker(JIRA, { authorize: noCredential });
  for (const key of ['ABC-12', 'ABC-999']) {
    assert.deepEqual(await tr.lookup(only(tr.extractReferences(key), key)), {
      status: 'unresolved',
      reason: 'no Jira access configured',
    });
  }
  assert.equal(recorded.requests.length, 0);
});

test('VO-064 jira-cloud: a tracker failure is unresolved with its reason, not dropped or thrown', async () => {
  const { tracker: tr } = await tracker(JIRA);
  assert.deepEqual(await tr.lookup(only(tr.extractReferences('ABC-88'), 'ABC-88')), {
    status: 'unresolved',
    reason: 'tracker unreachable',
  });
});

// ---------------------------------------------------------------- number-form tracker (VO-024)
// The pull-request-reference case runs in the shared suite from ISSUES.expected.pullRequestRef.

test('VO-024 github-issues: a heading anchor or a word with # is not a reference', async () => {
  const { tracker: tr } = await tracker(ISSUES);
  assert.deepEqual(tr.extractReferences('see README#install and C#7 and https://x.test/a#12'), []);
});
