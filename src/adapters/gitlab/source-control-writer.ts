// GitLab review writes over REST v4 (feature 005, FR-001 to FR-012, FR-020). Every write goes through
// the allowlisted write layer (X.11); nothing here merges, closes or declines a merge request.
// Approve and withdraw answer without a time, so those are stamped from the clock. GitLab's REST API
// has no request-changes endpoint this adapter uses, so `requestChanges` refuses (the read side's
// reviewCapability says why, by version).

import { createHash } from 'node:crypto';
import type { Authorize } from '../../contracts/shared.ts';
import { AdapterError } from '../../contracts/shared.ts';
import type { RepoRef } from '../../contracts/source-control.ts';
import type { Anchor, SourceControlWriter, WriteOutcome } from '../../contracts/source-control-writer.ts';
import type { SourceControlSettings } from '../registry.ts';
import { createReadOnlyFetch, type NetworkFetch } from '../read-only-http.ts';
import { createWriteFetch, type WriteAllow } from '../write-http.ts';
import { obj, projectSegment, str, type Json } from './api.ts';

const PLATFORM = 'gitlab';
const MR = String.raw`^(?:\/.*)?\/api\/v4\/projects\/[^/]+\/merge_requests\/\d+`;

export const GITLAB_WRITE_ALLOWLIST: readonly WriteAllow[] = [
  { method: 'POST', pattern: new RegExp(`${MR}\\/notes$`) },
  { method: 'POST', pattern: new RegExp(`${MR}\\/discussions$`) },
  { method: 'POST', pattern: new RegExp(`${MR}\\/discussions\\/[^/]+\\/notes$`) },
  { method: 'PUT', pattern: new RegExp(`${MR}\\/notes\\/\\d+$`) },
  { method: 'DELETE', pattern: new RegExp(`${MR}\\/notes\\/\\d+$`) },
  { method: 'POST', pattern: new RegExp(`${MR}\\/approve$`) },
  { method: 'POST', pattern: new RegExp(`${MR}\\/unapprove$`) },
];

type Deps = { fetch: NetworkFetch; authorize: Authorize };

const iso = (value: unknown): string => {
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? str(value) : new Date(time).toISOString();
};

export function createGitlabSourceControlWriter(deps: Deps, settings: SourceControlSettings): SourceControlWriter {
  const root = `${(settings.baseUrl ?? '').replace(/\/+$/, '')}/api/v4`;
  const mr = (repo: RepoRef, pr: number): string => `${root}/projects/${projectSegment(repo.id)}/merge_requests/${pr}`;

  const authorized: NetworkFetch = (input, init) => {
    const request = deps.authorize(new Request(input, init));
    return deps.fetch(request);
  };
  const write = createWriteFetch({ platform: PLATFORM, fetch: authorized, allowlist: GITLAB_WRITE_ALLOWLIST });
  const send = async (method: string, url: string, body?: unknown): Promise<unknown> => {
    const init: { method: string; headers?: Record<string, string>; body?: string } = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json', accept: 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await write(url, init);
    return response.status === 204 ? null : response.json().catch(() => null);
  };

  // Every read goes through the read layer (FR-016), so inside a request scope it shares one network read
  // with the read side. The credential rides in the headers, as the read side sends it, so both share a key.
  const read = createReadOnlyFetch({ platform: PLATFORM, fetch: deps.fetch });
  const readJson = async (url: string): Promise<unknown> => {
    const signed = deps.authorize(new Request(url, { headers: { accept: 'application/json' } }));
    const headers: Record<string, string> = {};
    signed.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return (await read(url, { headers })).json();
  };

  type Version = { head: string; base: string; start: string };
  const versions = async (repo: RepoRef, pr: number): Promise<Version[]> => {
    const list = await readJson(`${mr(repo, pr)}/versions`);
    return (Array.isArray(list) ? (list as Json[]) : []).map((v) => ({
      head: str(v.head_commit_sha).toLowerCase(),
      base: str(v.base_commit_sha),
      start: str(v.start_commit_sha),
    }));
  };
  // GitLab lists the newest diff version first; only it is the merge request's current head.
  const latestHead = async (repo: RepoRef, pr: number): Promise<string> => (await versions(repo, pr))[0]?.head ?? '';

  /** True when the signed-in account has approved the merge request. */
  const hasApproved = async (repo: RepoRef, pr: number): Promise<boolean> => {
    const me = str(obj(await readJson(`${root}/user`)).username).toLowerCase();
    const approvals = obj(await readJson(`${mr(repo, pr)}/approvals`));
    const by = Array.isArray(approvals.approved_by) ? (approvals.approved_by as Json[]) : [];
    return me !== '' && by.some((a) => str(obj(a.user).username).toLowerCase() === me);
  };

  const noteOutcome = async (note: Json, threadId: string | undefined, fallbackCommit: () => Promise<string>): Promise<WriteOutcome> => {
    const sha = str(obj(note.position).head_sha).toLowerCase();
    const out: WriteOutcome = {
      kind: 'comment',
      commentId: String(note.id),
      createdAt: iso(note.created_at),
      commit: sha !== '' ? sha : await fallbackCommit(),
    };
    if (threadId !== undefined) out.threadId = threadId;
    return out;
  };

  const lineCode = (path: string, line: number): string => `${createHash('sha1').update(path).digest('hex')}_${line}_${line}`;

  return {
    async postComment(repo, pr, body) {
      const note = obj(await send('POST', `${mr(repo, pr)}/notes`, { body }));
      return noteOutcome(note, undefined, () => latestHead(repo, pr));
    },

    async postLineComment(repo, pr, anchor: Anchor, body) {
      const version = (await versions(repo, pr))[0];
      if (version === undefined || version.head !== anchor.commit.toLowerCase()) {
        throw new AdapterError('conflict', PLATFORM, `${PLATFORM}: the merge request has moved on from commit ${anchor.commit}`);
      }
      const side = anchor.side === 'head' ? 'new' : 'old';
      const lineKey = `${side}_line`;
      const position: Json = {
        position_type: 'text',
        base_sha: version.base,
        start_sha: version.start,
        head_sha: version.head,
        old_path: anchor.path,
        new_path: anchor.path,
        [lineKey]: anchor.endLine,
      };
      if (anchor.endLine > anchor.startLine) {
        const end = (line: number): Json => ({ line_code: lineCode(anchor.path, line), type: side, [lineKey]: line });
        position.line_range = { start: end(anchor.startLine), end: end(anchor.endLine) };
      }
      const discussion = obj(await send('POST', `${mr(repo, pr)}/discussions`, { body, position }));
      const notes = Array.isArray(discussion.notes) ? (discussion.notes as Json[]) : [];
      return noteOutcome(obj(notes[0]), str(discussion.id), async () => anchor.commit);
    },

    async replyToThread(repo, pr, threadId, body) {
      const note = obj(await send('POST', `${mr(repo, pr)}/discussions/${encodeURIComponent(threadId)}/notes`, { body }));
      return noteOutcome(note, threadId, () => latestHead(repo, pr));
    },

    async editComment(repo, pr, commentId, body) {
      const note = obj(await send('PUT', `${mr(repo, pr)}/notes/${encodeURIComponent(commentId)}`, { body }));
      return noteOutcome(note, undefined, () => latestHead(repo, pr));
    },

    async deleteComment(repo, pr, commentId) {
      await send('DELETE', `${mr(repo, pr)}/notes/${encodeURIComponent(commentId)}`);
    },

    async approve(repo, pr, commit, body) {
      await send('POST', `${mr(repo, pr)}/approve`, { sha: commit });
      const createdAt = new Date().toISOString();
      const outcome: WriteOutcome = { kind: 'decision', decision: 'approved', createdAt, commit };
      // GitLab's approval carries no message; a given one is kept as a note, written after the decision.
      // A note that fails leaves the approval made and is reported on the outcome, never thrown.
      if (body !== undefined && body !== '') {
        try {
          const note = obj(await send('POST', `${mr(repo, pr)}/notes`, { body }));
          outcome.message = { posted: true, commentId: String(note.id) };
        } catch (error) {
          outcome.message = { posted: false, reason: error instanceof Error ? error.message : 'the message could not be posted' };
        }
      }
      return outcome;
    },

    async requestChanges() {
      throw new AdapterError('rejected', PLATFORM, `${PLATFORM}: request changes is not available through GitLab's REST API`);
    },

    async withdrawDecision(repo, pr) {
      if (!(await hasApproved(repo, pr))) throw new AdapterError('conflict', PLATFORM, `${PLATFORM}: there is no approval of yours to withdraw`);
      await send('POST', `${mr(repo, pr)}/unapprove`);
      return { kind: 'decision', decision: 'withdrawn', createdAt: new Date().toISOString(), commit: await latestHead(repo, pr) };
    },
  };
}
