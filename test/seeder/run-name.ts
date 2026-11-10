// Run naming and ownership for the test-only seeder (FR-028, FR-045).
//
// Every item a live run creates is named after the run: the user is the run name itself,
// and each project is `<run name>-<label>`. Cleanup deletes only names `ownedBy` accepts,
// so one run never touches another run's items, and a bare `it-` owns nothing.

const RUN_PREFIX = 'it-';
const RUN_NAME = /^it-[a-z0-9]+(?:-[a-z0-9]+)*-\d{17}$/;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** `it-<suite>-<UTC yyyymmddhhmmssSSS>`; `now` defaults to the current time. */
export function makeRunName(suite: string, now: Date = new Date()): string {
  const stamp =
    pad(now.getUTCFullYear(), 4) +
    pad(now.getUTCMonth() + 1, 2) +
    pad(now.getUTCDate(), 2) +
    pad(now.getUTCHours(), 2) +
    pad(now.getUTCMinutes(), 2) +
    pad(now.getUTCSeconds(), 2) +
    pad(now.getUTCMilliseconds(), 3);
  const name = `${RUN_PREFIX}${suite}-${stamp}`;
  if (!RUN_NAME.test(name)) throw new Error(`invalid suite name for a run: ${JSON.stringify(suite)}`);
  return name;
}

/** True only for `runName` itself or `<runName>-<label>`; never for a malformed run name. */
export function ownedBy(runName: string, name: string): boolean {
  if (!RUN_NAME.test(runName)) return false;
  return name === runName || (name.startsWith(`${runName}-`) && name.length > runName.length + 1);
}

/** The `it-*` names that do not belong to `runName`, in input order. */
export function filterLeftovers(runName: string, names: readonly string[]): string[] {
  return names.filter((name) => name.startsWith(RUN_PREFIX) && !ownedBy(runName, name));
}
