// A small stateful GitHub for the review-action browser tests (feature 005): comments, replies, edits,
// deletes and reviews on PR 1 of acme/widgets, so a comment posted by the product shows up on the next read.
// It answers only the review-action endpoints; everything else falls through to the recorded fixtures.
// Hand-authored from the documented API, like the fixtures under test/fixtures/*/review-actions.

export type FakeComment = {
  id: number;
  body: string;
  user: { login: string; id: number };
  created_at: string;
  updated_at: string;
  path?: string;
  line?: number;
  start_line?: number;
  side?: 'LEFT' | 'RIGHT';
  commit_id?: string;
  in_reply_to_id?: number;
  review: boolean;
};

export type FakeReview = { id: number; user: { login: string; id: number }; state: string; body: string; commit_id: string; submitted_at: string };

export type FakeGithubReviews = {
  /** Pass to the workbench's `intercept`. */
  intercept(url: string, init?: RequestInit): Promise<Response | undefined>;
  comments: FakeComment[];
  reviews: FakeReview[];
  /** Every non-GET request answered, as `METHOD path`. */
  writes: string[];
  /** Fail the next write with this status and message (a refusal), once. */
  failNext(status: number, message: string): void;
};

const BASE = '/repos/acme/widgets';

/** The platform's view of PR 1 as the sandbox's default change: lines 40 to 60 of src/app.js rewritten. */
const APP_DIFF = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -40,21 +40,21 @@',
  ...Array.from({ length: 21 }, (_, i) => `-export const value${40 + i} = ${40 + i};`),
  ...Array.from({ length: 21 }, (_, i) => `+export const value${40 + i} = ${(40 + i) * 10}; // reset ${40 + i}`),
  '',
].join('\n');
const json = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeGithubReviews(options: { reviewer?: string; seed?: FakeComment[] } = {}): FakeGithubReviews {
  const me = { login: options.reviewer ?? 'rita-reviewer', id: 52001 };
  const comments: FakeComment[] = [...(options.seed ?? [])];
  const reviews: FakeReview[] = [];
  const writes: string[] = [];
  let next = 9000;
  let failure: { status: number; message: string } | null = null;
  const stamp = (): string => new Date().toISOString();

  const intercept = async (url: string, init?: RequestInit): Promise<Response | undefined> => {
    const u = new URL(url);
    if (u.host !== 'api.github.com') return undefined;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = u.pathname;
    const accept = new Headers(init?.headers).get('accept') ?? '';
    if (path === `${BASE}/pulls/1` && accept.includes('diff') && (init?.method ?? 'GET').toUpperCase() === 'GET') {
      return new Response(APP_DIFF, { status: 200, headers: { 'content-type': 'text/x-diff' } });
    }
    if (!path.startsWith(`${BASE}/`)) return undefined;
    const rest = path.slice(BASE.length);
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);

    if (method === 'GET') {
      if (rest === '/pulls/1/comments') return json(200, comments.filter((c) => c.review));
      if (rest === '/issues/1/comments') return json(200, comments.filter((c) => !c.review));
      if (rest === '/pulls/1/reviews') return json(200, reviews);
      if (rest === '/pulls/1/files') return json(200, [{ filename: 'src/app.js', status: 'modified', additions: 21, deletions: 21, changes: 42 }]);
      return undefined;
    }
    writes.push(`${method} ${rest}`);
    if (failure !== null) {
      const f = failure;
      failure = null;
      return json(f.status, { message: f.message });
    }
    const add = (c: Omit<FakeComment, 'id' | 'user' | 'created_at' | 'updated_at'>): FakeComment => {
      next += 1;
      const made: FakeComment = { id: next, user: me, created_at: stamp(), updated_at: stamp(), ...c };
      comments.push(made);
      return made;
    };
    let m: RegExpMatchArray | null;
    if (method === 'POST' && rest === '/issues/1/comments') return json(201, add({ body: String(body['body']), review: false }));
    if (method === 'POST' && rest === '/pulls/1/comments') {
      const made = add({
        body: String(body['body']), review: true, path: String(body['path']), line: Number(body['line']),
        side: body['side'] === 'LEFT' ? 'LEFT' : 'RIGHT', commit_id: String(body['commit_id']),
        ...(body['start_line'] === undefined ? {} : { start_line: Number(body['start_line']) }),
      });
      return json(201, made);
    }
    if (method === 'POST' && (m = rest.match(/^\/pulls\/1\/comments\/(\d+)\/replies$/))) {
      const parent = comments.find((c) => c.id === Number(m![1]));
      if (parent === undefined) return json(404, { message: 'Not Found' });
      return json(201, add({ body: String(body['body']), review: true, in_reply_to_id: parent.id, ...(parent.path === undefined ? {} : { path: parent.path }), ...(parent.line === undefined ? {} : { line: parent.line }), ...(parent.side === undefined ? {} : { side: parent.side }) }));
    }
    if ((method === 'PATCH' || method === 'DELETE') && (m = rest.match(/^\/(pulls|issues)\/comments\/(\d+)$/))) {
      const found = comments.find((c) => c.id === Number(m![2]) && c.review === (m![1] === 'pulls'));
      if (found === undefined) return json(404, { message: 'Not Found' });
      if (method === 'DELETE') {
        comments.splice(comments.indexOf(found), 1);
        return new Response(null, { status: 204 });
      }
      found.body = String(body['body']);
      found.updated_at = new Date(Date.now() + 1000).toISOString();
      return json(200, found);
    }
    if (method === 'POST' && rest === '/pulls/1/reviews') {
      next += 1;
      const state = body['event'] === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED';
      const made: FakeReview = { id: next, user: me, state, body: String(body['body'] ?? ''), commit_id: String(body['commit_id']), submitted_at: stamp() };
      reviews.push(made);
      return json(200, made);
    }
    if (method === 'PUT' && (m = rest.match(/^\/pulls\/1\/reviews\/(\d+)\/dismissals$/))) {
      const found = reviews.find((r) => r.id === Number(m![1]));
      if (found === undefined) return json(404, { message: 'Not Found' });
      found.state = 'DISMISSED';
      return json(200, found);
    }
    return json(404, { message: `fake github: no ${method} ${rest}` });
  };

  return { intercept, comments, reviews, writes, failNext: (status, message) => { failure = { status, message }; } };
}
