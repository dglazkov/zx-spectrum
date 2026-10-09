# The page: `web/`

The Spectrum as a person meets it: the screen, the sound, the keyboard, the tape deck, a library of the games, and
the game in the machine with its inlay, its manual and its save slots. It is written in TypeScript with no UI
framework, built by Vite, and talks to the emulator only through one interface (`web/src/emulator/emulator.ts`). The
emulator is the real machine, `crates/spectrum` compiled to WebAssembly behind a C interface (`crates/wasm`, wrapped
by `web/src/emulator/wasm.ts`); the stand-in it was built against (`web/src/emulator/stub.ts`) is kept for tests of
the page alone (`?emulator=stub`).

What the owner sees: a dark room lit by a television that warms up as it is switched on (the first paint is already
the set, its tube dark, before the page's code has come). At BASIC the set and the 48K's keyboard sit together on the
desk, the keyboard drawn from the case's own legends, every key pressable; once a program runs the set grows to the
room's size. The screen is the hero, a CRT drawn in WebGL 2 (or crisp pixels), its border's colour glowing on the wall
behind it as the stripes flicker while a tape loads, with a slim bar under it saying which part of the tape is loading
and how long is left, and a button to load the rest fast. Beside it, a cassette whose reels turn as the tape moves,
the game's own (Saboteur's genuine copies were blue, DURELL pressed into them) with its inlay printed on the label;
the game's panel (its inlay, a button that takes it from its first screen to playing, the steps with their keys as
keycaps, its keys, save slots, the manual set as a booklet); and a shelf of loved games, Saboteur first, each with its
loading screen. Choosing one (or opening `?game=4293`) fetches it, switches on the right machine, types `LOAD ""` once
the ROM is ready and plays the tape. On a phone held sideways it is a console: the screen the display's height, the
pad and fire either side.

## The parts

```
web/
  index.html, src/main.ts      the page starts: the emulator and the screen together, then the app
  src/app.ts                   how the parts meet: frames, input, sound, files, the game, rewinding, slots, the layout
  src/emulator/emulator.ts     THE INTERFACE to the emulator (below)
  src/emulator/wasm.ts         the real machine: zx.wasm (crates/wasm) wrapped as an Emulator
  src/emulator/zx.wasm         the module, built by scripts/build-wasm.sh (git-ignored; built when missing or stale)
  src/emulator/keys.ts         the forty keys, numbered as the ULA reads them (half-row × 5 + bit)
  src/emulator/index.ts        which emulator runs: wasm.ts, or the stand-in for ?emulator=stub (never in its place)
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
  src/input/pc-keyboard.ts     the listeners;  gamepad.ts the Gamepad API
  src/input/typer.ts           what LOAD "" is, and when the ROM is ready for it (read from the screen)
  src/keyboard/legends.ts      what is printed on and around each key, from the ROM's tables
  src/keyboard/keyboard.ts     the keyboard drawn in SVG, pressable, lit when the machine has a key down
  src/library/zxinfo.ts        the ZXDB through ZXInfo; pictures; an entry's inlay and manual; fetching archive files
  src/library/choose.ts        which file of an entry to load, on which machine
  src/library/manual.ts        a game's manual: fetched, its keys read out as a table
  src/library/start.ts         how to start a game where it is not obvious, and the route the page drives (Saboteur's)
  src/library/featured.json    the shelf, recorded and checked by tools/featured.mjs
  src/state/settings.ts        what is remembered (localStorage, every access wrapped)
  src/state/rewind.ts          moments kept for going back
  src/state/saves.ts           save slots per game (IndexedDB, every access wrapped; memory without it)
  src/ui/*.ts                  the building blocks (dom, controls, icons) and the panels: deck, tapebar (the tape
                               under the screen), game, library, timeline (rewind), osd (words on the screen),
                               settings, help (the keys, F1), inspector, touch pad, toasts
  server.mjs                   the production server and the pass-through (below); server.d.mts its types
  vite.config.ts               the dev server, with the same pass-through
  vitest.wasm.config.ts        the WebAssembly build's own tests (tests/wasm/)
  tools/featured.mjs           records the shelf and the test fixtures from the ZXInfo API
  tools/bench.mjs              frames a second of the wasm build in Chrome, by model and loading a tape flat out
  tools/pictures.mjs           the pictures (below)
  tests/page.mjs               the page test in Chrome;  shot.mjs a picture;  smoke.mjs a running server
  tests/build.mjs              the production build, served by server.mjs, with the smoke test's checks
  tests/wasm/wasm.spec.ts      the module in Node, held to the native build;  nerd-reporter.mjs its parts to nerd
  tests/wasm/start.spec.ts     Saboteur's start route driven on the module, by the keys and by the joystick
  tests/server.test.mjs        the pass-through;  tests/fixtures/zxinfo/ recorded API answers
```

Commands (in `web/`, after `npm install`): `npm run dev` (builds the module if it is missing or stale, then Vite at
:5173), `npm run build` (the same, into `dist/`), `npm start` (`node server.mjs`, PORT or 8080), `npm run test:unit`,
`npm run test:wasm`, `node tests/page.mjs [words]`, `node tests/shot.mjs [--phone] [--dpr 2] [--file tape.tzx]
[--frames N] [--eval js] [--settings json] [--full]` (a picture into `out/`), `node tools/pictures.mjs [desktop]
[phone] [--sharp]`, `node tools/bench.mjs [--frames N] [--json]`, `node tests/smoke.mjs URL`, `node tools/featured.mjs
[--check]`.

The page's address takes: `?game=<ZXDB id>` (that game, loaded straight away: `?game=4293` is Saboteur), `?emulator=stub`
(the stand-in), `?renderer=2d`, and `?sound=off` (no sound card at all: the machine runs on the display's clock alone,
as the page's tests need, since a sound card's clock is the wall's). When it is up, `<body>` has `data-ready`,
`data-emulator` (`wasm` or `stub`) and `data-renderer`, and `window.zx` holds `{ app, emulator, renderer, kind }`, for
tests and agents.

## The machine in the browser: `crates/wasm` and `wasm.ts`

`crates/wasm` is `spectrum::Machine` behind a C interface: numbers in and out, bytes through the module's memory. A
machine is a handle (`zx_new`); every call takes it. The page hands bytes in through `zx_alloc`'d memory (filled,
passed with its length, `zx_dealloc`'d after); what a call hands back that is not a number (a file, a JSON answer, a
reason) is left in the handle's out-buffer (`zx_out_ptr`, `zx_out_len`), valid until the next call that fills it. The
picture and the sound are read in place, as views into the module's memory: a view is good only until the next call
into the module, as any call may grow the memory and detach every view made before (`wasm.ts` makes a fresh one
each time, and the page reads what it needs of a frame before it calls again: the first rewind moment's colours once
came out empty that way). Pointers come back as signed 32-bit numbers and are made unsigned (`>>> 0`) before use. No
call panics in practice: a null handle, a model or format out of range, a damaged file or state come back as negative
codes with the reason in the out-buffer: `ZX_E_ARGUMENT` −1, `ZX_E_UNRECOGNISED` −2,
`ZX_E_UNSUPPORTED` −3, `ZX_E_DAMAGED` −4, `ZX_E_STATE` −5, `ZX_E_FORMAT` −6. Models are numbered as `Model::ALL`
(0 16K, 1 48K, 2 128K, 3 +2, 4 +2A, 5 +3, 6 Pentagon), the page's `MODEL_IDS` in the same order.

| Export | What |
|---|---|
| `zx_alloc(len) → ptr`, `zx_dealloc(ptr, len)` | memory for the page to fill |
| `zx_out_ptr(h) → ptr`, `zx_out_len(h) → n` | the out-buffer |
| `zx_new(model) → h` (0 out of range), `zx_free(h)` | a machine, switched on |
| `zx_power_on(h, model) → code`, `zx_reset(h)`, `zx_nmi(h)`, `zx_model(h) → model` | off and on (the tape stays), RESET, NMI |
| `zx_run_frame(h) → 0 \| 1`, `zx_run_frames(h, n) → frames run` | a frame; 1 when a breakpoint stopped it |
| `zx_step(h) → 0 \| 1 \| 2` | an instruction (1 a breakpoint, 2 it ended the frame) |
| `zx_frame_count(h) → f64`, `zx_tstate(h)`, `zx_set_tstate(h, t)` | frames since made; the T-state in the frame |
| `zx_frame_ptr(h)`, `zx_frame_len() → 104192` | the picture, 352 × 296 colours 0–15 |
| `zx_audio_ptr(h)`, `zx_audio_len(h) → f32s`, `zx_set_sample_rate(h, hz)` | the frame's sound, stereo interleaved |
| `zx_key(h, code, down)`, `zx_key_down(h, code)`, `zx_release_keys(h)` | keys, code = half-row × 5 + bit |
| `zx_joystick(h, kind, bits)` | kind 0 none, 1 Kempston, 2 Sinclair 1, 3 Sinclair 2, 4 cursor; bits R1 L2 D4 U8 F16 |
| `zx_type_text(h, ptr, len) → f64` | text typed at the ROM's pace (`\n` is ENTER) |
| `zx_load(h, ptr, len, name_ptr, name_len) → code` | a file; out: `{"kind","name","model","others"}` or the reason; over 16 MB (`MAX_FILE`) is `ZX_E_UNSUPPORTED`, a tape with nothing on it to play `ZX_E_DAMAGED` (the deck left as it was) |
| `zx_tape_play/stop/rewind/eject(h)`, `zx_tape_seek(h, block)`, `zx_tape_active(h)` | the deck |
| `zx_tape_state(h) → ptr` | five f64: loaded, playing, block, seconds played, seconds long (cheap: every frame) |
| `zx_tape_blocks(h) → n`, `zx_tape_name(h) → n` | out: `[{"kind","label","bytes","seconds"}]`; the tape's name |
| `zx_saved_tap(h) → n` | out: what a SAVE recorded, as a TAP |
| `zx_options(h) → bits`, `zx_set_options(h, bits)`, `zx_set_volume(h, v)` | bits: Issue 2 1, late timings 2, instant load 4, automatic tape 8, tape heard 16, snow 32, AY on a 48K 64, ghosting 128, sound 256; AY stereo in bits 12–13 (0 mono, 1 ABC, 2 ACB) |
| `zx_save_state(h) → n`, `zx_load_state(h, ptr, len) → code` | the whole machine (`save_state`); a state refused leaves the machine as it was |
| `zx_state_picture(h, ptr, len) → n` | out: the picture a state holds, read from the state alone (`Machine::state_picture`: no machine built, no tape replayed; `h` untouched) |
| `zx_save_snapshot(h, format) → n` | out: 0 .z80, 1 .szx, 2 .sna |
| `zx_registers(h) → ptr`, `zx_set_register(h, index, value) → code` | twenty u32: AF BC DE HL AF' BC' DE' HL' IX IY SP PC I R IM IFF1 IFF2 HALTED MEMPTR T |
| `zx_peek(h, addr)`, `zx_poke(h, addr, v)` | memory as the CPU sees it |
| `zx_disassemble(h, addr, count) → n` | out: `[{"addr","len","text"}]` |
| `zx_add_breakpoint(h, pc)`, `zx_remove_breakpoint(h, pc)`, `zx_clear_breakpoints(h)` | breakpoints |
| `zx_screen_text(h) → n` | out: the screen read as text against the ROM's font, 24 rows of 32, `\n` between |

`scripts/build-wasm.sh` builds it (`cargo build --locked --release --target wasm32-unknown-unknown -p zx-wasm`,
symbols stripped, into `target/wasm`) and moves it into `web/src/emulator/zx.wasm` (written beside and moved, so two
builds at once never leave half a file). When the module in place is newer than cargo's, it does nothing. **The build
is reproducible**: the paths compiled in (a panic names its file) are written as `/zx` and `/cargo` instead of where the
repository and the cargo registry are (`--remap-path-prefix`), and Cargo.lock is taken as it is, so the same sources
and toolchain make the same bytes anywhere. The Dockerfile's Rust stage runs the same script (`ZX_WASM_OUT=path` puts
the module elsewhere): its module is the very one the tests ran (built in podman here: the same SHA-256), and the
smoke test checks that the module served is. `ZX_WASM_IN=path` takes a module compiled elsewhere. wasm-opt is no
longer run (`WASM_OPT=1` asks for it): it took 20 s, made the module 14% smaller (1.5% with Brotli: 203 KB against 206
KB) and no faster, and made a module no test ran. `npm run dev` and `npm run build` run it first, and so do the
page's, the build's and the wasm layer's tests.

**Speed** (`node tools/bench.mjs`, Chrome 154 on this machine, an i7-14700, load average 1.5; measured, never judged):

| | frames/s with sound (1×) | flat out (no sound) | × real time flat out |
|---|---|---|---|
| 16K | 4,807 | 5,504 | 110 |
| 48K | 4,692 | 5,400 | 108 |
| 128K | 4,658 | 5,317 | 106 |
| +2 | 4,710 | 5,373 | 107 |
| +2A | 4,718 | 5,354 | 107 |
| +3 | 4,724 | 5,389 | 108 |
| Pentagon | 4,724 | 5,421 | 108 |
| Saboteur's tape, from the edges, flat out | | 3,686 (9,039 frames in 2.45 s, to the REWARD screen) | 74 |

The native build (`zx bench`) runs 5,400–5,600 frames a second idle and 4,140 loading Saboteur: the module is within a
few per cent of it. In the page, flat out runs frames for 65% of each display refresh's period as measured (4 to 40
ms, at most 160 frames), so a 120 Hz display runs as many a second as a 60 Hz one; through the page's path a frame
costs about 0.3 ms, some 35 a refresh at 60 Hz. Saboteur from a click to its REWARD screen, Instant (its standard
blocks trapped, its turbo blocks flat out): about 5 s on an idle machine with a real GPU and 8 s on a busy one (the
player's measure), 11 s in headless Chrome drawing in software; Accelerated, about 10 s. Other costs, measured in the
page (Chrome, software WebGL): `saveState` 0.26 ms at BASIC (1.4 KB) and 1.0 ms in Saboteur (34 KB), `statePicture`
0.76 ms (the state inflated, whatever tape has played), `loadState` 0.63 ms at BASIC and 33 ms once Saboteur's tape
has played (the deck's log is replayed, once, on going back), `screenText` 35–50 µs, `tape.state()` 0.4 µs.

`wasm.ts` keeps, for tests as the stand-in does, a log of the keys the page put (`keyLog`) and the joystick as last set
(`joystickState`).

## The Emulator interface

`web/src/emulator/emulator.ts` is the contract; this is what each member must do. Everything is synchronous and on
the main thread. `index.ts` makes the real machine (`createWasmEmulator()` in `wasm.ts`: the module compiled as it
streams in, where the server says `application/wasm`); the stand-in only for `?emulator=stub`. A machine that will not
start (the module not fetched, no WebAssembly) is said in the set the first paint drew, with Try again: never a
stand-in in its place, whose games would stop at their loading screens.

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
interface Instruction { addr: number; len: number; text: string }

interface Emulator {
  readonly frameWidth: number; readonly frameHeight: number;   // 352 × 296
  readonly model: Model;
  readonly frameRate: number;      // MODELS[model].frameRate: 50.08 on the 48K
  readonly frameCount: number;     // frames run since it was made; never goes back (not part of a state)
  setModel(model: Model): void;    // switched on afresh as that machine; the tape stays in the deck
  reset(): void;                   // off and on again
  runFrame(): void;
  frame(): Uint8Array;             // the last frame: 352 × 296 indices 0–15, may be a view, valid until next call
  audio(): Float32Array;           // the last frame's sound, stereo interleaved, at setSampleRate's rate
  setSampleRate(hz: number): void; // changes between frames (the page halves it at 2×)
  setSound(on: boolean): void;     // whether frames make sound: off before there is a sound card, and flat out
  key(code: number, down: boolean): void;   // code = half-row × 5 + bit (keys.ts)
  releaseKeys(): void;
  joystick(kind: JoystickKind, bits: number): void;   // called only when either changes
  load(bytes: Uint8Array, name: string): LoadResult;  // TAP TZX CSW PZX, Z80 SNA SZX SLT, SCR, or a .zip; throws LoadError
  readonly tape: Tape;
  options(): Options; setOptions(options: Partial<Options>): void;
  saveSnapshot(format: SnapshotFormat): Uint8Array;
  saveState(): Uint8Array; loadState(state: Uint8Array): void;   // fast, the core's own format, for rewinding
  statePicture(state: Uint8Array): Uint8Array | null;             // the picture a state holds, the machine untouched
  savedTap(): Uint8Array;          // what a SAVE recorded, as a TAP (empty: nothing)
  screenText(): string;            // the screen read against the ROM's font: 24 rows of 32, newlines between
  peek(address: number): number; poke(address: number, value: number): void;   // as the CPU sees memory now
  registers(): Registers;
  disassemble(address: number, count: number): readonly Instruction[];
  setBreakpoints(addresses: readonly number[]): void; breakpoints(): readonly number[];
  readonly breakpoint: number | null;   // where a breakpoint stopped the last runFrame(), else null
  step(): 'instruction' | 'frame' | 'breakpoint';   // one instruction: the frame's last, or one a breakpoint stopped
  readonly stopped?: string | null; // why the module trapped (its memory is then not to be trusted), else null
  revive?(): Promise<void>;        // after a trap: a new instance of the module, switched on, its options as they were
}
```

What the page relies on:

- **Time.** The page calls `runFrame()` as many times as it decides; the core never reads a clock. `frameCount`
  is the page's count of emulated time (the feeder schedules key presses by it), so it must rise by one per
  `runFrame` and must not be restored by `loadState`. A frame a breakpoint stops does not count: it goes on when run
  again.
- **Picture.** `frame()` after each `runFrame()`, uploaded to a texture on each display refresh that follows a new
  frame.
- **Sound.** `audio()` after each `runFrame()` while sound is on, at the rate last set: 958 or 959 stereo
  samples a frame at 48 kHz on the 48K, so that the count follows the clock exactly (the page sends exactly what it
  gets). At 2× the page asks for half the rate, so a frame's samples play in half the time (the tape and the
  music an octave up, as a fast-forwarded deck); flat out, or with no sound card running, it turns the sound off
  (`setSound(false)`: the machine's output stage then costs nothing, and the levels go on, so sound turned on again
  comes in without a thump).
- **Keys.** `key()` is called between frames only, at most once per key per frame boundary; a press lasts at least
  one frame (the feeder sees to that). The page never presses a key the machine cannot have.
- **Loading.** `load()` does not start the tape: the page decides. With `autoTape` on, the machine starts the tape
  when the ROM (or a loader) starts reading EAR and stops it when it stops (docs/machine.md); the page then only types
  `LOAD ""`. With `instantLoad`, standard ROM blocks are taken by trapping LD-BYTES. A snapshot switches the model itself
  and says which in `LoadResult.model`.
- **Tape state.** `tape.state()` is read on every display refresh (for the reels, the counter and the block list)
  and every frame (whether to run flat out): five numbers read from the module, 0.4 µs. `blocks()` is read once a tape
  goes in (the wrapper keeps it).
- **Rewind.** `saveState()` every 25 frames (every 250 while the page runs flat out); 1,200 are kept (ten minutes;
  no more than 96 MB). `loadState()` puts the machine back exactly, sound and tape position included, but not the
  tape's contents (the tape in the deck stays the one there now). `statePicture()` shows a moment while it is chosen,
  from the state alone.
- **A trap.** A `WebAssembly.RuntimeError` in a call (out of memory, a bug) kills the instance: `wasm.ts` refuses every
  call after it (`EmulatorStopped`), and `revive()` makes a new one from the module already compiled. The page keeps
  the tape as it went in and the moments, and puts both back (below, Time).
- **Debugger.** `peek`, `registers()` and `disassemble()` are read on every display refresh while the inspector (in
  Settings) is open.

## Time: the frame scheduler

`clock/scheduler.ts` decides how many frames to run, from one of two clocks, given as arguments (milliseconds) so
that tests drive them:

- **The sound card's**, once sound is on (1× or 2×): the worklet reports, whenever it finishes a frame's samples,
  how many sample frames it has played in all. The page estimates what is queued (sent − played, extrapolated
  by the time since the report). While the page is shown, frames are run **on its refreshes only**: as many as the
  time since the last one owes at the machine's rate, the time being the display's period as measured over many
  refreshes (a refresh handled a millisecond late is still one period), rounded, so a 50 Hz machine on a 60 Hz display
  runs one on five refreshes in six and never two on one, and on a 50 Hz display one a refresh. The drift between the
  sound card's crystal and the page's clock is made up a frame at a time: when the queue, smoothed over a second or
  so, strays half a frame from 3, a frame is added on a refresh that would have had none (or one left out of one
  that had one), at most once a second; a queue under 1.5 frames is filled at once. No sample is dropped or invented.
  (Before, frames were also run on the worklet's reports, in bursts between refreshes: a frame now and then was never
  shown and its neighbour shown twice, 1.35 hitches a second in Saboteur, a judder the player saw.) When the
  refreshes stop (a hidden tab), the reports run frames, so it keeps playing.
- **The display's**, before sound is allowed (no gesture yet), while the sound card is not running, or flat out:
  frames are owed at the frame rate by the time between refreshes; a gap over 250 ms (a hidden tab, a stall) is not
  caught up. Flat out, frames run for 65% of the refresh's period (4–40 ms, at most 160), and the batch ends at once
  when the machine is not to run flat out any more (the tape stopped): before, it ran on to its budget.
- **Something that throws** in a frame or in drawing it no longer stops the heartbeat (the next refresh is asked for
  whatever happens, `clock/loop.ts`): the page pauses the machine and says so on the screen, "The machine stopped",
  with Start it again, which revives the module where it trapped, puts back the tape as it went in and the last
  moment kept, and goes on.
- **A sound card that stops.** The system can suspend the AudioContext (a phone call, another app, a phone's
  background tab), or its device go. Its reports then stop, and extrapolating from the last one would run frames at
  the page's rate into a queue nothing plays, to be heard as late as the card was gone, with the machine frozen while
  the backlog plays out. So the extrapolation stops 100 ms past the last report (the machine waits), and the page
  follows the context's `statechange`: not running, frames go on by the display's clock, silently, and "Click for
  sound" shows again; running again, the queue is cleared and the sound card's clock takes over afresh.

The machine waits while a moment is previewed on the rewind strip, and when a breakpoint stops it. It runs flat out
while it boots for a tape the page loads by itself, and while the machine says its tape is playing in the
accelerated and instant styles (silent then: `setSound(false)`), back at the speed chosen as soon as the tape stops
(by itself, when the program stops reading it, or at its end). The latest picture is drawn on every display refresh.

With `?sound=off` the page never makes a sound card, and every frame is on the display's clock: what a test moving
the page's clock (`page.clock`) needs, since once a click or a key has started a sound card, frames follow its clock,
which is the wall's.

Measured (the simulation in `scheduler.test.ts`: a 48 kHz worklet in 128-sample blocks, or 512 and 1,024 at a time as
a hardware buffer renders them, reports 1–8 ms late, a 60 Hz display whose refreshes are handled up to 3 ms late):
over 10 minutes the queue stays between 1.5 and 5 frames (about 3 before a refresh's frame, 4 after), no underrun;
on the refreshes alone, one frame or none on each at 60 and 144 Hz, never two, with the sound card's crystal 0.4%
fast or slow; at 50 Hz one a refresh but for 97% or more; frames run match samples played to within 2 frames over 5
minutes; at 2× 6,013 frames in 60 s (2 × 50.08 × 60 = 6,010); a 150 ms stall of the page empties the queue (one
underrun, the worklet fading to silence over 5 ms rather than clicking), a 40 ms one does not. On the display's clock, 60 s at 50, 60, 75, 120 and 144 Hz each run 3,005 ± 1 frames. The sound card
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
and SPACE to the front. The keys are the photograph's grey-blue; the red legends on them are lightened (#ff8a7a, with
a hairline of dark under them): the case's red on its grey measures 1.72:1, authentic and unreadable on a screen. At
phone width the keyboard is drawn again compact: keys 0.88 of a pitch wide and 1.3 tall (40 px tall on a 390 px
phone, to press with a thumb), their main legends only, the logos smaller. The keys the game in the machine uses are
outlined in yellow, as the overlay cards some games came with marked them (Saboteur's A Z N M SPACE).

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
  (by where the key is, as a Mac's Alt types something else). Cmd and unknown keys are left to the browser. The
  Spectrum's two-character operators are keys of their own (`<>` SYMBOL SHIFT + W, `<=` Q, `>=` E): typed as two
  characters, as on a PC, the second is typed as DELETE and the operator's key (`operatorChords`), so `IF 1<>2` is
  taken rather than refused as `1<?>2`. Settings and the keys' sheet say to use Alt for SYMBOL SHIFT: Chrome keeps
  Ctrl+W, T and N for itself (Ctrl+W, meant as `<>`, closed the tab), and once something has been typed or loaded,
  leaving the page asks first (`beforeunload`).
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
machine. Shift+Tab is always the page's: from the machine (where Tab is extended mode) it goes to the first of the
bar's controls. A chip in the bar says where the keys go ("Keys: Spectrum", "Keys: page"). A control clicked or tapped
keeps no focus (app.ts lets it go on the click), so a game's Space never presses the button last clicked, and no
focus ring shows while playing. The page's own keys: F1 the keys' sheet (every key the page knows), F2 and F4 the
quick slot, F8 the screen read aloud (`screenText()` into a live region, for a screen reader), F9 pause.

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
from the library, or a link), the page switches the machine on afresh and runs it flat out until the ROM is ready
for keys, which it reads off the screen (`screenText()`): the 48K's copyright on the bottom line ("© 1982 Sinclair
Research Ltd", Amstrad's on the +2's and +3's 48 BASIC), or the 128's menu ("Tape Loader"; "Loader" on the +2A and
+3). That is 48 frames on a 16K, 87 on a 48K, 61 on the 128, 63 on the +2, 83 on the +2A, 133 on the +3 (which looks
for its disk drive first) and 55 on the Pentagon; 400 at most whatever the screen says. Then it types `LOAD ""` (J,
SYMBOL SHIFT + P, SYMBOL SHIFT + P, ENTER) on a 16K or 48K, or ENTER on the menu, and the tape starts (by the machine
when its motor is automatic, by the page otherwise). zx (crates/cli) waits for the same words. A tape dropped while
a program runs only goes in the deck, for multi-load games.

Keys that come and go within one frame (keys pasted, typed faster than frames run, or a test's paused clock) go in
one after another: a key typed live goes down no sooner than the one before it went up, even when its own press and
release have both come already (`feeder.test.ts`: "10 rem hi", every press and release in one frame, registers as
1, 0, SPACE, R, E, M, SPACE, H, I). A latched SYMBOL SHIFT or CAPS SHIFT on the drawn keyboard goes up with the key it
was for, not the frame before (a click is down and up at once, and the key's release waits a frame for the machine
to see it: the ROM had read a lone P where SYMBOL SHIFT + P was meant).

## Sound

An AudioContext (latency hint 'interactive') is made on the first click, tap or key (browsers allow nothing
sooner; a pill on the screen says so). Its resume is not waited for: a context made on a gesture the browser does
not count (a touch's pointerdown is not one) stays suspended, and a resume it does not allow never settles; every
later gesture asks again, and the page runs on the display's clock until the context runs (above). Each frame's samples are copied and transferred to an AudioWorklet
(`audio/worklet.ts`) by message (no SharedArrayBuffer, so no cross-origin isolation is needed). It plays them in
order, reports what it has played whenever a frame's samples are done, fades to silence over 5 ms if it runs dry,
and counts underruns. A `clear` (after a rewind or reset, and on going flat out, so that the silence of a fast load
is no underrun) drops the queue and starts a new count, with a generation number so that reports from before it are
ignored. A 12 Hz high-pass takes out the beeper's resting level; then the machine's level: the 128 family is lifted
by 2.2 (+6.8 dB), when the sound is levelled (Settings, on by default), as a 128's AY music came out about 13 dB under
a 48K's BEEP (the circuits' own levels, docs/audio.md: the 128's span is shared between the beeper and the AY) and
the owner turning up Cybernoid then had a 48K's beep loud; that brings a 128's beeper to a 48K's and its music most
of the way. A soft limit after it (a curve straight to 0.8 and bending to 1, no further) keeps what would pass full
scale from clipping. Then the volume (squared). Speeds: pause, 1×, 2× (sound pitched up, as said above), flat out
(silent).

## The tape deck

`ui/deck.ts`: a cassette in SVG, the game's own where the page knows it (Saboteur's blue, DURELL pressed into it, as
its REWARD screen says genuine copies were; black otherwise), with its label (the game's name on a band over a strip
of its inlay's front, when the game is from the library: an inlay scanned whole, back, spine and front side by side,
has its front at the right), Sinclair's rainbow on the label of Sinclair's own tapes only (a plain ruled label on
the rest), the tape packed on
each reel by how much has played (radius² in proportion), each hub turning at the tape's speed over that reel's
radius as the tape position moves (so it spins faster as it empties, and flat out spins flat out); a three-digit
counter of seconds of tape; rewind, play (pressed down and green while the motor runs), stop, wind on to the next
block, eject; the blocks as the core lists them, with their durations, the one under the head marked and a bar for
how far through it is (the blocks' start times summed once, as the tape goes in); click a block to wind to it. With
no tape in it the deck is an empty well ("Drop a tape here, or choose one from the shelf") and says what to do. The list follows the head by scrolling itself only (scrollIntoView moved the whole
page to the deck at each block, away from the screen, on a phone). The loading style: authentic (real time, with sound
and stripes), accelerated (the real signal, the page flat out and silent while the machine says the tape is playing,
back to 1× when it stops) or instant (standard ROM blocks taken at once by the machine's LD-BYTES trap, and what it
cannot take, turbo blocks and custom loaders, played flat out as accelerated).

**The tape where the eye is** (`ui/tapebar.ts`): while a tape plays (or the page is about to play it), a slim bar
under the screen: a small cassette whose reels turn, the game's name and the part loading ("the loading screen",
"the game, by its own loader"), "Part 6 of 10 · 3:09 left", a bar split into the tape's parts, each filling as it
plays, and **Load it fast**, which loads the rest of this tape flat out, whatever the style (the stripes and the
loading screen still come in), and only this tape. On a phone the deck is screens away from the screen.

**SAVE**: what the ROM's SAVE writes on the MIC line, the machine records as a TAP (`savedTap()`, looked at every 50
frames). Once something has been saved the deck says so ("SAVE recorded 2 blocks, 37 bytes") with a button to
download it as a .tap; it stays offered across a reset until another SAVE replaces it.

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

The file is fetched through `/archive` + its path, with progress on the card, the side column back at its top so that
the cassette is seen going in, and loaded as above with the entry's title on the cassette. A card's badge says the
machine only where a 48K will not do (a 128 alone, the +3). A search says how many more the ZXDB knows that the
archive may not hand out (a second query, without the Available filter: "Jetpac" finds Jetpac 2, and says Ultimate's
Jetpac is among those not handed out); a search that fails says so in a card with Try again. A tape that cannot be
fetched (the archive down) is said in a toast that stays until dismissed, with Try again; nothing in the machine is
changed. The page's address then names the game (`?game=4293`), so that a reload, or the link shared,
loads it again. A second game chosen while one is coming supersedes it (its fetch is aborted; a double click
fetches once). The Content-Length is used for progress only: a body sent compressed is longer decoded than it.

**The shelf** (`library/featured.json`, written by `node tools/featured.mjs`, which asks the API for each and
leaves off any that is not Available; `--check` only checks): Saboteur!, Saboteur II, Manic Miner, Jet Set Willy,
Head over Heels, Elite, The Lords of Midnight, Skool Daze, Match Day, Dynamite Dan, Starquake, Fairlight, Batty,
Bomb Jack, Exolon, Cybernoid, Rick Dangerous, Batman, Target: Renegade, Bubble Bobble, Treasure Island Dizzy, The
Hobbit, Deathchase, Ant Attack, Horace Goes Skiing, Daley Thompson's Decathlon, Arkanoid: 27, all Available on
2026-10-08. Loved games listed as Distribution denied were left off: Knight Lore, Atic Atac, Chuckie Egg, R-Type,
Ghosts 'n Goblins.

## The game in the machine

`ui/game.ts`, shown once a program is loaded, above the library:

- **The inlay**: the entry's first "Inlay - Front" (ZXDB lists the original release's first; a file named for a
  re-release or a language, "(Encore)", "_Spanish", comes after a plain one), through `/archive` (it allows
  `/zxdb/sinclair/`), its front shown (an inlay scanned whole shows its right-hand part), and on the cassette's label.
  The shelf's records (`featured.json`) carry it, its instructions and its controls; for an entry whose record does
  not (`inlay === undefined`), the entry is fetched while the tape comes.
- **Facts**: title, year, publisher, machine, and ZXDB's controls ("Cursor · Kempston Joystick · Redefineable keys").
- **Share**: the link that loads the game straight away (`?game=<ZXDB id>`), copied (or shared, on a phone).
- **To start** (`library/start.ts`): for games where it is not obvious from the screen, worked out against the game
  itself. The steps, numbered, each key in them a keycap; and **Start the mission**, with a skill level and Keys or
  Joystick (the joystick first on a touch screen, where the pad is it), which drives the game from its first screen
  to playing by reading each screen and pressing what it wants (`StartPilot`): pressed before the first screen shows
  (the tape still loading), it waits for it. Saboteur's: the £100 REWARD screen wants any key; the high scores take a
  key only from about 1.5 s after they show to 5.5 s, then the game moves on; the menu (its item highlighted by a
  flashing row: J KEMPSTON on row 1, K KEYBOARD 3, P PROTEK 5, Protek its own choice) takes a key only held 8 frames
  or so (it reads the keys between the notes of its tune: the player's 60 ms taps were lost four times in five, and
  the corpus's route had in fact been starting the game with Protek, its K taken as the high scores' key); S starts;
  the skill level is a digit held 40 frames. With no Kempston interface J starts at once (port 1F floats high, read
  as fire). `tests/wasm/start.spec.ts` holds the route to the game from the REWARD screen pressed at once and after
  37, 150, 400 and 2,500 frames, and that the game then answers to M and not the joystick (keys), or the other way
  round (joystick).
- **Keys**: the route's, as keycap tiles (Saboteur's A up, climb, kick; Z down, duck; N left; M right; SPACE throw,
  use, punch; and what the joystick does), and outlined on the drawn keyboard. For other games, from the manual: the
  instructions as text ("Instructions", TXT, English or no language given, the plain file before a variant) fetched
  through `/archive`, decoded as Windows-1252, its sections found (a heading underlined, or a short line in
  capitals), and of those about keys, controls or joysticks the best table read out: rows of a key and what it does,
  set apart by spaces, a dash, = or :, those naming a Spectrum key (A, SPACE, CAPS SHIFT) counting more than those
  naming a direction (UP, FIRE). Saboteur's: "Standard Controls", A, Z, M, N, SPACE.
- **Saves**: four slots (the quick slot and 1–3), each with its picture and when it was saved, and explicit Load and
  Save buttons (an empty slot "+ Save here"); Save over a filled slot asks "Replace?" and saves on a second press. F2
  saves to the quick slot, F4 loads it (not while typing in a field or a dialog). A slot is kept in IndexedDB
  (`state/saves.ts`, every access wrapped; without it, in memory for the page's life, which the toast says): the
  machine's state, a .szx of it to fall back on (a state is for the build that made it), a 96 × 72 picture (the
  state holds the whole frame), and, once per game, the tape it came on, so that a slot loaded on another visit puts
  the tape back in the deck first and the state then puts it where it was. A page that opens the store at a newer
  version (in another tab) gets it: this one closes it and goes on in memory; a page whose open is blocked by an older
  one goes on in memory rather than wait. Slots belong to the game: `zxdb:<id>` from the library, `file:<name>` for
  a file opened, `basic` with nothing loaded.
- **The manual**: the whole text, folded away, set as a booklet: its headings (lines in capitals, or underlined) as
  headings, its paragraphs in proportional type at a reading measure, its tables of keys as they are laid out (a
  row too long for the panel wraps under its last column, not back at the margin among the keys; on a phone that
  column is narrow, and a long word in it breaks).
- **A snapshot of the game**, saved and opened again, is the game again (its panel, its keys, its slots): the page
  remembers, in this browser, which game the last 40 snapshots it saved were of, by their bytes.

## Switching on

The television warms up when the page opens and whenever the machine is switched off and on (the power button, a
model chosen): the picture opens from a line of light across the middle, over-bright and colourless at first, into
the picture, in 1.15 s (a CSS animation on the screen's canvas). With `prefers-reduced-motion` it fades in, in 0.35 s.
The ROM's own power-on (the RAM test, then the copyright) goes on beneath it.

## The server

`web/server.mjs` hands out `dist/` from memory, read and compressed once at start (Brotli 9 and gzip 9; hashed
`/assets/` immutable for a year, `/fonts/` a week, the rest `no-cache`), with no path from a URL to the disk, and
passes two prefixes through, streamed, nothing kept on disk:

| Prefix | To | Paths | Cap | Timeout | Cache |
|---|---|---|---|---|---|
| `/archive/` | `https://spectrumcomputing.co.uk/` | the software's directories under `/pub/sinclair/` (games, games-info, games-inlays, games-maps, screens, demos, utils, tools, educational, compilations, slt) and the ZXDB's `/zxdb/sinclair/entries/` and `pokes/`; Spectrum files, text and pictures only (zip tap tzx csw pzx z80 sna szx slt scr txt pok jpg gif png): not the books or the magazines | 16 MB | 60 s, the whole exchange | a day |
| `/zxinfo/v3/` | `https://api.zxinfo.dk/v3/` (query passed) | `/search`, `/games/<id>`, `/suggest/<term>` only | 4 MB | 15 s | 10 min |

A path is decoded once, refused with any `.` or `..` or empty segment, backslash or control character, checked
against the route, and each segment re-encoded, so that what reaches the archive is exactly what was checked.
Redirects are followed only to the route's own hosts (spectrumcomputing.co.uk, www.; api. and internal.zxinfo.dk),
three at most; a body past the cap is cut off (by its Content-Length at once, else as it streams). An origin's
Content-Length is passed on only for a body sent as it is: fetch hands the body over decoded, so the length of a
compressed one would be wrong (the client then saw the connection cut: tested with a gzipping origin). What comes
through carries `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`, so an HTML answer (the
archive's 404 pages are HTML) opened on this origin runs nothing, and `Cross-Origin-Resource-Policy: same-origin`, so
no other site's page takes it. The body streams through `pipeline` as the client takes it, under the route's timeout
for the whole exchange: a client that stops reading is let go of when the time is up, and the archive's connection
with it (before, the timeout covered only the fetch, and a stalled client held the handler, and leaked a listener
at each wait, until it left). A client is allowed 120 requests a minute through (a burst of 60; by the first address of
X-Forwarded-For), then 429. Other paths under those prefixes are 403; methods other than GET and HEAD 405; upstream
failures 502, timeouts 504. No cross-origin isolation headers. The dev server (`vite.config.ts`) uses the same `passThrough`. `startServer(root, port)` runs
when the file is run (`node server.mjs`, PORT or 8080), and stops on SIGTERM after what is in flight. For an image:
`npm ci && npm run build` in `web/`, then `node server.mjs` beside `dist/`.

## Rewind, snapshots, files, settings

- **Rewind**: a moment every 25 frames (half a second; every 250 while a tape loads flat out, whose moments are the
  loading's), the last 1,200 (ten minutes at 1×): the machine's state alone (1.4 KB at BASIC, 20–40 KB in a game:
  Saboteur's are 34 KB, 41 MB for ten minutes), as the real machine's state holds the picture it was taken after,
  which `statePicture()` reads from the state alone (0.76 ms, the machine untouched, no tape replayed); with the
  stand-in, whose states do not, the picture is kept beside each. Each moment keeps a sample of its picture's colours
  (every 97th pixel) for the strip under the screen, a sliver of each moment's average colour, newest at the right,
  drawn again at most four times a second. Its time runs on a logarithmic scale (`placeOf`: the last minute has
  about half the strip of ten minutes, eight seconds back a tenth, where a fixed scale gave it 10 px), with ticks
  (10 s, 30 s, 1 min, 2 min, 5 min, 10 min, as far as there is history). Pressing on it shows that moment's picture,
  its colour drained a little and the screen saying so in the ROM's own font (`ui/osd.ts`: "◀ -8s" and PREVIEW,
  and PAUSED while paused), the machine waiting; dragging moves through them (the last eight pictures read are kept,
  so scrubbing back and forth is instant; a drag on a touch screen is the strip's, not the page's scroll), letting go
  goes back to it (and the later ones are let go); arrow keys (with Shift, ten seconds at a time), Home, End, Enter
  and Escape do the same from the keyboard. With nothing kept yet the strip is a faint dashed groove.
- **Snapshots**: Snapshot → .z80, .szx or .sna (the core's `saveSnapshot`), named after what is loaded. What a SAVE
  recorded downloads named for its header (`SAVE "squares"` → squares.tap).
- **Files**: dropped anywhere on the page (an overlay says what it takes), or Open: TAP, TZX, CSW, PZX, Z80, SNA,
  SZX, SCR, or a .zip of one.
- **Settings**, a sheet at the right (at the bottom on a phone), not modal: the screen stays live and in view beside
  it, so that the display, the colours and the room's glow are chosen against the picture, and the inspector shows the
  machine it stops; Escape or its close button puts it away. Remembered in localStorage (every access in try/catch;
  anything missing or of the wrong type is the default): model, display, crop, palette, room glow, loading stripes
  (Automatic: calm under reduced motion; Calm: the border drawn in its one most-shown colour while a tape loads, the
  machine's own frame untouched; As they were), keyboard mapping, joystick, arrows as joystick, fire key, loading
  style, automatic motor, Issue 2, AY stereo, volume, mute, the 128's sound levelled, keyboard shown.
- **Inspector** (in Settings, "Inside the machine"): the registers, the code at PC as the machine disassembles it
  (eight instructions, with their bytes, PC and breakpoints marked), 128 bytes of memory at an address, live while
  open; Pause/Run and Step (one instruction); breakpoints, added by address (hex) and removed by a click: one that is
  reached stops the frame there (before the instruction), the page pauses, says so, and opens the inspector at it;
  Run goes on from it. And a POKE (decimal, or hex with # or $).

## The stand-in emulator

Kept for tests of the page alone (`?emulator=stub`); never run in the real machine's place.
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
RFC 1951; ZIP per PKWARE's APPNOTE); its own state for rewinding; plausible registers; the screen read as text
against the ROM's font, as the machine reads it; no disassembler (its bytes as DEFB), no breakpoints, no SAVE.
Everything a game does after loading is beyond it: the about box in Settings says so.

- TZX 1.20: https://worldofspectrum.net/TZXformat.html; .z80: https://worldofspectrum.org/faq/reference/z80format.htm;
  ZX-State (.szx): https://www.spectaculator.com/docs/zx-state/intro.shtml; puff.c:
  https://github.com/madler/zlib/blob/master/contrib/puff/puff.c; APPNOTE:
  https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

## Type and colour

One family, Archivo (Omnibus-Type, SIL OFL 1.1, `web/src/fonts/`, bundled), from narrow (the key legends, at
80% width, close to the case's condensed grotesque) to its italic 800 (the "ZX Spectrum" wordmark). The page is a
near-black with a violet cast (#0c0b0f), warm off-white text, and the Spectrum's rainbow (red #e3342b, yellow
#f6c51e, green #4fb447, cyan #1d9fd8, taken from the case's stripe) for accents: the stripe, progress bars, a
latched shift's amber, the played tape's green. The rainbow is kept where it is real (the mark, the keyboard's
corner, Sinclair's own cassette labels): progress (a tape's parts, a block, a card loading) is one warm white
(#f2ead8). The small print (#86818f) is 5:1 on the page and its panels (it was 3.7:1, under WCAG AA for its 12 px);
FIRE's red is darkened for white on it to read. At phone width (below 760 px) the page is one column with 16 px
gutters, the toolbar keeps pause, sound, open, full screen, reset and settings, a Choose a game button under the
screen goes to the shelf, the keyboard shows only its main legends larger, and the touch pad appears on touch
screens. Held sideways (a touch screen under 500 px high) the page is a console: the screen the display's height
under a slim bar, the pad on the left, FIRE, SPACE and ENTER on the right. Full screen (the bar's button) shows the
set and its strip alone, and keeps the display awake (a wake lock). The first paint (index.html, before the page's
code) is already the bar and the set with its tube dark, which the page then switches on.

## Tests

| Layer (nerd.toml) | What | How long |
|---|---|---|
| `wasm` | crates/wasm's 13 tests of its C interface, natively; then the module in Node (`tests/wasm/`, 18 parts) | 20 s |
| `web-types` | `tsc --noEmit` (TypeScript 7), strict, over src, vite.config.ts, server.d.mts | 1 s |
| `web-unit` | Vitest, 112 tests in 16 files (below) | 5 s |
| `web-page` | Chrome (playwright-core, `/usr/bin/google-chrome`, SwiftShader WebGL) on the real machine, 32 parts, 4 at a time | 70 s |
| `web-build` | the production build (vite build, the module as tested), served by `server.mjs` on a port of its own, with the smoke test's checks but those needing the network (`tests/build.mjs`) | 8 s |

**wasm**. Natively (`crates/wasm/src/tests.rs`): a model out of range is a null handle and a null handle is harmless;
every model boots to its ROM, with its frame's samples; a tape lists its blocks as JSON and loads at once with the
trap; files it cannot load say why, with the code for the reason; a state puts the machine back to the bit and a
damaged one is refused with the machine left as it was; a state carries its picture into a machine of another
model; snapshots in each format load back; options as bits; registers read and set, a step, a breakpoint, the
disassembly as JSON; SAVE as a TAP; JSON escaping; memory handed out and back; a file of zeros, a file over 16 MB and
a tape with nothing to play refused, the deck left as it was; a state's picture read from the state alone, the
same as loading it gives, for every model, the machine asked untouched. Then the module itself in Node,
through `wasm.ts`: **the native build, frame for frame** (the picture, all 64K and the registers, digested at frames
50, 150 and 300 of every model, and at 1,000, 2,000 and 2,700 of Saboteur's tape played from its edges, against
`examples/digest.rs` run natively, in the dev profile that the miscompilation never touched); **the contention
tables** a release build once got wrong (a NOP at 6000h from every T-state of the lines before, first, second, last
and after the paper's, on the 48K, the 128K and the +3: 4 T-states and the pattern's delay); every model booting
(the 128s to their menus, within 200 frames); a tape by LOAD ""CODE from its edges (over 1,500 frames) and with the
trap (under 10); a state to the bit across models, its picture read back, damaged ones refused; snapshots in each
format; SAVE as a TAP; 600 damaged files refused with a LoadError and no trap; files that would only fill its memory
refused (zeros as a TAP, a CSW whose 12 KB of Z-RLE inflate to 12 million pulses, a file over 16 MB), the memory grown
by under 80 MB and the machine running on; its speed in Node (said, not judged: 5,580 frames a second flat out);
Saboteur at once to its REWARD screen (under 7,500 frames); and Saboteur's start route (`tests/wasm/start.spec.ts`),
from the REWARD screen at once and after 37, 150, 400 and 2,500 frames, by the keys and by the joystick, to the
game, which then answers to what was chosen.

Unit (`web/src/**/*.test.ts`, `web/tests/server.test.mjs`): the key mappings (every typable character, both
mappings, the joystick keys, the arrows as cursor keys at BASIC); the feeder against a model of the ROM's KEYBOARD
routine (above, with keys whose presses and releases all come in one frame); the scheduler on simulated clocks
(above, with the sound card stopped and the tab hidden); the file chosen from recorded ZXInfo answers (Saboteur's
original TZX on a 48K, Cybernoid's 128K tape on a 128K, International Match Day's TZX on a 128K, Bomb Jack+'s
snapshot, a disk-only entry refused with its reason, Knight Lore refused as Distribution denied, the plain file and
later version, the machine names, every shelf entry Available and loadable, the search's query); an entry's inlay,
instructions and controls (Saboteur's, the shelf's, and none said where the record says none); a manual's sections
and its table of keys, however set out; the ROM's readiness read from the screen; save slots without storage and with
an IndexedDB that refuses; the legends against `roms/48.rom`'s tables; the stand-in (boot, typing, a whole tape
loaded with the stripes and the sound and the header's name and the screen, instant loading, the 128's menu, a .zip,
snapshots round-tripped in each format, states, inflate against zlib at levels 0, 1 and 9, a TZX's blocks); fit and
crops; rewind (ten minutes at half a second by default, under 12 MB of 9 KB states; a picture's colours sampled) and
its strip's scale (eight seconds a tenth of ten minutes, read back as placed); the loop (a frame that throws, or a
picture, and the heartbeat goes on; flat out the same share of each second at 30, 60 and 120 Hz; the batch ending
when the machine leaves flat out); the scheduler on the refreshes alone (one frame or none a refresh at 60 and
144 Hz, crystals 0.4% apart, hardware buffers of 128 to 1,024 samples); the operators typed in two characters; the
sound's soft limit; save slots whose store is held by an older page (memory, not a wait), their small pictures;
settings with refusing storage; the pass-through's paths (18 refused spellings, among them encoded `..`, `\`, NUL,
`//`, the books, the magazines, a program) and against an origin of the test's own (redirects on and off the host, 404
passed on, the size cap by length and by streaming, 403, a gzipping origin's body handed over whole, the sandbox CSP
and CORP on what comes through, a client that stops reading let go of at the time and the origin's connection with
it, no listener left behind), and a client asking too often (refused past its burst, let back in as the minute
goes on). The
fixtures (`web/tests/fixtures/zxinfo/`) are the API's own answers, which ZXInfo's metadata licence lets us keep.

Page (`web/tests/page.mjs`), the machine built first, each part on fresh pages with `?sound=off` (but the two about
sound), time moved by the test through Playwright's `page.clock` (paused once the page is ready), the network
answered from recordings (searches and entries; the archive with Saboteur's real tape, manual and inlay from the
fixture cache, or a tape the test makes: a BASIC loader, `10 LOAD ""SCREEN$`, and a screen; pictures with a
one-pixel PNG), any console error failing the part, the slowest first by nerd's record of them:

- ready on the real machine in WebGL 2 with 40 keys and 27 shelf cards; the stand-in still running for `?emulator=stub`;
  the module refused (its fetch failing): the page says it would not start, with Try again, and runs no stand-in;
- switched on: `© 1982 Sinclair Research Ltd` on the bottom line, the border read back from the canvas as
  216,216,216, ink in the © cell, 150 frames in 3 s of the page's clock;
- the television and the 2D canvas; BRIGHT white 13% brighter than normal white on the television (over 8%);
- the keyboard's layout (no legend on the plate over another, each key's legends on its face);
- a drawn key (lit while held, J's down and up) and a latched SYMBOL SHIFT before P, the ROM reading `LOAD "`;
- the PC keyboard: j, then Shift+' twice: J, SYMBOL SHIFT+P twice, no CAPS SHIFT, the bottom line `LOAD ""` in the
  ROM's font; the page from the keyboard; the arrows as CAPS SHIFT + 5 at BASIC and the Kempston joystick once a
  program is in (IN 31 reads 2 with left held);
- a tape from a file: four blocks listed, `LOAD ""` typed (33,36,25,36,25,30) once the ROM is ready, the border red
  and cyan in the pilot, then flat out (about 2,800 frames) to its screen, white ink on bright blue, and back to 1×;
- a 128 loading a tape from its menu: ENTER pressed 61 frames after switching on, when the menu shows (55–100), and
  the screen loaded;
- **Saboteur from the library**: searched, its card, `/archive/pub/sinclair/games/s/Saboteur.tzx.zip` fetched, the
  border only black and red while the game's 38,500 bytes come in, then **the £100 REWARD screen, row 0 and row 23
  exactly, under 9,400 frames after the tape went in (about 9,160), flat out**, the page back at 1×, the cassette labelled
  Saboteur! with its inlay, on a 48K, its keys (A, Z, N, M, SPACE) on the panel and outlined on the keyboard, the
  address `?game=4293`; then **Start the mission** (Keys) to the game, its panel on the screen (about 300 frames);
- **a link**: `?game=4293` puts Saboteur in the deck and plays it, its tape, manual and inlay fetched, the game's
  panel with how to start, and Share giving `…/?game=4293`; a .szx saved of it, opened again after a reset, is
  Saboteur! again;
- **save slots**: F2 keeps the machine, F4 puts it back; after a reload the link loads the game again and F4 brings
  the slot back with the tape in the deck where it was;
- snapshots saved as .z80, .szx and .sna and each dropped back;
- **rewind**: a moment every half second, the first moment's colours read whole, `LOAD` typed, six steps back by
  keyboard showing the moment's picture while choosing (drained, PREVIEW on the screen), Enter: the machine back at
  that moment, the bottom line without `LOAD`, the picture the moment's;
- **a SAVE** from BASIC (`10 REM hi`, `SAVE "hi"`, a key) offered by the deck as a TAP, downloaded as `hi.tap`: its
  header names `hi`;
- **the Kempston** with Saboteur's tape loading, after the power button, and after going back: IN 31 reads 0 (before,
  every power-on unplugged it, and a game read the floating bus as all four directions and fire);
- **a frame that throws** (the module made to trap): the machine stops, the screen says so, no frames run; Start it
  again revives the module and the machine runs on from the last moment, at BASIC;
- **files refused**: a TZX with nothing to play and a 17 MB file, each said in an error toast, the machine not
  reset (`LOAD` still on its bottom line), the deck empty;
- **<> typed as two characters**: `10 IF 1<>2 THEN PRINT 1` taken and listed;
- **calm stripes**: the border shown in one colour while the tape's pilot plays, the machine's own frame striped; F8
  reads the screen into the live region, F1 shows the keys;
- **a breakpoint** at 0038h: the machine stops there, paused, the inspector open at `▶ 0038  F5  PUSH AF`; removed,
  Run goes on;
- the warm-up on a reset (`warm-up`; `warm-fade` with reduced motion) and the footer's words, Amstrad's exactly;
- a setting remembered across a reload; sound after a click (the sound card's clock running frames, by condition,
  not by time, with their sound); the sound card suspended and resumed (frames on the display's clock meanwhile,
  under 8 frames queued when it returns);
- a tape playing on a phone leaving the window where it is; a phone with a game's panel (390 px: no sideways
  scroll, the touch pad shown, FIRE held is joystick bit 16); a phone held sideways (844 × 390: the pad left of the
  screen, FIRE right of it, the screen in the window and over 380 px wide).

The two parts about sound run on the sound card's clock, which page.clock does not move: they wait for conditions on
the wall's clock, and a wait that runs out says the part could not judge (inconclusive, not failed). The test's Vite
server watches no files and reloads nothing: a file saved meanwhile (another agent's) changes no page under test.

Parts a change cannot touch are skipped (by NERD_CHANGED; a change to the machine, `crates/`, runs them all); one
whose fixture cannot be had says it was skipped. The page's clock is paused a moment ahead of its own time, and asked
again if a busy machine let the clock pass it first (`pauseAt` refuses a time gone by). `tests/smoke.mjs` checks a
running server against the real archive and API: the page, Saboteur's tape and manual through `/archive`, the ZXDB
through `/zxinfo`, the module served as `application/wasm` and **the very module built and tested here** (its SHA-256 the
local `zx.wasm`'s, the build being reproducible), and the machine starting in Chrome with no errors and the 48K's
contention as tested (a NOP at 6000h from 14,335: 6, 5, 4, 3, 2, 1, 0, 0). `tests/build.mjs` (the `web-build` layer)
runs the same against the production build served here, before a deploy.

## Pictures

`node tools/pictures.mjs` writes them to `out/` (git-ignored), on the television, Saboteur from its link
(`?game=4293`), loaded flat out from the fixture cache and started by its panel's Start the mission:
`out/desktop.png` (1440 × 900, the 48K switched on, the set and the keyboard on the desk), `out/desktop-saboteur-loading.png`
(the last second of the loading screen at the tape's own speed, its attributes coming in under the black and red
stripes, the tape bar under the screen, the blue Durell cassette), `out/desktop-saboteur-reward.png` (the £100
REWARD screen), `out/desktop-saboteur-game.png` (the game: the ninja in the dinghy), `out/desktop-rewind-preview.png`
(a moment chosen on the strip, PREVIEW on the screen), `out/desktop-paused.png`, `out/desktop-settings.png` (the sheet
beside the live screen), `out/desktop-saboteur-panel.png` (the game's panel: the inlay, Start the mission, the steps,
the keys, a save kept, the manual open as a booklet), and on a phone (390 × 844 at 3×): `out/phone.png`,
`out/phone-saboteur-loading.png`, `out/phone-saboteur-reward.png`, `out/phone-saboteur-game.png`,
`out/phone-saboteur-panel.png`, and held sideways, `out/phone-landscape.png`. `node tests/shot.mjs` takes one
picture as asked.

## Known gaps

- **Colours are not measured.** No measurement of a real machine's colours could be found; the levels are the
  circuit's (85%). A capture of a real 48K's composite output, decoded, would settle it; the palette is one table.
- **How to start** (and Start the mission) is worked out for Saboteur alone; other games have their manual's keys and
  text, but nothing worked out against the game. The manual's table of keys is read by a heuristic: a manual set out
  unusually shows its text without a table.
- **Going back to a moment once a tape has played** costs a replay of the deck's log (33 ms with Saboteur's): the
  state keeps what was done to the tape, not the player's position. The preview no longer pays it (the picture is read
  from the state alone); keeping the player's position in the state would be a change of the state's format.
- **Flat out is paced by the display's refreshes** (65% of each): a page whose refreshes are slow (software drawing,
  as the page test's) loads more slowly; slices between refreshes (a MessageChannel) would not be, but would take that
  time from drawing, which is what makes those refreshes slow.
- The 128 family draws the 48K's keyboard (the 128's and the +2's are not drawn); the cassette goes into the deck with
  no animation; the counter's digits do not roll; the transport keys are buttons, not piano keys; sharp mode has no
  "sharp, filled" scaling (integer only); the rewind strip has no picture riding its marker (the screen shows the
  moment); holding a key to rewind live is not offered (Backspace is DELETE).
- **Save slots** keep a state for the build that made it and a .szx beside it; a slot loaded by a later build whose
  state format has changed comes back from the .szx, without the tape's position.
- The page test cannot hear: the sound's correctness is the audio layer's (docs/audio.md), the page's is that frames
  follow the sound card and carry samples.
- A breakpoint stops the machine mid-frame; the picture shown is the frame drawn so far.
- The 48K's mechanical counter counts seconds of tape, not reel turns.
- The television has no phosphor persistence (afterglow) and no interlace jitter (the Spectrum is not interlaced).
- The search shows only Available entries (the API's filter); a person cannot browse what is listed but not
  loadable. Disk images (+3 DSK) and microdrive cartridges are not loaded, as the machine has no drive.
- The page test draws WebGL in software (SwiftShader); the television shader's look is checked by eye (the
  pictures), not by test, beyond rendering without errors and being bright at the centre. Flat out under the test's
  clock runs 160 frames a refresh (the page's own cap, the clock not moving within a refresh), so Saboteur's 9,200
  frames take some 10 s of the wall's time there, most of it Playwright moving the clock.
