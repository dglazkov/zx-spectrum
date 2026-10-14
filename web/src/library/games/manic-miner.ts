// Manic Miner (Bug-Byte, 1983, Matthew Smith): its play card. The words are ours, from the instructions on the inlay
// (Spectrum Computing keeps them as text) and the game played on this machine. It reads a Kempston joystick by itself,
// with no menu to choose it at: ENTER at the title starts (web/tests/wasm/games/manic-miner.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

export const card: GameCard = {
  id: '0003012',
  title: 'Manic Miner',
  blurb:
    'Miner Willy stumbles on a forgotten mine still worked by robots, and full of their riches. Twenty caverns stand between him and the surface, each a single screen of ledges, conveyor belts and crumbling floors patrolled by strange creatures.',
  goal: 'In each cavern, collect every flashing key and then walk into the portal before the air runs out. Three falls or bumps end the game.',
  tips: [
    'Every jump is the same arc: learn where Willy lands before you leap.',
    'A fall of more than a few rows kills Willy, so step off ledges with care.',
    'Crumbling floors give way as you stand on them: keep moving across them.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Jump on the spot', pad: ['FIRE'], keys: ['SPACE'] },
    { does: 'Jump left or right', pad: ['FIRE', 'RIGHT'], keys: ['SPACE', 'P'] },
  ],
  extras: [{ key: 'A', does: 'Pause' }],
  joystick: true,
  model: '48k',
  start: byHand([
    { text: 'At the title screen press ENTER to start. The joystick needs no choosing: the game reads it by itself. (During the demo of the caverns, ENTER first goes back to the title: press it again.)', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/m/ManicMiner.txt' },
    { title: 'Manic Miner in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/3012' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'Miner Willy stumbles on a forgotten mine still worked by robots, and full of their riches. Twenty caverns stand between him and the surface, each a single screen of ledges, conveyor belts and crumbling floors patrolled by strange creatures.':
    'Шахтёр Вилли набредает на забытую шахту, где до сих пор трудятся роботы и полно добытых ими богатств. Между ним и поверхностью — двадцать пещер, каждая на одном экране: уступы, конвейерные ленты и осыпающиеся полы, а по ним снуют странные существа.',
  'In each cavern, collect every flashing key and then walk into the portal before the air runs out. Three falls or bumps end the game.':
    'В каждой пещере соберите все мигающие ключи и войдите в портал, пока не кончился воздух. Три падения или столкновения — и игра окончена.',
  'Every jump is the same arc: learn where Willy lands before you leap.':
    'Каждый прыжок — одна и та же дуга: запомните, куда приземляется Вилли, прежде чем прыгать.',
  'A fall of more than a few rows kills Willy, so step off ledges with care.':
    'Падать Вилли можно лишь с небольшой высоты — с большей он разобьётся, так что сходите с уступов осторожно.',
  'Crumbling floors give way as you stand on them: keep moving across them.':
    'Осыпающийся пол проваливается под ногами, пока вы на нём стоите: переходите его не останавливаясь.',
  'Walk left': 'Идти влево',
  'Walk right': 'Идти вправо',
  'Jump on the spot': 'Прыжок на месте',
  'Jump left or right': 'Прыжок влево или вправо',
  'Pause': 'Пауза',
  'At the title screen press ENTER to start. The joystick needs no choosing: the game reads it by itself. (During the demo of the caverns, ENTER first goes back to the title: press it again.)':
    'На заставке нажмите ENTER, чтобы начать. Джойстик выбирать не нужно: игра сама его распознаёт. (Если идёт показ пещер, ENTER сначала вернёт на заставку — нажмите её ещё раз.)',
  'The instructions from the inlay, as text (Spectrum Computing)': 'Инструкция с вкладыша, текстом (Spectrum Computing)',
  'Manic Miner in the ZXDB (Spectrum Computing)': 'Manic Miner в ZXDB (Spectrum Computing)',
};
