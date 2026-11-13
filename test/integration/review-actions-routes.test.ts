// T013 (specs/005-review-actions, contracts/http.md): the review-actions routes over HTTP, through the
// composed app (src/main.ts, recorded platform, fake AI CLI). Written first (constitution XI): the routes
// arrive in Wave 5, so these fail until then.
//
// Assumed, from contracts/http.md (the spec pins none of it):
//   POST /api/sessions/:sessionId/review-actions   body { action, expectedHead, requestId }
//   GET  /api/sessions/:sessionId/review-actions/comments | /decision
//   errors { error: { code, message, platformMessage? } }; unknown fields -> 400 invalid_body.
//   A PR comment on GitHub is POST https://api.github.com/repos/acme/widgets/issues/2/comments.
//   The route module is src/server/routes/review-actions.ts; the writer (SOURCE_WRITER / writerDeps from
//   src/adapters/registry.ts) is handed to it and to nothing else (FR-006).

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { FixtureEntry } from '../helpers/recorded-fetch.ts';
import { startWorkbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const COMMENT_URL = 'https://api.github.com/repos/acme/widgets/issues/2/comments';
const SRC = new URL('../../src/', import.meta.url).pathname;

const created: FixtureEntry = {
  request: { method: 'POST', url: COMMENT_URL },
  response: { status: 201, body: { id: 9001, body: 'ok', user: { login: 'alice-dev', id: 41001 }, created_at: '2026-03-02T10:00:00Z', updated_at: '2026-03-02T10:00:00Z' } },
};

async function bench(t: { after(fn: () => unknown): void }, extra: FixtureEntry[] = [created]) {
  const b = await startWorkbench(t, { composed: true, extra });
  const detail = await b.startSession(2); // PR 2 is by bob-dev: the signed-in reviewer (alice-dev) is not its author
  const head = (detail.snapshots as Json[]).at(-1)!.headCommit as string;
  const url = `/api/sessions/${detail.sessionId}/review-actions`;
  const body = (action: Json, extraFields: Json = {}): Json => ({ action, expectedHead: head, requestId: randomUUID(), ...extraFields });
  const posts = (): number => b.recorded.requests.filter((r) => r.method === 'POST' && r.host === 'api.github.com').length;
  return { b, url, head, body, posts };
}

const prComment = (text = 'Looks reasonable.'): Json => ({ kind: 'comment', destination: 'pull_request', body: text });

test('the route exists and a well-formed comment is accepted', async (t) => {
  const { b, url, body } = await bench(t);
  const res = await b.client.post(url, body(prComment()));
  assert.equal(res.status, 200, res.text);
  assert.equal(typeof (res.json as Json).record.id, 'string');
});

test('a foreign Origin, or none, is refused before anything is posted (X.5)', async (t) => {
  const { b, url, body, posts } = await bench(t);
  const ok = await b.client.post(url, body(prComment()), undefined);
  assert.notEqual(ok.status, 404, 'the route must exist for this test to mean anything');
  const before = posts();
  for (const origin of ['http://evil.example', `http://localhost:${b.client.port}`, 'null', null]) {
    const res = await b.client.post(url, body(prComment()), { origin });
    assert.equal(res.status, 403, `Origin ${String(origin)}: ${res.text}`);
    assert.equal((res.json as Json).error.code, 'bad_origin');
  }
  assert.equal(posts(), before, 'nothing reached the platform');
});

test('unknown fields are refused, at the top and inside the action, and nothing is posted', async (t) => {
  const { b, url, body, posts } = await bench(t);
  const top = await b.client.post(url, body(prComment(), { extra: 1 }));
  assert.equal(top.status, 400, top.text);
  assert.equal((top.json as Json).error.code, 'invalid_body');
  const inner = await b.client.post(url, body({ ...prComment(), merge: true }));
  assert.equal(inner.status, 400, inner.text);
  assert.equal((inner.json as Json).error.code, 'invalid_body');
  const kind = await b.client.post(url, body({ kind: 'merge' }));
  assert.equal(kind.status, 400, kind.text);
  assert.equal(posts(), 0);
});

test('empty text and a request-changes with no message are invalid_body (FR-004)', async (t) => {
  const { b, url, body, posts } = await bench(t);
  for (const action of [prComment('   '), prComment(''), { kind: 'request_changes', body: '' }, { kind: 'request_changes' }]) {
    const res = await b.client.post(url, body(action));
    assert.equal(res.status, 400, `${JSON.stringify(action)}: ${res.text}`);
    assert.equal((res.json as Json).error.code, 'invalid_body');
  }
  assert.equal(posts(), 0);
});

test('the error body carries the platform reason, and the code maps from the status', async (t) => {
  const reason = 'Resource not accessible by personal access token';
  const denied: FixtureEntry = { request: { method: 'POST', url: COMMENT_URL }, response: { status: 403, body: { message: reason } } };
  const { b, url, body } = await bench(t, [denied]);
  const res = await b.client.post(url, body(prComment()));
  assert.equal(res.status, 403, res.text);
  const error = (res.json as Json).error;
  assert.equal(error.code, 'forbidden');
  assert.equal(typeof error.message, 'string');
  assert.ok(String(error.platformMessage).includes(reason), `platformMessage is the platform's: ${res.text}`);
});

test('a 409 from the platform is conflict with its reason, and an unknown session is 404', async (t) => {
  const reason = 'Pull request is not open';
  const closed: FixtureEntry = { request: { method: 'POST', url: COMMENT_URL }, response: { status: 409, body: { message: reason } } };
  const { b, url, body } = await bench(t, [closed]);
  const res = await b.client.post(url, body(prComment()));
  assert.equal(res.status, 409, res.text);
  assert.equal((res.json as Json).error.code, 'conflict');
  assert.ok(String((res.json as Json).error.platformMessage).includes(reason));
  const missing = await b.client.post('/api/sessions/00000000-0000-4000-8000-000000000000/review-actions', body(prComment()));
  assert.equal(missing.status, 404);
});

test('a head that moved is conflict and posts nothing', async (t) => {
  const { b, url, body, posts } = await bench(t);
  const res = await b.client.post(url, { ...body(prComment()), expectedHead: '0'.repeat(40) });
  assert.equal(res.status, 409, res.text);
  assert.equal((res.json as Json).error.code, 'conflict');
  assert.equal(posts(), 0);
});

test('a repeated requestId posts once', async (t) => {
  const { b, url, body, posts } = await bench(t);
  const first = body(prComment());
  const a = await b.client.post(url, first);
  const again = await b.client.post(url, first);
  assert.equal(a.status, 200, a.text);
  assert.equal(again.status, 200, again.text);
  assert.equal((again.json as Json).record.id, (a.json as Json).record.id);
  assert.equal(posts(), 1);
});

test('there is no route to merge, decline or close (FR-012)', async (t) => {
  const { b, url } = await bench(t);
  for (const path of ['merge', 'decline', 'close']) {
    const res = await b.client.post(`${url}/${path}`, {});
    assert.equal(res.status, 404, `${path}: ${res.text}`);
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('the AI provider, risk and claims paths receive no writer (FR-006)', () => {
  assert.ok(existsSync(join(SRC, 'server/routes/review-actions.ts')), 'the review-actions route module exists');
  const registry = readFileSync(join(SRC, 'adapters/registry.ts'), 'utf8');
  assert.match(registry, /SOURCE_WRITER/, 'the registry has a separate writer map');
  const WRITER = /source-control-writer|SourceControlWriter|SOURCE_WRITER|writerDeps|write-http/;
  const guarded = [
    ...sourceFiles(join(SRC, 'adapters/claude-code-cli')),
    ...sourceFiles(join(SRC, 'core/risk')),
    ...['core/claims.ts', 'core/risk-service.ts', 'core/interrogation.ts', 'core/summaries.ts', 'core/prompt.ts', 'core/evidence.ts', 'adapters/ai-registry.ts', 'server/routes/risk.ts', 'server/routes/interrogation.ts', 'contracts/ai-provider.ts'].map((f) => join(SRC, f)),
  ].filter((f) => existsSync(f));
  assert.ok(guarded.length > 5);
  for (const file of guarded) {
    assert.equal(WRITER.test(readFileSync(file, 'utf8')), false, `${file.slice(SRC.length)} must not reach the writer`);
  }
});
