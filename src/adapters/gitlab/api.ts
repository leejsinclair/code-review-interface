// GitLab REST v4 helpers shared by the source-control adapter and the GitLab Issues tracker
// (research R4). Every call is a GET through the read-only layer, which maps 404 to `not_found`,
// 401/403 to `unauthorized` and 5xx or a network failure to `unavailable` (FR-010). Addresses are
// `<base>/api/v4/...` joined as strings, so a base address with a sub-path keeps it (FR-008).

import { AdapterError, type AdapterDeps, type PlatformId } from '../../contracts/shared.ts';

const JSON_TYPE = 'application/json';
/** Pages followed before the rest is reported as a gap (`truncated`). */
const PAGE_CAP = 10;

export type Json = Record<string, unknown>;

export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
export const obj = (value: unknown): Json => (value !== null && typeof value === 'object' ? (value as Json) : {});

/** A project id as one path segment: `group/sub/project` becomes `group%2Fsub%2Fproject`. */
export const projectSegment = (id: string): string => encodeURIComponent(id);

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

export type GitlabApi = {
  /** Sends one authorised GET for `<base>/api/v4<path>`. */
  get(path: string, accept?: string): Promise<Response>;
  json(path: string): Promise<unknown>;
  /** Every item of a paged list, following `Link: rel="next"`; more than 10 pages throws `truncated`. */
  pages(path: string): Promise<Json[]>;
};

export function createGitlabApi(deps: AdapterDeps, platform: PlatformId, baseUrl: string, pageSize = 100): GitlabApi {
  const root = `${baseUrl.replace(/\/+$/, '')}/api/v4`;

  const send = (url: string, accept: string): Promise<Response> => {
    const request = deps.authorize(new Request(url, { headers: { accept } }));
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return deps.fetch(url, { headers });
  };

  return {
    get: (path, accept = JSON_TYPE) => send(`${root}${path}`, accept),

    json: async (path) => (await send(`${root}${path}`, JSON_TYPE)).json(),

    async pages(path) {
      const items: Json[] = [];
      let next: string | null = `${root}${path}${path.includes('?') ? '&' : '?'}per_page=${pageSize}`;
      for (let page = 0; next !== null; page += 1) {
        if (page === PAGE_CAP) throw new AdapterError('truncated', platform, `${platform}: more than ${PAGE_CAP} pages`);
        // A next link outside the configured address would carry the credential elsewhere.
        if (!next.startsWith(`${root}/`)) throw new AdapterError('unavailable', platform, `${platform}: next page outside the configured address`);
        const response = await send(next, JSON_TYPE);
        const body = await response.json();
        if (Array.isArray(body)) items.push(...(body as Json[]));
        next = nextLink(response);
      }
      return items;
    },
  };
}
