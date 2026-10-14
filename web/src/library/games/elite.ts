// Elite (Firebird, 1985, Torus; after Bell and Braben's original): its play card. The words are ours, from the
// instructions (Spectrum Computing keeps them as text) and the game played on this machine, from the 128K tape the page
// loads. The manual has the joystick chosen by holding it left at the first screen, or toggled with K while frozen;
// neither gave the Kempston joystick here (in a modest try), so the card treats Elite as a game for the keys and puts
// the page's arrows and fire on them: left and right roll (N, M), up dives and down climbs as a joystick would (S, X),
// fire is the laser (A) (web/tests/wasm/games/elite.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

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

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'You start at the space station over the planet Lave with a Cobra ship, a pulse laser and 100 credits. From there the galaxy is open: trade between worlds, hunt pirates, or turn pirate yourself, flying in 3D wireframe space.':
    'Вы начинаете на космической станции над планетой Lave, и у вас есть корабль Cobra, импульсный лазер и 100 кредитов. Дальше перед вами вся галактика: торгуйте между мирами, охотьтесь на пиратов или сами станьте пиратом — и всё это в трёхмерном космосе, нарисованном тонкими линиями.',
  'There is no end: make your fortune, build up your ship, and climb the combat ratings from Harmless towards Elite.':
    'Конца у игры нет: наживайте состояние, улучшайте свой корабль и поднимайтесь в боевом рейтинге от Harmless («безобидный») до Elite («элита»).',
  'Start by trading: buy what a world makes cheaply (food at a farming world) and sell it where it is wanted.':
    'Начните с торговли: покупайте то, что планета производит дёшево (еду — на сельскохозяйственной), и продавайте там, где на это есть спрос.',
  'Docking by hand is hard: buy the docking computer early, then press C near the station.':
    'Стыковаться вручную трудно: поскорее купите стыковочный компьютер, а потом нажимайте C рядом со станцией.',
  'Stay legal near the station; the police ships are tough.':
    'Возле станции не нарушайте закон: полицейские корабли очень сильны.',
  'Roll anticlockwise': 'Вращение против часовой стрелки',
  'Roll clockwise': 'Вращение по часовой стрелке',
  'Dive': 'Нырок (нос вниз)',
  'Climb': 'Подъём (нос вверх)',
  'Fire the laser': 'Стрелять из лазера',
  'Speed up': 'Прибавить скорость',
  'Slow down': 'Сбросить скорость',
  'Look forward, back, left, right': 'Смотреть вперёд, назад, влево, вправо',
  'Target a missile, fire it': 'Навести ракету и выпустить её',
  'Docking computer on or off': 'Включить или выключить стыковочный компьютер',
  'Hyperspace to the chosen system': 'Гиперпрыжок к выбранной звёздной системе',
  'Docked: launch (and 2 buy, 3 sell, 4 equip)': 'На станции: вылет (а 2 — покупка, 3 — продажа, 4 — снаряжение)',
  'Galactic chart (O: the local one)': 'Карта галактики (O — карта окрестностей)',
  'Status page': 'Сведения о пилоте и корабле',
  'Market prices': 'Цены на рынке',
  'Freeze the game (SPACE carries on)': 'Остановить игру (SPACE — продолжить)',
  'At “Load New Commander (Y/N)?” hold N for a moment to start a new game.':
    'На вопрос «Load New Commander (Y/N)?» («загрузить сохранённого командира?») нажмите и чуть подержите N — начнётся новая игра.',
  'At “Press Space, Commander” press SPACE. You are docked at Lave.':
    'При надписи «Press Space, Commander» нажмите SPACE. Ваш корабль стоит на станции у планеты Lave.',
  'Press 1 to launch. The arrows roll and dive, Left Alt fires the laser; SPACE speeds up and SYMBOL SHIFT slows down.':
    'Нажмите 1, чтобы вылететь. Стрелки вращают корабль и наклоняют его нос, левый Alt стреляет из лазера; SPACE прибавляет скорость, а SYMBOL SHIFT сбрасывает.',
  'The controls and instructions, as text (Spectrum Computing)': 'Управление и инструкция, текстом (Spectrum Computing)',
  'Elite in the ZXDB (Spectrum Computing)': 'Elite в ZXDB (Spectrum Computing)',
};
