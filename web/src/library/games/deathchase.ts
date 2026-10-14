// 3D Deathchase (Micromega, 1983, Mervyn Estcourt): its play card. The words are ours, from the instructions on the
// inlay (Spectrum Computing keeps them as text) and the game played on this machine: at its first screen 2 chooses the
// Kempston joystick and starts the chase (web/tests/wasm/games/deathchase.spec.ts).

import { byHand, type CardWords, type GameCard } from '../card';

export const card: GameCard = {
  id: '0001303',
  title: 'Deathchase',
  blurb:
    'A motorbike chase through a forest at full tilt, drawn in 3D as the trees rush at you. You are a mercenary rider hunting enemy riders, with tanks and helicopters on the horizon by day and the forest dark by night.',
  goal: 'Chase down the two enemy riders in each sector and shoot them with your photon bolts, without hitting a tree. Clear sectors to earn more, and survive as many as you can.',
  tips: [
    'You can only fire at full speed, and only hit a rider when the range light flashes.',
    'Steer early: trees come at you faster than you think.',
    'Tanks and helicopters on the horizon are worth a shot when no rider is near.',
  ],
  controls: [
    { does: 'Steer left', pad: ['LEFT'], keys: ['1'] },
    { does: 'Steer right', pad: ['RIGHT'], keys: ['0'] },
    { does: 'Speed up', pad: ['UP'], keys: ['9'] },
    { does: 'Slow down', pad: ['DOWN'], keys: ['8'] },
    { does: 'Fire a photon bolt (any key on the bottom row)', pad: ['FIRE'], keys: ['SPACE'] },
  ],
  extras: [],
  joystick: true,
  model: '48k',
  start: byHand([{ text: 'At the first screen press 2 for the Kempston joystick (or 1 for the keyboard): the chase starts at once.', keys: ['2', '1'] }]),
  sources: [
    { title: 'The instructions from the inlay, as text (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/pub/sinclair/games-info/d/Deathchase.txt' },
    { title: 'Deathchase in the ZXDB (Spectrum Computing)', url: 'https://spectrumcomputing.co.uk/entry/1303' },
  ],
};

/** The card's words in Russian, by their English (i18n.ts). */
export const ru: CardWords = {
  'A motorbike chase through a forest at full tilt, drawn in 3D as the trees rush at you. You are a mercenary rider hunting enemy riders, with tanks and helicopters on the horizon by day and the forest dark by night.':
    'Погоня на мотоцикле через лес на полной скорости, в объёмной трёхмерной графике: деревья так и летят навстречу. Вы — наёмник на мотоцикле и охотитесь за вражескими мотоциклистами; днём на горизонте видны танки и вертолёты, а ночью лес погружается во тьму.',
  'Chase down the two enemy riders in each sector and shoot them with your photon bolts, without hitting a tree. Clear sectors to earn more, and survive as many as you can.':
    'В каждом секторе догоните двух вражеских мотоциклистов и подстрелите их фотонными зарядами, не врезавшись в дерево. Проходите сектор за сектором, чтобы заработать больше, и продержитесь как можно дольше.',
  'You can only fire at full speed, and only hit a rider when the range light flashes.':
    'Стрелять можно только на полной скорости, а попасть в мотоциклиста — только когда мигает лампочка дальности.',
  'Steer early: trees come at you faster than you think.': 'Поворачивайте заранее: деревья приближаются быстрее, чем кажется.',
  'Tanks and helicopters on the horizon are worth a shot when no rider is near.':
    'Когда мотоциклистов поблизости нет, стоит пострелять по танкам и вертолётам на горизонте.',
  'Steer left': 'Повернуть влево',
  'Steer right': 'Повернуть вправо',
  'Speed up': 'Прибавить скорость',
  'Slow down': 'Сбросить скорость',
  'Fire a photon bolt (any key on the bottom row)': 'Выстрелить фотонным зарядом (любая клавиша нижнего ряда)',
  'At the first screen press 2 for the Kempston joystick (or 1 for the keyboard): the chase starts at once.':
    'На первом экране нажмите 2 для джойстика Kempston (или 1 — для клавиатуры): погоня начнётся сразу.',
  'The instructions from the inlay, as text (Spectrum Computing)': 'Инструкция с вкладыша, текстом (Spectrum Computing)',
  'Deathchase in the ZXDB (Spectrum Computing)': 'Deathchase в ZXDB (Spectrum Computing)',
};
