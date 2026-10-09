import { describe, expect, it } from 'vitest';
import { JOY } from '../emulator/emulator';
import { CAPS_SHIFT, ENTER, KEY, SPACE, SYMBOL_SHIFT } from '../emulator/keys';
import { arrowsAreJoystick, charChords, mapKey, operatorChords, type PcKey } from './keymap';

const press = (key: string, code = '', more: Partial<PcKey> = {}): PcKey => ({ key, code, ...more });

describe('the natural mapping, for typing', () => {
  it('types letters, and capitals with CAPS SHIFT', () => {
    expect(mapKey(press('j', 'KeyJ'), 'natural')).toEqual({ hold: [KEY.J] });
    expect(mapKey(press('J', 'KeyJ', { shift: true }), 'natural')).toEqual({ hold: [CAPS_SHIFT, KEY.J] });
  });

  it('types a quote as SYMBOL SHIFT and P, whatever the PC needed to type it', () => {
    expect(mapKey(press('"', 'Quote', { shift: true }), 'natural')).toEqual({ hold: [SYMBOL_SHIFT, KEY.P] });
    expect(mapKey(press('"', 'Digit2', { shift: true }), 'natural')).toEqual({ hold: [SYMBOL_SHIFT, KEY.P] }); // a UK layout
  });

  it('makes Backspace DELETE, the arrows CAPS SHIFT and 5 to 8, Escape BREAK', () => {
    expect(mapKey(press('Backspace', 'Backspace'), 'natural')).toEqual({ hold: [CAPS_SHIFT, KEY['0']] });
    expect(mapKey(press('ArrowLeft', 'ArrowLeft'), 'natural')).toEqual({ hold: [CAPS_SHIFT, KEY['5']] });
    expect(mapKey(press('ArrowDown', 'ArrowDown'), 'natural')).toEqual({ hold: [CAPS_SHIFT, KEY['6']] });
    expect(mapKey(press('ArrowUp', 'ArrowUp'), 'natural')).toEqual({ hold: [CAPS_SHIFT, KEY['7']] });
    expect(mapKey(press('ArrowRight', 'ArrowRight'), 'natural')).toEqual({ hold: [CAPS_SHIFT, KEY['8']] });
    expect(mapKey(press('Escape', 'Escape'), 'natural')).toEqual({ hold: [CAPS_SHIFT, SPACE] });
    expect(mapKey(press('Enter', 'Enter'), 'natural')).toEqual({ hold: [ENTER] });
  });

  it('types what only extended mode gives as extended mode, then SYMBOL SHIFT with its key', () => {
    expect(mapKey(press('[', 'BracketLeft'), 'natural')).toEqual({ type: [[CAPS_SHIFT, SYMBOL_SHIFT], [SYMBOL_SHIFT, KEY.Y]] });
    expect(charChords('©')).toEqual([[CAPS_SHIFT, SYMBOL_SHIFT], [SYMBOL_SHIFT, KEY.P]]);
  });

  it('makes Ctrl or Alt with a key SYMBOL SHIFT with it, by where the key is', () => {
    expect(mapKey(press('a', 'KeyA', { ctrl: true }), 'natural')).toEqual({ hold: [SYMBOL_SHIFT, KEY.A] });
    expect(mapKey(press('å', 'KeyA', { alt: true }), 'natural')).toEqual({ hold: [SYMBOL_SHIFT, KEY.A] });
  });

  it('leaves the system its keys, and ignores the keys the Spectrum has no use for', () => {
    expect(mapKey(press('c', 'KeyC', { meta: true }), 'natural')).toBeNull();
    expect(mapKey(press('Shift', 'ShiftLeft', { shift: true }), 'natural')).toBeNull();
    expect(mapKey(press('F5', 'F5'), 'natural')).toBeNull();
    expect(mapKey(press('`', 'Backquote'), 'natural')).toBeNull();
  });

  it('can type every character the Spectrum has on its keys, from the PC', () => {
    const typable = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}~£©';
    const missing = [...typable].filter((ch) => !charChords(ch));
    expect(missing).toEqual([]);
  });
});

describe('the positional mapping, for games', () => {
  it('is the key in the PC key’s place', () => {
    expect(mapKey(press('q', 'KeyQ'), 'positional')).toEqual({ hold: [KEY.Q] });
    expect(mapKey(press('%', 'Digit5', { shift: true }), 'positional')).toEqual({ hold: [KEY['5']] });
    expect(mapKey(press(' ', 'Space'), 'positional')).toEqual({ hold: [SPACE] });
  });

  it('makes Shift CAPS SHIFT and Ctrl or Alt SYMBOL SHIFT, held as they are', () => {
    expect(mapKey(press('Shift', 'ShiftLeft'), 'positional')).toEqual({ hold: [CAPS_SHIFT] });
    expect(mapKey(press('Shift', 'ShiftRight'), 'positional')).toEqual({ hold: [CAPS_SHIFT] });
    expect(mapKey(press('Control', 'ControlLeft'), 'positional')).toEqual({ hold: [SYMBOL_SHIFT] });
    expect(mapKey(press('Alt', 'AltRight'), 'positional')).toEqual({ hold: [SYMBOL_SHIFT] });
  });

  it('keeps Backspace as DELETE and the arrows as cursor keys', () => {
    expect(mapKey(press('Backspace', 'Backspace'), 'positional')).toEqual({ hold: [CAPS_SHIFT, KEY['0']] });
    expect(mapKey(press('ArrowUp', 'ArrowUp'), 'positional')).toEqual({ hold: [CAPS_SHIFT, KEY['7']] });
  });
});

describe('the joystick on the keys', () => {
  const joystick = { on: true, fire: 'AltLeft' };
  it('makes the arrows directions and the fire key fire, in either mapping', () => {
    for (const mapping of ['natural', 'positional'] as const) {
      expect(mapKey(press('ArrowUp', 'ArrowUp'), mapping, joystick)).toEqual({ joystick: JOY.up });
      expect(mapKey(press('ArrowRight', 'ArrowRight'), mapping, joystick)).toEqual({ joystick: JOY.right });
      expect(mapKey(press('Alt', 'AltLeft', { alt: true }), mapping, joystick)).toEqual({ joystick: JOY.fire });
    }
  });
  it('leaves the arrows as cursor keys when it is off', () => {
    expect(mapKey(press('ArrowUp', 'ArrowUp'), 'positional', { on: false, fire: 'AltLeft' })).toEqual({ hold: [CAPS_SHIFT, KEY['7']] });
  });
  it('is off while the keyboard is for typing by itself, so that a BASIC line can be edited with the arrows', () => {
    const o = { joystick: 'kempston', arrowsJoystick: true };
    expect(arrowsAreJoystick({ ...o, mapping: 'auto', programLoaded: false })).toBe(false);
    expect(arrowsAreJoystick({ ...o, mapping: 'auto', programLoaded: true })).toBe(true);
    // Chosen by the person, it is as they chose.
    expect(arrowsAreJoystick({ ...o, mapping: 'natural', programLoaded: false })).toBe(true);
    expect(arrowsAreJoystick({ ...o, mapping: 'positional', programLoaded: false })).toBe(true);
    expect(arrowsAreJoystick({ ...o, joystick: 'none', mapping: 'positional', programLoaded: true })).toBe(false);
    expect(arrowsAreJoystick({ ...o, arrowsJoystick: false, mapping: 'positional', programLoaded: true })).toBe(false);
  });
});

describe('the operators typed as two characters', () => {
  it('types <>, <= and >= as their own keys, taking the first character back', () => {
    const del = [KEY['CAPS SHIFT'], KEY['0']];
    expect(operatorChords('<', '>')).toEqual([del, [KEY['SYMBOL SHIFT'], KEY.W]]);
    expect(operatorChords('<', '=')).toEqual([del, [KEY['SYMBOL SHIFT'], KEY.Q]]);
    expect(operatorChords('>', '=')).toEqual([del, [KEY['SYMBOL SHIFT'], KEY.E]]);
  });

  it('leaves everything else alone', () => {
    expect(operatorChords(null, '>')).toBeNull();
    expect(operatorChords('>', '<')).toBeNull();
    expect(operatorChords('=', '=')).toBeNull();
    expect(operatorChords('<', 'a')).toBeNull();
  });
});
