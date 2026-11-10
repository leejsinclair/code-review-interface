// GitLab (self-managed) source-control adapter over REST v4 (research R3, R4; FR-001 to FR-010).
// The repository id is the project's full path, nested groups included. Every merge request's
// head, a fork's too, is fetched from the base project's `refs/merge-requests/<iid>/head`.

import type { AdapterDeps, AdapterDescriptor, SignInCheck } from '../../contracts/shared.ts';
import { AdapterError } from '../../contracts/shared.ts';
import type { ChangedFileInfo, ChangedFileStatus, HeadLocation, PrState, PullRequestInfo, RepoRef, SourceControlProvider } from '../../contracts/source-control.ts';
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

  return {
    id: GITLAB_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: str(obj(await api.json('/user')).username) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the token was not accepted (${error.code})` };
        throw error;
      }
    },

    cloneLocations(repo) {
      return [`${locationPrefix}/${repo.id}`.toLowerCase()];
    },

    // Only this instance's host (and its sub-path, when it has one) is recognised; nested groups stay in the id.
    repositoryForRemote(remote) {
      if (!remote.startsWith(`${locationPrefix.toLowerCase()}/`)) return null;
      const id = remote.slice(locationPrefix.length + 1);
      return id.includes('/') && !id.startsWith('/') && !id.endsWith('/') ? id : null;
    },

    async listOpenPullRequests(repo) {
      return (await api.pages(`/projects/${projectSegment(repo.id)}/merge_requests?state=opened`)).map(toPullRequest);
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
  };
}
