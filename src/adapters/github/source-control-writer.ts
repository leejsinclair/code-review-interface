// GitHub write side of source control (feature 005, contracts/writer.md). Every request goes through
// the write layer's allowlist (no merge, close or any other endpoint); the credential reaches a
// request only through `authorize`. Reads it needs (own login, own reviews) use the read-only layer.

import { AdapterError, type Authorize } from '../../contracts/shared.ts';
import type { RepoRef } from '../../contracts/source-control.ts';
import type { Anchor, PullRequestRef, SourceControlWriter, WriteOutcome } from '../../contracts/source-control-writer.ts';
import { createReadOnlyFetch, type NetworkFetch } from '../read-only-http.ts';
import { createWriteFetch, type WriteAllow } from '../write-http.ts';
import { authorisedGet, createGithubSourceControl, GITHUB_ID } from './source-control.ts';

const API = 'https://api.github.com';
const JSON_TYPE = 'application/vnd.github+json';
/** Commit reported for a comment on the whole pull request, which GitHub does not tie to a commit. */
const NO_COMMIT = 'pull-request';

const REPO = '/repos/[^/]+/[^/]+';
export const GITHUB_WRITE_ALLOWLIST: readonly WriteAllow[] = [
  { method: 'POST', pattern: new RegExp(`^${REPO}/issues/\\d+/comments$`) },
  { method: 'POST', pattern: new RegExp(`^${REPO}/pulls/\\d+/comments$`) },
  { method: 'POST', pattern: new RegExp(`^${REPO}/pulls/\\d+/comments/\\d+/replies$`) },
  { method: 'PATCH', pattern: new RegExp(`^${REPO}/(pulls|issues)/comments/\\d+$`) },
  { method: 'DELETE', pattern: new RegExp(`^${REPO}/(pulls|issues)/comments/\\d+$`) },
  { method: 'POST', pattern: new RegExp(`^${REPO}/pulls/\\d+/reviews$`) },
  { method: 'PUT', pattern: new RegExp(`^${REPO}/pulls/\\d+/reviews/\\d+/dismissals$`) },
];

type Json = Record<string, unknown>;
type CommentOutcome = Extract<WriteOutcome, { kind: 'comment' }>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Json => (value !== null && typeof value === 'object' ? (value as Json) : {});
const iso = (value: unknown, fallback: () => string): string => {
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? fallback() : new Date(time).toISOString();
};
const now = (): string => new Date().toISOString();

function repoPath(repo: RepoRef): string {
  const [owner, name, ...rest] = repo.id.split('/');
  if (!owner || !name || rest.length > 0) throw new Error(`repository id must be owner/repo: ${repo.id}`);
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function createGithubSourceControlWriter(deps: { fetch: NetworkFetch; authorize: Authorize }): SourceControlWriter {
  const send = createWriteFetch({ platform: GITHUB_ID, fetch: deps.fetch, allowlist: GITHUB_WRITE_ALLOWLIST });
  const read = { fetch: createReadOnlyFetch({ platform: GITHUB_ID, fetch: deps.fetch }), authorize: deps.authorize };
  // Every read the writer needs goes through the read layer, shared with the read side (FR-016).
  const reads = createGithubSourceControl(read);

  const write = async (method: string, url: string, payload?: unknown): Promise<unknown> => {
    const request = deps.authorize(new Request(url, { method, headers: { accept: JSON_TYPE, 'content-type': 'application/json' } }));
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const response = await send(url, payload === undefined ? { method, headers } : { method, headers, body: JSON.stringify(payload) });
    return response.status === 204 ? undefined : response.json();
  };

  const comment = (raw: unknown, threadId?: string): CommentOutcome => {
    const c = obj(raw);
    const outcome: CommentOutcome = {
      kind: 'comment',
      commentId: String(c.id),
      createdAt: iso(c.created_at, now),
      commit: str(c.commit_id) || NO_COMMIT,
    };
    const thread = threadId ?? (typeof c.path === 'string' ? String(c.in_reply_to_id ?? c.id) : undefined);
    if (thread !== undefined) outcome.threadId = thread;
    return outcome;
  };

  const review = async (repo: RepoRef, pr: PullRequestRef, payload: Json, decision: 'approved' | 'changes_requested'): Promise<WriteOutcome> => {
    const r = obj(await write('POST', `${API}/repos/${repoPath(repo)}/pulls/${pr}/reviews`, payload));
    const outcome: WriteOutcome = {
      kind: 'decision',
      decision,
      createdAt: iso(r.submitted_at, now),
      commit: str(r.commit_id) || str(payload.commit_id),
    };
    if (r.id !== undefined) outcome.platformId = String(r.id);
    return outcome;
  };

  /** A comment id is of a review comment or of a pull request comment; try the first, then the other. */
  const onEither = async (repo: RepoRef, id: string, method: 'PATCH' | 'DELETE', payload?: unknown): Promise<unknown> => {
    const base = `${API}/repos/${repoPath(repo)}`;
    const safe = encodeURIComponent(id);
    try {
      return await write(method, `${base}/pulls/comments/${safe}`, payload);
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'not_found') return write(method, `${base}/issues/comments/${safe}`, payload);
      throw error;
    }
  };

  return {
    async postComment(repo, pr, body) {
      return comment(await write('POST', `${API}/repos/${repoPath(repo)}/issues/${pr}/comments`, { body }));
    },

    async postLineComment(repo, pr, anchor: Anchor, body) {
      // Only the pull request's current head counts: lines chosen on an older commit may have moved.
      const head = (await reads.getPullRequest(repo, pr)).headCommit;
      if (head !== anchor.commit.toLowerCase()) {
        throw new AdapterError('conflict', GITHUB_ID, `${GITHUB_ID}: pull request ${pr} has new commits since these lines were chosen`);
      }
      const side = anchor.side === 'head' ? 'RIGHT' : 'LEFT';
      const payload: Json = { body, commit_id: anchor.commit, path: anchor.path, line: anchor.endLine, side };
      if (anchor.endLine > anchor.startLine) {
        payload.start_line = anchor.startLine;
        payload.start_side = side;
      }
      return comment(await write('POST', `${API}/repos/${repoPath(repo)}/pulls/${pr}/comments`, payload));
    },

    async replyToThread(repo, pr, threadId, body) {
      const base = `${API}/repos/${repoPath(repo)}`;
      const safe = encodeURIComponent(threadId);
      const get = async (url: string): Promise<Json> => obj(await (await authorisedGet(read, url, JSON_TYPE)).json());
      try {
        await get(`${base}/pulls/comments/${safe}`);
      } catch (error) {
        if (!(error instanceof AdapterError) || error.code !== 'not_found') throw error;
        // A comment on the whole pull request has no reply: post a new one quoting the original.
        const original = str((await get(`${base}/issues/comments/${safe}`)).body);
        const quote = original.split('\n').map((line) => `> ${line}`).join('\n');
        const posted = comment(await write('POST', `${base}/issues/${pr}/comments`, { body: `${quote}\n\n${body}` }));
        posted.threadId = posted.commentId;
        return posted;
      }
      return comment(await write('POST', `${base}/pulls/${pr}/comments/${safe}/replies`, { body }), threadId);
    },

    async editComment(repo, _pr, commentId, body) {
      return comment(await onEither(repo, commentId, 'PATCH', { body }));
    },

    async deleteComment(repo, _pr, commentId) {
      await onEither(repo, commentId, 'DELETE');
    },

    approve(repo, pr, commit, body) {
      const payload: Json = { commit_id: commit, event: 'APPROVE' };
      if (body !== undefined && body !== '') payload.body = body;
      return review(repo, pr, payload, 'approved');
    },

    requestChanges(repo, pr, commit, body) {
      return review(repo, pr, { commit_id: commit, event: 'REQUEST_CHANGES', body }, 'changes_requested');
    },

    async withdrawDecision(repo, pr) {
      const current = await reads.myDecision(repo, pr);
      if (current === null || current.platformId === null) {
        throw new AdapterError('conflict', GITHUB_ID, `${GITHUB_ID}: there is no decision of yours on pull request ${pr} to withdraw`);
      }
      const url = `${API}/repos/${repoPath(repo)}/pulls/${pr}/reviews/${encodeURIComponent(current.platformId)}/dismissals`;
      const done = obj(await write('PUT', url, { message: 'Withdrawn by the reviewer' }));
      return { kind: 'decision', decision: 'withdrawn', createdAt: now(), commit: str(done.commit_id) || current.commit, platformId: current.platformId };
    },
  };
}
