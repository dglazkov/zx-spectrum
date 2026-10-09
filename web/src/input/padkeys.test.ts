import { describe, expect, it } from 'vitest';
import { JOY } from '../emulator/emulator';
import { KEY } from '../emulator/keys';
import { KeyFeeder } from './feeder';
import { keymapCodes, PadKeys } from './padkeys';

/** A feeder whose machine is a log, and the keys down after each frame is ticked. */
function rig() {
  const log: [number, boolean, number][] = [];
  let frame = 0;
  const feeder = new KeyFeeder((code, down) => log.push([code, down, frame]));
  const pad = new PadKeys(feeder);
  const tick = (to: number) => {
    for (; frame <= to; frame++) feeder.tick(frame);
  };
  const down = () => Object.entries(KEY).filter(([, c]) => feeder.isDown(c)).map(([n]) => n).sort();
  return { feeder, pad, log, tick, down, now: () => frame };
}

describe('a card’s key map', () => {
  // Manic Miner's keys, say: O left, P right, SPACE to jump (up and fire both).
  const keymap = { LEFT: 'O', RIGHT: 'P', UP: 'SPACE', FIRE: 'SPACE' } as const;

  it('presses the game’s keys for the joystick’s directions and fire, and lets them go', () => {
    const r = rig();
    r.pad.set(keymap, 0);
    r.pad.update(JOY.left, 0);
    r.tick(2);
    expect(r.down()).toEqual(['O']);
    r.pad.update(JOY.left | JOY.fire, r.now());
    r.tick(5);
    expect(r.down()).toEqual(['O', 'SPACE']);
    r.pad.update(JOY.fire, r.now());
    r.tick(8);
    expect(r.down()).toEqual(['SPACE']);
    r.pad.update(0, r.now());
    r.tick(11);
    expect(r.down()).toEqual([]);
    // Each key went down once and up once.
    expect(r.log.map(([c, d]) => `${c}${d ? '↓' : '↑'}`)).toEqual([`${KEY.O}↓`, `${KEY.SPACE}↓`, `${KEY.O}↑`, `${KEY.SPACE}↑`]);
  });

  it('keeps a key two directions share down until both are let go', () => {
    const r = rig();
    r.pad.set(keymap, 0);
    r.pad.update(JOY.up | JOY.fire, 0);
    r.tick(3);
    r.pad.update(JOY.up, r.now());
    r.tick(6);
    expect(r.down()).toEqual(['SPACE']);
    r.pad.update(0, r.now());
    r.tick(9);
    expect(r.down()).toEqual([]);
  });

  it('lets go of what it held when the map changes or goes, and does nothing without one', () => {
    const r = rig();
    r.pad.set(keymap, 0);
    r.pad.update(JOY.right, 0);
    r.tick(3);
    expect(r.down()).toEqual(['P']);
    r.pad.set(null, r.now());
    r.tick(6);
    expect(r.down()).toEqual([]);
    r.pad.update(JOY.right | JOY.fire, r.now());
    r.tick(9);
    expect(r.down()).toEqual([]);
    expect(r.pad.keymap).toBeNull();
  });

  it('holds a press at least a frame, so a tap between frames is seen', () => {
    const r = rig();
    r.pad.set(keymap, 0);
    r.pad.update(JOY.left, 4);
    r.pad.update(0, 4);
    r.tick(6);
    const o = r.log.filter(([c]) => c === KEY.O);
    expect(o.map(([, d, f]) => [d, f])).toEqual([
      [true, 4],
      [false, 5],
    ]);
  });

  it('leaves a key the keyboard holds alone', () => {
    const r = rig();
    r.pad.set(keymap, 0);
    r.feeder.hold('KeyO', [KEY.O], 0, 'free');
    r.pad.update(JOY.left, 0);
    r.tick(2);
    r.pad.update(0, r.now());
    r.tick(5);
    expect(r.down()).toEqual(['O']);
  });

  it('refuses a map that names no Spectrum key', () => {
    expect(() => keymapCodes({ UP: 'Q', FIRE: 'ALT' })).toThrow(/ALT/);
    expect(keymapCodes({ UP: 'Q', DOWN: 'A', FIRE: 'SYMBOL SHIFT' })).toEqual({ UP: KEY.Q, DOWN: KEY.A, FIRE: KEY['SYMBOL SHIFT'] });
  });
});
