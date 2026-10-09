// Target: Renegade's play card (src/library/games/target-renegade.ts), held to the game on the WebAssembly machine in
// Node as the page runs it: the file and the machine the shelf loads it on; the tape loaded to its menu, where the route
// is ready (and not at the 128's own menu, nor on the loading screen); the route from the menu or the high scores, at
// once or after a while, or from the control options, to play with the keyboard or the Kempston joystick, even when the
// game was left on the other;
// the game then answering to what was chosen and not to the other; every control the card names moving the fighter, by
// the joystick and by the keys; and S pausing. Frames are counted; nothing reads a clock.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { choose } from '../../../src/library/choose';
import featured from '../../../src/library/featured.json';
import { card } from '../../../src/library/games/target-renegade';
import { screenOf } from '../../../src/library/start';
import { entryOf, type ZxHit } from '../../../src/library/zxinfo';
import { chord, drive, fixture, loadGame, machine, responds, run } from './helpers';

const tap = fixture('game-target-renegade.tap');

/** The machine at the menu, the first screen after the tape has loaded, kept once and put back for each part. */
let menu: Uint8Array;

beforeAll(async () => {
  if (!tap) return;
  // loadGame stops at the first screen the route is ready on, looking every 10 frames: the loading screen shows for
  // some 40 frames while the tape loads, and it stops after it, at the menu.
  const e = await loadGame(tap, card.model, (s) => card.start.ready(s), 3_000);
  expect(inkRow(e, 12)).toBe('        #  ####### #######'); // 3  CONTROL OPTIONS
  menu = e.saveState();
});

/** A row of the screen's ink: '#' where a cell has anything in it. */
function inkRow(e: WasmEmulator, row: number): string {
  return e.screenText().split('\n')[row].replace(/[^ ]/g, '#').trimEnd();
}

/** A machine at the menu, the game's tape in its deck and the Kempston interface plugged in, its stick at rest. */
async function atMenu(): Promise<WasmEmulator> {
  const e = await machine(card.model);
  e.load(readFileSync(tap!), 'game-target-renegade.tap');
  e.loadState(menu);
  e.joystick('kempston', 0);
  return e;
}

/** After the game has begun: the fighter is his to move about a second and a half later, and the first biker reaches him about five seconds in. */
const SETTLE = 100;

/** How much the screen answers in 20 frames: long enough for a move to show, short enough that a punch is still out. */
const answer = (e: WasmEmulator, input: Parameters<typeof responds>[1]) => responds(e, input, 20);

describe('Target: Renegade’s shelf file', () => {
  it('is the 128K tape, loaded on the 128K the card was proved on', () => {
    const hit = (featured.entries as ZxHit[]).find((h) => h._id === card.id);
    expect(hit, 'the shelf has the entry').toBeDefined();
    const c = choose(entryOf(hit!));
    expect(c.file.path).toBe('/pub/sinclair/games/t/Target-Renegade128.tap.zip'); // RENGADE2.TAP, fixtures.txt's game-target-renegade.tap
    expect(c.model).toBe(card.model);
  });
});

describe.skipIf(!tap)('Target: Renegade’s card', () => {
  // The menu shows for about 770 frames, then the high scores as long, and round again: 760 presses as the menu gives
  // way, 1534 as the scores do.
  for (const [delay, joystick] of [[0, false], [0, true], [37, true], [400, false], [760, true], [900, false], [1300, true], [1534, false]] as const) {
    it(`starts after ${delay} frames at the menu, to play with the ${joystick ? 'Kempston joystick' : 'keyboard'}`, async () => {
      const e = await atMenu();
      run(e, delay);
      const took = drive(e, card.start, { joystick, skill: 1 });
      expect(took).toBeLessThan(card.start.within);
      // The game answers to what was chosen, and not to the other.
      run(e, SETTLE);
      const byKeys = answer(e, { keys: ['L'] });
      const byJoystick = answer(e, { pad: ['RIGHT'] });
      if (joystick) {
        expect(byJoystick).toBeGreaterThan(20);
        expect(byKeys).toBe(0);
      } else {
        expect(byKeys).toBeGreaterThan(20);
        expect(byJoystick).toBe(0);
      }
    });
  }

  // Started where a person left the control options: at player 1's, or at player 2's after choosing SINCLAIR 1 for
  // player 1 (which the route then sets again, as the menu cannot show what was chosen).
  for (const [keys, joystick] of [[['3'], true], [['3', '2'], false], [['3', '2'], true]] as const) {
    it(`starts from PLAYER ${keys.length} OPTIONS, to play with the ${joystick ? 'Kempston joystick' : 'keyboard'}`, async () => {
      const e = await atMenu();
      for (const key of keys) chord(e, [key], 6, 20);
      expect(card.start.ready(screenOf(e))).toBe(true);
      drive(e, card.start, { joystick, skill: 1 });
      run(e, SETTLE);
      expect(answer(e, joystick ? { pad: ['RIGHT'] } : { keys: ['L'] })).toBeGreaterThan(20);
      expect(answer(e, joystick ? { keys: ['L'] } : { pad: ['RIGHT'] })).toBe(0);
    });
  }

  it('sets the keyboard back when the game was left on the Kempston joystick', async () => {
    const e = await atMenu();
    for (const key of ['3', '3', '1']) chord(e, [key], 6, 20); // CONTROL OPTIONS, player 1 KEMPSTON, player 2 KEYBOARD
    drive(e, card.start, { joystick: false, skill: 1 });
    run(e, SETTLE);
    expect(answer(e, { keys: ['L'] })).toBeGreaterThan(20);
    expect(answer(e, { pad: ['RIGHT'] })).toBe(0);
  });

  for (const joystick of [true, false]) {
    it(`moves the fighter with every control it names, by the ${joystick ? 'joystick' : 'keys'}`, async () => {
      const e = await atMenu();
      drive(e, card.start, { joystick, skill: 1 });
      run(e, SETTLE);
      const quiet: string[] = [];
      for (const c of card.controls) {
        const input = joystick ? { pad: c.pad ?? undefined } : { keys: c.keys ?? undefined };
        if (!input.pad && !input.keys) continue;
        const n = answer(e, input);
        if (n <= 20) quiet.push(`${c.does}: ${n}`);
      }
      expect(quiet).toEqual([]);
    });
  }

  it('pauses on S, and any other key carries on', async () => {
    const e = await atMenu();
    drive(e, card.start, { joystick: true, skill: 1 });
    run(e, SETTLE);
    const bitmap = () => Array.from({ length: 6912 }, (_, i) => e.peek(0x4000 + i));
    chord(e, ['S'], 5, 10);
    const paused = bitmap();
    run(e, 100);
    expect(bitmap()).toEqual(paused); // the clock and everyone in the street stopped
    chord(e, ['SPACE'], 5, 10);
    run(e, 100);
    expect(bitmap()).not.toEqual(paused);
  });

  it('is ready at the menu and the high scores, and not at the 128’s own menu', async () => {
    const e = await atMenu();
    expect(card.start.ready(screenOf(e))).toBe(true);
    run(e, 900); // the high scores
    expect(inkRow(e, 8)).toMatch(/^ {8}#{3,6} +######$/);
    expect(card.start.ready(screenOf(e))).toBe(true);
    const basic = await machine(card.model);
    run(basic, 150);
    expect(basic.screenText()).toContain('Tape Loader');
    expect(card.start.ready(screenOf(basic))).toBe(false);
  });
});
