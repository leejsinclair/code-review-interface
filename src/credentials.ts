// The one credential module (research R6, constitution X.7 and X.8, FR-028, VO-040).
//
// One OS-keychain entry per platform under the service `pr-review-workbench`, holding
// `{account?, secret, scheme}`. No function here returns a secret: callers get `has`, `account`
// and an `authorize` callback that adds the Authorization header to a request. Every secret this
// module saves or loads is registered with the log scrubber before it is used. The keyring module
// is injected: production passes `@napi-rs/keyring`, tests an in-memory fake.

import { APP_DIR_NAME } from './appdata.ts';
import { AdapterError, type Authorize, type PlatformId } from './contracts/shared.ts';

/** The keychain service name every entry is stored under. */
export const CREDENTIAL_SERVICE = APP_DIR_NAME;

/** The `Entry` instance methods this module calls; `@napi-rs/keyring`'s `Entry` fits. */
export interface KeyringEntryLike {
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

/** The slice of `@napi-rs/keyring` this module depends on. */
export interface KeyringModuleLike {
  Entry: new (service: string, username: string) => KeyringEntryLike;
}

/** How the header is built: `bearer` sends the secret as a bearer token, `basic` sends account:secret. */
export type AuthScheme = 'basic' | 'bearer';

/** What a sign-in hands over. The secret goes in and never comes back out. */
export type CredentialInput = { account?: string; secret: string; scheme: AuthScheme; scope?: 'read' | 'write' };

export type CredentialsDeps = {
  keyring: KeyringModuleLike;
  /** Adds a value to the log scrubber (src/log.ts `registerSecret` in production). */
  registerSecret: (secret: string) => void;
};

export interface CredentialStore {
  /** Stores (or replaces) the platform's one keychain entry. Resolves to nothing. */
  save(platform: PlatformId, input: CredentialInput): Promise<void>;
  /** Deletes the platform's entry, if any. */
  remove(platform: PlatformId): Promise<void>;
  has(platform: PlatformId): Promise<boolean>;
  /** The account name saved with the credential, or undefined. Never the secret. */
  account(platform: PlatformId): Promise<string | undefined>;
  /**
   * A callback that adds the platform's Authorization header to a request. It reads the keychain
   * when called, so it reflects later saves and removals. With no usable credential it returns the
   * request unchanged (the platform then answers 401, which marks the sign-in expired). Never throws.
   */
  authorize(platform: PlatformId): Authorize;
  /**
   * An Authorize built from a credential that has NOT been saved, so a sign-in can run its
   * read-only check before storing anything. Stores nothing and returns no secret; the secret is
   * registered with the log scrubber. Throws CredentialError on an unusable input.
   */
  authorizeWith(input: CredentialInput): Authorize;
  /** True only for a saved credential whose sign-in was granted write scope. */
  hasWriteScope(platform: PlatformId): Promise<boolean>;
  /**
   * Like authorize(), but throws AdapterError('forbidden') synchronously when the platform has no
   * credential or one without write scope. Write scope is asked for only on the first write action.
   */
  authorizeForWrite(platform: PlatformId): Authorize;
}

export type CredentialErrorCode = 'invalid_credential' | 'keyring_unavailable';

/** Raised by this module. Its message never holds a secret. */
export class CredentialError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode, message: string) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
  }
}

type Stored = { account?: string; secret: string; scheme: AuthScheme; scope?: 'write' };

// Header values may not hold control characters; refuse them at save so a header is always buildable.
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkPlatform(platform: PlatformId): void {
  if (typeof platform !== 'string' || platform === '') {
    throw new CredentialError('invalid_credential', 'platform id must be a non-empty string');
  }
}

function checkInput(input: CredentialInput): Stored {
  if (input === null || typeof input !== 'object') {
    throw new CredentialError('invalid_credential', 'credential must be an object');
  }
  const { account, secret, scheme, scope } = input;
  if (scope !== undefined && scope !== 'read' && scope !== 'write') {
    throw new CredentialError('invalid_credential', 'credential scope must be read or write');
  }
  if (scheme !== 'basic' && scheme !== 'bearer') {
    throw new CredentialError('invalid_credential', 'credential scheme must be basic or bearer');
  }
  if (typeof secret !== 'string' || secret === '' || CONTROL.test(secret)) {
    throw new CredentialError('invalid_credential', 'secret must be a non-empty single-line string');
  }
  if (account !== undefined && (typeof account !== 'string' || CONTROL.test(account))) {
    throw new CredentialError('invalid_credential', 'account must be a single-line string');
  }
  if (scheme === 'basic' && (account === undefined || account === '' || account.includes(':'))) {
    throw new CredentialError('invalid_credential', 'basic credentials need an account without ":"');
  }
  return withScope(account === undefined ? { secret, scheme } : { account, secret, scheme }, scope);
}

function withScope(stored: Stored, scope: unknown): Stored {
  return scope === 'write' ? { ...stored, scope: 'write' } : stored;
}

function basicToken(account: string, secret: string): string {
  return Buffer.from(`${account}:${secret}`, 'utf8').toString('base64');
}

function headerValue(stored: Stored): string {
  return stored.scheme === 'bearer' ? `Bearer ${stored.secret}` : `Basic ${basicToken(stored.account ?? '', stored.secret)}`;
}

/** The keychain's own message, with any form of the secret blanked out. */
function keyringFailure(action: string, error: unknown, secrets: readonly string[]): CredentialError {
  let detail = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret !== '') detail = detail.split(secret).join('[redacted]');
  return new CredentialError('keyring_unavailable', `could not ${action} the OS keychain entry: ${detail}`);
}

function parseStored(text: string): Stored | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Never surface the parse error: its message can quote the stored text.
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const { account, secret, scheme, scope } = value as Record<string, unknown>;
  if (typeof secret !== 'string' || secret === '') return null;
  if (scheme !== 'basic' && scheme !== 'bearer') return null;
  if (account !== undefined && typeof account !== 'string') return null;
  return withScope(account === undefined ? { secret, scheme } : { account, secret, scheme }, scope);
}

export function createCredentials(deps: CredentialsDeps): CredentialStore {
  const { keyring, registerSecret } = deps;

  const entry = (platform: PlatformId): KeyringEntryLike => new keyring.Entry(CREDENTIAL_SERVICE, platform);

  /** Every form of a stored secret that could reach a log goes to the scrubber. */
  const register = (stored: Stored): void => {
    registerSecret(stored.secret);
    if (stored.scheme === 'basic') registerSecret(basicToken(stored.account ?? '', stored.secret));
  };

  /** Reads the platform's entry and registers its secret before handing it back inside this module. */
  const load = (platform: PlatformId): Stored | null => {
    checkPlatform(platform);
    let text: string | null;
    try {
      text = entry(platform).getPassword();
    } catch (error) {
      throw keyringFailure('read', error, []);
    }
    if (text === null || text === undefined) return null;
    const stored = parseStored(text);
    if (stored !== null) register(stored);
    return stored;
  };

  const withHeader = (request: Request, stored: Stored): Request => {
    const headers = new Headers(request.headers);
    headers.set('authorization', headerValue(stored));
    return new Request(request, { headers });
  };

  const store: CredentialStore = {
    async save(platform, input) {
      checkPlatform(platform);
      const stored = checkInput(input);
      register(stored);
      try {
        entry(platform).setPassword(JSON.stringify(stored));
      } catch (error) {
        throw keyringFailure('write', error, [stored.secret, basicToken(stored.account ?? '', stored.secret)]);
      }
    },

    async remove(platform) {
      checkPlatform(platform);
      try {
        entry(platform).deleteCredential();
      } catch (error) {
        // Some keychains throw when there is no entry; that is a successful removal.
        if (load(platform) !== null) throw keyringFailure('delete', error, []);
      }
    },

    async has(platform) {
      return load(platform) !== null;
    },

    async account(platform) {
      return load(platform)?.account;
    },

    authorize(platform) {
      return (request: Request): Request => {
        try {
          const stored = load(platform);
          return stored === null ? request : withHeader(request, stored);
        } catch {
          return request;
        }
      };
    },

    async hasWriteScope(platform) {
      return load(platform)?.scope === 'write';
    },

    authorizeForWrite(platform) {
      let stored: Stored | null = null;
      try {
        stored = load(platform);
      } catch {
        stored = null;
      }
      if (stored === null || stored.scope !== 'write') {
        throw new AdapterError('forbidden', platform, `${platform}: this action needs a sign-in with write access; sign in again and grant write access.`);
      }
      const granted = stored;
      return (request: Request): Request => withHeader(request, granted);
    },

    authorizeWith(input) {
      const stored = checkInput(input);
      register(stored);
      return (request: Request): Request => {
        try {
          return withHeader(request, stored);
        } catch {
          return request;
        }
      };
    },
  };

  return Object.freeze(store);
}
