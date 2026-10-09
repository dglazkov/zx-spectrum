// Head over Heels (Ocean, 1987, Jon Ritman and Bernie Drummond): its play card. The words are ours, from the
// instructions (Spectrum Computing keeps them as text) and the game played on this machine, on the 128K as the page loads
// it: SELECT JOYSTICK comes first, with KEMPSTON JOYSTICK already marked (any key moves the marker, ENTER takes it),
// then the main menu, where ENTER on PLAY THE GAME starts after a short look at the Blacktooth empire
// (web/tests/wasm/games/head-over-heels.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0002259',
  title: 'Head over Heels',
  blurb:
    'Two spies from the planet Freedom, Head and Heels, are caught and locked up apart in the Blacktooth empire. Head can jump high and glide, and later fire doughnuts; Heels runs fast and can carry things in a bag. Each alone is weak, but stacked one on the other they are a team.',
  goal: 'Bring Head and Heels back together, then find the lost crowns of the five worlds of Blacktooth so the slave planets rise up, and escape back to Freedom.',
  tips: [
    'Press a swap key (S, D, F or G) to switch between the two; when one stands on the other, it joins them.',
    'Heels can carry one object at a time: use it to fetch springs or stand on things to reach high doors.',
    'Look for the bunnies: they give extra lives, a higher jump, more speed or a shield.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Walk down', pad: ['DOWN'], keys: ['A'] },
    { does: 'Walk up', pad: ['UP'], keys: ['Q'] },
    { does: 'Jump', pad: ['FIRE'], keys: ['SPACE'] },
    { does: 'Pick up or put down (Heels, with the bag)', pad: null, keys: ['ENTER'] },
    { does: 'Fire a doughnut (Head, with the hooter)', pad: null, keys: ['Z'] },
    { does: 'Swap between Head and Heels', pad: null, keys: ['S'] },
  ],
  extras: [{ key: 'H', does: 'Hold the game: then give up or carry on' }],
  joystick: true,
  model: '128k',
  start: byHand([
    { text: 'At SELECT JOYSTICK, any key moves the marker: leave it on KEMPSTON JOYSTICK (the arrow keys and Left Alt, a gamepad, or the touch pad), or move it to KEYS/KEY JOYSTICK, and press ENTER.', keys: ['ENTER'] },
    { text: 'At the main menu press ENTER on PLAY THE GAME. The map of the Blacktooth empire shows for a moment, then you are in.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/h/HeadOverHeels.txt' },
    { title: 'Head over Heels in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/2259' },
  ],
};
