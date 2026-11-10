// Changed-file list (contracts/ui.md 4.10): rows keep `changed-file-<path>`, a text filter, an empty-result
// state and an optional per-row explanation, disclosed on request.

import type { ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { ChangedFile } from '../../contracts/http.ts';
import { buildRoute } from '../state/routes.ts';
import { Badge } from './badge.tsx';

export type FileListProps = {
  sessionId: string;
  files: readonly ChangedFile[];
  /** The path to mark as the current page, if any. */
  current?: string;
  /** Rendered inside a row once its `file-explanation-<path>` button is expanded. */
  explanation?: (file: ChangedFile) => ComponentChild;
};

export function FileList({ sessionId, files, current, explanation }: FileListProps) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const needle = filter.trim().toLowerCase();
  const shown = needle === '' ? files : files.filter((f) => f.path.toLowerCase().includes(needle) || (f.previousPath ?? '').toLowerCase().includes(needle));
  const toggle = (path: string): void => {
    const next = new Set(open);
    if (!next.delete(path)) next.add(path);
    setOpen(next);
  };

  return (
    <div class="file-list" data-testid="file-list">
      <label class="file-filter-label">
        File filter
        <input type="search" data-testid="file-filter" value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {shown.length === 0 && files.length > 0 ? (
        <p data-testid="file-filter-empty">
          No changed file matches “{filter}”.{' '}
          <button type="button" data-testid="file-filter-clear" onClick={() => setFilter('')}>
            Clear filter
          </button>
        </p>
      ) : (
        <ul class="list">
          {shown.map((f) => {
            const expanded = open.has(f.path);
            return (
              <li key={f.path} data-testid={`changed-file-${f.path}`}>
                <a class="mono" href={buildRoute({ name: 'diff', sessionId, path: f.path })} aria-current={current === f.path ? 'page' : undefined}>
                  {f.previousPath !== undefined ? `${f.previousPath} → ${f.path}` : f.path}
                </a>{' '}
                <span class="muted">{`${f.status} +${f.linesAdded} −${f.linesRemoved}`}</span>
                {f.skipped !== undefined && <Badge kind="skipped" reason={f.skipped} />}
                {explanation !== undefined && (
                  <>
                    {' '}
                    <button type="button" data-testid={`file-explanation-${f.path}`} aria-expanded={expanded} onClick={() => toggle(f.path)}>
                      {expanded ? 'Hide explanation' : 'Show explanation'}
                    </button>
                    {expanded && <div class="file-explanation">{explanation(f)}</div>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
