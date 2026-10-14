// Starquake (Bubble Bus, 1985, Stephen Crow): its play card. The words are ours, from the inlay's instructions
// (Spectrum Computing keeps them as text) and the game played on this machine: its menu takes 1 for the Kempston
// joystick and 0 to start, and after the crash-landing message BLOB is the player's
// (web/tests/wasm/games/starquake.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

export const card: GameCard = {
  id: '0004873',
  title: 'Starquake',
  blurb:
    'A planet torn out of a black hole is about to blow up, and BLOB, a small round robot, has crash-landed on it. Below the surface lies a huge maze of caverns full of drifting creatures, teleports, lifts and strange gadgets.',
  goal: 'Find the pieces of the planet’s broken core, scattered through the caverns, and carry each one back to the core until it is whole again.',
  tips: [
    'Press down to lay a short bridge under BLOB to reach high ledges, but it crumbles after a few moments.',
    'Step onto a hover platform and push up to fly: flying is quicker, but you must land to pick anything up.',
    'Spinning tops kill at once; keep the laser for the rest, and pick up energy and ammunition packs as you go.',
  ],
  controls: [
    { does: 'Move left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Move right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Up: fly up on a platform, pick up an object', pad: ['UP'], keys: ['Q'] },
    { does: 'Down: lay a bridge, fly down', pad: ['DOWN'], keys: ['A'] },
    { does: 'Fire the laser', pad: ['FIRE'], keys: ['M'] },
  ],
  extras: [
    { key: 'SPACE', does: 'Pause (any key or the joystick carries on)' },
    { key: 'A+S+D+F+G', does: 'Give up the game (all five held)' },
  ],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the menu press 1 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 4 for the keys O, P, Q, A and M.', keys: ['1', '4'] },
    { text: 'Press 0 to start. The flight computer reports the crash landing, and then BLOB is yours.', keys: ['0'] },
  ]),
  sources: [
    { title: 'The instructions and inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/s/Starquake.txt' },
    { title: 'Starquake in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4873' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'A planet torn out of a black hole is about to blow up, and BLOB, a small round robot, has crash-landed on it. Below the surface lies a huge maze of caverns full of drifting creatures, teleports, lifts and strange gadgets.':
    'Планета, вырванная из чёрной дыры, вот-вот взорвётся, а на неё как раз рухнул BLOB — маленький круглый робот. Под поверхностью — огромный лабиринт пещер, полный парящих существ, телепортов, лифтов и странных устройств.',
  'Find the pieces of the planet’s broken core, scattered through the caverns, and carry each one back to the core until it is whole again.':
    'Найдите разбросанные по пещерам осколки разрушенного ядра планеты и относите их по одному обратно к ядру, пока оно снова не станет целым.',
  'Press down to lay a short bridge under BLOB to reach high ledges, but it crumbles after a few moments.':
    'Нажмите «вниз», и BLOB выложит под собой короткий мостик, чтобы добраться до высоких уступов; но через несколько мгновений мостик рассыпается.',
  'Step onto a hover platform and push up to fly: flying is quicker, but you must land to pick anything up.':
    'Встаньте на летающую платформу и нажмите «вверх», чтобы полететь: так быстрее, но чтобы что-нибудь подобрать, нужно приземлиться.',
  'Spinning tops kill at once; keep the laser for the rest, and pick up energy and ammunition packs as you go.':
    'Вертящиеся волчки убивают сразу; лазер берегите для остальных, а по пути подбирайте запасы энергии и патронов.',
  'Move left': 'Двигаться влево',
  'Move right': 'Двигаться вправо',
  'Up: fly up on a platform, pick up an object': '«Вверх»: взлететь на платформе, подобрать предмет',
  'Down: lay a bridge, fly down': '«Вниз»: выложить мостик, лететь вниз',
  'Fire the laser': 'Стрелять из лазера',
  'Pause (any key or the joystick carries on)': 'Пауза (любая клавиша или джойстик — продолжить)',
  'Give up the game (all five held)': 'Прервать игру (удерживать все пять клавиш)',
  'At the menu press 1 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 4 for the keys O, P, Q, A and M.':
    'В меню нажмите 1, чтобы играть джойстиком Kempston (стрелки и левый Alt, геймпад или экранная крестовина), или 4 — чтобы играть клавишами O, P, Q, A и M.',
  'Press 0 to start. The flight computer reports the crash landing, and then BLOB is yours.':
    'Нажмите 0, чтобы начать. Бортовой компьютер сообщит о крушении, и после этого BLOB в ваших руках.',
  'The instructions and inlay, as text (Spectrum Computing)': 'Инструкция и вкладыш, текстом (Spectrum Computing)',
  'Starquake in the ZXDB (Spectrum Computing)': 'Starquake в ZXDB (Spectrum Computing)',
};
