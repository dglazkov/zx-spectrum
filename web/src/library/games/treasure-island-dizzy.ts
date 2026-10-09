// Treasure Island Dizzy (Codemasters, 1989; the Oliver Twins): its play card. The words are ours, from the
// instructions (Spectrum Computing keeps them as text) and the game played on this machine, from the original tape on a
// 128K. The title says to press ENTER, fire, or K for the Kempston; web/tests/wasm/games/treasure-island-dizzy.spec.ts
// holds that K starts the game with the joystick.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0009333',
  title: 'Treasure Island Dizzy',
  blurb:
    'Dizzy the egg has been made to walk the plank and washes up on a desert island. A gentle puzzle adventure: explore the island and the sea bed, pick up the things you find and work out where each one is needed.',
  goal: 'Find a way off the island and back to the Yolkfolk. For the full ending, find all thirty gold coins hidden on the way.',
  tips: [
    'Dizzy has only one life: water, fire and the wildlife all finish him, so look before you leap.',
    'You can carry a few things at once; the oldest is dropped when you pick up another, so plan what you hold.',
    'If something is out of reach, look for an object to stand on or use.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['Z'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['X'] },
    { does: 'Jump (with left or right, jump that way)', pad: ['UP'], keys: ['SPACE'] },
    { does: 'Pick up, drop or use', pad: ['FIRE'], keys: ['ENTER'] },
  ],
  extras: [{ key: 'Q', does: 'Give up the game' }],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'At the title, press K to play with the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or ENTER to play on the keyboard.',
      keys: ['K', 'ENTER'],
    },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/t/TreasureIslandDizzy.txt' },
    { title: 'Treasure Island Dizzy in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/9333' },
  ],
};
