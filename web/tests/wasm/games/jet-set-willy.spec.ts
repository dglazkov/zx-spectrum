// Jet Set Willy's play card (src/library/games/jet-set-willy.ts), held to the game: loaded as the page loads it, its
// route enters the code card's colours for the square asked and starts from the title, and the joystick then walks
// Willy with nothing chosen. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/jet-set-willy';
import { drive, fixture, loadGame, responds, run } from './helpers';

const tzx = fixture('game-jet-set-willy.tzx');

describe.skipIf(!tzx)('Jet Set Willy’s card', () => {
  it('enters the code, starts from the title, and the joystick walks Willy', async () => {
    const e = await loadGame(tzx!, card.model, (s) => card.start.ready(s));
    expect(drive(e, card.start, { joystick: true, skill: 1 })).toBeLessThan(card.start.within);
    expect(e.screenText()).toContain('Items collected');
    run(e, 50);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
