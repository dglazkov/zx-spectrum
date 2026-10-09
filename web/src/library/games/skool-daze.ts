// Skool Daze (Microsphere, 1984, David and Helen Reidy): its play card. The words are ours, from the instructions
// (Spectrum Computing keeps them as text) and the game played on this machine. The joystick is asked for only when you
// choose to name the cast: Y at the names question (held a moment), then K for Kempston, then a key for each of the
// cast until the lesson starts (web/tests/wasm/games/skool-daze.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0004549',
  title: 'Skool Daze',
  blurb:
    'You are Eric, a schoolboy whose dreadful report sits in the staffroom safe. The school runs to its timetable around you, with masters, a swot, a bully and a tearaway who all go about their day, and lines for any boy caught out of place.',
  goal: 'Hit every shield on the school walls, get each master to give up his letter of the safe’s code, open the safe, then hit all the shields again before you collect 10,000 lines.',
  tips: [
    'Go to the lessons on the timetable at the bottom of the screen: being in the wrong place earns lines.',
    'High shields can be hit by jumping off a boy you have knocked down, or with a pellet bounced off a sitting master’s head.',
    'The history master forgets his letter: write his year of birth on a clean blackboard before he arrives.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Go upstairs the way you face', pad: ['UP'], keys: ['Q'] },
    { does: 'Go downstairs the way you face', pad: ['DOWN'], keys: ['A'] },
    { does: 'Fire the catapult', pad: ['FIRE'], keys: ['F'] },
    { does: 'Run (with a direction key)', pad: null, keys: ['CAPS SHIFT', 'P'] },
    { does: 'Hit', pad: null, keys: ['H'] },
    { does: 'Jump', pad: null, keys: ['J'] },
    { does: 'Sit down or stand up', pad: null, keys: ['S'] },
    { does: 'Write on a blackboard', pad: null, keys: ['W'] },
  ],
  extras: [],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'While the demo plays, press any key. At “Do you want to put in your own names Y/N?” hold Y for a moment (N plays at once, with the keys).', keys: ['any', 'Y', 'N'] },
    { text: 'At CONTROL KEYS hold K for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or N for the keys.', keys: ['K', 'N'] },
    { text: 'The cast walks on one by one: press ENTER for each (or C to rename one) until the lesson begins. The other actions stay on the keys.', keys: ['ENTER', 'C'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/s/SkoolDaze.txt' },
    { title: 'Skool Daze in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4549' },
  ],
};
