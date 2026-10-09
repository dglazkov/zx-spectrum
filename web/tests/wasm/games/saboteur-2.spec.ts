// Saboteur II's play card (src/library/games/saboteur-2.ts), held to the game: loaded on the 128K as the page loads it,
// a key at the REWARD screen, J and S at the menu and a key after the briefing as its steps say, fire to drop from the
// hang-glider, and the joystick then walks the ninja. Frames are counted; nothing reads a clock.

import { describe, expect, it } from 'vitest';
import { card } from '../../../src/library/games/saboteur-2';
import { chord, fixture, loadGame, responds, run } from './helpers';

const tap = fixture('game-saboteur-2.tap');

describe.skipIf(!tap)('Saboteur II’s card', () => {
  it('takes the Kempston joystick with J, starts with S, and the joystick walks the ninja once she lands', async () => {
    const e = await loadGame(tap!, card.model, (s) => s.text.includes('PRESS ANY KEY TO CONTINUE'), 30_000);
    chord(e, ['SPACE'], 8, 300);
    chord(e, ['J'], 10, 20);
    chord(e, ['S'], 10, 300);
    chord(e, ['SPACE'], 10, 400);
    e.joystick('kempston', 16);
    run(e, 10);
    e.joystick('kempston', 0);
    run(e, 700);
    expect(responds(e, { pad: ['RIGHT'] })).toBeGreaterThan(20);
  });
});
