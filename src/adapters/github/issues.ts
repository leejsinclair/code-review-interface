// GitHub Issues tracker (research R15, R16). References are `#123` (this repository) and
// `owner/repo#123`; both are expanded to the lower-cased `owner/repo#123` key. Lookup is one GET per
// key; a number that is a pull request resolves as `pull-request` (FR-003). Bodies are kept as plain
// text, never rendered (FR-004).

import type { IssueLookup, IssueTracker, RawIssueReference } from '../../contracts/issue-tracker.ts';
import { AdapterError, type AdapterDeps, type AdapterDescriptor, type SignInCheck } from '../../contracts/shared.ts';
import { authorisedGet } from './source-control.ts';

export const GITHUB_ISSUES_ID = 'github-issues';
const API = 'https://api.github.com';
const JSON_TYPE = 'application/vnd.github+json';

export const GITHUB_ISSUES_DESCRIPTOR: AdapterDescriptor = {
  id: GITHUB_ISSUES_ID,
  displayName: 'GitHub Issues',
  signInFields: [{ name: 'secret', label: 'Personal access token', secret: true }],
  settingsFields: [],
};

export type GithubIssuesSettings = { repository: string };

type Json = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

// `owner/repo#123`, not preceded by anything that would make it part of a URL or a longer word.
const QUALIFIED = /(?<![\w.\/-])([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d+)\b/g;
// `#123`, not preceded by a word character, a slash or another `#`.
const SHORT = /(?<![\w\/#&])#(\d+)\b/g;

/** Reason for a failed lookup, as shown on the issue row. */
export function lookupFailureReason(error: unknown): string {
  if (error instanceof AdapterError) {
    if (error.code === 'not_found') return 'not found';
    if (error.code === 'unauthorized') return 'forbidden';
  }
  return 'tracker unreachable';
}

export function createGithubIssuesTracker(deps: AdapterDeps, settings: GithubIssuesSettings): IssueTracker {
  const home = settings.repository.toLowerCase();

  return {
    id: GITHUB_ISSUES_ID,

    async verifySignIn(): Promise<SignInCheck> {
      try {
        const user = (await (await authorisedGet(deps, `${API}/user`, JSON_TYPE)).json()) as Json;
        return { ok: true, account: str(user.login) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the token was not accepted (${error.code})` };
        throw error;
      }
    },

    extractReferences(text) {
      const found: Array<RawIssueReference & { at: number }> = [];
      for (const m of text.matchAll(QUALIFIED)) {
        found.push({ platform: GITHUB_ISSUES_ID, key: `${(m[1] ?? '').toLowerCase()}#${Number(m[2])}`, form: 'owner/repo#123', text: m[0], at: m.index });
      }
      for (const m of text.matchAll(SHORT)) {
        found.push({ platform: GITHUB_ISSUES_ID, key: `${home}#${Number(m[1])}`, form: '#123', text: m[0], at: m.index });
      }
      return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...ref }) => ref);
    },

    async lookup(ref): Promise<IssueLookup> {
      const match = /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(ref.key);
      if (match === null) return { status: 'unresolved', reason: 'not an issue key' };
      const [owner, name] = (match[1] ?? '').split('/');
      const url = `${API}/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(name ?? '')}/issues/${match[2]}`;
      let issue: Json;
      try {
        issue = (await (await authorisedGet(deps, url, JSON_TYPE)).json()) as Json;
      } catch (error) {
        return { status: 'unresolved', reason: lookupFailureReason(error) };
      }
      if (issue.pull_request !== undefined && issue.pull_request !== null) return { status: 'resolved', kind: 'pull-request' };
      return {
        status: 'resolved',
        kind: 'issue',
        title: str(issue.title),
        descriptionText: str(issue.body).replace(/\r\n?/g, '\n'),
        webUrl: str(issue.html_url),
      };
    },
  };
}
