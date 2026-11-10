// Polite live-region announcements, throttled (R17). `write` puts text in the one
// aria-live region. `now` announces at once; `stream` announces only the text
// added since the last announcement, at most once per interval; `done` flushes
// nothing and says "Answer complete".

export interface AnnouncerOptions {
  intervalMs: number;
}

export interface Announcer {
  now(text: string): void;
  stream(text: string): void;
  done(): void;
}

export const ANSWER_COMPLETE = 'Answer complete';

export function createAnnouncer(write: (text: string) => void, options: AnnouncerOptions): Announcer {
  let announced = 0;
  let latest = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAt = Number.NEGATIVE_INFINITY;

  const flush = (): void => {
    timer = undefined;
    const added = latest.slice(announced);
    if (added.trim() === '') return;
    announced = latest.length;
    lastAt = Date.now();
    write(added);
  };

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    now(text) {
      write(text);
    },
    stream(text) {
      latest = text;
      if (timer !== undefined) return;
      const wait = Math.max(0, lastAt + options.intervalMs - Date.now());
      if (wait === 0) flush();
      else timer = setTimeout(flush, wait);
    },
    done() {
      cancel();
      latest = '';
      announced = 0;
      lastAt = Number.NEGATIVE_INFINITY;
      write(ANSWER_COMPLETE);
    },
  };
}
