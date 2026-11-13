// Bitbucket approvedByMe: only the signed-in user's approval counts, matched by account_id or uuid.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBitbucketCloudSourceControl } from '../../src/adapters/bitbucket/source-control.ts';

type Participant = { approved: boolean; state?: string; user: { account_id?: string; uuid?: string } };
const me = { account_id: 'acc-me', uuid: '{ME-UUID}' };
const part = (user: Participant['user'], approved: boolean, state?: string): Participant => ({ approved, ...(state === undefined ? {} : { state }), user });

function adapter(participants: Record<number, Participant[]>, opts: { user?: unknown; failPr?: number } = {}) {
  const urls: string[] = [];
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const deps = {
    authorize: (r: Request) => r,
    fetch: async (url: string) => {
      urls.push(url);
      if (url.endsWith('/user')) return json(opts.user ?? me);
      const number = Number(/pullrequests\/(\d+)$/.exec(url)![1]);
      if (number === opts.failPr) return json({ error: 'boom' }, 500);
      return json({ id: number, participants: participants[number] ?? [] });
    },
  };
  return { sc: createBitbucketCloudSourceControl(deps as never), urls };
}

const repo = { platform: 'bitbucket-cloud', id: 'acme/widgets' } as never;

test('my approval counts; unreviewed and other people\'s approvals do not', async () => {
  const { sc } = adapter({
    1: [part(me, true, 'approved')],
    2: [],
    3: [part({ account_id: 'someone-else' }, true, 'approved')],
    4: [part(me, false)],
  });
  assert.deepEqual([...(await sc.approvedByMe(repo, [1, 2, 3, 4]))], [1]);
});

test('matches by uuid when the participant carries no account_id, case-insensitively', async () => {
  const { sc } = adapter({ 1: [part({ uuid: '{me-uuid}' }, true)] });
  assert.deepEqual([...(await sc.approvedByMe(repo, [1]))], [1]);
});

test('a participant whose state is approved counts', async () => {
  const { sc } = adapter({ 1: [part(me, false, 'approved')] });
  assert.deepEqual([...(await sc.approvedByMe(repo, [1]))], [1]);
});

test('the signed-in user is looked up once however many lists are checked', async () => {
  const { sc, urls } = adapter({ 1: [part(me, true)] });
  await sc.approvedByMe(repo, [1]);
  await sc.approvedByMe(repo, [1]);
  assert.equal(urls.filter((u) => u.endsWith('/user')).length, 1);
});

test('one pull request that cannot be read does not hide the others\' approvals', async (t) => {
  t.mock.method(console, 'warn', () => undefined);
  const { sc } = adapter({ 1: [part(me, true)], 3: [part(me, true)] }, { failPr: 2 });
  assert.deepEqual([...(await sc.approvedByMe(repo, [1, 2, 3]))].sort(), [1, 3]);
});

test('a /user answer with no identity fails loudly instead of approving nothing', async () => {
  const { sc } = adapter({ 1: [part(me, true)] }, { user: {} });
  await assert.rejects(sc.approvedByMe(repo, [1]));
});
