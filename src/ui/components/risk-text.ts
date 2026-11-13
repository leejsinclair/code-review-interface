// Small text helpers shared by the risk components.

import { RISK_LABELS } from '../labels.ts';

/** "Not assessed by AI: lockfile" and its kin; the reason is a fixed word from the workbench, never PR text. */
export function notAssessedText(reason: string | undefined): string {
  if (reason === 'lockfile') return RISK_LABELS.notAssessedLockfile;
  if (reason === 'generated file') return RISK_LABELS.notAssessedGenerated;
  return `Not assessed by AI: ${reason ?? 'not assessable'}`;
}
