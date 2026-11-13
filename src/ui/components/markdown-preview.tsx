// Markdown preview (Files view): the file at a snapshot, rendered as sanitized Markdown, with Mermaid blocks drawn as
// diagrams. A diagram that cannot be drawn shows its reason and its source; it never breaks the rest of the preview.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FileContent, Side } from '../../contracts/http.ts';
import { ApiError, getFileContent } from '../api.ts';
import { AsyncRegion } from './async-region.tsx';
import { renderMarkdown } from '../markdown/render.ts';
import { renderMermaid, type Diagram } from '../markdown/mermaid.ts';

let counter = 0;
const DISCOVERY_RETRY_MS = 3000;

function showDiagram(host: HTMLElement, source: string, index: number, diagram: Diagram): void {
  const img = document.createElement('img');
  img.src = diagram.src;
  if (diagram.width !== undefined && diagram.height !== undefined) {
    img.width = diagram.width;
    img.height = diagram.height;
  }
  img.alt = `Mermaid diagram ${index + 1}`;
  img.dataset.testid = 'mermaid-diagram';
  img.setAttribute('data-testid', 'mermaid-diagram');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Diagram source';
  const pre = document.createElement('pre');
  pre.textContent = source;
  details.append(summary, pre);
  host.replaceChildren(img, details);
}

function showDiagramError(host: HTMLElement, source: string, message: string): void {
  const p = document.createElement('p');
  p.className = 'muted';
  p.setAttribute('data-testid', 'mermaid-error');
  p.textContent = `Diagram could not be drawn: ${message}`;
  const pre = document.createElement('pre');
  pre.textContent = source;
  host.replaceChildren(p, pre);
}

export function MarkdownRendered(props: { source: string; testid?: string }) {
  const rendered = useMemo(() => renderMarkdown(props.source), [props.source]);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current;
    if (root === null || rendered.mermaid.length === 0) return;
    let live = true;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.querySelectorAll<HTMLElement>('.md-mermaid').forEach((el) => {
      const index = Number(el.dataset.mermaidIndex);
      const source = rendered.mermaid[index];
      if (source === undefined) return;
      el.textContent = 'Drawing diagram…';
      const id = `mermaid-${++counter}`;
      renderMermaid(source, id, dark)
        .then((diagram) => live && showDiagram(el, source, index, diagram))
        .catch((e: unknown) => live && showDiagramError(el, source, e instanceof Error ? e.message : 'Invalid diagram.'))
        .finally(() => document.getElementById(`d${id}`)?.remove());
    });
    return () => {
      live = false;
    };
  }, [rendered]);

  return <div ref={host} class="markdown-body" data-testid={props.testid ?? 'markdown-preview'} dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}

export function MarkdownPreview(props: { sessionId: string; snapshotId: string; path: string; side: Side }) {
  const { sessionId, snapshotId, path, side } = props;
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFile(null);
    setError(null);
    getFileContent(sessionId, snapshotId, side, path)
      .then((f) => {
        if (!live) return;
        setWaiting(false);
        setFile(f);
      })
      .catch((e: unknown) => {
        if (!live) return;
        // The clone may not be found yet while the base folder is still being scanned: wait and ask again.
        if (e instanceof ApiError && e.code === 'repository_unavailable' && /still running/i.test(e.message)) {
          setWaiting(true);
          timer = setTimeout(() => setAttempt((n) => n + 1), DISCOVERY_RETRY_MS);
          return;
        }
        setWaiting(false);
        setError(e instanceof Error ? e.message : 'Could not open the file.');
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sessionId, snapshotId, side, path, attempt]);

  const state =
    error !== null
      ? ({ state: 'failed', reason: error, retry: () => setAttempt((n) => n + 1) } as const)
      : file === null
        ? ({ state: 'loading' } as const)
        : ({ state: 'loaded' } as const);

  return (
    <AsyncRegion region="preview" label={waiting ? 'the preview (looking for the repository on disk)' : 'the preview'} {...state}>
      {file !== null && <MarkdownRendered source={file.lines.join('\n')} />}
    </AsyncRegion>
  );
}
