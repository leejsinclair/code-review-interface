// Code view (`#/sessions/:sessionId/code?snapshot=<id>&side=head|base&path=<path>&line=<n>`, FR-035):
// any file at a snapshot's head commit, or its base commit for a removed line, scrolled to the cited
// line. A commit no longer in the clone shows the server's reason. Code is rendered as text.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { FileContent, Side } from '../../contracts/http.ts';
import { getFileContent } from '../api.ts';

export function CodeScreen(props: { sessionId: string; snapshotId: string; side: Side; path: string; line?: number }) {
  const { sessionId, snapshotId, side, path, line } = props;
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cited = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    setFile(null);
    getFileContent(sessionId, snapshotId, side, path)
      .then(setFile)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not open the file.'));
  }, [sessionId, snapshotId, side, path]);

  useEffect(() => {
    cited.current?.scrollIntoView({ block: 'center' });
  }, [file, line]);

  if (error !== null) return <p class="error">{error}</p>;
  if (file === null) return <p class="muted">Loading…</p>;
  return (
    <article class="panel stack" data-testid="code-view">
      <h1 class="mono">{file.path}</h1>
      <p class="muted">{`${side === 'head' ? 'Head' : 'Base'} commit ${file.commit}`}</p>
      <table class="code mono">
        <tbody>
          {file.lines.map((text, i) => {
            const n = i + 1;
            const isCited = n === line;
            return (
              <tr key={n} data-testid={`code-line-${n}`} class={isCited ? 'selected' : ''} {...(isCited ? { ref: cited } : {})}>
                <td class="line-no">{n}</td>
                <td>{text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <a href={`#/sessions/${encodeURIComponent(sessionId)}`}>Back to the session</a>
    </article>
  );
}
