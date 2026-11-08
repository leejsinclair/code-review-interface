// Capability probe for the Claude Code CLI (research R12, FR-022, EC-08, EC-09).
//
// Resolves the native executable without a shell, runs `--version`, `--help` and `auth status`,
// and maps the options the help lists to the FR-022 restrictions:
//   (c) no network tools and (d) no repository configuration need `--restricted`, `--tools` and
//       `--strict-mcp-config`; without any of them the provider is unavailable, with the reason;
//   (a) workspace read/search tools only and (b) no reads outside the workspace need `--restricted`
//       and `--add-dir`; without them every answer and summary names them as not enforced;
//   (e) untrusted input delimited is enforced by core's data block, so always true here.

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { BLOCKING_RESTRICTIONS, type ProviderCapabilities, type RestrictionId } from '../../contracts/ai-provider.ts';

export const CLI_COMMAND = 'claude';
const PROBE_TIMEOUT_MS = 20_000;

/** How to start the CLI: `file` with `prefix` before its own arguments (a JS entry run by node). */
export type Executable = { file: string; prefix: string[] };

/** The CLI options the restrictions rest on, as the help text lists them. */
export type HelpFlags = { restricted: boolean; tools: boolean; strictMcp: boolean; addDir: boolean };

const listed = (help: string, option: string): boolean => new RegExp(`(^|[\\s,])${option}(?=[\\s,=]|$)`, 'm').test(help);

export function helpFlags(help: string): HelpFlags {
  return {
    restricted: listed(help, '--restricted'),
    tools: listed(help, '--tools'),
    strictMcp: listed(help, '--strict-mcp-config'),
    addDir: listed(help, '--add-dir'),
  };
}

/** Maps what the probe found to the provider's capabilities and, when unavailable, the reason. */
export function capabilitiesFrom(probe: { installed: boolean; signedIn?: boolean; help?: string }): ProviderCapabilities {
  const flags = helpFlags(probe.help ?? '');
  const blockingEnforced = flags.restricted && flags.tools && flags.strictMcp;
  const workspaceEnforced = flags.restricted && flags.addDir;
  const restrictionsEnforced: Record<RestrictionId, boolean> = {
    'workspace-read-search-tools-only': probe.installed && workspaceEnforced,
    'no-reads-outside-workspace': probe.installed && workspaceEnforced,
    'no-network-tools': probe.installed && blockingEnforced,
    'no-repository-configuration': probe.installed && blockingEnforced,
    'untrusted-input-delimited': true,
  };
  const caps: ProviderCapabilities = { installed: probe.installed, streaming: true, restrictionsEnforced };
  if (probe.signedIn !== undefined) caps.signedIn = probe.signedIn;

  if (!probe.installed) {
    caps.unavailableReason = `the Claude Code CLI is not installed: no \`${CLI_COMMAND}\` executable on PATH`;
  } else if (BLOCKING_RESTRICTIONS.some((id) => !restrictionsEnforced[id])) {
    const missing = [
      flags.restricted ? null : '--restricted',
      flags.tools ? null : '--tools',
      flags.strictMcp ? null : '--strict-mcp-config',
    ].filter((f): f is string => f !== null);
    caps.unavailableReason =
      `the installed Claude Code CLI cannot enforce "no network tools" and "no repository configuration": ` +
      `its help lists no ${missing.join(', ')}`;
  } else if (probe.signedIn === false) {
    caps.unavailableReason = `the Claude Code CLI is not signed in: run \`${CLI_COMMAND}\` once and sign in`;
  }
  return caps;
}

// ------------------------------------------------------------------------------- environment

const ENV_NAMES = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE',
  'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'HOMEDRIVE', 'HOMEPATH', 'COMSPEC',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
]);

/**
 * The environment the CLI runs with: an allowlist plus the provider's own `ANTHROPIC_*`, `CLAUDE_*`
 * and `XDG_*` variables. Nothing else from the workbench's environment (platform tokens) passes.
 */
export function providerEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (ENV_NAMES.has(upper) || upper.startsWith('ANTHROPIC_') || upper.startsWith('CLAUDE_') || upper.startsWith('XDG_')) env[key] = value;
  }
  return env;
}

// ------------------------------------------------------------------------------- resolution

async function isExecutable(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the CLI on PATH without a shell. On Windows an npm `.cmd` shim cannot run without one, so
 * the native `claude.exe` is used, or else node with the package's JavaScript entry next to the shim.
 */
export async function resolveExecutable(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<Executable | null> {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter((d) => d !== '');
  if (platform !== 'win32') {
    for (const dir of dirs) {
      const file = join(dir, CLI_COMMAND);
      if (await isExecutable(file, constants.X_OK)) return { file, prefix: [] };
    }
    return null;
  }
  for (const dir of dirs) {
    const exe = join(dir, `${CLI_COMMAND}.exe`);
    if (await isExecutable(exe, constants.F_OK)) return { file: exe, prefix: [] };
  }
  for (const dir of dirs) {
    if (!(await isExecutable(join(dir, `${CLI_COMMAND}.cmd`), constants.F_OK))) continue;
    const entry = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (await isExecutable(entry, constants.F_OK)) return { file: process.execPath, prefix: [entry] };
    const sibling = join(dirname(dir), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (await isExecutable(sibling, constants.F_OK)) return { file: process.execPath, prefix: [sibling] };
  }
  return null;
}

// ------------------------------------------------------------------------------- the probe

type Ran = { code: number; stdout: string };

function run(exe: Executable, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      exe.file,
      [...exe.prefix, ...args],
      { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1;
        resolve({ code, stdout: String(stdout) });
      },
    );
  });
}

/** `auth status` prints JSON with `loggedIn`; anything else leaves the state unknown. */
function signedInFrom(ran: Ran): boolean | undefined {
  try {
    const parsed = JSON.parse(ran.stdout) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === 'boolean' ? parsed.loggedIn : undefined;
  } catch {
    return undefined;
  }
}

export type Probe = { capabilities: ProviderCapabilities; executable: Executable | null; flags: HelpFlags };

/** Runs the probe in `cwd` (an app-owned directory) with the provider environment. */
export async function probeCapabilities(options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<Probe> {
  const env = providerEnv(options.env);
  const executable = await resolveExecutable(env);
  const none: HelpFlags = { restricted: false, tools: false, strictMcp: false, addDir: false };
  if (executable === null) return { capabilities: capabilitiesFrom({ installed: false }), executable, flags: none };
  const version = await run(executable, ['--version'], { cwd: options.cwd, env });
  if (version.code !== 0) return { capabilities: capabilitiesFrom({ installed: false }), executable: null, flags: none };
  const help = await run(executable, ['--help'], { cwd: options.cwd, env });
  const auth = await run(executable, ['auth', 'status'], { cwd: options.cwd, env });
  const signedIn = signedInFrom(auth);
  const probe: { installed: boolean; signedIn?: boolean; help: string } = { installed: true, help: help.stdout };
  if (signedIn !== undefined) probe.signedIn = signedIn;
  return { capabilities: capabilitiesFrom(probe), executable, flags: helpFlags(help.stdout) };
}
