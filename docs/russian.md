# The page in Russian

The page speaks English and Russian, for people who read no English (it was asked for so that the owner's parents
could enjoy it). Everything the page says of its own is translated: its buttons, panels, settings, messages, the
controls over the screen, and each game's play card. What is not the page's own stays as it is: the games, their
titles and publishers, the manuals from the archive, the ZXDB's search results, file names, and the Spectrum itself
(its screen, its keyboard and the names on its keys).

## How it works

`web/src/i18n/i18n.ts` holds the language of the moment and the catalogues. What the page says is written in English
where it is said, and the English is how its Russian is found:

- `t('Settings')` is the words now, as a string: 'Настройки' in Russian. Blanks are named, `t('{title} is in the
  deck.', { title })`, and the Russian fills the same blanks.
- `m('Settings')` is the words as a `Msg`, to be put on the page: `h()` (ui/dom.ts) and the controls (ui/controls.ts)
  take one as a child or an attribute's value, and it follows the language by itself when it changes.
- What a panel works out afresh (a toast, the deck's status, the controls over the screen) uses `t()` each time, and
  the panel listens with `onLanguage()` to work it out again when the language changes. Nothing is reloaded.
- The same English that means two things says which, before a bar: `m('crop|Picture')` is the crop, shown as
  "Picture" in English.
- Russian plurals: a catalogue entry may be a function of the blanks, using `plural(n, ['блок', 'блока', 'блоков'])`.
- What is not the page's own is a plain string (never translated) and is marked `translate="no"` where it shows, so
  that the page's test, which looks for English left on the Russian page, passes over it.

The Russian of the page is `web/src/i18n/ru.ts`. Each play card's is in its own module, as `export const ru`, keyed
by the card's English sentences (card.ts's `cardWords`); `library/games/index.ts` adds them. The unit tests hold both
to the English: every phrase the page says in its code has its Russian, nothing is left over, the blanks match, and a
card's steps still name their keys (`web/src/i18n/ru.test.ts`, `web/src/library/card-words.test.ts`). The page's
test (`web/tests/page/language.mjs`) opens the page in Russian and finds no English of the page's own left on it.

Which language the page opens in: `?lang=ru` or `?lang=en` in the address (remembered, and taken out of the
address), else the one chosen before (the bar's language menu, or Settings), else the first of the browser's
languages that the page has, else English.

Russian letters are drawn in Golos Text (`web/src/fonts/golos-text-cyrillic.woff2`, its Cyrillic alone, OFL), as
Archivo has none; the browser fetches it only for a page with Russian on it.

## How the Russian is written

Plain, warm and short, for someone who never used an emulator. The reader is addressed as «вы», and told what to
do in the imperative: «нажмите», «выберите», «плывите». Russian typography: «ёлочки» for quotes, an em dash with
spaces (« — »), `ё` written where it is said, `…` as one character.

Kept as they are, in Latin letters: key names (K, J, SPACE, ENTER, CAPS SHIFT, SYMBOL SHIFT, BREAK, Shift, Alt,
Ctrl, Esc, F1…), what the screen of a game shows (£100 REWARD, PRESS ANY KEY, the NEAR box), game titles, company
names, ZX Spectrum and the models (48K, 128K, +2, +3, Pentagon), file formats (TAP, TZX, .z80), ZXDB, Kempston,
Sinclair, Interface 2, Protek, BASIC and its keywords (LOAD ""). A step of a card names its keys exactly as its
English does, or the page cannot set them as keycaps.

The words:

| English | Russian |
|---|---|
| the Spectrum (in a sentence) | Спектрум |
| the machine (the computer) | компьютер |
| tape, cassette | кассета |
| the deck | магнитофон |
| load (a tape) | загрузить, загрузка |
| snapshot | снимок |
| save slot | ячейка сохранения; the quick slot: быстрая ячейка |
| rewind (going back in time) | перемотка, вернуться назад |
| the shelf | полка |
| the library | библиотека |
| play card | карточка игры |
| controls | управление |
| joystick | джойстик (Kempston joystick: джойстик Kempston) |
| the pad (the touch screen's) | крестовина; the touch pad: экранная крестовина |
| fire (the button) | огонь, «огонь»; the touch pad's FIRE: ОГОНЬ |
| up, down, left, right (as presses) | «вверх», «вниз», «влево», «вправо» |
| arrow keys | стрелки |
| gamepad | геймпад |
| keyboard, key | клавиатура, клавиша |
| any key | любая клавиша |
| the menu (a game's) | меню |
| skill level | уровень сложности |
| lives, score, high scores | жизни, очки, таблица рекордов |
| inlay (the cassette's paper) | вкладыш |
| manual | инструкция |
| the border | бордюр |
| the television | телевизор |
| Settings | Настройки |
| Left Alt, Right Alt | левый Alt, правый Alt |
