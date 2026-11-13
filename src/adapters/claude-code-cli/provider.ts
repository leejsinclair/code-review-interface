// The `AiProvider` for the Claude Code CLI (research R12, FR-022, FR-023, X.10). A trust boundary:
// the CLI runs under every restriction the installed version can enforce.
//
// Each request runs the resolved executable without a shell, in a fresh empty directory
// `<app-data>/provider-home/<requestId>` (so no project CLAUDE.md, settings or MCP file is found
// there), with `--restricted --tools Read,Grep,Glob --strict-mcp-config --disable-slash-commands
// --no-session-persistence`, the session's worktree as the one `--add-dir`, the output schema as
// `--json-schema` and the fixed instructions as `--append-system-prompt`. The data block, which
// holds every piece of PR, issue and code text, goes in on stdin only. The environment is an
// allowlist that carries no platform token. `cancel` kills the process; the directory is removed
// after every run.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AiProvider, AskEvent, AskRequest, ProviderCapabilities } from '../../contracts/ai-provider.ts';
import { probeCapabilities, providerEnv, type Probe } from './capabilities.ts';
import { ALIGNMENT_SCHEMA, ANSWER_SCHEMA, RISK_SCHEMA, SUMMARY_SCHEMA } from './schemas.ts';
import { parseStreamLine } from './stream.ts';

export const PROVIDER_ID = 'claude-code-cli';

/** simplified: one bound for a whole run; raise it if long summaries of large PRs hit it. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const KILL_GRACE_MS = 2_000;
const MAX_STDERR = 64 * 1024;
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export type ClaudeCodeCliOptions = {
  /** `<app-data>/provider-home`: per-request working directories are made under it. */
  providerHome: string;
  timeoutMs?: number;
};

/** The CLI arguments for a request (R12). `addDir` is false when the CLI has no `--add-dir`. */
export function cliArguments(req: AskRequest, addDir: boolean): string[] {
  return [
    '-p',
    '--input-format', 'text',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--restricted',
    '--tools', 'Read,Grep,Glob',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(addDir ? ['--add-dir', req.workspacePath] : []),
    '--json-schema', JSON.stringify(req.output === 'answer' ? ANSWER_SCHEMA : req.output === 'risk' ? RISK_SCHEMA : req.output === 'alignment' ? ALIGNMENT_SCHEMA : SUMMARY_SCHEMA),
    '--append-system-prompt', req.instructions,
  ];
}

type Running = { child: ChildProcess; cancelled: boolean };

export function createClaudeCodeCliProvider(options: ClaudeCodeCliOptions): AiProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const running = new Map<string, Running>();
  let lastProbe: Probe | null = null;

  const probe = async (): Promise<Probe> => {
    await mkdir(options.providerHome, { recursive: true });
    lastProbe = await probeCapabilities({ cwd: options.providerHome });
    return lastProbe;
  };

  const kill = (run: Running): void => {
    if (run.child.exitCode !== null || run.child.signalCode !== null) return;
    run.child.kill('SIGTERM');
    const hard = setTimeout(() => {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    hard.unref();
  };

  return {
    id: PROVIDER_ID,

    async capabilities(): Promise<ProviderCapabilities> {
      return (await probe()).capabilities;
    },

    async *ask(req: AskRequest): AsyncIterable<AskEvent> {
      if (!REQUEST_ID.test(req.requestId)) {
        yield { type: 'error', code: 'failed', message: 'invalid request id' };
        return;
      }
      const found = lastProbe ?? (await probe());
      if (found.executable === null) {
        yield { type: 'error', code: 'not_installed', message: found.capabilities.unavailableReason ?? 'not installed' };
        return;
      }
      if (found.capabilities.unavailableReason !== undefined) {
        const code = found.capabilities.signedIn === false ? 'not_signed_in' : 'failed';
        yield { type: 'error', code, message: found.capabilities.unavailableReason };
        return;
      }

      const cwd = join(options.providerHome, req.requestId);
      await mkdir(options.providerHome, { recursive: true });
      await mkdir(cwd); // fails if it exists: the directory is always new and empty
      const child = spawn(found.executable.file, [...found.executable.prefix, ...cliArguments(req, found.flags.addDir)], {
        cwd,
        env: providerEnv(),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const run: Running = { child, cancelled: false };
      running.set(req.requestId, run);

      let spawnError: Error | null = null;
      let stderr = '';
      let timedOut = false;
      const exited = new Promise<number | null>((resolve) => {
        child.once('error', (error) => {
          spawnError = error;
          resolve(null);
        });
        child.once('close', (code) => resolve(code));
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < MAX_STDERR) stderr += chunk;
      });
      child.stdin?.on('error', () => undefined); // the CLI may exit before reading all of stdin
      child.stdin?.end(req.data);
      const timer = setTimeout(() => {
        timedOut = true;
        kill(run);
      }, timeoutMs);
      timer.unref();

      let ended = false;
      try {
        if (child.stdout !== null) {
          for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
            const event = parseStreamLine(line);
            if (event === null || ended || run.cancelled) continue;
            if (event.type !== 'delta') ended = true;
            yield event;
          }
        }
        const code = await exited;
        if (!ended) {
          if (run.cancelled) yield { type: 'error', code: 'cancelled', message: 'cancelled' };
          else if (timedOut) yield { type: 'error', code: 'failed', message: `the provider did not finish within ${Math.round(timeoutMs / 1000)} seconds` };
          else if (spawnError !== null) yield { type: 'error', code: 'not_installed', message: `the provider could not start: ${(spawnError as Error).message}` };
          else {
            const line = stderr.split('\n').map((l) => l.trim()).find((l) => l !== '');
            yield { type: 'error', code: 'failed', message: line ?? `the provider exited with code ${String(code)} and no result` };
          }
        }
      } finally {
        clearTimeout(timer);
        kill(run);
        running.delete(req.requestId);
        await exited;
        await rm(cwd, { recursive: true, force: true });
      }
    },

    async cancel(requestId) {
      const run = running.get(requestId);
      if (run === undefined) return;
      run.cancelled = true;
      kill(run);
    },
  };
}
