// How to start a game, for the games where it is not obvious from the screen: the steps as the person reads them
// (with the keys to press, shown as keycaps), and a route the page can drive itself (a game card's Start button), by
// reading the screen at each step and pressing what that screen wants, as a person would. The screens are told apart by
// what the machine shows: the ROM-font text the screen reads as (Emulator.screenText) where the game prints in it, and
// otherwise its attributes (a highlighted menu item flashes: `flashing`, `rowIs`). Each game's route is its card's
// (card.ts, games/): Saboteur's (games/saboteur.ts) is the worked example.

import { KEY } from '../emulator/keys';

/** The screen, as a route reads it. */
export interface Screen {
  /** Emulator.screenText: 24 rows of 32, the ROM's font read. */
  readonly text: string;
  /** The attribute byte of a character cell. */
  attr(row: number, col: number): number;
}

export interface StartChoice {
  /** The joystick (the arrows and the fire key, a gamepad, the touch pad) rather than the game's keys. */
  readonly joystick: boolean;
  /** The skill level, where the game asks for one. */
  readonly skill: number;
}

/** What to do next: press a key for so many frames (then wait `after`), wait, or nothing more: the game has begun. */
export type Move = { readonly press: string; readonly hold: number; readonly after: number } | { readonly wait: number } | { readonly done: true };

/** The part of a start route that a pilot drives and a person reads: what a game card (card.ts) carries. */
export interface Route {
  /** The steps as a person reads them, each with the keys it names (shown as keycaps; 'any' is any key). */
  readonly steps: readonly { readonly text: string; readonly keys: readonly string[] }[];
  /** The skill levels it asks for, or null. */
  readonly skills: readonly [number, number] | null;
  /** The longest the route may take, frames: past it the page gives up and says so. */
  readonly within: number;
  /** Whether the machine shows a screen the route knows (it can be started from there). */
  ready(screen: Screen): boolean;
  /** The next move from this screen. */
  next(screen: Screen, choice: StartChoice): Move;
}

/** The rows with flashing cells in columns `from`–`to`, each followed by how many: [row, count, row, count...]. */
export function flashing(screen: Screen, from = 0, to = 31): number[] {
  const rows: number[] = [];
  for (let r = 0; r < 24; r++) {
    let n = 0;
    for (let c = from; c <= to; c++) if (screen.attr(r, c) & 0x80) n++;
    if (n) rows.push(r, n);
  }
  return rows;
}

/** Whether every cell of a row has the attribute `value`. */
export const rowIs = (screen: Screen, row: number, value: number): boolean => Array.from({ length: 32 }, (_, c) => screen.attr(row, c)).every((a) => a === value);

/** The Spectrum key a route presses, as a key code. */
export function keyCode(name: string): number {
  const code = KEY[name];
  if (code === undefined) throw new Error(`no Spectrum key ${name}`);
  return code;
}

/** A press the pilot wants: key `code` down from frame `from`, up at `until`. */
export interface PilotPress {
  readonly code: number;
  readonly from: number;
  readonly until: number;
}

/**
 * Drives a route: asked at each frame (before it runs), it reads the screen when its last move has had its time and
 * says what to press. It ends when the game has begun, or gives up past the route's time.
 */
export class StartPilot {
  private nextAt: number;
  private readonly deadline: number;
  state: 'driving' | 'done' | 'gave up' = 'driving';

  constructor(
    readonly route: Route,
    readonly choice: StartChoice,
    frame: number,
  ) {
    this.nextAt = frame;
    this.deadline = frame + route.within;
  }

  /** Frame `frame` is about to run; `screen` reads it (only when asked). A press to make, or null. */
  tick(frame: number, screen: () => Screen): PilotPress | null {
    if (this.state !== 'driving' || frame < this.nextAt) return null;
    if (frame > this.deadline) {
      this.state = 'gave up';
      return null;
    }
    const m = this.route.next(screen(), this.choice);
    if ('done' in m) {
      this.state = 'done';
      return null;
    }
    if ('wait' in m) {
      this.nextAt = frame + m.wait;
      return null;
    }
    this.nextAt = frame + m.hold + m.after;
    return { code: keyCode(m.press), from: frame, until: frame + m.hold };
  }
}

/** The screen of an emulator, as a route reads it: its text and attributes, read when asked. */
export function screenOf(e: { screenText(): string; peek(address: number): number }): Screen {
  let text: string | null = null;
  const attrs = new Int16Array(768).fill(-1);
  return {
    get text() {
      return (text ??= e.screenText());
    },
    attr(row, col) {
      const i = row * 32 + col;
      if (attrs[i] < 0) attrs[i] = e.peek(0x5800 + i);
      return attrs[i];
    },
  };
}
