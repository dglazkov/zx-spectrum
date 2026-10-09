// Starquake (Bubble Bus, 1985, Stephen Crow): its play card. The words are ours, from the inlay's instructions
// (Spectrum Computing keeps them as text) and the game played on this machine: its menu takes 1 for the Kempston
// joystick and 0 to start, and after the crash-landing message BLOB is the player's
// (web/tests/wasm/games/starquake.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0004873',
  title: 'Starquake',
  blurb:
    'A planet torn out of a black hole is about to blow up, and BLOB, a small round robot, has crash-landed on it. Below the surface lies a huge maze of caverns full of drifting creatures, teleports, lifts and strange gadgets.',
  goal: 'Find the pieces of the planet’s broken core, scattered through the caverns, and carry each one back to the core until it is whole again.',
  tips: [
    'Press down to lay a short bridge under BLOB to reach high ledges, but it crumbles after a few moments.',
    'Step onto a hover platform and push up to fly: flying is quicker, but you must land to pick anything up.',
    'Spinning tops kill at once; keep the laser for the rest, and pick up energy and ammunition packs as you go.',
  ],
  controls: [
    { does: 'Move left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Move right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Up: fly up on a platform, pick up an object', pad: ['UP'], keys: ['Q'] },
    { does: 'Down: lay a bridge, fly down', pad: ['DOWN'], keys: ['A'] },
    { does: 'Fire the laser', pad: ['FIRE'], keys: ['M'] },
  ],
  extras: [
    { key: 'SPACE', does: 'Pause (any key or the joystick carries on)' },
    { key: 'A+S+D+F+G', does: 'Give up the game (all five held)' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the menu press 1 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 4 for the keys O, P, Q, A and M.', keys: ['1', '4'] },
    { text: 'Press 0 to start. The flight computer reports the crash landing, and then BLOB is yours.', keys: ['0'] },
  ]),
  sources: [
    { title: 'The instructions and inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/s/Starquake.txt' },
    { title: 'Starquake in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4873' },
  ],
};
