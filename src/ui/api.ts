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
  PlatformId,
  Platforms,
  ProviderStatus,
  PullSummary,
  Question,
  ScopeType,
  SessionDetail,
  SessionEventName,
  SessionEvents,
  SessionSummary,
  Side,
  SignIn,
  SignInBody,
  SnapshotDetail,
  Suggestion,
  Summary,
} from '../contracts/http.ts';

export const SIGNIN_HASH = '#/signin';

/** A non-2xx response. `code` is the API's error code, or `null` when the body was not an ErrorBody. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | null;
  readonly platform: PlatformId | undefined;

  constructor(status: number, code: ErrorCode | null, message: string, platform?: PlatformId) {
    super(message);
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
      const { code, message, platform } = data.error;
      if (code === 'signin_required') location.hash = SIGNIN_HASH;
      throw new ApiError(response.status, code, message, platform);
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

// ---------------------------------------------------------------- 5. Pull requests and sessions

export function listPulls(): Promise<PullSummary[]> {
  return request<PullSummary[]>('GET', '/api/pulls');
}

export function listSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('GET', '/api/sessions');
}

/** Creates the session (201) or opens the existing one for that PR (200); both return the detail. */
export function createSession(prNumber: number): Promise<SessionDetail> {
  return request<SessionDetail>('POST', '/api/sessions', { prNumber });
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

// ---------------------------------------------------------------- 9. Session event stream

export type SessionEventHandlers = { [K in SessionEventName]?: (data: SessionEvents[K]) => void };

export type SessionStreamOptions = SessionEventHandlers & {
  /** After a reconnect: every question of the session, re-read. */
  onQuestions?: (questions: Question[]) => void;
  /** After a reconnect: the latest snapshot's summaries, re-read. */
  onSummaries?: (snapshotId: string, summaries: Summary[]) => void;
  /** The stream dropped; `EventSource` retries by itself. */
  onDisconnect?: () => void;
  /** A re-read after reconnect failed. */
  onResyncError?: (error: unknown) => void;
};

export type SessionStream = { close(): void };

const EVENT_NAMES: readonly SessionEventName[] = [
  'session',
  'snapshot',
  'question',
  'answer-delta',
  'summary',
  'summary-delta',
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
    if (!dropped) options.onDisconnect?.();
    dropped = true;
  };

  source.onopen = () => {
    if (!dropped || closed) return;
    dropped = false;
    resync(sessionId, options).catch((error: unknown) => options.onResyncError?.(error));
  };

  return {
    close() {
      closed = true;
      source.close();
    },
  };
}
