// Saboteur's play card (src/library/games/saboteur.ts), held to the game on the WebAssembly machine in Node as the page
// runs it: its start route from the £100 REWARD screen, pressed at once or after a while (the high scores time out and
// move on), choosing the keyboard or the Kempston joystick, to the mission; the game then answers to what was chosen (M
// moves the ninja with the keyboard and the joystick does not, and the other way round); and every control the card
// names moves the ninja, by the joystick and by the keys. Frames are counted; nothing reads a clock.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/saboteur';
import { screenOf } from '../../../src/library/start';
import { drive, fixture, loadGame, machine, responds, run } from './helpers';

const tzx = fixture('saboteur.tzx');

/** The machine at the REWARD screen, kept once and put back for each part. */
let reward: Uint8Array;

beforeAll(async () => {
  if (!tzx) return;
  const e = await loadGame(tzx, card.model, (s) => card.start.ready(s), 12_000);
  expect(e.screenText()).toContain('REWARD');
  reward = e.saveState();
});

/** A machine at the REWARD screen, Saboteur's tape in its deck. */
async function atReward(): Promise<WasmEmulator> {
  const e = await machine(card.model);
  e.load(readFileSync(tzx!), 'saboteur.tzx');
  e.loadState(reward);
  e.joystick('kempston', 0);
  return e;
}

describe.skipIf(!tzx)('Saboteur’s card', () => {
  for (const [delay, joystick] of [[0, false], [0, true], [37, false], [150, true], [400, false], [2500, true]] as const) {
    it(`starts from the REWARD screen after ${delay} frames, to the mission with the ${joystick ? 'Kempston joystick' : 'keyboard'}`, async () => {
      const e = await atReward();
      run(e, delay);
      const took = drive(e, card.start, { joystick, skill: 1 });
      expect(took).toBeLessThan(card.start.within);
      // The opening: the ninja in his dinghy, then his to move, by what was chosen and not by the other.
      run(e, 400);
      const byKeys = responds(e, { keys: ['M'] });
      const byJoystick = responds(e, { pad: ['RIGHT'] });
      if (joystick) {
        expect(byJoystick).toBeGreaterThan(20);
        expect(byKeys).toBe(0);
      } else {
        expect(byKeys).toBeGreaterThan(20);
        expect(byJoystick).toBe(0);
      }
    });
  }

  for (const joystick of [true, false]) {
    it(`moves the ninja with every control it names, by the ${joystick ? 'joystick' : 'keys'}`, async () => {
      const e = await atReward();
      drive(e, card.start, { joystick, skill: 1 });
      run(e, 400);
      const quiet: string[] = [];
      for (const c of card.controls) {
        const input = joystick ? { pad: c.pad ?? undefined } : { keys: c.keys ?? undefined };
        if (!input.pad && !input.keys) continue;
        const n = responds(e, input);
        if (n <= 20) quiet.push(`${c.does}: ${n}`);
      }
      expect(quiet).toEqual([]);
    });
  }

  it('is ready at the REWARD screen and not at BASIC', async () => {
    const e = await atReward();
    expect(card.start.ready(screenOf(e))).toBe(true);
    const basic = await machine(card.model);
    run(basic, 150);
    expect(card.start.ready(screenOf(basic))).toBe(false);
  });
});
