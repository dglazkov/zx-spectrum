// Cybernoid (Hewson, 1988, Raffaele Cecco): its play card. The words are ours, from Hewson's instructions (Spectrum
// Computing keeps them as text) and the game played on this machine, from the 128K tape on a 128K. At the menu 5
// chooses the Kempston joystick and 1 starts; web/tests/wasm/games/cybernoid.spec.ts holds that to the game.

import { byHand } from '../card';
import type { CardWords, GameCard } from '../card';

export const card: GameCard = {
  id: '0001196',
  title: 'Cybernoid',
  blurb:
    'A tough flip-screen shoot-em-up. Pirates have raided the Federation’s depots, and you fly the Cybernoid ship through cavern after cavern of defences to win the stolen cargo back, picking up extra weapons as you go.',
  goal: 'Shoot the pirate ships, pick up the cargo they drop, and reach the depot at the end of each level before the time runs out, with enough cargo on board.',
  tips: [
    'Choose a special weapon with 1 to 5 and hold fire to use it: bombs for the big gun emplacements, the shield when a screen looks impossible.',
    'Yellow canisters from destroyed pirates top up the weapon you have chosen.',
    'Watch the coloured bar: when it is gone, you lose a ship. Do not linger once a screen is clear.',
  ],
  controls: [
    { does: 'Fly left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Fly right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Thrust up', pad: ['UP'], keys: ['Q'] },
    { does: 'Fire (held: the special weapon)', pad: ['FIRE'], keys: ['SPACE'] },
  ],
  extras: [
    { key: '1', does: 'In play: bombs (2 mines, 3 shield, 4 bouncing bombs, 5 seekers)' },
    { key: 'CAPS SHIFT + SYMBOL SHIFT', does: 'Pause' },
    { key: '1 + 5 + 6 + 7 + 8 + 9', does: 'Give up the game' },
    { key: '2', does: 'At the menu: define your own keys' },
    { key: '6', does: 'At the menu: sound on or off' },
  ],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'When the menu shows, press 5 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad); without it the game plays on the keys O, P, Q and SPACE.',
      keys: ['5'],
    },
    { text: 'Press 1 to start the game.', keys: ['1'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/c/Cybernoid.txt' },
    { title: 'Cybernoid in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1196' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'A tough flip-screen shoot-em-up. Pirates have raided the Federation’s depots, and you fly the Cybernoid ship through cavern after cavern of defences to win the stolen cargo back, picking up extra weapons as you go.':
    'Непростая стрелялка, где действие идёт от экрана к экрану. Пираты разграбили склады Федерации, и вы ведёте корабль Cybernoid сквозь пещеры, одну за другой, мимо их обороны, чтобы отбить украденный груз, а по дороге подбираете новое оружие.',
  'Shoot the pirate ships, pick up the cargo they drop, and reach the depot at the end of each level before the time runs out, with enough cargo on board.':
    'Сбивайте пиратские корабли, подбирайте груз, который они теряют, и, пока не вышло время, доберитесь до склада в конце уровня с достаточным грузом на борту.',
  'Choose a special weapon with 1 to 5 and hold fire to use it: bombs for the big gun emplacements, the shield when a screen looks impossible.':
    'Выберите особое оружие клавишами от 1 до 5 и держите «огонь», чтобы его применить: бомбы — против больших пушек, щит — когда экран кажется непроходимым.',
  'Yellow canisters from destroyed pirates top up the weapon you have chosen.':
    'Жёлтые канистры, которые остаются от сбитых пиратов, пополняют выбранное оружие.',
  'Watch the coloured bar: when it is gone, you lose a ship. Do not linger once a screen is clear.':
    'Следите за цветной полосой: когда она кончится, вы потеряете корабль. Расчистив экран, не задерживайтесь на нём.',
  'Fly left': 'Лететь влево',
  'Fly right': 'Лететь вправо',
  'Thrust up': 'Лететь вверх',
  'Fire (held: the special weapon)': 'Огонь (если удерживать — особое оружие)',
  'In play: bombs (2 mines, 3 shield, 4 bouncing bombs, 5 seekers)':
    'В игре: бомбы (2 — мины, 3 — щит, 4 — прыгающие бомбы, 5 — самонаводящиеся ракеты)',
  'Pause': 'Пауза',
  'Give up the game': 'Прервать игру',
  'At the menu: define your own keys': 'В меню: назначить свои клавиши',
  'At the menu: sound on or off': 'В меню: включить или выключить звук',
  'When the menu shows, press 5 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad); without it the game plays on the keys O, P, Q and SPACE.':
    'Когда появится меню, нажмите 5, чтобы играть джойстиком Kempston (стрелки и левый Alt, геймпад или экранная крестовина); иначе игра управляется клавишами O, P, Q и SPACE.',
  'Press 1 to start the game.': 'Нажмите 1, чтобы начать игру.',
  'The instructions, as text (Spectrum Computing)': 'Инструкция, текстом (Spectrum Computing)',
  'Cybernoid in the ZXDB (Spectrum Computing)': 'Cybernoid в ZXDB (Spectrum Computing)',
};
