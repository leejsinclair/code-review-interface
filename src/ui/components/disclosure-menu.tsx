// Disclosure menu (R16, FR-032): a button with aria-expanded and aria-controls that reveals a short
// list of links and buttons. It is deliberately not the ARIA `menu` widget. Escape closes it and puts
// focus back on the button; so does choosing an item or clicking outside. Labels are text nodes (R7).

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export interface DisclosureMenuProps {
  /** Used for the button's `${id}-button` test id and the list's `${id}-list` id. */
  id: string;
  label: string;
  /** Links and buttons. */
  children: ComponentChildren;
  /** Optional class for the wrapper. */
  class?: string;
}

export function DisclosureMenu(props: DisclosureMenuProps) {
  const { id, label } = props;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: Event) => {
      if (root.current !== null && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div
      class={`disclosure-menu${props.class === undefined ? '' : ` ${props.class}`}`}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        ref={button}
        id={`${id}-button`}
        data-testid={`${id}-button`}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      <div
        id={listId}
        data-testid={listId}
        class="disclosure-list"
        hidden={!open}
        onClick={(e) => {
          // Choosing a link or button closes the list; focus returns to the toggle.
          if (e.target instanceof Element && e.target.closest('a, button') !== null) close();
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
