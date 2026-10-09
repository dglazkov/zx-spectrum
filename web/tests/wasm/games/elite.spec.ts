// Elite's play card (src/library/games/elite.ts), held to the game: loaded on the 128K as the page loads it, N, SPACE
// and 1 as its steps say, out into space, where the key the card puts the up arrow on (S, dive) turns the view. Frames
// are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/elite';
import { chord, fixture, loadGame, responds, run } from './helpers';

const tap = fixture('game-elite.tap');

describe.skipIf(!tap)('Elite’s card', () => {
  it('launches with N, SPACE and 1, and its keymapped dive key flies the ship', async () => {
    const e = await loadGame(tap!, card.model, (s) => s.text.includes('Load New Commander'), 45_000);
    run(e, 300);
    chord(e, ['N'], 60, 100);
    chord(e, ['SPACE'], 30, 200);
    chord(e, ['1'], 30, 500);
    expect(responds(e, { keys: [card.keymap!.UP!] })).toBeGreaterThan(20);
  });
});
