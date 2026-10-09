// The PC's keyboard onto the Spectrum's, two ways:
//
// - natural, for typing: what a PC key types becomes the Spectrum keys that type the same thing. A typed '"' is
//   SYMBOL SHIFT + P, 'A' is CAPS SHIFT + A, Backspace is DELETE (CAPS SHIFT + 0), the arrows are CAPS SHIFT + 5–8,
//   and a character only extended mode gives ('[', '~', '©') is extended mode (CAPS SHIFT + SYMBOL SHIFT) and then
//   SYMBOL SHIFT with its key. So BASIC can be typed as on a PC (with the Spectrum's keywords, a key each in K mode).
// - positional, for games: a PC key is the Spectrum key in its place: letters, digits, ENTER, SPACE; Shift is CAPS
//   SHIFT and Ctrl or Alt SYMBOL SHIFT, held as long as the PC key is.
//
// Either way the arrow keys and a fire key can be a joystick instead.

import { CAPS_SHIFT, ENTER, KEY, SPACE, SYMBOL_SHIFT } from '../emulator/keys';
import { JOY } from '../emulator/emulator';

/** Spectrum keys held together. */
export type Chord = readonly number[];

export type Mapping = 'natural' | 'positional';

/** What a keyboard event says, as far as the mapping cares. */
export interface PcKey {
  /** KeyboardEvent.key: what the key types, with the layout and Shift applied. */
  readonly key: string;
  /** KeyboardEvent.code: where the key is. */
  readonly code: string;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
}

export interface JoystickKeys {
  /** The arrow keys and the fire key are a joystick. */
  readonly on: boolean;
  /** The fire key's KeyboardEvent.code. */
  readonly fire: string;
}

/**
 * What a PC key does: a chord held while the PC key is (`hold`), Spectrum keys typed one after another (`type`), or a
 * joystick bit held (`joystick`).
 */
export type Mapped = { readonly hold: Chord } | { readonly type: readonly Chord[] } | { readonly joystick: number };

const k = (name: string): number => {
  const code = KEY[name];
  if (code === undefined) throw new Error(`no Spectrum key ${name}`);
  return code;
};

/** What SYMBOL SHIFT with each key types (the red legend on the key). */
export const SYMBOLS: Readonly<Record<string, string>> = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9', _: '0',
  '<': 'R', '>': 'T', ';': 'O', '"': 'P', '^': 'H', '-': 'J', '+': 'K', '=': 'L',
  ':': 'Z', '£': 'X', '?': 'C', '/': 'V', '*': 'B', ',': 'N', '.': 'M',
};

/** What extended mode and SYMBOL SHIFT with each key types (the red legend below it). */
export const EXTENDED_SYMBOLS: Readonly<Record<string, string>> = {
  '~': 'A', '|': 'S', '\\': 'D', '{': 'F', '}': 'G', '[': 'Y', ']': 'U', '©': 'P',
};

/** CAPS SHIFT with a digit: the editing keys. */
const CAPS_DIGIT = (d: string): Chord => [CAPS_SHIFT, k(d)];

/** Keys that are not characters, by KeyboardEvent.key, in either mapping. */
const NAMED: Readonly<Record<string, Chord>> = {
  Enter: [ENTER],
  Backspace: CAPS_DIGIT('0'), // DELETE
  Delete: CAPS_DIGIT('0'),
  ArrowLeft: CAPS_DIGIT('5'),
  ArrowDown: CAPS_DIGIT('6'),
  ArrowUp: CAPS_DIGIT('7'),
  ArrowRight: CAPS_DIGIT('8'),
  Escape: [CAPS_SHIFT, SPACE], // BREAK
  CapsLock: CAPS_DIGIT('2'), // CAPS LOCK
  Tab: [CAPS_SHIFT, SYMBOL_SHIFT], // extended mode
  Home: CAPS_DIGIT('1'), // EDIT
  End: CAPS_DIGIT('9'), // GRAPHICS
};

/** The Spectrum keys that type `ch`, a chord at a time: one chord for most, two for an extended-mode symbol. */
export function charChords(ch: string): Chord[] | null {
  if (/^[a-z]$/.test(ch)) return [[k(ch.toUpperCase())]];
  if (/^[A-Z]$/.test(ch)) return [[CAPS_SHIFT, k(ch)]];
  if (/^[0-9]$/.test(ch)) return [[k(ch)]];
  if (ch === ' ') return [[SPACE]];
  if (ch === '\n' || ch === '\r') return [[ENTER]];
  const sym = SYMBOLS[ch];
  if (sym) return [[SYMBOL_SHIFT, k(sym)]];
  const ext = EXTENDED_SYMBOLS[ch];
  if (ext) return [[CAPS_SHIFT, SYMBOL_SHIFT], [SYMBOL_SHIFT, k(ext)]];
  return null;
}

/** The Spectrum key in the place of a PC key (KeyboardEvent.code), for the positional mapping. */
function positional(code: string): Chord | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return [k(m[1])];
  m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (m) return [k(m[1])];
  switch (code) {
    case 'Enter':
    case 'NumpadEnter':
      return [ENTER];
    case 'Space':
      return [SPACE];
    case 'ShiftLeft':
    case 'ShiftRight':
      return [CAPS_SHIFT];
    case 'ControlLeft':
    case 'ControlRight':
    case 'AltLeft':
    case 'AltRight':
      return [SYMBOL_SHIFT];
    // The punctuation in its PC place types its own symbol, which games seldom use and BASIC sometimes does.
    case 'Period':
      return [SYMBOL_SHIFT, k('M')];
    case 'Comma':
      return [SYMBOL_SHIFT, k('N')];
    case 'Semicolon':
      return [SYMBOL_SHIFT, k('O')];
    case 'Quote':
      return [SYMBOL_SHIFT, k('P')];
    case 'Minus':
    case 'NumpadSubtract':
      return [SYMBOL_SHIFT, k('J')];
    case 'Equal':
      return [SYMBOL_SHIFT, k('L')];
    case 'NumpadAdd':
      return [SYMBOL_SHIFT, k('K')];
    case 'Slash':
    case 'NumpadDivide':
      return [SYMBOL_SHIFT, k('V')];
    case 'NumpadMultiply':
      return [SYMBOL_SHIFT, k('B')];
    default:
      return null;
  }
}

const ARROW_BITS: Readonly<Record<string, number>> = {
  ArrowRight: JOY.right,
  ArrowLeft: JOY.left,
  ArrowDown: JOY.down,
  ArrowUp: JOY.up,
};

/** What `e` does under `mapping`, or null for a key the Spectrum has no use for (it is left to the browser). */
export function mapKey(e: PcKey, mapping: Mapping, joystick: JoystickKeys = { on: false, fire: '' }): Mapped | null {
  if (e.meta) return null; // the system's and the browser's shortcuts
  if (joystick.on) {
    const bit = ARROW_BITS[e.code];
    if (bit) return { joystick: bit };
    if (e.code === joystick.fire) return { joystick: JOY.fire };
  }
  if (mapping === 'positional') {
    const chord = positional(e.code) ?? NAMED[e.key] ?? null;
    return chord ? { hold: chord } : null;
  }
  // Natural. Ctrl or Alt with a letter or digit is SYMBOL SHIFT with it (STOP, AND, THEN...), by where the key is:
  // with Alt held, a Mac's key types something else entirely.
  if (e.ctrl || e.alt) {
    const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
    return m ? { hold: [SYMBOL_SHIFT, k(m[1] ?? m[2])] } : null;
  }
  const named = NAMED[e.key];
  if (named) return { hold: named };
  if ([...e.key].length !== 1) return null; // Shift, Dead, Unidentified, F1...
  const chords = charChords(e.key);
  if (!chords) return null;
  return chords.length === 1 ? { hold: chords[0] } : { type: chords };
}

/**
 * Whether the arrow keys and the fire key are the joystick now. Only with a joystick, and only when the person wants
 * them to be; and not while the keyboard is for typing by itself (automatic, before a program is loaded), when the
 * arrows are the editor's cursor keys: at BASIC nothing reads a joystick, and a line is edited with them.
 */
export function arrowsAreJoystick(o: { joystick: string; arrowsJoystick: boolean; mapping: 'auto' | Mapping; programLoaded: boolean }): boolean {
  if (o.joystick === 'none' || !o.arrowsJoystick) return false;
  return !(o.mapping === 'auto' && !o.programLoaded);
}

/** The fire keys a person can choose, by KeyboardEvent.code, with what to call them. */
export const FIRE_KEYS: readonly { code: string; name: string }[] = [
  { code: 'AltLeft', name: 'Left Alt' },
  { code: 'ControlLeft', name: 'Left Ctrl' },
  { code: 'Space', name: 'Space' },
  { code: 'Tab', name: 'Tab' },
  { code: 'KeyZ', name: 'Z' },
  { code: 'KeyM', name: 'M' },
  { code: 'Enter', name: 'Enter' },
  { code: 'ShiftRight', name: 'Right Shift' },
];
