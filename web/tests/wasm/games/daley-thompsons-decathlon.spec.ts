// Daley Thompson’s Decathlon's play card (src/library/games/daley-thompsons-decathlon.ts), held to the game on the WebAssembly machine: its tape loaded as
// the page loads it, played to its end, and the card's steps followed by hand; then the joystick moves the player.
// Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/daley-thompsons-decathlon';
import { chord, fixture, loadGame, padBits, responds, run, runUntil } from './helpers';

const tape = fixture('game-daley-thompsons-decathlon.tzx');

/** Fire on the Kempston joystick, held for a moment and let go. */
function fire(e: WasmEmulator): void {
  e.joystick('kempston', padBits(['FIRE']));
  run(e, 20);
  e.joystick('kempston', 0);
  run(e, 40);
}

/** The game loaded, its tape played to the end (the deck stopped, nearly all of it behind the head), and a moment more. */
async function loaded(): Promise<WasmEmulator> {
  const e = await loadGame(tape!, card.model, () => true, 10);
  const played = () => {
    const s = e.tape.state();
    return !s.playing && s.position > s.length * 0.9;
  };
  expect(runUntil(e, played, 40_000)).toBe(true);
  run(e, 600);
  return e;
}

describe.skipIf(!tape)('Daley Thompson’s Decathlon’s card', () => {
  it('2 for the Kempston, three letters of a name by fire: the joystick runs the 100 metres', async () => {
    const e = await loaded();
    chord(e, ['2'], 10, 50);
    for (let i = 0; i < 3; i++) fire(e);
    run(e, 600);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(10);
  });
});
