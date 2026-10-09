# Bubble Bobble: the record behind its card

The card is `web/src/library/games/bubble-bobble.ts`; `web/tests/wasm/games/bubble-bobble.spec.ts` holds it to the
game. This is where its facts came from, what the game did on this machine when they were checked, and what is still
in doubt.

## The entry, the file and the machine

- ZXDB entry **0000722**, *Bubble Bobble*, Firebird Software Ltd, 1987, "ZX-Spectrum 48K/128K", by Mike Follin and
  Andrew R. Threlfall of Software Creations, music by Tim Follin; licensed from Taito's 1986 arcade game. A search of
  the ZXInfo API for "Bubble Bobble" finds it as the only Spectrum 48K/128K game of that name (the others are the Next
  remake 0036675, an editor, a theme tune and demos). Entry 0000727 is *Bubble Run*, a different game. The shelf
  (`web/src/library/featured.json`) has 0000722.
- The page's file choice (`choose.ts`, run on both the shelf's record and ZXInfo's live one) takes
  `/pub/sinclair/games/b/BubbleBobble.tzx.zip`: the original release, a TZX before the TAP, with no machine in its
  name. It loads it on the **128K**, which is what `machineFor` makes of "48K/128K". On the 128K the game plays Tim
  Follin's tune on the AY.
- The fixture is `game-bubble-bobble.tzx`, the member `Bubble Bobble.tzx` of that zip (SHA-256 `79c8ebf2…a39c1c`,
  in `fixtures.txt`). The tape has 214 blocks and lasts 377.6 s: a BASIC loader and a 512-byte header the ROM loads,
  then Firebird's BleepLoad, about 190 turbo blocks of 265 to 273 bytes that have to be played. Loaded as the page and
  the helpers load it (ROM blocks at once, the rest played), the tape stops at frame 17,856 and the control menu is
  there at frame 17,859. That takes about 5 s of the spec's time, once, in `beforeAll`.
- The card's model is `128k`. On a 48K the same tape loads to the same menus.

## Sources

- The instructions that came with the game, a two-page scan with the Commodore's and the Spectrum's keys side by side:
  <https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0000722/BubbleBobble(EN).pdf>
- The cassette inlay (front and back): <https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0000722/BubbleBobble.jpg>
- Notes on the game from the old Spectrum Games Database, with the +2A/+3 loading fix:
  <https://spectrumcomputing.co.uk/pub/sinclair/games-info/b/BubbleBobble.txt>
- The ZXDB entry: <https://spectrumcomputing.co.uk/entry/722>, and as ZXInfo serves it:
  <https://api.zxinfo.dk/v3/games/0000722?mode=full>
- The reviews of the time, transcribed (Crash 45, October 1987, a Crash Smash at 90%; Sinclair User 68, 8/10; The
  Games Machine 3; the Hit Squad re-release in Your Sinclair 69, Crash 92 and C&VG 118):
  <http://www.zxspectrumreviews.co.uk/api/title/722>
- The arcade game: <https://en.wikipedia.org/wiki/Bubble_Bobble>

## What the manual says, against what the machine did

| The manual (Spectrum part) | On this machine |
| --- | --- |
| Both players choose from 1 keyboard (definable, one player only), 2 Sinclair (+2, +3, Interface 2), 3 Kempston, 4 cursor (Protek). | The menu reads CHOOSE CONTROL FOR PLAYER 1, the four options as listed, and waits for ever (15,000 frames watched). A digit takes it, even a tap of a single frame. Player 2's menu follows within 20 frames, with player 1's choice rubbed out. After the keyboard, player 2's menu lacks its CHOOSE CONTROL FOR PLAYER 2 line, a quirk of the game, not of the route. |
| The keyboard is definable. | There are no keys to start from: CHOOSE KEYS FOR PLAYER 1 asks LEFT, RIGHT, FIRE, JUMP in turn, then ALL OK ?. Y goes on to player 2's menu; N starts the questions again. A key held is not taken twice: the next question waits until it is let go (O held for 80 frames was taken for LEFT only). SPACE is shown as `_`. |
| Press 1 or 2 to start the game. | The title says 1 OR 2 TO PLAY, flashing, with CREDIT 6 in the corner, about 340 frames (seven seconds of black) after player 2's choice. It never moves on: four minutes watched, no demo, no high-score table. No key at the title goes back to the control menu (BREAK, 0, 3, 4, ENTER, SYMBOL SHIFT, R, C, K and SPACE were tried). 1 shows ROUND 1 and READY ! within 40 frames; they are gone, and Bub moves, by 80. 2 starts a game for two, Bub and Bob. |
| Joystick: left and right, up jumps, fire blows a bubble and joins the game. | Kempston left and right walk, up jumps (from the floor up through the ledge above, as Sinclair User put it), fire blows a bubble that flies a short way and floats up. Down does nothing. Player 2 on the Sinclair joystick plays on 6 (left), 7 (right), 9 (jump) and 0 (blow); 8 does nothing. Joining a game already going was not seen (0 and 5 were tried once, while Bub was being caught): not on the card. |
| Pause: SYMBOL SHIFT. Unpause: CAPS SHIFT. | Yes: the border turns green and the game stops until CAPS SHIFT. But only once the round is under way: the main loop that reads them (pause at 8FE7h, BREAK at 8D63h) starts about 214 frames after READY ! goes, once the monsters have dropped in. Before that the game runs from its interrupt (the foreground waits at 8E05h) and reads only the joystick or the player's keys. |
| Abort game: BREAK (CAPS SHIFT and SPACE). | Yes, once the round is under way: the title is back within about 260 frames. |
| (Commodore only) O pause, Q quit; "you start with an extra 8 credits"; "a player can join at any time by pressing fire". | Not the Spectrum's: its title shows CREDIT 6, and its keys are the ones above. |

The notes' "+2A/+3 owners may need to poke 23399,4 during control selection if it crashes" is for those models; the
page loads the game on the original 128K, where it runs as it should.

## The start route, screen by screen

The menus print in the game's own font, which `screenText` reads as `▒` wherever something is drawn, so most screens
are told apart by which text rows have anything on them, and by attributes. The control menu and the key questions
share one set of attribute bands: rows 1–2 and 20–22 are `0F` (white on blue), 4–6 yellow, 7–9 cyan, 10–12 green,
13–15 magenta, 16–18 red.

1. **The control menu, player 1.** The text has LICENSED BY FIREBIRD SOFTWARE on row 21 (ROM font). Options are on
   rows 8 (1 KEYBOARD), 11 (2 SINCLAIR), 14 (3 KEMPSTON), 17 (4 CURSOR TYPE), all drawn. The route presses 3 for the
   joystick or 1 for the keyboard (held 4 frames, then 20 to wait). The menu is drawn from the top down after loading:
   at frame 17,857 only LICENSED, at 17,858 the title bar too, at 17,859 all of it.
2. **The keys, when the keyboard was chosen.** No LICENSED, row 21 empty, rows 1 and 21 `0F`, row 1 drawn. The
   questions are drawn one under another on rows 5 (LEFT), 8 (RIGHT), 11 (FIRE), 14 (JUMP) and 17 (ALL OK ?); the
   route counts how many are drawn and answers the last: O, P, SPACE, Q, then Y.
3. **The control menu, player 2.** LICENSED again, and exactly one of rows 8, 11 and 14 empty, with row 17 drawn:
   player 1's choice rubbed out. The route presses 2 (Sinclair), or 4 where player 1 took Sinclair. A menu with only
   row 17 empty could be player 1's still being drawn, so the route waits there (see the doubts).
4. **Black**, for about 340 frames: the route waits.
5. **The title.** Rows 17 and 18, columns 10 to 23, attribute `CC` (flashing): 1 OR 2 TO PLAY; and CREDIT read on row
   23. The rest of the screen is a field of coloured stars, which the text reads as noise. The route presses 1.
6. **ROUND 1, READY !** Row 0 reads `1UP    HIGH SCORE    2UP` and row 1 the scores, in the ROM's font, with ROUND
   on row 10 and READY on row 12. The route waits.
7. **Play.** Row 0's score line without READY (or GAME OVER, which a game ends with on row 10 before the title comes
   back): done.

The route took 463 frames from player 1's menu to play with the joystick and 563 with the keyboard, the same from
every moment tried (at once, 1, 37, 600 and 3,000 frames on): the menu does not move while it waits. `within` is
1,500. It is ready at the menus, the key questions and the title, and not at BASIC on a 48K or the 128's menu.

## The controls, measured

From the start of play, with Bub walked a step away from the left wall, each control held for 25 frames changes this
many bytes of the screen's bitmap against the same frames with nothing held (`responds`):

| Control | Joystick | Keys (as the route sets them) | The other way |
| --- | --- | --- | --- |
| Walk left | LEFT: 62 | O: 62 | 0 |
| Walk right | RIGHT: 62 | P: 62 | 0 |
| Jump | UP: 62 | Q: 62 | 0 |
| Blow a bubble | FIRE: 28 | SPACE: 28 | 0 |

Under the joystick the keys do nothing, and under the keyboard the joystick does nothing (player 2 is on the Sinclair
joystick's keys either way). From the very first frame of play LEFT gives 45, as Bub only turns round against the
wall, which is why the spec walks him a step first. A bubble held for 50 frames gives fewer bytes (14 to 18) than for
25: by then it has floated up and away from where it was blown.

## The words

The blurb, goal and tips are ours. Their facts: Bub and Bob, the bubbles and the fruit (the instructions, Crash);
a hundred caves with the girlfriends to find (the inlay, Crash, The Games Machine) and the boss in the last (Crash);
bubbles flying a short way (the instructions; seen here); bursting by walking into or jumping on a bubble (the
instructions); a monster left too long breaking out (Crash); several at once for bigger bonuses and the EXTEND letters
for an extra life (the instructions, Crash); Baron von Blubba for taking too long, with no escape (the instructions,
the inlay, Crash); bouncing on bubbles with up held (the instructions). Jumping up through a ledge was seen here.

## Doubts

- **The title cannot honour a choice.** Once past the menus the game keeps its controls until it is loaded again, and
  nothing at the title leads back. The route is ready at the title and starts a game there with whatever was chosen
  before: if a person chose by hand and then asks the page for the other, the game will not be what the page says.
- **A player-1 menu one option short.** If someone picked 4 (cursor) for player 1 by hand, player 2's menu lacks only
  its last option, which the route cannot tell from player 1's menu half drawn; it waits, and the pilot gives up after
  1,500 frames. On the route's own path this never happens.
- **The pause and BREAK keys** work only once a round is under way (about four seconds in). The card's extras say
  so in words; an overlay that offers them as play begins will find them dead for those seconds.
- **`CAPS SHIFT + SPACE`** in the extras is two keys written as one string; whatever lights keys on the drawn keyboard
  has to split it.
- **Not seen on this machine**: Baron von Blubba (left alone, Bub lost all his lives to the monsters in about
  1,800 frames, 36 seconds; whether the Baron came for him was not looked for), the EXTEND bubbles, a trapped monster
  breaking free, bouncing on bubbles, and joining a game already going. They are the manual's and the reviews' words.
- **No music key** is listed anywhere, and none was looked for.
