// Match Day (Ocean, 1984, Jon Ritman and Chris Clarke): its play card. The words are ours, from the instructions
// (Spectrum Computing keeps them as text) and the game played on this machine: player 1 is on the Kempston joystick
// from the start and player 2 on O, P, A, Q and N; SWAP CONTROLS on the pre-match menu trades them. The teams walk out
// and line up for close to a minute, and play begins when the side kicking off presses kick
// (web/tests/wasm/games/match-day.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

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

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'Football seen side-on from the stand, with the camera following the ball up and down the pitch. You play one team against the computer or a friend, in a single match or a cup for up to eight players.':
    'Футбол, каким его видно сбоку с трибуны: камера следует за мячом по всему полю. Вы играете за одну команду против компьютера или друга — в отдельном матче или в кубке, где могут участвовать до восьми игроков.',
  'Score more goals than the other side by full time.': 'Забейте больше голов, чем соперник, до финального свистка.',
  'You always control the player with the ball, or the one best placed to win it.':
    'Вы всегда управляете игроком с мячом или тем, кто стоит удобнее всех, чтобы мяч отобрать.',
  'At a corner or throw-in, push forward as you kick for a long ball and back for a short one.':
    'На угловом или при вбрасывании из аута бейте, нажимая вперёд, — получится длинная передача, а нажимая назад — короткая.',
  'Nod a high ball on with a header as it drops: the player jumps by himself.':
    'Когда высокий мяч опускается, сыграйте его головой: игрок подпрыгнет сам.',
  'Run left': 'Бежать влево',
  'Run right': 'Бежать вправо',
  'Run up the pitch': 'Бежать вверх по полю',
  'Run down the pitch': 'Бежать вниз по полю',
  'Kick or pass; the keeper dives; throw in': 'Удар или пас; прыжок вратаря; вбрасывание',
  'Pause (both players’ pause keys); then CAPS SHIFT gives up the match':
    'Пауза (клавиши паузы обоих игроков); затем CAPS SHIFT прерывает матч',
  'At the title press any key, and wait for the Main Menu to draw. ENTER picks the highlighted line, Play Match Day (1 player game); SYMBOL SHIFT moves down to the others.':
    'На заставке нажмите любую клавишу и подождите, пока появится главное меню, Main Menu. ENTER выбирает выделенную строку, Play Match Day (1 player game); SYMBOL SHIFT переводит выделение вниз, к остальным строкам.',
  'Player 1 starts on the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad). For the keys O, P, A, Q and N instead, press SYMBOL SHIFT three times to Swap Controls and ENTER.':
    'Игрок 1 начинает с джойстиком Kempston (стрелки и левый Alt, геймпад или экранная крестовина). Чтобы вместо него играть клавишами O, P, A, Q и N, нажмите SYMBOL SHIFT три раза, до строки Swap Controls, и затем ENTER.',
  'ENTER on Kick Off. The teams walk out and line up; when your player stands at the ball, press fire (or N) to kick off.':
    'Нажмите ENTER на строке Kick Off. Команды выходят на поле и выстраиваются; когда ваш игрок встанет у мяча, нажмите «огонь» (или N), чтобы разыграть мяч с центра поля.',
  'The instructions, as text (Spectrum Computing)': 'Инструкция, текстом (Spectrum Computing)',
  'Match Day in the ZXDB (Spectrum Computing)': 'Match Day в ZXDB (Spectrum Computing)',
};
