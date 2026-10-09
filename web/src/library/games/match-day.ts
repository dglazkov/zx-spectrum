// Match Day (Ocean, 1984, Jon Ritman and Chris Clarke): its play card. The words are ours, from the instructions
// (Spectrum Computing keeps them as text) and the game played on this machine: player 1 is on the Kempston joystick
// from the start and player 2 on O, P, A, Q and N; SWAP CONTROLS on the pre-match menu trades them. The teams walk out
// and line up for close to a minute, and play begins when the side kicking off presses kick
// (web/tests/wasm/games/match-day.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0003067',
  title: 'Match Day',
  blurb:
    'Football seen side-on from the stand, with the camera following the ball up and down the pitch. You play one team against the computer or a friend, in a single match or a cup for up to eight players.',
  goal: 'Score more goals than the other side by full time.',
  tips: [
    'You always control the player with the ball, or the one best placed to win it.',
    'At a corner or throw-in, push forward as you kick for a long ball and back for a short one.',
    'Nod a high ball on with a header as it drops: the player jumps by himself.',
  ],
  controls: [
    { does: 'Run left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Run right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Run up the pitch', pad: ['UP'], keys: ['Q'] },
    { does: 'Run down the pitch', pad: ['DOWN'], keys: ['A'] },
    { does: 'Kick or pass; the keeper dives; throw in', pad: ['FIRE'], keys: ['N'] },
  ],
  extras: [{ key: 'CAPS SHIFT+SPACE', does: 'Pause (both players’ pause keys); then CAPS SHIFT gives up the match' }],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the title press any key, and wait for the Main Menu to draw. ENTER picks the highlighted line, Play Match Day (1 player game); SYMBOL SHIFT moves down to the others.', keys: ['any', 'ENTER', 'SYMBOL SHIFT'] },
    { text: 'Player 1 starts on the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad). For the keys O, P, A, Q and N instead, press SYMBOL SHIFT three times to Swap Controls and ENTER.', keys: ['SYMBOL SHIFT', 'ENTER'] },
    { text: 'ENTER on Kick Off. The teams walk out and line up; when your player stands at the ball, press fire (or N) to kick off.', keys: ['ENTER', 'N'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/m/MatchDay.txt' },
    { title: 'Match Day in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/3067' },
  ],
};
