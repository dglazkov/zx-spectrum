// Batty's play card (src/library/games/batty.ts), held to the game on the WebAssembly machine: its tape loaded as
// the page loads it, played to its end, and the card's steps followed by hand; then the joystick moves the player.
// Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/batty';
import { chord, fixture, loadGame, responds, run, runUntil } from './helpers';

const tape = fixture('game-batty.tzx');

/** The game loaded, its tape played to the end (the deck stopped, nearly all of it behind the head), and a moment more. */
async function loaded(): Promise<WasmEmulator> {
  const e = await loadGame(tape!, card.model, () => true, 10);
  const played = () => {
    const s = e.tape.state();
    return !s.playing && s.position > s.length * 0.9;
  };
  expect(runUntil(e, played, 40_000)).toBe(true);
  run(e, 300);
  return e;
}

describe.skipIf(!tape)('Batty’s card', () => {
  it('A for the Kempston, 0 to start: the joystick moves the bat', async () => {
    const e = await loaded();
    chord(e, ['A'], 6, 40);
    chord(e, ['0'], 6, 300);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(10);
  });
});
