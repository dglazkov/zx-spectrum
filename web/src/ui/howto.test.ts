import { describe, expect, it } from 'vitest';
import type { GameCard } from '../library/card';
import { card as saboteur } from '../library/games/saboteur';
import { controlsNow, controlsTable, fallbackHowTo, joystickLine, keyCap, modeOf, padCaps, zxdbSays, type Hands, type Press } from './howto';

const keyboard: Hands = { fireCode: 'AltLeft', touch: false, gamepad: false };
const labels = (p: Press | null) => (p ? p.map((c) => c.label) : null);
const row = (howto: ReturnType<typeof controlsNow>, does: RegExp) => labels(howto.rows.find((r) => does.test(r.does))?.press ?? null);

/** A game with no joystick, its key map putting the arrows on its keys (as Manic Miner's might). */
const noJoystick: GameCard = {
  ...saboteur,
  id: '9999999',
  title: 'Keys Only',
  joystick: false,
  keymap: { LEFT: 'O', RIGHT: 'P', UP: 'SPACE', FIRE: 'SPACE' },
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Jump', pad: ['UP'], keys: ['SPACE'] },
    { does: 'Music on or off', pad: null, keys: ['H'] },
  ],
  extras: [{ key: 'CAPS SHIFT+SPACE', does: 'Quit' }],
};

describe('the controls as the person presses them now', () => {
  it('with the joystick: the arrows and the fire key, held together where the card says', () => {
    const now = controlsNow(saboteur, { ...keyboard, joystick: true });
    expect(now.mode).toBe('Joystick');
    expect(now.how).toBe('The arrow keys and Left Alt, or a gamepad.');
    expect(row(now, /swim left/)).toEqual(['←']);
    expect(row(now, /^Jump/)).toEqual(['↑', '→']);
    expect(row(now, /^Punch/)).toEqual(['Left Alt']);
    // Directions first, then fire, whatever order the card gives them in.
    expect(row(now, /^Throw high/)).toEqual(['↑', 'Left Alt']);
    expect(now.note).toBeNull();
  });

  it('with another fire key, or a gamepad plugged in, says so', () => {
    const ctrl = controlsNow(saboteur, { ...keyboard, fireCode: 'ControlLeft', gamepad: true, joystick: true });
    expect(row(ctrl, /^Punch/)).toEqual(['Left Ctrl']);
    expect(ctrl.how).toBe('The arrow keys and Left Ctrl, or the gamepad.');
  });

  it('with the game’s keys: its keys as the PC presses them in their Spectrum places', () => {
    const now = controlsNow(saboteur, { ...keyboard, joystick: false });
    expect(now.mode).toBe('Keys');
    expect(row(now, /swim left/)).toEqual(['N']);
    expect(row(now, /swim right/)).toEqual(['M']);
    expect(row(now, /^Punch/)).toEqual(['Space']);
    expect(row(now, /^Throw high/)).toEqual(['Space', 'A']);
  });

  it('on a touch screen: the pad and FIRE, and the drawn keyboard’s own key names', () => {
    const pad = controlsNow(saboteur, { ...keyboard, touch: true, joystick: true });
    expect(pad.how).toBe('The pad and FIRE beside the screen.');
    expect(row(pad, /^Punch/)).toEqual(['FIRE']);
    const keys = controlsNow(saboteur, { ...keyboard, touch: true, joystick: false });
    expect(row(keys, /^Punch/)).toEqual(['SPACE']);
  });

  it('for a game with a key map: the arrows, and which of its keys each presses', () => {
    const now = controlsNow(noJoystick, { ...keyboard, joystick: true });
    expect(now.mode).toBe('Arrows');
    expect(now.how).toMatch(/press the game’s own keys for you/);
    expect(row(now, /Walk left/)).toEqual(['←']);
    // What only a key does is shown as that key.
    expect(row(now, /Music/)).toEqual(['H']);
    expect(now.note).toBe('↑ is Space · ← is O · → is P · Left Alt is Space.');
    expect(labels(now.extras[0].press)).toEqual(['Shift', 'Space']);
    const keys = controlsNow(noJoystick, { ...keyboard, joystick: false });
    expect(keys.mode).toBe('Keys');
    expect(row(keys, /Jump/)).toEqual(['Space']);
    expect(keys.note).toBeNull();
  });

  it('for a game with neither a joystick nor a key map: its keys, whatever was chosen', () => {
    const typed: GameCard = { ...noJoystick, keymap: undefined };
    expect(modeOf(typed, true)).toBe('Keys');
    expect(row(controlsNow(typed, { ...keyboard, joystick: true }), /Walk left/)).toEqual(['O']);
  });

  it('shows SYMBOL SHIFT as whichever of Ctrl and Alt is not the fire key, CAPS SHIFT as Shift', () => {
    expect(keyCap('SYMBOL SHIFT', keyboard).label).toBe('Ctrl');
    expect(keyCap('SYMBOL SHIFT', { ...keyboard, fireCode: 'ControlLeft' }).label).toBe('Alt');
    expect(keyCap('CAPS SHIFT', keyboard).label).toBe('Shift');
    expect(keyCap('ENTER', keyboard)).toEqual({ label: 'Enter', title: 'ENTER: Enter on this keyboard', kind: 'key' });
    expect(padCaps(['FIRE', 'LEFT'], keyboard).map((c) => c.kind)).toEqual(['arrow', 'fire']);
  });

  it('lays the panel’s table out by the joystick and by the keys', () => {
    const t = controlsTable(saboteur, keyboard);
    expect(t).toHaveLength(saboteur.controls.length);
    expect(t.map((r) => [r.does, labels(r.joystick), labels(r.keys)])[4]).toEqual(['Jump: up with left or right', ['↑', '→'], ['A', 'M']]);
  });
});

describe('a game with no card', () => {
  it('reads ZXDB’s controls out', () => {
    expect(zxdbSays(['Cursor', 'Kempston Joystick', 'Redefineable keys'])).toBe('The ZXDB says it takes a cursor joystick (5, 6, 7, 8 and 0), a Kempston joystick or keys you choose at its menu.');
    expect(zxdbSays(['Interface 2 (left)', 'Interface 2 (right)'])).toBe('The ZXDB says it takes a Sinclair joystick.');
    expect(zxdbSays([])).toBeNull();
  });

  it('says one honest line about the joystick', () => {
    expect(joystickLine(['Kempston Joystick'], keyboard)).toBe('Most games of the time take a Kempston joystick from their menu: choose it there, then play with the arrow keys and Left Alt.');
    expect(joystickLine([], { ...keyboard, touch: true })).toMatch(/Kempston joystick from their menu: choose it there, then play with the pad and FIRE\.$/);
    expect(joystickLine(['Cursor'], keyboard)).toMatch(/^The ZXDB lists no Kempston joystick for it/);
  });

  it('puts the manual’s table on the screen, with the honest line under it', () => {
    const howto = fallbackHowTo(['Kempston Joystick'], { rows: [['Q', 'Up'], ['A', 'Down'], ['SPACE', 'Fire', 'Jump']] }, keyboard);
    expect(howto.mode).toBe('Controls');
    expect(howto.how).toBe('The ZXDB says it takes a Kempston joystick.');
    expect(howto.rows.map((r) => [labels(r.press), r.does])).toEqual([
      [['Q'], 'Up'],
      [['A'], 'Down'],
      [['SPACE'], 'Fire · Jump'],
    ]);
    expect(howto.note).toMatch(/^Most games of the time/);
    expect(fallbackHowTo([], null, keyboard).how).toBe('The ZXDB lists no controls for it.');
    expect(fallbackHowTo([], null, keyboard, false).how).toBe('Opened from a file: the page knows nothing of how it is played.');
  });
});
