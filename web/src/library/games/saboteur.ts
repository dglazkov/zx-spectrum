// Saboteur! (Durell, 1985, Clive Townsend): its play card. The words are ours, from the instructions on the cassette's
// inlay (Spectrum Computing keeps them as text) and the game played on this machine; the start route was worked out
// against the game itself (web/tests/wasm/games/saboteur.spec.ts holds it, and that each control moves the ninja).
//
// The route: the £100 REWARD screen wants any key; the high scores take a key only from about a second and a half
// after they show until about five and a half, and then the game goes on to its next screen; the menu reads a key only
// once it has been held for 8 frames or so (it reads the keys between the notes it plays: a quick tap is lost), and
// highlights J KEMPSTON, K KEYBOARD or P PROTEK (the default) on rows 1, 3 and 5; S starts the mission with what is
// highlighted; the skill level is a digit held until the mission is announced. (With no Kempston interface plugged in,
// J starts at once: port 1F then floats high, which the game reads as fire held.) The screens are told apart by their
// attributes: a highlighted menu item flashes.

import type { GameCard } from '../card';
import { flashing, rowIs, type Route } from '../start';

const start: Route = {
  steps: [
    { text: 'At the £100 REWARD screen press any key, and another at the high scores.', keys: ['any'] },
    { text: 'At the menu press K for the keyboard, or J for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad). P PROTEK, the menu’s own choice, is a cursor joystick on 5, 6, 7, 8 and 0.', keys: ['K', 'J'] },
    { text: 'S starts the mission. Hold a skill level, 1–9, down until the mission is announced: the menu reads keys between the notes of its tune, so a quick tap is missed.', keys: ['S', '1–9'] },
    { text: 'The ninja leaps from the dinghy into the sea. Swim right to the jetty and press up as you pass under one of its posts to climb out: the post takes only an exact line-up, so swim back and try again if you pass it.', keys: ['A'] },
  ],
  skills: [1, 9],
  within: 3000,
  ready(screen) {
    return 'press' in start.next(screen, { joystick: false, skill: 1 });
  },
  next(screen, choice) {
    if (screen.text.includes('PRESS ANY KEY TO CONTINUE')) return { press: 'SPACE', hold: 6, after: 30 };
    const flash = flashing(screen);
    // The menu: one item highlighted, its 13 cells flashing on row 1 (J), 3 (K) or 5 (P).
    const menuRow = flash.length === 2 && flash[1] === 13 ? flash[0] : -1;
    if (menuRow >= 0) {
      const want = choice.joystick ? 1 : 3;
      return menuRow === want ? { press: 'S', hold: 10, after: 20 } : { press: choice.joystick ? 'J' : 'K', hold: 10, after: 10 };
    }
    // The skill level's prompt: a flashing box of three cells on row 7.
    if (flash.length === 2 && flash[0] === 7 && flash[1] === 3) return { press: String(Math.max(1, Math.min(9, choice.skill))), hold: 40, after: 20 };
    // The game: the panel, framed in red on black from row 18 to row 23.
    if (!flash.length && rowIs(screen, 18, 0x02) && rowIs(screen, 23, 0x02)) return { done: true };
    // The high scores: green below row 16, nothing flashing. A key, and a moment for it to be taken.
    if (!flash.length && rowIs(screen, 16, 0x20) && rowIs(screen, 23, 0x20)) return { press: 'K', hold: 8, after: 30 };
    // Something in between (the screen being drawn): look again shortly.
    return { wait: 10 };
  },
};

export const card: GameCard = {
  id: '0004293',
  title: 'Saboteur!',
  blurb:
    'You are a ninja for hire, put ashore at night by rubber dinghy below a warehouse that hides a security centre. Somewhere underneath it is a disk naming the rebel leaders. Guards, dogs and wall-mounted guns stand between you and it, and the only way out is the helicopter on the roof.',
  goal: 'Reach the disk before the clock runs out, then get to the helicopter on the roof and fly away. For the biggest pay, find the time-bomb, leave it where the disk lay, and escape before it goes off.',
  tips: [
    'You begin in the sea: swim right to the jetty and press up just as you pass under one of its posts to climb out.',
    'Standing still slowly refills your energy, the red bar under your pay: rest after a fight, and duck to let a knife or a bullet fly over you.',
    'A punch or a kick kills a guard outright and pays five times what a thrown weapon does. Dogs pay nothing: jump over them.',
    'Some doors open only from a computer terminal: stand by one (it shows in the NEAR box) and press fire.',
  ],
  controls: [
    { does: 'Walk or swim left', pad: ['LEFT'], keys: ['N'] },
    { does: 'Walk or swim right', pad: ['RIGHT'], keys: ['M'] },
    { does: 'Climb up; kick when standing', pad: ['UP'], keys: ['A'] },
    { does: 'Climb down; duck when standing', pad: ['DOWN'], keys: ['Z'] },
    { does: 'Jump: up with left or right', pad: ['UP', 'RIGHT'], keys: ['A', 'M'] },
    { does: 'Punch; pick up, use or throw', pad: ['FIRE'], keys: ['SPACE'] },
    { does: 'Throw high (with down: low)', pad: ['FIRE', 'UP'], keys: ['SPACE', 'A'] },
  ],
  extras: [],
  joystick: true,
  model: '48k',
  start,
  sources: [
    { title: 'The instructions from the cassette inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/s/Saboteur.txt' },
    { title: 'The cassette inlay (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0004293/Saboteur.jpg' },
    { title: 'Saboteur! in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4293' },
  ],
};
