#!/usr/bin/env node
// Fake AI CLI (T080). Stands in for the provider's CLI in every `npm test` run.
//
// It is started through a launcher named after the real CLI that test/helpers/fake-ai-cli.ts writes
// into a temporary bin directory placed first on PATH. Its behaviour comes from `fake-cli.json` in
// that directory, re-read on every start, so a test can change it between runs:
//
//   {
//     "scenario": "structured" | "unstructured" | "slow" | "error-on-start" | "not-signed-in",
//     "help": "full" | "no-restricted" | "no-strict-mcp" | "no-add-dir",
//     "answer":  { ...answer JSON... },      // structured output for an answer run
//     "summary": { ...summary JSON... },     // structured output for a summary run
//     "text": "raw text for the unstructured scenario",
//     "chunks": 3,                            // text deltas per run
//     "delayMs": 0                            // pause between deltas
//   }
//
// In the `slow` scenario, after its first delta a run waits until `release-<n>` (n = the run's
// 1-based invocation number) or `release-all` exists in the bin directory, or it is killed.
//
// Every invocation appends one JSON line to `invocations.jsonl` in the bin directory, holding
// argv, env, cwd, the entries of cwd at start, and everything read from stdin.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const binDir = dirname(process.argv[1] ?? '.');
const args = process.argv.slice(2);

function config() {
  try {
    return JSON.parse(readFileSync(join(binDir, 'fake-cli.json'), 'utf8'));
  } catch {
    return {};
  }
}

const HELP_LINES = {
  restricted: '  --restricted                          Restricted mode: removes the built-in tools that run commands',
  tools: '  --tools <tools...>                    Specify the list of available tools from the built-in set',
  strictMcp: '  --strict-mcp-config                   Only use MCP servers from --mcp-config',
  addDir: '  --add-dir <directories...>            Additional directories to allow tool access to',
  other: [
    '  -p, --print                           Print response and exit',
    '  --output-format <format>              Output format (only works with --print)',
    '  --input-format <format>               Input format (only works with --print)',
    '  --include-partial-messages            Include partial message chunks as they arrive',
    '  --json-schema <schema>                JSON Schema for structured output validation',
    '  --append-system-prompt <prompt>       Append a system prompt to the default system prompt',
    '  --disable-slash-commands              Disable all skills and commands',
    '  --no-session-persistence              Disable session persistence',
    '  --verbose                             Override verbose mode setting from config',
  ],
};

function helpText(variant) {
  const lines = ['Usage: claude [options] [command] [prompt]', '', 'Options:'];
  if (variant !== 'no-add-dir') lines.push(HELP_LINES.addDir);
  if (variant !== 'no-restricted') lines.push(HELP_LINES.restricted);
  if (variant !== 'no-strict-mcp') lines.push(HELP_LINES.strictMcp);
  lines.push(HELP_LINES.tools, ...HELP_LINES.other);
  return `${lines.join('\n')}\n`;
}

function record(entry) {
  appendFileSync(join(binDir, 'invocations.jsonl'), `${JSON.stringify(entry)}\n`);
}

function invocationNumber() {
  try {
    return readFileSync(join(binDir, 'invocations.jsonl'), 'utf8').split('\n').filter((l) => l !== '').length;
  } catch {
    return 0;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function emit(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`);
}

function delta(text) {
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
}

function split(text, parts) {
  const size = Math.max(1, Math.ceil(text.length / parts));
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length === 0 ? [''] : out;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function argValue(name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function main() {
  const cfg = config();
  const scenario = cfg.scenario ?? 'structured';

  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write('2.1.319 (Claude Code)\n');
    return 0;
  }
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(helpText(cfg.help ?? 'full'));
    return 0;
  }
  if (args[0] === 'auth' && args[1] === 'status') {
    process.stdout.write(`${JSON.stringify({ loggedIn: scenario !== 'not-signed-in', authMethod: 'fake' }, null, 2)}\n`);
    return scenario === 'not-signed-in' ? 1 : 0;
  }
  if (!args.includes('-p') && !args.includes('--print')) {
    process.stderr.write('fake CLI: only --version, --help, auth status and -p are supported\n');
    return 2;
  }

  const stdin = await readStdin();
  let cwdEntries = null;
  try {
    cwdEntries = readdirSync(process.cwd());
  } catch {
    cwdEntries = null;
  }
  const n = invocationNumber() + 1;
  record({ n, argv: args, env: process.env, cwd: process.cwd(), cwdEntries, stdin });

  const schema = argValue('--json-schema') ?? '';
  const kind = schema.includes('prSummary') ? 'summary' : 'answer';

  if (scenario === 'error-on-start') {
    process.stderr.write('Error: the fake provider failed to start\n');
    return 1;
  }
  if (scenario === 'not-signed-in') {
    emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    return 1;
  }

  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Read', 'Grep', 'Glob'] });

  const output = cfg[kind] ?? (kind === 'summary'
    ? { prSummary: [], files: [], functionalImpact: [], technicalImpact: [] }
    : { claims: [], unsupportedAssumptions: [], suggestedFollowUps: [] });
  const text = scenario === 'unstructured' ? (cfg.text ?? 'This is not structured output.') : JSON.stringify(output);
  const pieces = split(text, cfg.chunks ?? 3);
  for (let i = 0; i < pieces.length; i += 1) {
    delta(pieces[i]);
    if (scenario === 'slow' && i === 0) {
      // A held run also ends when the test's bin directory is gone, so no run outlives its test.
      while (!existsSync(join(binDir, `release-${n}`)) && !existsSync(join(binDir, 'release-all'))) {
        if (!existsSync(binDir)) return 4;
        await sleep(20);
      }
    }
    if (cfg.delayMs) await sleep(cfg.delayMs);
  }

  if (scenario === 'unstructured') {
    emit({ type: 'result', subtype: 'success', is_error: false, result: text });
  } else {
    emit({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: output });
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`fake CLI crashed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  },
);
