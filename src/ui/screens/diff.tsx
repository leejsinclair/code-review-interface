// Diff screen (`#/sessions/:sessionId/diff?path=<path>`, FR-005 to FR-008, FR-022, FR-024, FR-028): one changed
// file with a line-range selection by pointer or keyboard, the file list beside it (wide), in a drawer (medium)
// or as previous/next links (narrow). Code is rendered as text.

import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { ChangedFile, DiffLine, FileDiff, Scope, Side, SnapshotDetail } from '../../contracts/http.ts';
import { getFileDiff, getSession, getSnapshot } from '../api.ts';
import { AsyncRegion } from '../components/async-region.tsx';
import { Badge } from '../components/badge.tsx';
import { FileList } from '../components/file-list.tsx';
import { FILE_NAV_LABELS } from '../labels.ts';
import { useBand } from '../state/layout.ts';
import { buildRoute } from '../state/routes.ts';
import { ReviewContext } from '../state/review-context.ts';
import { anchor, extend, isSelected, lineNumber, move, scopeText, toScope, type Cursor, type Selection } from '../state/selection.ts';
import { readSession, writeSession } from '../state/view-state.ts';

const MAX_LABEL = 200;
const KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

type Loaded = { diff: FileDiff; files: ChangedFile[]; snapshot: SnapshotDetail };

function selectionFromScope(scope: Scope | undefined, path: string): Selection | null {
  if (scope === undefined || scope.type !== 'range' || scope.path !== path) return null;
  return { side: scope.side, anchor: scope.startLine, focus: scope.endLine };
}

export function DiffScreen(props: { sessionId: string; path: string }) {
  const { sessionId, path } = props;
  const ctx = useContext(ReviewContext);
  const band = useBand();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(() => selectionFromScope(readSession(sessionId).scope, path));
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [label, setLabel] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const table = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusCursor = useRef(false);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setError(null);
    getSession(sessionId)
      .then(async (detail) => {
        const latest = detail.snapshots[detail.snapshots.length - 1];
        if (latest === undefined) throw new Error('The session has no snapshot.');
        const [snapshot, diff] = await Promise.all([getSnapshot(sessionId, latest.snapshotId), path === '' ? Promise.resolve(null) : getFileDiff(sessionId, latest.snapshotId, path)]);
        return { snapshot, diff, files: snapshot.files };
      })
      .then((r) => {
        if (!live) return;
        if (r.diff === null) {
          const first = r.files[0];
          if (first !== undefined) location.replace(buildRoute({ name: 'diff', sessionId, path: first.path }));
          else setError('This pull request changes no files.');
          return;
        }
        setLoaded({ diff: r.diff, files: r.files, snapshot: r.snapshot });
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the diff.'));
    return () => {
      live = false;
    };
  }, [sessionId, path, attempt]);

  useEffect(() => {
    if (path !== '') writeSession(sessionId, { lastDiffPath: path });
  }, [sessionId, path]);

  useEffect(() => {
    if (focusCursor.current && cursor !== null) {
      focusCursor.current = false;
      table.current?.querySelector<HTMLElement>(`[data-cursor="true"]`)?.focus();
    }
  });

  const rows: DiffLine[] = loaded?.diff.hunks.flatMap((h) => h.lines) ?? [];
  const select = (next: Selection | null): void => {
    setSelection(next);
    const scope: Scope = next === null ? { type: 'file', path } : toScope(path, next, label);
    writeSession(sessionId, { scope });
    ctx.announce(next === null ? 'Selection cleared' : scopeText(path, next));
  };
  const first = rows.find((r) => lineNumber(r, 'head') !== undefined);
  const effectiveCursor: Cursor | null = cursor ?? (first === undefined ? null : { side: 'head', line: first.newLine! });

  const onKeyDown = (e: KeyboardEvent): void => {
    const c = effectiveCursor;
    if (c === null) return;
    if (e.key === 'Escape') {
      select(null);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(anchor(selection, c.side, c.line));
    } else if (KEYS[e.key] !== undefined) {
      e.preventDefault();
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const sel = extend(selection, c, rows, e.key === 'ArrowUp' ? -1 : 1);
        setCursor({ side: sel.side, line: sel.focus });
        focusCursor.current = true;
        select(sel);
      } else {
        setCursor(move(rows, c, KEYS[e.key]!));
        focusCursor.current = true;
      }
    }
  };

  const currentScope: Scope = selection === null ? { type: 'file', path } : toScope(path, selection, label);
  const index = loaded?.files.findIndex((f) => f.path === path) ?? -1;
  const prev = index > 0 ? loaded!.files[index - 1] : undefined;
  const next = index >= 0 && loaded !== null ? loaded.files[index + 1] : undefined;
  const skippedEntry = loaded?.files.find((f) => f.path === path && f.skipped !== undefined);

  const state = error !== null ? ({ state: 'failed', reason: error, retry: () => setAttempt((n) => n + 1) } as const) : loaded === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const);

  return (
    <AsyncRegion region="diff" label="the diff" {...state}>
      {loaded !== null && (
        <div class="diff-page" data-band={band}>
          {band === 'wide' && (
            <aside class="file-list-region" aria-label="Changed files">
              <button type="button" data-testid="file-list-toggle" ref={toggle} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
                {collapsed ? 'Show changed files' : 'Hide changed files'}
              </button>
              {!collapsed && <FileList sessionId={sessionId} files={loaded.files} current={path} />}
            </aside>
          )}
          {band === 'medium' && (
            <div class="file-drawer-host">
              <button type="button" data-testid="file-list-toggle" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
                Changed files
              </button>
              {drawer && (
                <aside class="file-drawer" aria-label="Changed files" onKeyDown={(e) => e.key === 'Escape' && setDrawer(false)}>
                  <FileList sessionId={sessionId} files={loaded.files} current={path} />
                </aside>
              )}
            </div>
          )}
          <article class="panel stack diff-main">
            <h1 class="mono">{loaded.diff.path}</h1>
            <p>
              <span class="chip">{loaded.diff.status}</span>
              {loaded.diff.previousPath !== undefined && <span class="muted">{` from ${loaded.diff.previousPath}`}</span>}
              <span>{` +${loaded.diff.linesAdded} −${loaded.diff.linesRemoved}`}</span>
            </p>
            {band === 'narrow' && (
              <nav class="file-nav" aria-label="Files">
                {prev !== undefined && (
                  <a data-testid="prev-file" href={buildRoute({ name: 'diff', sessionId, path: prev.path })}>
                    {FILE_NAV_LABELS.previous}
                  </a>
                )}
                {next !== undefined && (
                  <a data-testid="next-file" href={buildRoute({ name: 'diff', sessionId, path: next.path })}>
                    {FILE_NAV_LABELS.next}
                  </a>
                )}
                <a data-testid="all-changed-files" href={buildRoute({ name: 'overview', sessionId })}>
                  {FILE_NAV_LABELS.all}
                </a>
              </nav>
            )}
            <div class="row">
              <button type="button" data-testid="scope-whole-file" onClick={() => select(null)}>
                Whole file
              </button>
              <span data-testid="scope-indicator">{selection === null ? `Selected: ${path} (whole file)` : scopeText(path, selection)}</span>
              {selection !== null && (
                <label>
                  Label
                  <input
                    data-testid="scope-label-input"
                    placeholder="e.g. a method name (optional)"
                    maxLength={MAX_LABEL}
                    value={label}
                    onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
              )}
              <button type="button" class="button" id="ask-about-selection" data-testid="ask-about-selection" onClick={() => ctx.openAsk(currentScope, 'ask-about-selection')}>
                {selection === null ? 'Ask about this file' : 'Ask about selection'}
              </button>
            </div>
            {skippedEntry?.skipped !== undefined ? (
              <p data-testid={`skipped-file-${path}`} data-reason={skippedEntry.skipped}>
                <Badge kind="skipped" reason={skippedEntry.skipped} /> This file is not shown: {skippedEntry.skipped}.
              </p>
            ) : loaded.diff.binary ? (
              <p class="muted" data-testid={`skipped-file-${path}`} data-reason="binary">
                Binary file: no diff is shown.
              </p>
            ) : loaded.diff.hunks.length === 0 ? (
              <p class="muted" data-testid="diff-no-text">
                No textual change: the file is {loaded.diff.status === 'renamed' ? 'only renamed' : 'unchanged in content'}.
              </p>
            ) : (
              <div ref={table} onKeyDown={onKeyDown}>
                {loaded.diff.hunks.map((hunk, h) => (
                  <table key={h} class="diff mono">
                    <caption class="muted diff-hunk-header">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</caption>
                    <tbody>
                      {hunk.lines.map((line, i) => (
                        <DiffRow key={i} line={line} selection={selection} cursor={effectiveCursor} onPick={(side, n) => {
                          setCursor({ side, line: n });
                          select(anchor(selection, side, n));
                        }} />
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            )}
          </article>
        </div>
      )}
    </AsyncRegion>
  );
}

function DiffRow(props: { line: DiffLine; selection: Selection | null; cursor: Cursor | null; onPick: (side: Side, n: number) => void }) {
  const { line, selection, cursor, onPick } = props;
  const headN = lineNumber(line, 'head');
  const baseN = lineNumber(line, 'base');
  const side: Side | null = baseN !== undefined ? 'base' : headN !== undefined ? 'head' : null;
  const n = side === 'base' ? baseN : headN;
  const selected = (headN !== undefined && isSelected(selection, 'head', headN)) || (baseN !== undefined && isSelected(selection, 'base', baseN));
  const mark = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
  const kind = line.type === 'add' ? 'added' : line.type === 'remove' ? 'removed' : 'unchanged';
  const btn = (s: Side, num: number) => (
    <button
      type="button"
      tabIndex={cursor?.side === s && cursor.line === num ? 0 : -1}
      data-cursor={cursor?.side === s && cursor.line === num ? 'true' : undefined}
      aria-label={`${s === 'head' ? 'New' : 'Old'} line ${num}, ${kind}`}
      onClick={() => onPick(s, num)}
    >
      {num}
    </button>
  );
  return (
    <tr
      class="diff-line"
      data-type={line.type}
      aria-selected={side === null ? undefined : selected ? 'true' : 'false'}
      {...(side === null || n === undefined ? {} : { 'data-testid': `diff-line-${side}-${n}` })}
    >
      <td class="line-no">{baseN !== undefined ? btn('base', baseN) : (line.oldLine ?? '')}</td>
      <td class="line-no">{headN !== undefined ? btn('head', headN) : (line.newLine ?? '')}</td>
      <td class="mark" aria-hidden="true">{mark}</td>
      <td class="text">{line.text}</td>
    </tr>
  );
}
