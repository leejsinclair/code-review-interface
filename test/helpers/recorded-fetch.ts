// Recorded-fetch replayer (T006, XI.2).
//
// Serves recorded platform responses from `test/fixtures/<platform>/*.json` by method and URL,
// logs every request it is asked to make, and fails on any request with no recording.
//
// Fixture file shape: one entry, or an array of entries.
//
//   {
//     "request":  { "method": "GET", "url": "https://api.example.test/repos/o/r/pulls/1" },
//     "response": { "status": 200, "headers": { "content-type": "application/json" }, "body": { ... } }
//   }
//
// - `method` defaults to GET. URLs match after normalisation (query parameters sorted, fragment dropped).
// - `request.bodyIncludes`, when given, must appear in the request body; such an entry is tried before the plain ones.
// - `request.headers.accept`, when given, must also match: a platform that picks a representation by
//   media type (a pull request as JSON or as a unified diff) is recorded once per representation.
// - `body` that is a string is sent as-is (for example a unified diff); anything else is sent as JSON,
//   with `content-type: application/json` unless the entry names its own.
// - `"response": { "networkError": "<message>" }` rejects the fetch with a TypeError, as a refused
//   connection does.
// - When several entries share a method and URL (in one file or across files, read in file-name order),
//   they are served in order and the last one repeats; this models "re-fetch succeeds, then fails".
// - Fixtures are recorded with tokens stripped; the replayer never adds or needs credentials.
//
// Recording (T036, FR-041, FR-042): `recordingFetch(network, { dir, secrets })` passes requests to the
// real network and saves each request and response here in the shape above, one numbered file per
// request. It keeps only response headers the replay needs, so no cookie or credential header is
// written, and replaces every secret in URLs, headers and bodies with `[redacted]`. It is on when
// `dir` is given or `PRWB_RECORD_FIXTURES` names a directory; otherwise it returns `network` as is.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FixtureRequest = {
  method?: string;
  url: string;
  headers?: { accept?: string };
  /** When given, the request body must also contain this text (platforms that write several things to one URL). */
  bodyIncludes?: string;
};

export type FixtureResponse =
  | { status?: number; statusText?: string; headers?: Record<string, string>; body?: unknown }
  | { networkError: string };

export type FixtureEntry = { request: FixtureRequest; response: FixtureResponse };

export type LoggedRequest = {
  method: string;
  url: string;
  host: string;
  headers: Record<string, string>;
  /** The fixture file that answered, or null when the request was unrecorded. */
  servedFrom: string | null;
};

export type RecordedFetchOptions = {
  /** Directory holding `<platform>/` fixture folders. Defaults to `test/fixtures`. */
  fixturesDir?: string;
  /** Extra entries served after the fixture files, for tests that need a one-off response. */
  entries?: FixtureEntry[];
};

export type RecordedFetch = {
  /** A `fetch`-compatible function: accepts a URL string, URL or Request, and an optional init. */
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Every request made, in order, recorded or not. */
  readonly requests: LoggedRequest[];
  /** The requests that had no recording. Each also rejected its fetch. */
  readonly unrecorded: LoggedRequest[];
  /** Throws, listing them, when any request had no recording (a caller may have swallowed the rejection). */
  assertAllRecorded(): void;
};

export class UnrecordedRequestError extends Error {
  readonly method: string;
  readonly url: string;
  constructor(method: string, url: string) {
    super(`recorded-fetch: no recording for ${method} ${url}`);
    this.name = 'UnrecordedRequestError';
    this.method = method;
    this.url = url;
  }
}

const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

type Recording = { response: FixtureResponse; source: string };

export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.searchParams.sort();
  return parsed.href;
}

function keyOf(method: string, url: string, accept?: string): string {
  const base = `${method.toUpperCase()} ${normaliseUrl(url)}`;
  return accept === undefined ? base : `${base} accept=${accept.toLowerCase()}`;
}

function isEntry(value: unknown): value is FixtureEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { request, response } = value as { request?: unknown; response?: unknown };
  return (
    typeof request === 'object' && request !== null &&
    typeof (request as { url?: unknown }).url === 'string' &&
    typeof response === 'object' && response !== null
  );
}

/** Reads every `*.json` under `<fixturesDir>/<platform>/`, in file-name order. */
export function loadFixtures(platform: string, fixturesDir: string = DEFAULT_FIXTURES_DIR): Array<FixtureEntry & { source: string }> {
  const dir = join(fixturesDir, platform);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const loaded: Array<FixtureEntry & { source: string }> = [];
  for (const name of files) {
    const source = `${platform}/${name}`;
    const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    const list = Array.isArray(parsed) ? parsed : [parsed];
    list.forEach((entry, index) => {
      if (!isEntry(entry)) throw new Error(`recorded-fetch: ${source} entry ${index} is not { request: { url }, response }`);
      loaded.push({ ...entry, source });
    });
  }
  return loaded;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => { out[name] = value; });
  return out;
}

function buildResponse(response: FixtureResponse): Response {
  if ('networkError' in response) throw new TypeError(`fetch failed: ${response.networkError}`);
  const headers = new Headers(response.headers ?? {});
  const status = response.status ?? 200;
  let body: string | null = null;
  if (response.body !== undefined && response.body !== null) {
    if (typeof response.body === 'string') {
      body = response.body;
    } else {
      body = JSON.stringify(response.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  // 204, 205 and 304 may not carry a body.
  if (status === 204 || status === 205 || status === 304) body = null;
  return new Response(body, { status, statusText: response.statusText ?? '', headers });
}

/**
 * Builds a replayer over one or more platforms' fixture folders (`github`, `bitbucket`, `jira`, ...).
 * Pass an empty list with `entries` to replay only inline entries.
 */
export function recordedFetch(platforms: string | string[], options: RecordedFetchOptions = {}): RecordedFetch {
  const fixturesDir = options.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const queues = new Map<string, Recording[]>();
  const bodyMatched: Array<{ key: string; includes: string; recording: Recording }> = [];
  const add = (entry: FixtureEntry, source: string): void => {
    if (entry.request.bodyIncludes !== undefined) {
      bodyMatched.push({
        key: keyOf(entry.request.method ?? 'GET', entry.request.url),
        includes: entry.request.bodyIncludes,
        recording: { response: entry.response, source },
      });
      return;
    }
    const key = keyOf(entry.request.method ?? 'GET', entry.request.url, entry.request.headers?.accept);
    const queue = queues.get(key) ?? [];
    queue.push({ response: entry.response, source });
    queues.set(key, queue);
  };
  for (const platform of typeof platforms === 'string' ? [platforms] : platforms) {
    for (const entry of loadFixtures(platform, fixturesDir)) add(entry, entry.source);
  }
  (options.entries ?? []).forEach((entry, index) => add(entry, `inline#${index}`));

  const requests: LoggedRequest[] = [];
  const unrecorded: LoggedRequest[] = [];

  const replay = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const logged: LoggedRequest = {
      method: request.method.toUpperCase(),
      url: request.url,
      host: new URL(request.url).host,
      headers: headersToRecord(request.headers),
      servedFrom: null,
    };
    requests.push(logged);

    const bodyText = bodyMatched.length > 0 ? await request.clone().text() : '';
    const byBody = bodyMatched.find((m) => m.key === keyOf(logged.method, logged.url) && bodyText.includes(m.includes));
    if (byBody !== undefined) {
      logged.servedFrom = byBody.recording.source;
      return buildResponse(byBody.recording.response);
    }

    const accept = request.headers.get('accept');
    const queue =
      (accept === null ? undefined : queues.get(keyOf(logged.method, logged.url, accept))) ??
      queues.get(keyOf(logged.method, logged.url));
    const recording = queue?.[0];
    if (queue === undefined || recording === undefined) {
      unrecorded.push(logged);
      throw new UnrecordedRequestError(logged.method, logged.url);
    }
    if (queue.length > 1) queue.shift();
    logged.servedFrom = recording.source;
    return buildResponse(recording.response);
  };

  return {
    fetch: replay,
    requests,
    unrecorded,
    assertAllRecorded(): void {
      if (unrecorded.length === 0) return;
      const list = unrecorded.map((r) => `  ${r.method} ${r.url}`).join('\n');
      throw new Error(`recorded-fetch: ${unrecorded.length} unrecorded request(s):\n${list}`);
    },
  };
}

/** Response headers worth replaying: the media type and GitLab's paging headers. Nothing else is kept. */
const RECORDED_HEADERS = ['content-type', 'link', 'x-next-page', 'x-page', 'x-per-page', 'x-prev-page', 'x-total', 'x-total-pages'];

type Network = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function recordingFetch<N extends Network>(network: N, options: { dir?: string; secrets: readonly string[] }): N | Network {
  const dir = options.dir ?? process.env.PRWB_RECORD_FIXTURES;
  if (dir === undefined || dir === '') return network;
  mkdirSync(dir, { recursive: true });
  const secrets = options.secrets.filter((secret) => secret !== '');
  const scrub = (text: string): string => secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
  let count = 0;

  return async (input, init) => {
    const request = new Request(input, init);
    const response = await network(request);
    const text = await response.text();
    const headers: Record<string, string> = {};
    for (const name of RECORDED_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = scrub(value);
    }
    const scrubbed = scrub(text);
    let body: unknown = scrubbed;
    if ((headers['content-type'] ?? '').includes('json') && scrubbed !== '') body = JSON.parse(scrubbed);
    const accept = request.headers.get('accept');
    const entry: FixtureEntry = {
      request: { method: request.method, url: scrub(request.url), ...(accept !== null && accept !== '*/*' ? { headers: { accept } } : {}) },
      response: { status: response.status, headers, body },
    };
    const path = new URL(request.url).pathname.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-80);
    count += 1;
    writeFileSync(join(dir, `${String(count).padStart(4, '0')}-${request.method.toLowerCase()}-${path}.json`), `${JSON.stringify(entry, null, 2)}\n`);
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

/**
 * Names in the multi-repository fixtures (`test/fixtures/github/multi-*.json`, spec 003). The files are
 * picked up with the rest of the folder; these constants say what they contain.
 */
export const MULTI_REPOSITORY = {
  /** Repositories whose open pull requests list normally. */
  repositories: ['acme/gadgets', 'acme/gizmos', 'acme/sprockets'],
  /** A repository whose pull request list answers 500. */
  failing: 'acme/broken',
  /** An issue number that exists in both repositories with different content. */
  sharedIssue: { number: 77, repositories: ['acme/gadgets', 'acme/gizmos'] },
  /** A pull request with 32 changed files. */
  manyFilesPull: { repository: 'acme/gadgets', number: 40, files: 32 },
  /** A pull request and an issue whose text holds HTML and markdown. */
  markupPull: { repository: 'acme/gadgets', number: 41 },
  markupIssue: { repository: 'acme/gadgets', number: 78 },
  /** The fake-AI `answerFixture` whose Evidence claim cites lines 45-50. */
  answerFixture: 'answer-evidence-lines-45-50',
} as const;
