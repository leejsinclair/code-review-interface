// Bitbucket Cloud source-control adapter over REST 2.0 (research R16). Signs in with an Atlassian
// account email and API token (Basic); app passwords are not offered (FR-040). Every call is a GET
// through the read-only layer (VIII.3). A PR head is fetched from its source repository, which is the
// fork for a fork PR, at the source branch (R10).

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
import type { Comment, ReviewCapability, ReviewDecision } from '../../contracts/source-control-writer.ts';

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
  return { remoteUrls: [`https://bitbucket.org/${id}.git`, `git@bitbucket.org:${id}.git`, `git@ssh.bitbucket.org:${id}.git`], ref };
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

  /** One GET of the signed-in user (no cache): the one place this adapter reads `/user`. */
  const readUser = async (): Promise<CurrentUser & { uuid: string }> => {
    const user = await getJson(`${API}/user`);
    const handle = str(user.account_id);
    const name = str(user.display_name);
    return { handle, displayName: name === '' ? handle : name, uuid: str(user.uuid).toLowerCase() };
  };

  type Me = { accountId: string; uuid: string };
  let me: Promise<Me> | undefined;
  const whoAmI = (): Promise<Me> => (me ??= readUser().then((u) => ({ accountId: u.handle, uuid: u.uuid })).catch((error: unknown) => {
    me = undefined; // a failed lookup is not remembered
    throw error;
  }));

  return {
    id: BITBUCKET_CLOUD_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: str((await readUser()).displayName) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the email and API token were not accepted (${error.code})` };
        throw error;
      }
    },

    async currentUser() {
      const { handle, displayName } = await readUser();
      return { handle, displayName };
    },

    cloneLocations: (repo) => [`bitbucket.org/${repo.id.toLowerCase()}`, `ssh.bitbucket.org/${repo.id.toLowerCase()}`],

    repositoryForRemote(remote) {
      const match = /^(?:ssh\.)?bitbucket\.org\/([^/]+\/[^/]+)$/.exec(remote);
      return match === null ? null : (match[1] ?? null);
    },

    pullRequestUrl: (repo, number) => `https://bitbucket.org/${repoPath(repo.id)}/pull-requests/${number}`,

    async listOpenPullRequests(repo) {
      const raw = await getPages(`${API}/repositories/${repoPath(repo.id)}/pullrequests?state=OPEN&pagelen=50`);
      // simplified: list entries keep the platform's abbreviated head (one lookup per PR otherwise);
      // getPullRequest, which every session uses, resolves the full commit.
      return raw.map((pr) => toPullRequest(pr, str(obj(obj(pr.source).commit).hash).toLowerCase()));
    },

    async approvedByMe(repo, numbers) {
      const mine = await whoAmI();
      if (mine.accountId === '' && mine.uuid === '') throw new AdapterError('unavailable', BITBUCKET_CLOUD_ID, `${BITBUCKET_CLOUD_ID}: /user returned neither an account_id nor a uuid`);
      const isMe = (user: Json): boolean => (mine.accountId !== '' && str(user.account_id) === mine.accountId) || (mine.uuid !== '' && str(user.uuid).toLowerCase() === mine.uuid);
      const approvedOne = async (number: number): Promise<boolean> => {
        const participants = obj(await getRawPr(repo, number)).participants;
        const list = Array.isArray(participants) ? (participants as Json[]) : [];
        return list.some((p) => (p.approved === true || p.state === 'approved') && isMe(obj(p.user)));
      };
      let failures = 0;
      const flags = await mapLimited(numbers, 4, async (number) => {
        try {
          return await approvedOne(number);
        } catch (error) {
          // One PR failing must not hide the others' approvals, but it is not silent either.
          console.warn(`bitbucket: could not read the participants of ${repo.id}#${number}: ${error instanceof Error ? error.message : String(error)}`);
          failures += 1;
          return false;
        }
      });
      // Every lookup failing (a missing scope, rate limiting) is a failed check, not "nothing approved".
      if (numbers.length > 0 && failures === numbers.length) throw new AdapterError('unavailable', BITBUCKET_CLOUD_ID, `${BITBUCKET_CLOUD_ID}: could not read the participants of any pull request`);
      return new Set(numbers.filter((_, i) => flags[i]));
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

    async listComments(repo, number): Promise<Comment[]> {
      const raw = await getPages(`${API}/repositories/${repoPath(repo.id)}/pullrequests/${number}/comments?pagelen=100`);
      const live = raw.filter((c) => c.deleted !== true);
      // Bitbucket pins an inline comment to the diff, not a commit: report the current head.
      const head = live.some((c) => obj(c.inline).path !== undefined) ? (await this.getPullRequest(repo, number)).headCommit : '';
      return live.map((c): Comment => {
        const id = String(c.id);
        const inline = obj(c.inline);
        const created = iso(c.created_on);
        const updated = iso(c.updated_on);
        let anchor: Comment['anchor'] = null;
        if (typeof inline.path === 'string') {
          const side = typeof inline.to === 'number' ? 'head' : 'base';
          const endLine = Number(side === 'head' ? inline.to : inline.from);
          const start = Number(side === 'head' ? inline.start_to : inline.start_from);
          anchor = { path: inline.path, side, startLine: Number.isFinite(start) && start > 0 ? start : endLine, endLine, commit: head };
        }
        const user = obj(c.user);
        return {
          id,
          threadId: c.parent !== undefined ? String(obj(c.parent).id) : id,
          author: { id: str(user.account_id) || str(user.uuid), name: str(user.display_name) },
          body: str(obj(c.content).raw),
          createdAt: created,
          editedAt: updated !== '' && updated !== created ? updated : null,
          anchor,
          outdated: inline.outdated === true,
          postedByTool: false,
        };
      });
    },

    async myDecision(repo, number): Promise<ReviewDecision | null> {
      const mine = await whoAmI();
      const raw = await getRawPr(repo, number);
      const list = Array.isArray(raw.participants) ? (raw.participants as Json[]) : [];
      const entry = list.find((p) => {
        const user = obj(p.user);
        return (mine.accountId !== '' && str(user.account_id) === mine.accountId) || (mine.uuid !== '' && str(user.uuid).toLowerCase() === mine.uuid);
      });
      if (entry === undefined) return null;
      const kind = str(entry.state) === 'changes_requested' ? 'changes_requested' : entry.approved === true || str(entry.state) === 'approved' ? 'approved' : null;
      if (kind === null) return null;
      // The platform does not record which commit a decision was made on: it stands on the current head.
      return { kind, message: null, commit: await fullHead(raw), decidedAt: iso(entry.participated_on), stale: false, platformId: null };
    },

    async reviewCapability(repo, number): Promise<ReviewCapability> {
      const open = str((await getRawPr(repo, number)).state) === 'OPEN';
      const action = open ? { allowed: true } : { allowed: false, reason: 'the pull request is not open' };
      return {
        comment: action,
        line_comment: action,
        reply: action,
        edit_comment: action,
        delete_comment: action,
        approve: action,
        request_changes: action,
        withdraw_decision: action,
      };
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
