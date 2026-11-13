// Per-tab view state kept in sessionStorage (R3, data-model 4.1-4.2). Allowlisted fields only,
// validated on read, written through typed setters. Imports nothing from api.ts, so nothing here
// can reach the server (X.7). Blocked storage behaves as an empty store backed by memory.

import type { AnswerFor, Category, RiskClass, Scope, Side } from '../../contracts/http.ts';

/** The server accepts questions up to 10,000 characters, so a draft is never cut shorter than that. */
export const DRAFT_MAX = 10_000;
export const SCROLL_MAX_ENTRIES = 50;
export const DASHBOARD_TEXT_MAX = 200;
export const COLLAPSED_GROUPS_MAX = 500;
export const COLLAPSED_LANES_MAX = 10;
/** Files marked viewed in one tab; far above any real pull request. */
export const VIEWED_MAX = 5000;

export type SessionViewState = {
  draft: string;
  category: Category;
  answerFor: AnswerFor;
  scope: Scope;
  scroll: Record<string, number>;
  lastDiffPath?: string;
  /** Whether the Files view's file list is collapsed. */
  fileListCollapsed?: boolean;
  /** Whether Markdown files open as a rendered preview rather than the diff. */
  markdownPreview?: boolean;
  /** How the changed files are ordered, in this tab only (FR-032). */
  fileOrder: 'diff' | 'risk';
  /** The review scope: 'auto' fits the line budget, otherwise the lowest class shown (FR-032). */
  riskScope: 'auto' | RiskClass;
  /** Paths the reviewer has marked viewed, in this tab only. */
  viewed: string[];
};

export type DashboardViewState = {
  text: string;
  repository: string | null;
  scroll: number;
  /** Issue groups the reviewer has collapsed (issue key, or "none"); groups are open by default. */
  collapsedGroups: string[];
  /** Whether pull requests the reviewer has approved are left out of the list; on by default. */
  hideApproved: boolean;
  /** Review queue lanes the reviewer has collapsed; only "approved" is collapsed by default. */
  collapsedLanes: string[];
};

const CATEGORIES: readonly Category[] = ['what', 'why', 'how', 'whatif', 'risk', 'requirement'];
const SIDES: readonly Side[] = ['head', 'base'];
const RISK_CLASSES: readonly RiskClass[] = ['critical', 'elevated', 'normal', 'low'];

const memory = new Map<string, string>();

function load(key: string): unknown {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    raw = memory.get(key) ?? null;
  }
  if (raw === null) raw = memory.get(key) ?? null;
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  try {
    sessionStorage.setItem(key, raw);
    memory.delete(key);
  } catch {
    memory.set(key, raw);
  }
}

function remove(key: string): void {
  memory.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* blocked storage: nothing to remove */
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, min: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min;
const isStr = (x: unknown): x is string => typeof x === 'string';

function cleanAskScope(x: unknown): Scope {
  if (isObj(x)) {
    if (x.type === 'pr') return { type: 'pr' };
    if (x.type === 'file' && isStr(x.path)) return { type: 'file', path: x.path };
    if (
      x.type === 'range' && isStr(x.path) && SIDES.includes(x.side as Side) &&
      isInt(x.startLine, 1) && isInt(x.endLine, 1) && x.startLine <= x.endLine
    ) {
      const r: Scope = { type: 'range', path: x.path, side: x.side as Side, startLine: x.startLine, endLine: x.endLine };
      if (isStr(x.label)) r.label = x.label;
      return r;
    }
  }
  return { type: 'pr' };
}

function cleanRiskScope(x: unknown): 'auto' | RiskClass {
  return RISK_CLASSES.find((c) => c === x) ?? 'auto';
}

function cleanViewed(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.filter(isStr))].slice(0, VIEWED_MAX);
}

function cleanScroll(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) if (isInt(v, 0)) out[k] = v;
  return capScroll(out);
}

function capScroll(s: Record<string, number>): Record<string, number> {
  const keys = Object.keys(s);
  if (keys.length <= SCROLL_MAX_ENTRIES) return s;
  const out: Record<string, number> = {};
  for (const k of keys.slice(keys.length - SCROLL_MAX_ENTRIES)) out[k] = s[k] as number;
  return out;
}

function defaultsSession(): SessionViewState {
  return { draft: '', category: 'what', answerFor: 'technical', scope: { type: 'pr' }, scroll: {}, fileOrder: 'risk', riskScope: 'auto', viewed: [] };
}

function parseSession(x: unknown): SessionViewState {
  const d = defaultsSession();
  if (!isObj(x) || x.v !== 1) return d;
  const out: SessionViewState = {
    draft: isStr(x.draft) ? x.draft.slice(0, DRAFT_MAX) : d.draft,
    category: CATEGORIES.includes(x.category as Category) ? (x.category as Category) : d.category,
    answerFor: x.answerFor === 'technical' || x.answerFor === 'business' ? x.answerFor : d.answerFor,
    scope: cleanAskScope(x.scope),
    scroll: cleanScroll(x.scroll),
    fileOrder: x.fileOrder === 'diff' ? 'diff' : 'risk',
    riskScope: cleanRiskScope(x.riskScope),
    viewed: cleanViewed(x.viewed),
  };
  if (isStr(x.lastDiffPath)) out.lastDiffPath = x.lastDiffPath;
  if (x.fileListCollapsed === true) out.fileListCollapsed = true;
  if (x.markdownPreview === true) out.markdownPreview = true;
  return out;
}

const sessionKey = (id: string) => `prwb:view:${id}`;
const DASHBOARD_KEY = 'prwb:view:dashboard';

export function readSession(id: string): SessionViewState {
  return parseSession(load(sessionKey(id)));
}

/** Merge the given fields into the stored state. Unknown keys are ignored. */
export function writeSession(id: string, patch: Partial<SessionViewState>): void {
  const cur = readSession(id);
  const merged = parseSession({
    v: 1,
    draft: 'draft' in patch ? patch.draft : cur.draft,
    category: 'category' in patch ? patch.category : cur.category,
    answerFor: 'answerFor' in patch ? patch.answerFor : cur.answerFor,
    scope: 'scope' in patch ? patch.scope : cur.scope,
    scroll: 'scroll' in patch ? { ...cur.scroll, ...patch.scroll } : cur.scroll,
    lastDiffPath: 'lastDiffPath' in patch ? patch.lastDiffPath : cur.lastDiffPath,
    fileListCollapsed: 'fileListCollapsed' in patch ? patch.fileListCollapsed : cur.fileListCollapsed,
    markdownPreview: 'markdownPreview' in patch ? patch.markdownPreview : cur.markdownPreview,
    fileOrder: 'fileOrder' in patch ? patch.fileOrder : cur.fileOrder,
    riskScope: 'riskScope' in patch ? patch.riskScope : cur.riskScope,
    viewed: 'viewed' in patch ? patch.viewed : cur.viewed,
  });
  save(sessionKey(id), { v: 1, ...merged });
}

export function clearSession(id: string): void {
  remove(sessionKey(id));
}

function parseDashboard(x: unknown): DashboardViewState {
  const d: DashboardViewState = { text: '', repository: null, scroll: 0, collapsedGroups: [], hideApproved: true, collapsedLanes: ['approved'] };
  if (!isObj(x) || x.v !== 1) return d;
  return {
    text: isStr(x.text) ? x.text.trim().slice(0, DASHBOARD_TEXT_MAX) : d.text,
    repository: isStr(x.repository) ? x.repository : null,
    scroll: isInt(x.scroll, 0) ? x.scroll : 0,
    collapsedGroups: Array.isArray(x.collapsedGroups) ? [...new Set(x.collapsedGroups.filter(isStr))].slice(0, COLLAPSED_GROUPS_MAX) : [],
    hideApproved: x.hideApproved !== false,
    collapsedLanes: Array.isArray(x.collapsedLanes) ? [...new Set(x.collapsedLanes.filter(isStr))].slice(0, COLLAPSED_LANES_MAX) : d.collapsedLanes,
  };
}

export function readDashboard(): DashboardViewState {
  return parseDashboard(load(DASHBOARD_KEY));
}

export function writeDashboard(patch: Partial<DashboardViewState>): void {
  const cur = readDashboard();
  const merged = parseDashboard({ v: 1, ...cur, ...pick(patch) });
  save(DASHBOARD_KEY, { v: 1, ...merged });
}

function pick(p: Partial<DashboardViewState>): Partial<DashboardViewState> {
  const o: Partial<DashboardViewState> = {};
  if ('text' in p) o.text = p.text;
  if ('repository' in p) o.repository = p.repository;
  if ('scroll' in p) o.scroll = p.scroll;
  if ('collapsedGroups' in p) o.collapsedGroups = p.collapsedGroups;
  if ('hideApproved' in p) o.hideApproved = p.hideApproved;
  if ('collapsedLanes' in p) o.collapsedLanes = p.collapsedLanes;
  return o;
}
