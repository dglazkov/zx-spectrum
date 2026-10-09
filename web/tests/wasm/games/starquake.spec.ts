// Starquake's play card (src/library/games/starquake.ts), held to the game: loaded as the page loads it, 1 at the menu
// and 0 as its steps say, past the crash-landing message, and the joystick then moves BLOB. Frames are counted; nothing
// reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/starquake';
import { chord, fixture, loadGame, responds } from './helpers';

const tzx = fixture('game-starquake.tzx');

describe.skipIf(!tzx)('Starquake’s card', () => {
  it('takes the Kempston joystick with 1, starts with 0, and the joystick moves BLOB', async () => {
    // The menu, framed in cyan: its first line (1. KEMPSTON JOYSTICK) in magenta on row 8.
    const e = await loadGame(tzx!, card.model, (s) => s.attr(8, 4) === 0x43 && s.attr(9, 4) === 0x07 && s.attr(8, 0) === 0x45, 30_000);
    chord(e, ['1'], 10, 10);
    chord(e, ['0'], 10, 700);
    expect(responds(e, { pad: ['LEFT'] })).toBeGreaterThan(20);
  });
});
