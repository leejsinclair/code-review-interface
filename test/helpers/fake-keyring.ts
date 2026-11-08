// In-memory stand-in for `@napi-rs/keyring`, injectable into `src/credentials.ts`.
// It has the same `Entry` shape (constructor, set/get/delete) and the same
// `findCredentials` function, so the credential module can take either the
// real package or this fake. Nothing here touches the OS keychain.

import type { Credential, Entry } from '@napi-rs/keyring';

/** The `Entry` instance methods `credentials.ts` may call. */
export type KeyringEntry = Pick<
  Entry,
  'setPassword' | 'setSecret' | 'getPassword' | 'getSecret' | 'deleteCredential' | 'deletePassword'
>;

/** `new Entry(service, username)`, as exported by `@napi-rs/keyring`. */
export type KeyringEntryConstructor = new (service: string, username: string) => KeyringEntry;

/** The slice of the `@napi-rs/keyring` module that `credentials.ts` depends on. */
export interface KeyringModule {
  Entry: KeyringEntryConstructor;
  findCredentials(service: string, target?: string | null): Credential[];
}

export type KeyringOperation = 'set' | 'get' | 'delete' | 'find';

export interface KeyringCall {
  op: KeyringOperation;
  service: string;
  account: string;
}

export interface StoredCredential {
  service: string;
  account: string;
  password: string;
}

export interface FakeKeyring extends KeyringModule {
  /** Every call made through `Entry` or `findCredentials`, in order. `account` is `''` for `find`. */
  readonly calls: readonly KeyringCall[];
  /** Seed an entry directly, without recording a call. */
  seed(service: string, account: string, password: string): void;
  /** Read an entry directly, without recording a call. */
  peek(service: string, account: string): string | undefined;
  /** Every stored entry, sorted by service then account. */
  entries(): StoredCredential[];
  /** Every stored password: the strings a leak test looks for elsewhere. */
  secrets(): string[];
  /** Make every later keyring call throw `error`, as a locked or missing keychain does; `null` restores it. */
  setUnavailable(error: Error | null): void;
  /** Remove every entry and forget every call. */
  reset(): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const key = (service: string, account: string): string => JSON.stringify([service, account]);

export function createFakeKeyring(initial: readonly StoredCredential[] = []): FakeKeyring {
  const store = new Map<string, StoredCredential & { bytes: Uint8Array }>();
  const calls: KeyringCall[] = [];
  let unavailable: Error | null = null;

  const record = (op: KeyringOperation, service: string, account: string): void => {
    calls.push({ op, service, account });
    if (unavailable) throw unavailable;
  };

  const put = (service: string, account: string, bytes: Uint8Array): void => {
    let password: string;
    try {
      password = decoder.decode(bytes);
    } catch {
      password = '';
    }
    store.set(key(service, account), { service, account, password, bytes: Uint8Array.from(bytes) });
  };

  class FakeEntry implements KeyringEntry {
    readonly #service: string;
    readonly #account: string;

    constructor(service: string, username: string) {
      this.#service = service;
      this.#account = username;
    }

    setPassword(password: string): void {
      record('set', this.#service, this.#account);
      put(this.#service, this.#account, encoder.encode(password));
    }

    setSecret(secret: Uint8Array): void {
      record('set', this.#service, this.#account);
      put(this.#service, this.#account, secret);
    }

    getPassword(): string | null {
      record('get', this.#service, this.#account);
      const found = store.get(key(this.#service, this.#account));
      if (!found) return null;
      // The real binding fails on a secret that is not UTF-8.
      decoder.decode(found.bytes);
      return found.password;
    }

    getSecret(): Array<number> | null {
      record('get', this.#service, this.#account);
      const found = store.get(key(this.#service, this.#account));
      return found ? Array.from(found.bytes) : null;
    }

    deleteCredential(): boolean {
      record('delete', this.#service, this.#account);
      return store.delete(key(this.#service, this.#account));
    }

    deletePassword(): boolean {
      return this.deleteCredential();
    }
  }

  const entries = (): StoredCredential[] =>
    [...store.values()]
      .map(({ service, account, password }) => ({ service, account, password }))
      .sort((a, b) => a.service.localeCompare(b.service) || a.account.localeCompare(b.account));

  const fake: FakeKeyring = {
    Entry: FakeEntry,
    findCredentials(service: string): Credential[] {
      record('find', service, '');
      return entries()
        .filter((entry) => entry.service === service)
        .map(({ account, password }) => ({ account, password }));
    },
    calls,
    seed(service, account, password) {
      put(service, account, encoder.encode(password));
    },
    peek(service, account) {
      return store.get(key(service, account))?.password;
    },
    entries,
    secrets() {
      return entries().map((entry) => entry.password);
    },
    setUnavailable(error) {
      unavailable = error;
    },
    reset() {
      store.clear();
      calls.length = 0;
      unavailable = null;
    },
  };

  for (const { service, account, password } of initial) fake.seed(service, account, password);
  return fake;
}
