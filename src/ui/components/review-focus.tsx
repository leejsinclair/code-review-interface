// Review focus (Overview, contracts/ui.md): where to look first. Counts, notices, the Critical then Elevated
// files with reasons, the mechanical candidates and the files not fully analysed. Every string from the pull
// request, a rule or the AI is rendered as text, never markup (FR-034). Nothing here scores, ranks or approves.

import type { RiskClass, RiskFile, RiskReport } from '../../contracts/http.ts';
import { REVIEW_FOCUS, RISK_LABELS } from '../labels.ts';
import { riskFileHref } from '../state/risk-links.ts';
import type { RiskState } from '../state/use-risk.ts';
import { AsyncRegion } from './async-region.tsx';
import { Badge } from './badge.tsx';
import { RiskBadge } from './risk-badge.tsx';
import { notAssessedText } from './risk-text.ts';
import { ReasonItem } from './risk-reasons.tsx';

const KIND_TEXT = { lockfile: 'Lockfile', generated: 'Generated file', 'comment-only': 'Comment-only change', 'rename-only': 'Rename with no change' } as const;

function FileRow(props: { sessionId: string; snapshotId: string; file: RiskFile }) {
  const { sessionId, snapshotId, file } = props;
  return (
    <li data-testid={`risk-row-${file.path}`} class="risk-row">
      <RiskBadge riskClass={file.effectiveClass} />{' '}
      <a class="mono" href={riskFileHref(sessionId, snapshotId, file)}>
        {file.path}
      </a>
      {file.override?.applies === true && (
        <p class="muted" data-testid={`risk-overridden-${file.path}`}>
          {`${RISK_LABELS.overridden}: ${RISK_LABELS.origin.override} set it to ${RISK_LABELS.class[file.effectiveClass]} (was ${RISK_LABELS.class[file.assessedClass]}).`}
        </p>
      )}
      <ul class="risk-reasons-list">
        {file.reasons.filter((r) => r.applied).map((r, i) => (
          <ReasonItem key={i} reason={r} />
        ))}
      </ul>
    </li>
  );
}

function ClassList(props: { sessionId: string; snapshotId: string; riskClass: RiskClass; files: RiskFile[] }) {
  const { riskClass, files } = props;
  if (files.length === 0) return null;
  return (
    <section data-testid={`risk-list-${riskClass}`} aria-label={RISK_LABELS.class[riskClass]}>
      <h3>{RISK_LABELS.class[riskClass]}</h3>
      <ul class="list">
        {files.map((f) => (
          <FileRow key={f.path} sessionId={props.sessionId} snapshotId={props.snapshotId} file={f} />
        ))}
      </ul>
    </section>
  );
}

export function ReviewFocus(props: { sessionId: string; risk: RiskState }) {
  const { sessionId, risk } = props;
  const { report } = risk;
  const region =
    risk.error !== null && report === null
      ? ({ state: 'failed', reason: risk.error, retry: risk.retry } as const)
      : report === null
        ? ({ state: 'loading' } as const)
        : ({ state: 'loaded' } as const);

  return (
    <section class="panel" data-testid="review-focus">
      <h2>{REVIEW_FOCUS.heading}</h2>
      <AsyncRegion region="risk" label="the review focus" {...region}>
        {report !== null && <Body sessionId={sessionId} report={report} />}
      </AsyncRegion>
    </section>
  );
}

const short = (version: string): string => {
  const [commit = '', hash = ''] = version.split(':');
  return `${commit.slice(0, 7)}:${hash.slice(0, 12)}`;
};

/** The status line (FR-027): the AI assessment's state and what it ignored. A labelled status, not colour only. */
function Notices(props: { report: RiskReport }) {
  const { ai } = props.report;
  const waiting = ai.state === 'pending' || ai.state === 'running';
  const missing = ai.state === 'failed' || ai.state === 'cancelled' || ai.state === 'none';
  return (
    <div data-testid="risk-notices" aria-live="polite">
      {ai.olderHead === true && (
        <p data-testid="risk-older-head">
          <Badge kind="older-head" commit={props.report.headCommit} /> This is an older snapshot; its AI assessment belongs to that head.
        </p>
      )}
      {props.report.ruleset.ruleFile === 'ignored' && (
        <p data-testid="risk-rule-file">
          {`Rule file ignored (risk-rules.json): ${props.report.ruleset.notice.map((n) => n.reason).join('; ')}. The built-in rules apply.`}
        </p>
      )}
      {props.report.ruleset.ruleFile === 'partly-ignored' && (
        <p data-testid="risk-rule-file">
          {`Rule file entries ignored (risk-rules.json): ${props.report.ruleset.notice.map((n) => `entry ${n.entry}: ${n.reason}`).join('; ')}. The built-in rules apply to them.`}
        </p>
      )}
      {waiting && <p data-testid="risk-ai-progress">{RISK_LABELS.aiInProgress}</p>}
      {missing && (
        <p data-testid="risk-ai-missing">
          {RISK_LABELS.aiMissing}
          {ai.reason === undefined ? '' : `: ${ai.reason}`}
        </p>
      )}
      {ai.state === 'completed' && ai.provider !== undefined && (
        <p class="muted" data-testid="risk-ai-run">
          {`AI assessment by ${ai.provider}${ai.contextVersion === undefined ? '' : `, context ${short(ai.contextVersion)}`}`}
        </p>
      )}
      {props.report.counts.overrides > 0 && (
        <p data-testid="risk-overrides-count">{`Overrides in effect: ${props.report.counts.overrides}`}</p>
      )}
      {ai.ignoredCount > 0 && (
        <p data-testid="risk-ai-ignored">
          {`${RISK_LABELS.aiIgnored}: ${ai.ignoredCount} ${ai.ignoredCount === 1 ? 'file' : 'files'}. The AI can only raise a class, and only with a changed line the workbench can find; these did not count.`}
        </p>
      )}
    </div>
  );
}

function Body(props: { sessionId: string; report: NonNullable<RiskState['report']> }) {
  const { sessionId, report } = props;
  const { counts, files, snapshotId } = report;
  const by = (c: RiskClass): RiskFile[] => files.filter((f) => f.effectiveClass === c);
  const critical = by('critical');
  const elevated = by('elevated');
  const mechanical = files.filter((f) => f.mechanical);
  const unanalysed = files.filter((f) => f.notFullyAnalysed !== undefined);
  return (
    <div class="stack">
      <p data-testid="risk-counts">{`${RISK_LABELS.class.critical} ${counts.critical} · ${RISK_LABELS.class.elevated} ${counts.elevated} · ${RISK_LABELS.class.normal} ${counts.normal} · ${RISK_LABELS.class.low} ${counts.low}`}</p>
      <Notices report={report} />
      <ClassList sessionId={sessionId} snapshotId={snapshotId} riskClass="critical" files={critical} />
      <ClassList sessionId={sessionId} snapshotId={snapshotId} riskClass="elevated" files={elevated} />
      {files.length > 0 && critical.length === 0 && elevated.length === 0 && <p data-testid="risk-no-elevated">No file is Elevated or Critical.</p>}
      {mechanical.length > 0 && (
        <section data-testid="risk-list-mechanical" aria-label={RISK_LABELS.mechanical}>
          <h3>{RISK_LABELS.mechanical}</h3>
          <ul class="list">
            {mechanical.map((f) => (
              <li key={f.path} data-testid={`risk-mechanical-${f.path}`}>
                <RiskBadge riskClass={f.effectiveClass} />{' '}
                <a class="mono" href={riskFileHref(sessionId, snapshotId, f)}>
                  {f.path}
                </a>{' '}
                <span class="muted">{f.mechanicalKind === undefined ? '' : KIND_TEXT[f.mechanicalKind]}</span>
                {f.ai.state === 'not-assessed' && <span class="muted">{` · ${notAssessedText(f.ai.notAssessedReason)}`}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {unanalysed.length > 0 && (
        <section data-testid="risk-list-not-analysed" aria-label={RISK_LABELS.notFullyAnalysed}>
          <h3>{RISK_LABELS.notFullyAnalysed}</h3>
          <ul class="list">
            {unanalysed.map((f) => (
              <li key={f.path} data-testid={`risk-unanalysed-${f.path}`}>
                <RiskBadge riskClass={f.effectiveClass} />{' '}
                <a class="mono" href={riskFileHref(sessionId, snapshotId, f)}>
                  {f.path}
                </a>{' '}
                <span class="muted">{f.notFullyAnalysed}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {files.length === 0 && <p data-testid="risk-no-files">No changed files.</p>}
    </div>
  );
}
