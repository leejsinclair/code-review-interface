// GitHub approvedByMe: only the signed-in user's latest real review counts, and only when it is APPROVED.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGithubSourceControl } from '../../src/adapters/github/source-control.ts';

type Review = { user: { login: string }; state: string };
const review = (login: string, state: string): Review => ({ user: { login }, state });

function adapter(reviews: Record<number, Review[]>) {
  const urls: string[] = [];
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const deps = {
    authorize: (r: Request) => r,
    fetch: async (url: string) => {
      urls.push(url);
      if (url.endsWith('/user')) return json({ login: 'Alice-Dev' });
      const number = Number(/pulls\/(\d+)\/reviews/.exec(url)![1]);
      return json(reviews[number] ?? []);
    },
  };
  return { sc: createGithubSourceControl(deps as never), urls };
}

const repo = { platform: 'github', id: 'acme/widgets' } as never;

test('approved counts; unreviewed, comment-only and other people\'s approvals do not', async () => {
  const { sc } = adapter({
    1: [review('alice-dev', 'APPROVED')],
    2: [],
    3: [review('alice-dev', 'COMMENTED')],
    4: [review('bob', 'APPROVED')],
  });
  assert.deepEqual([...(await sc.approvedByMe(repo, [1, 2, 3, 4]))], [1]);
});

test('a later change request or dismissal cancels an approval; a later comment does not', async () => {
  const { sc } = adapter({
    1: [review('alice-dev', 'APPROVED'), review('alice-dev', 'CHANGES_REQUESTED')],
    2: [review('alice-dev', 'APPROVED'), review('alice-dev', 'DISMISSED')],
    3: [review('alice-dev', 'APPROVED'), review('alice-dev', 'COMMENTED')],
    4: [review('alice-dev', 'CHANGES_REQUESTED'), review('alice-dev', 'APPROVED')],
  });
  assert.deepEqual([...(await sc.approvedByMe(repo, [1, 2, 3, 4]))].sort(), [3, 4]);
});

test('the signed-in user is looked up once however many lists are checked', async () => {
  const { sc, urls } = adapter({ 1: [review('alice-dev', 'APPROVED')] });
  await sc.approvedByMe(repo, [1]);
  await sc.approvedByMe(repo, [1]);
  assert.equal(urls.filter((u) => u.endsWith('/user')).length, 1);
});

test('one pull request whose reviews cannot be read does not hide the others\' approvals', async () => {
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const sc = createGithubSourceControl({
    authorize: (r: Request) => r,
    fetch: async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice-dev' });
      if (url.includes('/pulls/2/')) return json({ message: 'boom' }, 500);
      return json([review('alice-dev', 'APPROVED')]);
    },
  } as never);
  assert.deepEqual([...(await sc.approvedByMe(repo, [1, 2, 3]))].sort(), [1, 3]);
});

test('a failed sign-in lookup is not remembered: the next call tries again', async () => {
  let userCalls = 0;
  const sc = createGithubSourceControl({
    authorize: (r: Request) => r,
    fetch: async (url: string) => {
      if (url.endsWith('/user')) {
        userCalls += 1;
        if (userCalls === 1) throw new Error('temporarily unavailable');
        return new Response(JSON.stringify({ login: 'alice-dev' }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([review('alice-dev', 'APPROVED')]), { headers: { 'content-type': 'application/json' } });
    },
  } as never);
  await assert.rejects(sc.approvedByMe(repo, [1]));
  assert.deepEqual([...(await sc.approvedByMe(repo, [1]))], [1]);
});
