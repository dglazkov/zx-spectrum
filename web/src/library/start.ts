// How to start a game, for the games where it is not obvious from the screen: the steps as the person reads them
// (with the keys to press, shown as keycaps), the game's own keys (from its manual), and a route the page can drive
// itself (Start the mission), by reading the screen at each step and pressing what that screen wants, as a person
// would. The screens are told apart by what the machine shows: the ROM-font text the screen reads as
// (Emulator.screenText) where the game prints in it, and otherwise its attributes (a highlighted menu item flashes).
//
// Saboteur's (Durell, 1985), worked out against the game itself on this machine (web/tests/wasm/start.spec.ts holds
// the route to it): the £100 REWARD screen wants any key; the high scores take a key only from about a second and a
// half after they show until about five and a half, and then the game goes on to its next screen; the menu reads a
// key only once it has been held for 8 frames or so (it reads the keys between the notes it plays: a quick tap is
// lost), and highlights J KEMPSTON, K KEYBOARD or P PROTEK (the default) on rows 1, 3 and 5; S starts the mission with
// what is highlighted; the skill level is a digit held until the mission is announced. (With no Kempston interface
// plugged in, J starts at once: port 1F then floats high, which the game reads as fire held.)

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

export interface StartRoute extends Route {
  /** ZXDB's entry. */
  readonly id: string;
  /** The game's own keys, as its manual sets them out: each key and what it does. */
  readonly keys: readonly { readonly key: string; readonly does: string }[];
  /** What the joystick does in it, said plainly. */
  readonly joystick: string;
}

/** The rows with flashing cells in columns `from`–`to`, each followed by how many: [row, count, row, count...]. */
function flashing(screen: Screen, from = 0, to = 31): number[] {
  const rows: number[] = [];
  for (let r = 0; r < 24; r++) {
    let n = 0;
    for (let c = from; c <= to; c++) if (screen.attr(r, c) & 0x80) n++;
    if (n) rows.push(r, n);
  }
  return rows;
}

const rowIs = (screen: Screen, row: number, value: number) => Array.from({ length: 32 }, (_, c) => screen.attr(row, c)).every((a) => a === value);

export const SABOTEUR: StartRoute = {
  id: '0004293',
  steps: [
    { text: 'At the £100 REWARD screen press any key, and another at the high scores.', keys: ['any'] },
    { text: 'At the menu press K for the keyboard, or J for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad). P PROTEK, the menu’s own choice, is a cursor joystick on 5, 6, 7, 8 and 0.', keys: ['K', 'J'] },
    { text: 'S starts the mission. Hold a skill level, 1–9, down until the mission is announced: the menu reads keys between the notes of its tune, so a quick tap is missed.', keys: ['S', '1–9'] },
    { text: 'The ninja leaps from the dinghy into the sea. Swim right to the jetty and press up as you pass under one of its posts to climb out: the post takes only an exact line-up, so swim back and try again if you pass it.', keys: ['A'] },
  ],
  keys: [
    { key: 'A', does: 'Up · climb · kick' },
    { key: 'Z', does: 'Down · duck' },
    { key: 'N', does: 'Left' },
    { key: 'M', does: 'Right' },
    { key: 'SPACE', does: 'Throw · use · punch' },
  ],
  joystick: 'Up climbs and kicks, fire throws; up with left or right jumps.',
  skills: [1, 9],
  within: 3000,
  ready(screen) {
    return 'press' in this.next(screen, { joystick: false, skill: 1 });
  },
  next(screen, choice) {
    if (screen.text.includes('PRESS ANY KEY TO CONTINUE')) return { press: 'SPACE', hold: 6, after: 30 };
    const flash = flashing(screen);
    // The menu: one item highlighted, its 13 cells flashing on row 1 (J), 3 (K) or 5 (P).
    const menuRow = flash.length === 2 && flash[1] === 13 ? flash[0] : -1;
    if (menuRow >= 0) {
      const want = choice.joystick ? 1 : 3;
      return menuRow === want ? { press: 'S', hold: 10, after: 20 } : { press: choice.joystick ? 'J' : 'K', hold: 10, after: 10 };
    }
    // The skill level's prompt: a flashing box of three cells on row 7.
    if (flash.length === 2 && flash[0] === 7 && flash[1] === 3) return { press: String(Math.max(1, Math.min(9, choice.skill))), hold: 40, after: 20 };
    // The game: the panel, framed in red on black from row 18 to row 23.
    if (!flash.length && rowIs(screen, 18, 0x02) && rowIs(screen, 23, 0x02)) return { done: true };
    // The high scores: green below row 16, nothing flashing. A key, and a moment for it to be taken.
    if (!flash.length && rowIs(screen, 16, 0x20) && rowIs(screen, 23, 0x20)) return { press: 'K', hold: 8, after: 30 };
    // Something in between (the screen being drawn): look again shortly.
    return { wait: 10 };
  },
};

export const ROUTES: Readonly<Record<string, StartRoute>> = { [SABOTEUR.id]: SABOTEUR };

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
