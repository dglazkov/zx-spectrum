// Arkanoid (Imagine, 1987; Taito's 1986 arcade game): its play card. The words are ours, from Imagine's instructions
// (Spectrum Computing keeps them as text) and the game played on this machine, from the original tape on a 48K. There
// is no menu: the game reads the Kempston joystick and the keyboard both. Its title shows the high scores; a key goes to
// the story, and another key or fire there starts round 1, the ball waiting on the Vaus.
// web/tests/wasm/games/arkanoid.spec.ts holds that to the game.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0000255',
  title: 'Arkanoid',
  blurb:
    'The arcade bat-and-ball classic. You steer the Vaus, a little craft at the foot of the screen, and bounce an energy ball into walls of coloured bricks, catching the capsules that fall from some of them for lasers, longer bats and extra balls.',
  goal: 'Clear all thirty-two rounds of bricks, then defeat the Dimension Changer waiting at the end.',
  tips: [
    'Hit the ball with the edge of the Vaus for a sharper angle, to reach awkward corners.',
    'Silver and gold bricks take several hits or none at all: the L capsule’s laser saves time on them.',
    'D splits the ball in three, C lets you catch it and aim, and B opens a door to the next round.',
  ],
  controls: [
    { does: 'Move left', pad: ['LEFT'], keys: ['V'] },
    { does: 'Move right', pad: ['RIGHT'], keys: ['B'] },
    { does: 'Launch the ball, or fire the laser', pad: ['FIRE'], keys: ['A'] },
  ],
  extras: [
    { key: 'CAPS SHIFT', does: 'Also left: any key from CAPS SHIFT to V' },
    { key: 'SPACE', does: 'Also right: any key from B to SPACE' },
    { key: 'L', does: 'Also fire: any key from A to L' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the high scores press any key (SPACE, say) to see the story of the Vaus.', keys: ['SPACE'] },
    {
      text: 'Press fire, or a key, to start round 1 (the story may need a second press). The Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad) and the keys both work: there is nothing to choose. Fire launches the ball.',
      keys: ['SPACE'],
    },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/a/Arkanoid.txt' },
    { title: 'Arkanoid in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/255' },
  ],
};
