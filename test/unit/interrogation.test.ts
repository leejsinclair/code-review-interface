// VO-035 (FR-023): with one configured provider, a question starts exactly one provider run, and
// the stored question and the answer returned name that one provider.

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AiProvider, AskEvent, AskRequest, ProviderCapabilities } from '../../src/contracts/ai-provider.ts';
import { useTempAppData } from '../helpers/app-data.ts';

const HEAD = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';

function countingProvider(id: string): AiProvider & { requests: AskRequest[] } {
  const requests: AskRequest[] = [];
  const caps: ProviderCapabilities = {
    installed: true,
    signedIn: true,
    streaming: true,
    restrictionsEnforced: {
      'workspace-read-search-tools-only': true,
      'no-reads-outside-workspace': true,
      'no-network-tools': true,
      'no-repository-configuration': true,
      'untrusted-input-delimited': true,
    },
  };
  return {
    id,
    requests,
    capabilities: async () => caps,
    async *ask(req: AskRequest): AsyncIterable<AskEvent> {
      requests.push(req);
      yield { type: 'delta', text: '{"claims":[' };
      yield {
        type: 'result',
        output: { claims: [{ text: 'Tokens can be reused.', label: 'inference', refs: [{ kind: 'pr' }] }], unsupportedAssumptions: [], suggestedFollowUps: [] },
      };
    },
    cancel: async () => undefined,
  };
}

test('VO-035 with one configured provider a question starts exactly one provider run and the stored answer names that provider', async (t) => {
  const appData = await useTempAppData(t);
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { createLanes } = await import('../../src/core/lanes.ts');
  const { createInterrogation } = await import('../../src/core/interrogation.ts');
  const { DEFAULT_LIMITS } = await import('../../src/core/limits.ts');

  const db = openDatabase(join(appData.dir, 'review.db'));
  t.after(() => db.close());
  const store = createReviewStore(db);
  const sessionId = '00000000-0000-4000-8000-000000000001';
  const snapshotId = '00000000-0000-4000-8000-000000000002';
  const at = '2026-11-07T00:00:00.000Z';
  store.appendSession({ id: sessionId, pr: { repo: { platform: 'scm-a', identifier: 'acme/widgets' }, number: 1 }, createdAt: at });
  store.upsertSessionStatus({ sessionId, prStatus: 'open', statusNote: null, lastCheckedAt: at, lastCheckedHead: HEAD, lastCheckOutcome: 'ok', lastCheckError: null, lastOpenedAt: at });
  const repo = { platform: 'scm-a', identifier: 'acme/widgets' };
  store.appendSnapshot({
    id: snapshotId, sessionId, seq: 1, takenAt: at, headCommit: HEAD, title: 'Allow password reset more than once',
    description: 'Fixes ABC-12.', author: 'alice', sourceBranch: { repo, name: 'feature' }, targetBranch: { repo, name: 'main' },
    targetCommit: HEAD, baseCommit: HEAD, diffSource: 'local', diffFingerprint: 'f', repositoryStatus: 'found',
    repositoryReason: null, headRef: 'refs/prwb/a/b/head', targetRef: 'refs/prwb/a/b/target',
  });
  const workspace = join(appData.dir, 'workspaces', sessionId, snapshotId);
  await mkdir(workspace, { recursive: true });

  const provider = countingProvider('provider-one');
  const lanes = createLanes();
  const interrogation = createInterrogation({
    store,
    lanes,
    provider,
    git: createGit({ hooksPath: join(appData.dir, 'empty-hooks') }),
    workspacePath: () => workspace,
    environment: async () => ({ clonePath: appData.dir, limits: DEFAULT_LIMITS }),
  });

  const asked = await interrogation.ask(sessionId, { scope: { type: 'pr' }, category: 'what', text: 'What changes?' });
  for (let i = 0; i < 200 && store.readAnswer(asked.questionId) === null; i += 1) await new Promise((r) => setTimeout(r, 10));

  assert.equal(provider.requests.length, 1, 'exactly one provider run');
  assert.equal(provider.requests[0]?.workspacePath, workspace);
  assert.equal(store.readQuestion(asked.questionId)?.provider, 'provider-one');
  assert.equal(store.readAnswer(asked.questionId)?.outcome, 'completed');
  const [listed] = interrogation.list(sessionId);
  assert.equal(listed?.state, 'completed');
  assert.equal(listed?.answer?.provider, 'provider-one', 'the answer names the one provider');
  assert.equal(listed?.answer?.claims.length, 1);
});
