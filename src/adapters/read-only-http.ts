// The read-only HTTP layer every adapter call goes through (constitution VIII.3, FR-027, VO-039).
// Any method but GET is refused before the network is touched; failures map to neutral AdapterError codes.

import { AdapterError, type PlatformId, type ReadOnlyFetch } from '../contracts/shared.ts';

/** The network fetch the layer wraps; injected so tests replay recorded fixtures. */
export type NetworkFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ReadOnlyFetchOptions = {
  platform: PlatformId;
  fetch: NetworkFetch;
};

/** Thrown when anything other than GET reaches the layer. */
export class ReadOnlyViolationError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`${method} refused: platform access is read-only (GET only)`);
    this.name = 'ReadOnlyViolationError';
    this.method = method;
  }
}

function requestedMethod(input: unknown, init: unknown): string {
  const fromInit = init !== null && typeof init === 'object' ? (init as { method?: unknown }).method : undefined;
  if (typeof fromInit === 'string') return fromInit;
  if (input instanceof Request) return input.method;
  return 'GET';
}

/** Maps a status to an AdapterError code; null for 2xx, which is passed through as is. */
function codeForStatus(status: number): 'unauthorized' | 'not_found' | 'unavailable' | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  // 5xx, and any other status a read cannot use (rate limits, unexpected 4xx), is a gap, not data.
  return 'unavailable';
}

export function createReadOnlyFetch(options: ReadOnlyFetchOptions): ReadOnlyFetch {
  const { platform, fetch: network } = options;

  return async (url, init) => {
    const method = requestedMethod(url, init);
    if (method.toUpperCase() !== 'GET') throw new ReadOnlyViolationError(method);

    const input: unknown = url;
    const target = input instanceof Request ? input.url : String(input);
    const headers = init?.headers;
    let response: Response;
    try {
      response = await network(target, headers === undefined ? { method: 'GET' } : { method: 'GET', headers });
    } catch (cause) {
      throw new AdapterError('unavailable', platform, `${platform}: network request failed`, { cause });
    }

    const code = codeForStatus(response.status);
    if (code !== null) {
      await response.body?.cancel().catch(() => undefined);
      throw new AdapterError(code, platform, `${platform}: HTTP ${response.status}`);
    }
    return response;
  };
}
