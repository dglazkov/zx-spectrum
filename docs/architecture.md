# How the emulator is put together

A ZX Spectrum, emulated to the T-state: every machine cycle of the Z80 lands on the ULA's timeline where the
real one would, so that what depends on that timing (border stripes while loading, multicolour engines, the
floating bus, the beeper's tone, a turbo loader's edges) comes out as it did. The test of it is the machine's own
software running unmodified: the ROM, the games, and the test programs written to tell emulators from hardware.

## The parts

```
crates/
  z80/        the CPU: every opcode, documented or not, flags to the undocumented bits, MEMPTR, Q, the R register,
              interrupt modes, HALT, the EI delay; machine-cycle by machine-cycle through a `Bus`
  audio/      band-limited synthesis: a buffer that takes a level change at a T-state and gives samples
  ay/         the AY-3-8912 (128K, +2, +3, Pentagon): tones, noise, envelopes, its DAC's levels
  tape/       TAP, TZX, CSW (and PZX): their blocks, and a player that turns them into edges on the EAR line
  snapshot/   .z80 (v1–v3), .sna (48K/128K), .szx: read and write, into a plain `Snapshot`
  unzip/      what is inside a .zip, as the archive hands most files out
  spectrum/   the machine: memory and paging, the ULA (video, contention, the floating bus, the keyboard, EAR/MIC),
              the beeper, the models (16K, 48K, 128K, +2, +2A/+3 without disks, Pentagon 128), loading anything
  wasm/       the C interface the browser calls, over `spectrum`
  cli/        `zx`, the emulator headless, for tests and agents
web/          the page: the screen, the sound, the keyboard, the tape deck, the library
roms/         the machines' ROMs (README.md: whose they are, and Amstrad's permission)
docs/         this, and a record of each part: what it does, the sources it was built from, how it is tested
scripts/      fixture (test files that are not ours to commit), build-wasm.sh
```

Each crate builds and tests alone (`cargo test -p tape`). The lower crates do not know the Spectrum exists: `z80`
is a Z80 on any bus, `ay` is an AY on any clock, `tape` turns any tape into edges. `spectrum` is where they meet.

## Time

- Time is counted in T-states of the Z80's clock: 3,500,000 Hz on the 16K/48K and the Pentagon, 3,546,900 Hz on
  the 128K, +2, +2A and +3. A `u32` T-state count runs from 0 at the start of each video frame (the moment the
  ULA raises INT); the machine subtracts the frame's length when one ends, and every part that keeps time does
  the same (`end_frame(frame_len)`).
- Frames: 48K 69,888 T (224 per line × 312 lines; 50.08 Hz); 128K/+2/+2A/+3 70,908 T (228 × 311);
  Pentagon 71,680 T (224 × 320).
- Nothing in the emulator reads the wall clock. The page decides how many frames to run; the emulator runs what
  it is asked to, and is the same machine at any speed.

## How the parts meet

### `z80`: the CPU and its bus

The CPU drives a `Bus` one machine cycle at a time, with the T-state counter in hand, and the bus applies its
delays (contention) to it. The CPU says what each cycle is (an opcode fetch, a memory read or write, an internal
cycle with an address left on the bus, an I/O read or write, an interrupt acknowledge), and when; it never decides
what a delay is. The shape (refined by `crates/z80`, which documents the final one):

```rust
pub trait Bus {
    fn fetch(&mut self, addr: u16, ir: u16, t: &mut u32) -> u8;   // M1: 4 T, the refresh address in T3–T4
    fn read(&mut self, addr: u16, t: &mut u32) -> u8;             // 3 T
    fn write(&mut self, addr: u16, value: u8, t: &mut u32);       // 3 T
    fn internal(&mut self, addr: u16, n: u32, t: &mut u32);       // n T with addr on the bus
    fn port_in(&mut self, port: u16, t: &mut u32) -> u8;          // 4 T
    fn port_out(&mut self, port: u16, value: u8, t: &mut u32);    // 4 T
    fn int_ack(&mut self, t: &mut u32) -> u8;                     // the byte on the data bus (0xFF on a Spectrum)
}
```

Each method advances `*t` past its cycle, contention included. `Cpu` exposes its registers as plain public
fields (`Regs`) for snapshots and the debugger, `step(&mut bus, &mut t)` runs one instruction (or one HALT
cycle), and `interrupt` / `nmi` take an interrupt if the CPU will. The machine asks before each instruction
whether INT is held at `t`.

### `audio`: band-limited sound

Sound is a level that changes at T-states. Each source (the beeper's EAR/MIC levels, the tape heard through the
speaker, the AY's three channels) adds a step of some height at some T-state to a buffer, which synthesises it
band-limited (no aliasing from the square edges) at the page's sample rate, and hands out stereo f32 samples
each frame. Its time base is the CPU clock, so the AY (clocked at half of it on the 128K) is converted by `ay`.

### `ay`

Registers selected and written at T-states (`select`, `write(t, v)`, `read`), run up to a T-state, putting
its three channels' levels into `audio` with the stereo placement asked for (mono, ABC, ACB). Its own clock:
1,773,450 Hz on the 128K family, 1,750,000 Hz on the Pentagon.

### `tape`

`Tape::parse(bytes)` reads TAP, TZX, CSW or PZX into blocks, each with what it is (a header with a name, data,
a turbo block, a pause, a group, a message...) for the page to list. A `Player` turns the tape into the EAR level
at each T-state of the CPU's clock (TZX timings are in 3.5 MHz T-states: the player scales them to the machine's
clock), through every TZX block kind, honouring pauses, loops, "stop the tape" and "stop if 48K". Standard ROM
blocks can be taken whole (`take_rom_block`) for the instant load that traps the ROM's LD-BYTES.

### `snapshot`

`Snapshot` is the machine at an instant, neutral of any file format: the model, the CPU's registers (its own
plain struct, not `z80`'s), the T-state in the frame, the border, the RAM banks, the paging ports (7FFD, 1FFD),
the AY's registers, interrupt state. `snapshot::load(bytes) -> Snapshot` knows .z80, .sna and .szx by their
contents; `save_z80`, `save_sna`, `save_szx` write them.

### `spectrum`: the machine

`Machine::new(Model)`; `run_frame()` runs one video frame, after which `frame()` is the picture and `audio()` the
sound it made; `key(Key, down)`, `joystick(..)`; `load(bytes, name)` takes a tape, a snapshot, a .zip of either,
or a .scr; `tape()` is the deck (play, stop, rewind, which block, where in it); `snapshot()` / `restore(..)`;
`save_state()` / `load_state()` (a fast whole-machine state, for rewinding). Options: instant tape loading (the
ROM trap), accelerated loading (the machine runs flat out while the tape plays), automatic tape start and stop,
Issue 2 or 3 keyboard, joystick kind, AY stereo.

The picture is 352 × 296 bytes, one a pixel, each a colour from 0 to 15 (0–7 the normal colours, 8–15 the
bright ones: black, blue, red, magenta, green, cyan, yellow, white). The paper (256 × 192) starts at (48, 48):
48 pixels of border at left, right and top, and 56 at the bottom. What a television showed of the border is the
page's business (it crops).

Keys are numbered as the ULA reads them: half-row `r` (0–7) and bit `b` (0–4) make key `r * 5 + b`. The
half-rows, by the address line that selects them, and their keys from bit 0:

| r | port | keys (bit 0 → 4) |
|---|------|------------------|
| 0 | FEFE | CAPS SHIFT, Z, X, C, V |
| 1 | FDFE | A, S, D, F, G |
| 2 | FBFE | Q, W, E, R, T |
| 3 | F7FE | 1, 2, 3, 4, 5 |
| 4 | EFFE | 0, 9, 8, 7, 6 |
| 5 | DFFE | P, O, I, U, Y |
| 6 | BFFE | ENTER, L, K, J, H |
| 7 | 7FFE | SPACE, SYMBOL SHIFT, M, N, B |

Joysticks are five bits: right, left, down, up, fire (bit 0 → 4), as the Kempston interface reads them; the
machine turns them into a Sinclair or cursor joystick's keys when that is the kind asked for.

### `wasm` and the page

The browser loads `zx.wasm` (`crates/wasm`, a C interface: `zx_*` functions taking and returning numbers, files
passed through a buffer in the module's memory) and wraps it in `web/src/emulator/` as the `Emulator` interface
that the rest of the page uses. Nothing else in the page touches the module. The page owns the clock: it runs
frames as the sound card takes the samples (an AudioWorklet, fed by messages), presents the latest frame on each
display refresh through WebGL (palette, then the television), and maps the PC's keyboard and gamepads onto the
Spectrum's keys and joysticks.

### Files from the archive

The page searches the ZXDB through the ZXInfo API (`https://api.zxinfo.dk/v3/`, which allows cross-origin
requests) and shows its screenshots straight from spectrumcomputing.co.uk. The archive's files themselves come
without cross-origin headers, so the server (`web/server.mjs`) fetches them for the page at
`/archive/pub/sinclair/...` and `/archive/zxdb/sinclair/...`, from spectrumcomputing.co.uk alone, keeping
nothing. The archive holds only what its rights holders allow to be distributed; the page loads only what ZXDB
lists as available.

## Tests

`nerd test` runs each part's tests (nerd.toml lists them, a layer each): the CPU against the test suites written
for it, each other crate against its formats and sources, the machine against the ROM and the test programs,
the page in Chrome. Fixtures that are not ours to commit (the GPL'd test suites, games) are fetched once into a
cache by `scripts/fixture` and pinned by hash (`fixtures.txt`); a test whose fixture cannot be fetched says it
was skipped, never that it passed.

Build with a target directory of your own when other work may be building beside you
(`CARGO_TARGET_DIR=target/<part>`), so that one build does not wait on another's lock.
