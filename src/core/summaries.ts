// Per-snapshot summaries (FR-012, FR-051, FR-053, FR-005, FR-032; research R13, R17).
//
// `onSnapshot` is what sessions.ts calls (through main.ts) once a new snapshot has an isolated
// workspace. It first cancels, as `superseded`, the work still queued for older snapshots of the
// session (questions and summary runs alike; running work finishes against its own snapshot), then,
// when the provider is available, appends one summary run and queues it on the summary lane. A run
// streams, finalises and fails exactly as a question does, and its summary is written as sections:
// the PR summary, one per changed file, then functional and technical impact.

import { randomUUID } from 'node:crypto';
import type { Summary as WireSummary, SummaryEventData } from '../contracts/http.ts';
import type { CancelReason, ReviewStore, SummaryRun } from '../store/review-store.ts';
import { appendSections, finaliseSummary, textAsInference, wireClaims, type FinalSection } from './claims.ts';
import { readSkippedFiles, skipReason } from './completeness.ts';
import {
  AiWorkError,
  checkContext,
  fetchedIssues,
  generate,
  restrictionIds,
  restrictionLetters,
  type AiDeps,
  type RunControl,
} from './interrogation.ts';
import { buildPrompt } from './prompt.ts';

export interface Summaries {
  /** A snapshot with an isolated workspace was taken: supersede older queued work and queue its summaries. */
  onSnapshot(sessionId: string, snapshotId: string): void;
  /** Every generation for the snapshot, oldest first. */
  list(sessionId: string, snapshotId: string): WireSummary[];
}

export function createSummaries(deps: AiDeps): Summaries {
  const { store, lanes, provider } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();
  let order = 0;

  const toWire = (run: SummaryRun): WireSummary => {
    const snapshot = store.readSnapshot(run.snapshotId);
    const summary = store.readSummary(run.id);
    const prompt = store.readStoredPrompt({ summaryRunId: run.id });
    const running = lanes.state(run.id) === 'running' && prompt !== null;
    const sections = summary === null ? [] : store.listSummarySections(summary.id);
    const claimsOf = (kind: string) => sections.filter((s) => s.kind === kind).flatMap((s) => wireClaims(store, { summarySectionId: s.id }));
    const out: WireSummary = {
      summaryId: run.id,
      snapshotId: run.snapshotId,
      headCommit: snapshot?.headCommit ?? '',
      state: summary !== null ? summary.outcome : running ? 'in_progress' : 'queued',
      prSummary: claimsOf('pr'),
      files: sections.filter((s) => s.kind === 'file').map((s) => ({ path: s.path ?? '', claims: wireClaims(store, { summarySectionId: s.id }) })),
      functionalImpact: claimsOf('functional'),
      technicalImpact: claimsOf('technical'),
      skippedFiles:
        prompt === null
          ? readSkippedFiles(store, run.snapshotId)
          : prompt.excludedFiles.flatMap((f) => {
              const reason = skipReason(f.reason);
              return reason === undefined ? [] : [{ path: f.path, reason }];
            }),
      provider: run.provider,
      contextVersion: summary?.contextVersion ?? prompt?.contextVersion ?? '',
      createdAt: run.requestedAt,
      restrictionsNotEnforced: restrictionIds(summary?.restrictionsNotEnforced ?? prompt?.restrictionsNotEnforced ?? []),
    };
    if (running) out.rawText = store.listStreamChunks({ summaryRunId: run.id }).map((c) => c.text).join('');
    if (summary !== null) {
      out.completedAt = summary.finishedAt;
      if (summary.warning !== null) out.warning = summary.warning;
      if (summary.failureReason !== null) out.failureReason = summary.failureReason;
    }
    return out;
  };

  const publish = (sessionId: string, run: SummaryRun): void => {
    const { rawText: _omitted, ...event } = toWire(run);
    deps.events?.publish(sessionId, 'summary', event satisfies SummaryEventData);
  };

  const finish = (run: SummaryRun, fields: {
    outcome: 'completed' | 'cancelled' | 'failed';
    cancelReason?: CancelReason;
    failureReason?: string;
    warning?: 'unstructured' | 'cancelled' | null;
    rawText?: string;
    sections: FinalSection[];
  }): void => {
    if (store.readSummary(run.id) !== null) return;
    const prompt = store.readStoredPrompt({ summaryRunId: run.id });
    const summaryId = newId();
    store.transaction(() => {
      store.appendSummary({
        id: summaryId,
        summaryRunId: run.id,
        outcome: fields.outcome,
        cancelReason: fields.cancelReason ?? null,
        failureReason: fields.failureReason ?? null,
        warning: fields.warning ?? null,
        rawText: fields.rawText === undefined || fields.rawText === '' ? null : fields.rawText,
        contextVersion: prompt?.contextVersion ?? null,
        restrictionsNotEnforced: prompt?.restrictionsNotEnforced ?? [],
        finishedAt: now(),
      });
      appendSections(store, summaryId, fields.sections, newId);
    });
  };

  /** Text that never became checked claims, as one Inference in the PR section. */
  const asText = (text: string): FinalSection[] => {
    const claims = textAsInference(text);
    return claims.length === 0 ? [] : [{ kind: 'pr', path: null, claims }];
  };

  const run = async (sessionId: string, summaryRun: SummaryRun, control: RunControl): Promise<void> => {
    try {
      if (control.cancelReason !== null) {
        finish(summaryRun, { outcome: 'cancelled', cancelReason: control.cancelReason, sections: [] });
        return;
      }
      const env = await deps.environment();
      const snapshot = store.readSnapshot(summaryRun.snapshotId);
      if (snapshot === null) throw new Error('the snapshot is gone');
      const caps = await provider.capabilities();
      if (caps.unavailableReason !== undefined) {
        finish(summaryRun, { outcome: 'failed', failureReason: caps.unavailableReason, sections: [] });
        return;
      }
      const issues = fetchedIssues(store, sessionId);
      const files = store.listChangedFiles(snapshot.id);
      const prompt = buildPrompt({ output: 'summary', snapshot, issues, files, limits: env.limits });
      if (control.cancelReason !== null) {
        finish(summaryRun, { outcome: 'cancelled', cancelReason: control.cancelReason, sections: [] });
        return;
      }
      const generated = await generate(deps, {
        owner: { summaryRunId: summaryRun.id },
        sessionId,
        workspacePath: deps.workspacePath(sessionId, snapshot.id),
        prompt,
        output: 'summary',
        restrictions: restrictionLetters(caps),
        control,
        onStart: () => publish(sessionId, summaryRun),
        onDelta: (text) => deps.events?.publish(sessionId, 'summary-delta', { summaryId: summaryRun.id, text }),
      });
      if (generated.outcome === 'result') {
        const excluded = new Set(prompt.excludedFiles.map((f) => f.path));
        const included = files.map((f) => f.path).filter((p) => !excluded.has(p));
        const final = await finaliseSummary(generated.output, generated.rawText, checkContext(deps, env, snapshot, issues), included);
        finish(summaryRun, {
          outcome: 'completed',
          warning: final.warning,
          ...(final.warning === null ? {} : { rawText: generated.rawText }),
          sections: final.sections,
        });
      } else if (generated.outcome === 'cancelled') {
        finish(summaryRun, { outcome: 'cancelled', cancelReason: control.cancelReason ?? 'user', warning: 'cancelled', rawText: generated.rawText, sections: asText(generated.rawText) });
      } else {
        finish(summaryRun, { outcome: 'failed', failureReason: generated.reason, rawText: generated.rawText, sections: asText(generated.rawText) });
      }
    } catch (error) {
      finish(summaryRun, { outcome: 'failed', failureReason: error instanceof Error ? error.message : String(error), sections: [] });
    }
  };

  const queue = async (sessionId: string, snapshotId: string): Promise<void> => {
    const snapshot = store.readSnapshot(snapshotId);
    if (snapshot === null || snapshot.repositoryStatus !== 'found') return; // FR-005: nothing without a workspace
    const caps = await provider.capabilities();
    if (caps.unavailableReason !== undefined) return; // shown through GET /api/provider; nothing is appended
    const summaryRun: SummaryRun = { id: newId(), snapshotId, requestedAt: now(), provider: provider.id };
    store.appendSummaryRun(summaryRun);
    const control: RunControl = { requestId: newId(), cancelReason: null };
    order += 1;
    lanes.enqueue(sessionId, 'summary', {
      id: summaryRun.id,
      seq: order,
      snapshotId,
      run: async () => {
        await run(sessionId, summaryRun, control);
        publish(sessionId, summaryRun);
      },
      cancel: (reason, started) => {
        control.cancelReason = reason;
        if (started) {
          void provider.cancel(control.requestId);
          return;
        }
        finish(summaryRun, { outcome: 'cancelled', cancelReason: reason, sections: [] });
        publish(sessionId, summaryRun);
      },
    });
    publish(sessionId, summaryRun);
  };

  return {
    onSnapshot(sessionId, snapshotId) {
      lanes.cancelQueued(sessionId, 'superseded', snapshotId);
      void queue(sessionId, snapshotId).catch(() => undefined); // a failure here leaves no run: nothing to show as failed
    },

    list(sessionId, snapshotId) {
      const snapshot = store.readSnapshot(snapshotId);
      if (snapshot === null || snapshot.sessionId !== sessionId) throw new AiWorkError('not_found', 'No such snapshot.');
      return store.listSummaryRuns(snapshotId).map(toWire);
    },
  };
}
