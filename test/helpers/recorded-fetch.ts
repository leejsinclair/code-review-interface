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
// - `request.headers.accept`, when given, must also match: a platform that picks a representation by
//   media type (a pull request as JSON or as a unified diff) is recorded once per representation.
// - `body` that is a string is sent as-is (for example a unified diff); anything else is sent as JSON,
//   with `content-type: application/json` unless the entry names its own.
// - `"response": { "networkError": "<message>" }` rejects the fetch with a TypeError, as a refused
//   connection does.
// - When several entries share a method and URL (in one file or across files, read in file-name order),
//   they are served in order and the last one repeats; this models "re-fetch succeeds, then fails".
// - Fixtures are recorded with tokens stripped; the replayer never adds or needs credentials.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FixtureRequest = { method?: string; url: string; headers?: { accept?: string } };

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
  const add = (entry: FixtureEntry, source: string): void => {
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
