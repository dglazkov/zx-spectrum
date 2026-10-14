// The Hobbit (Melbourne House, 1982, Philip Mitchell and Veronika Megler): its play card. The words are ours, from the
// booklet (Spectrum Computing keeps it as text) and the game played on this machine. A text adventure: there is
// nothing to choose, and the card says how to type to it (web/tests/wasm/games/the-hobbit.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

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

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'Tolkien’s story as an adventure you type: you are Bilbo Baggins, setting out from your comfortable hole with Gandalf and Thorin. Each place is drawn as you arrive, and the others in the story act on their own, helping or hindering as they please.':
    'Повесть Толкина в виде приключения, где вы печатаете, что делать: вы — Бильбо Бэггинс и отправляетесь из своей уютной норы вместе с Гэндальфом и Торином. Каждое новое место рисуется на экране, когда вы туда приходите, а другие герои действуют сами по себе — помогают или мешают, как им вздумается.',
  'Travel to the Lonely Mountain, get past the dragon Smaug, and bring his treasure back home to Bilbo’s hole.':
    'Доберитесь до Одинокой горы, проберитесь мимо дракона Смауга и принесите его сокровища домой, в нору Бильбо.',
  'Type plain sentences: TAKE ALL, GO EAST, EXAMINE MAP. Several can go on one line, joined by AND or commas.':
    'Пишите простые английские фразы: TAKE ALL («взять всё»), GO EAST («идти на восток»), EXAMINE MAP («осмотреть карту»). В одной строке можно написать несколько, соединив их словом AND или запятыми.',
  'Ask others for help with SAY TO, the words in quotes: SAY TO GANDALF "READ MAP". The quote mark is SYMBOL SHIFT and P.':
    'Просите других о помощи словами SAY TO («сказать») и просьбой в кавычках: SAY TO GANDALF "READ MAP" — так вы попросите Гэндальфа прочитать карту. Кавычка набирается клавишами SYMBOL SHIFT и P.',
  'Use WAIT when you need others to catch up, and SAVE now and then: the game is full of sudden ends.':
    'Пишите WAIT («ждать»), когда нужно, чтобы другие вас догнали, а время от времени — SAVE («сохранить»): в этой игре на каждом шагу можно внезапно погибнуть.',
  'Type a command, then ENTER': 'Напечатать команду, затем ENTER',
  'Go north, at the start of a line (no ENTER)': 'Идти на север, в начале строки (без ENTER)',
  'Go south': 'Идти на юг',
  'Go west': 'Идти на запад',
  'Go east': 'Идти на восток',
  'Look around: L, then ENTER': 'Осмотреться: L, затем ENTER',
  'What you carry: I, then ENTER': 'Что у вас с собой: I, затем ENTER',
  'Do the last command again (@)': 'Повторить последнюю команду (@)',
  'When the credits show, press any key. Bilbo’s first place is drawn stroke by stroke: once the picture is finished, the game takes your typing.':
    'Когда появятся титры, нажмите любую клавишу. Первое место, где оказывается Бильбо, рисуется штрих за штрихом: как только картинка готова, можно печатать.',
  'Type a command in plain words, such as LOOK or GO EAST, and press ENTER.':
    'Напечатайте команду простыми английскими словами, например LOOK («осмотреться») или GO EAST («идти на восток»), и нажмите ENTER.',
  'The booklet, as text (Spectrum Computing)': 'Брошюра к игре, текстом (Spectrum Computing)',
  'The Hobbit in the ZXDB (Spectrum Computing)': 'The Hobbit в ZXDB (Spectrum Computing)',
};
