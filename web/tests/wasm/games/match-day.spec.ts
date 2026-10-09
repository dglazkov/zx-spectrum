// Match Day's play card (src/library/games/match-day.ts), held to the game: loaded as the page loads it, a key at the
// title, ENTER for the one player game and ENTER on Kick Off as its steps say; once the teams have lined up, fire on
// the joystick (player 1's from the start) kicks off. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/match-day';
import { chord, fixture, loadGame, responds, run, runUntil } from './helpers';

const tzx = fixture('game-match-day.tzx');

/** Whether the tape has played to its end (the title is the loading screen, which waits for a key). */
const loaded = (e: WasmEmulator) => e.tape.state().block >= e.tape.blocks().length;

describe.skipIf(!tzx)('Match Day’s card', () => {
  it('kicks off with the joystick’s fire, player 1 being on the Kempston joystick', async () => {
    const e = await loadGame(tzx!, card.model, () => true);
    expect(runUntil(e, () => loaded(e), 20_000)).toBe(true);
    run(e, 300);
    chord(e, ['ENTER'], 10, 1200);
    chord(e, ['ENTER'], 10, 300);
    chord(e, ['ENTER'], 10, 10);
    // The teams walk out and line up, and a player takes the ball to the spot.
    run(e, 2700);
    expect(responds(e, { pad: ['FIRE'] }, 100)).toBeGreaterThan(20);
  });
});
