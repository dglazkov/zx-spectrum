// Batman's play card (src/library/games/batman.ts), held to the game on the WebAssembly machine: its tape loaded as
// the page loads it, played to its end, and the card's steps followed by hand; then the joystick moves the player.
// Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/batman';
import { chord, fixture, loadGame, responds, run, runUntil } from './helpers';

const tape = fixture('game-batman.tzx');

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

describe.skipIf(!tape)('Batman’s card', () => {
  it('ENTER on KEMPSTON JOYSTICK, ENTER on PLAY THE GAME: the joystick moves Batman', async () => {
    const e = await loaded();
    chord(e, ['ENTER'], 6, 200);
    chord(e, ['ENTER'], 6, 900);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(10);
  });
});
