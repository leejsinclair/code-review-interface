// Icon-only controls. The icon is decorative (aria-hidden); the accessible name and the tooltip are the
// same text label the control showed before, so screen readers and tests still find the verbatim name.

import type { ComponentChildren } from 'preact';
import type { LucideIcon } from 'lucide-preact';
import type { Ref } from 'preact';

type Common = { icon: LucideIcon; label: string; 'data-testid'?: string; class?: string; children?: ComponentChildren };

export function IconButton(props: Common & { onClick?: () => void; disabled?: boolean; expanded?: boolean; controls?: string; buttonRef?: Ref<HTMLButtonElement> }) {
  const { icon: Icon, label } = props;
  return (
    <button
      type="button"
      class={`button icon-button${props.class ? ` ${props.class}` : ''}`}
      aria-label={label}
      title={label}
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      data-testid={props['data-testid']}
      ref={props.buttonRef}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon size={16} aria-hidden="true" focusable="false" />
      {props.children}
    </button>
  );
}

export function IconLink(props: Common & { href: string }) {
  const { icon: Icon, label } = props;
  return (
    <a class={`icon-button${props.class ? ` ${props.class}` : ''}`} href={props.href} aria-label={label} title={label} data-testid={props['data-testid']}>
      <Icon size={16} aria-hidden="true" focusable="false" />
      {props.children}
    </a>
  );
}
