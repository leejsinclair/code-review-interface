// Seeds the review store with one session and snapshots of changed files, without a workspace (a platform
// diff, `repositoryStatus = 'missing'`), so the risk service can be tested without git or the network.

import { randomUUID } from 'node:crypto';
import type { ClassifyFile } from '../../src/core/risk/classify.ts';
import type { ReviewStore } from '../../src/store/review-store.ts';

export const HEAD = 'a'.repeat(40);

export type SeedFile = Partial<ClassifyFile> & { path: string };

export const edit = (text: string): string => `@@ -1 +1,2 @@\n keep\n+${text}\n`;

export function seedFile(f: SeedFile): ClassifyFile {
  const patch = f.patch === undefined ? edit('changed();') : f.patch;
  return {
    oldPath: null,
    status: 'modified',
    additions: 1,
    deletions: 0,
    binary: false,
    sizeBytes: null,
    excludedReason: null,
    ...f,
    patch,
  };
}

export function seedSession(store: ReviewStore, prNumber = 1): { sessionId: string } {
  const repo = { platform: 'scm-test', identifier: 'owner/repo' };
  const sessionId = randomUUID();
  const at = '2026-11-07T10:00:00.000Z';
  store.appendSession({ id: sessionId, pr: { repo, number: prNumber }, createdAt: at });
  store.upsertSessionStatus({
    sessionId, prStatus: 'open', statusNote: null, lastCheckedAt: at, lastCheckedHead: HEAD,
    lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: at,
  });
  return { sessionId };
}

/** Appends a snapshot (a platform diff) and its changed files, in order. Returns the snapshot id. */
/** `local: true` makes it a snapshot with an isolated workspace (repository found), so an AI run can be queued for it. */
export function seedSnapshot(store: ReviewStore, sessionId: string, seq: number, files: SeedFile[], head = HEAD, local = false): string {
  const repo = { platform: 'scm-test', identifier: 'owner/repo' };
  const snapshotId = randomUUID();
  store.transaction(() => {
    store.appendSnapshot({
      id: snapshotId, sessionId, seq, takenAt: `2026-11-07T10:0${seq}:00.000Z`, headCommit: head,
      title: 'Add x', description: 'Implements it.', author: 'Ana',
      sourceBranch: { repo, name: 'feature/x' }, targetBranch: { repo, name: 'main' },
      targetCommit: local ? 'b'.repeat(40) : null, baseCommit: local ? 'c'.repeat(40) : null,
      diffSource: local ? 'local' : 'platform', diffFingerprint: `${seq}`.repeat(64).slice(0, 64),
      repositoryStatus: local ? 'found' : 'missing', repositoryReason: local ? null : 'no clone in the test',
      headRef: local ? `refs/prwb/${sessionId}/${snapshotId}/head` : null, targetRef: local ? `refs/prwb/${sessionId}/${snapshotId}/target` : null,
    });
    files.forEach((raw, ordinal) => {
      const f = seedFile(raw);
      store.appendChangedFile({
        snapshotId, ordinal, path: f.path, oldPath: f.oldPath, status: f.status, additions: f.additions, deletions: f.deletions,
        binary: f.binary, sizeBytes: f.sizeBytes, language: null, patch: f.patch, excludedReason: f.excludedReason,
      });
    });
  });
  return snapshotId;
}

/** The reference pull request's files (te../fixtures/risk/risk-reference.json). */
export async function referenceFiles(): Promise<SeedFile[]> {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile(new URL('../fixtures/risk/risk-reference.json', import.meta.url), 'utf8')) as { files: SeedFile[] };
  return raw.files.map((f) => ({ ...f, binary: f.binary === true, excludedReason: f.binary === true ? 'binary' : null }));
}
