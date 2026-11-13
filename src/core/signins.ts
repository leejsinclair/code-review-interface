// Per-platform sign-in (FR-040, EC-13, X.7, data-model "Credential entry"). A credential is stored
// only after the platform's read-only check accepts it; the state of each platform is held in memory:
// signed-in, signed-out, or expired once that platform rejects the stored token. An expired platform
// asks for sign-in again and blocks nothing else.

import type { SignIn, SignInState } from '../contracts/http.ts';
import { AdapterError, type AdapterDescriptor, type Authorize, type PlatformId, type SignInCheck } from '../contracts/shared.ts';
import { CredentialError, type CredentialStore } from '../credentials.ts';

export type SignInsDeps = {
  credentials: CredentialStore;
  descriptor: (platform: PlatformId) => AdapterDescriptor | undefined;
  /** The platform's read-only sign-in check, run with the given credential callback. */
  verify: (platform: PlatformId, authorize: Authorize) => Promise<SignInCheck>;
};

export type SignInErrorCode = 'not_found' | 'invalid_request' | 'signin_rejected';

export class SignInError extends Error {
  readonly code: SignInErrorCode;
  readonly platform: PlatformId;
  constructor(code: SignInErrorCode, platform: PlatformId, message: string) {
    super(message);
    this.name = 'SignInError';
    this.code = code;
    this.platform = platform;
  }
}

export interface SignIns {
  state(platform: PlatformId): Promise<SignInState>;
  list(platforms: readonly PlatformId[]): Promise<SignIn[]>;
  signIn(platform: PlatformId, body: { account?: string; secret: string; scope?: 'read' | 'write' }): Promise<SignIn>;
  /** Marks the platform expired when `error` is its rejection of the stored token. */
  noteFailure(error: unknown): void;
}

export function createSignIns(deps: SignInsDeps): SignIns {
  const expired = new Set<PlatformId>();
  const accounts = new Map<PlatformId, string>();

  const state = async (platform: PlatformId): Promise<SignInState> => {
    if (expired.has(platform)) return 'expired';
    try {
      return (await deps.credentials.has(platform)) ? 'signed-in' : 'signed-out';
    } catch {
      return 'signed-out';
    }
  };

  const view = async (platform: PlatformId): Promise<SignIn> => {
    const out: SignIn = { platform, state: await state(platform) };
    const account = accounts.get(platform) ?? (await deps.credentials.account(platform).catch(() => undefined));
    if (out.state !== 'signed-out' && account !== undefined) out.account = account;
    return out;
  };

  return {
    state,

    list: async (platforms) => Promise.all([...new Set(platforms)].map(view)),

    async signIn(platform, body) {
      const descriptor = deps.descriptor(platform);
      if (descriptor === undefined) throw new SignInError('not_found', platform, 'No such platform.');
      const needsAccount = descriptor.signInFields.some((f) => f.name === 'account');
      const account = body.account?.trim();
      if (needsAccount && (account === undefined || account === '')) {
        throw new SignInError('invalid_request', platform, 'account is required for this platform.');
      }
      const scope = body.scope === 'write' ? { scope: 'write' as const } : {};
      const input = needsAccount ? { account, secret: body.secret, scheme: 'basic' as const, ...scope } : { secret: body.secret, scheme: 'bearer' as const, ...scope };
      let authorize: Authorize;
      try {
        authorize = deps.credentials.authorizeWith(input);
      } catch (error) {
        if (error instanceof CredentialError) throw new SignInError('invalid_request', platform, error.message);
        throw error;
      }
      let check: SignInCheck;
      try {
        check = await deps.verify(platform, authorize);
      } catch (error) {
        const reason = error instanceof AdapterError ? `the platform could not be reached (${error.code})` : 'the check failed';
        throw new SignInError('signin_rejected', platform, `The sign-in could not be checked: ${reason}.`);
      }
      if (!check.ok) throw new SignInError('signin_rejected', platform, `The sign-in was not accepted: ${check.reason}.`);
      try {
        await deps.credentials.save(platform, input);
      } catch (error) {
        if (error instanceof CredentialError) throw new SignInError('signin_rejected', platform, `The sign-in was accepted but could not be saved: ${error.message}.`);
        throw error;
      }
      expired.delete(platform);
      accounts.set(platform, check.account);
      return { platform, state: 'signed-in', account: check.account };
    },

    noteFailure(error) {
      if (error instanceof AdapterError && error.code === 'unauthorized') expired.add(error.platform);
    },
  };
}
