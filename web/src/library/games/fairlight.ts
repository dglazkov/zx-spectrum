// Fairlight (The Edge, 1985, Bo Jangeborg): its play card. The words are ours, from the instructions (Spectrum Computing
// keeps them as text) and the game played on this machine, which showed that its keys screen's 9-JOY works once play
// has begun: 9 then hands Isvar to the Kempston joystick, whose up, down, left and right are the keys' four diagonals
// (Q-T, A-G, H-ENTER, Y-P) and whose fire fights (web/tests/wasm/games/fairlight.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0001712',
  title: 'Fairlight',
  blurb:
    'An adventure in a castle drawn in solid 3D, where every barrel, stool and book can be pushed, stacked and carried. You are Isvar, shut inside with a wizard held there by invisible bonds, and the only one who can free him.',
  goal: 'Find the Book of Light, hidden somewhere in the castle, and bring it to the trapped wizard: it breaks his bonds, and he gives you the way out.',
  tips: [
    'You have five pockets, but heavy things fill them fast: carry only what you need.',
    'Stack objects to climb up to places you cannot jump to.',
    'Guards and trolls sap your life: fight them, or eat what you find to recover.',
  ],
  controls: [
    { does: 'Walk up and left', pad: ['UP'], keys: ['Q'] },
    { does: 'Walk down and right', pad: ['DOWN'], keys: ['A'] },
    { does: 'Walk down and left', pad: ['LEFT'], keys: ['H'] },
    { does: 'Walk up and right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Fight', pad: ['FIRE'], keys: ['M'] },
    { does: 'Jump', pad: null, keys: ['SPACE'] },
    { does: 'Pick up', pad: null, keys: ['X'] },
    { does: 'Drop', pad: null, keys: ['Z'] },
    { does: 'Choose a pocket', pad: null, keys: ['1'] },
    { does: 'Use what is in the chosen pocket', pad: null, keys: ['6'] },
  ],
  extras: [
    { key: 'SYMBOL SHIFT+SPACE', does: 'Pause' },
    { key: 'SYMBOL SHIFT+0', does: 'Start again' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the title press ENTER to see the keys, and ENTER again to begin.', keys: ['ENTER'] },
    { text: 'Once Isvar is in the castle, press 9 to play with the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad); jumping, carrying and using things stay on the keys.', keys: ['9'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/f/Fairlight.txt' },
    { title: 'Fairlight in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1712' },
  ],
};
