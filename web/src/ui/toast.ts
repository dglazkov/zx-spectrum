// A line of news at the foot of the page: what was loaded goes after a few seconds; what went wrong stays until it is
// dismissed, in plain words, with what to do about it where there is something (Try again).

import { h } from './dom';
import { icon } from './icons';

let host: HTMLElement | null = null;

export interface Toast {
  /** Takes it away now (the news it gave is out of date: the tape it was fetching is in). */
  dismiss(): void;
}

export interface ToastOptions {
  /** Seconds it stays; an error stays until dismissed unless this says otherwise. */
  seconds?: number;
  /** A button on it: its label and what it does (the toast goes when it is pressed). */
  action?: { label: string; run: () => void };
}

export function toast(message: string, kind: 'info' | 'error' = 'info', options: ToastOptions | number = {}): Toast {
  const o = typeof options === 'number' ? { seconds: options } : options;
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : undefined }, h('span', { class: 'toast-text' }, message));
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 400);
  };
  if (o.action) {
    const b = h('button', { type: 'button', class: 'btn toast-action' }, o.action.label);
    const run = o.action.run;
    b.addEventListener('click', () => {
      dismiss();
      run();
    });
    el.append(b);
  }
  const persistent = kind === 'error' && o.seconds === undefined;
  if (persistent || o.action) {
    const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss' }, icon('close'));
    close.addEventListener('click', dismiss);
    el.append(close);
  }
  host.append(el);
  while (host.children.length > 3) host.firstElementChild?.remove();
  if (!persistent) setTimeout(dismiss, (o.seconds ?? 4.5) * 1000);
  return { dismiss };
}
