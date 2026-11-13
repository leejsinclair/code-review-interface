// Code table used by the code page (FR-010, FR-011): every line from start to end
// is marked `aria-current="true"`, the first one is scrolled into view, and a range past the end of the file
// says so. Leading whitespace keeps its width and long lines scroll inside `div.code-scroll`.

import { useEffect, useRef } from 'preact/hooks';
import type { LineRange } from '../state/routes.ts';

export function CodeView(props: { lines: readonly string[]; range?: LineRange | undefined; riskMarks?: ReadonlyMap<number, string> | undefined }) {
  const { lines, range, riskMarks } = props;
  const first = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    first.current?.scrollIntoView({ block: 'center' });
  }, [lines, range?.start, range?.end]);
  const past = range !== undefined && range.end > lines.length;
  return (
    <>
      {past && (
        <p data-testid="code-range-notice" class="muted">
          {`Lines ${range.start}–${range.end} are past the end of this file (it has ${lines.length} lines).`}
        </p>
      )}
      <div class="code-scroll" tabIndex={0} role="region" aria-label="File content">
        <table class="code mono">
          <tbody>
            {lines.map((text, i) => {
              const n = i + 1;
              const cited = range !== undefined && n >= range.start && n <= range.end;
              return (
                <tr key={n} data-testid={`code-line-${n}`} class={cited ? 'cited' : undefined} aria-current={cited ? 'true' : undefined} {...(range !== undefined && n === range.start ? { ref: first } : {})}>
                  <td class="line-no">{n}</td>
                  {riskMarks !== undefined && (
                    <td class="risk-mark" data-testid={`risk-mark-${n}`}>
                      {riskMarks.has(n) && (
                        <span role="img" aria-label={`Risk mark: ${riskMarks.get(n)}`} title={riskMarks.get(n)}>
                          ⚑
                        </span>
                      )}
                    </td>
                  )}
                  <td class="code-text">{text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
