// Exolon (Hewson, 1987, Raffaele Cecco): its play card. The words are ours, from Hewson's instructions (Spectrum
// Computing keeps them as text) and the game played on this machine, from the original tape on a 128K. At the menu 5
// chooses the Kempston joystick and 1 starts; web/tests/wasm/games/exolon.spec.ts holds that to the game.

import { byHand } from '../card';
import type { CardWords, GameCard } from '../card';

export const card: GameCard = {
  id: '0001686',
  title: 'Exolon',
  blurb:
    'A colourful run-and-gun across a hundred and twenty-five alien screens. Vitorc, a lone space trooper, blasts his way right with a hand gun and grenades, past birth pods, gun turrets and missile launchers. Find the armoured exoskeleton and he can wear it for extra protection, at the cost of points.',
  goal: 'Fight through all five zones, twenty-five screens each, from left to right, staying alive to the end.',
  tips: [
    'Tap fire to shoot; hold it for half a second to throw a grenade, which breaks gun emplacements, pods and some walls that bullets cannot.',
    'Ammunition and grenades run out: walk over the supply dumps to fill up again.',
    'The exoskeleton makes you much tougher, but finishing a zone without it is worth an extra 10,000 points.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Jump', pad: ['UP'], keys: ['Q'] },
    { does: 'Duck', pad: ['DOWN'], keys: ['A'] },
    { does: 'Shoot (tap) or throw a grenade (hold)', pad: ['FIRE'], keys: ['M'] },
  ],
  extras: [
    { key: '2', does: 'At the menu: define your own keys' },
    { key: '3', does: 'At the menu: play on the keyboard' },
    { key: '4', does: 'At the menu: an Interface 2 joystick' },
  ],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'When the menu shows, press 5 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 3 for the keyboard.',
      keys: ['5', '3'],
    },
    { text: 'Press 1 to start the game.', keys: ['1'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/e/Exolon.txt' },
    { title: 'Exolon in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1686' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'A colourful run-and-gun across a hundred and twenty-five alien screens. Vitorc, a lone space trooper, blasts his way right with a hand gun and grenades, past birth pods, gun turrets and missile launchers. Find the armoured exoskeleton and he can wear it for extra protection, at the cost of points.':
    'Яркая игра в духе «беги и стреляй»: сто двадцать пять экранов на чужой планете. Виторк, космический десантник-одиночка, пробивается вправо с пистолетом и гранатами мимо капсул, из которых вылупляются пришельцы, орудийных башен и ракетных установок. Если найти бронированный экзоскелет, Виторк может надеть его для лучшей защиты, но очков тогда будет меньше.',
  'Fight through all five zones, twenty-five screens each, from left to right, staying alive to the end.':
    'Пробейтесь слева направо через все пять зон, по двадцать пять экранов в каждой, и останьтесь в живых до самого конца.',
  'Tap fire to shoot; hold it for half a second to throw a grenade, which breaks gun emplacements, pods and some walls that bullets cannot.':
    'Коротко нажмите «огонь», чтобы выстрелить; подержите полсекунды, чтобы бросить гранату: она разбивает орудия, капсулы и некоторые стены, которые пулям не по силам.',
  'Ammunition and grenades run out: walk over the supply dumps to fill up again.':
    'Патроны и гранаты кончаются: пройдите через склад припасов, чтобы снова пополнить запас.',
  'The exoskeleton makes you much tougher, but finishing a zone without it is worth an extra 10,000 points.':
    'В экзоскелете вы гораздо крепче, но если пройти зону без него, вы получите ещё 10 000 очков.',
  'Walk left': 'Идти влево',
  'Walk right': 'Идти вправо',
  'Jump': 'Прыжок',
  'Duck': 'Пригнуться',
  'Shoot (tap) or throw a grenade (hold)': 'Выстрел (коротко) или граната (удерживать)',
  'At the menu: define your own keys': 'В меню: назначить свои клавиши',
  'At the menu: play on the keyboard': 'В меню: игра на клавиатуре',
  'At the menu: an Interface 2 joystick': 'В меню: джойстик Interface 2',
  'When the menu shows, press 5 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 3 for the keyboard.':
    'Когда появится меню, нажмите 5, чтобы играть джойстиком Kempston (стрелки и левый Alt, геймпад или экранная крестовина), или 3 — чтобы играть на клавиатуре.',
  'Press 1 to start the game.': 'Нажмите 1, чтобы начать игру.',
  'The instructions, as text (Spectrum Computing)': 'Инструкция, текстом (Spectrum Computing)',
  'Exolon in the ZXDB (Spectrum Computing)': 'Exolon в ZXDB (Spectrum Computing)',
};
