// Bubble Bobble's play card (src/library/games/bubble-bobble.ts), held to the game on the WebAssembly machine in Node as
// the page runs it: the original tape (Firebird's BleepLoad) loaded on a 128K to the control menu, where the route is
// ready (and it is not at BASIC); the route from there, at once or after the menu has waited, choosing the Kempston
// joystick or the keyboard (whose keys it sets), to play, after which the game answers to what was chosen and not to the
// other; the route taking over from a person part-way through the menus, and starting again from the title once a game
// is given up; every control the card names moving Bub, by the joystick and by the keys; and the keys around play doing
// what the card says (pause, carry on, give up, a game for two with Bob on 6, 7, 9 and 0). Frames are counted; nothing
// reads a clock.

import { beforeAll, describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/bubble-bobble';
import { screenOf, type Route } from '../../../src/library/start';
import { chord, drive, fixture, loadGame, machine, padBits, responds, run, runUntil } from './helpers';

const tzx = fixture('game-bubble-bobble.tzx');

/** The machine at the control menu, as the tape leaves it: kept once and put back for each part. */
let menu: Uint8Array;

beforeAll(async () => {
  if (!tzx) return;
  const e = await loadGame(tzx, card.model, (s) => card.start.ready(s), 20_000);
  menu = e.saveState();
});

async function atMenu(): Promise<WasmEmulator> {
  const e = await machine(card.model);
  e.loadState(menu);
  e.joystick('kempston', 0);
  return e;
}

/** How many of the bitmap's bytes `frames` frames change, nothing held. */
function changes(e: WasmEmulator, frames: number): number {
  const bitmap = () => Array.from({ length: 6144 }, (_, i) => e.peek(0x4000 + i));
  const before = bitmap();
  run(e, frames);
  return bitmap().filter((v, i) => v !== before[i]).length;
}

/** Walking right, by what was chosen, for a moment: Bub away from the wall he starts against. */
function stepRight(e: WasmEmulator, joystick: boolean): void {
  if (joystick) {
    e.joystick('kempston', padBits(['RIGHT']));
    run(e, 25);
    e.joystick('kempston', 0);
  } else chord(e, ['P'], 25, 0);
  run(e, 2);
}

/** The route as far as the title: what drives it once the menus are behind. */
const toTitle: Route = {
  ...card.start,
  next(screen, choice) {
    const m = card.start.next(screen, choice);
    return 'press' in m && m.press === '1' && !screen.text.includes('LICENSED') ? { done: true } : m;
  },
};

describe.skipIf(!tzx)('Bubble Bobble’s card', () => {
  it('loads to its control menu, where the route is ready, and is not ready at BASIC', async () => {
    const e = await atMenu();
    expect(e.screenText()).toContain('LICENSED BY FIREBIRD SOFTWARE');
    expect(card.start.ready(screenOf(e))).toBe(true);
    for (const model of ['48k', '128k'] as const) {
      const basic = await machine(model);
      run(basic, 150);
      expect(card.start.ready(screenOf(basic))).toBe(false);
    }
  });

  for (const [delay, joystick] of [[0, true], [0, false], [1, false], [37, true], [600, false], [3000, true]] as const) {
    it(`starts from the control menu after ${delay} frames, to play with the ${joystick ? 'Kempston joystick' : 'keyboard'}`, async () => {
      const e = await atMenu();
      run(e, delay);
      const took = drive(e, card.start, { joystick, skill: 1 });
      expect(took).toBeLessThan(card.start.within);
      expect(e.screenText().split('\n')[0]).toContain('HIGH SCORE');
      // Bub is the player's at once, by what was chosen and not by the other.
      const byJoystick = responds(e, { pad: ['RIGHT'] }, 25);
      const byKeys = responds(e, { keys: ['P'] }, 25);
      if (joystick) {
        expect(byJoystick).toBeGreaterThan(20);
        expect(byKeys).toBe(0);
      } else {
        expect(byKeys).toBeGreaterThan(20);
        expect(byJoystick).toBe(0);
      }
    });
  }

  it('takes over part-way: a key already given, or player 1 already chosen by hand', async () => {
    // LEFT given as O by hand: the route asks the rest.
    const e = await atMenu();
    chord(e, ['1'], 4, 30);
    chord(e, ['O'], 4, 30);
    drive(e, card.start, { joystick: false, skill: 1 });
    expect(responds(e, { keys: ['P'] }, 25)).toBeGreaterThan(20);
    // The Kempston chosen for player 1 by hand: the route chooses for player 2 and goes on.
    const f = await atMenu();
    chord(f, ['3'], 4, 30);
    expect(card.start.ready(screenOf(f))).toBe(true);
    drive(f, card.start, { joystick: true, skill: 1 });
    expect(responds(f, { pad: ['RIGHT'] }, 25)).toBeGreaterThan(20);
  });

  for (const joystick of [true, false]) {
    it(`moves Bub with every control it names, by the ${joystick ? 'joystick' : 'keys'}`, async () => {
      const e = await atMenu();
      drive(e, card.start, { joystick, skill: 1 });
      stepRight(e, joystick);
      const quiet: string[] = [];
      for (const c of card.controls) {
        const input = joystick ? { pad: c.pad ?? undefined } : { keys: c.keys ?? undefined };
        if (!input.pad && !input.keys) continue;
        const n = responds(e, input, 25);
        if (n <= 20) quiet.push(`${c.does}: ${n}`);
      }
      expect(quiet).toEqual([]);
    });
  }

  it('pauses on SYMBOL SHIFT and carries on with CAPS SHIFT; BREAK gives up, and the route starts again from the title', async () => {
    const e = await atMenu();
    drive(e, card.start, { joystick: true, skill: 1 });
    // The keys around play are read once the round is under way, after its monsters have dropped in.
    run(e, 250);
    chord(e, ['SYMBOL SHIFT'], 5, 5);
    expect(changes(e, 50)).toBe(0);
    chord(e, ['CAPS SHIFT'], 5, 0);
    expect(changes(e, 50)).toBeGreaterThan(20);
    chord(e, ['CAPS SHIFT', 'SPACE'], 5, 0);
    expect(runUntil(e, (s) => card.start.ready(s), 600)).toBe(true);
    expect(card.start.next(screenOf(e), { joystick: true, skill: 1 })).toMatchObject({ press: '1' });
    // The title waits; from it, a while later, the route starts a game with the joystick as chosen before.
    run(e, 1000);
    drive(e, card.start, { joystick: true, skill: 1 });
    expect(responds(e, { pad: ['RIGHT'] }, 25)).toBeGreaterThan(20);
  });

  it('plays two at once from the title’s 2, Bob on the Sinclair joystick’s keys the route chose for player 2', async () => {
    const e = await atMenu();
    drive(e, toTitle, { joystick: true, skill: 1 });
    chord(e, ['2'], 4, 150);
    expect(e.screenText().split('\n')[0]).toContain('2UP');
    const bob = Object.fromEntries(['6', '7', '9', '0'].map((k) => [k, responds(e, { keys: [k] }, 25)]));
    expect(Object.values(bob).every((n) => n > 20), JSON.stringify(bob)).toBe(true);
    expect(responds(e, { pad: ['RIGHT'] }, 25)).toBeGreaterThan(20);
  });
});
