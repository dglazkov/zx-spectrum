// The Hobbit's play card (src/library/games/the-hobbit.ts), held to the game: loaded as the page loads it, a key at the
// credits as its step says, and a typed command answered. The game prints in its own font, so the answer is told by
// the screen: the text window (under the picture) changes far more than the echo of the typing alone. Frames are counted.

import { describe, expect, it } from 'vitest';
import type { WasmEmulator } from '../../../src/emulator/wasm';
import { card } from '../../../src/library/games/the-hobbit';
import { chord, fixture, loadGame, run } from './helpers';

const tzx = fixture('game-the-hobbit.tzx');
/** The text window's pixels: character rows 18 to 23 (the picture above goes on being drawn a while). */
const bitmap = (e: WasmEmulator) => Array.from({ length: 2048 }, (_, i) => ((i >> 5) & 7) >= 2 ? e.peek(0x5000 + i) : 0);

describe.skipIf(!tzx)('The Hobbit’s card', () => {
  it('waits at its first place for a command, and answers one', async () => {
    const e = await loadGame(tzx!, card.model, (s) => s.text.includes('Veronika Megler'));
    chord(e, ['SPACE'], 6, 10);
    // The first place is drawn a stroke at a time: the game reads the keys once the picture is done.
    const screen = () => Array.from({ length: 6144 }, (_, i) => e.peek(0x4000 + i)).join();
    let last = '';
    for (let i = 0; i < 40 && screen() !== last; i++) {
      last = screen();
      run(e, 100);
    }
    const before = bitmap(e);
    for (const ch of 'INVENTORY') chord(e, [ch], 4, 10);
    const typed = bitmap(e);
    chord(e, ['ENTER'], 4, 300);
    const answered = bitmap(e);
    const echo = typed.filter((v, i) => v !== before[i]).length;
    const reply = answered.filter((v, i) => v !== typed[i]).length;
    expect(echo).toBeGreaterThan(10);
    expect(reply).toBeGreaterThan(echo);
  });
});
