// VO-033 (FR-022, EC-09): the provider's capability probe maps the CLI's help text to the FR-022
// restrictions. Without the restricted mode, or without only the strict MCP option, restrictions
// (c) and (d) cannot be enforced and the provider is unavailable with the reason. Without only the
// additional-directory option it stays available, with (a) and (b) reported as not enforced.

import assert from 'node:assert/strict';
import { test } from 'node:test';

const OPTIONS = {
  addDir: '  --add-dir <directories...>            Additional directories to allow tool access to',
  restricted: '  --restricted                          Restricted mode: removes the built-in tools that run commands',
  strictMcp: '  --strict-mcp-config                   Only use MCP servers from --mcp-config',
  tools: '  --tools <tools...>                    Specify the list of available tools from the built-in set',
  print: '  -p, --print                           Print response and exit',
};

function help(without: keyof typeof OPTIONS | null): string {
  return ['Usage: cli [options]', 'Options:', ...Object.entries(OPTIONS).filter(([k]) => k !== without).map(([, v]) => v)].join('\n');
}

const BLOCKING = ['no-network-tools', 'no-repository-configuration'];

test('VO-033 help text lacking --restricted, or only --strict-mcp-config, makes the provider unavailable; lacking only --add-dir leaves (a) and (b) unenforced', async () => {
  const { capabilitiesFrom } = await import('../../src/adapters/claude-code-cli/capabilities.ts');

  const full = capabilitiesFrom({ installed: true, signedIn: true, help: help(null) });
  assert.equal(full.unavailableReason, undefined);
  assert.ok(Object.values(full.restrictionsEnforced).every((v) => v), 'every restriction is enforced with the full help');

  for (const missing of ['restricted', 'strictMcp'] as const) {
    const caps = capabilitiesFrom({ installed: true, signedIn: true, help: help(missing) });
    for (const id of BLOCKING) assert.equal(caps.restrictionsEnforced[id as keyof typeof caps.restrictionsEnforced], false, `${missing}: ${id}`);
    assert.equal(typeof caps.unavailableReason, 'string', `${missing}: unavailable with a reason`);
    assert.match(caps.unavailableReason ?? '', missing === 'restricted' ? /--restricted/ : /--strict-mcp-config/);
  }

  const noAddDir = capabilitiesFrom({ installed: true, signedIn: true, help: help('addDir') });
  assert.equal(noAddDir.unavailableReason, undefined, 'still available');
  assert.equal(noAddDir.restrictionsEnforced['workspace-read-search-tools-only'], false, '(a) not enforced');
  assert.equal(noAddDir.restrictionsEnforced['no-reads-outside-workspace'], false, '(b) not enforced');
  assert.equal(noAddDir.restrictionsEnforced['no-network-tools'], true);
  assert.equal(noAddDir.restrictionsEnforced['no-repository-configuration'], true);
  assert.equal(noAddDir.restrictionsEnforced['untrusted-input-delimited'], true);

  const notInstalled = capabilitiesFrom({ installed: false });
  assert.equal(notInstalled.installed, false);
  assert.match(notInstalled.unavailableReason ?? '', /not installed/);
  const notSignedIn = capabilitiesFrom({ installed: true, signedIn: false, help: help(null) });
  assert.match(notSignedIn.unavailableReason ?? '', /not signed in/);
});
