// Load, validate and save `<app-data>/config.json` (FR-039, research R4, data-model "Configuration").
// Every field is listed below; anything else is refused with `unknown_field`, so a credential cannot be
// pasted into the file by mistake. Registered platform ids are passed in: this module names no platform.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { assertOutsideClone } from './appdata.ts';
import type { PlatformId } from './contracts/shared.ts';
import { DEFAULT_LIMITS, type Limits } from './core/limits.ts';
import { DEFAULT_RETENTION_DAYS } from './log.ts';

export const CONFIG_FILE_NAME = 'config.json';

/** The platform ids the registry knows, by role. */
export type RegisteredPlatforms = {
  sourceControl: readonly PlatformId[];
  issueTrackers: readonly PlatformId[];
};

export type RepositoryConfig = { platform: PlatformId; id: string; clonePath: string };

export type IssueTrackerConfig = { platform: PlatformId; site?: string; projectKeys?: string[] };

/** The wire shape of contracts/http-api.md section 4, plus `logRetentionDays` (data-model.md). */
export type Config = {
  repository: RepositoryConfig;
  issueTracker: IssueTrackerConfig;
  limits: Limits;
  logRetentionDays: number;
};

export type ConfigErrorCode = 'invalid_request' | 'unknown_field';

/** A refused config. `field` is the dotted path of the offending field. */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly field: string;

  constructor(code: ConfigErrorCode, field: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.field = field;
  }
}

const PROJECT_KEY = /^[A-Z][A-Z0-9]+$/;

type Obj = Record<string, unknown>;

const join2 = (prefix: string, key: string): string => (prefix === '' ? key : `${prefix}.${key}`);

function invalid(field: string, why: string): ConfigError {
  return new ConfigError('invalid_request', field, `${field} ${why}`);
}

function object(value: unknown, field: string, allowed: readonly string[]): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(field === '' ? 'config' : field, 'must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      const path = join2(field, key);
      throw new ConfigError('unknown_field', path, `${path} is not a known configuration field`);
    }
  }
  return value as Obj;
}

function requiredString(obj: Obj, key: string, prefix: string): string {
  const field = join2(prefix, key);
  const value = obj[key];
  if (value === undefined) throw invalid(field, 'is required');
  if (typeof value !== 'string' || value.trim() === '') throw invalid(field, 'must be a non-empty string');
  return value;
}

function positiveInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw invalid(field, `must be an integer of at least ${min}`);
  }
  return value;
}

function platformIn(obj: Obj, prefix: string, registered: readonly PlatformId[]): PlatformId {
  const value = requiredString(obj, 'platform', prefix);
  if (!registered.includes(value)) throw invalid(join2(prefix, 'platform'), `"${value}" is not a registered platform`);
  return value;
}

function validateRepository(value: unknown, platforms: RegisteredPlatforms, appDataDir: string): RepositoryConfig {
  const prefix = 'repository';
  if (value === undefined) throw invalid(prefix, 'is required');
  const obj = object(value, prefix, ['platform', 'id', 'clonePath']);
  const platform = platformIn(obj, prefix, platforms.sourceControl);
  const id = requiredString(obj, 'id', prefix);
  const clonePath = requiredString(obj, 'clonePath', prefix);
  if (!isAbsolute(clonePath)) throw invalid('repository.clonePath', 'must be an absolute path');
  try {
    assertOutsideClone(clonePath, appDataDir);
  } catch (error) {
    throw invalid('repository.clonePath', `must not overlap the application-data directory (${(error as Error).message})`);
  }
  return { platform, id, clonePath };
}

function validateIssueTracker(value: unknown, platforms: RegisteredPlatforms): IssueTrackerConfig {
  const prefix = 'issueTracker';
  if (value === undefined) throw invalid(prefix, 'is required');
  const obj = object(value, prefix, ['platform', 'site', 'projectKeys']);
  const out: IssueTrackerConfig = { platform: platformIn(obj, prefix, platforms.issueTrackers) };

  if (obj.site !== undefined) {
    const site = requiredString(obj, 'site', prefix);
    let url: URL | null = null;
    try {
      url = new URL(site);
    } catch {
      url = null;
    }
    if (url === null || url.protocol !== 'https:') throw invalid('issueTracker.site', 'must be an https URL');
    out.site = site;
  }

  if (obj.projectKeys !== undefined) {
    const keys = obj.projectKeys;
    if (!Array.isArray(keys)) throw invalid('issueTracker.projectKeys', 'must be a list of project keys');
    keys.forEach((key: unknown, i) => {
      if (typeof key !== 'string' || !PROJECT_KEY.test(key)) {
        throw invalid('issueTracker.projectKeys', `entry ${i} must match ${PROJECT_KEY.source}`);
      }
    });
    out.projectKeys = [...(keys as string[])];
  }
  return out;
}

function validateLimits(value: unknown): Limits {
  if (value === undefined) return { ...DEFAULT_LIMITS };
  const obj = object(value, 'limits', ['maxFileBytes', 'maxChangedLines', 'maxPromptChars']);
  const pick = (key: keyof Limits): number =>
    obj[key] === undefined ? DEFAULT_LIMITS[key] : positiveInteger(obj[key], `limits.${key}`, 1);
  return {
    maxFileBytes: pick('maxFileBytes'),
    maxChangedLines: pick('maxChangedLines'),
    maxPromptChars: pick('maxPromptChars'),
  };
}

/** Validates a config body and applies defaults. Throws ConfigError naming the field on refusal. */
export function validateConfig(body: unknown, platforms: RegisteredPlatforms, appDataDir: string): Config {
  const obj = object(body, '', ['repository', 'issueTracker', 'limits', 'logRetentionDays']);
  return {
    repository: validateRepository(obj.repository, platforms, appDataDir),
    issueTracker: validateIssueTracker(obj.issueTracker, platforms),
    limits: validateLimits(obj.limits),
    logRetentionDays:
      obj.logRetentionDays === undefined
        ? DEFAULT_RETENTION_DAYS
        : positiveInteger(obj.logRetentionDays, 'logRetentionDays', 1),
  };
}

/** Validates, applies defaults and writes `<appDataDir>/config.json`. A refused save writes nothing. */
export async function saveConfig(appDataDir: string, body: unknown, platforms: RegisteredPlatforms): Promise<Config> {
  const config = validateConfig(body, platforms, appDataDir);
  await mkdir(appDataDir, { recursive: true });
  const file = join(appDataDir, CONFIG_FILE_NAME);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
  return config;
}

/** Reads and validates `<appDataDir>/config.json`; null when it does not exist yet. */
export async function loadConfig(appDataDir: string, platforms: RegisteredPlatforms): Promise<Config | null> {
  let text: string;
  try {
    text = await readFile(join(appDataDir, CONFIG_FILE_NAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid('config', `${CONFIG_FILE_NAME} is not valid JSON`);
  }
  return validateConfig(parsed, platforms, appDataDir);
}
