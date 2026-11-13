// The write HTTP layer for review actions (spec 005, FR-012). Separate from the read-only layer: it
// refuses any method plus endpoint not on the caller's allowlist before the network is touched, never
// follows a redirect, and maps failures to neutral AdapterError codes carrying the platform's message.

import { AdapterError, type AdapterErrorCode, type PlatformId } from '../contracts/shared.ts';

export type WriteAllow = { method: string; pattern: RegExp };

export type WriteFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export type WriteFetchOptions = {
  platform: PlatformId;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  allowlist: readonly WriteAllow[];
};

const STATUS_CODES: Record<number, AdapterErrorCode> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'rejected',
  429: 'rate_limited',
};

function codeForStatus(status: number): AdapterErrorCode {
  return STATUS_CODES[status] ?? 'unavailable';
}

async function platformMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = JSON.parse(await response.text());
    if (body !== null && typeof body === 'object') {
      const record = body as { message?: unknown; error?: unknown };
      if (typeof record.message === 'string') return record.message;
      if (typeof record.error === 'string') return record.error;
      if (record.error !== null && typeof record.error === 'object') {
        const nested = record.error as { message?: unknown; fields?: unknown };
        // Bitbucket puts the useful detail (which field was rejected) in error.fields.
        const fields = nested.fields !== undefined ? ` ${JSON.stringify(nested.fields).slice(0, 500)}` : '';
        if (typeof nested.message === 'string') return `${nested.message}${fields}`;
        if (fields !== '') return fields.trim();
      }
    }
  } catch {
    // Not JSON, or the body was unreadable: fall back to the status alone.
  }
  return null;
}

export function createWriteFetch(options: WriteFetchOptions): WriteFetch {
  const { platform, fetch: network, allowlist } = options;

  return async (url, init) => {
    const method = init.method.toUpperCase();
    let pathname: string | null = null;
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = null;
    }
    const allowed =
      pathname !== null &&
      !/%2e|%5c/i.test(pathname) &&
      allowlist.some((entry) => entry.method.toUpperCase() === method && entry.pattern.test(pathname));
    if (!allowed) throw new Error(`${method} ${pathname ?? url} is not allowed: not on the write allowlist`);

    const request: RequestInit = { method, redirect: 'manual' };
    if (init.headers !== undefined) request.headers = init.headers;
    if (init.body !== undefined) request.body = init.body;

    let response: Response;
    try {
      response = await network(url, request);
    } catch (cause) {
      throw new AdapterError('unavailable', platform, `${platform}: network request failed`, { cause });
    }
    console.error(`[write-http] ${platform} ${method} ${pathname} -> ${response.status}`);
    if (response.status >= 200 && response.status < 300) return response;

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new AdapterError('unavailable', platform, `${platform}: HTTP ${response.status} redirect refused`);
    }
    const message = await platformMessage(response);
    console.error(`[write-http] ${platform} ${method} ${pathname} failed: ${message ?? '(no message)'}`);
    throw new AdapterError(
      codeForStatus(response.status),
      platform,
      `${platform}: HTTP ${response.status}${message !== null ? `: ${message}` : ''}`,
    );
  };
}
