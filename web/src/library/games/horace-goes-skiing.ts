// Horace Goes Skiing (Sinclair Research and Psion, 1982, William Tang of Beam Software): its play card. The words are
// ours, from the instructions on the inlay (Spectrum Computing keeps them as text) and the game played on this machine.
// It takes no joystick: the page's arrows press its Q, Z, I and P (web/tests/wasm/games/horace-goes-skiing.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0002351',
  title: 'Horace Goes Skiing',
  blurb:
    'Horace wants a day on the slopes, but his skis are in a hut across a busy road. First he dodges the traffic to hire them, then he slaloms down the mountain between the flags and around the trees.',
  goal: 'Cross the road to the ski hut, come back with skis, and ski down the course passing between each pair of flags. Make it to the finish with your skis whole.',
  tips: [
    'Horace starts with $40: being run over costs $10 in ambulance fees, and the skis cost $10 to hire.',
    'Do not linger on the road: the traffic gets heavier the longer you stay.',
    'Missing a pair of flags costs points; hitting a tree can break your skis and send you back to the road.',
  ],
  controls: [
    { does: 'Up (on the road)', pad: ['UP'], keys: ['Q'] },
    { does: 'Down', pad: ['DOWN'], keys: ['Z'] },
    { does: 'Left', pad: ['LEFT'], keys: ['I'] },
    { does: 'Right', pad: ['RIGHT'], keys: ['P'] },
  ],
  extras: [
    { key: 'S', does: 'Pause (a key on the bottom row goes on)' },
    { key: 'G+H', does: 'Give up and start again' },
  ],
  joystick: false,
  keymap: { UP: 'Q', DOWN: 'Z', LEFT: 'I', RIGHT: 'P' },
  model: '48k',
  start: byHand([
    { text: 'During the demo press any key, and again at each title page, until the road shows with your CASH at the top.', keys: ['any'] },
  ]),
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/h/HoraceGoesSkiing.txt' },
    { title: 'Horace Goes Skiing in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/2351' },
  ],
};
