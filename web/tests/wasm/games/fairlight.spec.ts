// Fairlight's play card (src/library/games/fairlight.ts), held to the game: loaded as the page loads it, ENTER at the
// title and at the keys screen, then 9 in play as its steps say, and the joystick then walks Isvar. Frames are counted;
// nothing reads a clock.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/fairlight';
import { chord, fixture, loadGame, responds, runUntil } from './helpers';

const tzx = fixture('game-fairlight.tzx');

const loaded = (e: WasmEmulator) => e.tape.state().block >= e.tape.blocks().length;

describe.skipIf(!tzx)('Fairlight’s card', () => {
  it('starts with ENTER twice, takes the joystick with 9, and the joystick walks Isvar', async () => {
    const e = await loadGame(tzx!, card.model, () => true);
    expect(runUntil(e, () => loaded(e), 20_000)).toBe(true);
    chord(e, ['ENTER'], 10, 300);
    chord(e, ['ENTER'], 10, 300);
    chord(e, ['9'], 10, 100);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
