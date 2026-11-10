// Live gate for the GitLab suites (R10; FR-035, FR-036, FR-037, FR-038).
//
// Resolves GITLAB_URL / GITLAB_TOKEN with the defaults from testing/gitlab.md and probes
// `GET <GITLAB_URL>/api/v4/version` with the root token and a 5-second timeout.
//
// When GitLab is not ready, each live file's tests are declared `{ skip: <message> }`, so
// `npm test` reports them skipped, never passed. Under `npm run test:gitlab`
// (PRWB_GITLAB_REQUIRED=1) the gate also registers one failing test named for the cause.
//
// Usage in a live file:
//   const gate = await gitlabGate();
//   test('lists open merge requests', gate, async (t) => { ... });

import { test } from 'node:test';

export const GITLAB_URL: string = process.env.GITLAB_URL ?? 'http://localhost:8929';
export const GITLAB_TOKEN: string = process.env.GITLAB_TOKEN ?? 'glpat-prwb-local-test-token';

export const PROBE_TIMEOUT_MS = 5_000;

const START_HINT = 'start it with `npm run gitlab:up` and then `npm run gitlab:bootstrap`';

export type Readiness = { ready: true; version: string } | { ready: false; cause: string };

/** `GET <url>/api/v4/version` with the root token; unreachable or 401 means not ready. */
export async function probeGitlab(
  url: string = GITLAB_URL,
  token: string = GITLAB_TOKEN,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<Readiness> {
  const endpoint = `${url.replace(/\/+$/, '')}/api/v4/version`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { 'PRIVATE-TOKEN': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      ready: false,
      cause: timedOut
        ? `GitLab at ${url} did not answer within ${timeoutMs / 1000} seconds`
        : `GitLab at ${url} is unreachable`,
    };
  }
  if (response.status === 401) {
    await response.body?.cancel();
    return { ready: false, cause: `GitLab at ${url} refused the token (401): it is not bootstrapped` };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ready: false, cause: `GitLab at ${url} is not ready (HTTP ${response.status})` };
  }
  const body = (await response.json().catch(() => ({}))) as { version?: unknown };
  return { ready: true, version: typeof body.version === 'string' ? body.version : 'unknown' };
}

/** True when PRWB_GITLAB_REQUIRED=1 turns "skip" into "fail". */
export const gitlabRequired = (): boolean => process.env.PRWB_GITLAB_REQUIRED === '1';

/** Test options for every live test: `{}` when ready, `{ skip: <message> }` otherwise. */
export type Gate = { skip?: string };

/**
 * Probes GitLab once per call. Not ready: returns `{ skip }` naming the start commands and,
 * when required, registers one failing test named for the cause.
 */
export async function gitlabGate(
  options: { probe?: () => Promise<Readiness>; required?: boolean } = {},
): Promise<Gate> {
  const readiness = await (options.probe ?? (() => probeGitlab()))();
  if (readiness.ready) return {};
  const message = `${readiness.cause}; ${START_HINT}`;
  if (options.required ?? gitlabRequired()) {
    test(`GitLab not ready: ${readiness.cause}`, () => {
      throw new Error(message);
    });
  }
  return { skip: message };
}
