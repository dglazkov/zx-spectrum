// The Hobbit (Melbourne House, 1982, Philip Mitchell and Veronika Megler): its play card. The words are ours, from the
// booklet (Spectrum Computing keeps it as text) and the game played on this machine. A text adventure: there is
// nothing to choose, and the card says how to type to it (web/tests/wasm/games/the-hobbit.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0006440',
  title: 'The Hobbit',
  blurb:
    'Tolkien’s story as an adventure you type: you are Bilbo Baggins, setting out from your comfortable hole with Gandalf and Thorin. Each place is drawn as you arrive, and the others in the story act on their own, helping or hindering as they please.',
  goal: 'Travel to the Lonely Mountain, get past the dragon Smaug, and bring his treasure back home to Bilbo’s hole.',
  tips: [
    'Type plain sentences: TAKE ALL, GO EAST, EXAMINE MAP. Several can go on one line, joined by AND or commas.',
    'Ask others for help with SAY TO, the words in quotes: SAY TO GANDALF "READ MAP". The quote mark is SYMBOL SHIFT and P.',
    'Use WAIT when you need others to catch up, and SAVE now and then: the game is full of sudden ends.',
  ],
  controls: [
    { does: 'Type a command, then ENTER', pad: null, keys: ['ENTER'] },
    { does: 'Go north, at the start of a line (no ENTER)', pad: null, keys: ['7'] },
    { does: 'Go south', pad: null, keys: ['6'] },
    { does: 'Go west', pad: null, keys: ['5'] },
    { does: 'Go east', pad: null, keys: ['8'] },
    { does: 'Look around: L, then ENTER', pad: null, keys: ['L'] },
    { does: 'What you carry: I, then ENTER', pad: null, keys: ['I'] },
    { does: 'Do the last command again (@)', pad: null, keys: ['SYMBOL SHIFT', '2'] },
  ],
  extras: [],
  joystick: false,
  model: '48k',
  start: byHand([
    { text: 'When the credits show, press any key. Bilbo’s first place is drawn stroke by stroke: once the picture is finished, the game takes your typing.', keys: ['any'] },
    { text: 'Type a command in plain words, such as LOOK or GO EAST, and press ENTER.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The booklet, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/h/HobbitTheV1.0.txt' },
    { title: 'The Hobbit in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/6440' },
  ],
};
