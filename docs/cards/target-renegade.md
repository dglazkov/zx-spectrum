# Target: Renegade: the record behind its card

The card is `web/src/library/games/target-renegade.ts`; `web/tests/wasm/games/target-renegade.spec.ts` holds it to
the game. This is where its facts came from, what the game did on this machine when they were checked, and what is
still in doubt.

## The entry, the file and the machine

- ZXDB entry **0004087**, *Target: Renegade*, Imagine Software, 1988, "ZX-Spectrum 48K/128K": code by Mike Lamb,
  graphics by Dawn Drake, design by Simon Butler, music by Jonathan Dunn (48K) and Gari Biasillo (128K), inlay art by
  Bob Wakelin; the sequel to *Renegade* (0004082), Taito's arcade game. A search of the ZXInfo API for "Target:
  Renegade" finds it first; the others are a +3 compilation (0013914), the 2015 remake *Re-Imagined* (0036470) and
  other games called *Target*. The shelf (`web/src/library/featured.json`) has 0004087. (0005190, the ZXInfo address the
  brief gave as an example, is *Terra Cresta*.)
- The page's file choice (`choose.ts`, on the shelf's record) takes `/pub/sinclair/games/t/Target-Renegade128.tap.zip`
  and loads it on the **128K**: on a 128K a file named for it comes before the original release's TZX (SpeedLock 7, two
  sides). The spec checks this choice against the shelf, so that the card's model follows the page's.
- The zip holds `RENGADE2.TAP`, an info file (which is about the first *Renegade*, by mistake) and a screenshot; the
  machine takes the first tape in a zip, `RENGADE2.TAP`. The fixture is `game-target-renegade.tap`, that member
  (SHA-256 `073f0212…6767d0ca`, in `fixtures.txt`).
- The tape is 16 plain ROM blocks, 671.6 s: a BASIC loader (`CLEAR 34815: LOAD "LOIRO" SCREEN$: POKE 23739,111:
  LOAD "main" CODE: RANDOMIZE USR 40576`), the loading screen, `main` (29,460 bytes at 34816), then five headerless
  pairs (flag 88h, 1 byte and 15,104 bytes), one a scene. Loaded as the page and the helpers load it (ROM blocks at
  once), the last block is taken at frame 101 and the menu is up at frame 111: the whole game is in memory, and there
  is no further load before play or between scenes. (On a 48K the game loads a scene at a time, as the inlay says; the
  page does not load it there.)
- The card's model is `128k`. The 128K plays the music on the AY.

## Sources

- The instructions, as text (the Hit Squad re-release's, the same controls as the original's):
  <https://spectrumcomputing.co.uk/pub/sinclair/games-info/t/TargetRenegade.txt>
- The original cassette inlay, back (story, loading, controls, the five scenes):
  <https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0004087/TargetRenegade_Back.jpg>, and Erbe's Spanish text,
  which says the same: <https://spectrumcomputing.co.uk/pub/sinclair/games-info/t/TargetRenegade(ErbeSoftwareS.A.).txt>
- The ZXDB entry: <https://spectrumcomputing.co.uk/entry/4087>, and as ZXInfo serves it:
  <https://api.zxinfo.dk/v3/games/0004087?mode=full>
- Crash 52, May 1988, a Crash Smash at 90% (weapons dropped by enemies, a points bonus for using them, three lives, an
  energy meter): <https://archive.org/stream/crash-magazine-52/Crash_52_May_1988_djvu.txt>
- The map of all five scenes, by Pavero (the car park's three floors, 2, 1 and G, down to the exit):
  <https://spectrumcomputing.co.uk/pub/sinclair/games-maps/t/TargetRenegade_2.png>
- The game, history and reviews: <https://en.wikipedia.org/wiki/Target:_Renegade>

## What the manual says, against what the machine did

| The inlay | On this machine |
| --- | --- |
| Joystick: Kempston or Sinclair; keyboard fully redefinable. | The menu reads 1 1 PLAYER, 2 2 PLAYER, 3 CONTROL OPTIONS, 4 DEFINE KEYS, 5 MUSIC ON. 3 shows PLAYER 1 OPTIONS: 1 KEYBOARD, 2 SINCLAIR 1, 3 KEMPSTON; then PLAYER 2 OPTIONS: 1 KEYBOARD, 2 SINCLAIR 2; then the menu again. No cursor joystick for either (Crash's box lists one). |
| Keys, player 1: K left, L right, Q up, A down, SPACE fire. | Yes, and they are the game's choice after loading: with no control options touched, those five keys move the fighter and the Kempston does not. With KEMPSTON chosen the joystick moves him and those keys do nothing; with KEYBOARD, the other way round. Of all forty keys in play only those five and S do anything (one player). |
| Player 2: 6 left, 7 right, 9 up, 8 down, 0 fire. | Not tried (the card is for one player). |
| With fire (facing right): up jump kick, up-left/up-right jump kick left/right, left back kick, right punch or grab, down attack a floored opponent; fire alone punch, knee, use or pick up a weapon. Reversed when facing left. | Seen, facing right at the start: fire and up leaps into a kick; fire and left kicks backwards; fire and right, and fire alone, punch (the same picture for the first 20 frames, with nobody to grab); fire, up and right leaps forward. Fire and down, with nobody on the floor, walks down, the same screen to the byte as down alone; on a floored biker it was tried at ten distances and scored nothing, so its attack is the inlay's word, not seen here. |
| Without fire: the eight directions. | Yes: left and right walk, up and down walk up and down the street (into and out of the picture). |
| Press S to pause. | Yes: everything stops, the clock too, for as long as you like; any other key carries on. S again does not. |
| Five scenes, a doorway to the next at each end. | Scene 1 is the car park, with a floor indicator G 1 2 3 above the lift, 2 lit, and an arrow down. Only scene 1 was played here. |
| (Crash) Three lives; an energy meter. | Two spare heads under the scores; left alone, the fighter is knocked down by the bikers again and again, loses a head about 45 and 60 seconds in, and GAME OVER shows in the panel about 135 seconds in; then the high scores (no name to enter with no score) and the menu. |
| (Not in the inlay) | The clock under the scores starts at 6:00 and keeps running when a life is lost: after the first, it reads on from where it was (5:09, one spare head left), and so after the second. |

The menu's 5 toggles MUSIC ON and MUSIC OFF (seen on the menu). 4 DEFINE KEYS shows PLAYER 1 KEYS, LEFT, and waits for
keys; the route never goes there.

## The start route, screen by screen

Everything before play is bright white on black (attribute 47h on every cell), in the game's own font, which
`screenText` reads as `▒` wherever a cell has ink. So the route reads each row's ink (any character but a space is ink:
`#` below) and matches the rows each screen has, under TARGET (row 1, columns 13–18) and RENEGADE (row 3, columns
12–19), rows 0 and 2 empty:

| Screen | Its rows | What it wants |
| --- | --- | --- |
| Menu | 8 `        #  # ######`, 10 the same, 12 `        #  ####### #######`, 14 `        #  ###### ####`, 16 `        #  ##### ##` (or `###` for OFF); 9, 11, 13, 15, 17 empty | 3 (CONTROL OPTIONS) until this drive has set the controls, then 1 (1 PLAYER), held 6 frames |
| High scores | 8 to 16, even rows: a name from column 8, a six-digit score at 17–22 (LOLLY 100000 … DOUGH 020000) | SPACE, held 4: any key goes back to the menu |
| Player 1 options | 8 `         ###### # #######` (PLAYER 1 OPTIONS), 11 `          # ########`, 13 `          # ######## #`, 15 `          # ########` | 3 KEMPSTON for the joystick, 1 KEYBOARD for the keys, held 6 |
| Player 2 options | the same, row 15 empty | 1 KEYBOARD, held 6 |
| The game | attributes: row 18, columns 4–9, 45h, and row 19 05h (1P's score box), and the street above (rows 0–16 not all 47h) | done |
| Anything else (a screen being cleared and drawn, 1 to 3 frames between two; the panel drawn before the street, 2 frames) | | look again in 2 frames |

The route is ready at the first four. It is not at the loading screen (the helpers' `loadGame`, looking every 10
frames, stops at the menu, at frame 120), nor at the 128's own menu.

How each screen takes a key, measured from saved moments:

- The menu acts when a key is let go, and only one held for 3 frames or more: taps of 1 and 2 frames were lost, 3 to 40
  frames were all taken. The options follow 4 frames after the key comes up, the game within 12.
- The high scores go back to the menu within 4 frames of any key going down (1, 2, 3, 4, 5, K, SPACE tried); a digit
  still held then counts at the menu when let go (1 held 10 frames from the scores started a game).
- Player 1's options act on 1, 2 or 3 within 3 frames of its going down, even a one-frame tap, and show player 2's
  while it is still held. Other keys (4, SPACE) do nothing.
- Player 2's options act on 1 or 2 when it is let go (4 frames after a one-frame tap, 63 after a 60-frame hold), and
  the menu follows a frame later. 3 and SPACE do nothing.
- Neither options screen times out (3,000 frames each). The menu and the high scores take turns, 769 frames each, with
  2 to 3 blank frames between; there is no demo.

Why the route remembers: the menu is the same to the byte (all 6,912) before and after the controls are set, so a
route that only reads the screen cannot tell "set the controls" from "start". The route keeps, in a `WeakSet`, the
`StartChoice` of each drive that has pressed at player 1's options; at the menu it presses 1 for such a drive and 3 for
any other, and it forgets the choice when the game begins. The page makes a fresh choice for each press of Start
(`ui/game.ts`), as the specs do, so each drive starts not knowing. The route therefore sets the controls every time,
whatever the game was left on: the spec starts it with the game left on KEMPSTON and asks for the keyboard.

From the menu the route takes 73 frames (3, the choice, 1, 1); from the high scores 87. Started at every 7th frame of
the attract cycle's first 1,700 (both screens and every change between them), 486 drives, all reached play in 73 to 105
frames with the control asked for and not the other. Its limit is 600.

After the game begins the fighter is his to move about 80 frames later, and the first biker reaches him about 250
frames in; the spec measures the controls 100 frames in, over 20 frames each.

## The controls, measured

Bytes of the screen's bitmap that differ after 20 frames held, against 20 frames of nothing, 100 frames into play;
the same with the Kempston chosen (pad) and with the keyboard (keys):

| Control | Pad | Keys | Bytes |
| --- | --- | --- | --- |
| Walk left | LEFT | K | 168 |
| Walk right | RIGHT | L | 164 |
| Walk up the street | UP | Q | 122 |
| Walk down the street | DOWN | A | 120 |
| Punch; knee; pick up or use a weapon | FIRE | SPACE | 132 |
| Punch or grab | FIRE + RIGHT | SPACE + L | 132 |
| Back kick | FIRE + LEFT | SPACE + K | 125 |
| Jump kick | FIRE + UP | SPACE + Q | 191 |
| Jump kick forward | FIRE + UP + RIGHT | SPACE + Q + L | 199 |
| Hit an enemy on the floor | FIRE + DOWN | SPACE + A | 120 (walking down: nobody is on the floor) |

A punch held 40 frames comes back to the standing picture (0 bytes): the spec's window is 20.

## The tips, checked

- The bikers and the jump kick: left alone, the first biker rides in from the right about 170 frames into play and
  knocks the fighter flat at about 260. A jump kick started anywhere from about 210 to 240 frames in knocks him off his
  bike (the bike rolls away, he lies in the road) and scores 500; 10 frames earlier or 5 later it misses, and a punch
  (fire, or fire and right) at any of those moments does not stop him (100 points at best, and the fighter down). He
  gets up about 220 frames later and comes on on foot, with others behind him.
- The clock: 6:00 at the start, still running after a life is lost (above).
- Grab and knee, fire and down on a floored enemy: the inlay's, not seen here.
- Weapons: picking one up with fire is the inlay's; the bonus for using one is Crash's. Not seen here.

## Doubts

- The shelf's file is not the tape as sold: it is a de-protected copy in plain ROM blocks (a loading screen named
  LOIRO, and POKE 23739,111 to hide the loader's messages), probably TOSEC's "[cr Saposoftware]" 128K tape. Its menus
  and controls are those the inlay describes, but it was not compared with the original TZX's code.
- Only the first scene was played. That the clock starts at 6:00 in every scene, and what happens when it runs out,
  were not seen.
- The route's memory is by the choice object: a caller that reused one `StartChoice` for two drives, the first given up
  part-way after choosing the controls, would have the second start without setting them again (into whatever the game
  was left on). The page and the specs make a fresh one each time. If the Route interface ever gets a per-drive memory
  (the pilot passing one to `next`), the route should use that instead.
- A person in the middle of DEFINE KEYS is not on a screen the route knows; the page waits until the menu is back.
- Keys redefined by the person are not put back: the keyboard choice plays on whatever keys player 1 has.
