// Ant Attack's play card (src/library/games/ant-attack.ts), held to the game: loaded as the page loads it, G at Girl or
// Boy and a key after the story as its steps say, and the key the card puts the up arrow on (V) then walks forward.
// Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/ant-attack';
import { chord, fixture, loadGame, responds } from './helpers';

const tzx = fixture('game-ant-attack.tzx');

describe.skipIf(!tzx)('Ant Attack’s card', () => {
  it('starts with G and a key, and its keymapped forward key walks', async () => {
    const e = await loadGame(tzx!, card.model, (s) => s.text.includes('Girl or Boy'), 45_000);
    chord(e, ['G'], 6, 300);
    chord(e, ['SPACE'], 6, 300);
    expect(responds(e, { keys: [card.keymap!.UP!] })).toBeGreaterThan(20);
  });
});
