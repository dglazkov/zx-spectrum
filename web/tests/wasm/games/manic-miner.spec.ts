// Manic Miner's play card (src/library/games/manic-miner.ts), held to the game: loaded as the page loads it, ENTER at
// the title as its step says, and the joystick moves Willy with nothing chosen. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/manic-miner';
import { chord, fixture, loadGame, responds, run, runUntil } from './helpers';

const tzx = fixture('game-manic-miner.tzx');

describe.skipIf(!tzx)('Manic Miner’s card', () => {
  it('starts with ENTER at the title, and the joystick walks Willy', async () => {
    const e = await loadGame(tzx!, card.model, () => true);
    expect(runUntil(e, () => !e.tape.state().playing, 20_000)).toBe(true);
    run(e, 150);
    chord(e, ['ENTER'], 10, 100);
    expect(e.screenText()).toContain('Central Cavern');
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
