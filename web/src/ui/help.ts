// Every key the page knows, on one sheet (F1, or the ? in the bar): the machine's keys on the PC's, the page's own
// shortcuts (nerd's feedback card's among them), and how to move between the machine and the page's controls with the
// keyboard alone.

import { m, type Words } from '../i18n/i18n';
import { h } from './dom';
import { icon } from './icons';

export interface Help {
  readonly el: HTMLDialogElement;
  open(): void;
}

/** Each row: its keys (keycaps held together are one, keycaps that are either are a list), and what they do. */
const ROWS: readonly (readonly [readonly Words[], Words])[] = [
  [['Shift+Tab'], m('From the machine to the page’s controls (Tab is the Spectrum’s extended mode). Escape gives the keys back.')],
  [['F1'], m('This sheet')],
  [['F2', 'F4'], m('Save the quick slot · load it')],
  [['F3'], m('The game’s controls over the screen, as you press them now (again to hide them)')],
  [['F7'], m('Send feedback on the page')],
  [['F8'], m('Read the screen aloud (a screen reader says it)')],
  [['F9'], m('Pause, or carry on')],
  [[m('Arrows'), m('Left Alt')], m('The joystick, once a program is loaded (at BASIC the arrows move the cursor); for a game that takes no joystick, its own keys')],
  [['Backspace'], 'DELETE'],
  [[m('Alt with a key')], m('SYMBOL SHIFT with it (Ctrl too, but Ctrl+W, T and N are the browser’s: Ctrl+W closes the tab)')],
  [[m('< > = typed in pairs')], m('<>, <= and >=, each the Spectrum’s own key')],
  [['Escape'], m('BREAK (CAPS SHIFT and SPACE), when the keys are the machine’s')],
];

export function createHelp(): Help {
  const close = h('button', { type: 'button', class: 'btn btn-icon dialog-close', 'aria-label': m('Close') }, icon('close'));
  const el = h(
    'dialog',
    { class: 'help', 'aria-label': m('Keys') },
    h('header', { class: 'dialog-head' }, h('h2', {}, m('Keys')), close),
    h('div', { class: 'dialog-body' }, h('dl', { class: 'help-keys' }, ...ROWS.flatMap(([keys, does]) => [h('dt', {}, ...keys.flatMap((part, i) => [i ? ' · ' : '', h('kbd', { class: 'keycap wide' }, part)])), h('dd', {}, does)]))),
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
