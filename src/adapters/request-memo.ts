// Request scope and GET memo (feature 007, research R8; FR-017, SC-010).
// Inside `withRequestScope`, one in-flight promise serves every read of the same key. Outside a scope
// nothing is cached. The read layer calls `memoGet`; the write layer calls `clearRequestMemo` only.
import { AsyncLocalStorage } from 'node:async_hooks';

type Scope = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<Scope>();

export function withRequestScope<T>(fn: () => T): T {
  return storage.run(new Map(), fn);
}

export function memoKey(url: string, credential: string): string {
  return JSON.stringify([url, credential]);
}

export function memoGet<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return load();
  const hit = scope.get(key);
  if (hit) return hit as Promise<T>;
  const pending = load();
  scope.set(key, pending);
  // A failed read is evicted so a retry reads again (never evict a newer entry after a clear).
  pending.catch(() => {
    if (scope.get(key) === pending) scope.delete(key);
  });
  return pending;
}

export function clearRequestMemo(): void {
  storage.getStore()?.clear();
}
