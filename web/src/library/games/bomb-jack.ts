// Bomb Jack (Elite, 1986; Tehkan's 1984 arcade game): its play card. The words are ours, from Elite's instructions
// (Spectrum Computing keeps a scan) and the game played on this machine, from the original tape on a 48K. At the menu
// P chooses the Kempston joystick and 1 starts a game for one; web/tests/wasm/games/bomb-jack.spec.ts holds that to the
// game.

import { byHand } from '../card';
import type { CardWords, GameCard } from '../card';

export const card: GameCard = {
  id: '0000617',
  title: 'Bomb Jack',
  blurb:
    'Elite’s conversion of the arcade hit. Jack, a caped hero who can leap the height of the screen and glide in the air, bounds around famous places of the world collecting the bombs left there, while mummies, birds and other creatures home in on him.',
  goal: 'Collect every bomb on each screen to move on. Take them while their fuses are lit, in order, for a big bonus at the end.',
  tips: [
    'Once one bomb is collected, the next one lights: follow the lit fuses and you will score far more.',
    'Catch the bouncing P ball to turn the creatures into coins for a few seconds, and then go after them.',
    'Jack falls slowly: press fire again in mid-air to hover, and steer while he drifts.',
  ],
  controls: [
    { does: 'Move left', pad: ['LEFT'], keys: ['N'] },
    { does: 'Move right', pad: ['RIGHT'], keys: ['M'] },
    { does: 'Jump (in mid-air, hover)', pad: ['FIRE'], keys: ['X'] },
    { does: 'Jump higher (held while jumping)', pad: ['UP', 'FIRE'], keys: ['Q', 'X'] },
    { does: 'Drop faster', pad: ['DOWN'], keys: ['A'] },
  ],
  extras: [
    { key: 'K', does: 'At the menu: play on the keyboard' },
    { key: 'T', does: 'At the menu: the keyboard with turbo jump (every jump as high as it goes)' },
    { key: 'Z', does: 'At the menu: an Interface 2 joystick' },
    { key: '2', does: 'At the menu: a game for two, taking turns' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    {
      text: 'When the menu shows, press P for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or K for the keyboard.',
      keys: ['P', 'K'],
    },
    { text: 'Press 1 to start a game for one player (2 for two).', keys: ['1', '2'] },
  ]),
  sources: [
    { title: 'The instructions from the box, scanned (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0000617/BombJack(EN).pdf' },
    { title: 'Bomb Jack in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/617' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'Elite’s conversion of the arcade hit. Jack, a caped hero who can leap the height of the screen and glide in the air, bounds around famous places of the world collecting the bombs left there, while mummies, birds and other creatures home in on him.':
    'Знаменитая игра с игровых автоматов, перенесённая на Спектрум фирмой Elite. Джек, герой в плаще, который может прыгнуть на всю высоту экрана и парить в воздухе, скачет по знаменитым местам мира и собирает оставленные там бомбы, а за ним охотятся мумии, птицы и другие существа.',
  'Collect every bomb on each screen to move on. Take them while their fuses are lit, in order, for a big bonus at the end.':
    'Соберите все бомбы на экране, чтобы перейти дальше. Берите их по порядку, пока горят их фитили, и в конце получите много дополнительных очков.',
  'Once one bomb is collected, the next one lights: follow the lit fuses and you will score far more.':
    'Когда вы берёте бомбу, загорается фитиль у следующей: идите по горящим фитилям, и очков будет гораздо больше.',
  'Catch the bouncing P ball to turn the creatures into coins for a few seconds, and then go after them.':
    'Поймайте прыгающий шарик с буквой P: на несколько секунд существа превратятся в монеты, и тогда гоняйтесь за ними.',
  'Jack falls slowly: press fire again in mid-air to hover, and steer while he drifts.':
    'Джек падает медленно: нажмите «огонь» ещё раз в воздухе, чтобы зависнуть, и направляйте его, пока он плавно опускается.',
  'Move left': 'Двигаться влево',
  'Move right': 'Двигаться вправо',
  'Jump (in mid-air, hover)': 'Прыжок (в воздухе — зависнуть)',
  'Jump higher (held while jumping)': 'Прыжок выше (удерживать в прыжке)',
  'Drop faster': 'Падать быстрее',
  'At the menu: play on the keyboard': 'В меню: игра на клавиатуре',
  'At the menu: the keyboard with turbo jump (every jump as high as it goes)':
    'В меню: клавиатура с турбопрыжком (каждый прыжок — на полную высоту)',
  'At the menu: an Interface 2 joystick': 'В меню: джойстик Interface 2',
  'At the menu: a game for two, taking turns': 'В меню: игра вдвоём, по очереди',
  'When the menu shows, press P for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or K for the keyboard.':
    'Когда появится меню, нажмите P для джойстика Kempston (стрелки и левый Alt, геймпад или экранная крестовина) или K для клавиатуры.',
  'Press 1 to start a game for one player (2 for two).': 'Нажмите 1, чтобы начать игру для одного игрока (2 — для двоих).',
  'The instructions from the box, scanned (Spectrum Computing)': 'Инструкция из коробки, отсканированная (Spectrum Computing)',
  'Bomb Jack in the ZXDB (Spectrum Computing)': 'Bomb Jack в ZXDB (Spectrum Computing)',
};
