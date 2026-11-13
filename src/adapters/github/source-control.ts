// GitHub source-control adapter over REST v3 (research R16, contracts/provider-contracts.md).
// Every call is a GET through the read-only layer (VIII.3); the credential reaches a request only
// through `authorize` (R6). A PR head, including a fork's, is fetched from the base repository's
// `refs/pull/<n>/head` (R10).

import { mapLimited } from '../concurrent.ts';
import { AdapterError, type AdapterDeps, type AdapterDescriptor, type SignInCheck } from '../../contracts/shared.ts';
import type {
  ChangedFileInfo,
  ChangedFileStatus,
  CommitInfo,
  CurrentUser,
  HeadLocation,
  PullRequestInfo,
  RepoRef,
  SourceControlProvider,
} from '../../contracts/source-control.ts';
import type { Anchor, Comment, ReviewCapability, ReviewDecision } from '../../contracts/source-control-writer.ts';

export const GITHUB_ID = 'github';
const API = 'https://api.github.com';
const JSON_TYPE = 'application/vnd.github+json';
const DIFF_TYPE = 'application/vnd.github.diff';
/** Pages followed before the rest is reported as a gap (`truncated`). */
const PAGE_CAP = 10;

export const GITHUB_DESCRIPTOR: AdapterDescriptor = {
  id: GITHUB_ID,
  displayName: 'GitHub',
  signInFields: [{ name: 'secret', label: 'Personal access token', secret: true }],
};

type Json = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Json => (value !== null && typeof value === 'object' ? (value as Json) : {});
const iso = (value: unknown): string => {
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? str(value) : new Date(time).toISOString();
};

/** Sends one authorised GET through the read-only fetch. */
export async function authorisedGet(deps: AdapterDeps, url: string, accept: string): Promise<Response> {
  const request = deps.authorize(new Request(url, { headers: { accept } }));
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return deps.fetch(url, { headers });
}

/** The `rel="next"` URL of a Link header, if any. */
function nextLink(response: Response): string | null {
  const link = response.headers.get('link');
  if (link === null) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

function repoPath(repo: RepoRef): string {
  const [owner, name, ...rest] = repo.id.split('/');
  if (!owner || !name || rest.length > 0) throw new Error(`repository id must be owner/repo: ${repo.id}`);
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function toPullRequest(raw: Json): PullRequestInfo {
  const state = str(raw.state);
  return {
    number: Number(raw.number),
    title: str(raw.title),
    description: str(raw.body),
    author: str(obj(raw.user).login),
    sourceBranch: str(obj(raw.head).ref),
    targetBranch: str(obj(raw.base).ref),
    headCommit: str(obj(raw.head).sha).toLowerCase(),
    state: state === 'open' ? 'open' : raw.merged === true || raw.merged_at ? 'merged' : 'closed',
    updatedAt: iso(raw.updated_at),
  };
}

const STATUS: Record<string, ChangedFileStatus> = {
  added: 'added',
  removed: 'deleted',
  modified: 'modified',
  changed: 'modified',
  unchanged: 'modified',
  renamed: 'renamed',
  copied: 'copied',
};

function toChangedFile(raw: Json): ChangedFileInfo {
  const additions = Number(raw.additions ?? 0);
  const deletions = Number(raw.deletions ?? 0);
  const status = STATUS[str(raw.status)] ?? 'modified';
  const file: ChangedFileInfo = {
    path: str(raw.filename),
    status,
    linesAdded: additions,
    linesRemoved: deletions,
    // GitHub omits `patch` for binary files; a pure rename has no patch either but is not binary.
    binary: raw.patch === undefined && additions === 0 && deletions === 0 && status !== 'renamed' && status !== 'copied',
  };
  if (typeof raw.previous_filename === 'string') file.previousPath = raw.previous_filename;
  return file;
}

function locations(repo: RepoRef, ref: string): HeadLocation {
  const id = repo.id.toLowerCase();
  return { remoteUrls: [`https://github.com/${id}.git`, `git@github.com:${id}.git`], ref };
}

function toComment(raw: Json): Comment {
  const user = obj(raw.user);
  const created = iso(raw.created_at);
  const updated = iso(raw.updated_at);
  const id = String(raw.id);
  const line = raw.line ?? raw.original_line;
  let anchor: Anchor | null = null;
  if (typeof raw.path === 'string' && typeof line === 'number') {
    const start = raw.start_line ?? raw.original_start_line;
    anchor = {
      path: raw.path,
      side: str(raw.side) === 'LEFT' ? 'base' : 'head',
      startLine: typeof start === 'number' ? start : line,
      endLine: line,
      commit: str(raw.commit_id) || str(raw.original_commit_id),
    };
  }
  return {
    id,
    threadId: raw.in_reply_to_id === undefined || raw.in_reply_to_id === null ? id : String(raw.in_reply_to_id),
    author: { id: String(user.id ?? str(user.login)), name: str(user.login) },
    body: str(raw.body),
    createdAt: created,
    editedAt: updated !== created && updated !== '' ? updated : null,
    anchor,
    outdated: anchor !== null && raw.line === null,
    postedByTool: false,
  };
}

const ALLOWED: ReviewCapability[keyof ReviewCapability] = { allowed: true };

export function createGithubSourceControl(deps: AdapterDeps): SourceControlProvider {
  const getJson = async (url: string): Promise<unknown> => (await authorisedGet(deps, url, JSON_TYPE)).json();

  const getPages = async (url: string): Promise<Json[]> => {
    const items: Json[] = [];
    let next: string | null = url;
    for (let page = 0; next !== null; page += 1) {
      if (page === PAGE_CAP) throw new AdapterError('truncated', GITHUB_ID, `${GITHUB_ID}: more than ${PAGE_CAP} pages`);
      const response = await authorisedGet(deps, next, JSON_TYPE);
      const body = await response.json();
      if (Array.isArray(body)) items.push(...(body as Json[]));
      next = nextLink(response);
    }
    return items;
  };

  /** One GET of the signed-in user (no cache): the one place this adapter reads `/user`. */
  const readUser = async (): Promise<CurrentUser> => {
    const user = obj(await getJson(`${API}/user`));
    const handle = str(user.login);
    const name = str(user.name);
    return { handle, displayName: name === '' ? handle : name };
  };

  let me: Promise<string> | undefined;
  const myLogin = (): Promise<string> => (me ??= readUser().then((u) => u.handle.toLowerCase()).catch((error: unknown) => {
    me = undefined; // a failed lookup is not remembered
    throw error;
  }));

  return {
    id: GITHUB_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: (await readUser()).handle };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the token was not accepted (${error.code})` };
        throw error;
      }
    },

    currentUser: readUser,

    cloneLocations: (repo) => [`github.com/${repo.id.toLowerCase()}`],

    repositoryForRemote(remote) {
      const match = /^github\.com\/([^/]+\/[^/]+)$/.exec(remote);
      return match === null ? null : (match[1] ?? null);
    },

    pullRequestUrl: (repo, number) => `https://github.com/${repoPath(repo)}/pull/${number}`,

    async listOpenPullRequests(repo) {
      const raw = await getPages(`${API}/repos/${repoPath(repo)}/pulls?state=open&per_page=100`);
      return raw.map(toPullRequest);
    },

    async approvedByMe(repo, numbers) {
      const login = await myLogin();
      const approvedOne = async (number: number): Promise<boolean> => {
        const reviews = await getPages(`${API}/repos/${repoPath(repo)}/pulls/${number}/reviews?per_page=100`);
        // Reviews arrive oldest first; comments do not change the verdict, so only my last real one counts.
        const mine = reviews.filter((r) => str(obj(r.user).login).toLowerCase() === login && str(r.state) !== 'COMMENTED' && str(r.state) !== 'PENDING');
        return mine.at(-1) !== undefined && str(mine.at(-1)?.state) === 'APPROVED';
      };
      const flags = await mapLimited(numbers, 4, async (number) => {
        try {
          return await approvedOne(number);
        } catch {
          return false; // one PR failing must not hide the others' approvals
        }
      });
      return new Set(numbers.filter((_, i) => flags[i]));
    },

    async listComments(repo, number) {
      const base = `${API}/repos/${repoPath(repo)}`;
      const [review, issue] = await Promise.all([
        getPages(`${base}/pulls/${number}/comments?per_page=100`),
        getPages(`${base}/issues/${number}/comments?per_page=100`),
      ]);
      return [...review, ...issue].map(toComment);
    },

    async myDecision(repo, number): Promise<ReviewDecision | null> {
      const login = await myLogin();
      const reviews = await getPages(`${API}/repos/${repoPath(repo)}/pulls/${number}/reviews?per_page=100`);
      const mine = reviews.filter(
        (r) => str(obj(r.user).login).toLowerCase() === login && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(str(r.state)),
      );
      const last = mine.at(-1);
      if (last === undefined || str(last.state) === 'DISMISSED') return null;
      const message = str(last.body);
      return {
        kind: str(last.state) === 'APPROVED' ? 'approved' : 'changes_requested',
        message: message === '' ? null : message,
        commit: str(last.commit_id).toLowerCase(),
        decidedAt: iso(last.submitted_at),
        stale: false, // core compares `commit` with the current head
        platformId: String(last.id),
      };
    },

    async reviewCapability() {
      // GitHub offers every action; a refusal (forbidden) is the fallback if a token lacks the scope.
      // No merge, close or other action exists here by design.
      return {
        comment: ALLOWED,
        line_comment: ALLOWED,
        reply: ALLOWED,
        edit_comment: ALLOWED,
        delete_comment: ALLOWED,
        approve: ALLOWED,
        request_changes: ALLOWED,
        withdraw_decision: ALLOWED,
      };
    },

    async getPullRequest(repo, number) {
      return toPullRequest(obj(await getJson(`${API}/repos/${repoPath(repo)}/pulls/${number}`)));
    },

    async listCommits(repo, number): Promise<CommitInfo[]> {
      const raw = await getPages(`${API}/repos/${repoPath(repo)}/pulls/${number}/commits?per_page=100`);
      return raw.map((c) => {
        const commit = obj(c.commit);
        const author = obj(commit.author);
        return { sha: str(c.sha).toLowerCase(), message: str(commit.message), author: str(author.name), authoredAt: iso(author.date) };
      });
    },

    async listChangedFiles(repo, number) {
      const raw = await getPages(`${API}/repos/${repoPath(repo)}/pulls/${number}/files?per_page=100`);
      return raw.map(toChangedFile);
    },

    async getUnifiedDiff(repo, number) {
      return (await authorisedGet(deps, `${API}/repos/${repoPath(repo)}/pulls/${number}`, DIFF_TYPE)).text();
    },

    async headLocation(repo, pr) {
      return locations(repo, `refs/pull/${pr.number}/head`);
    },

    async targetLocation(repo, pr) {
      return locations(repo, `refs/heads/${pr.targetBranch}`);
    },
  };
}
