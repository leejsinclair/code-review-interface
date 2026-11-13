// The review scope control of the file list: one slider from Critical down to Low, the files and changed lines it
// takes in, and how much of that the reviewer has viewed. Counts only; nothing here scores, ranks or approves.

import type { RiskClass } from '../../contracts/http.ts';
import { RISK_CLASSES } from '../../core/risk/classes.ts';
import { RISK_LABELS, SCOPE_LABELS } from '../labels.ts';
import { REVIEW_LINE_BUDGET, type ResolvedScope, type ScopeChoice, type Tally } from '../state/review-scope.ts';

export type ScopeProgress = { files: Tally; viewed: Tally };

const plural = (n: number, word: string): string => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
export const tallyText = (t: Tally): string => `${plural(t.files, 'file')} · ${plural(t.lines, 'line')}`;

export function ScopeSlider(props: {
  scope: ResolvedScope;
  /** What the scope takes in: the cumulative files and lines at its threshold. */
  taken: Tally;
  progress: ScopeProgress;
  onChange: (choice: ScopeChoice) => void;
}) {
  const { scope, taken, progress, onChange } = props;
  const summary = `${SCOPE_LABELS.name[scope.threshold]} · ${tallyText(taken)}`;
  return (
    <section class="scope" data-testid="scope" aria-label={SCOPE_LABELS.heading}>
      <div class="scope-head">
        <h2 class="scope-title">{SCOPE_LABELS.heading}</h2>
        <button type="button" class="link-button" data-testid="scope-auto" aria-pressed={scope.auto} title={SCOPE_LABELS.autoTitle} onClick={() => onChange('auto')}>
          {scope.auto ? `${SCOPE_LABELS.auto} (${REVIEW_LINE_BUDGET} lines)` : `${SCOPE_LABELS.auto} ↺`}
        </button>
      </div>
      <input
        type="range"
        class="scope-slider"
        data-testid="scope-slider"
        aria-label={SCOPE_LABELS.slider}
        aria-valuetext={summary}
        min={0}
        max={RISK_CLASSES.length - 1}
        step={1}
        value={RISK_CLASSES.indexOf(scope.threshold)}
        onInput={(e) => onChange(RISK_CLASSES[Number((e.currentTarget as HTMLInputElement).value)] as RiskClass)}
      />
      <div class="scope-ticks" aria-hidden="true">
        {RISK_CLASSES.map((c) => (
          <span key={c} data-active={RISK_CLASSES.indexOf(c) <= RISK_CLASSES.indexOf(scope.threshold) ? 'true' : undefined}>
            {RISK_LABELS.class[c]}
          </span>
        ))}
      </div>
      <p class="scope-summary" data-testid="scope-summary">
        {summary}
      </p>
      {scope.overBudget && (
        <p class="scope-over" data-testid="scope-over-budget">
          {`Over the ${REVIEW_LINE_BUDGET}-line review budget${scope.auto ? ' even with Critical only. Consider asking for a split.' : '.'}`}
        </p>
      )}
      {progress.files.files > 0 && (
        <p class="scope-progress muted" data-testid="scope-progress">
          <span>{`Viewed ${progress.viewed.files.toLocaleString('en')} of ${plural(progress.files.files, 'file')} · ${progress.viewed.lines.toLocaleString('en')} of ${plural(progress.files.lines, 'line')}`}</span>
          <progress aria-label={SCOPE_LABELS.progress} max={Math.max(progress.files.lines, 1)} value={progress.viewed.lines} />
        </p>
      )}
    </section>
  );
}
