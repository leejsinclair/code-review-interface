// GitHub source-control adapter over REST v3 (research R16, contracts/provider-contracts.md).
// Every call is a GET through the read-only layer (VIII.3); the credential reaches a request only
// through `authorize` (R6). A PR head, including a fork's, is fetched from the base repository's
// `refs/pull/<n>/head` (R10).

import { AdapterError, type AdapterDeps, type AdapterDescriptor, type SignInCheck } from '../../contracts/shared.ts';
import type {
  ChangedFileInfo,
  ChangedFileStatus,
  CommitInfo,
  HeadLocation,
  PullRequestInfo,
  RepoRef,
  SourceControlProvider,
} from '../../contracts/source-control.ts';

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

  return {
    id: GITHUB_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: str(obj(await getJson(`${API}/user`)).login) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the token was not accepted (${error.code})` };
        throw error;
      }
    },

    cloneLocations: (repo) => [`github.com/${repo.id.toLowerCase()}`],

    async listOpenPullRequests(repo) {
      const raw = await getPages(`${API}/repos/${repoPath(repo)}/pulls?state=open&per_page=100`);
      return raw.map(toPullRequest);
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
