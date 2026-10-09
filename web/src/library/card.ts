// A game's play card: what its cassette inlay and manual told a player in the 1980s, made into something the page can
// show and do. Each game on the shelf has one (src/library/games/, a module a game, found by games/index.ts), researched
// from the game's manual, inlay and history, and held to the game itself on this machine: its start route reaches play,
// and each control it names moves the player (web/tests/wasm/games/).
//
// The page shows a card three ways: a start button that drives the route (start.ts's StartPilot), choosing the
// joystick where the game has one, so that the arrows and fire (or a gamepad, or the touch pad) play every game alike;
// an overlay on the screen with the controls as the player presses them; and the card itself in the game's panel (the
// blurb, the goal, the tips, the controls, where it all came from).

import type { Route } from './start';

/** The joystick's directions and fire, as the page's arrows, fire key, gamepad and touch pad give them. */
export type Pad = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'FIRE';

/** One thing the player does in the game, and how. */
export interface Control {
  /** What it does, in a few words, as the manual would put it: 'Jump', 'Blow a bubble', 'Punch behind'. */
  readonly does: string;
  /** With the joystick: the directions and fire held together (['UP'], ['FIRE', 'LEFT']); null where it cannot. */
  readonly pad: readonly Pad[] | null;
  /**
   * With the game's own keys, as it sets them when the keyboard is chosen at its menu (or as its defaults): Spectrum key
   * names as emulator/keys.ts names them ('Q', 'SPACE', 'SYMBOL SHIFT', 'ENTER'), held together; null where only the
   * joystick does it.
   */
  readonly keys: readonly string[] | null;
}

export interface GameCard {
  /** ZXDB's entry, seven digits ('0004293'). */
  readonly id: string;
  readonly title: string;
  /** The back of the cassette: what the game is, in two or three sentences of plain English (not copied text). */
  readonly blurb: string;
  /** What the player is trying to do, in a sentence or two. */
  readonly goal: string;
  /** Two to four short tips, as a friend who had played it would give them. */
  readonly tips: readonly string[];
  /** The moves and actions of play. */
  readonly controls: readonly Control[];
  /** The keys around play: pause, quit, music on or off, and the like (Spectrum key names), each with what it does. */
  readonly extras: readonly { readonly key: string; readonly does: string }[];
  /** Whether the game plays with a Kempston joystick, which its route chooses when the player wants the joystick. */
  readonly joystick: boolean;
  /**
   * For a game with no joystick: the page's arrows and fire put onto the game's own keys while the game runs, so that
   * they play it all the same (and the gamepad and touch pad with them).
   */
  readonly keymap?: Readonly<Partial<Record<Pad, string>>>;
  /** How to get from the loaded game to play, as a person reads it and as the page drives it. */
  readonly start: Route;
  /** The model the card was proved on; the page loads the game on it ('48k' or '128k'). */
  readonly model: '48k' | '128k';
  /** Where the card's facts came from: the manual, the inlay, ZXDB, and anything else read. */
  readonly sources: readonly { readonly title: string; readonly url: string }[];
}
