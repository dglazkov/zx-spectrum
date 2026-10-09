import { describe, expect, it } from 'vitest';
import { CAPS_SHIFT, ENTER, KEY, KEY_NAME, SYMBOL_SHIFT } from '../emulator/keys';
import { KeyFeeder } from './feeder';
import { charChords, type Chord } from './keymap';
import { loadKeys } from './typer';

/**
 * The 48K ROM's KEYBOARD routine (02BF), as The Complete Spectrum ROM Disassembly gives it, run at each frame's
 * interrupt on the keys held then: what it registers as typed. KEY-SCAN gives up on two keys other than the shifts
 * (and then nothing else happens that frame); otherwise each set's five-frame counter runs down and frees the set;
 * a key held in a set is the same press (K-REPEAT: repeats after REPDEL, 35 frames, then every REPPER, 5); a new one
 * takes set 1 if it is free, else set 0 if that is, else it is not taken at all.
 */
class RomKeyboard {
  private sets = [
    { key: -1, counter: 0, repeat: 0 },
    { key: -1, counter: 0, repeat: 0 },
  ];
  readonly typed: string[] = [];

  interrupt(down: ReadonlySet<number>): void {
    const others = [...down].filter((c) => c !== CAPS_SHIFT && c !== SYMBOL_SHIFT);
    if (others.length > 1) return; // KEY-SCAN: RET NZ
    for (const s of this.sets) {
      if (s.key < 0) continue;
      if (--s.counter === 0) s.key = -1;
    }
    let key = others[0] ?? -1;
    if (key < 0 && down.has(CAPS_SHIFT) && down.has(SYMBOL_SHIFT)) key = SYMBOL_SHIFT; // K-TEST: both shifts are a key
    if (key < 0) return;
    const name = () => `${down.has(CAPS_SHIFT) && key !== SYMBOL_SHIFT ? '^' : ''}${down.has(SYMBOL_SHIFT) && key !== SYMBOL_SHIFT ? '$' : ''}${key === SYMBOL_SHIFT ? 'EXT' : KEY_NAME[key]}`;
    const same = this.sets.find((s) => s.key === key);
    if (same) {
      same.counter = 5;
      if (--same.repeat === 0) {
        same.repeat = 5;
        this.typed.push(name());
      }
      return;
    }
    const free = this.sets[1].key < 0 ? this.sets[1] : this.sets[0].key < 0 ? this.sets[0] : null;
    if (!free) return;
    Object.assign(free, { key, counter: 5, repeat: 35 });
    this.typed.push(name());
  }
}

/** Runs frames from..to: the feeder's presses for each frame, then that frame's interrupt. */
function run(feeder: KeyFeeder, down: Set<number>, rom: RomKeyboard, from: number, to: number): void {
  for (let f = from; f < to; f++) {
    feeder.tick(f);
    rom.interrupt(down);
  }
}

function setup() {
  const down = new Set<number>();
  const feeder = new KeyFeeder((code, d) => (d ? down.add(code) : down.delete(code)));
  return { down, feeder, rom: new RomKeyboard() };
}

const names = (chords: Chord[]) =>
  chords.map((c) => {
    const main = c.find((k) => k !== CAPS_SHIFT && k !== SYMBOL_SHIFT);
    if (main === undefined) return 'EXT';
    return `${c.includes(CAPS_SHIFT) ? '^' : ''}${c.includes(SYMBOL_SHIFT) ? '$' : ''}${KEY_NAME[main]}`;
  });

describe('typing into the ROM', () => {
  it('types LOAD "" on a 48K so that the ROM takes every key once, the second quote too', () => {
    const { down, feeder, rom } = setup();
    const end = feeder.type(loadKeys('48k'), 10);
    run(feeder, down, rom, 0, end + 20);
    expect(rom.typed).toEqual(['J', '$P', '$P', 'ENTER']);
    expect(down.size).toBe(0);
    expect(end).toBeLessThan(10 + 4 * 10); // under a second
  });

  it('types a line of BASIC with doubled letters and an extended-mode symbol', () => {
    const { down, feeder, rom } = setup();
    const text = '10 PRINT "HELLO" [1]\n';
    const chords = [...text].flatMap((ch) => charChords(ch) ?? []);
    const end = feeder.type(chords, 0);
    run(feeder, down, rom, 0, end + 20);
    expect(rom.typed).toEqual(names(chords));
  });

  it('keeps up with a fast typist rolling from key to key, live', () => {
    const { down, feeder, rom } = setup();
    // "hello": a key down every 3 frames (some 17 a second), each held 5 frames, so they overlap.
    const word = 'hello';
    let f = 0;
    const events: [number, () => void][] = [];
    [...word].forEach((ch, i) => {
      const chord = charChords(ch)?.[0] ?? [];
      events.push([i * 3, () => feeder.hold(`k${i}`, chord, f, 'rom', true)]);
      events.push([i * 3 + 5, () => feeder.release(`k${i}`, f)]);
    });
    for (f = 0; f < 200; f++) {
      for (const [at, act] of events) if (at === f) act();
      feeder.tick(f);
      rom.interrupt(down);
    }
    expect(rom.typed).toEqual(['H', 'E', 'L', 'L', 'O']);
  });

  it('lets a held key repeat as the ROM repeats it', () => {
    const { down, feeder, rom } = setup();
    feeder.hold('a', [KEY.A], 0, 'rom', true);
    run(feeder, down, rom, 0, 60);
    feeder.release('a', 60);
    run(feeder, down, rom, 60, 70);
    // Down at frame 0, again 35 frames later, then every 5: 0, 35, 40, 45, 50, 55.
    expect(rom.typed.length).toBe(6);
  });
});

describe('keys for games', () => {
  it('holds a press that came and went within a frame for a frame, so the game sees it', () => {
    const { down, feeder } = setup();
    feeder.hold('fire', [KEY.M], 10, 'free');
    feeder.release('fire', 10);
    feeder.tick(10);
    expect(down.has(KEY.M)).toBe(true);
    feeder.tick(11);
    expect(down.has(KEY.M)).toBe(false);
  });

  it('puts a key down at once, with no pacing', () => {
    const { down, feeder } = setup();
    feeder.hold('a', [KEY.Q], 5, 'free');
    feeder.release('a', 9);
    feeder.hold('b', [KEY.Q], 9, 'free');
    feeder.tick(9);
    expect(down.has(KEY.Q)).toBe(true);
  });

  it('keeps a key shared by two chords down until both let go', () => {
    const { down, feeder } = setup();
    feeder.hold('shift', [CAPS_SHIFT], 0, 'free');
    feeder.hold('caps-5', [CAPS_SHIFT, KEY['5']], 0, 'free');
    feeder.tick(0);
    feeder.release('caps-5', 3);
    feeder.tick(3);
    expect(down.has(CAPS_SHIFT)).toBe(true);
    expect(down.has(KEY['5'])).toBe(false);
    feeder.release('shift', 4);
    feeder.tick(4);
    expect(down.has(CAPS_SHIFT)).toBe(false);
  });

  it('lets everything go at once when cleared', () => {
    const { down, feeder } = setup();
    feeder.hold('a', [KEY.A, ENTER], 0, 'free');
    feeder.type([[KEY.B], [KEY.C]], 0);
    feeder.tick(0);
    expect(down.size).toBeGreaterThan(0);
    feeder.clear();
    expect(down.size).toBe(0);
    feeder.tick(100);
    expect(down.size).toBe(0);
  });
});
