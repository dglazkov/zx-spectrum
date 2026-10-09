# The page: `web/`

The Spectrum as a person meets it: the screen, the sound, the keyboard, the tape deck, and a library of the games.
It is written in TypeScript with no UI framework, built by Vite, and talks to the emulator only through one
interface (`web/src/emulator/emulator.ts`). Until the core (Rust compiled to WebAssembly) is wired in, it runs a
stand-in (`web/src/emulator/stub.ts`) that behaves plausibly, so that everything around the core is built and
tested now.

What the owner sees: a dark room lit by a television. The screen is the hero, a CRT drawn in WebGL 2 (or crisp
pixels), its border's colour glowing on the wall behind it as the stripes flicker while a tape loads. Under it, the
48K's keyboard drawn from the case's own legends, every key pressable. Beside it, a cassette whose reels turn as
the tape moves and a shelf of loved games, Saboteur first, each with its loading screen; choosing one fetches it,
switches on the right machine, types `LOAD ""` and plays the tape.

## The parts

```
web/
  index.html, src/main.ts      the page starts: the emulator and the screen together, then the app
  src/app.ts                   how the parts meet: frames, input, sound, files, rewinding, the layout
  src/emulator/emulator.ts     THE INTERFACE to the core (below)
  src/emulator/keys.ts         the forty keys, numbered as the ULA reads them (half-row × 5 + bit)
  src/emulator/index.ts        which emulator runs: wasm.ts if it exists, else the stand-in
  src/emulator/stub.ts, stub/  the stand-in, and its TAP/TZX, snapshot, zip and inflate readers
  src/clock/scheduler.ts       when to run frames: on the sound card's clock, or the display's
  src/clock/loop.ts            the heartbeat: display refreshes and the worklet's reports run frames
  src/audio/worklet.ts         the AudioWorkletProcessor: plays frames' samples, says how many it has played
  src/audio/sound.ts           the AudioContext, a 12 Hz high-pass, volume
  src/video/palette.ts         the sixteen colours (below)
  src/video/fit.ts             crops and sizes: integer scaling, PAL pixel aspect
  src/video/webgl.ts           decode (palette, PAL colour) and present (sharp, or the television)
  src/video/canvas2d.ts        the same without WebGL
  src/input/keymap.ts          the PC keyboard: natural (typing) and positional (games) mappings, joystick keys
  src/input/feeder.ts          key presses put to the machine at frame boundaries, paced as the ROM needs
  src/input/pc-keyboard.ts     the listeners;  gamepad.ts the Gamepad API;  typer.ts what LOAD "" is
  src/keyboard/legends.ts      what is printed on and around each key, from the ROM's tables
  src/keyboard/keyboard.ts     the keyboard drawn in SVG, pressable, lit when the machine has a key down
  src/library/zxinfo.ts        the ZXDB through ZXInfo; pictures; fetching archive files
  src/library/choose.ts        which file of an entry to load, on which machine
  src/library/featured.json    the shelf, recorded and checked by tools/featured.mjs
  src/state/settings.ts        what is remembered (localStorage, every access wrapped)
  src/state/rewind.ts          moments kept for going back
  src/ui/*.ts                  the building blocks (dom, controls, icons) and the panels: deck, library,
                               timeline (rewind), settings, inspector, touch pad, toasts
  server.mjs                   the production server and the pass-through (below); server.d.mts its types
  vite.config.ts               the dev server, with the same pass-through
  tools/featured.mjs           records the shelf and the test fixtures from the ZXInfo API
  tests/page.mjs               the page test in Chrome;  shot.mjs pictures;  smoke.mjs a running server
  tests/server.test.mjs        the pass-through;  tests/fixtures/zxinfo/ recorded API answers
```

Commands (in `web/`, after `npm install`): `npm run dev` (Vite at :5173), `npm run build` (into `dist/`),
`npm start` (`node server.mjs`, PORT or 8080), `npm run test:unit`, `node tests/page.mjs [words]`,
`node tests/shot.mjs [--phone] [--dpr 2] [--file tape.tzx] [--frames N] [--eval js] [--settings json] [--full]`
(pictures into `out/`), `node tests/smoke.mjs URL`, `node tools/featured.mjs [--check]`.

The page has two query switches: `?emulator=stub` (the stand-in whatever there is) and `?renderer=2d`. When it is
up, `<body>` has `data-ready`, `data-emulator` (`wasm` or `stub`) and `data-renderer`, and `window.zx` holds `{ app,
emulator, renderer, kind }`, for tests and agents.

## The Emulator interface, for whoever wires in the core

`web/src/emulator/emulator.ts` is the contract; this is what each member must do. Everything is synchronous and on
the main thread. To wire the core in, add `web/src/emulator/wasm.ts` exporting
`createWasmEmulator(): Promise<Emulator>`: `index.ts` finds it by `import.meta.glob` and uses it (falling back to
the stand-in, with a console error, if it throws). Nothing else in the page changes.

```ts
type Model = '16k' | '48k' | '128k' | 'plus2' | 'plus2a' | 'plus3' | 'pentagon';
const MODELS: Record<Model, ModelInfo>;   // { id, name, short, clockHz, frameTStates, frameRate, menu, ay }
const FRAME_WIDTH = 352, FRAME_HEIGHT = 296, PAPER_X = 48, PAPER_Y = 48;
type JoystickKind = 'none' | 'kempston' | 'sinclair1' | 'sinclair2' | 'cursor';
const JOY = { right: 1, left: 2, down: 4, up: 8, fire: 16 };   // Kempston's bits
type TapeBlockKind = 'header' | 'data' | 'turbo' | 'tone' | 'pause' | 'stop' | 'group' | 'info';
interface TapeBlock { kind; label: string; bytes?: number; seconds: number }
interface TapeState { loaded; playing; block: number; position: number /* s */; length: number /* s */ }
interface Tape { play(); stop(); rewind(); eject(); seek(index); state(): TapeState; blocks(): readonly TapeBlock[] }
interface LoadResult { kind: 'tape' | 'snapshot' | 'screen'; name: string; model?: Model; blocks?: readonly TapeBlock[] }
class LoadError extends Error {}
type AyStereo = 'mono' | 'abc' | 'acb';
interface Options { instantLoad; acceleratedLoad; autoTape; issue2; ayStereo }
interface Registers { af, bc, de, hl, af_, bc_, de_, hl_, ix, iy, sp, pc, i, r, im: number;
                      iff1, iff2, halted: boolean; t: number }
type SnapshotFormat = 'z80' | 'szx' | 'sna';

interface Emulator {
  readonly frameWidth: number; readonly frameHeight: number;   // 352 × 296
  readonly model: Model;
  readonly frameRate: number;      // MODELS[model].frameRate: 50.08 on the 48K
  readonly frameCount: number;     // frames run since it was made; never goes back (not part of a state)
  setModel(model: Model): void;    // switched on afresh as that machine; the tape stays in the deck
  reset(): void;
  runFrame(): void;
  frame(): Uint8Array;             // the last frame: 352 × 296 indices 0–15, may be a view, valid until next call
  audio(): Float32Array;           // the last frame's sound, stereo interleaved, at setSampleRate's rate
  setSampleRate(hz: number): void; // changes between frames (the page halves it at 2×)
  key(code: number, down: boolean): void;   // code = half-row × 5 + bit (keys.ts)
  releaseKeys(): void;
  joystick(kind: JoystickKind, bits: number): void;   // called only when either changes
  load(bytes: Uint8Array, name: string): LoadResult;  // TAP TZX CSW PZX, Z80 SNA SZX, SCR, or a .zip; throws LoadError
  readonly tape: Tape;
  options(): Options; setOptions(options: Partial<Options>): void;
  saveSnapshot(format: SnapshotFormat): Uint8Array;
  saveState(): Uint8Array; loadState(state: Uint8Array): void;   // fast, the core's own format, for rewinding
  peek(address: number): number; poke(address: number, value: number): void;   // as the CPU sees memory now
  registers(): Registers;
}
```

What the page relies on:

- **Time.** The page calls `runFrame()` as many times as it decides; the core never reads a clock. `frameCount`
  is the page's count of emulated time (the feeder schedules key presses by it), so it must rise by one per
  `runFrame` and must not be restored by `loadState`.
- **Picture.** `frame()` after each `runFrame()`. The page copies it for the rewind strip once a second, and
  uploads it to a texture on each display refresh that follows a new frame.
- **Sound.** `audio()` after each `runFrame()` while sound is on, at the rate last set: 958 or 959 stereo
  samples a frame at 48 kHz on the 48K, so that the count follows the clock exactly (the page sends exactly what it
  gets). At 2× the page asks for half the rate, so a frame's samples play in half the time (the tape and the
  music an octave up, as a fast-forwarded deck); flat out it does not ask for sound.
- **Keys.** `key()` is called between frames only, at most once per key per frame boundary; a press lasts at least
  one frame (the feeder sees to that). The page never presses a key the machine cannot have.
- **Loading.** `load()` must not start the tape: the page decides. With `autoTape` on, the core starts the tape
  when the ROM (or a loader) starts reading EAR and stops it when it stops, as Fuse's "auto-load" motor does; the
  page then only types `LOAD ""`. With `instantLoad`, standard ROM blocks are taken by trapping LD-BYTES; the page
  also runs flat out while the tape plays in that style, and in `accelerated` (where it also sets
  `acceleratedLoad`, for whatever acceleration the core can do). A snapshot switches the model itself and says
  which in `LoadResult.model`.
- **Tape state.** `tape.state()` is read on every display refresh (for the reels, the counter and the block
  list) and every frame (whether to run flat out), so it must be cheap. `position` and `length` are seconds of
  tape; `block` is the index under the head, `blocks().length` at the end.
- **Rewind.** `saveState()` every 50 frames; 120 of them are kept (and no more than 96 MB). `loadState()` puts the
  machine back exactly, sound and tape position included, but not the tape's contents (the tape in the deck stays
  the one there now).
- **Debugger.** `peek`, `poke` and `registers()` are read on every display refresh while the inspector (in
  Settings) is open.

## Time: the frame scheduler

`clock/scheduler.ts` decides how many frames to run, from one of two clocks, given as arguments (milliseconds) so
that tests drive them:

- **The sound card's**, once sound is on (1× or 2×): the worklet reports, whenever it finishes a frame's samples,
  how many sample frames it has played in all. The page estimates what is queued (sent − played, extrapolated
  by the time since the report) and runs frames (up to 4 at once) until 3 or more frames are queued again. The
  machine then runs at its own rate measured against the sound card's crystal, and drift between the sound card
  and the page's clock is absorbed by a frame more or less; no sample is dropped or invented. Frames are run on
  the worklet's reports as well as on display refreshes, so a hidden tab (no refreshes) keeps playing.
- **The display's**, before sound is allowed (no gesture yet), while the sound card is not running, or flat out:
  frames are owed at the frame rate by the time between refreshes; a gap over 250 ms (a hidden tab, a stall) is not
  caught up. Flat out, frames run until 11 ms of a refresh have gone (at most 64 a refresh).
- **A sound card that stops.** The system can suspend the AudioContext (a phone call, another app, a phone's
  background tab), or its device go. Its reports then stop, and extrapolating from the last one would run frames at
  the page's rate into a queue nothing plays, to be heard as late as the card was gone, with the machine frozen while
  the backlog plays out. So the extrapolation stops 100 ms past the last report (the machine waits), and the page
  follows the context's `statechange`: not running, frames go on by the display's clock, silently, and "Click for
  sound" shows again; running again, the queue is cleared and the sound card's clock takes over afresh.

The machine waits while a moment is previewed on the rewind strip. It runs flat out while it boots for a tape
the page loads by itself, and while a tape plays in the accelerated and instant styles. The latest picture is
drawn on every display refresh.

Measured (the simulation in `scheduler.test.ts`: a 48 kHz worklet in 128-sample blocks, reports 1–8 ms late, a
60 Hz page with ±1.5 ms jitter): over 10 minutes the queue stays between 2.6 and 3.9 frames, no underrun; with the
sound card's crystal 0.4% fast or slow against the page's clock, the same; frames run match samples played to
within 2 frames over 5 minutes; at 2× 6,013 frames in 60 s (2 × 50.08 × 60 = 6,010); a 150 ms stall of the page
empties the queue (one underrun, the worklet fading to silence over 5 ms rather than clicking), a 40 ms one does
not. On the display's clock, 60 s at 50, 60, 75, 120 and 144 Hz each run 3,005 ± 1 frames. The sound card
stopped for 10 s while the page refreshes at 60 Hz: fewer than 10 frames run and fewer than 11 queued (before the
100 ms cap: 500 frames run into the void), and no underrun when it plays again; a tab hidden for 100 s (reports
only, no refreshes) keeps playing with no underrun.

## The screen

**Colours** (`video/palette.ts`). The ULA makes each colour from three primaries switched on or off and a BRIGHT
bit that raises their level. I found no published colorimetric measurement of a real 48K's output: Wikipedia's
palette is a calculation and says so ("the real ZX Spectrum colours are currently unknown"); the emulators use
0xC0 or 0xD7 by convention. So the default palette is the circuit's levels: bright at full, normal at 85% of it,
which is 0.55 V against 0.65 V in Chris Smith's design of the RGB output stage for the Harlequin, his
gate-for-gate reverse-engineered 48K, and Wikipedia's own figure. A video signal's voltage is already
gamma-encoded, so 85% of the voltage is 85% of the code value: 0.85 × 255 = 216 (D8h). The other palettes: the
emulators' classic 0xC0 (Fuse, SpecIde), and a black-and-white set (BT.601 luma of the ULA levels).

- Chris Smith, "Designing the Output Driver", ZX Design blog, 2007: http://www.zxdesign.info/ddrivedesign.shtml
- Wikipedia, "ZX Spectrum graphic modes", Colour palette and its notes:
  https://en.wikipedia.org/wiki/ZX_Spectrum_graphic_modes
- Paul Farrow, "Spectrum 128 SCART Cable" (the 128's TTL RGB and BRIGHT outputs):
  https://k1.spdns.de/Vintage/Sinclair/86/Peripherals/ZX%20Spectrum%20128%20Scart%20Lead.pdf
- SpecIde's palettes (0xC0): https://github.com/MartianGirl/SpecIde, `source/src/ULA.cc`

**Crops** (`video/fit.ts`). All the border (352 × 296, as the core hands it out); as a television showed it (320
× 256 from (16, 20)); the paper alone (256 × 192). The television: a PAL line's active part is 52 µs, 364 pixels
at the ULA's 7 MHz; a set of the time overscanned, showing about 88% of it (320) and of the 288 active lines of a
field about 89% (256), centred on the frame. In sharp mode each Spectrum pixel is a whole number of device pixels
(at least one), square. In television mode a pixel is 1.054 times as wide as it is tall: 1/7 MHz against the
13.5 MHz samples of ITU-R BT.601, whose PAL pixels are 59:54 (so 13.5/7 × 59/54), over the two lines of a
576-line frame a non-interlaced Spectrum line covers: (13.5 / 7) × (59 / 54) / 2.

**WebGL 2** (`video/webgl.ts`), two passes. Decode: the indices (an R8UI texture) through the palette into an RGBA
texture of the frame's size, with mipmaps; for the television decoded as a PAL set decodes: luminance softened a
little (0.15/0.7/0.15, the RF modulator), the colour difference signals (Y'UV, BT.470) averaged over five pixels
(PAL's chroma has about 1.3 MHz against the 7 MHz pixel clock) and with the line above (the PAL delay line), which
is the real thing's colour bleed. Present: sharp, texel by texel at the integer scale; or the television: a little
barrel curve, rounded corners, each line drawn by a beam whose width grows with its brightness (σ from 0.21 to 0.37
of a line) with the dark between lines, made up for by a gain of 1.2 and a soft shoulder over the top quarter rather
than a clip (a gain of 1.7, clipped, put the beam's peak past full white for the normal colours too: normal white
and BRIGHT white came out 2.7% apart where the palette has them 18% apart, and BRIGHT all but went; now 13%), the
beam moving from pixel to pixel over the middle 40% of their boundary,
an aperture grille of RGB stripes a device pixel each (only where a Spectrum pixel is three device pixels or more,
or it beats against them), a glow from the blurred mipmaps, darker corners, a faint reflection of the room on the
glass, and the tube's dark face around the picture lit a little by it. A lost context is rebuilt. Without WebGL 2,
`canvas2d.ts` draws the same frame through the palette into an ImageData, scaled with no smoothing (a television
there is only darker gaps between lines).

The room: the page's background glows with the border's average colour (sampled down both sides of the frame,
smoothed over a few frames), and so does the shadow around the television. It can be turned off in Settings, and
is off for `prefers-reduced-motion`.

## The keyboard

**The legends** (`keyboard/legends.ts`) are the ROM's: each is what the key gives in that mode, from the 48K ROM's
own tables (KEY-TABLE at 0205h; extended mode at 022Ch and 0246h; the control codes at 0260h; symbol shift at 026Ah
and 0284h; the keyword a letter gives in K mode, token = letter + A5h, from the token table at 0095h), as Logan and
O'Hara's disassembly sets them out. `legends.test.ts` reads `roms/48.rom` and checks every legend against it. The
spellings are the case's, from photographs: the keyboard abbreviates or spaces some tokens differently: RAND
(RANDOMIZE), CONT (CONTINUE), GOTO, GOSUB, STR $, CHR $, L PRINT, L LIST, IN KEY $, VAL $, SCREEN $. Above the
digits the colour names are printed in their own colours (BLACK white-boxed, none above 8 and 9) over the CAPS
SHIFT functions (EDIT, CAPS LOCK, TRUE VIDEO, INV. VIDEO, the four outlined arrows, GRAPHICS, DELETE); on each digit
key, top right, the block graphic it types in G mode (81h + digit, 8 is 80h).

**The geometry** (`GEOMETRY`, and the placing in `keyboard.ts`) is measured, in key pitches, from a photograph of
a 48K from straight above with its top plate on (Nico Kaiser's), which shows the key faces as they come through the
plate: 0.72 × 0.52 of a pitch, wide and low, rows a pitch apart, rows starting 0, 0.49, 0.73 and −0.04 pitches in (Z
at 1.23), CAPS SHIFT 0.97 and BREAK SPACE 1.22 wide. (The first drawing took 0.78 × 0.70 from a photograph of the
bare key mat, whose keys stand taller than the plate lets them show: the legends printed above and below the keys
then had a third of a pitch between rows and came out on one line, over each other: IN KEY $ over VAL $, BIN over
CIRCLE, PEEK over FORMAT.) On the plate every legend starts 0.08 of a pitch in from its key's left edge, as on the
case (not centred): the red ones 0.12 of a pitch under the key above, the green ones just over the key below, the
colours' names 0.24 over the digits and the CAPS SHIFT functions under them; the arrows are outlined, long and low
across, shorter up and down. On a key: the letter top left, its red symbol top right (a word, as STOP or THEN,
narrower and smaller, clear of the letter), its keyword bottom right; a digit at the left, its block graphic top
right as the case prints it (a white square, the inked quarters the key's own grey inside a white frame), its red
symbol under that; the 0 slashed, its _ a long bar. The case: "sinclair" raised in the case's black on its back,
Sinclair's logotype of thick square bars, 4.2 pitches long and 0.4 high, seen by its edges; "ZX Spectrum" under it,
upright and light, 1.6 pitches long (the bold italic wordmark is the Spectrum+'s, not the 48K's); the rainbow, four
bands 0.145 of a pitch across falling 22° from upright, from the right side just under the digits down under ENTER
and SPACE to the front. The keys are the photograph's grey-blue. At phone width the keyboard is drawn again compact:
keys 0.8 of a pitch square, their main legends only, the logos smaller.

- The Complete Spectrum ROM Disassembly (Ian Logan, Frank O'Hara), as SkoolKit presents it:
  https://skoolkid.github.io/rom/ (KEY-TABLE https://skoolkid.github.io/rom/asm/0205.html, KEYBOARD
  https://skoolkid.github.io/rom/asm/02BF.html)
- Bill Bertram, "ZXSpectrum48k.jpg" (CC BY-SA 2.5): https://commons.wikimedia.org/wiki/File:ZXSpectrum48k.jpg
- Nico Kaiser, "Sinclair ZX Spectrum 48k (7160141482).jpg" (CC BY 2.0), from straight above: the geometry, the
  legends' places and sizes, the logos, the stripe, the keys' colour:
  https://commons.wikimedia.org/wiki/File:Sinclair_ZX_Spectrum_48k_(7160141482).jpg
- Multicherry, "ZX Spectrum showing rubber key mat.jpg" (CC BY-SA 4.0), the key mat and its block graphics close
  up: https://commons.wikimedia.org/wiki/File:ZX_Spectrum_showing_rubber_key_mat.jpg

Clicking or touching a drawn key presses it while held. CAPS SHIFT and SYMBOL SHIFT latch (by mouse too, as one
pointer cannot hold two keys): tapped, they stay down, lit amber, until the next key has been pressed and let go,
or until tapped again. Keys light (pressed down and glowing) whenever the machine has them down, however they got
there: the PC keyboard, the typer, a touch.

## The PC keyboard and joysticks

`input/keymap.ts` has two mappings, and 'automatic' chooses: natural until a program is loaded (a tape plays or a
snapshot loads), positional after, back to natural on a reset.

- **Natural**, for typing BASIC as on a PC: what a key types becomes the keys that type it on the Spectrum,
  whatever the PC needed. Letters (capitals with CAPS SHIFT), digits, space; every symbol on the keys with SYMBOL
  SHIFT ('"' is SYMBOL SHIFT + P, also on a UK layout's Shift+2); `[ ] { } ~ | \ ©` as extended mode then SYMBOL
  SHIFT with the key; Backspace and Delete are DELETE (CAPS SHIFT + 0), the arrows CAPS SHIFT + 5–8, Escape BREAK,
  Tab extended mode, Caps Lock CAPS LOCK, Home EDIT, End GRAPHICS; Ctrl or Alt with a key is SYMBOL SHIFT with it
  (by where the key is, as a Mac's Alt types something else). Cmd and unknown keys are left to the browser.
- **Positional**, for games: each PC key is the Spectrum key in its place; Shift is CAPS SHIFT, Ctrl and Alt
  SYMBOL SHIFT, held as long as the PC key is; Backspace and the arrows as above; PC punctuation types its symbol.
- **Joystick**: with a joystick chosen (Kempston by default; Sinclair 1, Sinclair 2, cursor, or none) the arrow
  keys and a fire key (Left Alt by default; Ctrl, Space, Tab, Z, M, Enter or Right Shift) are it, in either
  mapping, but not while the mapping is automatic and nothing is loaded: at BASIC nothing reads a joystick, and the
  arrows are the editor's cursor keys (`arrowsAreJoystick`). A gamepad (the standard mapping of the Gamepad API: left stick or the cross, any face button or trigger
  to fire, Start is ENTER, Select is SPACE) and the phone's touch pad (eight ways, and FIRE, SPACE, ENTER) are it
  too; their bits are ORed. The core turns the bits into the kind's port or keys.

**The page's own controls.** A key goes to the page, not the machine, when it is typed into a field or an open
dialog, or when it works a control the keyboard has moved to (Tab, Enter, Space, the arrows, Escape on a focused
button, link or slider), so that every control can be used without a mouse; Escape there gives the keys back to the
machine. Shift+Tab is always the page's: from the machine (where Tab is extended mode) it is the way to the
controls. A control clicked or tapped keeps no focus (app.ts lets it go on the click), so a game's Space never
presses the button last clicked, and no focus ring shows while playing.

**Pacing** (`input/feeder.ts`). Presses go to the machine at frame boundaries, each lasting a frame at least, so
none is missed between two frames. For games that is all. For typing, the ROM's KEYBOARD routine (02BF, at every
interrupt) is the constraint: it keeps the two latest keys in two sets (KSTATE), a set is freed only five frames
after its key was last seen, a key pressed again before its set is free is taken as the same press held (K-REPEAT),
and a third key while both sets are held is not taken; two keys other than the shifts down together are not read at
all. So typed keys are held 3 frames with 3 between, and each waits for a free set (and for its own set, if it is
the same key); live typing is serial (a new key lets the one before go first, in order). `feeder.test.ts` runs a
model of KEYBOARD on what the feeder does: `LOAD ""` (J, SYMBOL SHIFT + P twice, ENTER) takes 24 frames (half a
second: the second quote waits for its set) and every key registers once; a line with doubled letters and an extended-mode symbol registers exactly; a typist rolling
"hello" at 17 keys a second gets h, e, l, l, o.

**Loading a tape by itself** (`input/typer.ts`, `App.loadFile`): when a tape goes in while nothing is loaded (or
from the library), the page switches the machine on afresh, runs 150 frames flat out while it boots (the 48K's RAM
test takes about 1.3 s), types `LOAD ""` (J, SYMBOL SHIFT + P, SYMBOL SHIFT + P, ENTER) on a 16K or 48K, or ENTER on
the 128's menu (whose first item is Tape Loader; Loader on the +2A/+3), and the tape starts (by the machine when
its motor is automatic, by the page otherwise). A tape dropped while a program runs only goes in the deck, for
multi-load games.

## Sound

An AudioContext (latency hint 'interactive') is made on the first click, tap or key (browsers allow nothing
sooner; a pill on the screen says so). Its resume is not waited for: a context made on a gesture the browser does
not count (a touch's pointerdown is not one) stays suspended, and a resume it does not allow never settles; every
later gesture asks again, and the page runs on the display's clock until the context runs (above). Each frame's samples are copied and transferred to an AudioWorklet
(`audio/worklet.ts`) by message (no SharedArrayBuffer, so no cross-origin isolation is needed). It plays them in
order, reports what it has played whenever a frame's samples are done, fades to silence over 5 ms if it runs dry,
and counts underruns. A `clear` (after a rewind or reset) drops the queue and starts a new count, with a generation
number so that reports from before it are ignored. A 12 Hz high-pass takes out the beeper's resting level, and a
volume (squared) follows. Speeds: pause, 1×, 2× (sound pitched up, as said above), flat out (silent).

## The tape deck

`ui/deck.ts`: a cassette in SVG with its label (the game's name) and the Spectrum's stripes, the tape packed on
each reel by how much has played (radius² in proportion), each hub turning at the tape's speed over that reel's
radius as the tape position moves (so it spins faster as it empties, and flat out spins flat out); a three-digit
counter of seconds of tape; rewind, play (pressed down and green while the motor runs), stop, eject; the blocks
as the core lists them, with their durations, the one under the head marked and a rainbow bar for how far through
it is; click a block to wind to it. The list follows the head by scrolling itself only (scrollIntoView moved the whole
page to the deck at each block, away from the screen, on a phone). The loading style: authentic (real time, with sound and stripes), accelerated
(the real signal, flat out while the tape plays) or instant (ROM blocks trapped, the rest flat out).

## The library

**The ZXDB through ZXInfo** (`library/zxinfo.ts`). Searches go to `/v3/search` with `mode=compact`, `size=24`,
`sort=rel_desc`, `contenttype=SOFTWARE`, `machinetype=ZXSPECTRUM` (all the Spectrum's variants) and
`availability=Available`, paged by `offset` ("More"). A card shows the entry's loading screen (else a running
screen) from its `screens`: ZXInfo's own `/zxscreens/...` pictures are at `https://zxinfo.dk/media` + url (not at
spectrumcomputing.co.uk, which answers 404 for them), the archive's `/pub/...` ones at
`https://spectrumcomputing.co.uk` + url. Its title, year, publisher and machine.

- ZXInfo API v3: https://api.zxinfo.dk/v3/ (Swagger: https://api.zxinfo.dk/v3/swagger_v3.yaml; wiki:
  https://github.com/thomasheckmann/zxinfo-api-v3/wiki/ZXInfo-API-v3-documentation)
- The archive: https://spectrumcomputing.co.uk

**Deviation from docs/architecture.md: the page asks ZXInfo through its own server**, at `/zxinfo/v3/...`, not
cross-origin. Measured in Chrome (October 2026): `https://api.zxinfo.dk/v3/...` answers with a 301 to
`internal.zxinfo.dk` that carries no Access-Control-Allow-Origin, and `internal.zxinfo.dk`'s answers carry the
header twice ("*, *"), which Chrome refuses ("contains multiple values '*, *', but only one is allowed"). The
server also sends a User-Agent saying who is asking, which the API's documentation asks of its clients and a
browser cannot do.

**Choosing the file** (`library/choose.ts`). Only entries ZXDB lists as Available are loaded (Knight Lore, listed
as Distribution denied, has files in ZXDB and is refused). The machine follows ZXDB's machine type: 16K → 16K,
16K/48K and 48K → 48K, 48K/128K and 128K → 128 (for the AY music), +2 → +2, +2A/+3 and +3 → +3, Pentagon and
Scorpion → Pentagon; the Next, the ZX81, the Timex and the SAM are not loaded. Of the files: tapes before
snapshots; the game as sold before a demo, a prototype, a hack, a bugfix, a ULAplus version or an unofficial
microdrive; on a 128K a file named for the 128K first, then one for both, then one for the 48K (on a 48K, anything
but a 128K's); the original release (origin "Original release", or the first release with no origin) before
re-releases; TZX, then TAP, PZX, CSW, Z80, SZX, SNA; the plain file before one whose comment says only its version
(the later first: v1.2 before v1.0) and that before another variant ("Large Case", "(different)"). Disks and
cartridges are not loaded (the cores load no disks), and an entry with only those says so. The shelf's picks, all
checked: Saboteur.tzx (48K), SaboteurII128.tap and Cybernoid128.tap (128K), ManicMiner.tzx (not "(different)"),
JetSetWilly_2.tzx (not the pre-production tape), HobbitTheV1.2.tzx, Dizzy2-TreasureIslandDizzy.tzx (not the
bugfix), Deathchase.tzx and HoraceGoesSkiing.tzx on a 16K.

The file is fetched through `/archive` + its path, with progress on the card, and loaded as above with the entry's
title on the cassette. A second game chosen while one is coming supersedes it (its fetch is aborted; a double click
fetches once). The Content-Length is used for progress only: a body sent compressed is longer decoded than it.

**The shelf** (`library/featured.json`, written by `node tools/featured.mjs`, which asks the API for each and
leaves off any that is not Available; `--check` only checks): Saboteur!, Saboteur II, Manic Miner, Jet Set Willy,
Head over Heels, Elite, The Lords of Midnight, Skool Daze, Match Day, Dynamite Dan, Starquake, Fairlight, Batty,
Bomb Jack, Exolon, Cybernoid, Rick Dangerous, Batman, Target: Renegade, Bubble Bobble, Treasure Island Dizzy, The
Hobbit, Deathchase, Ant Attack, Horace Goes Skiing, Daley Thompson's Decathlon, Arkanoid: 27, all Available on
2026-10-08. Loved games listed as Distribution denied were left off: Knight Lore, Atic Atac, Chuckie Egg, R-Type,
Ghosts 'n Goblins.

## The server

`web/server.mjs` hands out `dist/` from memory, read and compressed once at start (Brotli 9 and gzip 9; hashed
`/assets/` immutable for a year, `/fonts/` a week, the rest `no-cache`), with no path from a URL to the disk, and
passes two prefixes through, streamed, nothing kept on disk:

| Prefix | To | Paths | Cap | Timeout | Cache |
|---|---|---|---|---|---|
| `/archive/` | `https://spectrumcomputing.co.uk/` | `/pub/sinclair/...` and `/zxdb/sinclair/...` only | 16 MB | 20 s | a day |
| `/zxinfo/v3/` | `https://api.zxinfo.dk/v3/` (query passed) | `/search`, `/games/<id>`, `/suggest/<term>` only | 4 MB | 15 s | 10 min |

A path is decoded once, refused with any `.` or `..` or empty segment, backslash or control character, checked
against the route, and each segment re-encoded, so that what reaches the archive is exactly what was checked.
Redirects are followed only to the route's own hosts (spectrumcomputing.co.uk, www.; api. and internal.zxinfo.dk),
three at most; a body past the cap is cut off (by its Content-Length at once, else as it streams). An origin's
Content-Length is passed on only for a body sent as it is: fetch hands the body over decoded, so the length of a
compressed one would be wrong (the client then saw the connection cut: tested with a gzipping origin). What comes
through carries `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`, so an HTML answer (the
archive's 404 pages are HTML) opened on this origin runs nothing. A client that goes mid-body stops the upstream
read rather than waiting for a drain that never comes. Other paths under those prefixes are 403; methods other than
GET and HEAD 405; upstream failures 502, timeouts 504. No cross-origin isolation headers. The dev server (`vite.config.ts`) uses the same `passThrough`. `startServer(root, port)` runs
when the file is run (`node server.mjs`, PORT or 8080), and stops on SIGTERM after what is in flight. For an image:
`npm ci && npm run build` in `web/`, then `node server.mjs` beside `dist/`.

## Rewind, snapshots, files, settings

- **Rewind**: a moment (the whole state and the picture) every 50 frames, the last 120 (two minutes at 1×). The
  strip under the screen shows a sliver of each moment's average colour, newest at the right; pressing on it shows
  that moment's picture (the machine waits), dragging moves through them, letting go goes back to it (and the later
  ones are let go); arrow keys, Enter and Escape do the same from the keyboard.
- **Snapshots**: Snapshot → .z80 or .szx (the core's `saveSnapshot`), named after what is loaded.
- **Files**: dropped anywhere on the page (an overlay says what it takes), or Open: TAP, TZX, CSW, PZX, Z80, SNA,
  SZX, SCR, or a .zip of one.
- **Settings**, remembered in localStorage (every access in try/catch; anything missing or of the wrong type is the
  default): model, display, crop, palette, room glow, keyboard mapping, joystick, arrows as joystick, fire key,
  loading style, automatic motor, Issue 2, AY stereo, volume, mute, keyboard shown.
- **Inspector** (in Settings, "Inside the machine"): the registers and 128 bytes of memory at an address, live while
  open, and a POKE (decimal, or hex with # or $).

## The stand-in emulator

`emulator/stub.ts` runs no Z80. It keeps a 48K's memory and draws it as the ULA does (bitmap thirds, attributes,
BRIGHT, FLASH every 16 frames, the border a line at a time), in the ROM's font from 3D00h of `roms/48.rom`, and acts
out what a person sees: the RAM test's red lines, then the copyright (or, on the 128 family, the menu with its
title bar's stripes); keys echoed on the bottom line in the ROM's keywords (from its token table: J in K mode is
LOAD), with K/L/E/C cursor flashing; `LOAD ""` and ENTER (or ENTER on the menu) starting the tape; its own TAP and
TZX reader (blocks 10–14 as pulses with the ROM's and the blocks' timings; 15, 18, 19 as silence of their length;
20, 2A, 30–32 and the rest listed or skipped) playing the tape edge by edge, the border in the loader's colours
(red and cyan in the pilot and sync, blue and yellow in the data, white between blocks, as LD-EDGE's CPL and
XOR 3 make them), the tape's sound through the speaker, a header's name printed ("Bytes: PICTURE"), and any block
the size of the screen (6912 bytes, with or without flag and checksum) written to it as it loads, so a loading
screen appears line by line; instant loading of standard blocks; snapshots read (.z80 v1–v3, .sna, .szx with its
zlib pages) and written (.z80 v1, .sna, .szx 1.4: 48K); .zip through its own inflate (after Mark Adler's puff.c,
RFC 1951; ZIP per PKWARE's APPNOTE); its own state for rewinding; plausible registers. Everything a game does after
loading is beyond it: the about box in Settings says so.

- TZX 1.20: https://worldofspectrum.net/TZXformat.html; .z80: https://worldofspectrum.org/faq/reference/z80format.htm;
  ZX-State (.szx): https://www.spectaculator.com/docs/zx-state/intro.shtml; puff.c:
  https://github.com/madler/zlib/blob/master/contrib/puff/puff.c; APPNOTE:
  https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

## Type and colour

One family, Archivo (Omnibus-Type, SIL OFL 1.1, `web/src/fonts/`, bundled), from narrow (the key legends, at
80% width, close to the case's condensed grotesque) to its italic 800 (the "ZX Spectrum" wordmark). The page is a
near-black with a violet cast (#0c0b0f), warm off-white text, and the Spectrum's rainbow (red #e3342b, yellow
#f6c51e, green #4fb447, cyan #1d9fd8, taken from the case's stripe) for accents: the stripe, progress bars, a
latched shift's amber, the played tape's green. The small print (#86818f) is 5:1 on the page and its panels (it
was 3.7:1, under WCAG AA for its 12 px). At phone width (below 760 px) the page is one column with 16 px
gutters, the toolbar keeps sound, open, reset and settings, the keyboard shows only its main legends larger, and the
touch pad appears on touch screens.

## Tests

| Layer (nerd.toml) | What | How long |
|---|---|---|
| `web-types` | `tsc --noEmit` (TypeScript 7), strict, over src, vite.config.ts, server.d.mts | 1 s |
| `web-unit` | Vitest, 83 tests in 10 files (below) | 4 s |
| `web-page` | Chrome (playwright-core, `/usr/bin/google-chrome`, SwiftShader WebGL), 18 parts, 4 at a time | 40 s |

Unit (`web/src/**/*.test.ts`, `web/tests/server.test.mjs`): the key mappings (every typable character, both
mappings, the joystick keys, the arrows as cursor keys at BASIC); the feeder against a model of the ROM's KEYBOARD
routine (above); the scheduler on simulated clocks (above, with the sound card stopped and the tab hidden); the file chosen from recorded ZXInfo answers (Saboteur's original TZX on a 48K,
Cybernoid's 128K tape on a 128K, International Match Day's TZX on a 128K, Bomb Jack+'s snapshot, a disk-only entry
refused with its reason, Knight Lore refused as Distribution denied, the plain file and later version, the machine
names, every shelf entry Available and loadable, the search's query); the legends against `roms/48.rom`'s tables;
the stand-in (boot, typing, a whole tape loaded with the stripes and the sound and the header's name and the screen,
instant loading, the 128's menu, a .zip, snapshots round-tripped in each format, states, inflate against zlib at
levels 0, 1 and 9, a TZX's blocks); fit and crops; rewind; settings with refusing storage; the pass-through's
paths (13 refused spellings, among them encoded `..`, `\`, NUL, `//`) and against an origin of the test's own
(redirects on and off the host, 404 passed on, the size cap by length and by streaming, 403, a gzipping origin's
body handed over whole, the sandbox CSP on what comes through). The fixtures
(`web/tests/fixtures/zxinfo/`) are the API's own answers, which ZXInfo's metadata licence lets us keep.

Page (`web/tests/page.mjs`), each part on fresh pages, time moved by the test through Playwright's `page.clock`
(paused once the page is ready), the network answered from recordings (searches, entries, the archive with a zip
the test makes, pictures with a one-pixel PNG), any console error failing the part: ready on the stand-in in WebGL
2 with 40 keys and 27 shelf cards; renders (the border read back as 216,216,216, ink in the © cell, 149–150 frames
in 3 s of the page's clock); the television and the 2D canvas; a drawn key (lit while held, J's down and up in the
key log) and a latched SYMBOL SHIFT before P; the PC keyboard (j, then Shift+' twice: J, SYMBOL SHIFT+P ×2, no CAPS
SHIFT, and the bottom line reads LOAD "" in the ROM's font); a tape from a file (LOAD "" typed as 33,36,25,36,25,30,
the border in the pilot's colours, then flat out to the end, the loaded screen's ink white on bright blue); the
library (a search, the card, the request to `/archive/pub/sinclair/games/s/Saboteur.tzx.zip`, a 48K, the tape
playing, the cassette labelled Saboteur!); a .z80 downloaded (49,182 bytes) and dropped back; rewinding 3 s from
the strip by keyboard; a setting remembered across a reload; sound after a click (the sound card's clock running
frames, by condition, not by time); a phone (390 px: no sideways scroll, the touch pad shown, FIRE held is
joystick bit 16); the television keeping BRIGHT white over 8% brighter than normal white (13% now, 2.7% before);
the keyboard's layout (no legend on the plate over another, each key's legends on its face and clear of each other,
by their boxes in the SVG); the page from the keyboard (Shift+Tab from the machine reaches a control, Enter presses
it, Tab moves on, Escape gives the keys back; a clicked button lets go of the focus and Space after it is the
machine's); the arrows as CAPS SHIFT + 5 at BASIC and the joystick once a program is in; the sound card suspended
and resumed (frames on the display's clock meanwhile, the veil back, under 8 frames queued when it returns); a tape
playing on a phone leaving the window where it is. Parts a change cannot touch are skipped (by NERD_CHANGED). The
page's clock is paused a moment ahead of its own time, and asked again if a busy machine let the clock pass it
first (`pauseAt` refuses a time gone by: it failed so once with 17 parts side by side). `tests/smoke.mjs` checks a running
server against the real archive and API; it passed against `node server.mjs` locally.

## Pictures

`node tests/shot.mjs` writes them to `out/` (git-ignored). The final ones: `out/desktop.png` (1440 × 900, the 48K
switched on, the television), `out/desktop-loading.png` (Saboteur's real TZX from the fixture cache loading in the
stand-in, 47 s in: its loading screen appearing under the blue and yellow stripes, the reels wound on, the turbo
block under the head), `out/desktop-retina-small.png` and `out/retina-crop.png` (the loading screen on the
television at 2×: scanlines, colour bleed, the grille), `out/desktop-kb.png` (the keyboard, J and SYMBOL SHIFT
held, the keyboard as the case is: compare Nico Kaiser's photograph), `out/desktop-full.png` (the whole page),
`out/desktop-settings.png` (Settings, with the inspector), `out/phone.png` (390 × 844 at 3×, touch),
`out/phone-kb.png` (the touch pad and the compact keyboard), `out/phone-part2.png` (the phone's deck and shelf).
The television pictures at 2× are of Saboteur's loading screen as a .scr (the fixture `ref-game-saboteur-load.scr`).

## Known gaps

- **The core is not wired in.** The page runs the stand-in; games stop at their loading screens. `wasm.ts` is all
  that is missing (above). The about box says which runs.
- **Colours are not measured.** No measurement of a real machine's colours could be found; the levels are the
  circuit's (85%). A capture of a real 48K's composite output, decoded, would settle it; the palette is one table.
- The 48K's mechanical counter counts seconds of tape, not reel turns.
- The television has no phosphor persistence (afterglow) and no interlace jitter (the Spectrum is not interlaced).
- On a 128K, the typer presses ENTER at the menu after 150 frames; a core whose 128 menu takes longer to appear
  would need a longer wait (it is one constant, `BOOT_FRAMES`).
- The search shows only Available entries (the API's filter); a person cannot browse what is listed but not
  loadable. Disk images (+3 DSK) and microdrive cartridges are not loaded, as no core loads them.
- The page test draws WebGL in software (SwiftShader); the television shader's look is checked by eye (the
  pictures), not by test, beyond rendering without errors and being bright at the centre.
