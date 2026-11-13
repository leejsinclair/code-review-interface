// Write-aware logged fetch (T001, constitution X.11).
//
// Sibling of `logged-fetch.ts` for suites that exercise the reviewer-action writer. It records every
// request's method and URL (never headers: a request carries a credential) and lets a test assert that
// every non-GET request matched an explicit allowlist of `METHOD /path-pattern` entries.
//
//   const network = loggedWriteFetch(inner);
//   ...
//   network.assertOnlyAllowedWrites([{ method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/comments$/ }]);

import type { FetchLike, LoggedRequest } from './logged-fetch.ts';

export type AllowedWrite = { method: string; pattern: RegExp };

export type LoggedWriteFetch = {
  fetch: FetchLike;
  readonly requests: readonly LoggedRequest[];
  /** Requests that changed state: anything other than GET, HEAD or OPTIONS. */
  readonly writes: readonly LoggedRequest[];
  /** Throws, listing the offenders, when any write did not match an allowlist entry (method and path). */
  assertOnlyAllowedWrites(allowlist: readonly AllowedWrite[]): void;
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function describe(input: string | URL | Request, init?: RequestInit): LoggedRequest {
  const url = input instanceof Request ? input.url : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return { method, url, host: new URL(url).host };
}

export function loggedWriteFetch(inner: FetchLike = globalThis.fetch): LoggedWriteFetch {
  const requests: LoggedRequest[] = [];
  return {
    fetch: (input, init) => {
      requests.push(describe(input, init));
      return inner(input, init);
    },
    requests,
    get writes() {
      return requests.filter((r) => !READ_METHODS.has(r.method));
    },
    assertOnlyAllowedWrites(allowlist) {
      const offenders = this.writes.filter((r) => {
        const path = new URL(r.url).pathname;
        return !allowlist.some((a) => a.method.toUpperCase() === r.method && a.pattern.test(path));
      });
      if (offenders.length > 0) {
        throw new Error(
          `writes outside the allowlist were sent:\n  ${offenders.map((r) => `${r.method} ${r.url}`).join('\n  ')}`,
        );
      }
    },
  };
}
