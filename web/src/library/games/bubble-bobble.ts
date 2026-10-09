// Bubble Bobble (Firebird, 1987; Software Creations' conversion of Taito's 1986 arcade game): its play card. The words
// are ours, from the instructions that came with it and the cassette's inlay (Spectrum Computing keeps scans), the
// reviews of the time and the game played on this machine; the start route was worked out against the game itself,
// from the original release's tape (BubbleBobble.tzx, Firebird's BleepLoad) on a 128K, as the page loads it
// (docs/cards/bubble-bobble.md has the record; web/tests/wasm/games/bubble-bobble.spec.ts holds the route to it, and
// that each control moves Bub).
//
// The route: once loaded, the game asks CHOOSE CONTROL FOR PLAYER 1 (1 KEYBOARD, 2 SINCLAIR, 3 KEMPSTON, 4 CURSOR
// TYPE) and waits for ever; then the same for player 2, with player 1's choice taken off the list. The keyboard has no
// keys of its own: CHOOSE KEYS FOR PLAYER 1 asks for LEFT, RIGHT, FIRE and JUMP, each taken once the key before has been
// let go, and then ALL OK ?, where Y goes on and N asks again. The title (1 OR 2 TO PLAY flashing, CREDIT in the
// corner) follows after about seven seconds of black, and stays: there is no demo, and no way back to the control menu
// short of loading the game again. 1 starts a game for one player: ROUND 1 and READY ! show for about a second, and
// then Bub is the player's (the monsters drop in over the next four seconds or so; the game reads its pause and
// BREAK keys only once they have). A game that ends goes back to the title, with the controls as they were. Player 2
// on the Sinclair joystick plays on 6 and 7 (walk), 9 (jump) and 0 (blow).
//
// The menus print in the game's own font, which the screen's text reads as blots, but for LICENSED BY FIREBIRD
// SOFTWARE under the control menu; so the screens are told apart by which of their lines have something drawn on them
// (an option the other player took is rubbed out), and by their attributes. The title's prompt flashes; the game's
// top line (1UP HIGH SCORE 2UP), ROUND, READY ! and GAME OVER are in the ROM's font.

import type { GameCard } from '../card';
import type { Route, Screen } from '../start';

/** The rows of the control menu's options: 1 KEYBOARD, 2 SINCLAIR, 3 KEMPSTON, 4 CURSOR TYPE. */
const OPTIONS = [8, 11, 14, 17] as const;
/** The rows of the keyboard's questions, in the order asked: LEFT, RIGHT, FIRE, JUMP, then ALL OK ?. */
const QUESTIONS = [5, 8, 11, 14, 17] as const;
/** The keys the route gives the keyboard, in that order: O and P to walk, SPACE to blow, Q to jump. */
const KEYS = ['O', 'P', 'SPACE', 'Q'] as const;

const lines = (screen: Screen): string[] => screen.text.split('\n');
/** Whether anything is drawn on a text row (the game's own font reads as blots, which count). */
const drawn = (row: string | undefined): boolean => !!row && row.trim() !== '';
/** How many cells of a row flash, from column `from` to `to`. */
const flashes = (screen: Screen, row: number, from: number, to: number): number => {
  let n = 0;
  for (let c = from; c <= to; c++) if (screen.attr(row, c) & 0x80) n++;
  return n;
};

const start: Route = {
  steps: [
    {
      text: 'When the game has loaded it asks how player 1 will play: 3 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 for the keyboard.',
      keys: ['3', '1'],
    },
    {
      text: 'The keyboard has no keys of its own: the game asks for one for each move in turn, LEFT, RIGHT, FIRE and JUMP (O, P, SPACE and Q, say). Y at ALL OK ? keeps them, and N asks again.',
      keys: ['O', 'P', 'SPACE', 'Q', 'Y'],
    },
    {
      text: 'It asks the same for player 2, without player 1’s choice. 2, the Sinclair joystick, puts player 2 on the keys 6 and 7 to walk, 9 to jump and 0 to blow.',
      keys: ['2'],
    },
    {
      text: 'At the title, 1 OR 2 TO PLAY, press 1 for one player or 2 for two. The controls stay as they were chosen until the game is loaded again.',
      keys: ['1', '2'],
    },
  ],
  skills: null,
  within: 1500,
  ready(screen) {
    return 'press' in start.next(screen, { joystick: true, skill: 1 });
  },
  next(screen, choice) {
    const rows = lines(screen);
    // Play: the score line across the top in the ROM's font. ROUND n and READY ! show before Bub can move, and GAME
    // OVER before the title comes back.
    if (rows[0]?.includes('1UP') && rows[0].includes('HIGH SCORE')) {
      return screen.text.includes('READY') || screen.text.includes('GAME OVER') ? { wait: 10 } : { done: true };
    }
    // The control menu, LICENSED BY FIREBIRD SOFTWARE under it in the ROM's font.
    if (screen.text.includes('LICENSED BY FIREBIRD')) {
      const has = OPTIONS.map((r) => drawn(rows[r]));
      // Player 1's: all four options. It is drawn from the top down within a frame or two, so a list short of its
      // last option may be one still being drawn: that waits.
      if (has.every(Boolean)) return { press: choice.joystick ? '3' : '1', hold: 4, after: 20 };
      // Player 2's: one option rubbed out, player 1's. Sinclair, or the cursor type where player 1 took Sinclair.
      if (has.filter((h) => !h).length === 1 && has[3]) return { press: has[1] ? '2' : '4', hold: 4, after: 20 };
      return { wait: 5 };
    }
    // The keyboard's questions: blue bands at the top and the bottom, an empty one at the bottom, the questions asked
    // so far drawn one under another. Each key is taken once the one before has been let go.
    if (screen.attr(1, 0) === 0x0f && screen.attr(21, 0) === 0x0f && drawn(rows[1]) && !drawn(rows[21])) {
      let asked = 0;
      while (asked < QUESTIONS.length && drawn(rows[QUESTIONS[asked]])) asked++;
      if (asked === 0) return { wait: 5 };
      return { press: asked <= KEYS.length ? KEYS[asked - 1] : 'Y', hold: 4, after: 16 };
    }
    // The title: 1 OR 2 TO PLAY flashing on rows 17 and 18, columns 10 to 23, and CREDIT in the bottom corner.
    if (flashes(screen, 17, 10, 23) === 14 && flashes(screen, 18, 10, 23) === 14 && screen.text.includes('CREDIT')) {
      return { press: '1', hold: 4, after: 30 };
    }
    // Anything else (the black between the menus and the title, a screen being drawn): look again shortly.
    return { wait: 10 };
  },
};

export const card: GameCard = {
  id: '0000722',
  title: 'Bubble Bobble',
  blurb:
    'Taito’s arcade favourite, brought to the Spectrum by Software Creations for Firebird. You are Bub, a little dinosaur who fights by blowing bubbles: catch a monster in one, burst it, and the monster turns into fruit or other food worth points. A hundred single-screen caves to clear, and a friend can play alongside as Bob.',
  goal: 'Clear each cave by trapping every monster in a bubble and bursting it, then on to the next. There are a hundred, with the biggest monster of all in the last, and beyond it the girlfriends Bub and Bob set out to find.',
  tips: [
    'Bubbles fly only a short way before they float up, so get close to a monster before you blow.',
    'Burst a trapped monster quickly, by walking into its bubble or jumping against it: left too long, it breaks free, angrier than before.',
    'Burst several monsters at once: it pays far more, and brings out bubbles with the letters of EXTEND. All six give you an extra life.',
    'Do not dawdle: take too long over a cave and Baron von Blubba comes for you, and nothing kills him. Hold jump to bounce along on top of bubbles.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Jump (up through a ledge; held, bounce on bubbles)', pad: ['UP'], keys: ['Q'] },
    { does: 'Blow a bubble', pad: ['FIRE'], keys: ['SPACE'] },
  ],
  extras: [
    { key: 'SYMBOL SHIFT', does: 'Pause, once the round’s monsters are in (the border turns green)' },
    { key: 'CAPS SHIFT', does: 'Carry on after a pause' },
    { key: 'CAPS SHIFT + SPACE', does: 'Give up the game (BREAK), once the monsters are in: back to the title' },
    { key: '2', does: 'At the title: a game for two, Bob walking on 6 and 7, jumping on 9 and blowing on 0' },
  ],
  joystick: true,
  model: '128k',
  start,
  sources: [
    { title: 'The instructions from the box, scanned (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0000722/BubbleBobble(EN).pdf' },
    { title: 'Notes on the game, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/b/BubbleBobble.txt' },
    { title: 'The cassette inlay (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0000722/BubbleBobble.jpg' },
    { title: 'Bubble Bobble in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/722' },
    { title: 'The reviews of the time: Crash 45, Sinclair User 68, The Games Machine 3 (ZX Spectrum Reviews)', url: 'http://www.zxspectrumreviews.co.uk/api/title/722' },
    { title: 'Bubble Bobble, the arcade game (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Bubble_Bobble' },
  ],
};
