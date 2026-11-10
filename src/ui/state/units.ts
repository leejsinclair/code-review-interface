// Limit units for Setup (data-model 4.10): bytes shown as whole KB (1 KB = 1024 bytes), lines as is.

export function formatBytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Whole kilobytes of 1 or more, as bytes; `null` for anything else. */
export function parseKilobytes(text: string): number | null {
  const t = text.trim().replace(/\s*kb$/i, '');
  if (!/^\d+$/.test(t)) return null;
  const kb = Number(t);
  return Number.isSafeInteger(kb) && kb >= 1 ? kb * 1024 : null;
}

export function formatLines(lines: number): string {
  return new Intl.NumberFormat('en-US').format(lines);
}
