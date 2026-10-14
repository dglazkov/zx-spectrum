// Batman (Ocean, 1986, Jon Ritman and Bernie Drummond): its play card. The words are ours, from Ocean's instructions
// (Spectrum Computing keeps them as text) and the game played on this machine, from the shelf's tape (release 3) on a
// 128K. The game first asks for the joystick, once only, with KEMPSTON JOYSTICK already under the bat cursor here; ENTER
// takes it, and ENTER again at the main menu plays; web/tests/wasm/games/batman.spec.ts holds that to the game.

import { byHand } from '../card';
import type { CardWords, GameCard } from '../card';

export const card: GameCard = {
  id: '0000438',
  title: 'Batman',
  blurb:
    'An isometric adventure in the Batcave. Robin has been kidnapped, and Batman must explore some hundred and fifty rooms of puzzles, traps and henchmen to find the seven scattered parts of the Batcraft and fly to the rescue.',
  goal: 'First find your Batboots, Batbag, Bat-thruster and Batbelt; then collect all seven parts of the Batcraft and reach its launch pad.',
  tips: [
    'Until you have the Batboots you cannot jump, and without the Batbag you cannot carry anything: find them first.',
    'Touch the Bat-signals as you pass them: each saves your progress, and the menu’s PLAY THE GAME can then carry on from it.',
    'Pills give extra lives, speed, high jumps or a shield for a while; the look-alike neutralizer cancels them all.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['O'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['P'] },
    { does: 'Walk up the screen', pad: ['UP'], keys: ['Q'] },
    { does: 'Walk down the screen', pad: ['DOWN'], keys: ['A'] },
    { does: 'Jump (once you have the Batboots)', pad: ['FIRE'], keys: ['M'] },
    { does: 'Pick up or drop (once you have the Batbag)', pad: null, keys: ['Z'] },
    { does: 'Jump and pick up together', pad: null, keys: ['SPACE'] },
  ],
  extras: [
    { key: '1', does: 'Pause, and from the pause, give up' },
    { key: 'CAPS SHIFT', does: 'In the menus: back to the main menu' },
  ],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'JOYSTICK SELECTION asks once only. Press any key but ENTER to move the bat cursor to KEMPSTON JOYSTICK (the arrow keys and Left Alt, a gamepad, or the touch pad; it is usually there already), or to KEYS for the keyboard, and press ENTER.',
      keys: ['ENTER'],
    },
    { text: 'At the main menu, with the bat on PLAY THE GAME, press ENTER. The first room takes a moment to draw.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/b/Batman.txt' },
    { title: 'Batman in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/438' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'An isometric adventure in the Batcave. Robin has been kidnapped, and Batman must explore some hundred and fifty rooms of puzzles, traps and henchmen to find the seven scattered parts of the Batcraft and fly to the rescue.':
    'Приключение в Бэтпещере, где всё нарисовано в объёме. Robin похищен, и Batman должен обойти около ста пятидесяти комнат с головоломками, ловушками и подручными злодеев, чтобы найти семь разбросанных частей Бэтлёта и прилететь на выручку.',
  'First find your Batboots, Batbag, Bat-thruster and Batbelt; then collect all seven parts of the Batcraft and reach its launch pad.':
    'Сначала найдите Бэтсапоги, Бэтсумку, Бэт-двигатель и Бэтпояс; затем соберите все семь частей Бэтлёта и доберитесь до его стартовой площадки.',
  'Until you have the Batboots you cannot jump, and without the Batbag you cannot carry anything: find them first.':
    'Без Бэтсапог прыгать нельзя, а без Бэтсумки ничего не унести: найдите их в первую очередь.',
  'Touch the Bat-signals as you pass them: each saves your progress, and the menu’s PLAY THE GAME can then carry on from it.':
    'Проходя мимо Бэт-сигналов, касайтесь их: каждый сохраняет пройденный путь, и пункт меню PLAY THE GAME потом продолжит игру с этого места.',
  'Pills give extra lives, speed, high jumps or a shield for a while; the look-alike neutralizer cancels them all.':
    'Таблетки дают дополнительные жизни, скорость, высокие прыжки или щит на время; похожий на них нейтрализатор отменяет всё это.',
  'Walk left': 'Идти влево',
  'Walk right': 'Идти вправо',
  'Walk up the screen': 'Идти вверх по экрану',
  'Walk down the screen': 'Идти вниз по экрану',
  'Jump (once you have the Batboots)': 'Прыжок (когда есть Бэтсапоги)',
  'Pick up or drop (once you have the Batbag)': 'Взять или положить (когда есть Бэтсумка)',
  'Jump and pick up together': 'Прыгнуть и взять одновременно',
  'Pause, and from the pause, give up': 'Пауза, а из паузы — прервать игру',
  'In the menus: back to the main menu': 'В меню: назад в главное меню',
  'JOYSTICK SELECTION asks once only. Press any key but ENTER to move the bat cursor to KEMPSTON JOYSTICK (the arrow keys and Left Alt, a gamepad, or the touch pad; it is usually there already), or to KEYS for the keyboard, and press ENTER.':
    'Экран JOYSTICK SELECTION появляется только один раз. Нажимая любую клавишу, кроме ENTER, переведите указатель-летучую мышь на KEMPSTON JOYSTICK (стрелки и левый Alt, геймпад или экранная крестовина; обычно он уже там) или на KEYS, чтобы играть на клавиатуре, затем нажмите ENTER.',
  'At the main menu, with the bat on PLAY THE GAME, press ENTER. The first room takes a moment to draw.':
    'В главном меню, когда летучая мышь стоит на PLAY THE GAME, нажмите ENTER. Первая комната появится не сразу, а через мгновение.',
  'The instructions, as text (Spectrum Computing)': 'Инструкция, текстом (Spectrum Computing)',
  'Batman in the ZXDB (Spectrum Computing)': 'Batman в ZXDB (Spectrum Computing)',
};
