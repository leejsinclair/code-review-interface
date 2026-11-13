// Fallback for machines with no usable OS keychain (devcontainers, headless Linux).
//
// `withEnvFallback` wraps the real keyring module so the one credential module (credentials.ts)
// keeps working unchanged:
//   - reads: the keychain wins; if it has no entry or is unavailable, a credential built from the
//     environment (typically loaded from `.env`) is used for platforms that have one;
//   - writes: the keychain is tried first; if it is unavailable the credential is held in memory
//     for this process only. Nothing is ever written to disk by this module.
// Environment credentials cannot be deleted from inside the app: remove them from `.env`.

import type { KeyringEntryLike, KeyringModuleLike } from './credentials.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Builds a platform's stored-credential JSON from the environment, or null when it has none. */
export type EnvCredential = (platform: string, env: Env) => string | null;

export function withEnvFallback(keyring: KeyringModuleLike | null, fromEnv: EnvCredential, env: Env = process.env): KeyringModuleLike {
  const memory = new Map<string, string>();

  class FallbackEntry implements KeyringEntryLike {
    readonly #real: KeyringEntryLike | null;
    readonly #key: string;
    readonly #platform: string;

    constructor(service: string, platform: string) {
      this.#platform = platform;
      this.#key = `${service}\u0000${platform}`;
      try {
        this.#real = keyring === null ? null : new keyring.Entry(service, platform);
      } catch {
        this.#real = null;
      }
    }

    setPassword(password: string): void {
      try {
        if (this.#real === null) throw new Error('no keychain');
        this.#real.setPassword(password);
        memory.delete(this.#key);
      } catch {
        memory.set(this.#key, password);
      }
    }

    getPassword(): string | null {
      try {
        const real = this.#real?.getPassword();
        if (real !== null && real !== undefined) return real;
      } catch {
        // Keychain unavailable: fall through to memory and the environment.
      }
      return memory.get(this.#key) ?? fromEnv(this.#platform, env);
    }

    deleteCredential(): boolean {
      const had = memory.delete(this.#key);
      try {
        return (this.#real?.deleteCredential() ?? false) || had;
      } catch {
        return had;
      }
    }
  }

  return { Entry: FallbackEntry };
}
