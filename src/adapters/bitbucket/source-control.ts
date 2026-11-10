// Bitbucket Cloud source-control adapter over REST 2.0 (research R16). Signs in with an Atlassian
// account email and API token (Basic); app passwords are not offered (FR-040). Every call is a GET
// through the read-only layer (VIII.3). A PR head is fetched from its source repository, which is the
// fork for a fork PR, at the source branch (R10).

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

export const BITBUCKET_CLOUD_ID = 'bitbucket-cloud';
const API = 'https://api.bitbucket.org/2.0';
const PAGE_CAP = 10;

export const BITBUCKET_CLOUD_DESCRIPTOR: AdapterDescriptor = {
  id: BITBUCKET_CLOUD_ID,
  displayName: 'Bitbucket Cloud',
  signInFields: [
    { name: 'account', label: 'Atlassian account email', secret: false },
    { name: 'secret', label: 'API token', secret: true },
  ],
};

type Json = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Json => (value !== null && typeof value === 'object' ? (value as Json) : {});
const iso = (value: unknown): string => {
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? str(value) : new Date(time).toISOString();
};
const FULL_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

async function authorisedGet(deps: AdapterDeps, url: string, accept: string): Promise<Response> {
  const request = deps.authorize(new Request(url, { headers: { accept } }));
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return deps.fetch(url, { headers });
}

function repoPath(id: string): string {
  const [workspace, slug, ...rest] = id.split('/');
  if (!workspace || !slug || rest.length > 0) throw new Error(`repository id must be workspace/repo: ${id}`);
  return `${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`;
}

const STATE: Record<string, PullRequestInfo['state']> = { OPEN: 'open', MERGED: 'merged', DECLINED: 'closed', SUPERSEDED: 'closed' };

const STATUS: Record<string, ChangedFileStatus> = {
  added: 'added',
  removed: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  'merge conflict': 'modified',
  'remote deleted': 'deleted',
  'local deleted': 'deleted',
};

/** "Name <email>" as git writes it, else the linked user's display name. */
function commitAuthor(raw: Json): string {
  const author = obj(raw.author);
  const name = /^(.*?)\s*<[^>]*>\s*$/.exec(str(author.raw))?.[1];
  return name !== undefined && name !== '' ? name : str(obj(author.user).display_name) || str(author.raw);
}

function locations(fullName: string, ref: string): HeadLocation {
  const id = fullName.toLowerCase();
  return { remoteUrls: [`https://bitbucket.org/${id}.git`, `git@bitbucket.org:${id}.git`], ref };
}

export function createBitbucketCloudSourceControl(deps: AdapterDeps): SourceControlProvider {
  const getJson = async (url: string): Promise<Json> => obj(await (await authorisedGet(deps, url, 'application/json')).json());

  const getPages = async (url: string): Promise<Json[]> => {
    const items: Json[] = [];
    let next: string | null = url;
    for (let page = 0; next !== null; page += 1) {
      if (page === PAGE_CAP) throw new AdapterError('truncated', BITBUCKET_CLOUD_ID, `${BITBUCKET_CLOUD_ID}: more than ${PAGE_CAP} pages`);
      const body = await getJson(next);
      if (Array.isArray(body.values)) items.push(...(body.values as Json[]));
      next = typeof body.next === 'string' ? body.next : null;
    }
    return items;
  };

  const getRawPr = (repo: RepoRef, number: number): Promise<Json> =>
    getJson(`${API}/repositories/${repoPath(repo.id)}/pullrequests/${number}`);

  /** The PR reports an abbreviated head; the commit in its source repository gives the full SHA. */
  const fullHead = async (raw: Json): Promise<string> => {
    const source = obj(raw.source);
    const hash = str(obj(source.commit).hash).toLowerCase();
    if (FULL_SHA.test(hash)) return hash;
    const fullName = str(obj(source.repository).full_name);
    const commit = await getJson(`${API}/repositories/${repoPath(fullName)}/commit/${encodeURIComponent(hash)}`);
    return str(commit.hash).toLowerCase();
  };

  const toPullRequest = (raw: Json, headCommit: string): PullRequestInfo => ({
    number: Number(raw.id),
    title: str(raw.title),
    description: str(raw.description),
    author: str(obj(raw.author).display_name),
    sourceBranch: str(obj(obj(raw.source).branch).name),
    targetBranch: str(obj(obj(raw.destination).branch).name),
    headCommit,
    state: STATE[str(raw.state)] ?? 'closed',
    updatedAt: iso(raw.updated_on),
  });

  return {
    id: BITBUCKET_CLOUD_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: str((await getJson(`${API}/user`)).display_name) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the email and API token were not accepted (${error.code})` };
        throw error;
      }
    },

    cloneLocations: (repo) => [`bitbucket.org/${repo.id.toLowerCase()}`],

    repositoryForRemote(remote) {
      const match = /^bitbucket\.org\/([^/]+\/[^/]+)$/.exec(remote);
      return match === null ? null : (match[1] ?? null);
    },

    async listOpenPullRequests(repo) {
      const raw = await getPages(`${API}/repositories/${repoPath(repo.id)}/pullrequests?state=OPEN&pagelen=50`);
      // simplified: list entries keep the platform's abbreviated head (one lookup per PR otherwise);
      // getPullRequest, which every session uses, resolves the full commit.
      return raw.map((pr) => toPullRequest(pr, str(obj(obj(pr.source).commit).hash).toLowerCase()));
    },

    async getPullRequest(repo, number) {
      const raw = await getRawPr(repo, number);
      return toPullRequest(raw, await fullHead(raw));
    },

    async listCommits(repo, number): Promise<CommitInfo[]> {
      const raw = await getPages(`${API}/repositories/${repoPath(repo.id)}/pullrequests/${number}/commits`);
      // The platform lists newest first; the contract is oldest first.
      return raw
        .map((c) => ({ sha: str(c.hash).toLowerCase(), message: str(c.message), author: commitAuthor(c), authoredAt: iso(c.date) }))
        .reverse();
    },

    async listChangedFiles(repo, number) {
      const raw = await getPages(`${API}/repositories/${repoPath(repo.id)}/pullrequests/${number}/diffstat`);
      return raw.map((d): ChangedFileInfo => {
        const status = STATUS[str(d.status)] ?? 'modified';
        const oldPath = str(obj(d.old).path);
        const newPath = str(obj(d.new).path);
        const file: ChangedFileInfo = {
          path: newPath || oldPath,
          status,
          linesAdded: Number(d.lines_added ?? 0),
          linesRemoved: Number(d.lines_removed ?? 0),
          // simplified: diffstat carries no binary flag; binary files are flagged from the diff text instead.
          binary: false,
        };
        if (status === 'renamed' && oldPath !== '') file.previousPath = oldPath;
        return file;
      });
    },

    async getUnifiedDiff(repo, number) {
      return (await authorisedGet(deps, `${API}/repositories/${repoPath(repo.id)}/pullrequests/${number}/diff`, 'text/plain')).text();
    },

    async headLocation(repo, pr) {
      const raw = await getRawPr(repo, pr.number);
      const fullName = str(obj(obj(raw.source).repository).full_name) || repo.id;
      return locations(fullName, `refs/heads/${pr.sourceBranch}`);
    },

    async targetLocation(repo, pr) {
      return locations(repo.id, `refs/heads/${pr.targetBranch}`);
    },
  };
}
