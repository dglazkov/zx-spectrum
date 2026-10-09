// Jet Set Willy (Software Projects, 1984, Matthew Smith): its play card. The words are ours, from the instructions on the
// inlay (Spectrum Computing keeps them as text) and the game played on this machine. It reads a Kempston joystick by
// itself; ENTER at the title starts (web/tests/wasm/games/jet-set-willy.spec.ts).
//
// Why a route, not steps by hand: before the title the game asks for the four colours printed at a square of its code
// card (letters A to R across, digits 0 to 9 down), which no one playing here has. The route reads the square from the
// screen and enters its colours from the game's own table (at 9E00h, each byte less its index; the square's index is its
// column plus 18 times its row), as keys 1 to 4, one a block; a block not yet entered has a white attribute (7) on row 10.
// Then it holds ENTER at the title (the tune reads keys between notes) until the first room's panel shows.

import type { GameCard } from '../card';
import type { Route } from '../start';

/** The code card: the byte for each square, two bits a block (the first block in the top bits), each a key 1 to 4. */
const CODES =
  '2b4c0f7bce6523d463270837cc25012002512ccadeb52f534ab35a2d9a1ba5472cee7c41e49fd9e9ed4766432e04ee591e711d5d1e7558d97824fab9f35d426263646566bee882094d6884288c8a180d6d145772217181170f23a47999e4bd5d8d9964818a28088079736a4094843bbe8e5c559b856045a363a35ebb67a5844cda9f441a9d70023c52d3a8ad70cdc070d072b475d45659cab266d1be1a9bca6b18bea06d701dc3d28d763eb48dd5b5868a73d0';

/** The keys for the square the screen asks for ('G5'), or null where it asks for none. */
export function codeFor(text: string): string[] | null {
  const m = /location +([A-R])([0-9])/.exec(text);
  if (!m) return null;
  const n = m[1].charCodeAt(0) - 65 + 18 * Number(m[2]);
  const b = parseInt(CODES.slice(2 * n, 2 * n + 2), 16);
  return [6, 4, 2, 0].map((shift) => String(((b >> shift) & 3) + 1));
}

const BLOCKS = [16, 19, 22, 25];

const start: Route = {
  steps: [
    { text: 'The game asks for the colours at a square of its code card. The Start button enters them for you; by hand, read the square’s four colours off the card and press 1 to 4 for each block.', keys: ['1', '2', '3', '4'] },
    { text: 'At the title, hold ENTER until the first room shows. The joystick needs no choosing: the game reads it by itself.', keys: ['ENTER'] },
  ],
  skills: null,
  within: 3000,
  ready(screen) {
    return codeFor(screen.text) !== null || screen.text.includes('Press ENTER to Start');
  },
  next(screen) {
    if (screen.text.includes('Items collected')) return { done: true };
    const code = codeFor(screen.text);
    const entered = BLOCKS.filter((c) => (screen.attr(10, c) & 0x7f) !== 7).length;
    if (code && entered < 4) return { press: code[entered], hold: 6, after: 12 };
    // The title, drawn under what is left of the code's screen (its scrolling line says to press ENTER, but is not
    // always on the screen whole): ENTER, held.
    return { press: 'ENTER', hold: 30, after: 30 };
  },
};

export const card: GameCard = {
  id: '0002589',
  title: 'Jet Set Willy',
  blurb:
    'Miner Willy is rich now, with a mansion full of rooms he has never explored, and the party is over. His housekeeper Maria will not let him into bed until every glass and bottle left lying about has been tidied away.',
  goal: 'Collect every flashing object in the house and its grounds, then get to the master bedroom, before the clock runs out at seven in the morning.',
  tips: [
    'Rooms join at their edges: walk off the screen, or climb the ropes and stairs to go up.',
    'A fall from too high costs a life, and so does landing on anything that moves.',
    'Some objects sit in rooms you can only reach from above: look for a way in from the roof.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Jump on the spot', pad: ['FIRE'], keys: ['SPACE'] },
    { does: 'Jump left or right', pad: ['FIRE', 'RIGHT'], keys: ['SPACE', 'P'] },
  ],
  extras: [{ key: 'A', does: 'Pause' }],
  joystick: true,
  model: '48k',
  start,
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/j/JetSetWilly.txt' },
    { title: 'Jet Set Willy in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/2589' },
  ],
};
