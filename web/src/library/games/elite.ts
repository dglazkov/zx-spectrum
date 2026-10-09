// Elite (Firebird, 1985, Torus; after Bell and Braben's original): its play card. The words are ours, from the
// instructions (Spectrum Computing keeps them as text) and the game played on this machine, from the 128K tape the page
// loads. The manual has the joystick chosen by holding it left at the first screen, or toggled with K while frozen;
// neither gave the Kempston joystick here (in a modest try), so the card treats Elite as a game for the keys and puts
// the page's arrows and fire on them: left and right roll (N, M), up dives and down climbs as a joystick would (S, X),
// fire is the laser (A) (web/tests/wasm/games/elite.spec.ts).

import { byHand, type GameCard } from '../card';

export const card: GameCard = {
  id: '0001601',
  title: 'Elite',
  blurb:
    'You start at the space station over the planet Lave with a Cobra ship, a pulse laser and 100 credits. From there the galaxy is open: trade between worlds, hunt pirates, or turn pirate yourself, flying in 3D wireframe space.',
  goal: 'There is no end: make your fortune, build up your ship, and climb the combat ratings from Harmless towards Elite.',
  tips: [
    'Start by trading: buy what a world makes cheaply (food at a farming world) and sell it where it is wanted.',
    'Docking by hand is hard: buy the docking computer early, then press C near the station.',
    'Stay legal near the station; the police ships are tough.',
  ],
  controls: [
    { does: 'Roll anticlockwise', pad: ['LEFT'], keys: ['N'] },
    { does: 'Roll clockwise', pad: ['RIGHT'], keys: ['M'] },
    { does: 'Dive', pad: ['UP'], keys: ['S'] },
    { does: 'Climb', pad: ['DOWN'], keys: ['X'] },
    { does: 'Fire the laser', pad: ['FIRE'], keys: ['A'] },
    { does: 'Speed up', pad: null, keys: ['SPACE'] },
    { does: 'Slow down', pad: null, keys: ['SYMBOL SHIFT'] },
    { does: 'Look forward, back, left, right', pad: null, keys: ['1'] },
    { does: 'Target a missile, fire it', pad: null, keys: ['T'] },
    { does: 'Docking computer on or off', pad: null, keys: ['C'] },
    { does: 'Hyperspace to the chosen system', pad: null, keys: ['H'] },
  ],
  extras: [
    { key: '1', does: 'Docked: launch (and 2 buy, 3 sell, 4 equip)' },
    { key: 'I', does: 'Galactic chart (O: the local one)' },
    { key: 'L', does: 'Status page' },
    { key: 'K', does: 'Market prices' },
    { key: 'CAPS SHIFT', does: 'Freeze the game (SPACE carries on)' },
  ],
  joystick: false,
  keymap: { LEFT: 'N', RIGHT: 'M', UP: 'S', DOWN: 'X', FIRE: 'A' },
  model: '128k',
  start: byHand([
    { text: 'At “Load New Commander (Y/N)?” hold N for a moment to start a new game.', keys: ['N'] },
    { text: 'At “Press Space, Commander” press SPACE. You are docked at Lave.', keys: ['SPACE'] },
    { text: 'Press 1 to launch. The arrows roll and dive, Left Alt fires the laser; SPACE speeds up and SYMBOL SHIFT slows down.', keys: ['1'] },
  ]),
  sources: [
    { title: 'The controls and instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/e/Elite.txt' },
    { title: 'Elite in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1601' },
  ],
};
