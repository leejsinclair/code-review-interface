// The Specification panel on the Overview (feature 006, contracts/ui.md): where the documents were read, their
// summaries, the sufficiency verdict, one row per acceptance criterion, scope deviations, and a read-only viewer
// for the stored text. Every assessment statement is labelled "Inferred"; nothing here says verified or approved.
// All text from the documents or the AI is rendered as text (SC-008). A gap is always shown with its reason.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AlignmentRow, SpecAlignment, SpecCitation, SpecContextReport, SpecDocument, SpecKeyResult, SpecStatement } from '../../contracts/http.ts';
import { getSpecDocument } from '../api.ts';
import { SPEC_LABELS } from '../labels.ts';
import type { SpecContextState, SpecDocumentView } from '../state/use-spec-context.ts';
import { AsyncRegion } from './async-region.tsx';
import { MarkdownRendered } from './markdown-preview.tsx';

const STATE_TEXT = {
  'Implementation and test identified': SPEC_LABELS.implementedAndTested,
  'Implementation identified': SPEC_LABELS.implemented,
  'Requires verification': SPEC_LABELS.requiresVerification,
  'Not found': SPEC_LABELS.notFound,
} as const;
const STATE_ATTR = {
  'Implementation and test identified': 'implementation-and-test',
  'Implementation identified': 'implementation',
  'Requires verification': 'requires-verification',
  'Not found': 'not-found',
} as const;
const TEST_TEXT = { 'test-shown': SPEC_LABELS.testShown, 'no-test-shown': SPEC_LABELS.noTestShown, 'no-evidence-available': SPEC_LABELS.noEvidence } as const;
const TEST_ATTR = { 'test-shown': 'shown', 'no-test-shown': 'none', 'no-evidence-available': 'no-evidence' } as const;
const VERDICT_TEXT = { sufficient: SPEC_LABELS.verdictSufficient, incomplete: SPEC_LABELS.verdictIncomplete, 'cannot-judge': SPEC_LABELS.verdictCannotJudge } as const;

type Props = { sessionId: string; snapshotId: string | undefined; spec: SpecContextState };

export function SpecContext(props: Props): JSX.Element {
  const { sessionId, snapshotId, spec } = props;
  const { report } = spec;
  const state =
    spec.error !== null
      ? ({ state: 'failed', reason: spec.error, retry: () => void spec.reload() } as const)
      : report === null || report.status === 'searching'
        ? ({ state: 'loading' } as const)
        : ({ state: 'loaded' } as const);
  return (
    <section data-testid="spec-context" aria-labelledby="spec-context-heading">
      <h2 id="spec-context-heading">{SPEC_LABELS.heading}</h2>
      <AsyncRegion region="spec-context" label="the specification" {...state}>
        {report !== null && snapshotId !== undefined && <Loaded sessionId={sessionId} snapshotId={snapshotId} report={report} spec={spec} />}
      </AsyncRegion>
    </section>
  );
}

function Loaded(props: { sessionId: string; snapshotId: string; report: SpecContextReport; spec: SpecContextState }): JSX.Element {
  const { sessionId, snapshotId, report, spec } = props;
  const alignment = report.alignment;
  // The assessment rests on the first key with a found specification (the service's rule); its parts sit under that key.
  const alignedKey = report.keys.find((k) => k.documents.some((d) => d.kind === 'specification' && d.status !== 'missing'))?.key;
  return (
    <>
      <Notices report={report} spec={spec} />
      {report.status === 'none' && report.keys.length === 0 && <Searched report={report} />}
      {report.keys.map((key) => (
        <section key={key.key} data-testid={`spec-key-${key.key}`} aria-label={`Specification for ${key.key}`}>
          {report.keys.length > 1 && <h3>{key.key}</h3>}
          <Sources result={key} spec={spec} />
          <Summaries result={key} alignment={key.key === alignedKey ? alignment : undefined} spec={spec} />
          {key.key === alignedKey && alignment !== undefined && <Alignment sessionId={sessionId} alignment={alignment} spec={spec} />}
        </section>
      ))}
      {spec.open !== null && <DocumentViewer sessionId={sessionId} snapshotId={snapshotId} report={report} view={spec.open} onClose={spec.closeDocument} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ notices

function Notices({ report, spec }: { report: SpecContextReport; spec: SpecContextState }): JSX.Element | null {
  const alignment = report.alignment;
  const gapText = (kind: string, message: string): string =>
    kind === 'no-key' ? SPEC_LABELS.gapNoKey : kind === 'no-enclosing-repository' ? SPEC_LABELS.gapNotInProject : `${SPEC_LABELS.gapSourceUnreadable}: ${message}`;
  const failed = alignment !== undefined && (alignment.state === 'failed' || alignment.state === 'cancelled');
  const running = alignment !== undefined && (alignment.state === 'pending' || alignment.state === 'running');
  const noSpec = report.status === 'none' && report.gaps.every((g) => g.kind !== 'no-key') && report.keys.length > 0;
  const items: JSX.Element[] = [];
  report.gaps.forEach((g, i) => items.push(<p key={`gap-${i}`} class="spec-gap"><strong>Gap:</strong> {gapText(g.kind, g.message)}</p>));
  if (noSpec) items.push(<p key="nospec" class="spec-gap"><strong>Gap:</strong> {SPEC_LABELS.gapNoSpec}</p>);
  if (report.stale) {
    items.push(
      <p key="stale">
        <span data-testid="spec-stale">{SPEC_LABELS.stale}</span> <span>{report.staleReason ?? 'The documents may have changed.'}</span>
      </p>,
    );
  }
  if (running) items.push(<p key="running">Assessment {alignment?.state === 'pending' ? 'queued' : 'running'}…</p>);
  if (failed) {
    items.push(
      <p key="failed" role="alert" class="spec-gap">
        <strong>Assessment {alignment?.state === 'cancelled' ? 'cancelled' : 'failed'}:</strong> {alignment?.reason ?? 'No reason was given.'}
      </p>,
    );
  }
  if (report.canRetry.allowed && (failed || alignment !== undefined) && !running) {
    items.push(
      <button key="retry" type="button" data-testid="spec-retry" onClick={() => void spec.retryAssessment().catch(() => void spec.reload())}>
        {SPEC_LABELS.retry}
      </button>,
    );
  } else if (!report.canRetry.allowed && report.canRetry.reason !== undefined && failed) {
    items.push(<p key="why" class="muted">{report.canRetry.reason}</p>);
  }
  return (
    <div data-testid="spec-notices" aria-live="polite">
      {items}
    </div>
  );
}

function Searched({ report }: { report: SpecContextReport }): JSX.Element {
  return (
    <p class="muted">
      {report.searched.length === 0
        ? 'No repository was searched.'
        : `Searched: ${report.searched.map((s) => `${s.repository} (${s.branches.join(', ') || 'no branches'})`).join('; ')}.`}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ sources and summaries

function describeSource(doc: SpecDocument): string {
  const s = doc.source;
  return s === undefined ? '' : `${s.used.repository} · ${s.used.branch} · ${s.used.commit.slice(0, 8)} · ${s.used.folder}`;
}

function Sources({ result }: { result: SpecKeyResult; spec: SpecContextState }): JSX.Element {
  return (
    <>
      {result.documents.map((doc) => {
        const testid = doc.kind === 'specification' ? 'spec-source-specification' : 'spec-source-tdd';
        const label = doc.kind === 'specification' ? 'Specification' : 'TDD evidence';
        if (doc.source === undefined) return <p key={doc.kind} data-testid={testid}><strong>{label}:</strong> {doc.reason ?? SPEC_LABELS.gapNoSpec}</p>;
        const copies = doc.source.others;
        return (
          <div key={doc.kind}>
            <p data-testid={testid}>
              <strong>{label}</strong> <span>{describeSource(doc)}</span>
              {doc.fileName !== undefined && <span>· {doc.fileName}</span>}
              {doc.status === 'stale' && <span data-testid="spec-stale">{SPEC_LABELS.stale}</span>}
            </p>
            <p data-testid="spec-rule">Chosen by: {doc.source.rule.replace(/-/g, ' ')}.</p>
            {doc.otherSpecFiles.length > 0 && <p class="muted">Other specification files in the folder: {doc.otherSpecFiles.join(', ')}.</p>}
            {copies.map((c, i) => (
              <p key={`${c.repository}-${c.branch}-${i}`} data-testid="spec-other-copy">
                {c.branch === 'develop' ? 'develop also has a copy' : 'Another copy'}: {c.repository} · {c.branch} · {c.commit.slice(0, 8)} · {c.folder}
              </p>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Summaries({ result, alignment, spec }: { result: SpecKeyResult; alignment: SpecAlignment | undefined; spec: SpecContextState }): JSX.Element {
  return (
    <>
      {result.documents.map((doc) => {
        const isSpec = doc.kind === 'specification';
        const text = isSpec ? alignment?.summaries?.specification : alignment?.summaries?.tddEvidence;
        return (
          <div key={doc.kind} data-testid={isSpec ? 'spec-summary-specification' : 'spec-summary-tdd'}>
            {doc.status === 'missing' ? (
              <p class="spec-gap"><strong>Gap:</strong> {isSpec ? SPEC_LABELS.gapNoSpec : 'No TDD evidence was found'}{doc.reason === undefined ? '' : ` (${doc.reason})`}</p>
            ) : (
              <>
                {text !== undefined && (
                  <p>
                    <span class="spec-inferred">{SPEC_LABELS.inferred}</span> {text}
                  </p>
                )}
                <button type="button" data-testid={isSpec ? 'spec-open-specification' : 'spec-open-tdd'} onClick={() => spec.openDocument({ documentId: doc.documentId })}>
                  {SPEC_LABELS.readInFull}
                </button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ alignment

function Citation({ c, sessionId, status, spec }: { c: SpecCitation; sessionId: string; status: SpecStatement['citationStatus']; spec: SpecContextState }): JSX.Element {
  const where = c.type === 'code' ? `${c.path} ${c.side} ${c.startLine}-${c.endLine}` : `${c.type === 'spec' ? 'specification' : 'TDD evidence'} lines ${c.startLine}-${c.endLine}`;
  if (status === 'unverified') {
    return <span data-testid="spec-citation" data-status="unverified" aria-disabled="true">{where}: {SPEC_LABELS.citationUnverified}</span>;
  }
  if (c.type === 'code') {
    return <a data-testid="spec-citation" href={`#/sessions/${sessionId}/diff?path=${encodeURIComponent(c.path)}&line=${c.startLine}`}>{where}</a>;
  }
  return (
    <button type="button" data-testid="spec-citation" onClick={() => spec.openDocument({ documentId: c.documentId, startLine: c.startLine, endLine: c.endLine })}>
      {where}
    </button>
  );
}

function Statement({ s, sessionId, spec }: { s: SpecStatement; sessionId: string; spec: SpecContextState }): JSX.Element {
  return (
    <>
      <span class="spec-inferred">{SPEC_LABELS.inferred}</span> <span>{s.text}</span>{' '}
      {s.citations.map((c, i) => <Citation key={i} c={c} sessionId={sessionId} status={s.citationStatus} spec={spec} />)}
      {s.citations.length === 0 && s.text !== '' && <span class="muted"> ({SPEC_LABELS.citationUnverified})</span>}
    </>
  );
}

function Alignment({ sessionId, alignment, spec }: { sessionId: string; alignment: SpecAlignment; spec: SpecContextState }): JSX.Element | null {
  if (alignment.state !== 'completed') return null;
  const { verdict, deviations } = alignment;
  const statementList = (testid: string, items: SpecStatement[]): JSX.Element => (
    <ul data-testid={testid}>{items.map((s, i) => <li key={i}><Statement s={s} sessionId={sessionId} spec={spec} /></li>)}</ul>
  );
  return (
    <>
      {alignment.warning === 'unparseable-output' && <p class="spec-gap"><strong>Warning:</strong> The provider's output could not be read; it is shown as one inference.</p>}
      {verdict !== undefined && (
        <div data-testid="spec-verdict" data-outcome={verdict.outcome}>
          <p><span class="spec-inferred">{SPEC_LABELS.inferred}</span> <strong>{VERDICT_TEXT[verdict.outcome]}</strong></p>
          {verdict.statement.text !== '' && <p>{verdict.statement.text}</p>}
          {verdict.notJudged !== undefined && <p class="spec-gap">{verdict.notJudged}</p>}
          {verdict.uncovered.length > 0 && (
            <>
              <h4>{SPEC_LABELS.uncovered}</h4>
              <ul data-testid="spec-uncovered">{verdict.uncovered.map((id) => <li key={id}>{id}</li>)}</ul>
            </>
          )}
          {verdict.mismatched.length > 0 && (
            <>
              <h4>{SPEC_LABELS.mismatched}</h4>
              {statementList('spec-mismatched', verdict.mismatched)}
            </>
          )}
        </div>
      )}
      {alignment.rows.length > 0 && <Rows sessionId={sessionId} rows={alignment.rows} spec={spec} />}
      {deviations !== undefined && (
        <div data-testid="spec-deviations">
          {deviations.noneFound ? (
            <p>{SPEC_LABELS.noDeviations}</p>
          ) : (
            <>
              <h4>{SPEC_LABELS.unrequested}</h4>
              {deviations.implementedNotRequested.length === 0 ? <p>None.</p> : statementList('spec-dev-unrequested', deviations.implementedNotRequested)}
              <h4>{SPEC_LABELS.unimplemented}</h4>
              {deviations.requestedNotImplemented.length === 0 ? <p>None.</p> : statementList('spec-dev-unimplemented', deviations.requestedNotImplemented)}
            </>
          )}
        </div>
      )}
      {alignment.leftOut.length > 0 && <p data-testid="spec-left-out">Left out for size: {alignment.leftOut.join('; ')}.</p>}
    </>
  );
}

function Rows({ sessionId, rows, spec }: { sessionId: string; rows: AlignmentRow[]; spec: SpecContextState }): JSX.Element {
  return (
    <table data-testid="spec-rows" aria-label="Acceptance criteria and what the TDD evidence and the code show for each">
      <thead>
        <tr><th scope="col">Criterion</th><th scope="col">Implementation</th><th scope="col">Test</th><th scope="col">Source</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const flagged = r.test === 'no-test-shown' || r.testMismatch;
          return (
            <tr key={r.criterionId} data-testid="spec-row" data-criterion-id={r.criterionId} data-state={STATE_ATTR[r.state]} data-test={TEST_ATTR[r.test]} data-mismatch={r.testMismatch ? 'true' : 'false'}>
              <th scope="row">
                <span>{r.criterionId === r.criterion ? '' : `${r.criterionId} `}{r.criterion}</span> <span class="spec-inferred">{SPEC_LABELS.inferred}</span>
              </th>
              <td>{STATE_TEXT[r.state]}</td>
              <td>
                {TEST_TEXT[r.test]}
                {flagged && <span class="spec-flag">{r.testMismatch ? 'May not test the right thing' : 'No test'}</span>}
              </td>
              <td><Statement s={r.statement} sessionId={sessionId} spec={spec} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------------------------------------ viewer

function DocumentViewer(props: { sessionId: string; snapshotId: string; report: SpecContextReport; view: SpecDocumentView; onClose: () => void }): JSX.Element {
  const { sessionId, snapshotId, report, view, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const cited = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Read in full" opens rendered; a citation opens raw, the only view that can mark and scroll to the cited lines.
  const [mode, setMode] = useState<'preview' | 'raw'>(view.startLine === undefined ? 'preview' : 'raw');
  const doc = report.keys.flatMap((k) => k.documents).find((d) => d.documentId === view.documentId);

  useEffect(() => {
    const el = dialog.current;
    if (el !== null && !el.open) el.showModal(); // focus moves in; the browser returns it to the opener on close
    let live = true;
    setText(null);
    setError(null);
    setMode(view.startLine === undefined ? 'preview' : 'raw');
    getSpecDocument(sessionId, snapshotId, view.documentId).then((t) => live && setText(t)).catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not read the document.'));
    return () => {
      live = false;
    };
  }, [sessionId, snapshotId, view.documentId]);

  useEffect(() => {
    cited.current?.scrollIntoView?.({ block: 'center' });
  }, [text, view.startLine, mode]);

  const lines = text === null ? [] : text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const from = view.startLine ?? 0;
  const to = view.endLine ?? from;
  const line = (l: string, i: number): JSX.Element => <span key={i} class="spec-line">{`${l}\n`}</span>;
  const before = lines.slice(0, from > 0 ? from - 1 : lines.length).map(line);
  const middle = from > 0 ? lines.slice(from - 1, to).map(line) : [];
  const after = from > 0 ? lines.slice(to).map(line) : [];

  return (
    <dialog ref={dialog} data-testid="spec-document" aria-label={doc?.fileName ?? 'Specification document'} onClose={onClose}>
      <p>
        <strong>{doc?.fileName ?? 'Document'}</strong> {doc !== undefined && <span class="muted">{describeSource(doc)}</span>}
      </p>
      {error !== null && <p role="alert" class="spec-gap">{error}</p>}
      <div class="row" role="group" aria-label="Document view">
        <button type="button" class="button" data-testid="spec-view-preview" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
          {SPEC_LABELS.viewPreview}
        </button>
        <button type="button" class="button" data-testid="spec-view-raw" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>
          {SPEC_LABELS.viewRaw}
        </button>
      </div>
      {mode === 'preview' ? (
        text !== null && (
          <div class="spec-document-preview" tabIndex={0}>
            <MarkdownRendered source={text} testid="spec-document-preview" />
          </div>
        )
      ) : (
        <pre data-testid="spec-document-text" tabIndex={0}>
          {before}
          {middle.length > 0 && <span ref={cited} data-testid="spec-cited-lines" class="spec-cited">{middle}</span>}
          {after}
        </pre>
      )}
      <button type="button" onClick={() => dialog.current?.close()}>Close</button>
    </dialog>
  );
}
