// VO-013 (FR-018): an Evidence claim keeps its label only with a resolving code or issue reference;
// each unresolved reference carries its reason. VO-014 (FR-019): output that fails validation becomes
// one Inference holding the raw text, with the warning `unstructured`. VO-031 (FR-017): intent is
// documented only with a resolved issue or PR-description reference, and is grouped apart.
//
// Code references are checked against a real git repository through src/repo/files.ts.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createGitSandbox, type GitSandbox } from '../helpers/git-sandbox.ts';

let sandbox: GitSandbox;
let hooks: string;
let head: string;
let base: string;

before(async () => {
  sandbox = await createGitSandbox();
  hooks = await mkdtemp(join(tmpdir(), 'prwb-hooks-'));
  head = await sandbox.git(sandbox.clone, 'rev-parse', 'HEAD');
  base = await sandbox.git(sandbox.clone, 'rev-parse', 'HEAD~1');
});
after(async () => {
  await sandbox?.cleanup();
  if (hooks !== undefined) await rm(hooks, { recursive: true, force: true });
});

async function context(overrides: Record<string, unknown> = {}) {
  const { createGit } = await import('../../src/repo/git.ts');
  const { createFileReader } = await import('../../src/repo/files.ts');
  return {
    headCommit: head,
    baseCommit: base as string | null,
    description: 'Fixes ABC-12.\n\nReset tokens are no longer single use.',
    fetchedIssues: [{ platform: 'tracker-a', key: 'ABC-12' }],
    files: createFileReader(createGit({ hooksPath: hooks }), sandbox.clone),
    ...overrides,
  };
}

const code = (path: string, startLine: number, endLine: number, side: 'head' | 'base' = 'head') => ({ kind: 'code', path, side, startLine, endLine });
const answer = (claims: unknown[]) => ({ claims, unsupportedAssumptions: ['Tokens expire.'], suggestedFollowUps: ['What expires a token?'] });

test('VO-013 Evidence claims whose references do not resolve become Inference with per-ref reasons; one resolving ref keeps Evidence', async () => {
  const { finaliseAnswer } = await import('../../src/core/claims.ts');
  const output = answer([
    { text: 'Missing path.', label: 'evidence', refs: [code('src/nope.js', 1, 2)] },
    { text: 'Past the end.', label: 'evidence', refs: [code('src/util.js', 5, 100)] },
    { text: 'Unfetched issue.', label: 'evidence', refs: [{ kind: 'issue', platform: 'tracker-a', key: 'XYZ-9' }] },
    { text: 'Only the description.', label: 'evidence', refs: [{ kind: 'pr' }] },
    { text: 'One good code ref.', label: 'evidence', refs: [code('src/nope.js', 1, 1), code('src/app.js', 40, 60)] },
    { text: 'Fetched issue.', label: 'evidence', refs: [{ kind: 'issue', platform: 'tracker-a', key: 'ABC-12' }] },
    { text: 'Removed line at base.', label: 'evidence', refs: [code('src/util.js', 1, 3, 'base')] },
    { text: 'Already inference.', label: 'inference', refs: [code('src/app.js', 1, 1)] },
  ]);
  const result = await finaliseAnswer(output, JSON.stringify(output), await context());
  assert.equal(result.warning, null);
  const [missing, past, issue, pr, good, fetched, removed, inference] = result.claims;

  assert.equal(missing?.label, 'inference');
  assert.equal(missing?.proposedLabel, 'evidence');
  assert.deepEqual(missing?.refs.map((r) => [r.resolved, r.unresolvedReason]), [[false, 'no such file at commit']]);
  assert.equal(past?.label, 'inference');
  assert.deepEqual(past?.refs.map((r) => [r.resolved, r.unresolvedReason]), [[false, 'line outside file']]);
  assert.equal(issue?.label, 'inference');
  assert.deepEqual(issue?.refs.map((r) => [r.resolved, r.unresolvedReason]), [[false, 'issue not fetched for this session']]);
  assert.equal(pr?.label, 'inference', 'the PR description alone does not keep Evidence');
  assert.equal(pr?.refs[0]?.resolved, true);

  assert.equal(good?.label, 'evidence', 'one resolving ref keeps Evidence');
  assert.deepEqual(good?.refs.map((r) => r.resolved), [false, true]);
  assert.equal(good?.refs[1]?.commit, head, 'a head ref is checked at the head commit');
  assert.equal(fetched?.label, 'evidence');
  assert.equal(removed?.label, 'evidence');
  assert.equal(removed?.refs[0]?.commit, base, 'a base ref is checked at the base commit');
  assert.equal(inference?.label, 'inference', 'the workbench never raises a label');
  assert.deepEqual(result.unsupportedAssumptions, ['Tokens expire.']);
  assert.deepEqual(result.suggestedFollowUps, ['What expires a token?']);

  const noBase = await finaliseAnswer(answer([{ text: 'Base ref.', label: 'evidence', refs: [code('src/util.js', 1, 1, 'base')] }]), '', await context({ baseCommit: null }));
  assert.equal(noBase.claims[0]?.label, 'inference');
  assert.equal(noBase.claims[0]?.refs[0]?.unresolvedReason, 'no base commit');

  const noDescription = await finaliseAnswer(answer([{ text: 'Doc.', label: 'inference', intent: 'documented', refs: [{ kind: 'pr' }] }]), '', await context({ description: '' }));
  assert.equal(noDescription.claims[0]?.refs[0]?.unresolvedReason, 'PR has no description');
});

test('VO-014 output that fails validation becomes one Inference holding the raw text, with the warning unstructured', async () => {
  const { finaliseAnswer, finaliseSummary } = await import('../../src/core/claims.ts');
  const raw = 'The change lets a token be used twice. (no JSON here)';
  for (const output of [raw, { claims: 'nope' }, { claims: [{ text: 'x', label: 'certain', refs: [] }], unsupportedAssumptions: [], suggestedFollowUps: [] }, null]) {
    const result = await finaliseAnswer(output, raw, await context());
    assert.equal(result.warning, 'unstructured');
    assert.equal(result.claims.length, 1);
    assert.equal(result.claims[0]?.text, raw);
    assert.equal(result.claims[0]?.label, 'inference');
    assert.equal(result.claims[0]?.intent, null);
    assert.deepEqual(result.claims[0]?.refs, []);
    assert.deepEqual(result.unsupportedAssumptions, []);
    assert.deepEqual(result.suggestedFollowUps, []);
  }

  const summary = await finaliseSummary({ prSummary: 'nope' }, raw, await context(), ['src/util.js']);
  assert.equal(summary.warning, 'unstructured');
  assert.equal(summary.sections.length, 1);
  assert.equal(summary.sections[0]?.kind, 'pr');
  assert.equal(summary.sections[0]?.claims[0]?.text, raw);
  assert.equal(summary.sections[0]?.claims[0]?.label, 'inference');
});

test('VO-031 intent citing the PR description or an issue is documented, citing only code is inferred, grouped apart', async () => {
  const { finaliseAnswer, intentGroups } = await import('../../src/core/claims.ts');
  const output = answer([
    { text: 'The PR says tokens become reusable.', label: 'inference', intent: 'documented', refs: [{ kind: 'pr' }] },
    { text: 'The issue asks for a second reset.', label: 'evidence', intent: 'documented', refs: [{ kind: 'issue', platform: 'tracker-a', key: 'ABC-12' }] },
    { text: 'The code suggests reuse is intended.', label: 'evidence', intent: 'documented', refs: [code('src/util.js', 1, 3)] },
    { text: 'Plain fact.', label: 'evidence', refs: [code('src/util.js', 1, 1)] },
  ]);
  const result = await finaliseAnswer(output, '', await context());
  const [pr, issue, onlyCode, plain] = result.claims;
  assert.equal(pr?.intent, 'documented');
  assert.equal(issue?.intent, 'documented');
  assert.equal(onlyCode?.intent, 'inferred');
  assert.equal(onlyCode?.proposedIntent, 'documented');
  assert.equal(plain?.intent, null);
  for (const claim of result.claims) assert.ok(claim.label === 'evidence' || claim.label === 'inference');

  const groups = intentGroups(result.claims);
  assert.deepEqual(groups.documented.map((c) => c.text), [pr?.text, issue?.text]);
  assert.deepEqual(groups.inferred.map((c) => c.text), [onlyCode?.text]);
  assert.deepEqual(groups.other.map((c) => c.text), [plain?.text]);
});
