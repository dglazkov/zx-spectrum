// Saboteur's start route (src/library/start.ts), driven on the WebAssembly machine in Node as the page drives it: from
// the £100 REWARD screen, pressed at once or after a while (the high scores time out and move on), choosing the
// keyboard or the Kempston joystick, to the mission; and the game then answers to what was chosen: M moves the ninja
// with the keyboard and the joystick does not, and the other way round. Frames are counted; nothing reads a clock.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { WasmEmulator, type ZxExports } from '../../src/emulator/wasm';
import { SABOTEUR, StartPilot, screenOf, type StartChoice } from '../../src/library/start';
import { KEY } from '../../src/emulator/keys';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
let module: WebAssembly.Module;

function fixture(name: string): string | null {
  try {
    const path = execFileSync(`${repo}scripts/fixture`, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const tzx = fixture('saboteur.tzx');

/** The machine at the REWARD screen, kept once and put back for each part. */
let reward: Uint8Array;

beforeAll(async () => {
  module = await WebAssembly.compile(readFileSync(`${repo}web/src/emulator/zx.wasm`));
  if (tzx) reward = (await loadedToReward()).saveState();
});

async function machine(): Promise<WasmEmulator> {
  const instance = await WebAssembly.instantiate(module, {});
  return new WasmEmulator(instance.exports as unknown as ZxExports);
}

const run = (e: WasmEmulator, n: number) => {
  for (let i = 0; i < n; i++) e.runFrame();
};

/** Saboteur loaded at once (the ROM trap, its turbo blocks played), to its REWARD screen. */
async function loadedToReward(): Promise<WasmEmulator> {
  const e = await machine();
  e.setOptions({ instantLoad: true, autoTape: true });
  e.load(readFileSync(tzx!), 'saboteur.tzx');
  run(e, 100);
  for (const chord of [[KEY.J], [KEY['SYMBOL SHIFT'], KEY.P], [KEY['SYMBOL SHIFT'], KEY.P], [KEY.ENTER]]) {
    for (const k of chord) e.key(k, true);
    run(e, 4);
    for (const k of chord) e.key(k, false);
    run(e, 6);
  }
  for (let f = 0; f < 12_000 && !e.screenText().includes('PRESS ANY KEY TO CONTINUE'); f++) e.runFrame();
  expect(e.screenText()).toContain('REWARD');
  return e;
}

/** A machine at the REWARD screen, Saboteur's tape in its deck. */
async function atReward(): Promise<WasmEmulator> {
  const e = await machine();
  e.load(readFileSync(tzx!), 'saboteur.tzx');
  e.loadState(reward);
  return e;
}

/** The pilot driven to its end: the frames it took. */
function drive(e: WasmEmulator, choice: StartChoice): number {
  const pilot = new StartPilot(SABOTEUR, choice, e.frameCount);
  const from = e.frameCount;
  const ups: { code: number; at: number }[] = [];
  while (pilot.state === 'driving') {
    const f = e.frameCount;
    for (const u of ups.filter((u) => u.at <= f)) e.key(u.code, false);
    ups.splice(0, ups.length, ...ups.filter((u) => u.at > f));
    const press = pilot.tick(f, () => screenOf(e));
    if (press) {
      e.key(press.code, true);
      ups.push({ code: press.code, at: press.until });
    }
    e.runFrame();
  }
  for (const u of ups) e.key(u.code, false);
  expect(pilot.state).toBe('done');
  return e.frameCount - from;
}

/** How many bytes of the screen's bitmap change over 50 frames with `input` held, against none. */
function moves(e: WasmEmulator, input: 'M' | 'joystick'): number {
  const state = e.saveState();
  const bitmap = () => Array.from({ length: 6144 }, (_, i) => e.peek(0x4000 + i));
  const before = bitmap();
  run(e, 50);
  const idle = bitmap();
  e.loadState(state);
  if (input === 'M') e.key(KEY.M, true);
  else e.joystick('kempston', 1);
  run(e, 50);
  const held = bitmap();
  e.key(KEY.M, false);
  e.joystick('kempston', 0);
  e.loadState(state);
  const differ = (a: number[], b: number[]) => a.filter((v, i) => v !== b[i]).length;
  return differ(before, held) - differ(before, idle);
}

describe.skipIf(!tzx)('Saboteur’s start route', () => {
  for (const [delay, joystick] of [[0, false], [0, true], [37, false], [150, true], [400, false], [2500, true]] as const) {
    it(`from the REWARD screen after ${delay} frames, to the mission with the ${joystick ? 'Kempston joystick' : 'keyboard'}`, async () => {
      const e = await atReward();
      e.joystick('kempston', 0);
      run(e, delay);
      const took = drive(e, { joystick, skill: 1 });
      expect(took).toBeLessThan(SABOTEUR.within);
      // The opening: the ninja in his dinghy, then his to move.
      run(e, 400);
      const byKeys = moves(e, 'M');
      const byJoystick = moves(e, 'joystick');
      if (joystick) {
        expect(byJoystick).toBeGreaterThan(20);
        expect(byKeys).toBe(0);
      } else {
        expect(byKeys).toBeGreaterThan(20);
        expect(byJoystick).toBe(0);
      }
    });
  }

  it('is ready at the REWARD screen and not at BASIC', async () => {
    const e = await atReward();
    expect(SABOTEUR.ready(screenOf(e))).toBe(true);
    const basic = await machine();
    run(basic, 150);
    expect(SABOTEUR.ready(screenOf(basic))).toBe(false);
  });
});
