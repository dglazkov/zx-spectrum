// Every key the page knows, on one sheet (F1, or the ? in the bar): the machine's keys on the PC's, the page's own
// shortcuts, and how to move between the machine and the page's controls with the keyboard alone.

import { h } from './dom';
import { icon } from './icons';

export interface Help {
  readonly el: HTMLDialogElement;
  open(): void;
}

const ROWS: readonly (readonly [string, string])[] = [
  ['Shift+Tab', 'From the machine to the page’s controls (Tab is the Spectrum’s extended mode). Escape gives the keys back.'],
  ['F1', 'This sheet'],
  ['F2 · F4', 'Save the quick slot · load it'],
  ['F3', 'The game’s controls over the screen, as you press them now (again to hide them)'],
  ['F8', 'Read the screen aloud (a screen reader says it)'],
  ['F9', 'Pause, or carry on'],
  ['Arrows · Left Alt', 'The joystick, once a program is loaded (at BASIC the arrows move the cursor); for a game that takes no joystick, its own keys'],
  ['Backspace', 'DELETE'],
  ['Alt with a key', 'SYMBOL SHIFT with it (Ctrl too, but Ctrl+W, T and N are the browser’s: Ctrl+W closes the tab)'],
  ['< > = typed in pairs', '<>, <= and >=, each the Spectrum’s own key'],
  ['Escape', 'BREAK (CAPS SHIFT and SPACE), when the keys are the machine’s'],
];

export function createHelp(): Help {
  const close = h('button', { type: 'button', class: 'btn btn-icon dialog-close', 'aria-label': 'Close' }, icon('close'));
  const el = h(
    'dialog',
    { class: 'help', 'aria-label': 'Keys' },
    h('header', { class: 'dialog-head' }, h('h2', {}, 'Keys'), close),
    h('div', { class: 'dialog-body' }, h('dl', { class: 'help-keys' }, ...ROWS.flatMap(([k, v]) => [h('dt', {}, ...k.split(' · ').flatMap((part, i) => [i ? ' · ' : '', h('kbd', { class: 'keycap wide' }, part)])), h('dd', {}, v)]))),
  );
  close.addEventListener('click', () => el.close());
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });
  return {
    el,
    open() {
      if (!el.open) el.showModal();
    },
  };
}
