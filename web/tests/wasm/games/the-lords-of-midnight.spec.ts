// The Lords of Midnight's play card (src/library/games/the-lords-of-midnight.ts), held to the game: loaded as the page
// loads it, it waits for Luxor's orders, and a key from its step (3: look east) redraws the view. Frames are counted.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/the-lords-of-midnight';
import { fixture, loadGame, responds, run, runUntil } from './helpers';

const tzx = fixture('game-the-lords-of-midnight.tzx');

describe.skipIf(!tzx)('The Lords of Midnight’s card', () => {
  it('answers a look to the east as soon as it has loaded', async () => {
    const e = await loadGame(tzx!, card.model, () => true);
    expect(runUntil(e, () => !e.tape.state().playing, 20_000)).toBe(true);
    run(e, 200);
    expect(responds(e, { keys: ['3'] }, 100)).toBeGreaterThan(100);
  });
});
