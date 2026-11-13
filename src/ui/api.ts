// Typed browser client for the local HTTP API (contracts/http-api.md). Every request is
// same-origin and carries the session cookie, so the browser sends `Origin` on non-GET requests
// (X.3, X.5). An error body naming `signin_required` sends the reviewer to the sign-in view
// (contracts/ui.md `#/signin`, FR-040). The event-stream wrapper re-reads questions and the latest
// snapshot's summaries after a reconnect, since events sent while disconnected are not replayed.

import type {
  AskBody,
  Category,
  Config,
  ConfigBody,
  ErrorBody,
  ErrorCode,
  FileContent,
  FileDiff,
  OverrideBody,
  OverrideHistory,
  OverrideRecord,
  PlatformId,
  Platforms,
  ProviderStatus,
  PullGroup,
  Question,
  ReviewActionBody,
  ReviewActionResult,
  ReviewComments,
  ReviewDecisionState,
  RiskReport,
  RiskReviewer,
  ScopeType,
  SessionDetail,
  SessionEventName,
  SessionEvents,
  SessionSummary,
  Side,
  SignIn,
  SignInBody,
  SpecContextReport,
  SpecContextRetryResult,
  SnapshotDetail,
  Suggestion,
  Summary,
  Workspace,
} from '../contracts/http.ts';

export const SIGNIN_HASH = '#/signin';

/** `#/signin?return=<encoded current hash>`; no return when already on the sign-in view (contracts §1). */
export function signinHashFor(currentHash: string): string {
  if (currentHash === '' || currentHash === '#' || currentHash === '#/' || currentHash.startsWith(SIGNIN_HASH)) {
    return SIGNIN_HASH;
  }
  return `${SIGNIN_HASH}?return=${encodeURIComponent(currentHash)}`;
}

/** A non-2xx response. `code` is the API's error code, or `null` when the body was not an ErrorBody. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | null;
  readonly platform: PlatformId | undefined;
  /** The platform's own reason for a refused review action, shown as stated. */
  readonly platformMessage: string | undefined;

  constructor(status: number, code: ErrorCode | null, message: string, platform?: PlatformId, platformMessage?: string) {
    super(message);
    this.platformMessage = platformMessage;
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.platform = platform;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

function isErrorBody(value: unknown): value is ErrorBody {
  if (value === null || typeof value !== 'object') return false;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    mode: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, null, 'The workbench server could not be reached.', undefined);
  }

  const data = await readJson(response);
  if (!response.ok) {
    if (isErrorBody(data)) {
      const { code, message, platform, platformMessage } = data.error;
      if (code === 'signin_required') location.hash = signinHashFor(location.hash);
      throw new ApiError(response.status, code, message, platform, platformMessage);
    }
    throw new ApiError(response.status, null, `Request failed with status ${response.status}.`);
  }
  return data as T;
}

const seg = (value: string | number): string => encodeURIComponent(String(value));
const sessionPath = (sessionId: string): string => `/api/sessions/${seg(sessionId)}`;
const snapshotPath = (sessionId: string, snapshotId: string): string =>
  `${sessionPath(sessionId)}/snapshots/${seg(snapshotId)}`;
const withQuery = (path: string, params: Record<string, string>): string =>
  `${path}?${new URLSearchParams(params).toString()}`;

// ---------------------------------------------------------------- 1. Authentication

export function authenticate(token: string): Promise<void> {
  return request<void>('POST', '/api/auth', { token });
}

// ---------------------------------------------------------------- 4. Configuration and sign-in

export function getConfig(): Promise<Config | null> {
  return request<Config | null>('GET', '/api/config');
}

export function saveConfig(config: ConfigBody): Promise<Config> {
  return request<Config>('PUT', '/api/config', config);
}

export function getPlatforms(): Promise<Platforms> {
  return request<Platforms>('GET', '/api/platforms');
}

export function listSignIns(): Promise<SignIn[]> {
  return request<SignIn[]>('GET', '/api/signins');
}

export function signIn(platform: PlatformId, body: SignInBody): Promise<SignIn> {
  return request<SignIn>('PUT', `/api/signins/${seg(platform)}`, body);
}

export function getProvider(): Promise<ProviderStatus> {
  return request<ProviderStatus>('GET', '/api/provider');
}

// ---------------------------------------------------------------- 4b. Workspace and discovery

export function getWorkspace(): Promise<Workspace> {
  return request<Workspace>('GET', '/api/workspace');
}

export function rescanWorkspace(): Promise<Workspace> {
  return request<Workspace>('POST', '/api/workspace/rescan');
}

export function cancelDiscovery(): Promise<Workspace> {
  return request<Workspace>('POST', '/api/workspace/cancel');
}

// ---------------------------------------------------------------- 5. Pull requests and sessions

/** One group per matched repository; with `repository`, the single group for that repository (Retry). */
export function listPullGroups(): Promise<PullGroup[]>;
export function listPullGroups(repository: string): Promise<PullGroup>;
export function listPullGroups(repository?: string): Promise<PullGroup[] | PullGroup> {
  if (repository === undefined) return request<PullGroup[]>('GET', '/api/pulls');
  return request<PullGroup>('GET', withQuery('/api/pulls', { repository }));
}

/** The last known list per repository, with no platform call; empty before the first fresh list. */
export function listCachedPullGroups(): Promise<PullGroup[]> {
  return request<PullGroup[]>('GET', withQuery('/api/pulls', { cached: '1' }));
}

export function listSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('GET', '/api/sessions');
}

/** Creates the session (201) or opens the existing one for that PR (200); both return the detail. */
export function createSession(repository: string, prNumber: number): Promise<SessionDetail> {
  return request<SessionDetail>('POST', '/api/sessions', { repository, prNumber });
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return request<SessionDetail>('GET', sessionPath(sessionId));
}

export function openSession(sessionId: string): Promise<SessionDetail> {
  return request<SessionDetail>('POST', `${sessionPath(sessionId)}/open`);
}

export function refreshSession(sessionId: string): Promise<SessionDetail> {
  return request<SessionDetail>('POST', `${sessionPath(sessionId)}/refresh`);
}

export function closeSession(sessionId: string): Promise<void> {
  return request<void>('POST', `${sessionPath(sessionId)}/close`);
}

export function deleteSession(sessionId: string): Promise<void> {
  return request<void>('DELETE', sessionPath(sessionId), { confirm: true });
}

// ---------------------------------------------------------------- 6. Snapshots, diff and code

export function getSnapshot(sessionId: string, snapshotId: string): Promise<SnapshotDetail> {
  return request<SnapshotDetail>('GET', snapshotPath(sessionId, snapshotId));
}

export function getFileDiff(sessionId: string, snapshotId: string, path: string): Promise<FileDiff> {
  return request<FileDiff>('GET', withQuery(`${snapshotPath(sessionId, snapshotId)}/diff`, { path }));
}

export function getFileContent(sessionId: string, snapshotId: string, side: Side, path: string): Promise<FileContent> {
  return request<FileContent>('GET', withQuery(`${snapshotPath(sessionId, snapshotId)}/file`, { side, path }));
}

// ---------------------------------------------------------------- 7. Summaries

export function listSummaries(sessionId: string, snapshotId: string): Promise<Summary[]> {
  return request<Summary[]>('GET', `${snapshotPath(sessionId, snapshotId)}/summaries`);
}

// ---------------------------------------------------------------- 8. Interrogation

export function listSuggestions(scope: ScopeType, category: Category): Promise<Suggestion[]> {
  return request<Suggestion[]>('GET', withQuery('/api/suggestions', { scope, category }));
}

export function listQuestions(sessionId: string): Promise<Question[]> {
  return request<Question[]>('GET', `${sessionPath(sessionId)}/questions`);
}

export function askQuestion(sessionId: string, body: AskBody): Promise<Question> {
  return request<Question>('POST', `${sessionPath(sessionId)}/questions`, body);
}

export function cancelQuestion(sessionId: string, questionId: string): Promise<Question> {
  return request<Question>('POST', `${sessionPath(sessionId)}/questions/${seg(questionId)}/cancel`);
}

// ---------------------------------------------------------------- 8c. Review actions (feature 005)

/** Performs one action at once. A fresh `requestId` per click; the caller keeps the typed text on any error. */
export function postReviewAction(sessionId: string, body: ReviewActionBody): Promise<ReviewActionResult> {
  return request<ReviewActionResult>('POST', `${sessionPath(sessionId)}/review-actions`, body);
}

export function getReviewComments(sessionId: string): Promise<ReviewComments> {
  return request<ReviewComments>('GET', `${sessionPath(sessionId)}/review-actions/comments`);
}

export function getReviewDecision(sessionId: string): Promise<ReviewDecisionState> {
  return request<ReviewDecisionState>('GET', `${sessionPath(sessionId)}/review-actions/decision`);
}

// ---------------------------------------------------------------- 8b. Risk (feature 004)

export function getRisk(sessionId: string, snapshotId: string): Promise<RiskReport> {
  return request<RiskReport>('GET', `${snapshotPath(sessionId, snapshotId)}/risk`);
}

/** Who the platform would record for an override that lowers a Critical class. */
export function getReviewer(sessionId: string): Promise<RiskReviewer> {
  return request<RiskReviewer>('GET', `${sessionPath(sessionId)}/risk/reviewer`);
}

export function postOverride(sessionId: string, body: OverrideBody): Promise<OverrideRecord> {
  return request<OverrideRecord>('POST', `${sessionPath(sessionId)}/risk/overrides`, body);
}

export function getOverrideHistory(sessionId: string, path: string): Promise<OverrideHistory> {
  return request<OverrideHistory>('GET', withQuery(`${sessionPath(sessionId)}/risk/overrides`, { path }));
}

// ---------------------------------------------------------------- 8c. Spec context (feature 006)

export function getSpecContext(sessionId: string, snapshotId: string): Promise<SpecContextReport> {
  return request<SpecContextReport>('GET', `${snapshotPath(sessionId, snapshotId)}/spec-context`);
}

/** The stored text of one document, as plain text. */
export async function getSpecDocument(sessionId: string, snapshotId: string, documentId: string): Promise<string> {
  const path = `${snapshotPath(sessionId, snapshotId)}/spec-context/documents/${seg(documentId)}`;
  let response: Response;
  try {
    response = await fetch(path, { method: 'GET', credentials: 'same-origin', mode: 'same-origin', headers: { Accept: 'text/plain' } });
  } catch {
    throw new ApiError(0, null, 'The workbench server could not be reached.', undefined);
  }
  const text = await response.text();
  if (!response.ok) {
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = undefined;
    }
    if (isErrorBody(data)) throw new ApiError(response.status, data.error.code, data.error.message);
    throw new ApiError(response.status, null, `Request failed with status ${response.status}.`);
  }
  return text;
}

export function retrySpecContext(sessionId: string, snapshotId: string): Promise<SpecContextRetryResult> {
  return request<SpecContextRetryResult>('POST', `${snapshotPath(sessionId, snapshotId)}/spec-context/retry`, {});
}

// ---------------------------------------------------------------- 9. Session event stream

export type SessionEventHandlers = { [K in SessionEventName]?: (data: SessionEvents[K]) => void };

export type SessionStreamOptions = SessionEventHandlers & {
  /** After a reconnect: every question of the session, re-read. */
  onQuestions?: (questions: Question[]) => void;
  /** After a reconnect: the latest snapshot's summaries, re-read. */
  onSummaries?: (snapshotId: string, summaries: Summary[]) => void;
  /** The stream dropped; `EventSource` retries by itself. */
  onDisconnect?: () => void;
  /** Every `open`, first or after a retry. */
  onOpen?: () => void;
  /** Every `error`, with the `EventSource` readyState (2 = CLOSED: no more retries). */
  onError?: (readyState: number) => void;
  /** A re-read after reconnect failed. */
  onResyncError?: (error: unknown) => void;
};

export type SessionStream = {
  close(): void;
  /** 0 connecting, 1 open, 2 closed. */
  readonly readyState: number;
};

const EVENT_NAMES: readonly SessionEventName[] = [
  'session',
  'snapshot',
  'question',
  'answer-delta',
  'summary',
  'summary-delta',
  'risk',
  'spec-context',
];

/** Re-reads what a disconnected stream may have missed. */
async function resync(sessionId: string, options: SessionStreamOptions): Promise<void> {
  const questions = listQuestions(sessionId).then((list) => options.onQuestions?.(list));
  const summaries = getSession(sessionId).then(async (detail) => {
    const latest = detail.snapshots[detail.snapshots.length - 1];
    if (latest === undefined) return;
    const list = await listSummaries(sessionId, latest.snapshotId);
    options.onSummaries?.(latest.snapshotId, list);
  });
  await Promise.all([questions, summaries]);
}

/** Opens `GET /api/sessions/:sessionId/events` and calls back on each event type. */
export function subscribeSession(sessionId: string, options: SessionStreamOptions): SessionStream {
  const source = new EventSource(`${sessionPath(sessionId)}/events`);
  let dropped = false;
  let closed = false;

  for (const name of EVENT_NAMES) {
    source.addEventListener(name, (event) => {
      const handler = options[name] as ((data: unknown) => void) | undefined;
      if (handler === undefined) return;
      let data: unknown;
      try {
        data = JSON.parse((event as MessageEvent<string>).data) as unknown;
      } catch {
        return;
      }
      handler(data);
    });
  }

  source.onerror = () => {
    if (closed) return;
    options.onError?.(source.readyState);
    if (!dropped) options.onDisconnect?.();
    dropped = true;
  };

  source.onopen = () => {
    if (closed) return;
    options.onOpen?.();
    if (!dropped) return;
    dropped = false;
    resync(sessionId, options).catch((error: unknown) => options.onResyncError?.(error));
  };

  return {
    get readyState() {
      return source.readyState;
    },
    close() {
      closed = true;
      source.close();
    },
  };
}
