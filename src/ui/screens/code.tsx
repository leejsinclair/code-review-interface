// Code view (`#/sessions/:sessionId/code?snapshot=<id>&side=head|base&path=<path>&start=<n>&end=<m>`, FR-010,
// FR-028): any file at a snapshot's head commit, or its base commit for a removed line, with the cited lines
// marked. A commit no longer in the clone is a state with its reason, not an error. Code is rendered as text.

import { useEffect, useState } from 'preact/hooks';
import type { FileContent } from '../../contracts/http.ts';
import { ApiError, getFileContent } from '../api.ts';
import { AsyncRegion } from '../components/async-region.tsx';
import { CodeView } from '../components/code-view.tsx';
import { parseRoute, type Route } from '../state/routes.ts';

export function CodeScreen(_props: { sessionId: string }) {
  const route = parseRoute(location.hash);
  if (route.name !== 'code') return <p class="error">This code link is not valid.</p>;
  return <CodePage route={route} />;
}

function CodePage(props: { route: Extract<Route, { name: 'code' }> }) {
  const { sessionId, snapshot, side, path, range } = props.route;
  const [file, setFile] = useState<FileContent | null>(null);
  const [problem, setProblem] = useState<{ unknown: boolean; reason: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFile(null);
    setProblem(null);
    getFileContent(sessionId, snapshot, side, path)
      .then((f) => live && setFile(f))
      .catch((e: unknown) => {
        if (!live) return;
        const reason = e instanceof Error ? e.message : 'Could not open the file.';
        setProblem({ unknown: e instanceof ApiError && (e.code === 'not_found' || e.code === 'workspace_unavailable' || e.code === 'repository_unavailable'), reason });
      });
    return () => {
      live = false;
    };
  }, [sessionId, snapshot, side, path, attempt]);

  const state =
    problem !== null
      ? problem.unknown
        ? ({ state: 'unknown', reason: problem.reason } as const)
        : ({ state: 'failed', reason: problem.reason, retry: () => setAttempt((n) => n + 1) } as const)
      : file === null
        ? ({ state: 'loading' } as const)
        : ({ state: 'loaded' } as const);

  return (
    <article class="panel stack" data-testid="code-view">
      <h1 class="mono">{path}</h1>
      <p class="muted">{`${side === 'head' ? 'Head' : 'Base'} commit ${file?.commit ?? ''}`}</p>
      <AsyncRegion region="code" label="the file" {...state}>
        {file !== null && <CodeView lines={file.lines} range={range} />}
      </AsyncRegion>
      <a
        data-testid="code-back"
        href={`#/sessions/${encodeURIComponent(sessionId)}`}
        onClick={(e) => {
          if (history.length > 1) {
            e.preventDefault();
            history.back();
          }
        }}
      >
        Back
      </a>
    </article>
  );
}
