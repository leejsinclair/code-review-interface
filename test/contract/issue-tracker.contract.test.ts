// VO-037 (FR-025), VO-023 and VO-024 (FR-003), VO-025 (FR-004), VO-064 (FR-004, EC-07): one IssueTracker
// suite, run against every tracker adapter over its recorded fixtures, plus the rules particular to
// each tracker's reference forms.
//
// API required from src/adapters/registry.ts (T076):
//
//   export type TrackerSettings = { repository: RepoRef; site?: string; projectKeys?: readonly string[] };
//   export function adapterDeps(platform: PlatformId, network: NetworkFetch, authorize: Authorize): AdapterDeps;
//   export function createIssueTracker(platform: PlatformId, deps: AdapterDeps, settings: TrackerSettings): IssueTracker;
//
// A tracker reads its credential only through `authorize`: when `authorize` adds no Authorization
// header, no credential is stored for it.
//
// Acceptance (FR-003): a candidate is a reference when it does not need confirmation, or when its
// lookup resolves (RawIssueReference.needsConfirmation).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueTracker, RawIssueReference } from '../../src/contracts/issue-tracker.ts';
import type { Authorize } from '../../src/contracts/shared.ts';
import { recordedFetch, type FixtureEntry, type RecordedFetch } from '../helpers/recorded-fetch.ts';

type RegistryModule = typeof import('../../src/adapters/registry.ts');
const loadRegistry = (): Promise<RegistryModule> => import('../../src/adapters/registry.ts');

const REPOSITORY = { platform: 'github', id: 'acme/widgets' };

const withCredential: Authorize = (request) => {
  const headers = new Headers(request.headers);
  headers.set('authorization', 'Basic Y29udHJhY3Q6dGVzdA==');
  return new Request(request, { headers });
};
const noCredential: Authorize = (request) => request;

type Tracker = {
  id: string;
  fixtures: string;
  host: string;
  settings: { site?: string; projectKeys?: string[] };
  account: string;
  /** Text holding one issue written two ways, and the key both normalise to. */
  sameIssue: { text: string; key: string; forms: string[] };
  issue: { key: string; title: string; descriptionText: string };
  wrongKey: string;
  noAccessKey: string;
};

const ADF_TEXT = [
  'Customers cannot reset a password a second time.',
  'Steps',
  '1. Request a reset\n2. Request another reset',
  '- Seen on web and mobile',
  'resetToken.used = true;\nreturn false;',
  'Reported by @Bob Developer.\nSee the runbook (https://wiki.acme.example/reset).',
  '<script>alert(1)</script> is just text.',
].join('\n\n');

const TRACKERS: Tracker[] = [
  {
    id: 'jira-cloud',
    fixtures: 'jira',
    host: 'acme.atlassian.net',
    settings: { site: 'https://acme.atlassian.net', projectKeys: ['ABC'] },
    account: 'Alice Developer',
    sameIssue: { text: 'feature/abc-12-reset fixes ABC-12', key: 'ABC-12', forms: ['abc-12', 'ABC-12'] },
    issue: { key: 'ABC-12', title: 'Customers cannot reset a password twice', descriptionText: ADF_TEXT },
    wrongKey: 'ABC-999',
    noAccessKey: 'ABC-77',
  },
  {
    id: 'github-issues',
    fixtures: 'github',
    host: 'api.github.com',
    settings: {},
    account: 'alice-dev',
    sameIssue: { text: 'Closes #45, see also Acme/Widgets#45', key: 'acme/widgets#45', forms: ['#45', 'Acme/Widgets#45'] },
    issue: {
      key: 'acme/widgets#45',
      title: 'Customers cannot reset a password twice',
      descriptionText: '**Steps**\n\n1. Request a reset\n2. Request another reset\n\n<b>Expected</b>: both work.',
    },
    wrongKey: 'acme/widgets#999',
    noAccessKey: 'acme/secret#7',
  },
];

async function tracker(
  t: Tracker,
  options: { authorize?: Authorize; entries?: FixtureEntry[]; platforms?: string[] } = {},
): Promise<{ tracker: IssueTracker; recorded: RecordedFetch }> {
  const { adapterDeps, createIssueTracker } = await loadRegistry();
  const recorded = recordedFetch(options.platforms ?? [t.fixtures], { entries: options.entries ?? [] });
  const deps = adapterDeps(t.id, recorded.fetch, options.authorize ?? withCredential);
  return { tracker: createIssueTracker(t.id, deps, { repository: REPOSITORY, ...t.settings }), recorded };
}

function only(refs: RawIssueReference[], key: string): RawIssueReference {
  const found = refs.find((r) => r.key === key);
  assert.ok(found, `a reference ${key} in ${JSON.stringify(refs)}`);
  return found;
}

function onlyGets(t: Tracker, recorded: RecordedFetch): void {
  recorded.assertAllRecorded();
  for (const request of recorded.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.host, t.host);
  }
}

// ---------------------------------------------------------------- the shared suite (VO-037)

for (const t of TRACKERS) {
  test(`VO-037 ${t.id}: extractReferences normalises every written form to one key on this tracker`, async () => {
    const { tracker: tr, recorded } = await tracker(t);
    assert.equal(tr.id, t.id);
    const refs = tr.extractReferences(t.sameIssue.text);
    assert.ok(refs.length >= 2, 'each place it is written is found');
    for (const ref of refs) {
      assert.equal(ref.platform, t.id);
      assert.equal(ref.key, t.sameIssue.key);
    }
    assert.deepEqual(refs.map((r) => r.text).sort(), [...t.sameIssue.forms].sort(), 'the written text is kept');
    assert.equal(recorded.requests.length, 0, 'extraction makes no request');
  });

  test(`VO-037 ${t.id}: lookup of an issue returns its title and plain-text description with one GET`, async () => {
    const { tracker: tr, recorded } = await tracker(t);
    const result = await tr.lookup(only(tr.extractReferences(t.sameIssue.text), t.issue.key));
    assert.equal(result.status, 'resolved');
    assert.ok(result.status === 'resolved' && result.kind === 'issue');
    assert.equal(result.title, t.issue.title);
    assert.equal(result.descriptionText, t.issue.descriptionText);
    assert.equal(recorded.requests.length, 1, 'one GET per key');
    onlyGets(t, recorded);
  });

  test(`VO-037 ${t.id}: lookup of a missing issue resolves unresolved with a reason and does not throw`, async () => {
    const { tracker: tr, recorded } = await tracker(t);
    const result = await tr.lookup(only(tr.extractReferences(`see ${t.wrongKey}`), t.wrongKey));
    assert.deepEqual(result, { status: 'unresolved', reason: 'not found' });
    onlyGets(t, recorded);
  });

  test(`VO-037 ${t.id}: verifySignIn checks the credential with one read-only GET`, async () => {
    const { tracker: tr, recorded } = await tracker(t);
    assert.deepEqual(await tr.verifySignIn(), { ok: true, account: t.account });
    assert.equal(recorded.requests.length, 1);
    onlyGets(t, recorded);
  });

  test(`VO-064 ${t.id}: a wrong key and a key without access are each unresolved with their reason`, async () => {
    const { tracker: tr, recorded } = await tracker(t);
    const wrong = await tr.lookup(only(tr.extractReferences(t.wrongKey), t.wrongKey));
    const forbidden = await tr.lookup(only(tr.extractReferences(t.noAccessKey), t.noAccessKey));
    assert.deepEqual(wrong, { status: 'unresolved', reason: 'not found' });
    assert.deepEqual(forbidden, { status: 'unresolved', reason: 'forbidden' });
    onlyGets(t, recorded);
  });
}

// ---------------------------------------------------------------- project-key tracker (VO-023, VO-025)

const JIRA = TRACKERS[0] as Tracker;

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

test('VO-023 jira-cloud: with no project keys configured every key needs confirmation', async () => {
  const { adapterDeps, createIssueTracker } = await loadRegistry();
  const recorded = recordedFetch('jira');
  const tr = createIssueTracker('jira-cloud', adapterDeps('jira-cloud', recorded.fetch, withCredential), {
    repository: REPOSITORY,
    site: 'https://acme.atlassian.net',
    projectKeys: [],
  });
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

const ISSUES = TRACKERS[1] as Tracker;

test('VO-024 github-issues: #123 that is a pull request is a PR reference, owner/repo#45 an issue', async () => {
  const { tracker: tr, recorded } = await tracker(ISSUES);
  const refs = tr.extractReferences('Builds on #123 and fixes acme/widgets#45.');
  const pull = only(refs, 'acme/widgets#123');
  const issue = only(refs, 'acme/widgets#45');
  assert.equal(pull.form, '#123');
  assert.equal(issue.form, 'owner/repo#123');
  assert.ok(!pull.needsConfirmation && !issue.needsConfirmation, 'number forms are always references');
  assert.deepEqual(await tr.lookup(pull), { status: 'resolved', kind: 'pull-request' });
  const looked = await tr.lookup(issue);
  assert.ok(looked.status === 'resolved' && looked.kind === 'issue');
  assert.equal(looked.title, 'Customers cannot reset a password twice');
  onlyGets(ISSUES, recorded);
});

test('VO-024 github-issues: a heading anchor or a word with # is not a reference', async () => {
  const { tracker: tr } = await tracker(ISSUES);
  assert.deepEqual(tr.extractReferences('see README#install and C#7 and https://x.test/a#12'), []);
});
