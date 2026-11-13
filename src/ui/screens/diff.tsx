// Diff screen (`#/sessions/:sessionId/diff?path=<path>`, FR-005 to FR-008, FR-022, FR-024, FR-028): one changed
// file with a line-range selection by pointer or keyboard, the file list beside it (wide and medium) or as
// previous/next links (narrow), and the file's AI notes with the Ask form (a column when wide, else above the code).
// Code is rendered as text.

import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChangedFile, DiffLine, FileDiff, ReviewCommentItem, Scope, Side, SnapshotDetail } from '../../contracts/http.ts';
import { getFileDiff, getSession, getSnapshot } from '../api.ts';
import { AsyncRegion } from '../components/async-region.tsx';
import { Badge } from '../components/badge.tsx';
import { FileList } from '../components/file-list.tsx';
import { CommentBox } from '../components/comment-box.tsx';
import { CommentThread } from '../components/comment-thread.tsx';
import { DecisionPanel } from '../components/decision-panel.tsx';
import { FileNotes } from '../components/file-notes.tsx';
import { OverrideDialog, OverrideHistory, OverrideState } from '../components/override-dialog.tsx';
import { RiskBadge } from '../components/risk-badge.tsx';
import { RiskReasons } from '../components/risk-reasons.tsx';
import { FILE_NAV_LABELS, ICON_LABELS, REVIEW_LABELS } from '../labels.ts';
import { arrangeFiles, neighbours } from '../state/file-order.ts';
import { fileScope } from '../state/review-scope.ts';
import { useBand } from '../state/layout.ts';
import { useFileView } from '../state/use-file-view.ts';
import { useReviewComments, threadsOf } from '../state/use-review-comments.ts';
import { useReviewDecision } from '../state/use-review-decision.ts';
import { buildRoute, codeHref, type DiffFocus } from '../state/routes.ts';
import { ReviewContext } from '../state/review-context.ts';
import { anchor, extend, isSelected, lineNumber, move, scopeText, toScope, type Cursor, type Selection } from '../state/selection.ts';
import { riskMarks, type RiskMark } from '../state/risk-links.ts';
import { useRisk } from '../state/use-risk.ts';
import { readSession, writeSession } from '../state/view-state.ts';
import { Flag, PanelLeftClose, PanelLeftOpen } from 'lucide-preact';
import { RISK_LABELS } from '../labels.ts';
import { IconButton } from '../components/icon-button.tsx';
import { MarkdownPreview } from '../components/markdown-preview.tsx';
import { isMarkdownPath } from '../markdown/render.ts';

const MAX_LABEL = 200;
const KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

type Loaded = { diff: FileDiff; files: ChangedFile[]; snapshot: SnapshotDetail };

function selectionFromScope(scope: Scope | undefined, path: string): Selection | null {
  if (scope === undefined || scope.type !== 'range' || scope.path !== path) return null;
  return { side: scope.side, anchor: scope.startLine, focus: scope.endLine };
}

/** Whether the diff is of the cited snapshot and shows every line of the cited range on the cited side. */
function canShow(diff: FileDiff, snapshotId: string, focus: DiffFocus): boolean {
  if (focus.snapshot !== snapshotId || diff.binary) return false;
  const shown = new Set<number>();
  for (const h of diff.hunks) for (const l of h.lines) {
    const n = lineNumber(l, focus.side);
    if (n !== undefined) shown.add(n);
  }
  for (let n = focus.start; n <= focus.end; n++) if (!shown.has(n)) return false;
  return true;
}

export function DiffScreen(props: { sessionId: string; path: string; focus?: DiffFocus | undefined }) {
  const { sessionId, path, focus } = props;
  const ctx = useContext(ReviewContext);
  const band = useBand();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(() =>
    focus === undefined ? selectionFromScope(readSession(sessionId).scope, path) : { side: focus.side, anchor: focus.start, focus: focus.end },
  );
  const [cursor, setCursor] = useState<Cursor | null>(focus === undefined ? null : { side: focus.side, line: focus.start });
  const [label, setLabel] = useState('');
  const [collapsed, setCollapsedState] = useState(() => readSession(sessionId).fileListCollapsed === true);
  const setCollapsed = (v: boolean): void => {
    setCollapsedState(v);
    writeSession(sessionId, { fileListCollapsed: v });
  };
  const [mdPreview, setMdPreviewState] = useState(() => readSession(sessionId).markdownPreview === true);
  const setMdPreview = (v: boolean): void => {
    setMdPreviewState(v);
    writeSession(sessionId, { markdownPreview: v });
  };
  const table = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusCursor = useRef(false);
  const [markIdx, setMarkIdx] = useState(-1);
  const risk = useRisk(sessionId, loaded?.snapshot.snapshotId);
  const fileView = useFileView(sessionId);
  const overrideDialog = useRef<HTMLDialogElement>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const reviewComments = useReviewComments(sessionId);
  const decision = useReviewDecision(sessionId);
  const [commenting, setCommenting] = useState(false);
  const riskFile = risk.report?.files.find((f) => f.path === path);
  const marks = useMemo(() => (riskFile === undefined ? new Map<string, RiskMark>() : riskMarks(riskFile)), [riskFile]);

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
        if (focus !== undefined && !canShow(r.diff, r.snapshot.snapshotId, focus)) {
          // The diff does not show every cited line (unchanged code, a skipped file, an older snapshot): the code page does.
          location.replace(codeHref(sessionId, { snapshot: focus.snapshot, side: focus.side, path, start: focus.start, end: focus.end }));
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
    if (focus === undefined || loaded === null) return;
    table.current?.querySelector(`[data-testid="diff-line-${focus.side}-${focus.start}"]`)?.scrollIntoView({ block: 'center' });
  }, [loaded]);

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
  /** The marked lines in the order the diff shows them. */
  const markOrder: RiskMark[] = rows.flatMap((r) => {
    const head = r.newLine === undefined ? undefined : marks.get(`head:${r.newLine}`);
    const base = r.oldLine === undefined ? undefined : marks.get(`base:${r.oldLine}`);
    const found = head ?? base;
    return found === undefined ? [] : [found];
  });
  const stepMark = (by: 1 | -1): void => {
    const i = markIdx + by;
    if (i < 0 || i >= markOrder.length) {
      ctx.announce(by === 1 ? 'No further risk mark' : 'No previous risk mark');
      return;
    }
    const m = markOrder[i]!;
    setMarkIdx(i);
    setCursor({ side: m.side, line: m.line });
    focusCursor.current = true;
    ctx.announce(`Risk mark ${i + 1} of ${markOrder.length}: ${m.label}`);
  };
  const select = (next: Selection | null): void => {
    setSelection(next);
    if (next === null) setCommenting(false);
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
  // Next and Previous follow the tab's chosen order and review scope (FR-030); the current file counts even when the scope hides it.
  const scoped = fileScope(loaded?.files ?? [], risk.report, fileView.scope);
  const arranged = arrangeFiles(loaded?.files ?? [], scoped.classOf, {
    order: risk.report === null ? 'diff' : fileView.order,
    classes: risk.report === null ? [] : scoped.scope.classes,
    text: '',
  });
  const around = arranged.some((f) => f.path === path)
    ? neighbours(arranged, path)
    : { prev: undefined, next: undefined };
  const { prev, next } = around;
  const skippedEntry = loaded?.files.find((f) => f.path === path && f.skipped !== undefined);
  const threadsAt = new Map<string, ReviewCommentItem[][]>();
  for (const thread of threadsOf(reviewComments.comments)) {
    const a = thread[0]?.anchor;
    if (a === null || a === undefined || a.path !== path) continue;
    const key = `${a.side}:${a.endLine}`;
    threadsAt.set(key, [...(threadsAt.get(key) ?? []), thread]);
  }
  const head = loaded?.snapshot.headCommit ?? '';
  const lineCommentCap = decision.state?.capability.line_comment;
  const canComment = lineCommentCap?.allowed === true && head !== '';

  const commentable = loaded !== null && skippedEntry?.skipped === undefined && !loaded.diff.binary && loaded.diff.hunks.length > 0;
  // Markdown files can be read rendered; a cited line range needs the diff, so a citation always opens the diff.
  const previewable = loaded !== null && isMarkdownPath(path) && skippedEntry?.skipped === undefined && !loaded.diff.binary;
  const previewing = previewable && mdPreview && focus === undefined;
  const state = error !== null ? ({ state: 'failed', reason: error, retry: () => setAttempt((n) => n + 1) } as const) : loaded === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const);

  return (
    <AsyncRegion region="diff" label="the diff" {...state}>
      {loaded !== null && (
        <div class="diff-page" data-band={band} data-notes={band === 'wide' ? 'true' : undefined} data-files={collapsed ? 'collapsed' : undefined}>
          {band !== 'narrow' && (
            <aside class="file-list-region" aria-label="Changed files">
              <IconButton
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                label={collapsed ? ICON_LABELS.showChangedFiles : ICON_LABELS.hideChangedFiles}
                data-testid="file-list-toggle"
                buttonRef={toggle}
                expanded={!collapsed}
                onClick={() => setCollapsed(!collapsed)}
              />
              {!collapsed && <FileList sessionId={sessionId} files={loaded.files} current={path} risk={risk.report} view={fileView} />}
            </aside>
          )}
          <article class="panel stack diff-main">
            <header class="file-head">
              <h1 class="mono">{loaded.diff.path}</h1>
              <p class="muted file-meta-line">
                <span class="chip">{loaded.diff.status}</span>
                {loaded.diff.previousPath !== undefined && <span>{` from ${loaded.diff.previousPath}`}</span>}
                <span>{` +${loaded.diff.linesAdded} −${loaded.diff.linesRemoved}`}</span>
              </p>
              {previewable && (
                <div class="row" role="group" aria-label="File view">
                  <button type="button" class="button" data-testid="md-view-diff" aria-pressed={!previewing} onClick={() => setMdPreview(false)}>
                    Diff
                  </button>
                  <button type="button" class="button" data-testid="md-view-preview" aria-pressed={previewing} onClick={() => setMdPreview(true)}>
                    Preview
                  </button>
                </div>
              )}
            </header>
            {band === 'narrow' && (
              <nav class="file-nav" aria-label="Files">
                {prev !== undefined ? (
                  <a data-testid="prev-file" href={buildRoute({ name: 'diff', sessionId, path: prev.path })}>
                    {FILE_NAV_LABELS.previous}
                  </a>
                ) : (
                  <span class="muted" data-testid="no-prev-file">
                    {FILE_NAV_LABELS.noPrevious}
                  </span>
                )}
                {next !== undefined ? (
                  <a data-testid="next-file" href={buildRoute({ name: 'diff', sessionId, path: next.path })}>
                    {FILE_NAV_LABELS.next}
                  </a>
                ) : (
                  <span class="muted" data-testid="no-next-file">
                    {FILE_NAV_LABELS.noNext}
                  </span>
                )}
                <a data-testid="all-changed-files" href={buildRoute({ name: 'overview', sessionId })}>
                  {FILE_NAV_LABELS.all}
                </a>
              </nav>
            )}
            {riskFile !== undefined && (
              <div class="file-risk" data-testid="file-risk">
                <RiskBadge riskClass={riskFile.effectiveClass} />
                <div class="file-risk-body">
                  <RiskReasons file={riskFile} />
                  <OverrideState file={riskFile} />
                  {riskFile.override !== undefined && <OverrideHistory sessionId={sessionId} path={path} version={historyVersion} />}
                  {markOrder.length > 0 && (
                    <div class="row">
                      <button type="button" data-testid="prev-risk-mark" onClick={() => stepMark(-1)}>
                        Previous risk mark
                      </button>
                      <button type="button" data-testid="next-risk-mark" onClick={() => stepMark(1)}>
                        Next risk mark
                      </button>
                    </div>
                  )}
                </div>
                <div class="file-risk-action">
                  {risk.report?.canOverride.allowed === true ? (
                    <>
                      <button
                        type="button"
                        class="link-button"
                        data-testid="override-class-button"
                        id="override-class-button"
                        onClick={() => {
                          overrideDialog.current?.showModal();
                          setTimeout(() => document.getElementById('override-class-select')?.focus(), 0);
                        }}
                      >
                        Override class
                      </button>
                      <OverrideDialog
                        key={`${riskFile.path}:${riskFile.effectiveClass}`}
                        dialogRef={overrideDialog}
                        sessionId={sessionId}
                        snapshotId={loaded.snapshot.snapshotId}
                        file={riskFile}
                        onClosed={() => document.getElementById('override-class-button')?.focus()}
                        onSaved={async (record) => {
                          await risk.reload();
                          setHistoryVersion((n) => n + 1);
                          ctx.announce(`Class changed from ${RISK_LABELS.class[riskFile.effectiveClass]} to ${RISK_LABELS.class[record.class]}`);
                          setTimeout(() => document.getElementById('override-class-button')?.focus(), 0);
                        }}
                      />
                    </>
                  ) : (
                    <p class="muted" data-testid="override-unavailable">
                      {risk.report?.canOverride.reason ?? 'Overrides are not available here.'}
                    </p>
                  )}
                </div>
              </div>
            )}
            {risk.error !== null && risk.report === null && (
              <p class="muted" data-testid="file-risk-error">
                The risk class could not be loaded: {risk.error}{' '}
                <button type="button" onClick={risk.retry}>
                  Retry
                </button>
              </p>
            )}
            <div class="scope-bar" data-testid="scope-bar">
              <span class={selection === null ? 'muted' : undefined} data-testid="scope-indicator">
                {selection === null ? 'Click line numbers to select a range to ask or comment on.' : scopeText(path, selection)}
              </span>
              {selection !== null && (
                <>
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
                  <button type="button" data-testid="scope-whole-file" onClick={() => select(null)}>
                    Clear selection
                  </button>
                  {commentable && !previewing && (
                    <button type="button" class="button" data-testid="line-comment-button" disabled={!canComment} onClick={() => setCommenting(true)}>
                      Comment on selection
                    </button>
                  )}
                </>
              )}
              <button type="button" class="button primary" id="ask-about-selection" data-testid="ask-about-selection" onClick={() => document.getElementById('notes-question-input')?.focus()}>
                {selection === null ? 'Ask about this file' : 'Ask about selection'}
              </button>
            </div>
            {commenting && selection !== null && (
              <CommentBox
                sessionId={sessionId}
                expectedHead={head}
                build={(text) => ({
                  kind: 'comment',
                  destination: 'line',
                  body: text,
                  anchor: { path, side: selection.side, startLine: Math.min(selection.anchor, selection.focus), endLine: Math.max(selection.anchor, selection.focus), commit: head },
                })}
                onPosted={() => {
                  setCommenting(false);
                  void reviewComments.reload();
                  ctx.announce('Comment posted');
                }}
                onCancel={() => setCommenting(false)}
              />
            )}
            {band !== 'wide' && <FileNotes sessionId={sessionId} path={path} scope={currentScope} selected={selection !== null} />}
            {skippedEntry?.skipped !== undefined ? (
              <p data-testid={`skipped-file-${path}`} data-reason={skippedEntry.skipped}>
                <Badge kind="skipped" reason={skippedEntry.skipped} /> This file is not shown: {skippedEntry.skipped}.
              </p>
            ) : loaded.diff.binary ? (
              <p class="muted" data-testid={`skipped-file-${path}`} data-reason="binary">
                Binary file: no diff is shown.
              </p>
            ) : previewing ? (
              <MarkdownPreview sessionId={sessionId} snapshotId={loaded.snapshot.snapshotId} path={path} side={loaded.diff.status === 'deleted' ? 'base' : 'head'} />
            ) : loaded.diff.hunks.length === 0 ? (
              <p class="muted" data-testid="diff-no-text">
                No textual change: the file is {loaded.diff.status === 'renamed' ? 'only renamed' : 'unchanged in content'}.
              </p>
            ) : (
              <div ref={table} onKeyDown={onKeyDown}>
                {loaded.diff.hunks.map((hunk, h) => (
                  <div key={h} class="diff-hunk">
                    <table class="diff mono">
                      <caption class="muted diff-hunk-header">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</caption>
                      <tbody>
                        {hunk.lines.map((line, i) => (
                          <DiffRowWithThreads key={i} line={line} marks={marks} selection={selection} cursor={effectiveCursor} onPick={(side, n) => {
                            setCursor({ side, line: n });
                            select(anchor(selection, side, n));
                          }}
                            threads={threadsAt}
                            render={(thread) => (
                              <CommentThread
                                sessionId={sessionId}
                                expectedHead={head}
                                comments={thread}
                                {...(decision.state?.capability.reply.allowed === false ? { disabledReason: decision.state.capability.reply.reason ?? REVIEW_LABELS.outOfDate } : {})}
                                onChanged={() => void reviewComments.reload()}
                              />
                            )}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
            <DecisionPanel sessionId={sessionId} expectedHead={head} onCommented={() => void reviewComments.reload()} />
          </article>
          {band === 'wide' && <FileNotes sessionId={sessionId} path={path} scope={currentScope} selected={selection !== null} />}
        </div>
      )}
    </AsyncRegion>
  );
}

function DiffRow(props: { line: DiffLine; marks: ReadonlyMap<string, RiskMark>; selection: Selection | null; cursor: Cursor | null; onPick: (side: Side, n: number) => void }) {
  const { line, marks, selection, cursor, onPick } = props;
  const headN = lineNumber(line, 'head');
  const baseN = lineNumber(line, 'base');
  const side: Side | null = baseN !== undefined ? 'base' : headN !== undefined ? 'head' : null;
  const n = side === 'base' ? baseN : headN;
  const selected = (headN !== undefined && isSelected(selection, 'head', headN)) || (baseN !== undefined && isSelected(selection, 'base', baseN));
  const riskMark = (headN === undefined ? undefined : marks.get(`head:${headN}`)) ?? (baseN === undefined ? undefined : marks.get(`base:${baseN}`));
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
      <td class="risk-mark" data-testid={side === null || n === undefined ? undefined : `risk-mark-${side}-${n}`}>
        {riskMark !== undefined && (
          <span role="img" aria-label={`Risk mark: ${riskMark.label}`} title={riskMark.label}>
            <Flag size={14} aria-hidden="true" focusable="false" />
          </span>
        )}
      </td>
      <td class="text">{line.text}</td>
    </tr>
  );
}

/** A diff row followed by the comment threads that end on it (one row per thread, spanning the table). */
function DiffRowWithThreads(props: Parameters<typeof DiffRow>[0] & { threads: ReadonlyMap<string, ReviewCommentItem[][]>; render: (thread: ReviewCommentItem[]) => preact.ComponentChild }) {
  const { threads, render, ...row } = props;
  const keys = [row.line.newLine === undefined ? null : `head:${row.line.newLine}`, row.line.type === 'remove' && row.line.oldLine !== undefined ? `base:${row.line.oldLine}` : null];
  const here = keys.flatMap((k) => (k === null ? [] : (threads.get(k) ?? [])));
  return (
    <>
      <DiffRow {...row} />
      {here.map((thread) => (
        <tr class="comment-row" key={thread[0]?.id}>
          <td colSpan={5}>{render(thread)}</td>
        </tr>
      ))}
    </>
  );
}
