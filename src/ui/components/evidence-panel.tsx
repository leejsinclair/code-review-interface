// Evidence panel (FR-021, contracts 4.7): the cited code with its full range highlighted, or the issue or
// description a reference points at, with `open-full-page` linking the existing route.

import { useEffect, useState } from 'preact/hooks';
import type { FileContent, Ref } from '../../contracts/http.ts';
import { ApiError, getFileContent } from '../api.ts';
import { DescriptionView } from '../screens/description.tsx';
import { IssueView } from '../screens/issue.tsx';
import { buildRoute } from '../state/routes.ts';
import { AsyncRegion } from './async-region.tsx';
import { CodeView } from './code-view.tsx';
import { Panel } from './panel.tsx';

/** The existing full-page route for a reference; a code reference needs the snapshot it was cited against. */
export function evidenceRoute(sessionId: string, ref: Ref, snapshot: string | undefined): string {
  if (ref.kind === 'pr') return buildRoute({ name: 'description', sessionId });
  if (ref.kind === 'issue') return buildRoute({ name: 'issue', sessionId, platform: ref.platform, key: ref.key });
  return buildRoute({ name: 'code', sessionId, snapshot: snapshot ?? '', side: ref.side, path: ref.path, range: { start: ref.startLine, end: ref.endLine } });
}

function CodeEvidence(props: { sessionId: string; snapshot: string; path: string; side: 'head' | 'base'; start: number; end: number }) {
  const { sessionId, snapshot, path, side, start, end } = props;
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
    <>
      <p class="mono" data-testid="evidence-path">{`${path} lines ${start}–${end} (${side === 'head' ? 'new' : 'old'} side)`}</p>
      <AsyncRegion region="code" label="the file" {...state}>
        {file !== null && <CodeView lines={file.lines} range={{ start, end }} />}
      </AsyncRegion>
    </>
  );
}

export type EvidencePanelProps = {
  sessionId: string;
  reference: Ref;
  /** Snapshot a code reference was cited against. */
  snapshot: string | undefined;
  openerId?: string | undefined;
  onClose(): void;
};

export function EvidencePanel(props: EvidencePanelProps) {
  const { sessionId, reference: ref, snapshot } = props;
  const title = ref.kind === 'code' ? 'Evidence: code' : ref.kind === 'issue' ? `Evidence: ${ref.key}` : 'Evidence: PR description';
  return (
    <Panel testId="evidence-panel" title={title} openerId={props.openerId} onClose={props.onClose}>
      {ref.kind === 'code' &&
        (snapshot === undefined ? (
          <p class="muted">This citation does not say which version of the code it was made against.</p>
        ) : (
          <CodeEvidence sessionId={sessionId} snapshot={snapshot} path={ref.path} side={ref.side} start={ref.startLine} end={ref.endLine} />
        ))}
      {ref.kind === 'issue' && <IssueView sessionId={sessionId} platform={ref.platform} issueKey={ref.key} embedded />}
      {ref.kind === 'pr' && <DescriptionView sessionId={sessionId} embedded />}
      <a data-testid="open-full-page" href={evidenceRoute(sessionId, ref, snapshot)}>
        Open full page
      </a>
    </Panel>
  );
}
