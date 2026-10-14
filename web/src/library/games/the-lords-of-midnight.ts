// The Lords of Midnight (Beyond, 1984, Mike Singleton): its play card. The words are ours, from the instructions
// Spectrum Computing keeps as text and the game played on this machine. Every command is a single key, with no ENTER;
// there is no joystick (web/tests/wasm/games/the-lords-of-midnight.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

export const card: GameCard = {
  id: '0006604',
  title: 'The Lords of Midnight',
  blurb:
    'A war game told as an adventure: you see the land of Midnight through the eyes of its lords, a drawn panorama in each of eight directions. Doomdark the Witchking’s armies march from the north, and Luxor the Moonprince, through his moonring, commands the lords who join him.',
  goal: 'Win by taking Doomdark’s citadel of Ushgarak in the north with the armies you gather, or by sending Morkin alone to destroy the Ice Crown. You lose if Luxor and Morkin both fall, or Morkin falls and Xajorkith is taken.',
  tips: [
    'Split your four lords up at the start and recruit every keep and citadel you can reach.',
    'Morkin alone can approach the Ice Crown: the ice fear does not touch him.',
    'Night (U) ends the day and lets Doomdark move: do everything you can with each lord first.',
  ],
  controls: [
    { does: 'Look north (2 to 8 turn round to NE, E, SE, S, SW, W, NW)', pad: null, keys: ['1'] },
    { does: 'Move forward the way you look', pad: null, keys: ['Q'] },
    { does: 'Look the way you face', pad: null, keys: ['E'] },
    { does: 'Think: what this lord knows', pad: null, keys: ['R'] },
    { does: 'Choose: recruit, fight, seek and the like', pad: null, keys: ['T'] },
    { does: 'Night: end the day', pad: null, keys: ['U'] },
    { does: 'Be Luxor (V Morkin, B Corleth, N Rorthron)', pad: null, keys: ['C'] },
    { does: 'Answer yes (J is no)', pad: null, keys: ['G'] },
  ],
  extras: [
    { key: 'S', does: 'Save the game' },
    { key: 'D', does: 'Load a game' },
  ],
  joystick: false,
  model: '48k',
  start: byHand([
    { text: 'The game begins as soon as it loads: you are Luxor, looking out. Press a key from 1 to 8 to look around, and Q to move.', keys: ['1', '8', 'Q'] },
    { text: 'C, V, B and N are Luxor, Morkin, Corleth and Rorthron; U ends the day.', keys: ['C', 'V', 'B', 'N', 'U'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/l/LordsOfMidnightThe.txt' },
    { title: 'The Lords of Midnight in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/6604' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'A war game told as an adventure: you see the land of Midnight through the eyes of its lords, a drawn panorama in each of eight directions. Doomdark the Witchking’s armies march from the north, and Luxor the Moonprince, through his moonring, commands the lords who join him.':
    'Военная игра, рассказанная как приключение: вы смотрите на страну Midnight глазами её лордов, и в каждую из восьми сторон перед вами открывается нарисованная панорама. С севера наступают армии Doomdark, Короля-колдуна, а Luxor, Лунный принц, силой своего лунного кольца командует лордами, которые встают на его сторону.',
  'Win by taking Doomdark’s citadel of Ushgarak in the north with the armies you gather, or by sending Morkin alone to destroy the Ice Crown. You lose if Luxor and Morkin both fall, or Morkin falls and Xajorkith is taken.':
    'Чтобы победить, захватите армиями, которые вы соберёте, Ushgarak — цитадель Doomdark на севере, или отправьте Morkin одного уничтожить Ледяную корону. Вы проиграете, если погибнут и Luxor, и Morkin или если погибнет Morkin и падёт Xajorkith.',
  'Split your four lords up at the start and recruit every keep and citadel you can reach.':
    'В начале отправьте четырёх своих лордов в разные стороны и призывайте на свою сторону каждую крепость и цитадель, до которой сможете дойти.',
  'Morkin alone can approach the Ice Crown: the ice fear does not touch him.':
    'Только Morkin может подойти к Ледяной короне: ледяной страх его не берёт.',
  'Night (U) ends the day and lets Doomdark move: do everything you can with each lord first.':
    'Ночь (U) завершает день, и тогда ходит Doomdark: сначала сделайте всё, что можно, каждым лордом.',
  'Look north (2 to 8 turn round to NE, E, SE, S, SW, W, NW)': 'Смотреть на север (2–8 — на СВ, В, ЮВ, Ю, ЮЗ, З, СЗ)',
  'Move forward the way you look': 'Идти вперёд, куда смотрите',
  'Look the way you face': 'Смотреть прямо перед собой',
  'Think: what this lord knows': 'Думать: что знает этот лорд',
  'Choose: recruit, fight, seek and the like': 'Выбрать: призвать, сразиться, искать и прочее',
  'Night: end the day': 'Ночь: закончить день',
  'Be Luxor (V Morkin, B Corleth, N Rorthron)': 'Играть за Luxor (V — Morkin, B — Corleth, N — Rorthron)',
  'Answer yes (J is no)': 'Ответить «да» (J — «нет»)',
  'Save the game': 'Сохранить игру',
  'Load a game': 'Загрузить игру',
  'The game begins as soon as it loads: you are Luxor, looking out. Press a key from 1 to 8 to look around, and Q to move.':
    'Игра начинается сразу после загрузки: вы — Luxor и смотрите вдаль. Нажимайте клавиши от 1 до 8, чтобы осмотреться, и Q, чтобы идти.',
  'C, V, B and N are Luxor, Morkin, Corleth and Rorthron; U ends the day.':
    'C, V, B и N — это Luxor, Morkin, Corleth и Rorthron; U завершает день.',
  'The instructions, as text (Spectrum Computing)': 'Инструкция, текстом (Spectrum Computing)',
  'The Lords of Midnight in the ZXDB (Spectrum Computing)': 'The Lords of Midnight в ZXDB (Spectrum Computing)',
};
