// Changed-file list (contracts/ui.md 4.10): rows keep `changed-file-<path>`, a text filter, an empty-result
// state and an optional per-row explanation, disclosed on request. With a risk report the list is scoped to what
// fits a careful review (review-scope.ts): files group under their class, the classes outside the scope stay
// listed but collapsed, and each file can be marked viewed for this tab.

import type { ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { ChangedFile, RiskClass, RiskReport } from '../../contracts/http.ts';
import { RISK_CLASSES } from '../../core/risk/classes.ts';
import { arrangeFiles } from '../state/file-order.ts';
import { fileScope, isApart, type ScopeChoice, type Tally } from '../state/review-scope.ts';
import { buildRoute } from '../state/routes.ts';
import { useFileView, type FileView } from '../state/use-file-view.ts';
import { Badge } from './badge.tsx';
import { RiskBadge } from './risk-badge.tsx';
import { RiskReasons } from './risk-reasons.tsx';
import { ScopeSlider, tallyText } from './scope-slider.tsx';
import { ChevronDown, ChevronRight, ChevronUp, Info } from 'lucide-preact';
import { IconButton } from './icon-button.tsx';
import { ICON_LABELS, RISK_LABELS, SCOPE_LABELS } from '../labels.ts';

export type FileListProps = {
  sessionId: string;
  files: readonly ChangedFile[];
  /** The path to mark as the current page, if any. */
  current?: string;
  /** Rendered inside a row once its `file-explanation-<path>` button is expanded. */
  explanation?: (file: ChangedFile) => ComponentChild;
  /** The risk report; when given, the review scope, class groups, class badges and Why? disclosure appear. */
  risk?: RiskReport | null;
  /** The order, scope and viewed files, when the parent shares them (the Files view); otherwise the list keeps its own. */
  view?: FileView;
};

type GroupKey = RiskClass | 'mechanical' | 'unclassified';
const GROUPS: readonly GroupKey[] = [...RISK_CLASSES, 'mechanical', 'unclassified'];

const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const dir = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);
/** The file's name without its folders; the full path is the link's tooltip. */
const baseName = (f: ChangedFile): string => (f.previousPath !== undefined ? `${base(f.previousPath)} → ${base(f.path)}` : base(f.path));
const fullName = (f: ChangedFile): string => (f.previousPath !== undefined ? `${f.previousPath} → ${f.path}` : f.path);
const tally = (fs: readonly ChangedFile[]): Tally => ({ files: fs.length, lines: fs.reduce((n, f) => n + f.linesAdded + f.linesRemoved, 0) });

export function FileList({ sessionId, files, current, explanation, risk, view }: FileListProps) {
  const own = useFileView(sessionId);
  const { order, scope: choice, viewed, setOrder, setScope, toggleViewed } = view ?? own;
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [why, setWhy] = useState<ReadonlySet<string>>(new Set());
  const [groupOpen, setGroupOpen] = useState<Readonly<Record<string, boolean>>>({});
  const report = risk ?? null;
  const riskOf = new Map((report?.files ?? []).map((f) => [f.path, f]));
  const fs = fileScope(files, report, choice);
  const grouped = report !== null && order === 'risk';
  const searching = filter.trim() !== '';

  const toggleWhy = (path: string): void => {
    const next = new Set(why);
    if (!next.delete(path)) next.add(path);
    setWhy(next);
  };
  const toggle = (path: string): void => {
    const next = new Set(open);
    if (!next.delete(path)) next.add(path);
    setOpen(next);
  };
  // A new search starts from the default openings, so matches in a collapsed group are not hidden by an earlier click.
  const changeFilter = (text: string): void => {
    setGroupOpen({});
    setFilter(text);
  };
  const changeScope = (next: ScopeChoice): void => {
    setGroupOpen({});
    setScope(next);
  };

  // What Next and Previous walk: the files in scope that match the text.
  const inScopeShown = arrangeFiles(files, fs.classOf, { order: 'diff', classes: report === null ? [] : fs.scope.classes, text: filter });
  // What the list shows: in risk order every matching file, grouped; otherwise just the files in scope.
  const matches = arrangeFiles(files, (f) => riskOf.get(f.path)?.effectiveClass, { order: 'risk', classes: [], text: filter });
  const keyOf = (f: ChangedFile): GroupKey => {
    const r = riskOf.get(f.path);
    return r === undefined ? 'unclassified' : isApart(r.effectiveClass, r.mechanical) ? 'mechanical' : r.effectiveClass;
  };
  const byGroup = new Map<GroupKey, ChangedFile[]>(GROUPS.map((g) => [g, []]));
  for (const f of matches) byGroup.get(keyOf(f))!.push(f);

  const scoped = files.filter(fs.inScope);
  const viewedScoped = scoped.filter((f) => viewed.has(f.path));
  const progress = { files: tally(scoped), viewed: tally(viewedScoped) };

  const row = (f: ChangedFile, badge: boolean) => {
    const r = riskOf.get(f.path);
    const expanded = open.has(f.path);
    const isViewed = viewed.has(f.path);
    return (
      <li key={f.path} class="file-row" data-testid={`changed-file-${f.path}`} data-viewed={isViewed ? 'true' : undefined} data-risk={r?.effectiveClass}>
        <input
          type="checkbox"
          class="file-viewed"
          data-testid={`file-viewed-${f.path}`}
          aria-label={`${SCOPE_LABELS.viewed}: ${fullName(f)}`}
          title={SCOPE_LABELS.viewed}
          checked={isViewed}
          onChange={() => toggleViewed(f.path)}
        />
        <a
          class="mono file-link"
          href={buildRoute({ name: 'diff', sessionId, path: f.path })}
          title={fullName(f)}
          aria-label={fullName(f)}
          aria-current={current === f.path ? 'page' : undefined}
        >
          {baseName(f)}
        </a>
        <span class="file-stat muted">{`+${f.linesAdded} −${f.linesRemoved}`}</span>
        <span class="file-actions">
          {r !== undefined && (
            <IconButton
              icon={Info}
              label={why.has(f.path) ? ICON_LABELS.hideWhyThisClass : ICON_LABELS.whyThisClass}
              data-testid={`file-risk-toggle-${f.path}`}
              expanded={why.has(f.path)}
              onClick={() => toggleWhy(f.path)}
            />
          )}
          {explanation !== undefined && (
            <IconButton
              icon={expanded ? ChevronUp : ChevronDown}
              label={expanded ? ICON_LABELS.hideExplanation : ICON_LABELS.showExplanation}
              data-testid={`file-explanation-${f.path}`}
              expanded={expanded}
              onClick={() => toggle(f.path)}
            />
          )}
        </span>
        <span class="file-sub muted">
          {dir(f.path) !== '' && (
            <span class="file-dir" title={dir(f.path)}>
              <span>{dir(f.path)}</span>
            </span>
          )}
          {f.status !== 'modified' && <span class="file-status">{f.status}</span>}
          {badge && r !== undefined && <RiskBadge riskClass={r.effectiveClass} />}
          {f.skipped !== undefined && <Badge kind="skipped" reason={f.skipped} />}
        </span>
        {r !== undefined && why.has(f.path) && (
          <div class="file-risk-why" data-testid={`file-risk-${f.path}`}>
            <RiskReasons file={r} />
          </div>
        )}
        {explanation !== undefined && expanded && <div class="file-explanation">{explanation(f)}</div>}
      </li>
    );
  };

  const group = (key: GroupKey) => {
    const members = byGroup.get(key)!;
    if (members.length === 0) return null;
    const isClass = key !== 'mechanical' && key !== 'unclassified';
    const inScope = isClass && fs.scope.classes.includes(key);
    const isOpen = groupOpen[key] ?? (searching || inScope);
    const name = key === 'mechanical' ? RISK_LABELS.mechanical : key === 'unclassified' ? SCOPE_LABELS.unclassified : RISK_LABELS.class[key];
    const note = key === 'mechanical' ? SCOPE_LABELS.notCounted : isClass && !inScope ? SCOPE_LABELS.outside : undefined;
    return (
      <section key={key} class="file-group" data-testid={`file-group-${key}`} data-in-scope={inScope ? 'true' : undefined}>
        <h3 class="file-group-head">
          <button
            type="button"
            class="file-group-toggle"
            data-testid={`file-group-toggle-${key}`}
            aria-expanded={isOpen}
            aria-controls={`file-group-list-${key}`}
            onClick={() => setGroupOpen({ ...groupOpen, [key]: !isOpen })}
          >
            {isOpen ? <ChevronDown size={16} aria-hidden="true" focusable="false" /> : <ChevronRight size={16} aria-hidden="true" focusable="false" />}
            <span class="file-group-name">{name}</span>
            <span class="muted file-group-meta">{[tallyText(tally(members)), note].filter((x) => x !== undefined).join(' · ')}</span>
          </button>
        </h3>
        {isOpen && (
          <ul class="list" id={`file-group-list-${key}`}>
            {members.map((f) => row(f, false))}
          </ul>
        )}
      </section>
    );
  };

  const empty = grouped ? matches.length === 0 : inScopeShown.length === 0;

  return (
    <div class="file-list" data-testid="file-list">
      {report !== null && (
        <ScopeSlider scope={fs.scope} taken={fs.stops.cumulative[fs.scope.threshold]} progress={progress} onChange={changeScope} />
      )}
      <div class="file-tools">
        <label class="file-filter-label">
          <span class="visually-hidden">File filter</span>
          <input type="search" placeholder="Filter files…" data-testid="file-filter" value={filter} onInput={(e) => changeFilter((e.currentTarget as HTMLInputElement).value)} />
        </label>
        {report !== null && (
          <label class="file-order-label">
            <span class="visually-hidden">Order</span>
            <select data-testid="file-order" value={order} onChange={(e) => setOrder((e.currentTarget as HTMLSelectElement).value === 'diff' ? 'diff' : 'risk')}>
              <option value="risk">Risk order</option>
              <option value="diff">Diff order</option>
            </select>
          </label>
        )}
      </div>
      {(!grouped || searching) && <p class="muted file-count" data-testid="file-count">{`Showing ${inScopeShown.length} of ${files.length} files`}</p>}
      {empty && files.length > 0 ? (
        <p data-testid="file-filter-empty">
          {searching ? `No changed file matches “${filter}”.` : 'No changed file is in this scope.'}{' '}
          {searching && (
            <button type="button" data-testid="file-filter-clear" onClick={() => changeFilter('')}>
              Clear filter
            </button>
          )}
        </p>
      ) : grouped ? (
        <div class="file-groups">{GROUPS.map(group)}</div>
      ) : (
        <ul class="list">{inScopeShown.map((f) => row(f, true))}</ul>
      )}
    </div>
  );
}
