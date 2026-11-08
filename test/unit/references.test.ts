// VO-063 (FR-003, EC-06): the same issue referenced several times, in different forms, becomes
// one reference that carries every place it was found.
//
// API required from src/core/references.ts (T065):
//
//   export type ReferenceSource = { branch: string; title: string; description: string };
//   export type CollectedReference = {
//     issue: { platform: PlatformId; key: string };
//     kind: 'issue' | 'pull-request';
//     origins: { field: 'branch' | 'title' | 'description'; text: string }[];
//     lookup: IssueLookup;               // the one lookup made for this key
//   };
//   export function collectReferences(tracker: IssueTracker, source: ReferenceSource): Promise<CollectedReference[]>;
//
// Extraction and normalisation belong to the tracker (R15), so a stand-in tracker is used: it finds
// project keys case-insensitively and normalises them to upper case, as a project-key tracker does.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueLookup, IssueTracker, RawIssueReference } from '../../src/contracts/issue-tracker.ts';

type ReferencesModule = typeof import('../../src/core/references.ts');
const load = (): Promise<ReferencesModule> => import('../../src/core/references.ts');

function standInTracker(): IssueTracker & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    id: 'tracker-a',
    lookups,
    async verifySignIn() {
      return { ok: true, account: 'someone' };
    },
    extractReferences(text: string): RawIssueReference[] {
      return [...text.matchAll(/\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g)].map((m) => ({
        platform: 'tracker-a',
        key: (m[1] ?? '').toUpperCase(),
        form: 'project-key',
        text: m[1] ?? '',
      }));
    },
    async lookup(ref: RawIssueReference): Promise<IssueLookup> {
      lookups.push(ref.key);
      return { status: 'resolved', kind: 'issue', title: `Title of ${ref.key}`, descriptionText: 'Plain text.' };
    },
  };
}

test('VO-063 the same issue in branch name, title and description in different forms is one reference with all three origins', async () => {
  const { collectReferences } = await load();
  const tracker = standInTracker();

  const refs = await collectReferences(tracker, {
    branch: 'feature/abc-12-reset',
    title: 'ABC-12: allow a second reset',
    description: 'Fixes [Abc-12].',
  });

  assert.equal(refs.length, 1, 'one reference for one issue');
  const [ref] = refs;
  assert.deepEqual(ref?.issue, { platform: 'tracker-a', key: 'ABC-12' });
  assert.equal(ref?.kind, 'issue');
  assert.deepEqual(ref?.origins, [
    { field: 'branch', text: 'abc-12' },
    { field: 'title', text: 'ABC-12' },
    { field: 'description', text: 'Abc-12' },
  ]);
});

test('VO-063 a merged reference is looked up once, and distinct issues stay apart', async () => {
  const { collectReferences } = await load();
  const tracker = standInTracker();

  const refs = await collectReferences(tracker, {
    branch: 'abc-12-and-abc-13',
    title: 'ABC-12 and ABC-13',
    description: 'ABC-12, abc-12 again, and ABC-13.',
  });

  assert.deepEqual(
    refs.map((r) => r.issue.key),
    ['ABC-12', 'ABC-13'],
  );
  assert.deepEqual([...tracker.lookups].sort(), ['ABC-12', 'ABC-13'], 'one lookup per distinct key');
  const abc12 = refs.find((r) => r.issue.key === 'ABC-12');
  assert.deepEqual(
    [...new Set(abc12?.origins.map((o) => o.field))],
    ['branch', 'title', 'description'],
    'every field it was found in is kept',
  );
  assert.equal(abc12?.lookup.status, 'resolved');
});
