// Bomb Jack (Elite, 1986; Tehkan's 1984 arcade game): its play card. The words are ours, from Elite's instructions
// (Spectrum Computing keeps a scan) and the game played on this machine, from the original tape on a 48K. At the menu
// P chooses the Kempston joystick and 1 starts a game for one; web/tests/wasm/games/bomb-jack.spec.ts holds that to the
// game.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0000617',
  title: 'Bomb Jack',
  blurb:
    'Elite’s conversion of the arcade hit. Jack, a caped hero who can leap the height of the screen and glide in the air, bounds around famous places of the world collecting the bombs left there, while mummies, birds and other creatures home in on him.',
  goal: 'Collect every bomb on each screen to move on. Take them while their fuses are lit, in order, for a big bonus at the end.',
  tips: [
    'Once one bomb is collected, the next one lights: follow the lit fuses and you will score far more.',
    'Catch the bouncing P ball to turn the creatures into coins for a few seconds, and then go after them.',
    'Jack falls slowly: press fire again in mid-air to hover, and steer while he drifts.',
  ],
  controls: [
    { does: 'Move left', pad: ['LEFT'], keys: ['N'] },
    { does: 'Move right', pad: ['RIGHT'], keys: ['M'] },
    { does: 'Jump (in mid-air, hover)', pad: ['FIRE'], keys: ['X'] },
    { does: 'Jump higher (held while jumping)', pad: ['UP', 'FIRE'], keys: ['Q', 'X'] },
    { does: 'Drop faster', pad: ['DOWN'], keys: ['A'] },
  ],
  extras: [
    { key: 'K', does: 'At the menu: play on the keyboard' },
    { key: 'T', does: 'At the menu: the keyboard with turbo jump (every jump as high as it goes)' },
    { key: 'Z', does: 'At the menu: an Interface 2 joystick' },
    { key: '2', does: 'At the menu: a game for two, taking turns' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    {
      text: 'When the menu shows, press P for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or K for the keyboard.',
      keys: ['P', 'K'],
    },
    { text: 'Press 1 to start a game for one player (2 for two).', keys: ['1', '2'] },
  ]),
  sources: [
    { title: 'The instructions from the box, scanned (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0000617/BombJack(EN).pdf' },
    { title: 'Bomb Jack in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/617' },
  ],
};
