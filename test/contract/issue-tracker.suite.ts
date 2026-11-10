// The shared IssueTracker contract suite (VO-037, VO-064, VO-024; FR-015, FR-031, SC-001).
//
// One runner, `runIssueTrackerContract(target)`, registers the same cases for every tracker adapter.
// The target supplies the adapter factory, a fresh network per case and every expected value as data:
// constants for fixture targets (recorded responses), seeded values for live targets. The runner never
// branches on platform; differences between trackers live only in `target.expected`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueRefForm, IssueTracker, RawIssueReference } from '../../src/contracts/issue-tracker.ts';
import type { NetworkFetch } from '../../src/adapters/read-only-http.ts';

/** The network one case runs over: `recordedFetch` for fixture targets, `loggedFetch` for live ones. */
export type ContractNetwork = {
  fetch: NetworkFetch;
  /** Every request made through `fetch`, in order. */
  readonly requests: readonly { method: string; host: string }[];
  /** Extra end-of-case check, such as "every request had a recording". */
  check?(): void;
};

export type IssueTrackerTarget = {
  /** Registry id the adapter reports as its `id`. */
  platform: string;
  /** A fresh network for one case. */
  network(): ContractNetwork;
  /** Builds the adapter over `fetch`, with a working credential. */
  create(fetch: NetworkFetch): IssueTracker;
  expected: {
    /** The only host the adapter may call. */
    host: string;
    /** Account name `verifySignIn` reports. */
    account: string;
    /** Text holding one issue written two ways, the key both normalise to and the text as written. */
    sameIssue: { text: string; key: string; forms: string[] };
    /** The issue `sameIssue` refers to. */
    issue: { key: string; title: string; descriptionText: string };
    /** A reference to an issue that does not exist. */
    wrongKey: string;
    /** A reference to an issue the credential cannot see, and the reason the adapter gives. */
    noAccess: { key: string; reason: string };
    /**
     * A text naming a pull request and an issue by number, for trackers whose numbers are shared with
     * pull requests. Omitted for trackers with no such form; the case is then not registered.
     */
    pullRequestRef?: {
      text: string;
      pull: { key: string; form: IssueRefForm };
      issue: { key: string; form: IssueRefForm; title: string };
    };
  };
};

function only(refs: RawIssueReference[], key: string): RawIssueReference {
  const found = refs.find((r) => r.key === key);
  assert.ok(found, `a reference ${key} in ${JSON.stringify(refs)}`);
  return found;
}

function onlyGets(host: string, network: ContractNetwork): void {
  network.check?.();
  for (const request of network.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.host, host);
  }
}

export function runIssueTrackerContract(target: IssueTrackerTarget): void {
  const { platform, expected } = target;
  const open = (): { tracker: IssueTracker; network: ContractNetwork } => {
    const network = target.network();
    return { tracker: target.create(network.fetch), network };
  };

  test(`VO-037 ${platform}: extractReferences normalises every written form to one key on this tracker`, () => {
    const { tracker, network } = open();
    assert.equal(tracker.id, platform);
    const refs = tracker.extractReferences(expected.sameIssue.text);
    assert.ok(refs.length >= 2, 'each place it is written is found');
    for (const ref of refs) {
      assert.equal(ref.platform, platform);
      assert.equal(ref.key, expected.sameIssue.key);
    }
    assert.deepEqual(refs.map((r) => r.text).sort(), [...expected.sameIssue.forms].sort(), 'the written text is kept');
    assert.equal(network.requests.length, 0, 'extraction makes no request');
  });

  test(`VO-037 ${platform}: lookup of an issue returns its title and plain-text description with one GET`, async () => {
    const { tracker, network } = open();
    const result = await tracker.lookup(only(tracker.extractReferences(expected.sameIssue.text), expected.issue.key));
    assert.equal(result.status, 'resolved');
    assert.ok(result.status === 'resolved' && result.kind === 'issue');
    assert.equal(result.title, expected.issue.title);
    assert.equal(result.descriptionText, expected.issue.descriptionText);
    assert.equal(network.requests.length, 1, 'one GET per key');
    onlyGets(expected.host, network);
  });

  test(`VO-037 ${platform}: lookup of a missing issue resolves unresolved with a reason and does not throw`, async () => {
    const { tracker, network } = open();
    const result = await tracker.lookup(only(tracker.extractReferences(`see ${expected.wrongKey}`), expected.wrongKey));
    assert.deepEqual(result, { status: 'unresolved', reason: 'not found' });
    onlyGets(expected.host, network);
  });

  test(`VO-037 ${platform}: verifySignIn checks the credential with one read-only GET`, async () => {
    const { tracker, network } = open();
    assert.deepEqual(await tracker.verifySignIn(), { ok: true, account: expected.account });
    assert.equal(network.requests.length, 1);
    onlyGets(expected.host, network);
  });

  test(`VO-064 ${platform}: a wrong key and a key without access are each unresolved with their reason`, async () => {
    const { tracker, network } = open();
    const wrong = await tracker.lookup(only(tracker.extractReferences(expected.wrongKey), expected.wrongKey));
    const hidden = await tracker.lookup(only(tracker.extractReferences(expected.noAccess.key), expected.noAccess.key));
    assert.deepEqual(wrong, { status: 'unresolved', reason: 'not found' });
    assert.deepEqual(hidden, { status: 'unresolved', reason: expected.noAccess.reason });
    onlyGets(expected.host, network);
  });

  const prRef = expected.pullRequestRef;
  if (prRef !== undefined) {
    test(`VO-024 ${platform}: a number that is a pull request is a PR reference, a qualified number an issue`, async () => {
      const { tracker, network } = open();
      const refs = tracker.extractReferences(prRef.text);
      const pull = only(refs, prRef.pull.key);
      const issue = only(refs, prRef.issue.key);
      assert.equal(pull.form, prRef.pull.form);
      assert.equal(issue.form, prRef.issue.form);
      assert.ok(!pull.needsConfirmation && !issue.needsConfirmation, 'number forms are always references');
      assert.deepEqual(await tracker.lookup(pull), { status: 'resolved', kind: 'pull-request' });
      const looked = await tracker.lookup(issue);
      assert.ok(looked.status === 'resolved' && looked.kind === 'issue');
      assert.equal(looked.title, prRef.issue.title);
      onlyGets(expected.host, network);
    });
  }
}
