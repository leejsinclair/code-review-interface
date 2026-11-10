// Logged fetch (T014, SC-005, FR-021).
//
// Wraps the real `fetch` (or any fetch-compatible function) and records each request's method, URL and
// host before sending it, so live suites can assert that every product request was a GET. Headers are
// never recorded: a live request carries a real credential.
//
//   const network = loggedFetch();
//   const deps = { fetch: createReadOnlyFetch({ platform, fetch: network.fetch }), authorize };
//   ...
//   network.assertOnlyGets();

export type LoggedRequest = { method: string; url: string; host: string };

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type LoggedFetch = {
  /** A `fetch`-compatible function that logs, then forwards to the wrapped fetch. */
  fetch: FetchLike;
  /** Every request made, in order, including any whose fetch rejected. */
  readonly requests: readonly LoggedRequest[];
  /** Throws, listing the offenders, when any request was not a GET. */
  assertOnlyGets(): void;
  /** Throws, listing the offenders, when any request went to a host other than those given. */
  assertHosts(allowed: readonly string[]): void;
};

function describe(input: string | URL | Request, init?: RequestInit): LoggedRequest {
  const url = input instanceof Request ? input.url : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return { method, url, host: new URL(url).host };
}

function listing(requests: readonly LoggedRequest[]): string {
  return requests.map((r) => `${r.method} ${r.url}`).join('\n  ');
}

export function loggedFetch(inner: FetchLike = globalThis.fetch): LoggedFetch {
  const requests: LoggedRequest[] = [];
  return {
    fetch: (input, init) => {
      requests.push(describe(input, init));
      return inner(input, init);
    },
    requests,
    assertOnlyGets() {
      const offenders = requests.filter((r) => r.method !== 'GET');
      if (offenders.length > 0) throw new Error(`requests other than GET were sent:\n  ${listing(offenders)}`);
    },
    assertHosts(allowed) {
      const offenders = requests.filter((r) => !allowed.includes(r.host));
      if (offenders.length > 0) {
        throw new Error(`requests went to hosts other than ${allowed.join(', ')}:\n  ${listing(offenders)}`);
      }
    },
  };
}
