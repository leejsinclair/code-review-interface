// Diff screen (`#/sessions/:sessionId/diff?path=<path>`, FR-033, FR-034): one changed file of the
// latest snapshot with its status, lines added and removed, and hunks. A line on either side starts a
// range scope and a second line on the same side ends it; "Whole file" makes the file the scope.
// The range can carry an optional label, such as a method name (FR-013). Code is rendered as text.

import { useEffect, useState } from 'preact/hooks';
import type { DiffLine, FileDiff, Scope, Side } from '../../contracts/http.ts';
import { getFileDiff, getSession } from '../api.ts';
import { askHash, scopeText } from './ask.tsx';

const MAX_LABEL = 200;

function lineKey(line: DiffLine): { side: Side; n: number } | null {
  if (line.type === 'remove' && line.oldLine !== undefined) return { side: 'base', n: line.oldLine };
  if (line.newLine !== undefined) return { side: 'head', n: line.newLine };
  return null;
}

export function DiffScreen(props: { sessionId: string; path: string }) {
  const { sessionId, path } = props;
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({ type: 'file', path });
  const [label, setLabel] = useState('');

  useEffect(() => {
    setDiff(null);
    setScope({ type: 'file', path });
    getSession(sessionId)
      .then((detail) => {
        const latest = detail.snapshots[detail.snapshots.length - 1];
        if (latest === undefined) throw new Error('The session has no snapshot.');
        return getFileDiff(sessionId, latest.snapshotId, path);
      })
      .then(setDiff)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the diff.'));
  }, [sessionId, path]);

  const select = (side: Side, n: number): void => {
    if (scope.type === 'range' && scope.side === side && scope.startLine === scope.endLine && n !== scope.startLine) {
      setScope({ ...scope, startLine: Math.min(n, scope.startLine), endLine: Math.max(n, scope.startLine) });
    } else {
      setScope({ type: 'range', path, side, startLine: n, endLine: n });
    }
  };
  const selected = (side: Side, n: number): boolean => scope.type === 'range' && scope.side === side && n >= scope.startLine && n <= scope.endLine;
  const withLabel: Scope = scope.type === 'range' && label.trim() !== '' ? { ...scope, label: label.trim() } : scope;

  if (error !== null) return <p class="error">{error}</p>;
  if (diff === null) return <p class="muted">Loading…</p>;
  return (
    <article class="panel stack">
      <h1 class="mono">{diff.path}</h1>
      <p>
        <span class="chip">{diff.status}</span>
        {diff.previousPath !== undefined && <span class="muted">{` from ${diff.previousPath}`}</span>}
        <span>{` +${diff.linesAdded} -${diff.linesRemoved}`}</span>
      </p>
      <div class="row">
        <button type="button" data-testid="scope-whole-file" onClick={() => setScope({ type: 'file', path })}>
          Whole file
        </button>
        <span data-testid="scope-indicator">{scopeText(withLabel)}</span>
        {scope.type === 'range' && (
          <input
            data-testid="scope-label-input"
            placeholder="Label, e.g. a method name (optional)"
            maxLength={MAX_LABEL}
            value={label}
            onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)}
          />
        )}
        <a class="button" href={askHash(sessionId, withLabel)}>
          Ask about this
        </a>
      </div>
      {diff.binary ? (
        <p class="muted">Binary file: no diff is shown.</p>
      ) : diff.hunks.length === 0 ? (
        <p class="muted">No line changes.</p>
      ) : (
        diff.hunks.map((hunk, h) => (
          <table key={h} class="diff mono">
            <caption class="muted">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</caption>
            <tbody>
              {hunk.lines.map((line, i) => {
                const key = lineKey(line);
                const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
                return (
                  <tr
                    key={i}
                    class={`diff-${line.type}${key !== null && selected(key.side, key.n) ? ' selected' : ''}`}
                    {...(key === null ? {} : { 'data-testid': `diff-line-${key.side}-${key.n}`, onClick: () => select(key.side, key.n) })}
                  >
                    <td class="line-no">{line.oldLine ?? ''}</td>
                    <td class="line-no">{line.newLine ?? ''}</td>
                    <td>{`${marker}${line.text}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))
      )}
    </article>
  );
}
