// Deathchase's play card (src/library/games/deathchase.ts), held to the game: loaded as the page loads it, 2 at its
// first screen as its step says, and the joystick then steers the bike. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/deathchase';
import { chord, fixture, loadGame, responds } from './helpers';

const tzx = fixture('game-deathchase.tzx');

describe.skipIf(!tzx)('Deathchase’s card', () => {
  it('takes the Kempston joystick with 2, which then steers', async () => {
    const e = await loadGame(tzx!, card.model, (s) => s.text.includes('2=KEMPSTON'));
    chord(e, ['2'], 6, 200);
    expect(responds(e, { pad: ['LEFT'] })).toBeGreaterThan(20);
  });
});
