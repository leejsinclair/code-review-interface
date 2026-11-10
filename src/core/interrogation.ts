// Interrogation (FR-013 to FR-024, FR-045 to FR-048, FR-050, FR-051, FR-053; plan call path "Answer a
// question"; research R13, R14, R17).
//
// A question is refused unless the session is open, the target is its latest snapshot, that snapshot
// has an isolated workspace, and the provider is available; nothing is appended on a refusal. An
// accepted question is appended and queued on the session's question lane. When it starts, the
// prompt is stored, each streamed delta is appended as a chunk and published as `answer-delta`, and
// on the result the claims are checked and the answer appended. A queued question can be cancelled
// before it starts; a running one is cancelled by stopping the provider, its text kept as one
// Inference. A follow-up copies its parent's scope, revalidated against the latest snapshot and
// widened to the file, or the whole PR, when it no longer fits (data-model open point 6).
//
// The generation runner here (`generate`) is shared with summaries.ts.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AiProvider, AskOutput, ProviderCapabilities, RestrictionId } from '../contracts/ai-provider.ts';
import type {
  Answer as WireAnswer,
  AskBody,
  Question as WireQuestion,
  QuestionEventData,
  Scope,
  Side,
} from '../contracts/http.ts';
import { createFileReader } from '../repo/files.ts';
import type { Git } from '../repo/git.ts';
import { parseUnifiedDiff, type DiffHunk } from '../repo/unified-diff.ts';
import type {
  CancelReason,
  ChangedFile,
  GenerationOwner,
  IssueKey,
  IssuePayload,
  PrSnapshot,
  Question,
  QuestionScope,
  ReviewStore,
} from '../store/review-store.ts';
import { appendClaims, finaliseAnswer, textAsInference, wireClaims, type CheckContext } from './claims.ts';
import type { Lanes } from './lanes.ts';
import type { Limits } from './limits.ts';
import { buildPrompt, type BuiltPrompt } from './prompt.ts';

// ------------------------------------------------------------------------------- shared with summaries

/** One repository's environment: its matched clone (null when not found now, FR-057) and the limits. */
export type AiEnvironment = { clonePath: string | null; limits: Limits; unavailableReason?: string };

export const NO_CLONE_REASON_FOR_AI = 'The repository is not found under the base folder.';

export type AiDeps = {
  store: ReviewStore;
  lanes: Lanes;
  provider: AiProvider;
  events?: { publish(sessionId: string, event: string, data: unknown): unknown };
  git: Git;
  workspacePath(sessionId: string, snapshotId: string): string;
  /** The session's repository: its matched clone and the configured limits (R13). */
  environmentFor(repo: { platform: string; id: string }): Promise<AiEnvironment>;
  now?: () => Date;
  newId?: () => string;
};

export type AiErrorCode = 'not_found' | 'read_only' | 'repository_unavailable' | 'workspace_unavailable' | 'provider_unavailable' | 'invalid_request' | 'not_cancellable';

export class AiWorkError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiWorkError';
    this.code = code;
  }
}

/** Stored as the letters the data model names; (c) and (d) never reach the store (the work would not start). */
const RESTRICTION_LETTERS: Partial<Record<RestrictionId, string>> = {
  'workspace-read-search-tools-only': 'a',
  'no-reads-outside-workspace': 'b',
  'untrusted-input-delimited': 'e',
};

export function restrictionLetters(caps: ProviderCapabilities): string[] {
  return Object.entries(RESTRICTION_LETTERS)
    .filter(([id]) => !caps.restrictionsEnforced[id as RestrictionId])
    .map(([, letter]) => letter as string);
}

export function restrictionIds(letters: readonly string[]): RestrictionId[] {
  return (Object.entries(RESTRICTION_LETTERS) as Array<[RestrictionId, string]>).filter(([, l]) => letters.includes(l)).map(([id]) => id);
}

/** The session's fetched issues: the latest issue Evidence with its payload, or its last good one's. */
export function fetchedIssues(store: ReviewStore, sessionId: string): IssuePayload[] {
  const out: IssuePayload[] = [];
  for (const evidence of store.listLatestEvidence(sessionId, 'issue')) {
    const payload = evidence.payload ?? (evidence.lastGoodId === null ? null : store.readEvidence(evidence.lastGoodId)?.payload ?? null);
    if (payload !== null) out.push(payload);
  }
  return out;
}

/** The session's repository as the store holds it; null when the session is gone. */
export function sessionRepository(store: ReviewStore, sessionId: string): { platform: string; id: string } | null {
  const session = store.readSession(sessionId);
  return session === null ? null : { platform: session.pr.repo.platform, id: session.pr.repo.identifier };
}

export function checkContext(deps: AiDeps, env: AiEnvironment & { clonePath: string }, snapshot: PrSnapshot, issues: readonly IssueKey[]): CheckContext {
  return {
    headCommit: snapshot.headCommit,
    baseCommit: snapshot.baseCommit,
    description: snapshot.description,
    fetchedIssues: [...issues],
    files: createFileReader(deps.git, env.clonePath),
  };
}

/**
 * Refuses unless work can run for the session's latest snapshot (data model "AI work"): the PR is
 * open, the snapshot has an isolated workspace, and the provider is available.
 */
export async function requireReady(deps: AiDeps, sessionId: string): Promise<{ snapshot: PrSnapshot; caps: ProviderCapabilities }> {
  const status = deps.store.readSessionStatus(sessionId);
  const snapshot = deps.store.readLatestSnapshot(sessionId);
  if (status === null || snapshot === null) throw new AiWorkError('not_found', 'No such session.');
  if (status.prStatus !== 'open') throw new AiWorkError('read_only', `The PR is ${status.prStatus}; the session is read-only.`);
  const repository = sessionRepository(deps.store, sessionId);
  if (repository !== null) {
    const env = await deps.environmentFor(repository);
    if (env.clonePath === null) throw new AiWorkError('repository_unavailable', env.unavailableReason ?? NO_CLONE_REASON_FOR_AI);
  }
  if (snapshot.repositoryStatus !== 'found') throw new AiWorkError('workspace_unavailable', snapshot.repositoryReason ?? 'repository not available');
  if (!existsSync(deps.workspacePath(sessionId, snapshot.id))) {
    throw new AiWorkError('workspace_unavailable', "The session's isolated workspace is not ready; open the session again.");
  }
  const caps = await deps.provider.capabilities();
  if (caps.unavailableReason !== undefined) throw new AiWorkError('provider_unavailable', caps.unavailableReason);
  return { snapshot, caps };
}

export type Generated =
  | { outcome: 'result'; output: unknown; rawText: string }
  | { outcome: 'cancelled'; rawText: string }
  | { outcome: 'failed'; reason: string; rawText: string };

/** A started job's cancel state: set by the lane's cancel, read by the runner. */
export type RunControl = { requestId: string; cancelReason: CancelReason | null };

/**
 * Stores the prompt, runs the provider, appends and publishes each delta, and returns how it ended.
 * The caller writes the terminal record.
 */
export async function generate(
  deps: AiDeps,
  args: {
    owner: GenerationOwner;
    sessionId: string;
    workspacePath: string;
    prompt: BuiltPrompt;
    output: AskOutput;
    restrictions: string[];
    control: RunControl;
    /** The prompt is stored: the work has started. */
    onStart(): void;
    onDelta(text: string): void;
  },
): Promise<Generated> {
  const { store } = deps;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();
  store.appendStoredPrompt({
    id: (deps.newId ?? randomUUID)(),
    ...args.owner,
    instructions: args.prompt.instructions,
    data: args.prompt.data,
    contextVersion: args.prompt.contextVersion,
    excludedFiles: args.prompt.excludedFiles,
    dataChars: args.prompt.dataChars,
    restrictionsNotEnforced: args.restrictions,
    sentAt: now(),
  } as Parameters<ReviewStore['appendStoredPrompt']>[0]);
  args.onStart();

  let rawText = '';
  let seq = 0;
  try {
    for await (const event of deps.provider.ask({
      requestId: args.control.requestId,
      workspacePath: args.workspacePath,
      instructions: args.prompt.instructions,
      data: args.prompt.data,
      output: args.output,
    })) {
      if (event.type === 'delta') {
        if (event.text === '') continue;
        store.appendStreamChunk({ ...args.owner, seq, text: event.text, receivedAt: now() } as Parameters<ReviewStore['appendStreamChunk']>[0]);
        seq += 1;
        rawText += event.text;
        args.onDelta(event.text);
      } else if (event.type === 'result') {
        if (args.control.cancelReason !== null) return { outcome: 'cancelled', rawText };
        return { outcome: 'result', output: event.output, rawText };
      } else {
        if (args.control.cancelReason !== null || event.code === 'cancelled') return { outcome: 'cancelled', rawText };
        return { outcome: 'failed', reason: event.message, rawText };
      }
    }
  } catch (error) {
    if (args.control.cancelReason !== null) return { outcome: 'cancelled', rawText };
    return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error), rawText };
  }
  if (args.control.cancelReason !== null) return { outcome: 'cancelled', rawText };
  return { outcome: 'failed', reason: 'the provider ended without a result', rawText };
}

// ------------------------------------------------------------------------------- scopes

const toStoreSide = (side: Side): 'new' | 'old' => (side === 'head' ? 'new' : 'old');
const toWireSide = (side: 'new' | 'old' | null): Side => (side === 'old' ? 'base' : 'head');

export function wireScope(scope: QuestionScope): Scope {
  if (scope.type === 'pr') return { type: 'pr' };
  if (scope.type === 'file') return { type: 'file', path: scope.path ?? '' };
  const out: Scope = { type: 'range', path: scope.path ?? '', side: toWireSide(scope.side), startLine: scope.startLine ?? 1, endLine: scope.endLine ?? 1 };
  if (scope.label !== null) out.label = scope.label;
  return out;
}

/** The hunks of a stored patch (which starts at its first `@@`). */
export function patchHunks(patch: string | null): DiffHunk[] {
  if (patch === null || patch === '') return [];
  return parseUnifiedDiff(`diff --git a/f b/f\n--- a/f\n+++ b/f\n${patch}`)[0]?.hunks ?? [];
}

/** A wire scope as the store's, checked against the snapshot's changed files; throws `invalid_request`. */
export function storeScope(scope: Scope, files: readonly ChangedFile[]): QuestionScope {
  const none = { path: null, side: null, startLine: null, endLine: null, label: null };
  if (scope.type === 'pr') return { type: 'pr', ...none };
  const file = files.find((f) => f.path === scope.path);
  if (file === undefined) throw new AiWorkError('invalid_request', 'scope.path is not a changed file of the latest snapshot.');
  if (scope.type === 'file') return { type: 'file', ...none, path: file.path };
  if (scope.side === 'base' && file.status === 'added') throw new AiWorkError('invalid_request', 'An added file has no old side.');
  const shown = patchHunks(file.patch)
    .flatMap((h) => h.lines)
    .map((l) => (scope.side === 'head' ? (l.type === 'remove' ? undefined : l.newLine) : l.type === 'add' ? undefined : l.oldLine))
    .filter((n): n is number => n !== undefined);
  if (shown.length === 0 || scope.startLine < Math.min(...shown) || scope.endLine > Math.max(...shown)) {
    throw new AiWorkError('invalid_request', 'scope lines must be within the lines the diff shows for that side.');
  }
  const label = scope.label?.trim();
  return { type: 'range', path: file.path, side: toStoreSide(scope.side), startLine: scope.startLine, endLine: scope.endLine, label: label === undefined || label === '' ? null : label };
}

/** A parent's scope copied to the latest snapshot, widened when it no longer fits (open point 6). */
function copiedScope(parent: QuestionScope, files: readonly ChangedFile[]): QuestionScope {
  const wire = wireScope(parent);
  try {
    return storeScope(wire, files);
  } catch {
    if (wire.type === 'range' && files.some((f) => f.path === wire.path)) return storeScope({ type: 'file', path: wire.path }, files);
    return storeScope({ type: 'pr' }, files);
  }
}

// ------------------------------------------------------------------------------- the service

export interface Interrogation {
  ask(sessionId: string, body: AskBody): Promise<WireQuestion>;
  cancel(sessionId: string, questionId: string): Promise<WireQuestion>;
  /** Every question of the session, in asked order. */
  list(sessionId: string): WireQuestion[];
}

export function createInterrogation(deps: AiDeps): Interrogation {
  const { store, lanes, provider } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();
  const controls = new Map<string, RunControl>();

  const toWire = (q: Question): WireQuestion => {
    const snapshot = store.readSnapshot(q.snapshotId);
    const latest = store.readLatestSnapshot(q.sessionId);
    const answer = store.readAnswer(q.id);
    const prompt = store.readStoredPrompt({ questionId: q.id });
    const laneState = lanes.state(q.id);
    const state = answer !== null ? answer.outcome : laneState === 'running' && prompt !== null ? 'in_progress' : 'queued';
    const out: WireQuestion = {
      questionId: q.id,
      sessionId: q.sessionId,
      snapshotId: q.snapshotId,
      headCommit: snapshot?.headCommit ?? '',
      isLatestSnapshot: latest?.id === q.snapshotId,
      scope: wireScope(q.scope),
      category: q.category,
      text: q.text,
      answerFor: q.audience,
      state,
      askedAt: q.askedAt,
    };
    if (q.followsQuestionId !== null) out.followsQuestionId = q.followsQuestionId;
    if (answer !== null) {
      const wire: WireAnswer = {
        claims: wireClaims(store, { answerId: answer.id }),
        unsupportedAssumptions: answer.unsupportedAssumptions,
        suggestedFollowUps: answer.suggestedFollowUps,
        provider: q.provider,
        contextVersion: answer.contextVersion ?? '',
        completedAt: answer.finishedAt,
        restrictionsNotEnforced: restrictionIds(answer.restrictionsNotEnforced),
      };
      if (answer.warning !== null) wire.warning = answer.warning;
      if (answer.failureReason !== null) wire.failureReason = answer.failureReason;
      out.answer = wire;
    } else if (state === 'in_progress' && prompt !== null) {
      out.answer = {
        rawText: store.listStreamChunks({ questionId: q.id }).map((c) => c.text).join(''),
        claims: [],
        unsupportedAssumptions: [],
        suggestedFollowUps: [],
        provider: q.provider,
        contextVersion: prompt.contextVersion,
        restrictionsNotEnforced: restrictionIds(prompt.restrictionsNotEnforced),
      };
    }
    return out;
  };

  const publish = (q: Question): void => {
    const wire = toWire(q);
    const event: QuestionEventData = { ...wire } as QuestionEventData;
    if (wire.answer !== undefined) {
      const { rawText: _omitted, ...answer } = wire.answer;
      event.answer = answer;
    }
    deps.events?.publish(q.sessionId, 'question', event);
  };

  /** Appends the terminal answer and its claims. */
  const finish = (q: Question, fields: {
    outcome: 'completed' | 'cancelled' | 'failed';
    cancelReason?: CancelReason;
    failureReason?: string;
    warning?: 'unstructured' | 'cancelled' | null;
    rawText?: string;
    unsupportedAssumptions?: string[];
    suggestedFollowUps?: string[];
    claims: ReturnType<typeof textAsInference>;
  }): void => {
    if (store.readAnswer(q.id) !== null) return;
    const prompt = store.readStoredPrompt({ questionId: q.id });
    const answerId = newId();
    store.transaction(() => {
      store.appendAnswer({
        id: answerId,
        questionId: q.id,
        outcome: fields.outcome,
        cancelReason: fields.cancelReason ?? null,
        failureReason: fields.failureReason ?? null,
        warning: fields.warning ?? null,
        rawText: fields.rawText === undefined || fields.rawText === '' ? null : fields.rawText,
        unsupportedAssumptions: fields.unsupportedAssumptions ?? [],
        suggestedFollowUps: fields.suggestedFollowUps ?? [],
        contextVersion: prompt?.contextVersion ?? null,
        restrictionsNotEnforced: prompt?.restrictionsNotEnforced ?? [],
        finishedAt: now(),
      });
      appendClaims(store, { answerId }, fields.claims, newId);
    });
  };

  const run = async (q: Question, control: RunControl): Promise<void> => {
    try {
      if (control.cancelReason !== null) {
        finish(q, { outcome: 'cancelled', cancelReason: control.cancelReason, claims: [] });
        return;
      }
      const repository = sessionRepository(store, q.sessionId);
      if (repository === null) throw new Error('the session is gone');
      const found = await deps.environmentFor(repository);
      if (found.clonePath === null) {
        finish(q, { outcome: 'failed', failureReason: found.unavailableReason ?? NO_CLONE_REASON_FOR_AI, claims: [] });
        return;
      }
      const env = { ...found, clonePath: found.clonePath };
      const snapshot = store.readSnapshot(q.snapshotId);
      if (snapshot === null) throw new Error('the snapshot is gone');
      const caps = await provider.capabilities();
      if (caps.unavailableReason !== undefined) {
        finish(q, { outcome: 'failed', failureReason: caps.unavailableReason, claims: [] });
        return;
      }
      const issues = fetchedIssues(store, q.sessionId);
      let parent: { text: string; claims: Array<{ text: string; label: 'evidence' | 'inference' }> } | undefined;
      if (q.followsQuestionId !== null) {
        const p = store.readQuestion(q.followsQuestionId);
        const pa = store.readAnswer(q.followsQuestionId);
        if (p !== null && pa !== null) parent = { text: p.text, claims: store.listClaims({ answerId: pa.id }).map((c) => ({ text: c.text, label: c.label })) };
      }
      const prompt = buildPrompt({
        output: 'answer',
        snapshot,
        question: { text: q.text, category: q.category, audience: q.audience, scope: q.scope },
        issues,
        ...(parent === undefined ? {} : { parent }),
        files: store.listChangedFiles(snapshot.id),
        limits: env.limits,
      });
      if (control.cancelReason !== null) {
        finish(q, { outcome: 'cancelled', cancelReason: control.cancelReason, claims: [] });
        return;
      }
      const owner = { questionId: q.id };
      const generated = await generate(deps, {
        owner,
        sessionId: q.sessionId,
        workspacePath: deps.workspacePath(q.sessionId, snapshot.id),
        prompt,
        output: 'answer',
        restrictions: restrictionLetters(caps),
        control,
        onStart: () => publish(q),
        onDelta: (text) => deps.events?.publish(q.sessionId, 'answer-delta', { questionId: q.id, text }),
      });
      if (generated.outcome === 'result') {
        const final = await finaliseAnswer(generated.output, generated.rawText, checkContext(deps, env, snapshot, issues));
        finish(q, {
          outcome: 'completed',
          warning: final.warning,
          ...(final.warning === null ? {} : { rawText: generated.rawText }),
          unsupportedAssumptions: final.unsupportedAssumptions,
          suggestedFollowUps: final.suggestedFollowUps,
          claims: final.claims,
        });
      } else if (generated.outcome === 'cancelled') {
        finish(q, { outcome: 'cancelled', cancelReason: control.cancelReason ?? 'user', warning: 'cancelled', rawText: generated.rawText, claims: textAsInference(generated.rawText) });
      } else {
        finish(q, { outcome: 'failed', failureReason: generated.reason, rawText: generated.rawText, claims: textAsInference(generated.rawText) });
      }
    } catch (error) {
      finish(q, { outcome: 'failed', failureReason: error instanceof Error ? error.message : String(error), claims: [] });
    } finally {
      controls.delete(q.id);
    }
  };

  const enqueue = (q: Question): void => {
    const control: RunControl = { requestId: newId(), cancelReason: null };
    controls.set(q.id, control);
    lanes.enqueue(q.sessionId, 'question', {
      id: q.id,
      seq: q.seq,
      snapshotId: q.snapshotId,
      run: async () => {
        await run(q, control);
        publish(q);
      },
      cancel: (reason, started) => {
        control.cancelReason = reason;
        if (started) {
          void provider.cancel(control.requestId);
          return;
        }
        controls.delete(q.id);
        finish(q, { outcome: 'cancelled', cancelReason: reason, claims: [] });
        publish(q);
      },
    });
  };

  const requireQuestion = (sessionId: string, questionId: string): Question => {
    const q = store.readQuestion(questionId);
    if (q === null || q.sessionId !== sessionId) throw new AiWorkError('not_found', 'No such question.');
    return q;
  };

  return {
    async ask(sessionId, body) {
      const { snapshot } = await requireReady(deps, sessionId);
      const files = store.listChangedFiles(snapshot.id);
      let scope: QuestionScope;
      let text = body.text;
      let followsQuestionId: string | null = null;
      if (body.followsQuestionId !== undefined) {
        const parent = store.readQuestion(body.followsQuestionId);
        if (parent === null || parent.sessionId !== sessionId || store.readAnswer(parent.id)?.outcome !== 'completed') {
          throw new AiWorkError('invalid_request', 'followsQuestionId must name a completed question of this session.');
        }
        followsQuestionId = parent.id;
        scope = copiedScope(parent.scope, files);
      } else {
        scope = storeScope(body.scope, files);
      }
      text = text.trim();
      if (text === '') throw new AiWorkError('invalid_request', 'text must not be empty.');
      const existing = store.listQuestions(sessionId);
      const question: Question = {
        id: newId(),
        sessionId,
        snapshotId: snapshot.id,
        seq: existing.reduce((max, q) => Math.max(max, q.seq), 0) + 1,
        askedAt: now(),
        text,
        category: body.category,
        audience: body.answerFor ?? 'technical',
        scope,
        followsQuestionId,
        origin: followsQuestionId === null ? 'typed' : 'follow-up',
        provider: provider.id,
      };
      store.appendQuestion(question);
      publish(question);
      enqueue(question);
      return toWire(question);
    },

    async cancel(sessionId, questionId) {
      const q = requireQuestion(sessionId, questionId);
      if (store.readAnswer(q.id) !== null) throw new AiWorkError('not_cancellable', 'The question has already finished.');
      if (lanes.cancel(q.id, 'user')) {
        await lanes.settled(q.id);
      } else {
        // In no lane (the session was closed before it ran): end it here.
        finish(q, { outcome: 'cancelled', cancelReason: 'user', claims: [] });
        publish(q);
      }
      return toWire(q);
    },

    list: (sessionId) => store.listQuestions(sessionId).map(toWire),
  };
}
