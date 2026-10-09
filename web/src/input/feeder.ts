// Key presses, put to the machine at frame boundaries, timed so that the machine sees each of them.
//
// The emulator reads its keys as the program does, at an instant, so a press that came and went between two frames
// would never be seen. Every press here lasts a frame at least. A game reads the keys when it likes, so for games
// (`free` pacing) that is all there is. The ROM's editor is pickier (`rom` pacing): its KEYBOARD routine, run at every
// frame's interrupt, keeps the two most recent keys in two sets (KSTATE), and a key leaves its set only five frames
// after it was last seen. A key pressed again before its set is free is taken for the same press held down (and
// ignored until the repeat delay runs out), and a third key while both sets are held is ignored. The Complete Spectrum
// ROM Disassembly (Logan and O'Hara, 02BF KEYBOARD) has the routine; feeder.test.ts runs a model of it.
//
// Frames are counted by the page (emulator.frameCount); "now" is the frame about to run.

import { CAPS_SHIFT, SYMBOL_SHIFT } from '../emulator/keys';
import type { Chord } from './keymap';

export type Pacing = 'rom' | 'free';

/** How long a typed key is held, and how long between keys, in frames. */
export interface Typing {
  readonly hold: number;
  readonly gap: number;
}

/** Holding each key 3 frames and leaving 3 between keys, with the ROM's own pacing on top: about 7 keys a second. */
export const TYPING: Typing = { hold: 3, gap: 3 };

/** A key's KSTATE set is free this many frames after the key was last seen (5, with a frame to spare). */
const SET_FREE_AFTER = 6;

interface Pending {
  readonly frame: number;
  readonly code: number;
  readonly down: boolean;
}

interface Held {
  readonly chord: Chord;
  readonly from: number;
  readonly pacing: Pacing;
  readonly set: number; // the KSTATE set it holds under rom pacing, or -1
}

/** A KSTATE set: the key it holds and the frame it is free from (Infinity while the key is down). */
interface RomSet {
  key: number;
  freeAt: number;
}

/** The key the ROM's KEYBOARD routine registers for a chord: its key other than the shifts; both shifts are a key of their own (extended mode); a shift alone is none. */
export function mainKey(chord: Chord): number {
  const other = chord.find((c) => c !== CAPS_SHIFT && c !== SYMBOL_SHIFT);
  if (other !== undefined) return other;
  return chord.includes(CAPS_SHIFT) && chord.includes(SYMBOL_SHIFT) ? SYMBOL_SHIFT : -1;
}

export class KeyFeeder {
  private queue: Pending[] = [];
  private readonly count = new Uint8Array(40);
  private readonly held = new Map<string, Held>();
  private readonly sets: RomSet[] = [
    { key: -1, freeAt: -Infinity },
    { key: -1, freeAt: -Infinity },
  ];
  /** The frame the last typed sequence ends at. */
  private typedUntil = -Infinity;
  /** The frame the last key typed live (serially) goes up at: the next goes down no sooner, even if its own press and release came first. */
  private serialUntil = -Infinity;

  /** `send` puts a key down or up on the machine. */
  constructor(private readonly send: (code: number, down: boolean) => void) {}

  /** A chord pressed now and held until `release(id)`. A chord already held under `id` is left as it is (the PC's auto-repeat). `serial`: other serial chords held are let go first, as the ROM takes one key at a time. */
  hold(id: string, chord: Chord, now: number, pacing: Pacing, serial = false): void {
    if (this.held.has(id)) return;
    let from = Math.max(now, this.typedUntil);
    // One key at a time, in the order they came: this one goes down once the one before it is up (whether it is still
    // held, or its press and release came and went in the frame: keys pasted, or typed faster than frames run).
    if (serial) {
      for (const [other, h] of this.held) if (h.pacing === 'rom') from = Math.max(from, this.release(other, now));
      from = Math.max(from, this.serialUntil);
    }
    let set = -1;
    if (pacing === 'rom') [from, set] = this.claim(mainKey(chord), from, Infinity);
    for (const code of chord) this.at(from, code, true);
    this.held.set(id, { chord, from, pacing, set });
  }

  /** The chord held under `id` let go, as soon as it has been held a frame (or the hold the ROM needs). Returns the frame it goes up at. */
  release(id: string, now: number): number {
    const h = this.held.get(id);
    if (!h) return now;
    this.held.delete(id);
    const until = Math.max(now, h.from + (h.pacing === 'rom' ? TYPING.hold - 1 : 1));
    for (const code of h.chord) this.at(until, code, false);
    if (h.set >= 0) this.sets[h.set].freeAt = until + SET_FREE_AFTER;
    if (h.pacing === 'rom') this.serialUntil = Math.max(this.serialUntil, until);
    return until;
  }

  /** Chords typed one after another from `now` (after anything typed before), at the ROM's pace. Returns the frame the last is let go at. */
  type(chords: readonly Chord[], now: number, typing: Typing = TYPING): number {
    let t = Math.max(now, this.typedUntil);
    for (const chord of chords) {
      const [from] = this.claim(mainKey(chord), t, 0, typing.hold);
      for (const code of chord) this.at(from, code, true);
      for (const code of chord) this.at(from + typing.hold, code, false);
      t = from + typing.hold + typing.gap;
      this.typedUntil = from + typing.hold;
    }
    return this.typedUntil;
  }

  /** Something typed is still to go in (or under way). */
  typing(now: number): boolean {
    return now <= this.typedUntil;
  }

  /** Puts every press and release due by `frame` to the machine: called just before frame `frame` runs. */
  tick(frame: number): void {
    if (!this.queue.length || this.queue[0].frame > frame) return;
    let n = 0;
    while (n < this.queue.length && this.queue[n].frame <= frame) n++;
    for (const p of this.queue.splice(0, n)) {
      if (p.down) {
        if (this.count[p.code]++ === 0) this.send(p.code, true);
      } else if (this.count[p.code] > 0 && --this.count[p.code] === 0) {
        this.send(p.code, false);
      }
    }
  }

  /** Whether key `code` is down on the machine now. */
  isDown(code: number): boolean {
    return this.count[code] > 0;
  }

  /** Everything let go now, and anything still to be typed forgotten: when the page loses the keyboard, or the machine is reset. */
  clear(): void {
    this.queue = [];
    this.held.clear();
    this.typedUntil = -Infinity;
    this.serialUntil = -Infinity;
    for (const s of this.sets) {
      s.key = -1;
      s.freeAt = -Infinity;
    }
    for (let code = 0; code < 40; code++) {
      if (this.count[code]) {
        this.count[code] = 0;
        this.send(code, false);
      }
    }
  }

  /**
   * The first frame from `from` at which the ROM will take `key` as a new key, and the set it lands in, which it holds
   * until `release` frames later (Infinity: until it is let go) and then SET_FREE_AFTER more. A shift alone takes no set.
   */
  private claim(key: number, from: number, release: number, hold = 0): [number, number] {
    if (key < 0) return [from, -1];
    let t = from;
    for (;;) {
      // The same key still in a set reads as the old press held down: wait for that set to be free.
      const same = this.sets.find((s) => s.key === key && s.freeAt > t);
      if (same) {
        t = same.freeAt;
        continue;
      }
      const free = this.sets.findIndex((s) => s.freeAt <= t);
      if (free < 0) {
        t = Math.min(...this.sets.map((s) => s.freeAt));
        continue;
      }
      this.sets[free].key = key;
      this.sets[free].freeAt = release === Infinity ? Infinity : t + hold + SET_FREE_AFTER;
      return [t, free];
    }
  }

  private at(frame: number, code: number, down: boolean): void {
    const p: Pending = { frame, code, down };
    // Kept in frame order; a release and a press of one key in one frame stay in the order they were asked for.
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > frame) i--;
    this.queue.splice(i, 0, p);
  }
}
