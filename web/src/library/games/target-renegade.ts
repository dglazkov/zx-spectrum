// Target: Renegade (Imagine, 1988; Mike Lamb, Dawn Drake, Simon Butler): its play card. The words are ours, from the
// cassette inlay's instructions (Spectrum Computing keeps the text and the scans), Crash's review, and the game played on
// this machine; the start route was worked out against the game itself (web/tests/wasm/games/target-renegade.spec.ts
// holds it, and that each control moves the fighter; docs/cards/target-renegade.md is the record).
//
// The shelf loads Target-Renegade128.tap (RENGADE2.TAP) on a 128K, where the whole game is in memory once the tape has
// loaded: no further load before play. The game prints in a font of its own, white on black, so its screens are told
// apart by where the ink lies (Emulator.screenText reads each cell it cannot name as one character: any one will do) and
// the game by its panel's attributes. The menu (1 1 PLAYER, 2 2 PLAYER, 3 CONTROL OPTIONS, 4 DEFINE KEYS, 5 MUSIC ON)
// takes a key once it has been held for 3 frames, when it is let go; the high scores, which take turns with the menu
// every 15 seconds or so, go back to it at any key; 3 shows PLAYER 1 OPTIONS (1 KEYBOARD, 2 SINCLAIR 1, 3 KEMPSTON),
// which acts on the key at once, then PLAYER 2 OPTIONS (1 KEYBOARD, 2 SINCLAIR 2), which acts when the key is let go and
// goes back to the menu. Neither options screen ever times out. The keyboard is the game's own choice after loading; with
// KEMPSTON chosen it reads the joystick and not the keys, and with KEYBOARD the other way round. S pauses in either.
//
// The menu looks the same whatever has been chosen, so the route cannot see from it whether it has set the controls yet:
// it remembers that it has, for the drive it is in, by the choice the drive was given (a fresh one for each Start), from
// the moment it presses at PLAYER 1 OPTIONS.

import type { CardWords, GameCard } from '../card';
import type { Route, Screen, StartChoice } from '../start';

/** The screen's ink, row by row: a cell with anything in it is '#', an empty one ' ' (trailing spaces dropped). */
function ink(screen: Screen): string[] {
  const rows = screen.text.split('\n').map((row) => row.replace(/[^ ]/g, '#').trimEnd());
  while (rows.length < 24) rows.push('');
  return rows;
}

const pad = (n: number) => ' '.repeat(n);

/** "TARGET" and "RENEGADE" at the top, as every screen before play has them. */
const titled = (rows: string[]) => rows[0] === '' && rows[1] === `${pad(13)}######` && rows[2] === '' && rows[3] === `${pad(12)}########`;

/** The menu's five items: a digit at column 8, the words from column 11, on rows 8 to 16 (5 MUSIC ON, or OFF). */
const MENU = [`${pad(8)}#  # ######`, `${pad(8)}#  # ######`, `${pad(8)}#  ####### #######`, `${pad(8)}#  ###### ####`];
const isMenu = (rows: string[]) =>
  MENU.every((row, i) => rows[8 + 2 * i] === row) && /^ {8}# {2}##### ###?$/.test(rows[16]) && [9, 11, 13, 15, 17].every((r) => rows[r] === '');

/** The high scores: five names from column 8, their scores at columns 17 to 22, rows 8 to 16. */
const isScores = (rows: string[]) => [8, 10, 12, 14, 16].every((r) => /^ {8}#{3,6} +######$/.test(rows[r]) && rows[r].length === 23);

/** PLAYER n OPTIONS on row 8, then 1 KEYBOARD and 2 SINCLAIR n on rows 11 and 13; player 1's has 3 KEMPSTON on row 15. */
const OPTIONS = `${pad(9)}###### # #######`;
const isOptions = (rows: string[]) => rows[8] === OPTIONS && rows[11] === `${pad(10)}# ########` && rows[13] === `${pad(10)}# ######## #`;
const isPlayer1 = (rows: string[]) => isOptions(rows) && rows[15] === `${pad(10)}# ########`;
const isPlayer2 = (rows: string[]) => isOptions(rows) && rows[15] === '';

/**
 * The game: the panel below the street (1P's score in bright cyan on black, over cyan on black, at row 18 and 19,
 * columns 4–9) and the street drawn above it (every screen before play is bright white on black throughout).
 */
const panel = (s: Screen) => [4, 5, 6, 7, 8, 9].every((c) => s.attr(18, c) === 0x45 && s.attr(19, c) === 0x05);
const street = (s: Screen) => [0, 4, 8, 12, 16].some((r) => s.attr(r, 0) !== 0x47 || s.attr(r, 31) !== 0x47);

type Seen = 'menu' | 'scores' | 'player 1' | 'player 2' | 'game' | 'other';

function seen(screen: Screen): Seen {
  if (panel(screen)) return street(screen) ? 'game' : 'other';
  const rows = ink(screen);
  if (!titled(rows)) return 'other';
  if (isMenu(rows)) return 'menu';
  if (isScores(rows)) return 'scores';
  if (isPlayer1(rows)) return 'player 1';
  if (isPlayer2(rows)) return 'player 2';
  return 'other';
}

/** The drives that have set player 1's controls: by the choice each was given. */
const controlsSet = new WeakSet<StartChoice>();

const start: Route = {
  steps: [
    { text: 'If the high scores are showing, press any key for the menu. The menu takes a key when you let it go, so hold each one a moment.', keys: ['any'] },
    {
      text: 'Press 3 for CONTROL OPTIONS. For player 1 press 3 KEMPSTON to play with the joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 KEYBOARD to play with the keys. Then press 1 for player 2.',
      keys: ['3', '1'],
    },
    { text: 'Back at the menu, press 1 for a one-player game. You start on floor 2 of the car park, and the clock starts at 6:00.', keys: ['1'] },
    { text: 'A few seconds in, the first biker rides at you from the right: jump-kick him (fire and up) as he reaches you, or he knocks you flat.', keys: ['SPACE', 'Q'] },
  ],
  skills: null,
  within: 600,
  ready(screen) {
    const s = seen(screen);
    return s === 'menu' || s === 'scores' || s === 'player 1' || s === 'player 2';
  },
  next(screen, choice) {
    switch (seen(screen)) {
      case 'game':
        controlsSet.delete(choice);
        return { done: true };
      case 'scores':
        return { press: 'SPACE', hold: 4, after: 10 };
      case 'menu':
        return { press: controlsSet.has(choice) ? '1' : '3', hold: 6, after: 12 };
      case 'player 1':
        controlsSet.add(choice);
        return { press: choice.joystick ? '3' : '1', hold: 6, after: 12 };
      case 'player 2':
        return { press: '1', hold: 6, after: 12 };
      default:
        // A screen being drawn, or the panel before the street: look again shortly.
        return { wait: 2 };
    }
  },
};

export const card: GameCard = {
  id: '0004087',
  title: 'Target: Renegade',
  blurb:
    'The sequel to Renegade. Mr Big’s gang has murdered your brother Matt, and you go after Mr Big through the worst of Scumville, on foot and with your fists. It is a side-on street brawl through five scenes, each with its own gang: a multi-storey car park, a street at night, a park, a shopping mall, and Mr Big’s bar. One player, or two fighting side by side.',
  goal: 'Fight your way through all five scenes to Mr Big and beat him. You have three lives, and an energy bar that every blow you take shortens.',
  tips: [
    'The bikers in the car park ride straight at you, and a punch will not stop them: meet each one with a jump kick (fire and up) as he reaches you. It knocks him off his bike for 500 points; a few seconds later he gets up to fight on foot.',
    'The clock under the scores starts at 6:00 and keeps running when you lose a life, so keep moving.',
    'Up close, fire and the way you are facing grabs an enemy, and fire then knees him. When one is down, stand over him and press fire and down.',
    'Knock down an enemy who carries a club and pick up what he drops with fire: hitting with a weapon scores more than your fists.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['K'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['L'] },
    { does: 'Walk up the street', pad: ['UP'], keys: ['Q'] },
    { does: 'Walk down the street', pad: ['DOWN'], keys: ['A'] },
    { does: 'Punch; knee a held enemy; pick up or use a weapon', pad: ['FIRE'], keys: ['SPACE'] },
    { does: 'Punch or grab (fire and the way you face)', pad: ['FIRE', 'RIGHT'], keys: ['SPACE', 'L'] },
    { does: 'Back kick (fire and away from the way you face)', pad: ['FIRE', 'LEFT'], keys: ['SPACE', 'K'] },
    { does: 'Jump kick', pad: ['FIRE', 'UP'], keys: ['SPACE', 'Q'] },
    { does: 'Jump kick forward', pad: ['FIRE', 'UP', 'RIGHT'], keys: ['SPACE', 'Q', 'L'] },
    { does: 'Hit an enemy on the floor', pad: ['FIRE', 'DOWN'], keys: ['SPACE', 'A'] },
  ],
  extras: [
    { key: 'S', does: 'Pause; any other key carries on' },
    { key: '5', does: 'At the menu: music on or off' },
  ],
  joystick: true,
  model: '128k',
  start,
  sources: [
    { title: 'The instructions from the cassette inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/t/TargetRenegade.txt' },
    { title: 'The cassette inlay, back (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0004087/TargetRenegade_Back.jpg' },
    { title: 'Target: Renegade in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4087' },
    { title: 'Crash 52, May 1988: the review (Internet Archive)', url: 'https://archive.org/stream/crash-magazine-52/Crash_52_May_1988_djvu.txt' },
    { title: 'The map of all five scenes, by Pavero (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-maps/t/TargetRenegade_2.png' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'The sequel to Renegade. Mr Big’s gang has murdered your brother Matt, and you go after Mr Big through the worst of Scumville, on foot and with your fists. It is a side-on street brawl through five scenes, each with its own gang: a multi-storey car park, a street at night, a park, a shopping mall, and Mr Big’s bar. One player, or two fighting side by side.':
    'Продолжение игры Renegade. Банда мистера Бига убила вашего брата Мэтта, и вы идёте за мистером Бигом через самые опасные кварталы Скамвилла — пешком и с голыми кулаками. Уличная драка с видом сбоку проходит в пять этапов, и на каждом — своя банда: многоэтажная автостоянка, ночная улица, парк, торговый центр и бар мистера Бига. Играть можно одному или вдвоём, плечом к плечу.',
  'Fight your way through all five scenes to Mr Big and beat him. You have three lives, and an energy bar that every blow you take shortens.':
    'Пробейтесь через все пять этапов к мистеру Бигу и одолейте его. У вас три жизни и полоска энергии, которая укорачивается с каждым пропущенным ударом.',
  'The bikers in the car park ride straight at you, and a punch will not stop them: meet each one with a jump kick (fire and up) as he reaches you. It knocks him off his bike for 500 points; a few seconds later he gets up to fight on foot.':
    'Мотоциклисты на автостоянке едут прямо на вас, и удар кулаком их не остановит: встречайте каждого ударом ногой в прыжке («огонь» и «вверх»), когда он поравняется с вами. Так вы собьёте его с мотоцикла и получите 500 очков; через несколько секунд он поднимется и полезет в драку пешком.',
  'The clock under the scores starts at 6:00 and keeps running when you lose a life, so keep moving.':
    'Часы под очками начинают с 6:00 и идут дальше, даже когда вы теряете жизнь, так что не стойте на месте.',
  'Up close, fire and the way you are facing grabs an enemy, and fire then knees him. When one is down, stand over him and press fire and down.':
    'Вплотную «огонь» вместе с направлением, куда вы смотрите, хватает противника, а следующий «огонь» бьёт его коленом. Когда противник упал, встаньте над ним и нажмите «огонь» и «вниз».',
  'Knock down an enemy who carries a club and pick up what he drops with fire: hitting with a weapon scores more than your fists.':
    'Собейте с ног противника с дубинкой и подберите то, что он выронит, нажав «огонь»: удар оружием приносит больше очков, чем кулаком.',
  'Walk left': 'Идти влево',
  'Walk right': 'Идти вправо',
  'Walk up the street': 'Идти вверх по улице',
  'Walk down the street': 'Идти вниз по улице',
  'Punch; knee a held enemy; pick up or use a weapon': 'Удар кулаком; схваченного — коленом; взять или применить оружие',
  'Punch or grab (fire and the way you face)': 'Удар кулаком или захват («огонь» и туда, куда смотрите)',
  'Back kick (fire and away from the way you face)': 'Удар ногой назад («огонь» и в обратную сторону)',
  'Jump kick': 'Удар ногой в прыжке',
  'Jump kick forward': 'Удар ногой в прыжке вперёд',
  'Hit an enemy on the floor': 'Удар по лежачему противнику',
  'Pause; any other key carries on': 'Пауза; любая другая клавиша — продолжить',
  'At the menu: music on or off': 'В меню: включить или выключить музыку',
  'If the high scores are showing, press any key for the menu. The menu takes a key when you let it go, so hold each one a moment.':
    'Если на экране таблица рекордов, нажмите любую клавишу, чтобы перейти в меню. Меню принимает клавишу, когда её отпускают, поэтому придерживайте каждую на мгновение.',
  'Press 3 for CONTROL OPTIONS. For player 1 press 3 KEMPSTON to play with the joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 KEYBOARD to play with the keys. Then press 1 for player 2.':
    'Нажмите 3 — CONTROL OPTIONS. Для первого игрока нажмите 3 KEMPSTON, чтобы играть джойстиком (стрелки и левый Alt, геймпад или экранная крестовина), или 1 KEYBOARD, чтобы играть на клавиатуре. Затем нажмите 1 для второго игрока.',
  'Back at the menu, press 1 for a one-player game. You start on floor 2 of the car park, and the clock starts at 6:00.':
    'Вернувшись в меню, нажмите 1 — игра для одного. Вы начинаете на втором этаже автостоянки, а часы начинают отсчёт с 6:00.',
  'A few seconds in, the first biker rides at you from the right: jump-kick him (fire and up) as he reaches you, or he knocks you flat.':
    'Через несколько секунд справа на вас помчится первый мотоциклист: ударьте его ногой в прыжке («огонь» и «вверх»), когда он поравняется с вами, иначе он собьёт вас с ног.',
  'The instructions from the cassette inlay, as text (Spectrum Computing)': 'Инструкция с вкладыша кассеты, текстом (Spectrum Computing)',
  'The cassette inlay, back (Spectrum Computing)': 'Вкладыш кассеты, обратная сторона (Spectrum Computing)',
  'Target: Renegade in the ZXDB (Spectrum Computing)': 'Target: Renegade в ZXDB (Spectrum Computing)',
  'Crash 52, May 1988: the review (Internet Archive)': 'Журнал Crash, № 52, май 1988 года: рецензия (Internet Archive)',
  'The map of all five scenes, by Pavero (Spectrum Computing)': 'Карта всех пяти этапов, автор — Pavero (Spectrum Computing)',
};
