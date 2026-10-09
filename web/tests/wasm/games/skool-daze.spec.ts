// Skool Daze's play card (src/library/games/skool-daze.ts), held to the game: loaded as the page loads it, a key at the
// demo, Y (held) at the names question, K at CONTROL KEYS and ENTER through the cast as its steps say, and the joystick
// then walks Eric. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/skool-daze';
import { chord, fixture, loadGame, responds, run, runUntil } from './helpers';

const tzx = fixture('game-skool-daze.tzx');

describe.skipIf(!tzx)('Skool Daze’s card', () => {
  it('takes the Kempston joystick with K once the names are asked for, and the joystick walks Eric', async () => {
    // The demo: its message (DEMO - PRESS A KEY TO PLAY) in cyan in the red lesson box.
    const e = await loadGame(tzx!, card.model, (s) => s.attr(21, 12) === 0x05 && s.attr(21, 8) === 0x12, 30_000);
    chord(e, ['SPACE'], 6, 6);
    // The questions, on a yellow screen.
    expect(runUntil(e, (s) => s.attr(21, 0) === 0x30, 500)).toBe(true);
    run(e, 150);
    chord(e, ['Y'], 60, 300);
    chord(e, ['K'], 60, 300);
    // The cast walks on one by one, ENTER each, until the school is back (black and yellow in the corner). The beat
    // matters: pressed every 280 frames here, the game came up but never moved, and why was not run down.
    for (let i = 0; i < 30 && e.peek(0x5800 + 21 * 32) !== 0x06; i++) chord(e, ['ENTER'], 30, 256);
    expect(e.peek(0x5800 + 21 * 32)).toBe(0x06);
    run(e, 600);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
