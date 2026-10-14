// Dynamite Dan (Mirrorsoft, 1985, Rod Bowkett): its play card. The words are ours, from the notes Spectrum Computing keeps
// and the game played on this machine, which also gave its keys: the menu offers J KEMPSTON, K KEYBOARD (A and S to
// walk, SPACE to jump: the default) and S SINCLAIR, and ENTER or fire starts (web/tests/wasm/games/dynamite-dan.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

export const card: GameCard = {
  id: '0001551',
  title: 'Dynamite Dan',
  blurb:
    'Dan lands his airship on the roof of Dr Blitzen’s clifftop hideout, where the doctor keeps the plans of a terrible weapon locked in a safe. The house is a maze of rooms full of strange creatures, trampolines, lifts and a river along the bottom.',
  goal: 'Find the eight sticks of dynamite scattered around the house, blow open the safe, take the plans and get back to the airship on the roof.',
  tips: [
    'Touching a creature drains your energy: eat the food you find to top it up.',
    'Do not fall too far: a long drop kills Dan. Jump down in short steps.',
    'Cross the river on a raft, walking along with it, unless you have found the oxygen bottle.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['A'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['S'] },
    { does: 'Jump (with left or right to leap)', pad: ['FIRE'], keys: ['SPACE'] },
  ],
  extras: [{ key: 'P', does: 'Pause' }],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the menu press J for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or K for the keyboard. D lets you choose your own keys.', keys: ['J', 'K'] },
    { text: 'Press ENTER (or fire) to play.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'Notes on the game, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/d/DynamiteDan.txt' },
    { title: 'Dynamite Dan in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1551' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'Dan lands his airship on the roof of Dr Blitzen’s clifftop hideout, where the doctor keeps the plans of a terrible weapon locked in a safe. The house is a maze of rooms full of strange creatures, trampolines, lifts and a river along the bottom.':
    'Дэн сажает свой дирижабль на крышу логова доктора Блитцена на вершине утёса. Там, в сейфе, доктор хранит чертежи страшного оружия. Дом — настоящий лабиринт комнат, полных странных существ, батутов и лифтов, а в самом низу течёт река.',
  'Find the eight sticks of dynamite scattered around the house, blow open the safe, take the plans and get back to the airship on the roof.':
    'Найдите восемь шашек динамита, разбросанных по дому, взорвите сейф, заберите чертежи и вернитесь к дирижаблю на крыше.',
  'Touching a creature drains your energy: eat the food you find to top it up.':
    'Каждое прикосновение к существу отнимает энергию: ешьте найденную еду, чтобы её пополнить.',
  'Do not fall too far: a long drop kills Dan. Jump down in short steps.':
    'Не падайте с большой высоты: долгое падение губит Дэна. Спускайтесь короткими прыжками.',
  'Cross the river on a raft, walking along with it, unless you have found the oxygen bottle.':
    'Переправляйтесь через реку на плоту, шагая вместе с ним, — если только вы не нашли баллон с кислородом.',
  'Walk left': 'Идти влево',
  'Walk right': 'Идти вправо',
  'Jump (with left or right to leap)': 'Прыжок (вместе с «влево» или «вправо» — в длину)',
  'Pause': 'Пауза',
  'At the menu press J for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or K for the keyboard. D lets you choose your own keys.':
    'В меню нажмите J для джойстика Kempston (стрелки и левый Alt, геймпад или экранная крестовина) или K — для клавиатуры. D позволяет выбрать свои клавиши.',
  'Press ENTER (or fire) to play.': 'Нажмите ENTER (или «огонь»), чтобы начать игру.',
  'Notes on the game, as text (Spectrum Computing)': 'Заметки об игре, текстом (Spectrum Computing)',
  'Dynamite Dan in the ZXDB (Spectrum Computing)': 'Dynamite Dan в ZXDB (Spectrum Computing)',
};
