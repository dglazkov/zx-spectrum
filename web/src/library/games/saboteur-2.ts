// Saboteur II: Avenging Angel (Durell, 1987, Clive Townsend): its play card. The words are ours, from the instructions
// (Spectrum Computing keeps them as text) and the game played on this machine, from the 128K tape the page loads: as in
// Saboteur, the REWARD screen wants a key, then the menu takes J for KEMPSTON and S to start, and a key after the
// mission briefing; the ninja then rides in on a hang-glider until fire drops her
// (web/tests/wasm/games/saboteur-2.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0004295',
  title: 'Saboteur II',
  blurb:
    'The first saboteur’s sister, Nina, sets out to finish what he started. She glides by night onto a dictator’s mountain base, where a missile is being readied for launch, and fights her way through guards and pumas.',
  goal: 'Collect the pieces of punched tape hidden in the base’s boxes, use them at the terminal by the missile to send it off course, and escape on the motorbike in the tunnels before the timer runs out.',
  tips: [
    'Press fire to drop from the hang-glider onto the roof of the base.',
    'Standing still slowly brings your energy back.',
    'Boxes are in the same places every game: learn them on the first mission.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['N'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['M'] },
    { does: 'Climb up; kick when standing', pad: ['UP'], keys: ['A'] },
    { does: 'Climb down; duck when standing', pad: ['DOWN'], keys: ['Z'] },
    { does: 'Running jump', pad: ['UP', 'RIGHT'], keys: ['A', 'M'] },
    { does: 'Punch; take, use or throw; drop from the glider', pad: ['FIRE'], keys: ['SPACE'] },
    { does: 'Flying kick', pad: ['FIRE', 'RIGHT'], keys: ['SPACE', 'M'] },
  ],
  extras: [],
  joystick: true,
  model: '128k',
  start: byHand([
    { text: 'At the REWARD screen press any key.', keys: ['any'] },
    { text: 'At the menu press J for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or K for the keyboard; hold the key a moment. M picks another mission.', keys: ['J', 'K'] },
    { text: 'Press S to start, and any key after the mission briefing.', keys: ['S', 'any'] },
    { text: 'Nina arrives by hang-glider: press fire to let go over the roof.', keys: ['SPACE'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/s/SaboteurII.txt' },
    { title: 'Saboteur II in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4295' },
  ],
};
