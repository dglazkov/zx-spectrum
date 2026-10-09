// Horace Goes Skiing's play card (src/library/games/horace-goes-skiing.ts), held to the game: loaded as the page loads
// it, a key in the demo and one at each title page as its step says, and its own keys (which the card's key map puts the
// arrows on) then move Horace. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/horace-goes-skiing';
import { chord, fixture, loadGame, responds, run } from './helpers';

const tzx = fixture('game-horace-goes-skiing.tzx');

describe.skipIf(!tzx)('Horace Goes Skiing’s card', () => {
  it('plays after a key in the demo and one at each title page, and Z moves Horace', async () => {
    const e = await loadGame(tzx!, card.model, (s) => s.text.includes('PRESS ANY KEY TO PLAY'));
    // A key stops the demo, and each of the title's pages takes another.
    for (let i = 0; i < 6 && !e.screenText().includes('CASH'); i++) chord(e, ['SPACE'], 6, 100);
    expect(e.screenText()).toContain('CASH');
    run(e, 50);
    expect(responds(e, { keys: [card.keymap!.DOWN!] })).toBeGreaterThan(20);
  });
});
