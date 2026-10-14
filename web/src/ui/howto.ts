// What to press, worked out for the person as they play now: a play card's controls (library/card.ts) as the keys
// they press on this page, by the joystick (the arrow keys and the fire key, the phone's pad and FIRE, a gamepad) or by
// the game's own keys; and, for a game with no card, what the ZXDB and its manual say, with one honest line about the
// joystick. Both the overlay on the screen (overlay.ts) and the game's panel (game.ts) show it. No DOM here: what it
// works out is tested on its own (howto.test.ts).

import { m, say, t } from '../i18n/i18n';
import { FIRE_KEYS } from '../input/keymap';
import { isByHand, type Control, type GameCard, type Pad } from '../library/card';
import type { Route } from '../library/start';

/** How the page's joystick reaches the person, which does not change from game to game. */
export interface Hands {
  /** The fire key's KeyboardEvent.code (settings: 'AltLeft' by default). */
  readonly fireCode: string;
  /** A touch screen: the pad and FIRE under the screen are the joystick. */
  readonly touch: boolean;
  /** A gamepad is connected. */
  readonly gamepad: boolean;
}

/** How the person plays now: the joystick (for a game with a key map, the arrows doing its keys) or the game's keys. */
export interface Playing extends Hands {
  readonly joystick: boolean;
}

/** A keycap: what is printed on it, and what it is (its tooltip, and what a screen reader says). */
export interface Cap {
  readonly label: string;
  readonly title: string;
  readonly kind: 'arrow' | 'fire' | 'key';
}

/** Keycaps held together. */
export type Press = readonly Cap[];

export interface HowRow {
  readonly does: string;
  /** What to press for it now; null where only the other way does it. */
  readonly press: Press | null;
}

export interface HowTo {
  /** Which way: 'Joystick', 'Arrows', 'Keys'; or 'Controls' for a game with no card. */
  readonly mode: string;
  /** The way said in a line: "The arrow keys and Left Alt, or a gamepad". */
  readonly how: string;
  readonly rows: readonly HowRow[];
  /** The keys around play: pause, quit, music. */
  readonly extras: readonly HowRow[];
  /** A line under it all: for a key map, which key each arrow presses; for a game with no card, the joystick's honest line. */
  readonly note: string | null;
  /** For a game the person starts by hand: its steps, first, each as text with its keys set as keycaps. */
  readonly steps?: readonly StepNow[];
}

/** A step of a start by hand as it shows: its words, with each key it names a keycap where the words name it. */
export type StepNow = readonly (string | Cap)[];

/** The fire key's name, as Settings lists it ('Left Alt'), in the page's language. */
export function fireName(code: string): string {
  const name = FIRE_KEYS.find((k) => k.code === code)?.name;
  return name ? t(name) : code;
}

/** Each direction: its arrow, and what it is called on the touch pad and on the keyboard. */
const ARROWS = {
  UP: ['↑', m('Up on the pad'), m('Up arrow')],
  DOWN: ['↓', m('Down on the pad'), m('Down arrow')],
  LEFT: ['←', m('Left on the pad'), m('Left arrow')],
  RIGHT: ['→', m('Right on the pad'), m('Right arrow')],
} as const;

/** The joystick's directions and fire as this person presses them. */
export function padCaps(pad: readonly Pad[], hands: Hands): Press {
  // Directions first, in the order a person says them, then fire.
  const order: Pad[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'FIRE'];
  return [...pad]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((p): Cap => {
      if (p !== 'FIRE') return { label: ARROWS[p][0], title: say(hands.touch ? ARROWS[p][1] : ARROWS[p][2]), kind: 'arrow' };
      const key = fireName(hands.fireCode);
      return hands.touch ? { label: t('FIRE'), title: t('FIRE, beside the pad'), kind: 'fire' } : { label: key, title: hands.gamepad ? t('Fire: {key}, or any face button of the gamepad', { key }) : t('Fire: {key}', { key }), kind: 'fire' };
    });
}

/**
 * A Spectrum key as the PC presses it (the keys are in their Spectrum places once a game is loaded: input/keymap.ts's
 * positional mapping): letters and digits as they are, SPACE and ENTER, CAPS SHIFT is Shift, and SYMBOL SHIFT is Ctrl
 * or Alt, whichever of them is not the fire key. On a touch screen the drawn keyboard is pressed, so its own names.
 */
export function keyCap(name: string, hands: Hands): Cap {
  const n = name.trim().toUpperCase();
  if (hands.touch) return { label: n, title: t('{key} on the keyboard below', { key: n }), kind: 'key' };
  const pc: Record<string, string> = {
    SPACE: t('Space'),
    ENTER: 'Enter',
    'CAPS SHIFT': 'Shift',
    'SYMBOL SHIFT': /^Alt/.test(hands.fireCode) ? 'Ctrl' : 'Alt',
    BREAK: 'Esc',
  };
  return { label: pc[n] ?? n, title: pc[n] ? t('{key}: {pc} on this keyboard', { key: n, pc: pc[n] }) : n, kind: 'key' };
}

/** Keys held together ('SYMBOL SHIFT+A', or a list) as keycaps. */
export function keyCaps(keys: readonly string[], hands: Hands): Press {
  return keys.flatMap((k) => k.split('+')).filter((k) => k.trim()).map((k) => keyCap(k, hands));
}

/** Whether the joystick choice is offered for the card at all: it takes a joystick, or its key map gives it one. */
export function hasJoystick(card: GameCard): boolean {
  return card.joystick || !!(card.keymap && Object.keys(card.keymap).length);
}

/** The way chosen, said: 'Joystick', 'Arrows' (a key map: the arrows press the game's keys) or 'Keys'. */
export function modeOf(card: GameCard, joystick: boolean): 'Joystick' | 'Arrows' | 'Keys' {
  if (!joystick || !hasJoystick(card)) return 'Keys';
  return card.joystick ? 'Joystick' : 'Arrows';
}

/**
 * One control as it is pressed now, the way chosen. What the joystick cannot do is a key's even with the joystick
 * chosen (a smart bomb, a game's music): a game reads those keys whichever way it is played. What only the joystick
 * does is not done with the keys chosen.
 */
function pressFor(c: Control, joystick: boolean, hands: Hands): Press | null {
  if (joystick) return c.pad ? padCaps(c.pad, hands) : c.keys ? keyCaps(c.keys, hands) : null;
  return c.keys ? keyCaps(c.keys, hands) : null;
}

/** The card's controls as the person presses them now. */
export function controlsNow(card: GameCard, playing: Playing): HowTo {
  const mode = modeOf(card, playing.joystick);
  const joystick = mode !== 'Keys';
  const fire = fireName(playing.fireCode);
  let how: string;
  if (mode === 'Joystick') how = playing.touch ? t('The pad and FIRE beside the screen.') : playing.gamepad ? t('The arrow keys and {fire}, or the gamepad.', { fire }) : t('The arrow keys and {fire}, or a gamepad.', { fire });
  else if (mode === 'Arrows') how = playing.touch ? t('The pad and FIRE press the game’s own keys for you.') : playing.gamepad ? t('The arrow keys and {fire} press the game’s own keys for you (the gamepad too).', { fire }) : t('The arrow keys and {fire} press the game’s own keys for you.', { fire });
  else how = playing.touch ? t('The game’s own keys: tap them on the keyboard below.') : t('The game’s own keys, in their Spectrum places on yours.');
  const rows = card.controls.map((c) => ({ does: t(c.does), press: pressFor(c, joystick, playing) }));
  const extras = card.extras.map((x) => ({ does: t(x.does), press: keyCaps([x.key], playing) }));
  let note: string | null = null;
  if (mode === 'Arrows' && card.keymap) {
    const order: Pad[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'FIRE'];
    const pairs = order.filter((p) => card.keymap?.[p]).map((p) => t('{arrow} is {key}', { arrow: padCaps([p], playing)[0].label, key: keyCap(card.keymap![p]!, { ...playing, touch: false }).label }));
    note = `${pairs.join(' · ')}.`;
  }
  const steps = stepsNow(card, playing);
  return steps.length ? { mode, how, rows, extras, note, steps } : { mode, how, rows, extras, note };
}

/** A step's words with each key it names (as the route's steps name them) a keycap; 'any' is "any key", at its end. */
export function stepNow(step: Route['steps'][number], hands: Hands): StepNow {
  const out: (string | Cap)[] = [];
  const text = t(step.text);
  const names = step.keys.filter((k) => k !== 'any');
  const pattern = names.length ? new RegExp(`(?<![A-Za-z0-9])(${names.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9])`, 'g') : null;
  let last = 0;
  if (pattern)
    for (const found of text.matchAll(pattern)) {
      out.push(text.slice(last, found.index));
      out.push(...keyCaps([found[0]], hands));
      last = (found.index ?? 0) + found[0].length;
    }
  out.push(text.slice(last));
  if (step.keys.includes('any')) out.push(' ', { label: t('any key'), title: t('Any key'), kind: 'key' });
  return out.filter((p) => p !== '');
}

/** The card's start by hand, its steps as they show over the screen; none for a start the page drives. */
export function stepsNow(card: GameCard, hands: Hands): StepNow[] {
  return isByHand(card.start) ? card.start.steps.map((st) => stepNow(st, hands)) : [];
}

/** The panel's table of controls: each with how the joystick does it and how the game's keys do. */
export function controlsTable(card: GameCard, hands: Hands): { does: string; joystick: Press | null; keys: Press | null }[] {
  const joystick = hasJoystick(card);
  return card.controls.map((c) => ({ does: t(c.does), joystick: joystick && c.pad ? padCaps(c.pad, hands) : null, keys: c.keys ? keyCaps(c.keys, { ...hands, touch: false }) : null }));
}

// --- A game with no card -----------------------------------------------------------------------------------------

/** ZXDB's names for how a game is played, said plainly. */
const ZXDB: Readonly<Record<string, ReturnType<typeof m>>> = {
  'Kempston Joystick': m('a Kempston joystick'),
  Cursor: m('a cursor joystick (5, 6, 7, 8 and 0)'),
  'Interface 2 (left)': m('a Sinclair joystick'),
  'Interface 2 (right)': m('a Sinclair joystick'),
  'Redefineable keys': m('keys you choose at its menu'),
  'Redefinable keys': m('keys you choose at its menu'),
  'Fuller Joystick': m('a Fuller joystick'),
  'Timex Joystick': m('a Timex joystick'),
};

/** ZXDB's names for how a game is played, as the game's panel lists them: in English as ZXDB has them. */
const ZXDB_NAMES: Readonly<Record<string, ReturnType<typeof m>>> = {
  'Kempston Joystick': m('zxdb|Kempston Joystick'),
  Cursor: m('zxdb|Cursor'),
  'Interface 2 (left)': m('zxdb|Interface 2 (left)'),
  'Interface 2 (right)': m('zxdb|Interface 2 (right)'),
  'Redefineable keys': m('zxdb|Redefineable keys'),
  'Redefinable keys': m('zxdb|Redefinable keys'),
  'Fuller Joystick': m('zxdb|Fuller Joystick'),
  'Timex Joystick': m('zxdb|Timex Joystick'),
};

/** A ZXDB control's name in the page's language, where the page knows it; as ZXDB has it otherwise. */
export function zxdbName(control: string): string {
  return ZXDB_NAMES[control] ? say(ZXDB_NAMES[control]) : control;
}

/** ZXDB's list of controls read out as a sentence, or null where it lists none. */
export function zxdbSays(controls: readonly string[]): string | null {
  const said = [...new Set(controls.map((c) => (ZXDB[c] ? say(ZXDB[c]) : c.toLowerCase())))];
  if (!said.length) return null;
  const list = said.length === 1 ? said[0] : t('{some} or {last}', { some: said.slice(0, -1).join(', '), last: said.at(-1)! });
  return t('The ZXDB says it takes {list}.', { list });
}

/** Whether the joystick line can promise the arrows: ZXDB lists a Kempston joystick, or lists nothing either way. */
export function kempstonLikely(controls: readonly string[]): boolean {
  return !controls.length || controls.includes('Kempston Joystick');
}

/** The one honest line about the joystick, for a game with no card. */
export function joystickLine(controls: readonly string[], hands: Hands): string {
  const fire = fireName(hands.fireCode);
  if (kempstonLikely(controls)) return hands.touch ? t('Most games of the time take a Kempston joystick from their menu: choose it there, then play with the pad and FIRE.') : t('Most games of the time take a Kempston joystick from their menu: choose it there, then play with the arrow keys and {fire}.', { fire });
  return hands.touch ? t('The ZXDB lists no Kempston joystick for it: play with its own keys (its manual has them), or choose the joystick it takes in Settings, and play with the pad and FIRE.') : t('The ZXDB lists no Kempston joystick for it: play with its own keys (its manual has them), or choose the joystick it takes in Settings, and play with the arrow keys and {fire}.', { fire });
}

/** What is said of ZXDB's controls for a game with no card: read out, or that it lists none, or (a file opened) nothing. */
export function zxdbLine(controls: readonly string[], inZxdb: boolean): string {
  if (!inZxdb) return t('Opened from a file: the page knows nothing of how it is played.');
  return zxdbSays(controls) ?? t('The ZXDB lists no controls for it.');
}

/** What the overlay shows for a game with no card: what ZXDB and the manual say, and the honest line. */
export function fallbackHowTo(controls: readonly string[], table: { rows: readonly (readonly string[])[] } | null, hands: Hands, inZxdb = true): HowTo {
  const rows = (table?.rows ?? []).slice(0, 8).map((r) => ({ does: r.slice(1).join(' · '), press: [{ label: r[0].trim(), title: r[0].trim(), kind: 'key' } as Cap] }));
  return { mode: 'Controls', how: zxdbLine(controls, inZxdb), rows, extras: [], note: joystickLine(controls, hands) };
}
