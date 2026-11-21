// The `{ after }` collector that lets the node:test helpers (startWorkbench, useBrowser) run in a plain script (R7).

export type AfterHooks = { after(fn: () => unknown): void; run(): Promise<void> };

/** `run()` calls the callbacks in reverse order and keeps going when one throws, as node:test does. */
export function createAfterHooks(): AfterHooks {
  const hooks: Array<() => unknown> = [];
  return {
    after: (fn) => void hooks.push(fn),
    async run() {
      for (const fn of hooks.splice(0).reverse()) {
        try {
          await fn();
        } catch (error) {
          console.warn(`cleanup step failed: ${(error as Error).message}`);
        }
      }
    },
  };
}
