// Per-file exclusion and the prompt budget (FR-049, EC-05, VO-058).

export type Limits = {
  /** A file larger than this at head is left out with reason `file size`. */
  maxFileBytes: number;
  /** A file whose additions plus deletions exceed this is left out with reason `changed lines`. */
  maxChangedLines: number;
  /** The prompt budget, in characters, filled in diff order. */
  maxPromptChars: number;
};

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxFileBytes: 1_048_576,
  maxChangedLines: 5_000,
  maxPromptChars: 400_000,
});

export type FileExclusionReason = 'binary' | 'file size' | 'changed lines';

export type ExclusionReason = FileExclusionReason | 'prompt limit';

/** The fields of a changed file the per-file check reads. */
export type LimitedFile = {
  binary: boolean;
  /** Size at head in bytes; null when unknown (a deleted file or a platform diff). */
  sizeBytes: number | null;
  additions: number;
  deletions: number;
};

/**
 * Why a file is left out of prompts, checked in order: binary, then file size, then changed lines.
 * A file exactly at a limit is kept, and an unknown size is never a size exclusion.
 */
export function excludedReason(file: LimitedFile, limits: Limits): FileExclusionReason | null {
  if (file.binary) return 'binary';
  if (file.sizeBytes !== null && file.sizeBytes > limits.maxFileBytes) return 'file size';
  if (file.additions + file.deletions > limits.maxChangedLines) return 'changed lines';
  return null;
}

export type BudgetResult<T> = {
  included: T[];
  excluded: { path: string; reason: 'prompt limit' }[];
};

/**
 * Fills the prompt budget in diff order. It stops at the first file that does not fit and leaves it and
 * every file after it out with reason `prompt limit`, so a later small file never jumps the queue.
 * A file that lands exactly on the limit is included.
 */
export function fillBudget<T extends { path: string; chars: number }>(
  files: readonly T[],
  maxPromptChars: number,
): BudgetResult<T> {
  const included: T[] = [];
  const excluded: { path: string; reason: 'prompt limit' }[] = [];
  let used = 0;
  let full = false;
  for (const file of files) {
    if (!full && used + file.chars <= maxPromptChars) {
      included.push(file);
      used += file.chars;
    } else {
      full = true;
      excluded.push({ path: file.path, reason: 'prompt limit' });
    }
  }
  return { included, excluded };
}
