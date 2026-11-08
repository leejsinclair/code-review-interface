// JSON-lines logger (research R18, FR-054).
//
// Every line goes to `<dir>/prwb-YYYY-MM-DD.log` (UTC date) and holds `ts` plus
// only the allowlisted LogEntry fields, so code, diffs, prompts, answers and PR
// or issue text cannot reach the log by accident. String fields pass through a
// scrubber that replaces every registered secret and any `Authorization` value.

import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface LogEntry {
  op: string;
  outcome: string;
  durationMs: number;
  sessionId?: string;
  snapshotId?: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface Logger {
  /** Appends one JSON line; the line is on disk once the promise settles. */
  log(entry: LogEntry): void | Promise<void>;
  /** Deletes log files dated more than `retentionDays` days before today (UTC). */
  sweep(): Promise<void>;
}

export interface LoggerOptions {
  /** The logs directory; created if missing. */
  dir: string;
  now?: () => Date;
  retentionDays?: number;
}

export const DEFAULT_RETENTION_DAYS = 7;

const STRING_FIELDS = [
  'op',
  'outcome',
  'sessionId',
  'snapshotId',
  'requestId',
  'errorCode',
  'errorMessage',
] as const;

const LOG_FILE = /^prwb-(\d{4})-(\d{2})-(\d{2})\.log$/;
const DAY_MS = 86_400_000;
const REDACTED = '[redacted]';

// Module-wide registry: platform tokens and the launch token.
const secrets = new Set<string>();

/** Registers a value the scrubber must replace wherever it appears. */
export function registerSecret(secret: string): void {
  if (typeof secret === 'string' && secret.length > 0) secrets.add(secret);
}

// `Authorization: Bearer x`, `authorization: Basic x`, `"Authorization":"Bearer x"`,
// `authorization=x`. The optional scheme word is kept; the credential is replaced.
const AUTHORIZATION =
  /(["']?authorization["']?\s*[:=]\s*["']?)(?:([A-Za-z][\w-]*)[ \t]+)?([^\s"',;}\]]+)/gi;

/** Replaces registered secrets and `Authorization` values in `text`. */
export function scrub(text: string): string {
  let out = text;
  // Longest first, so a secret containing another is replaced whole.
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  for (const secret of ordered) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out.replace(AUTHORIZATION, (_match, prefix: string, scheme: string | undefined) =>
    scheme === undefined ? `${prefix}${REDACTED}` : `${prefix}${scheme} ${REDACTED}`,
  );
}

const utcDate = (date: Date): string => date.toISOString().slice(0, 10);

const startOfUtcDay = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/** Builds the line written for `entry`: `ts` plus allowlisted, scrubbed fields. */
function toLine(entry: LogEntry, ts: Date): string {
  const source = (entry ?? {}) as unknown as Record<string, unknown>;
  const line: Record<string, string | number> = { ts: ts.toISOString() };
  for (const key of STRING_FIELDS) {
    const value = source[key];
    if (typeof value === 'string') line[key] = scrub(value);
  }
  const duration = source['durationMs'];
  if (typeof duration === 'number' && Number.isFinite(duration)) line['durationMs'] = duration;
  return `${JSON.stringify(line)}\n`;
}

export function createLogger(options: LoggerOptions): Logger {
  const { dir } = options;
  const now = options.now ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  let ready: Promise<unknown> | null = null;
  // Writes are chained so lines keep their call order.
  let tail: Promise<void> = Promise.resolve();

  const ensureDir = (): Promise<unknown> => {
    ready ??= mkdir(dir, { recursive: true }).catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  return {
    log(entry: LogEntry): Promise<void> {
      const ts = now();
      const text = toLine(entry, ts);
      const file = join(dir, `prwb-${utcDate(ts)}.log`);
      // A failed write must never break the caller; logging is best effort.
      tail = tail.then(async () => {
        await ensureDir();
        await appendFile(file, text, { encoding: 'utf8', mode: 0o600 });
      }).catch(() => undefined);
      return tail;
    },

    async sweep(): Promise<void> {
      const cutoff = startOfUtcDay(now()) - retentionDays * DAY_MS;
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      await Promise.all(
        names.map(async (name) => {
          const match = LOG_FILE.exec(name);
          if (match === null) return;
          const dated = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
          if (!(dated < cutoff)) return;
          try {
            await unlink(join(dir, name));
          } catch {
            // Already gone or not removable; the next sweep tries again.
          }
        }),
      );
    },
  };
}
