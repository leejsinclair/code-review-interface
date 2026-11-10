// Contextual panel (FR-020, contracts 4.7): an `aside` named by its `h2`. Focus moves to the `h2` when it opens;
// the close button and Escape both close it and return focus to the control that opened it.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export type PanelProps = {
  testId: string;
  title: string;
  /** Element id of the control that opened the panel; focus returns to it on close. */
  openerId?: string | undefined;
  onClose(): void;
  children?: ComponentChildren;
};

/** Move focus back to the opener, when it is still on the page. */
export function focusOpener(openerId: string | undefined): void {
  if (openerId === undefined || openerId === '') return;
  document.getElementById(openerId)?.focus({ preventScroll: true });
}

export function Panel(props: PanelProps) {
  const { testId, title, openerId, onClose } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = `${testId}-heading`;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const close = (): void => {
    onClose();
    // After the close has rendered, so the opener is back in the layout and focusable.
    setTimeout(() => focusOpener(openerId), 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <aside class="panel-aside" data-testid={testId} aria-labelledby={headingId}>
      <div class="panel-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" data-testid="panel-close" class="button" onClick={close}>
          Close
        </button>
      </div>
      <div class="panel-body stack">{props.children}</div>
    </aside>
  );
}
