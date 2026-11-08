// Start-up recovery of interrupted AI work (EC-11, FR-045, research R17). Run once after the
// workspace sweep and before any lane starts: every question and summary run with no terminal record
// was running or queued when the workbench stopped. Each gets `cancelled` with reason `restart`;
// streamed chunks become one Inference, and work that never started gets no claims.

import { randomUUID } from 'node:crypto';
import type { ReviewStore, StreamChunk } from '../store/review-store.ts';
import { appendClaims, appendSections, textAsInference } from './claims.ts';

const joined = (chunks: readonly StreamChunk[]): string => chunks.map((c) => c.text).join('');

export function recoverInterruptedWork(deps: { store: ReviewStore; now?: () => Date; newId?: () => string }): { questions: string[]; summaryRuns: string[] } {
  const { store } = deps;
  const newId = deps.newId ?? randomUUID;
  const at = (deps.now?.() ?? new Date()).toISOString();
  const questions: string[] = [];
  const summaryRuns: string[] = [];

  for (const question of store.listUnansweredQuestions()) {
    const owner = { questionId: question.id };
    const prompt = store.readStoredPrompt(owner);
    const text = joined(store.listStreamChunks(owner));
    const answerId = newId();
    store.transaction(() => {
      store.appendAnswer({
        id: answerId,
        questionId: question.id,
        outcome: 'cancelled',
        cancelReason: 'restart',
        failureReason: null,
        warning: prompt === null ? null : 'cancelled',
        rawText: text === '' ? null : text,
        unsupportedAssumptions: [],
        suggestedFollowUps: [],
        contextVersion: prompt?.contextVersion ?? null,
        restrictionsNotEnforced: prompt?.restrictionsNotEnforced ?? [],
        finishedAt: at,
      });
      appendClaims(store, { answerId }, textAsInference(text), newId);
    });
    questions.push(question.id);
  }

  for (const run of store.listUnfinishedSummaryRuns()) {
    const owner = { summaryRunId: run.id };
    const prompt = store.readStoredPrompt(owner);
    const text = joined(store.listStreamChunks(owner));
    const summaryId = newId();
    store.transaction(() => {
      store.appendSummary({
        id: summaryId,
        summaryRunId: run.id,
        outcome: 'cancelled',
        cancelReason: 'restart',
        failureReason: null,
        warning: prompt === null ? null : 'cancelled',
        rawText: text === '' ? null : text,
        contextVersion: prompt?.contextVersion ?? null,
        restrictionsNotEnforced: prompt?.restrictionsNotEnforced ?? [],
        finishedAt: at,
      });
      const claims = textAsInference(text);
      if (claims.length > 0) appendSections(store, summaryId, [{ kind: 'pr', path: null, claims }], newId);
    });
    summaryRuns.push(run.id);
  }
  return { questions, summaryRuns };
}
