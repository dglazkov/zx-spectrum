// A game's key map (its play card's `keymap`, for a game that takes no joystick): the page's joystick, which is the arrow
// keys and the fire key, a gamepad and the phone's touch pad together, put onto the game's own keys while the game runs.
// Each direction and fire is held as a key of its own through the feeder, so that two that press the same key (up and
// fire both SPACE, say) keep it down until both are let go, and a key the person also holds on the keyboard is not let
// go under them.

import { JOY } from '../emulator/emulator';
import { KEY } from '../emulator/keys';
import type { Pad } from '../library/card';
import type { KeyFeeder } from './feeder';

/** A key map (card.ts's): what Spectrum key (emulator/keys.ts's names) each direction and fire presses. */
export type Keymap = Readonly<Partial<Record<Pad, string>>>;

/** The joystick's bit for each direction and fire. */
export const PAD_BITS: Readonly<Record<Pad, number>> = { UP: JOY.up, DOWN: JOY.down, LEFT: JOY.left, RIGHT: JOY.right, FIRE: JOY.fire };

const PADS = Object.keys(PAD_BITS) as Pad[];

/** The key codes of a key map, by direction; a name that is not a Spectrum key is an error (a card's mistake). */
export function keymapCodes(keymap: Keymap): Partial<Record<Pad, number>> {
  const out: Partial<Record<Pad, number>> = {};
  for (const pad of PADS) {
    const name = keymap[pad];
    if (name === undefined) continue;
    const code = KEY[name];
    if (code === undefined) throw new Error(`a key map names ${name}, which is not a Spectrum key`);
    out[pad] = code;
  }
  return out;
}

/** The page's joystick onto a game's keys, through the feeder. */
export class PadKeys {
  private codes: Partial<Record<Pad, number>> = {};
  private held = 0;
  private map: Keymap | null = null;

  constructor(private readonly feeder: KeyFeeder) {}

  /** The key map in force, or null for none (the joystick is then the joystick). */
  get keymap(): Keymap | null {
    return this.map;
  }

  /** A new key map (or none) from frame `now`: whatever the old one held is let go first. */
  set(keymap: Keymap | null, now: number): void {
    this.update(0, now);
    this.map = keymap && Object.keys(keymap).length ? keymap : null;
    this.codes = this.map ? keymapCodes(this.map) : {};
  }

  /** The joystick's bits before frame `now` runs: the keys of what was newly pushed go down, of what was let go up. */
  update(bits: number, now: number): void {
    const want = this.map ? bits & 31 : 0;
    if (want === this.held) return;
    for (const pad of PADS) {
      const bit = PAD_BITS[pad];
      const code = this.codes[pad];
      if (code === undefined || (want & bit) === (this.held & bit)) continue;
      if (want & bit) this.feeder.hold(`keymap-${pad}`, [code], now, 'free');
      else this.feeder.release(`keymap-${pad}`, now);
    }
    this.held = want;
  }

  /** Nothing held (the feeder was cleared: a reset, the page lost the keyboard). */
  forget(): void {
    this.held = 0;
  }
}
