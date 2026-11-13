// The specification-context service (feature 006): the only module that writes `spec_*` records. It finds the
// specification folder for the pull request's issue keys (own repository first, then the enclosing project
// repository), stores the documents it reads with where and at which commit, queues one alignment run on the
// `alignment` lane, and derives the report from stored rows. Git access is the Repository manager's (IX.2); the
// match and choice rules are pure (spec-match.ts); the AI's output is checked in spec-alignment.ts.

import { createHash, randomUUID } from 'node:crypto';
import type { AiProvider } from '../contracts/ai-provider.ts';
import type {
  AlignmentRow,
  ImplementationState,
  SpecAlignment,
  SpecCitation,
  SpecContextEventData,
  SpecContextReport,
  SpecCopy,
  SpecDocument,
  SpecKeyResult,
  SpecLookupGap,
  SpecRule,
  SpecStatement,
} from '../contracts/http.ts';
import type { IssueTracker } from '../contracts/issue-tracker.ts';
import type { Logger } from '../log.ts';
import type { RepositoryManager } from '../repo/manager.ts';
import type {
  ReviewStore,
  SpecAlignmentItemRecord,
  SpecAlignmentRowRecord,
  SpecAlignmentRunRecord,
  SpecDocumentRecord,
  SpecLookupWithParts,
  SpecSourceRecord,
} from '../store/review-store.ts';
import { restrictionLetters, sessionRepository } from './interrogation.ts';
import type { Lanes } from './lanes.ts';
import type { Limits } from './limits.ts';
import { buildPrompt, type PromptDocument } from './prompt.ts';
import { finaliseAlignment, type FinalCitation, type FinalStatement } from './spec-alignment.ts';
import { chooseCopy, chooseDocumentFiles, keyMatchesName, matchingFolders, type SpecCandidate } from './spec-match.ts';

export type SpecContextEnvironment = { repositoryId: string; clonePath: string | null; tracker: IssueTracker; limits: Limits };

export type SpecContextDeps = {
  store: ReviewStore;
  manager: RepositoryManager;
  lanes: Lanes;
  provider: AiProvider;
  events?: { publish(sessionId: string, event: string, data: unknown): unknown };
  workspace: {
    cloneFor(repositoryId: string): string | null;
    /** The repository id of the nearest enclosing discovered clone, or null (research R1). */
    enclosingOf(repositoryId: string): string | null;
  };
  environmentFor(sessionId: string): SpecContextEnvironment | null;
  workspacePath(sessionId: string, snapshotId: string): string;
  now?: () => Date;
  newId?: () => string;
  /** Records a lookup the store refused, so it is not lost silently. */
  logger?: Pick<Logger, 'log'>;
};

export type SpecContextErrorCode = 'not_found' | 'read_only' | 'conflict' | 'invalid_request';

/** A refusal the routes turn into a contract error code. */
export class SpecContextError extends Error {
  readonly code: SpecContextErrorCode;
  constructor(code: SpecContextErrorCode, message: string) {
    super(message);
    this.name = 'SpecContextError';
    this.code = code;
  }
}

export interface SpecContextService {
  /** A snapshot was stored: start the lookup. Returns at once; never throws. */
  onSnapshotStored(sessionId: string, snapshotId: string): void;
  /** The snapshot's workspace exists: wait for the lookup, then queue one alignment run. Never throws. */
  onSnapshot(sessionId: string, snapshotId: string): void;
  /** A same-head refresh: re-check the documents, acting only when something moved. Never throws. */
  onRefreshed(sessionId: string, snapshotId: string): void;
  /** The report, derived on read. Throws `not_found` for an unknown snapshot; never for git or the AI. */
  report(sessionId: string, snapshotId: string): Promise<SpecContextReport>;
  /** A stored document with the snapshot it belongs to, or null. */
  document(sessionId: string, snapshotId: string, documentId: string): { text: string } | null;
  /** Queues a new run on the stored documents (or a new lookup when none were found). */
  retry(sessionId: string, snapshotId: string): Promise<{ runId: string }>;
  /** Resolves once every lookup and run the service started for the session has ended. */
  settled(sessionId: string): Promise<void>;
}

const RESTART_NOTICE = 'Alignment assessment missing: the workbench was restarted before it finished. Retry the assessment.';
const STATE_LABEL: Record<SpecAlignmentRowRecord['implementationState'], ImplementationState> = {
  'implementation-and-test': 'Implementation and test identified',
  implementation: 'Implementation identified',
  'requires-verification': 'Requires verification',
  'not-found': 'Not found',
};
const STATE_VALUE: Record<ImplementationState, SpecAlignmentRowRecord['implementationState']> = {
  'Implementation and test identified': 'implementation-and-test',
  'Implementation identified': 'implementation',
  'Requires verification': 'requires-verification',
  'Not found': 'not-found',
};
const RULE_STORED: Record<SpecRule, SpecSourceRecord['ruleUsed']> = {
  'own-repository-first': 'own-repository-first',
  'matching-branch-over-develop': 'matching-branch',
  'most-recent-commit': 'most-recent-commit',
  'only-candidate': 'only-match',
};
const RULE_WIRE: Record<SpecSourceRecord['ruleUsed'], SpecRule> = {
  'own-repository-first': 'own-repository-first',
  'matching-branch': 'matching-branch-over-develop',
  develop: 'matching-branch-over-develop',
  'most-recent-commit': 'most-recent-commit',
  'only-match': 'only-candidate',
};

const firstLine = (message: string): string => message.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? 'unknown error';
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const errorText = (error: unknown): string => firstLine(error instanceof Error ? error.message : String(error));

type Payload = { path: string; content: string; otherSpecFiles: string[] };
type LookupParts = Pick<SpecLookupWithParts, 'lookup' | 'sources' | 'documents'>;

/** What the lookup chose, as strings: two lookups with the same signature hold the same documents. */
const signature = (parts: Pick<SpecLookupWithParts, 'sources' | 'documents'>): string => {
  const sources = new Map(parts.sources.map((s) => [s.id, s]));
  return JSON.stringify(
    parts.documents.map((d) => {
      const s = d.sourceId === null ? undefined : sources.get(d.sourceId);
      return [d.key, d.kind, d.status, s?.repository, s?.branch, s?.folder, d.commitSha, d.contentSha256];
    }),
  );
};

export function createSpecContextService(deps: SpecContextDeps): SpecContextService {
  const { store, manager, lanes, provider } = deps;
  const newId = deps.newId ?? randomUUID;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();

  /** Lookups and runs this process started, per session, so `settled` can wait for them. */
  const work = new Map<string, Set<Promise<unknown>>>();
  const inflightLookup = new Map<string, number>();
  const inflightRun = new Map<string, number>();
  const jobs = new Map<string, { jobId: string; runId: string }>();
  const revisions = new Map<string, number>();

  const track = (sessionId: string, promise: Promise<unknown>): void => {
    const set = work.get(sessionId) ?? new Set<Promise<unknown>>();
    work.set(sessionId, set);
    set.add(promise);
    void promise.finally(() => set.delete(promise));
  };
  const count = (map: Map<string, number>, id: string, by: number): void => void map.set(id, Math.max(0, (map.get(id) ?? 0) + by));

  const readSnapshot = (sessionId: string, snapshotId: string) => {
    const snapshot = store.readSnapshot(snapshotId);
    return snapshot !== null && snapshot.sessionId === sessionId ? snapshot : null;
  };

  const publish = (sessionId: string, snapshotId: string, cause: SpecContextEventData['cause']): void => {
    const revision = (revisions.get(snapshotId) ?? 0) + 1;
    revisions.set(snapshotId, revision);
    const data: SpecContextEventData = { snapshotId, revision, cause };
    try {
      deps.events?.publish(sessionId, 'spec-context', data);
    } catch {
      // A subscriber failure never stops the lookup.
    }
  };

  // ------------------------------------------------------------------------------------------ the lookup

  /** Searches the repositories and returns the records to store. Never throws; failures become reasons. */
  const search = async (sessionId: string, snapshotId: string, trigger: 'snapshot' | 'refresh'): Promise<LookupParts | null> => {
    const snapshot = readSnapshot(sessionId, snapshotId);
    const env = deps.environmentFor(sessionId);
    if (snapshot === null || env === null) return null;
    const lookupId = newId();
    const text = [snapshot.sourceBranch.name, snapshot.title, snapshot.description].join('\n');
    const keys = [...new Set(env.tracker.extractReferences(text).map((r) => String(r.key)))];
    const base = { id: lookupId, snapshotId, lookedAt: now(), trigger, keys, searched: [] as LookupParts['lookup']['searched'] };

    if (keys.length === 0) {
      return {
        lookup: { ...base, enclosingNote: null, outcome: 'no-key', reason: 'No key was found to search with in the branch name, title or description.' },
        sources: [],
        documents: [],
      };
    }

    const enclosingId = deps.workspace.enclosingOf(env.repositoryId);
    const repos: Array<{ id: string; role: 'own' | 'enclosing'; clone: string | null }> = [
      { id: env.repositoryId, role: 'own', clone: env.clonePath },
      ...(enclosingId === null ? [] : [{ id: enclosingId, role: 'enclosing' as const, clone: deps.workspace.cloneFor(enclosingId) }]),
    ];
    const candidates = new Map<string, Map<SpecCandidate, Payload>>();
    const failures: string[] = [];
    let searchedAny = false;
    let refN = 0;

    for (const repo of repos) {
      if (repo.clone === null) continue;
      try {
        const url = (await manager.readRemotes(repo.clone))[0];
        if (url === undefined) throw new Error('the clone has no remote');
        const heads = await manager.listRemoteBranches(repo.clone, url);
        const considered = heads.filter((h) => h.branch === 'develop' || keys.some((k) => keyMatchesName(k, h.branch)));
        base.searched.push({ repository: repo.id, role: repo.role, heads: considered.map((h) => h.branch) });
        searchedAny = true;
        for (const head of considered) {
          const fetched = await manager.fetchSpecRef({ clonePath: repo.clone, remoteUrl: url, branch: head.branch, sessionId, snapshotId, n: (refN += 1) });
          const paths = await manager.listSpecFiles(repo.clone, fetched.commit);
          for (const key of keys) {
            for (const folder of matchingFolders(key, paths)) {
              const chosen = chooseDocumentFiles(paths.filter((p) => p.startsWith(`${folder}/`)));
              for (const [kind, file] of [['specification', chosen.specFile], ['tdd-evidence', chosen.evidenceFile]] as const) {
                if (file === null) continue;
                const read = await manager.readSpecFile({ clonePath: repo.clone, commit: fetched.commit, path: file, maxBytes: env.limits.maxFileBytes });
                const candidate: SpecCandidate = { repository: repo.id, role: repo.role, branch: head.branch, commit: read.commit, committedAt: read.committedAt, folder };
                const bucket = candidates.get(`${key}\n${kind}`) ?? new Map<SpecCandidate, Payload>();
                candidates.set(`${key}\n${kind}`, bucket);
                bucket.set(candidate, { path: file, content: read.content, otherSpecFiles: kind === 'specification' ? chosen.otherSpecFiles : [] });
              }
            }
          }
        }
      } catch (error) {
        failures.push(errorText(error));
      }
    }

    const sources: SpecSourceRecord[] = [];
    const documents: SpecDocumentRecord[] = [];
    const noneSearched = !searchedAny;
    for (const key of keys) {
      for (const kind of ['specification', 'tdd-evidence'] as const) {
        const bucket = candidates.get(`${key}\n${kind}`);
        const choice = bucket === undefined ? null : chooseCopy(key, [...bucket.keys()]);
        if (choice === null || bucket === undefined) {
          const sawFolder = [...candidates.keys()].some((k) => k.startsWith(`${key}\n`));
          const reason = failures.length > 0 && !sawFolder ? `read failed: ${failures[0]}` : noneSearched ? 'no clone' : sawFolder ? (kind === 'specification' ? 'no specification file' : 'no evidence file') : 'no folder';
          documents.push({ id: newId(), key, kind, status: 'missing', sourceId: null, filePath: null, commitSha: null, content: null, contentSha256: null, otherFiles: [], missingReason: reason });
          continue;
        }
        const payload = bucket.get(choice.used) as Payload;
        const copy = (c: SpecCandidate) => ({ repository: c.repository, branch: c.branch, commitSha: c.commit, folder: c.folder });
        const source: SpecSourceRecord = {
          id: newId(), key, ...copy(choice.used), ruleUsed: RULE_STORED[choice.rule], otherCopies: choice.others.map(copy),
          developCopyExists: choice.used.branch !== 'develop' && choice.others.some((o) => o.branch === 'develop'), matchesKey: true,
        };
        sources.push(source);
        documents.push({
          id: newId(), key, kind, status: 'found', sourceId: source.id, filePath: payload.path, commitSha: choice.used.commit,
          content: payload.content, contentSha256: sha256(payload.content), otherFiles: payload.otherSpecFiles, missingReason: null,
        });
      }
    }

    const missing = documents.filter((d) => d.status === 'missing');
    const foundSpec = documents.some((d) => d.kind === 'specification' && d.status === 'found');
    let outcome: LookupParts['lookup']['outcome'] = 'found';
    let reason: string | null = null;
    if (missing.length > 0) {
      outcome = foundSpec ? 'partial' : failures.length > 0 && !searchedAny ? 'failed' : 'not-found';
      reason = outcome === 'failed' ? (failures[0] ?? 'read failed') : missing.map((d) => `${d.key} ${d.kind}: ${d.missingReason ?? ''}`).join('; ');
    }
    return {
      lookup: { ...base, enclosingNote: enclosingId === null ? 'not-inside-project' : 'found', outcome, reason },
      sources,
      documents,
    };
  };

  const storeLookup = (parts: LookupParts): void => {
    try {
      store.appendSpecLookup(parts);
    } catch (error) {
      // The session was deleted meanwhile, or the record was refused: nothing to show, but say why in the log.
      void Promise.resolve(
        deps.logger?.log({ op: 'spec-lookup.store', outcome: 'failed', durationMs: 0, snapshotId: parts.lookup.snapshotId, errorMessage: errorText(error) }),
      ).catch(() => undefined);
    }
  };

  const startLookup = (sessionId: string, snapshotId: string, trigger: 'snapshot' | 'refresh'): Promise<void> => {
    count(inflightLookup, snapshotId, 1);
    const promise = (async () => {
      try {
        const parts = await search(sessionId, snapshotId, trigger);
        if (parts !== null) storeLookup(parts);
      } catch {
        // search never throws; a store failure leaves the report at "none".
      } finally {
        count(inflightLookup, snapshotId, -1);
        publish(sessionId, snapshotId, 'lookup');
      }
    })();
    track(sessionId, promise);
    return promise;
  };

  // ------------------------------------------------------------------------------------------ the run

  type Control = { requestId: string; cancelReason: 'user' | 'restart' | 'superseded' | null };

  const finishRun = (
    sessionId: string,
    snapshotId: string,
    runId: string,
    lookup: SpecLookupWithParts,
    docs: { spec: SpecDocumentRecord; tdd: SpecDocumentRecord | null },
    requestedAt: string,
    fields: Partial<SpecAlignmentRunRecord> & Pick<SpecAlignmentRunRecord, 'outcome'>,
  ): void => {
    const record: SpecAlignmentRunRecord = {
      id: runId, snapshotId, lookupId: lookup.lookup.id, specDocumentId: docs.spec.id, tddDocumentId: docs.tdd?.id ?? null,
      requestedAt, finishedAt: now(), provider: provider.id, contextVersion: null, cancelReason: null, failureReason: null,
      specSummary: null, tddSummary: null, verdict: null, verdictText: null, leftOut: [], restrictionsNotEnforced: [], warning: null,
      rows: [], items: [], ...fields,
    };
    try {
      store.appendSpecAlignmentRun(record);
    } catch (error) {
      // A refused record must not read as a restart: record the refusal as a failed run, once.
      if (record.outcome === 'completed') {
        try {
          store.appendSpecAlignmentRun({ ...record, outcome: 'failed', failureReason: `The assessment could not be stored: ${errorText(error)}`, specSummary: null, tddSummary: null, verdict: null, verdictText: null, rows: [], items: [] });
        } catch {
          // The session was deleted meanwhile.
        }
      }
    }
  };

  /** The documents a run uses: the first key with a found specification, and that key's evidence when found. */
  const documentsOf = (lookup: SpecLookupWithParts): { spec: SpecDocumentRecord; tdd: SpecDocumentRecord | null } | null => {
    for (const key of lookup.lookup.keys) {
      const spec = lookup.documents.find((d) => d.key === key && d.kind === 'specification' && d.status === 'found');
      if (spec === undefined) continue;
      const tdd = lookup.documents.find((d) => d.key === key && d.kind === 'tdd-evidence' && d.status === 'found') ?? null;
      return { spec, tdd };
    }
    return null;
  };

  const toRows = (final: ReturnType<typeof finaliseAlignment>): { rows: SpecAlignmentRowRecord[]; items: SpecAlignmentItemRecord[] } => {
    const cites = (s: FinalStatement): FinalCitation[] => s.citations;
    const rows: SpecAlignmentRowRecord[] = final.rows.map((r, ordinal) => ({
      ordinal, criterionRef: r.criterionId, criterionText: r.criterion.trim() === '' ? r.criterionId : r.criterion,
      implementationState: STATE_VALUE[r.state], testShown: r.test === 'test-shown' ? 'shown' : r.test === 'no-test-shown' ? 'none' : 'no-evidence-available',
      testMismatch: r.testMismatch, note: r.reason.text, unverified: r.reason.citationStatus === 'unverified', citations: cites(r.reason),
    }));
    const items: SpecAlignmentItemRecord[] = [];
    const add = (kind: SpecAlignmentItemRecord['kind'], rowOrdinal: number | null, text: string, s: FinalStatement | null): void => {
      const row = rowOrdinal === null ? undefined : rows[rowOrdinal];
      items.push({
        ordinal: items.length, kind, rowOrdinal, text: text.trim() === '' ? '(no text)' : text,
        unverified: s === null ? (row?.unverified ?? true) : s.citationStatus === 'unverified', citations: s === null ? (row?.citations ?? []) : cites(s),
      });
    };
    if (rows.length > 0) {
      for (const id of final.verdict.uncovered) {
        const at = rows.findIndex((r) => r.criterionRef === id);
        if (at !== -1) add('uncovered-criterion', at, `Criterion ${id} has no test shown.`, null);
      }
      const mismatchRows = rows.flatMap((r) => (r.testMismatch ? [r.ordinal] : []));
      final.verdict.mismatched.forEach((s, i) => add('test-may-not-test-right-thing', mismatchRows[i] ?? mismatchRows[mismatchRows.length - 1] ?? 0, s.text, s));
      final.deviations.requestedNotImplemented.forEach((s, i) => {
        const named = rows.findIndex((r) => r.criterionRef !== null && s.text.toLowerCase().includes(r.criterionRef.toLowerCase()));
        const notFound = rows.filter((r) => r.implementationState === 'not-found').map((r) => r.ordinal);
        add('requested-not-implemented', named !== -1 ? named : (notFound[i] ?? 0), s.text, s);
      });
    }
    for (const s of final.deviations.implementedNotRequested) add('implemented-not-requested', null, s.text, s);
    return { rows, items };
  };

  const runAlignment = async (sessionId: string, snapshotId: string, runId: string, lookup: SpecLookupWithParts, requestedAt: string, control: Control): Promise<void> => {
    const docs = documentsOf(lookup);
    if (docs === null) return;
    const finish = (fields: Partial<SpecAlignmentRunRecord> & Pick<SpecAlignmentRunRecord, 'outcome'>): void =>
      finishRun(sessionId, snapshotId, runId, lookup, docs, requestedAt, fields);
    const cancelled = (): void => finish({ outcome: 'cancelled', cancelReason: control.cancelReason ?? 'user' });
    try {
      if (control.cancelReason !== null) return cancelled();
      const snapshot = store.readSnapshot(snapshotId);
      const env = deps.environmentFor(sessionId);
      if (snapshot === null || env === null) return finish({ outcome: 'failed', failureReason: 'the session is gone' });
      const caps = await provider.capabilities();
      if (caps.unavailableReason !== undefined) return finish({ outcome: 'failed', failureReason: caps.unavailableReason });

      const files = store.listChangedFiles(snapshotId);
      const promptDocs: PromptDocument[] = [docs.spec, ...(docs.tdd === null ? [] : [docs.tdd])].map((d) => ({
        documentId: d.id, kind: d.kind, path: d.filePath ?? '', text: d.content ?? '',
      }));
      const prompt = buildPrompt({ output: 'alignment', snapshot, issues: [], files, documents: promptDocs, limits: env.limits });
      if (control.cancelReason !== null) return cancelled();

      let output: unknown;
      let raw = '';
      let failure: string | null = null;
      try {
        for await (const event of provider.ask({
          requestId: control.requestId, workspacePath: deps.workspacePath(sessionId, snapshotId),
          instructions: prompt.instructions, data: prompt.data, output: 'alignment',
        })) {
          if (event.type === 'delta') raw += event.text;
          if (event.type === 'result') {
            output = event.output;
            break;
          }
          if (event.type === 'error') {
            failure = event.code === 'cancelled' ? null : event.message;
            break;
          }
        }
      } catch (error) {
        if (control.cancelReason === null) failure = errorText(error);
      }
      if (control.cancelReason !== null) return cancelled();
      const meta = { contextVersion: prompt.contextVersion, restrictionsNotEnforced: restrictionLetters(caps) };
      if (failure !== null) return finish({ outcome: 'failed', failureReason: failure, ...meta });

      const final = finaliseAlignment(output, raw, {
        documents: [{ documentId: docs.spec.id, kind: 'specification', content: docs.spec.content ?? '' }, ...(docs.tdd === null ? [] : [{ documentId: docs.tdd.id, kind: 'tdd-evidence' as const, content: docs.tdd.content ?? '' }])],
        files: files.map((f) => ({ path: f.path, patch: f.patch })),
        leftOut: prompt.leftOut,
      });
      const leftOut = final.leftOut.map((l) => ({ document: l.document, part: l.part, reason: l.reason }));
      if (final.warning !== null) {
        const text = final.inference.map((c) => c.text).join('\n').trim();
        return finish({
          outcome: 'completed', ...meta, leftOut, warning: final.warning, verdict: 'cannot-judge',
          verdictText: 'Testing cannot be judged: the provider returned output the workbench could not read.',
          specSummary: text === '' ? 'The provider returned no readable output.' : text.slice(0, 4000),
        });
      }
      const { rows, items } = toRows(final);
      return finish({
        outcome: 'completed', ...meta, leftOut, rows, items, verdict: final.verdict.outcome, verdictText: final.verdict.statement.text || 'No verdict text was given.',
        specSummary: final.summaries.specification.text || 'No summary was given.',
        tddSummary: docs.tdd === null ? null : (final.summaries.tddEvidence?.text ?? null),
      });
    } catch (error) {
      finish({ outcome: 'failed', failureReason: errorText(error) });
    }
  };

  /** A newer snapshot makes the other snapshots' queued and running runs superseded. */
  const supersedeOthers = (sessionId: string, snapshotId: string): void => {
    lanes.cancelQueued(sessionId, 'superseded', snapshotId);
    for (const [other, job] of jobs) if (other !== snapshotId && lanes.state(job.jobId) !== null) lanes.cancel(job.jobId, 'superseded');
  };

  /** Queues the run for the snapshot's latest lookup. Cancels the session's other snapshots' runs as superseded. */
  const queueRun = (sessionId: string, snapshotId: string, runId: string): Promise<void> => {
    const snapshot = readSnapshot(sessionId, snapshotId);
    const status = store.readSessionStatus(sessionId);
    const lookup = store.readLatestSpecLookup(snapshotId);
    if (snapshot === null || lookup === null || documentsOf(lookup) === null) return Promise.resolve();
    if (snapshot.repositoryStatus !== 'found' || (status !== null && status.prStatus !== 'open')) return Promise.resolve();

    supersedeOthers(sessionId, snapshotId);

    const requestedAt = now();
    const control: Control = { requestId: newId(), cancelReason: null };
    const jobId = newId();
    jobs.set(snapshotId, { jobId, runId });
    count(inflightRun, snapshotId, 1);
    const docs = documentsOf(lookup) as NonNullable<ReturnType<typeof documentsOf>>;
    lanes.enqueue(sessionId, 'alignment', {
      id: jobId,
      seq: Date.now(),
      snapshotId,
      run: async () => {
        try {
          await runAlignment(sessionId, snapshotId, runId, lookup, requestedAt, control);
        } finally {
          count(inflightRun, snapshotId, -1);
          publish(sessionId, snapshotId, 'alignment');
        }
      },
      cancel: (reason, started) => {
        control.cancelReason = reason;
        if (started) {
          void provider.cancel(control.requestId);
          return;
        }
        count(inflightRun, snapshotId, -1);
        finishRun(sessionId, snapshotId, runId, lookup, docs, requestedAt, { outcome: 'cancelled', cancelReason: reason });
        publish(sessionId, snapshotId, 'alignment');
      },
    });
    publish(sessionId, snapshotId, 'alignment');
    return lanes.settled(jobId);
  };

  // ------------------------------------------------------------------------------------------ the report

  const citation = (c: FinalCitation | Record<string, unknown>): SpecCitation | null => {
    const r = c as Record<string, unknown>;
    const type = r['type'] ?? r['kind'];
    const start = typeof r['startLine'] === 'number' ? r['startLine'] : 1;
    const end = typeof r['endLine'] === 'number' ? r['endLine'] : start;
    if (type === 'code' && typeof r['path'] === 'string') {
      return { type: 'code', path: r['path'], side: r['side'] === 'base' ? 'base' : 'head', startLine: start, endLine: end };
    }
    if ((type === 'spec' || type === 'tdd') && typeof (r['documentId'] ?? r['document_id']) === 'string') {
      return { type, documentId: String(r['documentId'] ?? r['document_id']), startLine: start, endLine: end, ...(typeof r['quote'] === 'string' ? { quote: r['quote'] } : {}) };
    }
    return null;
  };

  const statement = (text: string, citations: unknown[], unverified: boolean): SpecStatement => ({
    label: 'Inferred',
    text,
    citations: citations.map((c) => citation(c as Record<string, unknown>)).filter((c): c is SpecCitation => c !== null),
    citationStatus: unverified ? 'unverified' : 'resolved',
  });

  const alignmentOf = (
    sessionId: string,
    snapshotId: string,
    headCommit: string,
    lookup: SpecLookupWithParts | null,
    stale: { stale: boolean; reason?: string },
  ): SpecAlignment | undefined => {
    if (lookup === null || documentsOf(lookup) === null) return undefined;
    const staleFields = stale.stale ? { stale: true, ...(stale.reason === undefined ? {} : { staleReason: stale.reason }) } : { stale: false };
    const job = jobs.get(snapshotId);
    const laneState = job === undefined ? null : lanes.state(job.jobId);
    if (laneState !== null && job !== undefined) {
      return { runId: job.runId, state: laneState === 'queued' ? 'pending' : 'running', headCommit, leftOut: [], rows: [], ...staleFields };
    }
    const run = store.readLatestSpecAlignmentRun(snapshotId);
    if (run === null) {
      const snapshot = store.readSnapshot(snapshotId);
      const status = store.readSessionStatus(sessionId);
      const reason =
        (inflightRun.get(snapshotId) ?? 0) + (inflightLookup.get(snapshotId) ?? 0) > 0
          ? undefined
          : snapshot !== null && snapshot.repositoryStatus !== 'found'
            ? `This snapshot has no isolated workspace (${snapshot.repositoryReason ?? 'repository not available'}), so no assessment ran.`
            : status !== null && status.prStatus !== 'open'
              ? `The pull request is ${status.prStatus}; the session is read-only, so no new assessment runs.`
              : RESTART_NOTICE;
      return reason === undefined
        ? { runId: '', state: 'pending', headCommit, leftOut: [], rows: [], ...staleFields }
        : { runId: '', state: 'failed', reason, headCommit, leftOut: [], rows: [], ...staleFields };
    }
    const base: SpecAlignment = {
      runId: run.id, state: run.outcome, provider: run.provider, ...(run.contextVersion === null ? {} : { contextVersion: run.contextVersion }),
      finishedAt: run.finishedAt, headCommit, leftOut: run.leftOut.map((l) => `${l.document}: ${l.part}`), rows: [], ...staleFields,
    };
    if (run.outcome === 'failed') return { ...base, reason: run.failureReason ?? 'The assessment failed.' };
    if (run.outcome === 'cancelled') {
      return { ...base, reason: run.cancelReason === 'superseded' ? 'Superseded: a newer snapshot was taken.' : run.cancelReason === 'restart' ? RESTART_NOTICE : 'The assessment was cancelled.' };
    }
    const rows: AlignmentRow[] = run.rows.map((r) => ({
      criterionId: r.criterionRef ?? r.criterionText, criterion: r.criterionText, state: STATE_LABEL[r.implementationState],
      test: r.testShown === 'shown' ? 'test-shown' : r.testShown === 'none' ? 'no-test-shown' : 'no-evidence-available',
      testMismatch: r.testMismatch, statement: statement(r.note, r.citations, r.unverified),
    }));
    const itemsOf = (kind: SpecAlignmentItemRecord['kind']): SpecStatement[] => run.items.filter((i) => i.kind === kind).map((i) => statement(i.text, i.citations, i.unverified));
    const tddMissing = run.tddDocumentId === null;
    const implemented = itemsOf('implemented-not-requested');
    const requested = itemsOf('requested-not-implemented');
    return {
      ...base, rows,
      ...(run.specSummary === null ? {} : { summaries: { specification: run.specSummary, ...(run.tddSummary === null ? {} : { tddEvidence: run.tddSummary }) } }),
      ...(run.verdict === null ? {} : {
        verdict: {
          outcome: run.verdict, statement: { label: 'Inferred' as const, text: run.verdictText ?? '', citations: [], citationStatus: 'unverified' as const },
          uncovered: rows.filter((r) => r.test === 'no-test-shown').map((r) => r.criterionId), mismatched: itemsOf('test-may-not-test-right-thing'),
          ...(tddMissing ? { notJudged: 'The TDD evidence is missing, so whether each criterion has a test cannot be judged.' } : {}),
        },
      }),
      deviations: { implementedNotRequested: implemented, requestedNotImplemented: requested, noneFound: implemented.length === 0 && requested.length === 0 },
      ...(run.warning === 'unparseable-output' ? { warning: 'unparseable-output' as const } : {}),
    };
  };

  const copy = (c: { repository: string; branch: string; commitSha: string; folder: string }): SpecCopy => ({ repository: c.repository, branch: c.branch, commit: c.commitSha, folder: c.folder });

  const keyResults = (lookup: SpecLookupWithParts, stale: { stale: boolean; reason?: string }): SpecKeyResult[] =>
    lookup.lookup.keys.map((key) => ({
      key,
      documents: (['specification', 'tdd-evidence'] as const).flatMap((kind): SpecDocument[] => {
        const d = lookup.documents.find((x) => x.key === key && x.kind === kind);
        if (d === undefined) return [];
        const source = d.sourceId === null ? undefined : lookup.sources.find((s) => s.id === d.sourceId);
        const status: SpecDocument['status'] = d.status === 'found' && stale.stale ? 'stale' : d.status;
        const reason = d.status === 'missing' ? (d.missingReason ?? undefined) : stale.stale ? stale.reason : undefined;
        return [{
          documentId: d.id, kind, status, ...(d.filePath === null ? {} : { fileName: baseName(d.filePath) }), otherSpecFiles: d.otherFiles,
          ...(source === undefined ? {} : { source: { key, used: copy(source), rule: RULE_WIRE[source.ruleUsed], others: source.otherCopies.map(copy) } }),
          ...(d.contentSha256 === null ? {} : { sha256: d.contentSha256 }), ...(reason === undefined ? {} : { reason }),
        }];
      }),
    }));

  const canRetry = (sessionId: string, snapshotId: string, lookup: SpecLookupWithParts | null): { allowed: boolean; reason?: string } => {
    const status = store.readSessionStatus(sessionId);
    const latest = store.readLatestSnapshot(sessionId);
    if (status !== null && status.prStatus !== 'open') return { allowed: false, reason: `The pull request is ${status.prStatus}; the session is read-only.` };
    if (latest !== null && latest.id !== snapshotId) return { allowed: false, reason: 'This is an older snapshot; retry applies to the latest snapshot only.' };
    const job = jobs.get(snapshotId);
    // Only a queued or running run blocks a retry (contracts/http-api.md); a lookup in flight blocks it only when there are no stored documents to run on.
    if ((job !== undefined && lanes.state(job.jobId) !== null) || (lookup === null && (inflightLookup.get(snapshotId) ?? 0) > 0)) {
      return { allowed: false, reason: 'An assessment is already running.' };
    }
    if (lookup === null && deps.environmentFor(sessionId) === null) return { allowed: false, reason: 'No lookup is possible for this session.' };
    return { allowed: true };
  };

  const service: SpecContextService = {
    onSnapshotStored(sessionId, snapshotId) {
      supersedeOthers(sessionId, snapshotId);
      // Remembered so onSnapshot can wait for it.
      pendingLookup.set(snapshotId, startLookup(sessionId, snapshotId, 'snapshot'));
    },

    onSnapshot(sessionId, snapshotId) {
      const waitFor = pendingLookup.get(snapshotId) ?? Promise.resolve();
      const promise = (async () => {
        try {
          await waitFor;
          await queueRun(sessionId, snapshotId, newId());
        } catch {
          // A failure to queue leaves the report saying so.
        }
      })();
      track(sessionId, promise);
    },

    onRefreshed(sessionId, snapshotId) {
      const promise = (async () => {
        try {
          const latest = store.readLatestSnapshot(sessionId);
          if (latest === null || latest.id !== snapshotId) return;
          const stored = store.readLatestSpecLookup(snapshotId);
          const next = await search(sessionId, snapshotId, 'refresh');
          if (next === null) return;
          if (stored !== null && signature(stored) === signature(next)) return;
          // A re-check that could not read must not replace documents that were read: keep them (FR-010, FR-018).
          const hadSpec = stored !== null && documentsOf(stored) !== null;
          if (hadSpec && (next.lookup.outcome === 'failed' || next.documents.some((d) => d.missingReason?.startsWith('read failed') === true))) return;
          storeLookup(next);
          publish(sessionId, snapshotId, 'documents');
          await queueRun(sessionId, snapshotId, newId());
        } catch {
          // A failed re-check leaves the stored documents as they were.
        }
      })();
      track(sessionId, promise);
    },

    async report(sessionId, snapshotId) {
      const snapshot = readSnapshot(sessionId, snapshotId);
      if (snapshot === null) throw new SpecContextError('not_found', 'No such snapshot.');
      const lookup = store.readLatestSpecLookup(snapshotId);
      const latest = store.readLatestSnapshot(sessionId);
      const stale: { stale: boolean; reason?: string } =
        latest !== null && latest.id !== snapshotId ? { stale: true, reason: 'A newer snapshot of the pull request exists.' } : { stale: false };
      const revision = revisions.get(snapshotId) ?? 0;
      const base = { snapshotId, headCommit: snapshot.headCommit, revision, stale: stale.stale, ...(stale.reason === undefined ? {} : { staleReason: stale.reason }) };
      if (lookup === null) {
        const searching = (inflightLookup.get(snapshotId) ?? 0) > 0;
        return { ...base, status: searching ? 'searching' : 'none', searched: [], gaps: [], keys: [], canRetry: canRetry(sessionId, snapshotId, null) };
      }
      const { lookup: l } = lookup;
      const gaps: SpecLookupGap[] = [];
      if (l.outcome === 'no-key') gaps.push({ kind: 'no-key', message: l.reason ?? 'No key was found to search with.' });
      if (l.enclosingNote === 'not-inside-project') gaps.push({ kind: 'no-enclosing-repository', message: 'The repository is not inside a project repository known to the workspace, so only its own repository was searched.' });
      if (l.outcome === 'failed') gaps.push({ kind: 'read-failed', message: firstLine(l.reason ?? 'read failed') });
      const status: SpecContextReport['status'] = (inflightLookup.get(snapshotId) ?? 0) > 0 ? 'searching' : l.outcome === 'failed' ? 'failed' : l.outcome === 'found' || l.outcome === 'partial' ? 'ready' : 'none';
      const alignment = alignmentOf(sessionId, snapshotId, snapshot.headCommit, lookup, stale);
      return {
        ...base, status, searched: l.searched.map((s) => ({ repository: s.repository, branches: s.heads })), gaps,
        keys: keyResults(lookup, stale), ...(alignment === undefined ? {} : { alignment }), canRetry: canRetry(sessionId, snapshotId, lookup),
      };
    },

    document(sessionId, snapshotId, documentId) {
      const doc = store.readSpecDocument(documentId);
      if (doc === null || doc.snapshotId !== snapshotId || doc.content === null || readSnapshot(sessionId, snapshotId) === null) return null;
      return { text: doc.content };
    },

    async retry(sessionId, snapshotId) {
      const snapshot = readSnapshot(sessionId, snapshotId);
      if (snapshot === null) throw new SpecContextError('not_found', 'No such snapshot.');
      const lookup = store.readLatestSpecLookup(snapshotId);
      const allowed = canRetry(sessionId, snapshotId, lookup);
      if (!allowed.allowed) {
        const reason = allowed.reason ?? 'Retry is not available.';
        throw new SpecContextError(/already running/.test(reason) ? 'conflict' : /read-only|older snapshot/.test(reason) ? 'read_only' : 'invalid_request', reason);
      }
      const runId = newId();
      if (lookup !== null && documentsOf(lookup) !== null) {
        track(sessionId, queueRun(sessionId, snapshotId, runId).catch(() => undefined));
        return { runId };
      }
      if (deps.environmentFor(sessionId) === null || sessionRepository(store, sessionId) === null) throw new SpecContextError('invalid_request', 'No lookup is possible for this session.');
      const searching = startLookup(sessionId, snapshotId, 'refresh');
      track(sessionId, searching.then(() => queueRun(sessionId, snapshotId, runId)).catch(() => undefined));
      return { runId };
    },

    async settled(sessionId) {
      for (;;) {
        const pending = [...(work.get(sessionId) ?? [])];
        if (pending.length === 0) return;
        await Promise.allSettled(pending);
      }
    },
  };

  const pendingLookup = new Map<string, Promise<unknown>>();
  return service;
}
