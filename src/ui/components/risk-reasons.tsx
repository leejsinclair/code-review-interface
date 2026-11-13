// The reasons behind a file's class (contracts/ui.md): each rule with its ID, or the AI, with distinct origin
// labels (constitution III.1); a path-only match says so; a rule that would have applied and was not is shown
// as such. Everything is text, never markup (FR-034).

import type { RiskFile, RiskReason } from '../../contracts/http.ts';
import { RISK_LABELS } from '../labels.ts';
import { notAssessedText } from './risk-text.ts';

export const PATH_ONLY_NOTE = 'Matched on the path; no changed lines';

export function originLabel(reason: RiskReason): string {
  if (reason.origin === 'ai') return RISK_LABELS.origin.ai;
  if (reason.origin === 'rule') return `${RISK_LABELS.origin.rule} ${reason.ruleId ?? ''}`.trim();
  return '';
}

export function ReasonItem(props: { reason: RiskReason; detail?: boolean }) {
  const { reason, detail = false } = props;
  const origin = originLabel(reason);
  return (
    <li class={reason.applied ? undefined : 'reason-not-applied'} data-origin={reason.origin} data-applied={reason.applied ? 'true' : 'false'}>
      {origin !== '' && <span class="mono reason-origin">{origin}</span>} <span class="reason-text">{reason.text}</span>
      {detail && reason.origin === 'rule' && reason.applied && reason.matchedOn === 'path' && <span class="muted reason-note">{` ${PATH_ONLY_NOTE}.`}</span>}
    </li>
  );
}

/** The origin of the class in force: rule, AI or a reviewer's override. */
export function RiskReasons(props: { file: RiskFile }) {
  const { file } = props;
  return (
    <div data-testid="risk-reasons" class="risk-reasons">
      <ul class="risk-reasons-list">
        {file.reasons.map((r, i) => (
          <ReasonItem key={i} reason={r} detail />
        ))}
      </ul>
      <AiState file={file} />
    </div>
  );
}

const IGNORED_WHY = {
  'not-higher': 'it was not higher than the rule class',
  'no-resolvable-line': 'it cited no changed line the workbench could find',
  'unknown-file': 'it named a file that is not changed here',
} as const;

/** What the AI said about this file and whether it counted, as text. */
export function AiState(props: { file: RiskFile }) {
  const { ai } = props.file;
  let text: string | null = null;
  if (ai.state === 'pending') text = RISK_LABELS.aiInProgress;
  else if (ai.state === 'unavailable') text = RISK_LABELS.aiMissing;
  else if (ai.state === 'not-assessed') text = notAssessedText(ai.notAssessedReason);
  else if (ai.state === 'no-opinion') text = RISK_LABELS.aiNoOpinion;
  else if (ai.state === 'not-higher' || ai.state === 'no-resolvable-line' || ai.state === 'unknown-file') {
    const said = ai.proposedClass === undefined ? '' : ` It proposed ${RISK_LABELS.class[ai.proposedClass]}`;
    text = `${RISK_LABELS.aiIgnored}: ${IGNORED_WHY[ai.state]}.${said}${ai.reasons === undefined || ai.reasons.length === 0 ? '' : `: ${ai.reasons.join(' ')}`}`;
  }
  if (text === null) return null;
  return (
    <p class="muted" data-testid="risk-ai-state" data-state={ai.state}>
      {text}
    </p>
  );
}
