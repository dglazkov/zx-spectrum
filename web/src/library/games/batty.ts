// Batty (Elite, 1987; first given away on Your Sinclair's Hit Pak): its play card. The words are ours, from the
// instructions Spectrum Computing keeps as text and the game played on this machine, from the shelf's tape (the Hit Pak
// release) on a 48K. At the menu, A changes player 1's controls (KEYBOARD, KEMPSTON, CURSOR, INTERFACE II) and 0 starts;
// web/tests/wasm/games/batty.spec.ts holds that to the game.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0000472',
  title: 'Batty',
  blurb:
    'A brick-breaking bat-and-ball game in the style of Arkanoid. You slide a bat along the bottom of the court and keep a ball bouncing into a wall of blocks, while odd creatures drift down from above to knock the ball off course and bomb your bat. Two can play at once, each with half of the court.',
  goal: 'Knock every block out of the court to move on to the next one, without letting the ball past your bat.',
  tips: [
    'Some blocks take several hits, and some speed the ball up: clear the easy ones first and keep the bat under the ball.',
    'Catch the capsules that fall from broken blocks: a longer bat, a slower ball, a gun, three balls or a rocket to the next level.',
    'The ball destroys the creatures it touches, but their bombs destroy your bat: dodge them while you wait for the ball.',
  ],
  controls: [
    { does: 'Move the bat left', pad: ['LEFT'], keys: ['A'] },
    { does: 'Move the bat right', pad: ['RIGHT'], keys: ['L'] },
    { does: 'Release the ball', pad: ['FIRE'], keys: ['SPACE'] },
  ],
  extras: [
    { key: '1', does: 'Pause (any key on the top row)' },
    { key: 'B', does: 'At the menu: change player 2’s controls' },
    { key: '2', does: 'At the menu: two players, taking turns; 3 for both at once, each with half the court' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    {
      text: 'When the menu shows, press A until KEMPSTON is chosen for player 1 (the arrow keys and Left Alt, a gamepad, or the touch pad), or leave it on KEYBOARD: then the middle row moves the bat (A to G left, H to ENTER right) and the bottom row releases the ball.',
      keys: ['A'],
    },
    { text: 'Press 0 to start the game.', keys: ['0'] },
    { text: 'Press fire to send the ball up from the bat.', keys: [] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/b/Batty.txt' },
    { title: 'Batty in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/472' },
  ],
};
