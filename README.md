# ZX Spectrum

A ZX Spectrum in the browser, faithful to the T-state, made so that Saboteur, and the other games of a 1980s
childhood, play as they did: the 16K, the 48K, the 128, the +2, the +2A, the +3 (without its disk drive) and the
Pentagon 128. Every machine cycle of the Z80 lands on the ULA's timeline where the real one's did, so what depended on
that timing comes out as it did: the border's stripes while a tape loads, the beeper's tone, multicolour demos, the
floating bus, a turbo loader's edges. Tapes load from their real signal (or at once, or flat out), with the sound and
the stripes, on a television that warms up as it is switched on.

Open `?game=4293` and Saboteur loads straight away: the shelf has 27 loved games, and the whole ZXDB can be searched.
A game from the library brings its cassette's inlay, its manual (with its keys read out), how to start it where that is
not obvious, and save slots of its own (F2 saves, F4 loads). Ten minutes of rewind, at half a second a step.

## Running it

You need Rust (with the `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`) and Node 22 or
later.

```sh
cd web
npm install
npm run dev          # builds the emulator to WebAssembly (scripts/build-wasm.sh), then Vite at http://localhost:5173
```

`npm run dev` builds the module first when it is missing or stale (cargo is incremental: a moment when nothing has
changed). To build it yourself: `scripts/build-wasm.sh` (into `web/src/emulator/zx.wasm`; reproducibly: the same
sources and toolchain make the same bytes wherever they are built, so the module the Dockerfile builds is the one the
tests ran, which the smoke test checks). `npm run build` makes `web/dist/`, and `npm start` serves it as the
deployed site does (`web/server.mjs`, port `PORT` or 8080), passing the archive's files and the ZXDB through for the
page. The `Dockerfile` builds the whole site from the repository alone; `nerd deploy` puts it up.

The page's address takes `?game=<ZXDB id>`, `?emulator=stub` (the stand-in the page was built against), `?renderer=2d`
and `?sound=off`.

## The command line

`zx` (`crates/cli`) is the machine headless, for tests and agents:

```sh
cargo run --release -p zx-cli -- run game.tzx --frames 9100 --text           # LOAD "" typed, the screen as text
cargo run --release -p zx-cli -- run game.tzx --tape instant --png out.png    # loaded at once, a picture
cargo run --release -p zx-cli -- tape game.tzx                                # the tape's blocks
cargo run --release -p zx-cli -- bench                                        # how fast, natively
```

`zx --help` lists the rest: snapshots, disassembly, screens as text or pictures, comparing pictures by Spectrum
colour, profiling, port traces. docs/machine.md has them all.

## The tests

The project's tests are run by `nerd` (`nerd.toml`, a layer each, fastest first): `nerd test` runs the ones that
cover what changed, `nerd test NAME` one, `nerd test all` every one.

| Layer | What |
|---|---|
| `z80`, `z80-suites` | the CPU against FUSE's tests, all 1,604,000 SingleStepTests, ZEXDOC and ZEXALL, z80test |
| `audio`, `tape`, `snapshot` | band-limited sound and the AY; every TAP/TZX/CSW/PZX block; .z80/.sna/.szx and zips |
| `machine` | the seven models: contention, the floating bus, the border, ports, paging, LD-BYTES, SAVE, states, zx |
| `corpus` | the real software held to what real hardware shows (docs/test-corpus.md): 98 parts |
| `wasm` | the WebAssembly build: its C interface, and the same frames as the native build, bit for bit; Saboteur's start route |
| `web-types`, `web-unit` | the page's TypeScript, and its parts without a browser |
| `web-page` | the page in Chrome on the real machine, on the page's own clock: Saboteur to its REWARD screen and more |
| `web-build` | the production build, served by the production server, with the smoke test's checks |

Fixtures that are not ours to commit (test suites under the GPL, the games) are fetched once into a cache by
`scripts/fixture` and pinned by their SHA-256 in `fixtures.txt`; a test whose fixture cannot be had says it was
skipped.

## What is faithful, and how we know

Each part was built from its sources and is held to them; `docs/` has a record of each: what it does, where every
figure comes from, how it is tested, and what is not known.

- **The CPU** (docs/z80.md) passes every oracle there is: FUSE's core tests bus event by bus event, all 1,604,000
  SingleStepTests T-state by T-state, ZEXDOC and ZEXALL, and Patrik Rak's z80test, whose expected values were
  measured on a real Zilog Z80 (the undocumented flags, MEMPTR, Q).
- **The machine** (docs/machine.md) passes the test programs written to tell emulators from hardware, against their
  captures from real machines: z80test through the tape, fusetest on four models, the Butlers' timing tests (and the
  five a real early 128 fails, failing), Minfo, ULA test 3, Rak's timing test against ten captures, Floating Spy,
  azesmbog's ULA pictures pixel for pixel, Woodmass's tests, the +2A/+3's floating bus and paging.
- **The games**: Saboteur from its original tape, its loading screen byte for byte, the £100 REWARD screen exactly,
  then the game; twenty more games and demos with their custom loaders (Speedlock 1 to 7, Alkatraz, Bleepload,
  Power-Load, SoftLock) and multicolour engines (docs/test-corpus.md).
- **Sound** (docs/audio.md): the beeper and the tape through the 48K's speaker or a television, band-limited; the
  AY's levels measured from real chips.
- **The page** (docs/web.md): frames run against the sound card's own clock, so that the machine keeps its own pace;
  the keyboard paced as the ROM's KEYBOARD routine needs it (tested against a model of it); the keyboard drawn from
  the ROM's own tables and a photograph of the case; the television's colours decoded as a PAL set decodes them.

Where something could not be checked against hardware, the docs say so (docs/test-corpus.md §5, each doc's known
gaps).

**A miscompilation.** rustc 1.98.1 (LLVM 22.1.8) compiled the contention table's fill, `pattern[(i % 8) as usize]`,
into reads past the 8-byte array at opt-level 2 and above, once a function it could not see through was nearby: every
other 8 T-states of each line got stack garbage, in release builds only. It reproduces in a 40-line program,
`docs/toolchain/contention-miscompile.rs`, kept to be reported upstream. The machine fills its tables another way;
the corpus checks a release build's tables T-state by T-state, the wasm layer checks the WebAssembly build's, and the
deployed site's smoke test checks the module it serves.

## Credits

- **The ROMs** (`roms/`, README there) are Sinclair Research's and Amstrad's. Amstrad have kindly given their
  permission for the redistribution of their copyrighted material but retain that copyright.
- **The games**, their inlays and their manuals come from the [Spectrum Computing](https://spectrumcomputing.co.uk)
  archive, found through the [ZXDB](https://github.com/zxdb/ZXDB) by way of [ZXInfo](https://zxinfo.dk)'s API, and
  only those the ZXDB lists as available. Thank you to everyone who keeps them.
- **The test suites**: FUSE's core tests (Philip Kendall and the Fuse developers); SingleStepTests/z80; Frank D.
  Cringle's ZEXDOC and ZEXALL; Patrik Rak's z80test and timing test; Jan Bobrowski's Minfo and ULA tests; Ramsoft's
  Floating Spy; Mark Woodmass's tests; azesmbog's ULA tests; Hikaru's +2A/+3 floating bus test; Weiv's AY/YM test;
  the Butlers' timing tests; and the redcode wiki's catalogue of them, with their captures from real machines.
- **References**: the comp.sys.sinclair FAQ, *The Complete Spectrum ROM Disassembly* (Ian Logan, Frank O'Hara), Chris
  Smith's ULA research, Fuse and libspectrum (read, not copied), MiSTer's and the ZX Spectrum Next's FPGA cores.
- **Type**: Archivo (Omnibus-Type, SIL OFL 1.1).

Licensed under the Apache License 2.0 (`LICENSE`), but for the ROMs and what comes from the archive, which are
their owners'.
