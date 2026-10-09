// Daley Thompson's Decathlon (Ocean, 1984; Paul Owens and Christian Urquhart): its play card. The words are ours, from
// the instructions (Spectrum Computing keeps them as text) and the game played on this machine, from the shelf's tape
// on a 48K. At the menu 2 chooses the Kempston joystick and goes to a wheel of letters for the athlete's name; fire
// takes a letter, and with three the 100 metres begins. 1, the keyboard, shows its keys (N, M and SYMBOL SHIFT) and asks
// whether to change them. web/tests/wasm/games/daley-thompsons-decathlon.spec.ts holds the joystick's way to the track.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0001217',
  title: 'Daley Thompson’s Decathlon',
  blurb:
    'The famous joystick-breaker: all ten events of the Olympic decathlon over two days, from the 100 metres to the 1500. Speed comes from rocking left and right as fast as you can; timing does the rest.',
  goal: 'Reach the qualifying time, distance or height in every event. Fail one and you lose one of your three lives; get through all ten for the gold.',
  tips: [
    'Running is left, right, left, right, as fast as you can: the speed bar shows how you are doing.',
    'For the long jump and the throws, take off or let go close to the line, and hold fire for an angle near 45 degrees.',
    'In the 1500 metres save some energy for the last lap: fire slows you down.',
  ],
  controls: [
    { does: 'Run (rock left and right in turn)', pad: ['LEFT'], keys: ['N'] },
    { does: 'Run (the other foot)', pad: ['RIGHT'], keys: ['M'] },
    { does: 'Jump, throw, or set the angle (held)', pad: ['FIRE'], keys: ['SYMBOL SHIFT'] },
  ],
  extras: [
    { key: '1', does: 'At the menu: the keyboard (N, M, SYMBOL SHIFT); Y then changes the keys, N keeps them' },
    { key: '4', does: 'At the menu: a Sinclair joystick' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    {
      text: 'At the menu press 2 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 for the keyboard and then N to keep its keys.',
      keys: ['2', '1', 'N'],
    },
    { text: 'Enter your name on the wheel of letters: left and right turn it, fire takes a letter. After the third, the 100 metres begins.', keys: [] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/d/DaleyThompsonsDecathlon.txt' },
    { title: 'Daley Thompson’s Decathlon in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1217' },
  ],
};
