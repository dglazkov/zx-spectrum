// The page's few kinds of control, so that every panel is made of the same parts: a button, a set of choices of
// which one is chosen (segmented), a switch, a list to choose from, and a labelled row to put one in.

import { h } from './dom';
import { icon } from './icons';

export interface ButtonOptions {
  icon?: string;
  label?: string;
  /** Said by a tooltip and to a screen reader, where the label is not shown. */
  title?: string;
  className?: string;
  onClick?: (e: MouseEvent) => void;
}

export function button(o: ButtonOptions): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `btn ${o.className ?? ''} ${o.label ? '' : 'btn-icon'}`.trim(), title: o.title, 'aria-label': o.label ? undefined : o.title });
  if (o.icon) b.append(icon(o.icon));
  if (o.label) b.append(h('span', { class: 'btn-label' }, o.label));
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

export interface Choice<T> {
  value: T;
  label?: string;
  icon?: string;
  title?: string;
}

export interface Segmented<T> {
  readonly el: HTMLElement;
  set(value: T): void;
}

/** Choices side by side, one of them chosen: a radio group. */
export function segmented<T extends string | number>(name: string, choices: readonly Choice<T>[], value: T, onChange: (value: T) => void, className = ''): Segmented<T> {
  const el = h('div', { class: `segmented ${className}`.trim(), role: 'radiogroup', 'aria-label': name });
  const buttons = choices.map((c) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'seg', title: c.title ?? c.label, 'aria-label': c.label ? undefined : c.title, 'data-value': String(c.value) });
    if (c.icon) b.append(icon(c.icon));
    if (c.label) b.append(h('span', {}, c.label));
    b.addEventListener('click', () => {
      set(c.value);
      onChange(c.value);
    });
    el.append(b);
    return b;
  });
  const set = (v: T) => {
    choices.forEach((c, i) => {
      buttons[i].setAttribute('aria-checked', String(c.value === v));
      buttons[i].classList.toggle('on', c.value === v);
    });
  };
  set(value);
  return { el, set };
}

export interface Switch {
  readonly el: HTMLElement;
  set(on: boolean): void;
}

export function toggle(label: string, on: boolean, onChange: (on: boolean) => void): Switch {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = on;
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', { class: 'switch-label' }, label));
  return { el, set: (v) => (input.checked = v) };
}

export function select<T extends string>(label: string, choices: readonly Choice<T>[], value: T, onChange: (value: T) => void): { el: HTMLSelectElement; set(v: T): void } {
  const el = h('select', { class: 'select', 'aria-label': label });
  for (const c of choices) el.append(h('option', { value: c.value }, c.label ?? String(c.value)));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value as T));
  return { el, set: (v) => (el.value = v) };
}

/** A labelled row of a settings panel. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('div', { class: 'field-text' }, h('div', { class: 'field-label' }, label), hint ? h('div', { class: 'field-hint' }, hint) : null), control);
}
