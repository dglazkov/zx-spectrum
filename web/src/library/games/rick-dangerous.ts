// Rick Dangerous (Firebird, 1989; Core Design): its play card. The words are ours, from the instructions (Spectrum
// Computing keeps them as text) and the game on this machine, from the original tape on a 128K. The menu is 1 KEYBOARD,
// 2 KEMPSTON, 3 CURSOR, 4 SINCLAIR and PRESS FIRE TO START. On this machine ENTER starts it (the Kempston's fire did
// not), and the game then stops at its first story screen (SOUTH AMERICA) without going on to play, whatever is
// pressed: web/tests/wasm/games/rick-dangerous.spec.ts keeps its check skipped until that is understood.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0004135',
  title: 'Rick Dangerous',
  blurb:
    'An Indiana Jones spoof full of traps. Rick, adventurer and part-time stamp collector, crash-lands in the Amazon and must find his way through an Aztec temple, an Egyptian tomb and an enemy fortress, armed with a pistol, a stick and some dynamite.',
  goal: 'Get Rick through each level alive, one screen at a time, working out how every trap is sprung before it gets him.',
  tips: [
    'Almost everything is a trap: when Rick dies, remember what killed him and try another way. Shooting or poking things can set traps off safely.',
    'Bullets and dynamite are few: pick up the boxes enemies and the levels leave behind, and save the dynamite for walls and crowds.',
    'Light the dynamite and run: it hurts Rick as much as anyone.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['Z'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['X'] },
    { does: 'Jump (up, or up and a side)', pad: ['UP'], keys: ['O'] },
    { does: 'Duck, or crawl with left or right', pad: ['DOWN'], keys: ['K'] },
    { does: 'Shoot the gun', pad: ['FIRE', 'UP'], keys: ['ENTER', 'O'] },
    { does: 'Jab with the stick', pad: ['FIRE', 'RIGHT'], keys: ['ENTER', 'X'] },
    { does: 'Light and drop dynamite', pad: ['FIRE', 'DOWN'], keys: ['ENTER', 'K'] },
  ],
  extras: [
    { key: 'P', does: 'Pause on and off' },
    { key: 'Q', does: 'Give up: back to the start' },
  ],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'At the menu press 2 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 for the keyboard.',
      keys: ['2', '1'],
    },
    { text: 'Press ENTER to start (the screen says fire), and again to go on from the story of the level.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/r/RickDangerous.txt' },
    { title: 'Rick Dangerous in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4135' },
  ],
};
