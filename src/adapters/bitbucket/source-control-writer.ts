// Bitbucket Cloud review writer (spec 005, T018). Every write goes through the write-only layer with an
// endpoint allowlist; reads it needs (the head commit, my current decision) go through the read adapter.
// No call here merges, declines or closes a pull request (constitution II.1, FR-012).

import { AdapterError, type Authorize, type AdapterDeps } from '../../contracts/shared.ts';
import type { RepoRef } from '../../contracts/source-control.ts';
import type { Anchor, SourceControlWriter, WriteOutcome } from '../../contracts/source-control-writer.ts';
import { createReadOnlyFetch, type NetworkFetch } from '../read-only-http.ts';
import { createWriteFetch, type WriteAllow } from '../write-http.ts';
import { BITBUCKET_CLOUD_ID, createBitbucketCloudSourceControl } from './source-control.ts';

const PR = '/2.0/repositories/[^/]+/[^/]+/pullrequests/\\d+';
const re = (suffix: string): RegExp => new RegExp(`^${PR}${suffix}$`);

/** The only endpoints a Bitbucket write may reach. */
export const BITBUCKET_WRITE_ALLOWLIST: readonly WriteAllow[] = [
  { method: 'POST', pattern: re('/comments') },
  { method: 'PUT', pattern: re('/comments/\\d+') },
  { method: 'DELETE', pattern: re('/comments/\\d+') },
  { method: 'POST', pattern: re('/approve') },
  { method: 'DELETE', pattern: re('/approve') },
  { method: 'POST', pattern: re('/request-changes') },
  { method: 'DELETE', pattern: re('/request-changes') },
];

const API = 'https://api.bitbucket.org/2.0';

type Json = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Json => (value !== null && typeof value === 'object' ? (value as Json) : {});
const iso = (value: unknown): string => {
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
};

function prUrl(repo: RepoRef, pr: number): string {
  const [workspace, slug, ...rest] = repo.id.split('/');
  if (!workspace || !slug || rest.length > 0) throw new Error(`repository id must be workspace/repo: ${repo.id}`);
  return `${API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/pullrequests/${pr}`;
}

function inlineOf(anchor: Anchor): Json {
  // Bitbucket: `to` is a line of the new file (head), `from` a line of the old file (base).
  const key = anchor.side === 'head' ? 'to' : 'from';
  const inline: Json = { path: anchor.path, [key]: anchor.endLine };
  if (anchor.endLine > anchor.startLine) inline[anchor.side === 'head' ? 'start_to' : 'start_from'] = anchor.startLine;
  return inline;
}

export function createBitbucketCloudSourceControlWriter(deps: { fetch: NetworkFetch; authorize: Authorize }): SourceControlWriter {
  const write = createWriteFetch({ platform: BITBUCKET_CLOUD_ID, fetch: deps.fetch, allowlist: BITBUCKET_WRITE_ALLOWLIST });
  const readDeps: AdapterDeps = { fetch: createReadOnlyFetch({ platform: BITBUCKET_CLOUD_ID, fetch: deps.fetch }), authorize: deps.authorize };
  const reads = createBitbucketCloudSourceControl(readDeps);

  const send = async (method: string, url: string, payload?: unknown): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }
    const signed = deps.authorize(new Request(url, init));
    signed.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return write(url, init);
  };

  const readJson = async (response: Response): Promise<Json> => {
    try {
      return obj(await response.json());
    } catch (cause) {
      throw new AdapterError('unavailable', BITBUCKET_CLOUD_ID, `${BITBUCKET_CLOUD_ID}: unreadable response`, { cause });
    }
  };

  const headOf = async (repo: RepoRef, pr: number): Promise<string> => (await reads.getPullRequest(repo, pr)).headCommit;

  const commentOutcome = async (response: Response, commit: string, threadId?: string): Promise<WriteOutcome> => {
    const body = await readJson(response);
    const id = String(body.id);
    return {
      kind: 'comment',
      commentId: id,
      threadId: threadId ?? (body.parent !== undefined ? String(obj(body.parent).id) : id),
      createdAt: iso(body.created_on) || new Date().toISOString(),
      commit,
    };
  };

  const decide = async (
    repo: RepoRef,
    pr: number,
    commit: string,
    endpoint: 'approve' | 'request-changes',
    decision: 'approved' | 'changes_requested',
    message: string | undefined,
  ): Promise<WriteOutcome> => {
    // A decision belongs to the commit the reviewer read: refuse if the head moved since.
    const head = await headOf(repo, pr);
    if (head !== commit.toLowerCase()) {
      throw new AdapterError('conflict', BITBUCKET_CLOUD_ID, `${BITBUCKET_CLOUD_ID}: the pull request head moved to ${head.slice(0, 12)}`);
    }
    // Bitbucket's decision endpoints take no text, so a message is its own pull-request comment, posted first.
    if (message !== undefined && message !== '') await send('POST', `${prUrl(repo, pr)}/comments`, { content: { raw: message } });
    const body = await readJson(await send('POST', `${prUrl(repo, pr)}/${endpoint}`, { commit }));
    return { kind: 'decision', decision, createdAt: iso(body.participated_on) || new Date().toISOString(), commit };
  };

  return {
    async postComment(repo, pr, body) {
      const commit = await headOf(repo, pr);
      return commentOutcome(await send('POST', `${prUrl(repo, pr)}/comments`, { content: { raw: body } }), commit);
    },

    async postLineComment(repo, pr, anchor, body) {
      const payload = { content: { raw: body }, inline: inlineOf(anchor) };
      return commentOutcome(await send('POST', `${prUrl(repo, pr)}/comments`, payload), anchor.commit);
    },

    async replyToThread(repo, pr, threadId, body) {
      const commit = await headOf(repo, pr);
      const payload = { content: { raw: body }, parent: { id: Number(threadId) } };
      return commentOutcome(await send('POST', `${prUrl(repo, pr)}/comments`, payload), commit, threadId);
    },

    async editComment(repo, pr, commentId, body) {
      const commit = await headOf(repo, pr);
      return commentOutcome(await send('PUT', `${prUrl(repo, pr)}/comments/${encodeURIComponent(commentId)}`, { content: { raw: body } }), commit);
    },

    async deleteComment(repo, pr, commentId) {
      await (await send('DELETE', `${prUrl(repo, pr)}/comments/${encodeURIComponent(commentId)}`)).body?.cancel();
    },

    approve: (repo, pr, commit, body) => decide(repo, pr, commit, 'approve', 'approved', body),

    requestChanges: (repo, pr, commit, body) => decide(repo, pr, commit, 'request-changes', 'changes_requested', body),

    async withdrawDecision(repo, pr) {
      const mine = await reads.myDecision(repo, pr);
      if (mine === null) throw new AdapterError('conflict', BITBUCKET_CLOUD_ID, `${BITBUCKET_CLOUD_ID}: there is no decision of yours to withdraw`);
      const endpoint = mine.kind === 'approved' ? 'approve' : 'request-changes';
      await (await send('DELETE', `${prUrl(repo, pr)}/${endpoint}`)).body?.cancel();
      return { kind: 'decision', decision: 'withdrawn', createdAt: new Date().toISOString(), commit: mine.commit };
    },
  };
}
