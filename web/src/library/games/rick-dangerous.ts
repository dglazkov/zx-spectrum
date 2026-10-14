// Rick Dangerous (Firebird, 1989; Core Design): its play card. The words are ours, from the instructions (Spectrum
// Computing keeps them as text) and the game on this machine, from the original tape on a 128K. The menu is 1 KEYBOARD,
// 2 KEMPSTON, 3 CURSOR, 4 SINCLAIR and PRESS FIRE TO START. On this machine ENTER starts it (the Kempston's fire did
// not), and the game then stops at its first story screen (SOUTH AMERICA) without going on to play, whatever is
// pressed: web/tests/wasm/games/rick-dangerous.spec.ts keeps its check skipped until that is understood.

import { byHand } from '../card';
import type { CardWords, GameCard } from '../card';

export const card: GameCard = {
  id: '0004135',
  title: 'Rick Dangerous',
  blurb:
    'An Indiana Jones spoof full of traps. Rick, adventurer and part-time stamp collector, crash-lands in the Amazon and must find his way through an Aztec temple, an Egyptian tomb and an enemy fortress, armed with a pistol, a stick and some dynamite.',
  goal: 'Get Rick through each level alive, one screen at a time, working out how every trap is sprung before it gets him.',
  tips: [
    'Almost everything is a trap: when Rick dies, remember what killed him and try another way. Shooting or poking things can set traps off safely.',
    'Bullets and dynamite are few: pick up the boxes enemies and the levels leave behind, and save the dynamite for walls and crowds.',
    'Light the dynamite and run: it hurts Rick as much as anyone.',
  ],
  controls: [
    { does: 'Walk left', pad: ['LEFT'], keys: ['Z'] },
    { does: 'Walk right', pad: ['RIGHT'], keys: ['X'] },
    { does: 'Jump (up, or up and a side)', pad: ['UP'], keys: ['O'] },
    { does: 'Duck, or crawl with left or right', pad: ['DOWN'], keys: ['K'] },
    { does: 'Shoot the gun', pad: ['FIRE', 'UP'], keys: ['ENTER', 'O'] },
    { does: 'Jab with the stick', pad: ['FIRE', 'RIGHT'], keys: ['ENTER', 'X'] },
    { does: 'Light and drop dynamite', pad: ['FIRE', 'DOWN'], keys: ['ENTER', 'K'] },
  ],
  extras: [
    { key: 'P', does: 'Pause on and off' },
    { key: 'Q', does: 'Give up: back to the start' },
  ],
  joystick: true,
  model: '128k',
  start: byHand([
    {
      text: 'At the menu press 2 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 for the keyboard.',
      keys: ['2', '1'],
    },
    { text: 'Press ENTER to start (the screen says fire), and again to go on from the story of the level.', keys: ['ENTER'] },
  ]),
  sources: [
    { title: 'The instructions, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/r/RickDangerous.txt' },
    { title: 'Rick Dangerous in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/4135' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'An Indiana Jones spoof full of traps. Rick, adventurer and part-time stamp collector, crash-lands in the Amazon and must find his way through an Aztec temple, an Egyptian tomb and an enemy fortress, armed with a pistol, a stick and some dynamite.':
    'Пародия на Индиану Джонса, полная ловушек. Rick — искатель приключений, а в свободное время собиратель марок — терпит крушение в джунглях Амазонки. Ему предстоит пройти храм ацтеков, египетскую гробницу и вражескую крепость, а с собой у него только пистолет, палка и немного динамита.',
  'Get Rick through each level alive, one screen at a time, working out how every trap is sprung before it gets him.':
    'Проведите Rick живым через каждый уровень, экран за экраном: разгадайте, как срабатывает каждая ловушка, пока она его не поймала.',
  'Almost everything is a trap: when Rick dies, remember what killed him and try another way. Shooting or poking things can set traps off safely.':
    'Здесь почти всё — ловушка: когда Rick погибнет, запомните, что его убило, и попробуйте по-другому. Выстрел или тычок палкой часто заставляет ловушку сработать без вреда для вас.',
  'Bullets and dynamite are few: pick up the boxes enemies and the levels leave behind, and save the dynamite for walls and crowds.':
    'Патронов и динамита мало: подбирайте ящики, которые остаются после врагов и попадаются на уровнях, а динамит берегите для стен и толп врагов.',
  'Light the dynamite and run: it hurts Rick as much as anyone.':
    'Подожгите динамит и бегите: взрыв опасен для Rick не меньше, чем для врагов.',
  'Walk left': 'Идти влево',
  'Walk right': 'Идти вправо',
  'Jump (up, or up and a side)': 'Прыжок (вверх или вверх и в сторону)',
  'Duck, or crawl with left or right': 'Пригнуться, а с «влево» или «вправо» — ползти',
  'Shoot the gun': 'Выстрелить из пистолета',
  'Jab with the stick': 'Ткнуть палкой',
  'Light and drop dynamite': 'Поджечь и положить динамит',
  'Pause on and off': 'Поставить или снять паузу',
  'Give up: back to the start': 'Прервать игру: обратно в начало',
  'At the menu press 2 for the Kempston joystick (the arrow keys and Left Alt, a gamepad, or the touch pad), or 1 for the keyboard.':
    'В меню нажмите 2, чтобы играть джойстиком Kempston (стрелки и левый Alt, геймпад или экранная крестовина), или 1 — чтобы играть на клавиатуре.',
  'Press ENTER to start (the screen says fire), and again to go on from the story of the level.':
    'Нажмите ENTER, чтобы начать (хотя на экране просят нажать «огонь»), и ещё раз, чтобы от рассказа об уровне перейти к игре.',
  'The instructions, as text (Spectrum Computing)': 'Инструкция, текстом (Spectrum Computing)',
  'Rick Dangerous in the ZXDB (Spectrum Computing)': 'Rick Dangerous в ZXDB (Spectrum Computing)',
};
