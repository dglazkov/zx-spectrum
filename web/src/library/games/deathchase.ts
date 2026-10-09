// 3D Deathchase (Micromega, 1983, Mervyn Estcourt): its play card. The words are ours, from the instructions on the
// inlay (Spectrum Computing keeps them as text) and the game played on this machine: at its first screen 2 chooses the
// Kempston joystick and starts the chase (web/tests/wasm/games/deathchase.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0001303',
  title: 'Deathchase',
  blurb:
    'A motorbike chase through a forest at full tilt, drawn in 3D as the trees rush at you. You are a mercenary rider hunting enemy riders, with tanks and helicopters on the horizon by day and the forest dark by night.',
  goal: 'Chase down the two enemy riders in each sector and shoot them with your photon bolts, without hitting a tree. Clear sectors to earn more, and survive as many as you can.',
  tips: [
    'You can only fire at full speed, and only hit a rider when the range light flashes.',
    'Steer early: trees come at you faster than you think.',
    'Tanks and helicopters on the horizon are worth a shot when no rider is near.',
  ],
  controls: [
    { does: 'Steer left', pad: ['LEFT'], keys: ['1'] },
    { does: 'Steer right', pad: ['RIGHT'], keys: ['0'] },
    { does: 'Speed up', pad: ['UP'], keys: ['9'] },
    { does: 'Slow down', pad: ['DOWN'], keys: ['8'] },
    { does: 'Fire a photon bolt (any key on the bottom row)', pad: ['FIRE'], keys: ['SPACE'] },
  ],
  extras: [],
  joystick: true,
  model: '48k',
  start: byHand([{ text: 'At the first screen press 2 for the Kempston joystick (or 1 for the keyboard): the chase starts at once.', keys: ['2', '1'] }]),
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/d/Deathchase.txt' },
    { title: 'Deathchase in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1303' },
  ],
};
