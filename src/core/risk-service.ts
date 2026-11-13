// The risk service (feature 004): the only module that writes risk records. `onSnapshotStored` runs the pure
// classifier as soon as a snapshot is stored, before any workspace work, and appends the rule results in one
// transaction (RR-1). `getReport` derives the report from stored rows (data-model.md); it never writes.
// Later sections of this file add the AI lane run (US4), overrides and the reviewer lookup (US5) and the rule
// file (US6).

import { randomUUID } from 'node:crypto';
import type { OverrideBody, OverrideRecord, RiskCause, RiskClass, RiskEventData, RiskReport, RiskReviewer } from '../contracts/http.ts';
import { AdapterError } from '../contracts/shared.ts';
import type { CurrentUser } from '../contracts/source-control.ts';
import type { CancelReason, ClassOverrideRecord, ReviewStore, RiskAssessmentItem, RiskClassificationRecord, RiskRunRecord } from '../store/review-store.ts';
import { NO_CLONE_REASON_FOR_AI, restrictionLetters, sessionRepository, type AiDeps } from './interrogation.ts';
import { buildPrompt, type RiskPromptContext } from './prompt.ts';
import { assessOutput, isRiskOutput, type AssessFile } from './risk/assess.ts';
import { classifyFiles } from './risk/classify.ts';
import { isRiskClass } from './risk/classes.ts';
import { buildReport, toOverrideRecord } from './risk/effective.ts';
import { loadRuleset } from './risk/ruleset.ts';

export type RiskEvents = { publish(sessionId: string, event: string, data: unknown): number };

export type RiskServiceDeps = {
  store: ReviewStore;
  events?: RiskEvents;
  /** The application data directory (the rule file lives here). */
  appDataDir: string;
  /** The AI lane's dependencies; without them no AI assessment runs and the report says so. */
  ai?: AiDeps;
  /**
   * Reads the signed-in reviewer on the session's platform: one read-only GET through the adapter registry, never
   * cached. Without it an override that must name the reviewer is refused as a platform error.
   */
  currentUser?: (sessionId: string) => Promise<CurrentUser>;
  now?: () => Date;
  newId?: () => string;
};

export type RiskErrorCode = 'not_found' | 'read_only' | 'invalid_request' | 'signin_required' | 'platform_error';

/** A refusal the routes turn into a contract error code. */
export class RiskError extends Error {
  readonly code: RiskErrorCode;
  readonly platform: string | undefined;
  constructor(code: RiskErrorCode, message: string, platform?: string) {
    super(message);
    this.name = 'RiskError';
    this.code = code;
    this.platform = platform;
  }
}

export const MAX_OVERRIDE_REASON = 2000;

export interface RiskService {
  /** A snapshot and its changed files were just stored: classify by rules and record the result. Never throws. */
  onSnapshotStored(sessionId: string, snapshotId: string): void;
  /** A snapshot with an isolated workspace was taken: queue its AI assessment on the risk lane. Never throws. */
  onSnapshot(sessionId: string, snapshotId: string): void;
  /** Resolves when no AI work for the snapshot is queued or running (tests and shutdown). */
  whenIdle(snapshotId: string): Promise<void>;
  /** The snapshot's report, or null when the session or snapshot is unknown. */
  getReport(sessionId: string, snapshotId: string): RiskReport | null;
  /**
   * Records a reviewer's override as a new append-only record (FR-019 to FR-024). An override that takes a file
   * calculated Critical below Critical also records the platform account, read here, never sent by the client.
   */
  createOverride(sessionId: string, body: OverrideBody): Promise<OverrideRecord>;
  /** Who the platform would record for such an override; `ok: false` with the reason and the fix, never a throw. */
  currentReviewer(sessionId: string): Promise<RiskReviewer>;
  /** One file's records, oldest first. There is no query by reviewer or across files (FR-025, FR-040). */
  overrideHistory(sessionId: string, path: string): OverrideRecord[];
}

export function createRiskService(deps: RiskServiceDeps): RiskService {
  const { store } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();

  const ai = deps.ai;
  let order = 0;
  /** Lane job per snapshot while its AI assessment is queued or running. */
  const jobs = new Map<string, string>();
  const idle = new Map<string, Promise<void>>();

  function publish(sessionId: string, snapshotId: string, cause: RiskCause, changedPaths: string[]): void {
    const report = service.getReport(sessionId, snapshotId);
    if (report === null) return;
    const event: RiskEventData = { snapshotId, revision: report.revision, changedPaths, cause };
    deps.events?.publish(sessionId, 'risk', event);
  }

  const readSnapshot = (sessionId: string, snapshotId: string) => {
    const snapshot = store.readSnapshot(snapshotId);
    return snapshot !== null && snapshot.sessionId === sessionId ? snapshot : null;
  };


  /** The stored rule results of a snapshot, or an in-memory classification when none were stored. */
  const classificationsOf = (snapshotId: string): RiskClassificationRecord[] => {
    const stored = store.readRiskClassifications(snapshotId);
    if (stored.length > 0 || store.readRiskRuleset(snapshotId) !== null) return stored;
    return classifyFiles(store.listChangedFiles(snapshotId), loadRuleset(deps.appDataDir)).map((c) => ({ id: newId(), snapshotId, ...c }));
  };

  const appendRun = (run: RiskRunRecord): void => {
    try {
      store.appendRiskRun(run);
    } catch {
      // A second write for the same run, or a session deleted meanwhile: nothing more to record.
    }
  };

  const finishRun = (
    snapshotId: string,
    requestedAt: string,
    fields: Pick<RiskRunRecord, 'outcome'> & Partial<Pick<RiskRunRecord, 'cancelReason' | 'failureReason' | 'contextVersion' | 'excludedFiles' | 'restrictionsNotEnforced' | 'items'>>,
  ): RiskRunRecord => {
    const record: RiskRunRecord = {
      id: newId(),
      snapshotId,
      requestedAt,
      finishedAt: now(),
      provider: ai?.provider.id ?? 'none',
      cancelReason: null,
      failureReason: null,
      contextVersion: null,
      excludedFiles: [],
      restrictionsNotEnforced: [],
      items: [],
      ...fields,
    };
    appendRun(record);
    return record;
  };

  type Control = { requestId: string; cancelReason: CancelReason | null; done: boolean };

  /** Runs the assessment and writes the one terminal record of the run (completed, failed or cancelled). */
  const runAssessment = async (sessionId: string, snapshotId: string, requestedAt: string, control: Control): Promise<RiskRunRecord> => {
    if (ai === undefined) throw new Error('no AI dependencies');
    const cancelled = (): RiskRunRecord => finishRun(snapshotId, requestedAt, { outcome: 'cancelled', cancelReason: control.cancelReason ?? 'user' });
    try {
      if (control.cancelReason !== null) return cancelled();
      const repository = sessionRepository(store, sessionId);
      const snapshot = store.readSnapshot(snapshotId);
      if (repository === null || snapshot === null) throw new Error('the session is gone');
      const env = await ai.environmentFor(repository);
      if (env.clonePath === null) return finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: env.unavailableReason ?? NO_CLONE_REASON_FOR_AI });
      const caps = await ai.provider.capabilities();
      if (caps.unavailableReason !== undefined) return finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: caps.unavailableReason });

      const files = store.listChangedFiles(snapshotId);
      const rows = new Map(classificationsOf(snapshotId).map((c) => [c.path, c]));
      const context: RiskPromptContext[] = files.map((f) => {
        const row = rows.get(f.path);
        const ids = row === undefined ? [] : row.reasons.filter((r) => r.applied && r.ruleId !== 'DEFAULT').map((r) => r.ruleId);
        const kind = row?.mechanical === true ? (ids.includes('R-LOCKFILE') ? 'lockfile' : ids.includes('R-GENERATED') ? 'generated file' : undefined) : undefined;
        return { path: f.path, ruleClass: row?.ruleClass ?? 'normal', ruleIds: ids, ...(kind === undefined ? {} : { skip: kind }) };
      });
      const prompt = buildPrompt({ output: 'risk', snapshot, issues: [], files, risk: context, limits: env.limits });
      if (control.cancelReason !== null) return cancelled();

      let output: unknown;
      let failure: string | null = null;
      let ended = false;
      try {
        for await (const event of ai.provider.ask({
          requestId: control.requestId,
          workspacePath: ai.workspacePath(sessionId, snapshotId),
          instructions: prompt.instructions,
          data: prompt.data,
          output: 'risk',
        })) {
          if (event.type === 'result') {
            output = event.output;
            ended = true;
            break;
          }
          if (event.type === 'error') {
            failure = event.code === 'cancelled' ? null : event.message;
            ended = true;
            break;
          }
        }
      } catch (error) {
        if (control.cancelReason === null) failure = error instanceof Error ? error.message : String(error);
      }
      if (control.cancelReason !== null) return cancelled();
      const excluded = prompt.excludedFiles;
      const meta = { contextVersion: prompt.contextVersion, excludedFiles: excluded, restrictionsNotEnforced: restrictionLetters(caps) };
      if (failure !== null) return finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: failure, ...meta });
      if (!ended) return finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: 'the provider ended without a result', ...meta });
      if (!isRiskOutput(output)) {
        return finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: 'The provider returned output the workbench could not read.', ...meta });
      }
      const skipped = new Set(excluded.map((f) => f.path));
      const assessFiles: AssessFile[] = files.map((f) => ({
        path: f.path,
        ruleClass: rows.get(f.path)?.ruleClass ?? 'normal',
        assessable: !skipped.has(f.path) && f.excludedReason === null && !f.binary,
        patch: f.patch,
      }));
      const items: RiskAssessmentItem[] = assessOutput(output, assessFiles);
      return finishRun(snapshotId, requestedAt, { outcome: 'completed', items, ...meta });
    } catch (error) {
      return finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: error instanceof Error ? error.message : String(error) });
    }
  };

  const queue = async (sessionId: string, snapshotId: string): Promise<void> => {
    if (ai === undefined) return;
    ai.lanes.cancelQueued(sessionId, 'superseded', snapshotId);
    const snapshot = readSnapshot(sessionId, snapshotId);
    const status = store.readSessionStatus(sessionId);
    // Nothing is queued for a read-only session or a snapshot with no workspace; getReport says why (FR-017).
    if (snapshot === null || snapshot.repositoryStatus !== 'found' || (status !== null && status.prStatus !== 'open')) return;
    const requestedAt = now();
    const caps = await ai.provider.capabilities();
    if (caps.unavailableReason !== undefined) {
      finishRun(snapshotId, requestedAt, { outcome: 'failed', failureReason: caps.unavailableReason });
      publish(sessionId, snapshotId, 'ai', []);
      return;
    }
    const control: Control = { requestId: newId(), cancelReason: null, done: false };
    const jobId = newId();
    jobs.set(snapshotId, jobId);
    ai.lanes.enqueue(sessionId, 'risk', {
      id: jobId,
      seq: (order += 1),
      snapshotId,
      run: async () => {
        const record = await runAssessment(sessionId, snapshotId, requestedAt, control);
        control.done = true;
        publish(sessionId, snapshotId, 'ai', record.items.filter((i) => i.applied).map((i) => i.path));
      },
      cancel: (reason, started) => {
        control.cancelReason = reason;
        if (started) {
          void ai.provider.cancel(control.requestId);
          return;
        }
        finishRun(snapshotId, requestedAt, { outcome: 'cancelled', cancelReason: reason });
        publish(sessionId, snapshotId, 'ai', []);
      },
    });
    publish(sessionId, snapshotId, 'ai', []);
  };

  /** Why no AI assessment exists for a snapshot that has none and is not waiting for one. */
  const missingReason = (sessionId: string, snapshotId: string): string => {
    const snapshot = store.readSnapshot(snapshotId);
    const status = store.readSessionStatus(sessionId);
    if (ai === undefined) return 'The AI assessment is not available in this workbench.';
    if (snapshot !== null && snapshot.repositoryStatus !== 'found') {
      return `This snapshot has no isolated workspace (${snapshot.repositoryReason ?? 'repository not available'}), so no AI assessment ran.`;
    }
    if (status !== null && status.prStatus !== 'open') return `The pull request is ${status.prStatus}; the session is read-only, so no new AI assessment runs.`;
    return 'The AI assessment did not run, for example because the workbench was restarted before it finished.';
  };

  type Lookup = { ok: true; user: CurrentUser } | { ok: false; code: 'signin_required' | 'platform_error'; message: string; fix: string };

  /** Reads the signed-in reviewer; every failure becomes a refusal with a reason and a fix, never a thrown error. */
  const lookupReviewer = async (sessionId: string): Promise<Lookup> => {
    if (deps.currentUser === undefined) {
      return { ok: false, code: 'platform_error', message: 'The platform account cannot be read here, so an override that names you cannot be recorded.', fix: 'Try again when the platform is reachable.' };
    }
    try {
      return { ok: true, user: await deps.currentUser(sessionId) };
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'unauthorized') {
        return { ok: false, code: 'signin_required', message: 'The platform did not accept your sign-in, so the override that names you cannot be recorded.', fix: 'Sign in to the platform again' };
      }
      const why = error instanceof AdapterError ? ` (${error.code})` : '';
      return { ok: false, code: 'platform_error', message: `The platform could not be reached${why}, so the override that names you cannot be recorded.`, fix: 'Try again when the platform is reachable.' };
    }
  };

  const service: RiskService = {
    onSnapshotStored(sessionId, snapshotId) {
      try {
        const snapshot = readSnapshot(sessionId, snapshotId);
        if (snapshot === null || store.readRiskRuleset(snapshotId) !== null) return;
        const files = store.listChangedFiles(snapshotId);
        const ruleset = loadRuleset(deps.appDataDir);
        const classified = classifyFiles(files, ruleset);
        store.appendRiskClassification({
          ruleset: {
            snapshotId,
            rulesetVersion: ruleset.version,
            ruleFileStatus: ruleset.ruleFile,
            ruleFileNotice: ruleset.notice,
            classifiedAt: now(),
          },
          files: classified.map((c) => ({
            id: newId(),
            snapshotId,
            path: c.path,
            ruleClass: c.ruleClass,
            mechanical: c.mechanical,
            notFullyAnalysed: c.notFullyAnalysed,
            changeFingerprint: c.changeFingerprint,
            reasons: c.reasons,
          })),
        });
        publish(sessionId, snapshotId, 'classified', files.map((f) => f.path));
      } catch {
        // A classifier failure leaves the file list as it was (V.4); the report falls back to an in-memory classification.
      }
    },

    onSnapshot(sessionId, snapshotId) {
      if (ai === undefined) return;
      const work = queue(sessionId, snapshotId).catch(() => undefined);
      idle.set(snapshotId, work);
    },

    async whenIdle(snapshotId) {
      await idle.get(snapshotId);
      const job = jobs.get(snapshotId);
      if (job !== undefined && ai !== undefined) await ai.lanes.settled(job);
    },

    async createOverride(sessionId, body) {
      const snapshot = readSnapshot(sessionId, body.snapshotId);
      if (snapshot === null) throw new RiskError('not_found', 'No such snapshot.');
      const report = service.getReport(sessionId, body.snapshotId);
      if (report === null) throw new RiskError('not_found', 'No such snapshot.');
      if (!report.canOverride.allowed) throw new RiskError('read_only', report.canOverride.reason ?? 'Overrides are not available here.');
      const file = report.files.find((f) => f.path === body.path);
      const row = store.readRiskClassifications(body.snapshotId).find((c) => c.path === body.path) ?? classificationsOf(body.snapshotId).find((c) => c.path === body.path);
      if (file === undefined || row === undefined) throw new RiskError('not_found', 'No such changed file in the snapshot.');
      if (!isRiskClass(body.class)) throw new RiskError('invalid_request', 'class must be one of low, normal, elevated or critical.');
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason === '') throw new RiskError('invalid_request', 'reason is required: say why the class changes.');
      if (reason.length > MAX_OVERRIDE_REASON) throw new RiskError('invalid_request', `reason must be at most ${MAX_OVERRIDE_REASON} characters.`);
      if (body.class === file.effectiveClass) throw new RiskError('invalid_request', `The file is already ${body.class}.`);

      // A Critical class taken below Critical is accountable to a named person, read from the platform (FR-020). The
      // test is on the calculated class, so a stepwise lowering (Critical, Elevated, Low) names the reviewer each time.
      let reviewer: ClassOverrideRecord['reviewer'] = null;
      if (file.assessedClass === 'critical' && body.class !== 'critical') {
        const found = await lookupReviewer(sessionId);
        if (!found.ok) throw new RiskError(found.code, found.code === 'signin_required' ? `${found.fix}: ${found.message}` : found.message);
        reviewer = { handle: found.user.handle, name: found.user.displayName };
      }
      const record: ClassOverrideRecord = {
        id: newId(),
        sessionId,
        snapshotId: body.snapshotId,
        path: body.path,
        class: body.class,
        replacedClass: file.effectiveClass,
        calculatedClass: file.assessedClass,
        reason,
        changeFingerprint: row.changeFingerprint,
        reviewer,
        createdAt: now(),
      };
      store.appendClassOverride(record);
      publish(sessionId, body.snapshotId, 'override', [body.path]);
      return toOverrideRecord(record);
    },

    async currentReviewer(sessionId) {
      if (store.readSession(sessionId) === null) throw new RiskError('not_found', 'No such session.');
      const found = await lookupReviewer(sessionId);
      if (found.ok) return { ok: true, handle: found.user.handle, displayName: found.user.displayName };
      return { ok: false, reason: found.message, fix: found.fix };
    },

    overrideHistory(sessionId, path) {
      if (store.readSession(sessionId) === null) throw new RiskError('not_found', 'No such session.');
      return store.readOverrideHistory(sessionId, path).map(toOverrideRecord);
    },

    getReport(sessionId, snapshotId) {
      const snapshot = readSnapshot(sessionId, snapshotId);
      if (snapshot === null) return null;
      let ruleset = store.readRiskRuleset(snapshotId);
      let classifications = store.readRiskClassifications(snapshotId);
      if (ruleset === null) {
        // A snapshot stored before this feature, or whose classification failed: classify in memory, store nothing.
        const rules = loadRuleset(deps.appDataDir);
        ruleset = { snapshotId, rulesetVersion: rules.version, ruleFileStatus: rules.ruleFile, ruleFileNotice: rules.notice, classifiedAt: now() };
        classifications = classifyFiles(store.listChangedFiles(snapshotId), rules).map((c) => ({ id: newId(), snapshotId, ...c }));
      }
      const latest = store.readLatestSnapshot(sessionId);
      const status = store.readSessionStatus(sessionId);
      const overrides = new Map<string, ClassOverrideRecord>();
      for (const c of classifications) {
        const record = store.readLatestOverride(sessionId, c.path);
        if (record !== null) overrides.set(c.path, record);
      }
      const canOverride =
        status !== null && status.prStatus !== 'open'
          ? { allowed: false, reason: `The PR is ${status.prStatus}; the session is read-only.` }
          : latest !== null && latest.id !== snapshotId
            ? { allowed: false, reason: 'This is an older snapshot; overrides apply to the latest snapshot only.' }
            : { allowed: true };
      const job = jobs.get(snapshotId);
      const laneState = job === undefined || ai === undefined ? null : ai.lanes.state(job);
      const latestRun = store.readLatestRiskRun(snapshotId);
      const completedRun = store.readLatestCompletedRiskRun(snapshotId);
      const waiting = laneState === 'queued' ? 'pending' : laneState === 'running' ? 'running' : null;
      return buildReport({
        snapshotId,
        headCommit: snapshot.headCommit,
        ruleset,
        classifications,
        latestRun,
        completedRun,
        aiQueue: waiting,
        ...(latestRun === null && waiting === null ? { aiUnavailable: missingReason(sessionId, snapshotId) } : {}),
        olderHead: latest !== null && latest.id !== snapshotId,
        overrides,
        canOverride,
      });
    },
  };
  return service;
}
