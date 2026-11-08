// Jira Cloud tracker (research R15, R16, FR-003, FR-004). References are project keys
// (`ABC-12`, matched in any letter case and upper-cased); a key whose project is not configured is a
// reference only when lookup confirms it. Lookup is one GET of
// `/rest/api/3/issue/{key}?fields=summary,description` with Basic email and API token, and the ADF
// description becomes plain text. Without a credential no request is sent and every issue is
// unresolved with `no Jira access configured`.

import type { IssueLookup, IssueTracker, RawIssueReference } from '../../contracts/issue-tracker.ts';
import { AdapterError, type AdapterDeps, type AdapterDescriptor, type SignInCheck } from '../../contracts/shared.ts';
import { adfToText } from './adf.ts';

export const JIRA_CLOUD_ID = 'jira-cloud';
export const NO_JIRA_ACCESS = 'no Jira access configured';

export const JIRA_CLOUD_DESCRIPTOR: AdapterDescriptor = {
  id: JIRA_CLOUD_ID,
  displayName: 'Jira Cloud',
  signInFields: [
    { name: 'account', label: 'Atlassian account email', secret: false },
    { name: 'secret', label: 'API token', secret: true },
  ],
};

export type JiraCloudSettings = { site: string; projectKeys: readonly string[] };

type Json = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]+)-(\d+)(?![A-Za-z0-9])/g;

function reason(error: unknown): string {
  if (error instanceof AdapterError) {
    if (error.code === 'not_found') return 'not found';
    // simplified: the read-only layer maps 401 and 403 alike, so a rejected token also reads as
    // `forbidden` here; when this binds, expose the status on AdapterError and mark the sign-in expired.
    if (error.code === 'unauthorized') return 'forbidden';
  }
  return 'tracker unreachable';
}

export function createJiraCloudTracker(deps: AdapterDeps, settings: JiraCloudSettings): IssueTracker {
  const site = settings.site.replace(/\/+$/, '');
  const configured = new Set(settings.projectKeys.map((k) => k.toUpperCase()));

  /** The authorised request, or null when no credential is stored (authorize adds no header). */
  const authorised = (url: string): Record<string, string> | null => {
    const request = deps.authorize(new Request(url, { headers: { accept: 'application/json' } }));
    if (!request.headers.has('authorization')) return null;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return headers;
  };

  return {
    id: JIRA_CLOUD_ID,

    async verifySignIn(): Promise<SignInCheck> {
      const url = `${site}/rest/api/3/myself`;
      const headers = authorised(url);
      if (headers === null) return { ok: false, reason: NO_JIRA_ACCESS };
      try {
        const me = (await (await deps.fetch(url, { headers })).json()) as Json;
        return { ok: true, account: str(me.displayName) || str(me.emailAddress) };
      } catch (error) {
        if (error instanceof AdapterError) return { ok: false, reason: `the email and API token were not accepted (${error.code})` };
        throw error;
      }
    },

    extractReferences(text) {
      const refs: RawIssueReference[] = [];
      for (const m of text.matchAll(KEY)) {
        const project = (m[1] ?? '').toUpperCase();
        const ref: RawIssueReference = { platform: JIRA_CLOUD_ID, key: `${project}-${Number(m[2])}`, form: 'project-key', text: m[0] };
        if (!configured.has(project)) ref.needsConfirmation = true;
        refs.push(ref);
      }
      return refs;
    },

    async lookup(ref): Promise<IssueLookup> {
      const url = `${site}/rest/api/3/issue/${encodeURIComponent(ref.key)}?fields=summary,description`;
      const headers = authorised(url);
      if (headers === null) return { status: 'unresolved', reason: NO_JIRA_ACCESS };
      let issue: Json;
      try {
        issue = (await (await deps.fetch(url, { headers })).json()) as Json;
      } catch (error) {
        return { status: 'unresolved', reason: reason(error) };
      }
      const fields = (issue.fields ?? {}) as Json;
      return {
        status: 'resolved',
        kind: 'issue',
        title: str(fields.summary),
        descriptionText: adfToText(fields.description),
        webUrl: `${site}/browse/${encodeURIComponent(str(issue.key) || ref.key)}`,
      };
    },
  };
}
