// Batman (Ocean, 1986, Jon Ritman and Bernie Drummond): its play card. The words are ours, from Ocean's instructions
// (Spectrum Computing keeps them as text) and the game played on this machine, from the shelf's tape (release 3) on a
// 128K. The game first asks for the joystick, once only, with KEMPSTON JOYSTICK already under the bat cursor here; ENTER
// takes it, and ENTER again at the main menu plays; web/tests/wasm/games/batman.spec.ts holds that to the game.

import { byHand } from '../card';
import type { GameCard } from '../card';

export const card: GameCard = {
  id: '0000438',
  title: 'Batman',
  blurb:
    'An isometric adventure in the Batcave. Robin has been kidnapped, and Batman must explore some hundred and fifty rooms of puzzles, traps and henchmen to find the seven scattered parts of the Batcraft and fly to the rescue.',
  goal: 'First find your Batboots, Batbag, Bat-thruster and Batbelt; then collect all seven parts of the Batcraft and reach its launch pad.',
  tips: [
    'Until you have the Batboots you cannot jump, and without the Batbag you cannot carry anything: find them first.',
    'Touch the Bat-signals as you pass them: each saves your progress, and the menu’s PLAY THE GAME can then carry on from it.',
    'Pills give extra lives, speed, high jumps or a shield for a while; the look-alike neutralizer cancels them all.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Walk up the screen', pad: ['UP'], keys: ['Q'] },
    { does: 'Walk down the screen', pad: ['DOWN'], keys: ['A'] },
    { does: 'Jump (once you have the Batboots)', pad: ['FIRE'], keys: ['M'] },
    { does: 'Pick up or drop (once you have the Batbag)', pad: null, keys: ['Z'] },
    { does: 'Jump and pick up together', pad: null, keys: ['SPACE'] },
  ],
  extras: [
    { key: '1', does: 'Pause, and from the pause, give up' },
    { key: 'CAPS SHIFT', does: 'In the menus: back to the main menu' },
  ],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'JOYSTICK SELECTION asks once only. Press any key but ENTER to move the bat cursor to KEMPSTON JOYSTICK (the arrow keys and Left Alt, a gamepad, or the touch pad; it is usually there already), or to KEYS for the keyboard, and press ENTER.',
      keys: ['ENTER'],
    },
    { text: 'At the main menu, with the bat on PLAY THE GAME, press ENTER. The first room takes a moment to draw.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/b/Batman.txt' },
    { title: 'Batman in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/438' },
  ],
};
