// The parsed hash route (data-model section 4.6). Every route keeps working as a deep link.

import type { PlatformId, Scope, Side } from '../../contracts/http.ts';

export type LineRange = { start: number; end: number };

/** A cited range the Files view selects and scrolls to; it falls back to the code page when the diff can't show it. */
export type DiffFocus = { snapshot: string; side: Side; start: number; end: number };

export type Route =
  | { name: 'dashboard' }
  | { name: 'setup' }
  | { name: 'signin'; return?: string }
  | { name: 'overview'; sessionId: string }
  | { name: 'diff'; sessionId: string; path?: string; focus?: DiffFocus }
  | { name: 'code'; sessionId: string; snapshot: string; side: Side; path: string; range?: LineRange }
  | { name: 'description'; sessionId: string }
  | { name: 'issue'; sessionId: string; platform: PlatformId; key: string }
  | { name: 'ask'; sessionId: string; query: URLSearchParams }
  | { name: 'unknown'; hash: string };

const HOME = '#/';

function integer(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

function rangeFrom(query: URLSearchParams): LineRange | undefined {
  const start = integer(query.get('start'));
  if (start !== undefined) {
    const rawEnd = query.get('end');
    const end = rawEnd === null ? start : integer(rawEnd);
    return end !== undefined && end >= start ? { start, end } : undefined;
  }
  const line = integer(query.get('line'));
  return line === undefined ? undefined : { start: line, end: line };
}

function decode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', queryPart = ''] = raw.split(/\?(.*)/s);
  const query = new URLSearchParams(queryPart);
  const segments = pathPart.split('/').filter((s) => s !== '');
  const unknown: Route = { name: 'unknown', hash };

  if (segments.length === 0) return { name: 'dashboard' };
  if (segments.length === 1 && segments[0] === 'setup') return { name: 'setup' };
  if (segments.length === 1 && segments[0] === 'signin') {
    const back = query.get('return');
    return back === null ? { name: 'signin' } : { name: 'signin', return: back };
  }
  if (segments[0] !== 'sessions' || segments.length < 2) return unknown;
  const sessionId = decode(segments[1] ?? '');
  if (sessionId === undefined || sessionId === '') return unknown;
  const section = segments[2];

  if (section === undefined) return { name: 'overview', sessionId };
  if (segments.length === 3) {
    switch (section) {
      case 'diff': {
        const path = query.get('path');
        if (path === null) return { name: 'diff', sessionId };
        const snapshot = query.get('snapshot');
        const side = query.get('side');
        const range = rangeFrom(query);
        if (snapshot !== null && (side === 'head' || side === 'base') && range !== undefined) {
          return { name: 'diff', sessionId, path, focus: { snapshot, side, ...range } };
        }
        return { name: 'diff', sessionId, path };
      }
      case 'description':
        return { name: 'description', sessionId };
      case 'ask':
        return { name: 'ask', sessionId, query };
      case 'code': {
        const snapshot = query.get('snapshot');
        const side = query.get('side');
        const path = query.get('path');
        if (snapshot === null || path === null || (side !== 'head' && side !== 'base')) return unknown;
        const range = rangeFrom(query);
        return range === undefined ? { name: 'code', sessionId, snapshot, side, path } : { name: 'code', sessionId, snapshot, side, path, range };
      }
      default:
        return unknown;
    }
  }
  if (section === 'issues' && segments.length === 5) {
    const platform = decode(segments[3] ?? '');
    const key = decode(segments[4] ?? '');
    if (platform !== undefined && key !== undefined && platform !== '' && key !== '') return { name: 'issue', sessionId, platform, key };
  }
  return unknown;
}

const sessionBase = (id: string): string => `#/sessions/${encodeURIComponent(id)}`;

export function buildRoute(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return HOME;
    case 'setup':
      return '#/setup';
    case 'signin':
      return route.return === undefined ? '#/signin' : `#/signin?return=${encodeURIComponent(route.return)}`;
    case 'overview':
      return sessionBase(route.sessionId);
    case 'diff':
      if (route.path !== undefined && route.focus !== undefined) return diffHref(route.sessionId, { path: route.path, ...route.focus });
      return `${sessionBase(route.sessionId)}/diff${route.path === undefined ? '' : `?path=${encodeURIComponent(route.path)}`}`;
    case 'description':
      return `${sessionBase(route.sessionId)}/description`;
    case 'issue':
      return `${sessionBase(route.sessionId)}/issues/${encodeURIComponent(route.platform)}/${encodeURIComponent(route.key)}`;
    case 'ask':
      return `${sessionBase(route.sessionId)}/ask${route.query.size === 0 ? '' : `?${route.query.toString()}`}`;
    case 'code':
      return codeHref(route.sessionId, { snapshot: route.snapshot, side: route.side, path: route.path, ...(route.range ?? {}) });
    case 'unknown':
      return route.hash;
  }
}

/** Route name plus identifying parameters, without `return` (data-model 4.6). */
export function routeKey(route: Route): string {
  switch (route.name) {
    case 'diff':
      if (route.path === undefined) return 'diff';
      return route.focus === undefined ? `diff?path=${route.path}` : `diff?path=${route.path}&focus=${route.focus.side}:${route.focus.start}-${route.focus.end}`;
    case 'code':
      return `code?snapshot=${route.snapshot}&side=${route.side}&path=${route.path}`;
    case 'issue':
      return `issue/${route.platform}/${route.key}`;
    case 'unknown':
      return 'unknown';
    default:
      return route.name;
  }
}

/** The ask route for a scope, as hash query parameters. */
export function askHref(sessionId: string, scope: Scope): string {
  const query = new URLSearchParams({ type: scope.type });
  if (scope.type !== 'pr') query.set('path', scope.path);
  if (scope.type === 'range') {
    query.set('side', scope.side);
    query.set('start', String(scope.startLine));
    query.set('end', String(scope.endLine));
    if (scope.label !== undefined) query.set('label', scope.label);
  }
  return `${sessionBase(sessionId)}/ask?${query.toString()}`;
}

/** The scope named by the ask route's query; the whole PR when it names none. */
export function scopeFromQuery(query: URLSearchParams): Scope {
  const path = query.get('path');
  const start = Number(query.get('start'));
  const end = Number(query.get('end'));
  const side = query.get('side');
  if (query.get('type') === 'range' && path !== null && (side === 'head' || side === 'base') && start >= 1 && end >= start) {
    const label = query.get('label');
    return { type: 'range', path, side, startLine: start, endLine: end, ...(label === null ? {} : { label }) };
  }
  if (query.get('type') === 'file' && path !== null) return { type: 'file', path };
  return { type: 'pr' };
}

/** A code-view link. `start` and `end` are emitted (never `line`). */
export function codeHref(sessionId: string, target: { snapshot: string; side: Side; path: string; start?: number; end?: number }): string {
  const query = new URLSearchParams({ snapshot: target.snapshot, side: target.side, path: target.path });
  if (target.start !== undefined) {
    query.set('start', String(target.start));
    query.set('end', String(target.end ?? target.start));
  }
  return `${sessionBase(sessionId)}/code?${query.toString()}`;
}

/** A Files-view link that selects a cited range. */
export function diffHref(sessionId: string, target: DiffFocus & { path: string }): string {
  const query = new URLSearchParams({ path: target.path, snapshot: target.snapshot, side: target.side, start: String(target.start), end: String(target.end) });
  return `${sessionBase(sessionId)}/diff?${query.toString()}`;
}

/** A sign-in `return` value is kept only when it parses to an app route other than sign-in or set-up. */
export function safeReturn(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('#/')) return HOME;
  const route = parseRoute(value);
  if (route.name === 'unknown' || route.name === 'signin' || route.name === 'setup') return HOME;
  return value;
}
