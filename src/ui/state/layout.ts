import { useEffect, useState } from 'preact/hooks';
// Width bands (R6). app.css uses the same three queries.
export type Band = 'wide' | 'medium' | 'narrow';

export const BAND_QUERIES: Readonly<Record<Band, string>> = {
  wide: '(width >= 1200px)',
  medium: '(900px <= width < 1200px)',
  narrow: '(width < 900px)',
};

export function bandFor(width: number): Band {
  if (width >= 1200) return 'wide';
  if (width >= 900) return 'medium';
  return 'narrow';
}

/** The current width band, kept up to date as the window resizes. */
export function useBand(): Band {
  const [band, setBand] = useState<Band>(() => bandFor(window.innerWidth));
  useEffect(() => {
    const on = (): void => setBand(bandFor(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return band;
}
