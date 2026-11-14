// Shared "approved by me" over several pull requests (spec 007, FR-013, FR-014, VO-030). Each adapter
// supplies the per-pull-request check; this runs them four at a time, keeps the successes, logs each
// failure, and reports `unavailable` only when every check failed.
import { AdapterError, type PlatformId } from '../contracts/shared.ts';
import { mapLimited } from './concurrent.ts';

const LIMIT = 4;

export async function approvedAcross(
  platform: PlatformId,
  numbers: readonly number[],
  one: (number: number) => Promise<boolean>,
): Promise<Set<number>> {
  const outcomes = await mapLimited(numbers, LIMIT, async (number) => {
    try {
      return { number, approved: await one(number), failed: false };
    } catch (err) {
      const code = err instanceof AdapterError ? err.code : 'unknown';
      console.warn(`approved-by-me: ${platform} pull request ${number} check failed (${code})`);
      return { number, approved: false, failed: true };
    }
  });
  if (numbers.length > 0 && outcomes.every((o) => o.failed)) {
    throw new AdapterError('unavailable', platform);
  }
  return new Set(outcomes.filter((o) => o.approved).map((o) => o.number));
}
