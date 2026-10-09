// Head over Heels' play card (src/library/games/head-over-heels.ts), held to the game: loaded on the 128K as the page
// loads it, ENTER on KEMPSTON JOYSTICK and ENTER on PLAY THE GAME as its steps say, past the map of the empire, and the
// joystick then walks Head. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/head-over-heels';
import { chord, fixture, loadGame, responds, run, runUntil } from './helpers';

const tzx = fixture('game-head-over-heels.tzx');

const loaded = (e: WasmEmulator) => e.tape.state().block >= e.tape.blocks().length;

describe.skipIf(!tzx)('Head over Heels’ card', () => {
  it('takes the Kempston joystick at SELECT JOYSTICK, plays from the menu, and the joystick walks Head', async () => {
    const e = await loadGame(tzx!, card.model, () => true);
    expect(runUntil(e, () => loaded(e), 20_000)).toBe(true);
    run(e, 300);
    chord(e, ['ENTER'], 10, 200);
    chord(e, ['ENTER'], 10, 1600);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
