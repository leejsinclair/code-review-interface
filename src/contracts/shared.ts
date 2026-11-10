// Neutral contract types shared by every provider contract (contracts/provider-contracts.md, "Shared").
// Core and UI code name platforms only through these types; platform knowledge lives under
// src/adapters/ (constitution VIII.2, FR-025, VO-036).

/** A registered platform id. A plain string here so no core or UI file names a platform. */
export type PlatformId = string;

/** Adds the Authorization header to a request. Supplied by src/credentials.ts; the adapter never sees the secret (R6). */
export type Authorize = (request: Request) => Request;

/** Every adapter HTTP call goes through the read-only layer, which refuses any method but GET (VIII.3, FR-027). */
export type ReadOnlyFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/** What an adapter factory is given. `fetch` is injected so tests replay recorded fixtures. */
export type AdapterDeps = { fetch: ReadOnlyFetch; authorize: Authorize };

export type AdapterErrorCode =
  /** 401 or 403: that platform's sign-in is marked expired (FR-040). */
  | 'unauthorized'
  | 'not_found'
  /** Network failure or 5xx. */
  | 'unavailable'
  /** Pagination stopped at the page cap; reported as a gap. */
  | 'truncated';

export const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = ['unauthorized', 'not_found', 'unavailable', 'truncated'];

/** The one error type an adapter raises, carrying a neutral code and the platform it came from. */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly platform: PlatformId;

  constructor(code: AdapterErrorCode, platform: PlatformId, message?: string, options?: { cause?: unknown }) {
    super(message ?? `${platform}: ${code}`, options);
    this.name = 'AdapterError';
    this.code = code;
    this.platform = platform;
  }
}

/** Result of a read-only sign-in check. */
export type SignInCheck = { ok: true; account: string } | { ok: false; reason: string };

/** One input on a platform's sign-in form. `account` is the email or user name; `secret` is the token. */
export type SignInField = {
  name: 'account' | 'secret';
  label: string;
  /** Rendered as a password input and never echoed back. */
  secret: boolean;
};

/** How the UI and server describe a platform without naming it in code. */
export type AdapterDescriptor = {
  id: PlatformId;
  displayName: string;
  signInFields: readonly SignInField[];
  /** True when the source-control platform needs a repository base address (FR-016). */
  needsBaseUrl?: boolean;
  /** Tracker settings fields Setup renders for this adapter; absent means none (R14). */
  settingsFields?: readonly ('site' | 'projectKeys')[];
};
