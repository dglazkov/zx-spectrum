// The PC's keyboard, listened to: each key mapped (keymap.ts) and handed to the feeder at the frame the machine is
// at, or to the joystick. Keys typed into the page's own fields (the library's search) are theirs, not the machine's.

import type { KeyFeeder } from './feeder';
import { mapKey, operatorChords, type JoystickKeys, type Mapping } from './keymap';

export interface PcKeyboardHooks {
  readonly feeder: KeyFeeder;
  /** The frame about to run. */
  frame(): number;
  mapping(): Mapping;
  joystick(): JoystickKeys;
  /** The joystick bits the keys hold. */
  joystickBits(bits: number): void;
  /** Called on the first key, which is a gesture that allows sound. */
  gesture(): void;
  /** Called on every key the machine takes (the page then guards against being closed by accident). */
  typed?(): void;
}

/** The keys that move between the page's controls and work them. */
const CONTROL_KEYS = new Set(['Tab', 'Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/**
 * Whether a key is the page's rather than the machine's: typed into a field or an open dialog; or, on a control the
 * keyboard has moved to, a key that works it (Tab, Enter, Space, the arrows), so that the page can be used without a
 * mouse. A click leaves no focus on a control (app.ts lets it go), so a game's Space never presses the button last
 * clicked. Shift+Tab is always the page's: from the machine, it is the way to its controls (Tab is extended mode).
 */
export function forThePage(e: Pick<KeyboardEvent, 'target' | 'key' | 'shiftKey'>): boolean {
  if (e.key === 'Tab' && e.shiftKey) return true;
  const target = e.target;
  if (!(target instanceof Element)) return false;
  if (target.closest('dialog[open]')) return true;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target as HTMLElement).isContentEditable) return true;
  return target !== document.body && CONTROL_KEYS.has(e.key) && !!target.closest('button, a[href], summary, [tabindex]:not([tabindex="-1"])');
}

export function listenToKeyboard(hooks: PcKeyboardHooks): () => void {
  let bits = 0;
  const joyKeys = new Map<string, number>();

  /** The character typed last, in the natural mapping (an operator's first half, if it is one), and nothing since. */
  let previous: string | null = null;
  let previousCode = '';
  const down = (e: KeyboardEvent) => {
    if (forThePage(e)) {
      // Escape on a control gives the keys back to the machine.
      const target = e.target as HTMLElement;
      if (e.key === 'Escape' && target !== document.body && !target.closest('dialog[open]') && typeof target.blur === 'function' && !(target instanceof HTMLInputElement)) target.blur();
      return;
    }
    hooks.gesture();
    const mapping = hooks.mapping();
    const m = mapKey({ key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }, mapping, hooks.joystick());
    if (!m) return;
    e.preventDefault();
    if (e.repeat) return; // the Spectrum repeats keys itself
    hooks.typed?.();
    const now = hooks.frame();
    const typing = mapping === 'natural';
    const ch = typing && 'hold' in m && !e.ctrlKey && !e.altKey && [...e.key].length === 1 ? e.key : null;
    // <> <= >= typed as two characters: the operator's own key.
    const operator = ch !== null ? operatorChords(previous, ch) : null;
    const before = previousCode;
    previous = ch;
    previousCode = e.code;
    if (operator) {
      previous = null;
      // The first character's key up first, if it is still held (Shift held across both, the keys rolled).
      const up = hooks.feeder.release(before, now);
      hooks.feeder.type(operator, up + 1);
      return;
    }
    if ('joystick' in m) {
      joyKeys.set(e.code, m.joystick);
      bits |= m.joystick;
      hooks.joystickBits(bits);
    } else if ('hold' in m) {
      hooks.feeder.hold(e.code, m.hold, now, typing ? 'rom' : 'free', typing);
    } else {
      hooks.feeder.type(m.type, now);
    }
  };
  const up = (e: KeyboardEvent) => {
    const bit = joyKeys.get(e.code);
    if (bit !== undefined) {
      joyKeys.delete(e.code);
      bits = [...joyKeys.values()].reduce((a, b) => a | b, 0);
      hooks.joystickBits(bits);
    }
    hooks.feeder.release(e.code, hooks.frame());
  };
  const lost = () => {
    hooks.feeder.clear();
    joyKeys.clear();
    bits = 0;
    hooks.joystickBits(0);
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', lost);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', lost);
  };
}
