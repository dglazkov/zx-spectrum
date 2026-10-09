// A line of news at the foot of the page, gone after a few seconds: what was loaded, what could not be.

import { h } from './dom';

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info', seconds = 4.5): void {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${kind}` }, message);
  host.append(el);
  while (host.children.length > 3) host.firstElementChild?.remove();
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 400);
  }, seconds * 1000);
}
