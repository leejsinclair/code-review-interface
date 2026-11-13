// GitLab (self-managed) source-control adapter over REST v4 (research R3, R4; FR-001 to FR-010).
// The repository id is the project's full path, nested groups included. Every merge request's
// head, a fork's too, is fetched from the base project's `refs/merge-requests/<iid>/head`.

import { mapLimited } from '../concurrent.ts';
import type { AdapterDeps, AdapterDescriptor, SignInCheck } from '../../contracts/shared.ts';
import { AdapterError } from '../../contracts/shared.ts';
import type { Anchor, Comment, ReviewCapability, ReviewDecision } from '../../contracts/source-control-writer.ts';
import type { ChangedFileInfo, ChangedFileStatus, CurrentUser, HeadLocation, PrState, PullRequestInfo, RepoRef, SourceControlProvider } from '../../contracts/source-control.ts';
import type { SourceControlSettings } from '../registry.ts';
import { createGitlabApi, obj, projectSegment, str, type Json } from './api.ts';

export const GITLAB_ID = 'gitlab';

export const GITLAB_DESCRIPTOR: AdapterDescriptor = {
  id: GITLAB_ID,
  displayName: 'GitLab (self-managed)',
  signInFields: [{ name: 'secret', label: 'Personal access token', secret: true }],
  needsBaseUrl: true,
};

const STATE: Record<string, PrState> = { opened: 'open', locked: 'open', closed: 'closed', merged: 'merged' };

// GitLab 19.5 sends a binary file's `diff` as this one line (R4, confirmed live); a pure rename sends ''.
const BINARY = /^Binary files .* differ$/m;

const iso = (value: unknown): string => {
  const time = Date.parse(str(value));
  return Number.isNaN(time) ? str(value) : new Date(time).toISOString();
};

function toPullRequest(raw: Json): PullRequestInfo {
  return {
    number: Number(raw.iid),
    title: str(raw.title),
    description: str(raw.description),
    author: str(obj(raw.author).username),
    sourceBranch: str(raw.source_branch),
    targetBranch: str(raw.target_branch),
    headCommit: str(raw.sha).toLowerCase(),
    state: STATE[str(raw.state)] ?? 'closed',
    updatedAt: iso(raw.updated_at),
  };
}

/** `+` and `-` lines of a diff body, counted from its first hunk. */
function countLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('+')) added += 1;
    else if (inHunk && line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

function toChangedFile(raw: Json): ChangedFileInfo {
  const status: ChangedFileStatus =
    raw.new_file === true ? 'added' : raw.deleted_file === true ? 'deleted' : raw.renamed_file === true ? 'renamed' : 'modified';
  const diff = str(raw.diff);
  const { added, removed } = countLines(diff);
  const file: ChangedFileInfo = {
    path: str(status === 'deleted' ? raw.old_path : raw.new_path),
    status,
    linesAdded: added,
    linesRemoved: removed,
    binary: BINARY.test(diff),
  };
  if (status === 'renamed') file.previousPath = str(raw.old_path);
  return file;
}

const WRITE_ACTIONS = ['comment', 'line_comment', 'reply', 'edit_comment', 'delete_comment', 'approve', 'withdraw_decision'] as const;

/** Version probe (FR-020): no GitLab REST endpoint for request-changes is used here, on any version. */
function requestChangesCapability(version: string): { allowed: boolean; reason?: string } {
  const shown = version === '' ? 'unknown' : version;
  return { allowed: false, reason: `Request changes is not available through GitLab's REST API on version ${shown}.` };
}

/** The anchor of a DiffNote position, or null for a note on the whole merge request. */
function toAnchor(position: unknown): Anchor | null {
  const p = obj(position);
  const newPath = str(p.new_path);
  const oldPath = str(p.old_path);
  if (newPath === '' && oldPath === '') return null;
  const range = obj(p.line_range);
  const lineOf = (end: Json): number => Number(end.new_line ?? end.old_line ?? 0);
  const onHead = p.new_line !== null && p.new_line !== undefined;
  const endLine = Number((onHead ? p.new_line : p.old_line) ?? 0);
  const startLine = range.start === undefined ? endLine : lineOf(obj(range.start));
  return {
    path: onHead ? newPath : oldPath,
    side: onHead ? 'head' : 'base',
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
    commit: str(p.head_sha).toLowerCase(),
  };
}

export function createGitlabSourceControl(
  deps: AdapterDeps,
  settings: SourceControlSettings,
  options: { pageSize?: number } = {},
): SourceControlProvider {
  const baseUrl = settings.baseUrl ?? '';
  const api = createGitlabApi(deps, GITLAB_ID, baseUrl, options.pageSize);
  const locationPrefix = ((): string => {
    try {
      const url = new URL(baseUrl);
      return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch {
      return '';
    }
  })();
  const mr = (repo: RepoRef, number: number): string => `/projects/${projectSegment(repo.id)}/merge_requests/${number}`;

  /** The base project's clone URLs (built by GitLab from its external address) with `ref`. */
  const locations = async (repo: RepoRef, ref: string): Promise<HeadLocation> => {
    const project = obj(await api.json(`/projects/${projectSegment(repo.id)}`));
    return { remoteUrls: [str(project.http_url_to_repo), str(project.ssh_url_to_repo)].filter((url) => url !== ''), ref };
  };

  /** One GET of the signed-in user (no cache): the one place this adapter reads `/user`. */
  const readUser = async (): Promise<CurrentUser> => {
    const user = obj(await api.json('/user'));
    const handle = str(user.username);
    const name = str(user.name);
    return { handle, displayName: name === '' ? handle : name };
  };

  let me: Promise<string> | undefined;
  const myUsername = (): Promise<string> => (me ??= readUser().then((u) => u.handle.toLowerCase()).catch((error: unknown) => {
    me = undefined; // a failed lookup is not remembered
    throw error;
  }));

  /** Head commit of the merge request's newest diff version; '' when none is listed. */
  const latestHead = async (repo: RepoRef, number: number): Promise<string> => {
    const versions = await api.json(`${mr(repo, number)}/versions`);
    const first = Array.isArray(versions) ? obj(versions[0]) : {};
    return str(first.head_commit_sha).toLowerCase();
  };

  return {
    id: GITLAB_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: (await readUser()).handle };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the token was not accepted (${error.code})` };
        throw error;
      }
    },

    currentUser: readUser,

    cloneLocations(repo) {
      return [`${locationPrefix}/${repo.id}`.toLowerCase()];
    },

    // Only this instance's host (and its sub-path, when it has one) is recognised; nested groups stay in the id.
    repositoryForRemote(remote) {
      if (!remote.startsWith(`${locationPrefix.toLowerCase()}/`)) return null;
      const id = remote.slice(locationPrefix.length + 1);
      return id.includes('/') && !id.startsWith('/') && !id.endsWith('/') ? id : null;
    },

    // Nested groups keep their slashes in the web path (unlike the API's encoded project segment).
    pullRequestUrl: (repo, number) => `${baseUrl.replace(/\/+$/, '')}/${repo.id.split('/').map(encodeURIComponent).join('/')}/-/merge_requests/${number}`,

    async listOpenPullRequests(repo) {
      return (await api.pages(`/projects/${projectSegment(repo.id)}/merge_requests?state=opened`)).map(toPullRequest);
    },

    async approvedByMe(repo, numbers) {
      const username = await myUsername();
      const approvedOne = async (number: number): Promise<boolean> => {
        const approvals = obj(await api.json(`${mr(repo, number)}/approvals`));
        const by = Array.isArray(approvals.approved_by) ? (approvals.approved_by as Json[]) : [];
        return by.some((a) => str(obj(a.user).username).toLowerCase() === username);
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

    async getPullRequest(repo, number) {
      return toPullRequest(obj(await api.json(mr(repo, number))));
    },

    async listCommits(repo, number) {
      // GitLab lists newest first; the contract wants oldest first.
      return (await api.pages(`${mr(repo, number)}/commits`)).reverse().map((c) => ({
        sha: str(c.id).toLowerCase(),
        message: str(c.message).replace(/\n+$/, ''),
        author: str(c.author_name),
        authoredAt: iso(c.authored_date),
      }));
    },

    async listChangedFiles(repo, number) {
      return (await api.pages(`${mr(repo, number)}/diffs`)).map(toChangedFile);
    },

    async getUnifiedDiff(repo, number) {
      return (await api.get(`${mr(repo, number)}/raw_diffs`, 'text/plain')).text();
    },

    headLocation: (repo, pr) => locations(repo, `refs/merge-requests/${pr.number}/head`),

    targetLocation: (repo, pr) => locations(repo, `refs/heads/${pr.targetBranch}`),

    async listComments(repo, number) {
      const discussions = await api.pages(`${mr(repo, number)}/discussions`);
      const head = await latestHead(repo, number);
      const comments: Comment[] = [];
      for (const discussion of discussions) {
        const notes = Array.isArray(discussion.notes) ? (discussion.notes as Json[]) : [];
        const threadId = str(discussion.id);
        for (const note of notes) {
          if (note.system === true) continue;
          const author = obj(note.author);
          const anchor = toAnchor(note.position);
          const created = iso(note.created_at);
          const updated = iso(note.updated_at);
          comments.push({
            id: String(note.id),
            threadId,
            author: { id: String(author.id ?? ''), name: str(author.name) === '' ? str(author.username) : str(author.name) },
            body: str(note.body),
            createdAt: created,
            editedAt: updated !== created ? updated : null,
            anchor,
            outdated: anchor !== null && head !== '' && anchor.commit !== head,
            postedByTool: false,
          });
        }
      }
      return comments;
    },

    async myDecision(repo, number): Promise<ReviewDecision | null> {
      const username = await myUsername();
      const approvals = obj(await api.json(`${mr(repo, number)}/approvals`));
      const by = Array.isArray(approvals.approved_by) ? (approvals.approved_by as Json[]) : [];
      if (!by.some((a) => str(obj(a.user).username).toLowerCase() === username)) return null;
      // GitLab records no commit or time on an approval; the current head and the read time stand in.
      const commit = await latestHead(repo, number);
      return { kind: 'approved', message: null, commit, decidedAt: new Date().toISOString(), stale: false, platformId: null };
    },

    async reviewCapability(): Promise<ReviewCapability> {
      let version = '';
      try {
        version = str(obj(await api.json('/version')).version);
      } catch (error) {
        if (!(error instanceof AdapterError)) throw error;
      }
      const allowed = { allowed: true };
      const cap = Object.fromEntries(WRITE_ACTIONS.map((a) => [a, allowed])) as Omit<ReviewCapability, 'request_changes'>;
      return { ...cap, request_changes: requestChangesCapability(version) };
    },
  };
}
