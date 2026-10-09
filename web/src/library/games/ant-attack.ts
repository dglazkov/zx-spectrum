// Ant Attack (Quicksilva, 1983, Sandy White): its play card. The words are ours, from the inlay's instructions (Spectrum
// Computing keeps them as text) and the game played on this machine. It takes no joystick, so the page's arrows and fire
// are put on its keys: up walks forward (V), left and right turn (M and SYMBOL SHIFT), fire jumps (C) and down throws a
// grenade (D) (web/tests/wasm/games/ant-attack.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0000210',
  title: 'Ant Attack',
  blurb:
    'The walled city of Antescher stands in the desert, drawn in solid 3D that you can view from four sides. Giant ants have made it their home, and someone has wandered in and needs rescuing.',
  goal: 'Find the boy or girl trapped in the city, lead them back out through the gate, and escape before your time runs out, while keeping the ants off with grenades.',
  tips: [
    'The SCAN meter shows which way to head to find the person you are looking for.',
    'To climb onto a block, walk forward and jump at the same time.',
    'Ants that bite cost time and strength; a grenade stuns them, so throw short or long with S, D, F and G.',
  ],
  controls: [
    { does: 'Walk forward', pad: ['UP'], keys: ['V'] },
    { does: 'Turn anticlockwise', pad: ['LEFT'], keys: ['M'] },
    { does: 'Turn clockwise', pad: ['RIGHT'], keys: ['SYMBOL SHIFT'] },
    { does: 'Jump (with forward to climb up)', pad: ['FIRE'], keys: ['C'] },
    { does: 'Throw a grenade (S short to G long)', pad: ['DOWN'], keys: ['D'] },
  ],
  extras: [
    { key: '0', does: 'View from one side (also P, ENTER and SPACE for the other three)' },
    { key: '1', does: 'Last resort: back to the city gate' },
  ],
  joystick: false,
  keymap: { UP: 'V', LEFT: 'M', RIGHT: 'SYMBOL SHIFT', FIRE: 'C', DOWN: 'D' },
  model: '48k',
  start: byHand([
    { text: 'When it asks Girl or Boy, press G to play the girl or B to play the boy.', keys: ['G', 'B'] },
    { text: 'Press any key after the story. The arrows walk and turn, Left Alt jumps and the down arrow throws a grenade.', keys: ['any'] },
  ]),
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/a/AntAttack.txt' },
    { title: 'Ant Attack in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/210' },
  ],
};
