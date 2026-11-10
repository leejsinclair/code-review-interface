// GitLab Issues tracker (research R5; FR-011 to FR-015). References are `#123` and `!123` (the
// configured project) and `group/sub/project#123` / `group/project!123`. Keys are the lower-cased
// `path#N` or `path!N`, so an issue and a merge request with the same number never collide. A `!`
// reference is a merge request: it resolves as a pull request without a request. Descriptions are
// returned as written (GitLab stores Markdown), never rendered.

import type { IssueLookup, IssueTracker, RawIssueReference } from '../../contracts/issue-tracker.ts';
import { AdapterError, type AdapterDeps, type AdapterDescriptor, type SignInCheck } from '../../contracts/shared.ts';
import { createGitlabApi, obj, projectSegment, str } from './api.ts';

export const GITLAB_ISSUES_ID = 'gitlab-issues';

export const GITLAB_ISSUES_DESCRIPTOR: AdapterDescriptor = {
  id: GITLAB_ISSUES_ID,
  displayName: 'GitLab Issues',
  signInFields: [{ name: 'secret', label: 'Personal access token', secret: true }],
  settingsFields: ['site'],
};

export type GitlabIssuesSettings = { site: string; repository: string };

// `path#123` or `path!123`, the path at any group depth, not inside a URL or a longer word.
const QUALIFIED = /(?<![\w./-])([\w.-]+(?:\/[\w.-]+)+)([#!])(\d+)\b/g;
// `#123` or `!123`, not after a word character, `&` (an HTML entity), a slash, `#` or `!`.
const SHORT = /(?<![\w&/#!])([#!])(\d+)\b/g;

function lookupFailureReason(error: unknown): string {
  if (error instanceof AdapterError) {
    if (error.code === 'not_found') return 'not found';
    if (error.code === 'unauthorized') return 'forbidden';
  }
  return 'tracker unreachable';
}

export function createGitlabIssuesTracker(deps: AdapterDeps, settings: GitlabIssuesSettings): IssueTracker {
  const api = createGitlabApi(deps, GITLAB_ISSUES_ID, settings.site);
  const home = settings.repository.toLowerCase();

  const reference = (path: string, sign: string, number: string, text: string, qualified: boolean): RawIssueReference => ({
    platform: GITLAB_ISSUES_ID,
    key: `${path.toLowerCase()}${sign}${Number(number)}`,
    form: sign === '!' ? (qualified ? 'owner/repo!123' : '!123') : qualified ? 'owner/repo#123' : '#123',
    text,
  });

  return {
    id: GITLAB_ISSUES_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        return { ok: true, account: str(obj(await api.json('/user')).username) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the token was not accepted (${error.code})` };
        throw error;
      }
    },

    extractReferences(text) {
      const found: Array<RawIssueReference & { at: number }> = [];
      for (const m of text.matchAll(QUALIFIED)) found.push({ ...reference(m[1] ?? '', m[2] ?? '', m[3] ?? '', m[0], true), at: m.index });
      for (const m of text.matchAll(SHORT)) found.push({ ...reference(home, m[1] ?? '', m[2] ?? '', m[0], false), at: m.index });
      return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...ref }) => ref);
    },

    async lookup(ref): Promise<IssueLookup> {
      const match = /^(\S+\/\S+?)([#!])(\d+)$/.exec(ref.key);
      if (match === null) return { status: 'unresolved', reason: 'not an issue key' };
      if (match[2] === '!') return { status: 'resolved', kind: 'pull-request' };
      let issue: Record<string, unknown>;
      try {
        issue = obj(await api.json(`/projects/${projectSegment(match[1] ?? '')}/issues/${match[3]}`));
      } catch (error) {
        return { status: 'unresolved', reason: lookupFailureReason(error) };
      }
      return {
        status: 'resolved',
        kind: 'issue',
        title: str(issue.title),
        descriptionText: str(issue.description).replace(/\r\n?/g, '\n'),
        webUrl: str(issue.web_url),
      };
    },
  };
}
