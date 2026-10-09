// Dynamite Dan's play card (src/library/games/dynamite-dan.ts), held to the game: loaded as the page loads it, J at the
// menu and ENTER as its steps say, and the joystick then walks Dan. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/dynamite-dan';
import { chord, fixture, loadGame, responds, runUntil } from './helpers';

const tzx = fixture('game-dynamite-dan.tzx');

describe.skipIf(!tzx)('Dynamite Dan’s card', () => {
  it('takes the Kempston joystick with J, starts with ENTER, and the joystick walks Dan', async () => {
    const e = await loadGame(tzx!, card.model, () => true);
    // The menu: K KEYBOARD, its default, highlighted (flashing) on row 7.
    expect(runUntil(e, (s) => s.attr(7, 12) === 0x82, 12_000)).toBe(true);
    chord(e, ['J'], 10, 10);
    chord(e, ['ENTER'], 10, 300);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
