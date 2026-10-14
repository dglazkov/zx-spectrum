// Horace Goes Skiing (Sinclair Research and Psion, 1982, William Tang of Beam Software): its play card. The words are
// ours, from the instructions on the inlay (Spectrum Computing keeps them as text) and the game played on this machine.
// It takes no joystick: the page's arrows press its Q, Z, I and P (web/tests/wasm/games/horace-goes-skiing.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

export const card: GameCard = {
  id: '0002351',
  title: 'Horace Goes Skiing',
  blurb:
    'Horace wants a day on the slopes, but his skis are in a hut across a busy road. First he dodges the traffic to hire them, then he slaloms down the mountain between the flags and around the trees.',
  goal: 'Cross the road to the ski hut, come back with skis, and ski down the course passing between each pair of flags. Make it to the finish with your skis whole.',
  tips: [
    'Horace starts with $40: being run over costs $10 in ambulance fees, and the skis cost $10 to hire.',
    'Do not linger on the road: the traffic gets heavier the longer you stay.',
    'Missing a pair of flags costs points; hitting a tree can break your skis and send you back to the road.',
  ],
  controls: [
    { does: 'Up (on the road)', pad: ['UP'], keys: ['Q'] },
    { does: 'Down', pad: ['DOWN'], keys: ['Z'] },
    { does: 'Left', pad: ['LEFT'], keys: ['I'] },
    { does: 'Right', pad: ['RIGHT'], keys: ['P'] },
  ],
  extras: [
    { key: 'S', does: 'Pause (a key on the bottom row goes on)' },
    { key: 'G+H', does: 'Give up and start again' },
  ],
  joystick: false,
  keymap: { UP: 'Q', DOWN: 'Z', LEFT: 'I', RIGHT: 'P' },
  model: '48k',
  start: byHand([
    { text: 'During the demo press any key, and again at each title page, until the road shows with your CASH at the top.', keys: ['any'] },
  ]),
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/h/HoraceGoesSkiing.txt' },
    { title: 'Horace Goes Skiing in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/2351' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'Horace wants a day on the slopes, but his skis are in a hut across a busy road. First he dodges the traffic to hire them, then he slaloms down the mountain between the flags and around the trees.':
    'Хорас хочет денёк покататься на лыжах, но лыжи выдают в домике по ту сторону оживлённой дороги. Сначала он перебегает дорогу, увёртываясь от машин, чтобы взять лыжи напрокат, а потом мчится слаломом с горы — между флажками и в обход деревьев.',
  'Cross the road to the ski hut, come back with skis, and ski down the course passing between each pair of flags. Make it to the finish with your skis whole.':
    'Перейдите дорогу к лыжному домику, вернитесь с лыжами и спуститесь по трассе, проезжая между флажками каждой пары. Доберитесь до финиша с целыми лыжами.',
  'Horace starts with $40: being run over costs $10 in ambulance fees, and the skis cost $10 to hire.':
    'В начале у Хораса 40 долларов: если его собьёт машина, «скорая помощь» обойдётся в 10 долларов, и ещё 10 долларов стоит прокат лыж.',
  'Do not linger on the road: the traffic gets heavier the longer you stay.':
    'Не задерживайтесь на дороге: чем дольше вы на ней, тем больше машин.',
  'Missing a pair of flags costs points; hitting a tree can break your skis and send you back to the road.':
    'За каждую пропущенную пару флажков снимают очки, а врезавшись в дерево, можно сломать лыжи — и тогда придётся вернуться на дорогу.',
  'Up (on the road)': 'Вверх (на дороге)',
  'Down': 'Вниз',
  'Left': 'Влево',
  'Right': 'Вправо',
  'Pause (a key on the bottom row goes on)': 'Пауза (клавиша нижнего ряда — продолжить)',
  'Give up and start again': 'Сдаться и начать заново',
  'During the demo press any key, and again at each title page, until the road shows with your CASH at the top.':
    'Во время демонстрации нажмите любую клавишу, а потом ещё раз на каждой странице заставки, пока не появится дорога с вашими деньгами (CASH) вверху экрана.',
  'The instructions from the inlay, as text (Spectrum Computing)': 'Инструкция с вкладыша, текстом (Spectrum Computing)',
  'Horace Goes Skiing in the ZXDB (Spectrum Computing)': 'Horace Goes Skiing в ZXDB (Spectrum Computing)',
};
