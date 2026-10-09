// What every play card's test needs (one spec a game, beside this file): the game loaded from its own tape on the
// WebAssembly machine in Node, as the page loads it; its card's start route driven as the page drives it; and the
// question every control must answer: does holding it move the player? Frames are counted; nothing reads a clock.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { KEY } from '../../../src/emulator/keys';
import { WasmEmulator, type ZxExports } from '../../../src/emulator/wasm';
import type { Pad } from '../../../src/library/card';
import { StartPilot, screenOf, type Route, type Screen, type StartChoice } from '../../../src/library/start';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
let compiled: WebAssembly.Module | null = null;

/** A fixture's path (scripts/fixture fetches it once), or null where it cannot be had: the spec skips. */
export function fixture(name: string): string | null {
  try {
    const path = execFileSync(`${repo}scripts/fixture`, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/** A fresh machine of the model asked for, powered on. */
export async function machine(model: '48k' | '128k'): Promise<WasmEmulator> {
  compiled ??= await WebAssembly.compile(readFileSync(`${repo}web/src/emulator/zx.wasm`));
  const instance = await WebAssembly.instantiate(compiled, {});
  const e = new WasmEmulator(instance.exports as unknown as ZxExports);
  e.setModel(model);
  e.setSound(false);
  return e;
}

export function run(e: WasmEmulator, frames: number): void {
  for (let i = 0; i < frames; i++) e.runFrame();
}

/** Runs until `done` says so, at most `max` frames; whether it did. */
export function runUntil(e: WasmEmulator, done: (screen: Screen) => boolean, max: number): boolean {
  for (let f = 0; f < max; f++) {
    if (f % 10 === 0 && done(screenOf(e))) return true;
    e.runFrame();
  }
  return done(screenOf(e));
}

/** Presses the keys together for a few frames and lets go. */
export function chord(e: WasmEmulator, keys: readonly string[], hold = 4, after = 6): void {
  for (const k of keys) e.key(KEY[k], true);
  run(e, hold);
  for (const k of keys) e.key(KEY[k], false);
  run(e, after);
}

/**
 * The game's tape loaded as the page loads it: instant loading (the ROM's blocks at once, the rest played), the deck
 * started by the machine; LOAD "" typed on a 48K, Tape Loader chosen on a 128K. Runs until `ready` (a card's
 * start.ready, say) holds, at most `max` frames, and fails the test if it never does.
 */
export async function loadGame(path: string, model: '48k' | '128k', ready: (screen: Screen) => boolean, max = 30_000): Promise<WasmEmulator> {
  const e = await machine(model);
  e.setOptions({ instantLoad: true, autoTape: true });
  e.load(readFileSync(path), path.split('/').pop()!);
  if (model === '48k') {
    expect(runUntil(e, (s) => s.text.includes('Sinclair Research'), 400)).toBe(true);
    for (const keys of [['J'], ['SYMBOL SHIFT', 'P'], ['SYMBOL SHIFT', 'P'], ['ENTER']]) chord(e, keys);
  } else {
    expect(runUntil(e, (s) => s.text.includes('Tape Loader'), 400)).toBe(true);
    chord(e, ['ENTER']);
  }
  e.joystick('kempston', 0);
  expect(runUntil(e, ready, max)).toBe(true);
  return e;
}

/** A card's route driven to its end as the page drives it; the frames it took. Fails the test if it gives up. */
export function drive(e: WasmEmulator, route: Route, choice: StartChoice): number {
  const pilot = new StartPilot(route, choice, e.frameCount);
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

const BITS: Record<Pad, number> = { RIGHT: 1, LEFT: 2, DOWN: 4, UP: 8, FIRE: 16 };

/** The Kempston joystick's bits for directions and fire held together. */
export function padBits(pad: readonly Pad[]): number {
  return pad.reduce((bits, p) => bits | BITS[p], 0);
}

/**
 * Whether holding `input` (joystick directions and fire, or the game's keys) for `frames` frames changes the game, from
 * one moment kept and put back: how many bytes of the screen's bitmap end up different with it held, against the same
 * frames with nothing held. More than a handful means the game answered. The machine is left as it was.
 */
export function responds(e: WasmEmulator, input: { pad?: readonly Pad[]; keys?: readonly string[] }, frames = 50): number {
  const kept = e.saveState();
  const bitmap = () => Array.from({ length: 6144 }, (_, i) => e.peek(0x4000 + i));
  run(e, frames);
  const idle = bitmap();
  e.loadState(kept);
  if (input.pad) e.joystick('kempston', padBits(input.pad));
  for (const k of input.keys ?? []) e.key(KEY[k], true);
  run(e, frames);
  const held = bitmap();
  e.joystick('kempston', 0);
  for (const k of input.keys ?? []) e.key(KEY[k], false);
  e.loadState(kept);
  return held.filter((v, i) => v !== idle[i]).length;
}
