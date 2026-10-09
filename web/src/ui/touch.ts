// Touch controls for phones: a pad (eight ways, by where the thumb is from its centre) and a fire button, which are
// the joystick, and SPACE and ENTER, which games ask for between lives.

import { JOY } from '../emulator/emulator';
import { ENTER, SPACE } from '../emulator/keys';
import { capture, h } from './dom';

export interface TouchPad {
  readonly el: HTMLElement;
}

export function createTouchPad(onBits: (bits: number) => void, onKey: (code: number, down: boolean) => void): TouchPad {
  let pad = 0;
  let fire = 0;
  const send = () => onBits(pad | fire);

  const thumb = h('div', { class: 'pad-thumb' });
  const ring = h('div', { class: 'pad', role: 'group', 'aria-label': 'Joystick' }, h('span', { class: 'pad-arrow up' }), h('span', { class: 'pad-arrow down' }), h('span', { class: 'pad-arrow left' }), h('span', { class: 'pad-arrow right' }), thumb);
  const aim = (e: PointerEvent) => {
    const r = ring.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const max = r.width / 2;
    thumb.style.transform = `translate(${(dx / Math.max(len, 1)) * Math.min(len, max * 0.55)}px, ${(dy / Math.max(len, 1)) * Math.min(len, max * 0.55)}px)`;
    pad = 0;
    if (len > max * 0.22) {
      // Eight ways: each direction owns 135° around its axis, so the diagonals are both.
      const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
      if (a > -67.5 && a < 67.5) pad |= JOY.right;
      if (a > 112.5 || a < -112.5) pad |= JOY.left;
      if (a > 22.5 && a < 157.5) pad |= JOY.up;
      if (a < -22.5 && a > -157.5) pad |= JOY.down;
    }
    send();
  };
  ring.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(ring, e.pointerId);
    ring.classList.add('active');
    aim(e);
  });
  ring.addEventListener('pointermove', (e) => {
    if (ring.hasPointerCapture(e.pointerId)) aim(e);
  });
  const release = () => {
    pad = 0;
    thumb.style.transform = '';
    ring.classList.remove('active');
    send();
  };
  ring.addEventListener('pointerup', release);
  ring.addEventListener('pointercancel', release);

  const hold = (el: HTMLElement, down: () => void, up: () => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      el.classList.add('active');
      down();
    });
    const end = () => {
      el.classList.remove('active');
      up();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  const fireButton = h('button', { type: 'button', class: 'pad-fire', 'aria-label': 'Fire' }, 'FIRE');
  hold(fireButton, () => ((fire = JOY.fire), send()), () => ((fire = 0), send()));
  const key = (label: string, code: number) => {
    const b = h('button', { type: 'button', class: 'pad-key' }, label);
    hold(b, () => onKey(code, true), () => onKey(code, false));
    return b;
  };

  const el = h('div', { class: 'touchpad' }, ring, h('div', { class: 'pad-side' }, h('div', { class: 'pad-keys' }, key('SPACE', SPACE), key('ENTER', ENTER)), fireButton));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return { el };
}
