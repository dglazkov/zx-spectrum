# The test corpus: real software, and what real hardware shows

This is the software the machine (`crates/spectrum`) is judged by. It covers four kinds of thing: test programs
written to tell emulators from hardware, demos that only look right when the timing is exact, the games the owner
wants to play, and the measurements the picture is drawn from. For each item it says what it is, which machine
it is for, how to run it, how long it takes, and exactly what a real machine shows. It also says how an automated
test should check it, and where each fact comes from.

None of these files are committed. Each is a fixture in `fixtures.txt`, fetched once by `scripts/fixture NAME` and
pinned by its SHA-256. Most of these programs have no licence statement. Their authors posted them for emulator
writers, and the games are on the archive by their rights holders' leave. The cache keeps all of them out of the
repository and out of any image. A test whose fixture cannot be fetched reports itself skipped.

## How to read this

- **Frames** are video frames of the model being run: 69,888 T on the 16K/48K (50.08 Hz), 70,908 T on the
  128K/+2/+2A/+3 (50.02 Hz), and 71,680 T on the Pentagon (48.83 Hz).
- **L** is the time a tape takes to play at its own speed, from the moment it starts. It is computed from the
  pulses in the file: each block's pilot, sync and data, plus a 1 s pause after each TAP block. To get the time
  from power-on, add the boot (150 frames on a 48K, 300 on a 128K) and the typing of `LOAD ""`. Standard ROM
  blocks play at about 6 s per KB. With the ROM trap (instant loading), a tape made only of standard blocks costs
  a few frames instead. A turbo or custom loader always plays in real time, or flat out while the machine keeps
  its own time.
- **`--text`** is the 32 × 24 screen read cell by cell against the ROM font. Row 0 is at the top; rows 22–23
  are BASIC's lower screen. Text a program draws in its own font cannot be read this way; such checks compare
  pictures instead.
  - Many programs print in INVERSE, or in inverse colours (the 128K menu bar, `OK` marks). The reader should
    match a cell's pattern with either ink or paper set, and report whether it was inverse. ulatest3 marks
    contended cells this way.
  - © is character 127 of the ROM font.
- **Pictures** are compared by colour number (0–7 normal, 8–15 bright), never by RGB. Map each reference pixel to
  the nearest of the 15 Spectrum colours in that reference's own palette. The references come in four kinds:
  - **352 × 296**: from the redcode wiki (https://github.com/redcode/ZXSpectrum/wiki/Tests). Palette 0x00, 0xD8,
    0xFF. Their geometry is exactly that of `zx --png`, with the paper at (48, 48), so compare the whole frame.
  - **352 × 240**: z80test's own, Fuse-like 0xBF/0xFF. Paper at (48, 24): the emulator's frame with its top 24 and
    bottom 32 rows cut off.
  - **256 × 192**: ZXDB "in-game" GIFs and zxinfo PNGs, the paper only. Compare them with the frame's
    (48, 48)–(303, 239). They are dumps of screen memory, with at most two colours to a cell and no border, so a
    multicolour or border effect cannot be judged from them.
  - **`.scr`**: 6,912 bytes of pixels and attributes, the loading screen exactly as it is in the tape's file.
    It is the most exact reference there is: render it and compare it with the paper once the loader has loaded
    the screen (for FLASH cells, accept either phase).
  - `-hw-` in a name marks a photograph or capture of a real machine. Those are for reading text and judging by
    eye only, never for comparing pixels.
- **Keys**: "press K" means hold the key for 5 frames, then release it. The ROM's keyboard scan sees a key on
  the next interrupt, and a game polling the port sees it at once.

### What the checks need from `zx run`

The checks need these from the CLI (`crates/cli` is not written yet):

- choosing the model: 48K Issue 3 (the default), 48K Issue 2, 128K, +2, +2A, +3, Pentagon;
- choosing early or late timings, where the model has both;
- pressing keys at given frames, or whenever `--text` shows something: `scroll?` is the commonest;
- choosing how a tape is played: real time, instant (the ROM trap), or flat out. With automatic stop/start, a
  multi-part demo can load its next part;
- running until a text appears, with a limit on frames;
- reading a byte of memory, once: Shock's 48K/128K flag.

Where a check below says "run until X (at most N)", it fails at N.

## 0. The ROMs at power-on (no fixture: `roms/`)

Before any program, each model's own ROM must come up as the real one does. The strings below are read out of
the ROM images in `roms/` (bit 7 ends each menu string; © is character 127):

| Model | ROM | What the screen shows once it has started | Check |
|---|---|---|---|
| 16K/48K | `48.rom` | white border, white paper, the cursor and, on the bottom row (row 23), `© 1982 Sinclair Research Ltd` | run 150 frames; row 23 of `--text` starts with `© 1982 Sinclair Research Ltd` |
| 128K | `128-0.rom` | the menu: a black title bar `128` with the rainbow flash, then the items `Tape Loader`, `128 BASIC`, `Calculator`, `48 BASIC`, `Tape Tester`, and at the bottom `© 1986 Sinclair Research Ltd` | run 300 frames; `--text` has each item and the copyright line. Choosing `48 BASIC` gives the 48K's `© 1982 Sinclair Research Ltd` (`128-1.rom`) |
| +2 (grey) | `plus2-0.rom` | title `128`, items `Tape Loader`, `128 BASIC`, `Calculator`, `48 BASIC` (no Tape Tester), and `©1986, ©1982 Amstrad Consumer` / `Electronics plc` | as above; `48 BASIC` gives `© 1982 Amstrad` (`plus2-1.rom`) |
| +2A/+3 | `plus3-0.rom` … `-3` | title `128 +3`, items `Loader`, `+3 BASIC`, `Calculator`, `48 BASIC`, and `©1982, 1986, 1987 Amstrad Plc.` | as above |
| Pentagon 128 | the 128K's ROMs here (`roms/README.md`) | the 128K's menu; real Pentagons usually booted a TR-DOS/service ROM first, which this project does not have | as for the 128K |

The menu's highlight bar and title are drawn in inverse colours: a `--text` reader that matches cells by their
pixel pattern, whichever of ink or paper is set, reads them. The frame by which each screen is complete is not
measured on hardware here: the 48K's RAM test fills 49,152 bytes at 32 T each (RAM-FILL, 0x11DC) and reads them
back at 84 T each (RAM-READ, 0x11E2), about 5.7 million T-states before contention, which puts the copyright
line at about frame 85, so 150 is a safe bound; the 128K tests and clears more and is given 300. The +3 ROM here
is version 4.0 (its built-in test program says `SPECTRUM +3 test program V 4.0`); a +2A shipped with 4.1, whose
title may differ.

### Loading stripes (the ROM's LD-BYTES, `48.rom` 0x0556)

While the ROM loads, the border shows what it hears, and this is exact, from the code: it sets the border to
red (`C = 0x02`, plus the EAR bit) while it waits for a pilot, and complements it at every edge it finds
(`LD A,C : CPL : LD C,A : AND 7 : OR 8 : OUT (0xFE),A`), so the pilot tone draws **red/cyan** stripes (2 ↔ 5);
after the sync pulses it XORs C with 3, so the data draws **blue/yellow** stripes (1 ↔ 6). With a standard
pilot pulse of 2,168 T the red and cyan bands are each 2,168 / 224 ≈ 9.7 scan lines tall and drift slowly up the
screen (a full cycle of 4,336 T does not divide the 69,888-T frame); the data's pulses (855 T for a 0 bit, 1,710
T for a 1) make bands about 3.8 and 7.6 lines tall. Between blocks, with no edges, the border holds its last
colour. When loading ends the ROM restores the border from BORDCR (`SA/LD-RET`). A check: during the first
header's pilot, the border rows of a frame contain only colours 2 and 5, in bands 9–10 lines tall; during data,
only 1 and 6.

## 1. Test programs: telling emulators from hardware

### 1.1 Patrik Rak's z80test 1.2a (the CPU, run on the machine)

Pinned from the v1.2a release zip (MIT licence, `license.txt` in the zip; source at
https://github.com/raxoft/z80test, tag v1.2a = commit `c490c0ca`). Each TAP is a BASIC loader
(`10 CLEAR 32767:LOAD "" CODE:CLS` / `20 RANDOMIZE USR 32768`) and the code at 32768. The tests were
recorded from a real 48K Spectrum with a Zilog Z80, so a 48K that passes them all matches that machine. They run
with interrupts off in uncontended memory; they print through the ROM (`RST 16` on channel 2, the upper screen),
so `--text` reads every line.

What they print, from `src/main.asm` (byte for byte):

- Row 0: `Z80 <variant> test`, then `TAB 19`, then `© 2012 RAXOFT` (the © is character 127 of the ROM font), so
  for z80full: `Z80 full test      © 2012 RAXOFT` (32 columns). The variant words are `full`, `doc`, `flags`,
  `doc flags`, `CCF`, `MEMPTR`.
- A blank row, then one row a test: the number in three digits, a space, the name, then `TAB 30` and `OK`
  (`000 SELF TEST` … `OK` in columns 30–31). There are 160 tests, `000 SELF TEST` to `159 IM N`.
- Tests 003–006 (`SCF (NEC)`, `CCF (NEC)`, `SCF (ST)`, `CCF (ST)`) are the other makers' SCF/CCF variants and
  run only once something has failed: on a correct (Zilog) CPU they print `Skipped` at columns 25–31.
- A test that fails prints `FAILED` at columns 26–31 and, on the next row, `CRC:xxxxxxxx   Expected:xxxxxxxx`.
  The IN tests first read port FE with A=0 and need `BF`: otherwise `FAILED`, then `IN FE:xx` and
  `Expected:BF`. The read is of port 00FE, every half-row at once, so when they run the tape must be stopped
  (the EAR line quiet) and no key may be held.
- At the end a blank row and `Result: all tests passed.`, or `Result: nnn of 160 tests failed.`; then the program
  returns to BASIC, which prints `0 OK, 20:1` on the bottom row.
- **The screen fills**: the ROM stops at `scroll?` (bottom row) about every 21 rows: first after `019 OR N`, about
  7 times in all. On real hardware the user presses a key; any key but N, SPACE or BREAK goes on (those stop the
  program with `D BREAK - CONT repeats`). The check has to press one (ENTER, held for 5 frames) each time the
  bottom row of `--text` reads `scroll?`.

How long: the CPU time of a passing run is known exactly from the `test-Z80` harness of the redcode Z80 library
(https://github.com/redcode/Z80/blob/master/sources/test-Z80.c, which runs these TAPs with the ROM's print
routine trapped, no contention and no interrupts); add a few seconds for the ROM's printing and the scrolls.

| Fixture | What it tests | Machine | CPU cycles (redcode) | Frames to run (48K) | Expected result |
|---|---|---|---|---|---|
| `test-z80full.tap` | every instruction: all flags (incl. bits 5 and 3) and all registers | 48K (any model with a Zilog Z80) | 1,132,649,578 | 16,207 (5 min 24 s) | `Result: all tests passed.` |
| `test-z80doc.tap` | all registers, only the documented flags | same | 1,139,700,430 | 16,308 | `Result: all tests passed.` |
| `test-z80flags.tap` | all flags, registers ignored | same | 556,734,421 | 7,966 | `Result: all tests passed.` |
| `test-z80docflags.tap` | documented flags only | same | 559,087,578 | 8,000 | `Result: all tests passed.` |
| `test-z80ccf.tap` | flags after a CCF following each instruction (the Q register; Zilog behaviour) | same | 603,147,843 | 8,630 | `Result: all tests passed.` |
| `test-z80memptr.tap` | flags after BIT n,(HL) following each instruction (MEMPTR) | same | 564,118,134 | 8,072 | `Result: all tests passed.` |
| `test-z80ccfscr.tap` | a picture of bits 5 and 3 after CCF for every A/F pair; runs forever | same | (endless) | 50 after it starts | the paper matches `ref-z80ccfscr-zilog.png` exactly |

Loading each TAP at the ROM's speed takes 89 s (4,470 frames; z80ccf 4,600; z80ccfscr 18.6 s, 930 frames),
counted from the blocks: a 6.1 s header, the 44-byte BASIC loader (3.2 s), a header, and the 14,300-byte code
(74 s), with the usual 1 s pause after each block. With the ROM trap it is a few frames.

The reference pictures (`ref-z80ccfscr-zilog.png`, `-nec.png`, `-st-cmos.png`, from the repository's `img/`,
pinned at commit `c490c0ca`) are 352 × 240, 4-bit indexed, and their palette is in the emulator's own colour
order (0–7 normal, 8–15 bright; Fuse-like 0xBF/0xFF levels), so the comparison is by colour number, not RGB.
Their paper is at (48, 24): it is the emulator's picture (paper at (48, 48)) with its top 24 and bottom 32 rows
cut off. The program fills the attributes of the top two thirds with white and bright white columns (0x38,
0x78 alternating) and draws in the pixels there; the bottom third and the border stay white (colour 7).

How to automate:

- z80full/doc/flags/docflags/ccf/memptr: on a 48K (Issue 3), load the TAP, then run frames until `--text` shows
  `Result:` (at most load + 1.1 × the frames above), pressing ENTER whenever the bottom row reads `scroll?`. Pass
  when a row reads exactly `Result: all tests passed.`, no row reads `FAILED`, and the bottom row reads
  `0 OK, 20:1`. The first screen (at the first `scroll?`) is a good early check: row 0 is the header above,
  rows 2–21 are tests 000–019, with `Skipped` on 003–006 and `OK` on the rest.
- z80ccfscr: load, run until the program has started and 50 frames more, and compare the 352 × 240 window of the
  picture starting at row 24 with `ref-z80ccfscr-zilog.png`, pixel by pixel, by colour number: every pixel
  must match (the NEC and ST pictures are what other CPUs give: an emulated Zilog must not match them).
- The CPU crate's own suites (`fuse-z80-tests.in` / `.expected`, `zexdoc.com`, `zexall.com`,
  `singlestep-z80.zip`) are pinned for `crates/z80` and are not run on the machine.

### 1.2 The machine: contention, the floating bus, the border, interrupts, paging

Most of these come from the redcode wiki's catalogue of emulator tests (https://github.com/redcode/ZXSpectrum/wiki/Tests,
one page per test, with expected-result captures and photos of real machines). Its owner keeps the files at
https://zxe.io/depot/. Where the author's original was still reachable it is pinned instead (raxoft.cz,
archive.org `id_` copies of shadowmagic.org.uk, ramsoft.bbk.org, torinak.com and zxspectrum4.net). Every original
that was checked is byte-identical to the depot's copy.

The `ref-*.gif` captures are emulator renders that the wiki checked against the hardware photos on the same page.
They are not grabs from hardware. Several assume an NMOS Z80 (OUT (C),0 writes 0; a CMOS Z80 writes FF, which
turns a black border white in the azesmbog tests).

| Fixture | What it tests | Machine | How to run | Frames | Expected on hardware (pass) | Automate |
|---|---|---|---|---|---|---|
| `test-fusetest.tap` | Philip Kendall's Fuse test (2008-03-28, GPL): frame length, machine type, contention offset, then BIT n,(IX+d) flags, DAA, LDIR over a contended boundary, contended IN, floating bus, contended memory, high-port contention 1 and 2, reads of 0x3ffd and 0x7ffd (the 128K writes the floating bus into its paging latch) | 48K, 128K, +3, Pentagon (each skips what does not apply) | LOAD "", runs itself | L 1,526, then ~150 | 48K: the listing below; then BASIC's OK report | run until `Machine type:` and 300 frames more (at most 2,000); `--text` has the machine line expected for the model, and no row contains `failed` (a failure prints `... failed (0xNN)`) |
| `test-timing-tests-48k.sna` | Richard and Tim Butler's Timing Tests 48K v1.0 (2010): 34 instruction groups timed uncontended and contended (R, loop count and SP at the next interrupt), IN/OUT, the 48K floating bus; detects early/late timings first | 48K | load the snapshot; at `choose test 1-35 or leave blank for all` (about frame 100) press ENTER | 1,500–2,500 after ENTER | first `TYPE1 (Early) timings detected.` (or `TYPE2 (Late)`); every test line ends `Pass`; finally `All Tests Complete 100% Pass` and `Press any Key.` | press ENTER at 100; run until `All Tests Complete` (at most 4,000); require `100% Pass`. A failure stops at `Press any key for next test.` and the end says `N tests failed, unknown results.` The stitched log `ref-timing-tests-48k-early.gif` (352 × 3,664) has every value |
| `test-timing-tests-128k.szx` | the same at 128K timing (2015); paging locked to 48 BASIC | 128K/+2 | load the snapshot (it waits at the `choose test` INPUT; it says `** MUST RUN IN 48k MODE **`, and the snapshot is in that mode); press ENTER at once | ~1,500 | late timings (a +2; every hardware report agrees): tests 1–34 `Pass`, then `9 STOP statement, 1350:1`. Early timings (a toastrack 128K): tests 4, 17, 18, 26 and 33 (contended) fail on the real machine too | run until `STOP statement` (at most 3,000); for the late model, no `Fail`; for the early model, exactly those five. Each failure waits for a key. References: `ref-timing-tests-128k-late.gif`, `-early.gif`. Each test also prints a stray debug number (`PRINT k`, line 5126) |
| `test-minfo.tap` | Jan Bobrowski's Minfo (2025): frame time, INT length, first contended T-state, line time, measured over and over | all | LOAD "" | L 1,182, then ~700 | 48K: `Frame time: 69888`, `INT time: 32`, `First contended: 14335`, `Line time: 224`; bottom row `Minfo © 2011, 2025 Jan Bobrowski`. 128K: `70908`, `228`. Pentagon: `71680`, `First contended` `Failed`, `Line time` `Skipped` | run L + 1,000; text match per model |
| `test-minfo-2011.tap` | Minfo, 2011 version (GPL) | all | LOAD "" | L 1,114, then ~100 | 48K: `Frame time: 69888`, `EI is prefix: yes`, `INT time: 32`; bottom `© 2011 Jan Bobrowski` | text match. `ref-minfo-2011-48k.png` is a 354 × 266 window grab, for text only |
| `test-ulatest3.tap` | Bobrowski's ULA test 3 (2011, GPL; adapted to the 128): for each T-state from 14329 (14355 on the 128) the floating-bus byte read from port FFFF, drawn INVERSE where an IN from FFFE at that T-state is contended | 48K, 128K (not +2A/+3) | LOAD "" (a BASIC program; loops forever) | L 1,301, then ~1,200 | 48K: header `ULA test 3 by JB`; rows `14329` to `14473` step 8, eight bytes each: 14329 all `FF`; the 16 rows 14337–14457, row k = 0–15, read `FF FF` 2k 0x40+2k 2k+1 0x41+2k `FF FF` (first `FF FF 00 40 01 41 FF FF`, last `FF FF 1E 5E 1F 5F FF FF`), columns 2–7 inverse; 14465 and 14473 all `FF`; bottom `14329 iport:FFFF cport:FFFE` | run L + 1,500; `--text` for the bytes, the inverse flag for the contention marks, or the frame against `ref-ulatest3-48k.gif` |
| `test-timingtest-rak.tap` | Patrik Rak's timing test v0.3 (2013, GPL): how long a piece of code takes at each T-state from 14328 (14336 on the 128K family): 0 contended NOP, 1 NOP with I=0x7F (snow), 2–7 IN from 00FE, 00FF, 7FFE, 7FFF, FFFE, FFFF (the I/O contention patterns), 8 RET at 49152 per 128K page | 48K, 128K/+2, +2A/+3 | LOAD ""; at `Choose test: ` type the digit, ENTER; at `Press any key.` a key returns to the menu | L 1,539, then ~1,600 a test | `Frame duration: 69888` and the menu; test 0 on an early 48K: rows 14328 and 14464–14480 all `4`, rows 14336–14456 `10 9 8 7 6 5 4 4`; on a +3 `7 6 5 4 11 10 9 8`; test 8 in bank 0: all `0` | for each test, run until `Press any key.`, compare the frame with its reference: `ref-timingtest-rak-48k-menu`, `-48k-early-0`, `-early-1`, `-early-2`, `-48k-3`, `-early-4`, `-128k-early-0`, `-128k-8`, `-plus3-0`, `-plus3-3` (all `.gif`); `ref-timingtest-rak-hw-plus2-128k-0.jpg` is a real +2. Late timings shift the values one column |
| `test-floatspy.tap` | Ramsoft's Floating Spy v0.33 (2002, freeware): detects the ULA, samples the floating bus at a chosen T-state, and self-tests a burst over 8 lines | 48K, 128K (shows `??? BC=` on +2A/+3 and Pentagon) | LOAD ""; press T for the self-test (Q/A move the time, W/S the offset, P the port) | L 2,390; the self-test ~5,000–6,000 | after loading: `ULA TYPE: 48K`, `IM2 T_OFS: 29 t-states`, `IN() TIME: 14347 t-states`, `IN() BYTE: 0`, `I/O PORT: 255` (128K: `128K`, `25`, `14368`); after T: `Test completed.` then `Floating bus  OK  for ULA 48K` (or `128K`), `OK` inverse | press T after loading; run until `Test completed.` (at most 9,000); require `Floating bus  OK  for ULA` (spaces as printed, `OK` inverse). An error prints `T=... BUS=...` and pauses 3 s; the end gives `Floating bus errors: N`. References: `ref-floatspy-48k.gif`, `-48k-selftest.gif`, `-128k.gif`, `-128k-selftest.gif` |
| `test-ula48-simple.tap` | azesmbog's ULA 48 Simple Test (2012): a picture drawn with border and attribute writes timed to the T-state: border OUT timing, contention, OUT (C),0 | 48K | LOAD "" (ROM blocks: the trap works) | L 8,883, then ~100 | exactly `ref-ula48-simple.gif` (NMOS: black side borders); the photo of a real 48K, `ref-ula48-simple-hw-48k.jpg`, agrees | compare the whole frame, border included, with the GIF |
| `test-ula128-timing.tap` | the same at 128K timing | 128K/+2, in 128 or 48 mode (not 48K, not +2A/+3) | Tape Loader / LOAD "" | L ~6,470 | exactly `ref-ula128-timing.gif`; `ref-ula128-timing-hw-plus2.jpg` is a +2 | as above |
| `test-ula128e-plus3.tap` | the same for the +2A/+3 gate array (the 2012-10-07 build: the 10-10 build draws a wrong picture a quarter of the time at normal loading speed) | +2A/+3 only | Loader / LOAD "" | L ~6,640 | exactly `ref-ula128e-plus3.gif`; `ref-ula128e-plus3-hw-plus2a.jpg` is a +2A | as above |
| `test-im0-2.tap` | Mark Woodmass's IM0-2 (2019): early or late timings, and how long an IM 0 response takes, read through the floating bus during the acknowledge | 48K | LOAD "" | L 1,057, then ~50 | `Machine uses early timings` (or `late timings`), `IM 0 response = 13T`, `0 OK, 40:1`; yellow border and a strip of colour on the top line (`ref-im0-2.gif`) | text must contain `IM 0 response = 13T` and the timing line for the model |
| `test-int-retrigger.tap` | Woodmass's interrupt retriggering test (2021): an IM 2 handler of `inc c : ei : ei : ld a,r` must be entered once a frame. INT must have ended before it is accepted again, and the EI delay matters | all | LOAD "" | L 1,055, then < 10 | `Your emulator is good`, then `0 OK, 40:1` (`ref-int-retrigger.gif`); a failure prints `Your emulator is crap` | text match |
| `test-floatffd.tap` | Woodmass's FloatFFD (2023, GPL): on the 128K/+2 a read of port 7FFD writes the floating-bus byte into the paging latch | 128K/+2 | LOAD "" (ends in an endless loop, no OK) | L 1,077, then < 10 | a red bar on top, then `IN (#7FFD):  FF`, `IN (#FF):  13`, `Paged bank:  07`; a mismatch adds `expected: XX`; a 48K prints `Not a 128K Spectrum` | text match (spaces as printed); `ref-floatffd-hw-128k.jpg` is the author's photo of a real 128K, `ref-floatffd-128k.png` an emulator grab |
| `test-ir-contention.tap` | Woodmass's IR contention (2006): contention when I is in 0x40–0x7F (the refresh address in contended memory) | 48K | LOAD "" | L 1,087, then ~50 | four colour bars in the bottom border that mirror the four in the top border, and the text `The 4 bars in lower border are symmetrical to those in top border on 48K Spectrum.` | compare the **border** with `ref-ir-contention.gif`. That capture has snow turned off; on a real machine the paper also shows snow (`ref-ir-contention-hw-48k-cmos.png`, a recreated 48K with a CMOS Z84C00). So with snow emulated, the paper will not match the GIF, and should not |
| `test-nec-contention.tap` | Woodmass's 48K NEC contention suite (2008): R register, IR contention, LDIR/LDDR, CPIR/CPDR, INIR/INDR, OTIR/OTDR, each a yellow border bar against a row of digits | 48K | LOAD ""; press 0–5 at the menu | L 1,255, then ~200 a test | `ref-nec-contention-menu.gif`, `ref-nec-contention-0.gif` … `-5.gif`; test 0 prints `R Register` / `passed` | compare each with its GIF. It is named for the NEC D780C; whether its pictures are NEC's or Zilog's behaviour is not stated |
| `test-plus3-floatbus.tap` | Hikaru's +2A/+3 floating bus test v1.2 (2017): ports `0000 ---- ---- --0-` read the last byte on the bus with bit 0 forced to 1 | +2A/+3 | LOAD ""; any key at the instructions (6/7 move the sample, P cycles paging, M the memory test) | L 1,227, then ~300 | header `1FFD 04`; `14368: 83 03 85 05 05 05 05 05`, `14376: 87 07 89 09 09 09 09 09`, each row 4 higher, to `14488: BF 3F C1 41 41 41 41 41`; rows `14496`–`14536` all `41` (transcribed from the photo of a +2A, `ref-plus3-floatbus-hw-plus2a.png`) | text match |
| `test-plus3-paging.tap` | Woodmass's +2A/+3 paging tests (2021 binary): every 7FFD/1FFD combination, written in both orders; prints the banking found beside `expected:` | +2A/+3 (needs the +3 ROMs) | press 1 or 2; a key at each `scroll?` | L 1,316, then ~1,000 | `v4.0 ROMs detected` (the ROMs here), every pair equal, finally `Press any key to continue` | text: each row's two values equal. There is no pinned reference |
| `test-basic-border.z80` | Michael D. Wynne's BASIC border (2001): a BASIC loop that changes the border in step with the character rows: the interpreter's timing with contention, as a whole | 48K | load the snapshot | 200 | `ref-basic-border.gif` | compare the frame. Whether the stripes stand still from frame to frame is not known; there is no hardware capture |
| `test-frame-test.tzx` | Woodmass's Frame Test (2005): the frame's length in T-states | 48K, 128K | LOAD "" | L ~1,100, then ~100 | `69888 cycles/frame` (128K `70908`), then `9 STOP statement, 130:1` (`ref-frame-test-48k.gif`, `-128k.gif`) | text match |
| `test-ay-ym.tap` | Weiv's AY/YM test (2023), 4 lines of BASIC: write 123 to R0 and read it; select register 16, write 111, read R0 again; write 123 to R1 (4 bits wide) and read it | 128K family, Pentagon | LOAD "" | L 499, then 20 | for an AY-3-8912, `123`, `255`, `123`, `11`; a YM2149 gives `123` on the last line. **Not verified**: derived from MAME's register masks; the 255 assumes a deselected AY reads FF, which on a 128K may be the floating bus | text match, marked as unverified |

**fusetest on a 48K**, exactly, in the ROM font (lowercase hex):

```
Frame length 0x8000 + 0x9100
Machine type: 48K
Contention offset: 0x08

BIT n,(IX+d)... passed
DAA... passed
LDIR... passed
Contended IN... passed
Floating bus... passed
Contended memory... passed
High port contention 1... passed
High port contention 2... skipped (B=0x01)
0x3ffd read... skipped (B=0x01)
0x7ffd read... skipped (B=0x01)
```

On other machines:

- **128K**: `Frame length 0x8000 + 0x94fc`, `Machine type: 128K`, and every test `passed`, including the last three.
- **+3**: `Machine type: +3`; `Floating bus`, `0x3ffd read` and `0x7ffd read` are `skipped`.
- **Pentagon**: `Frame length 0x8000 + 0x9800`, `Machine type: Pentagon`, `Contention offset: no contention found`;
  `Floating bus` is `skipped`.

These are Fuse's own expectations. The source marks some 128K/+3 timings FIXME, and no hardware screenshot
survives. `0x08` is read from the source; a late-timing machine may show a value one off. The tests calibrate to
the offset, so they pass either way.

Sources (each test has a page on the wiki, named after it):

- https://sourceforge.net/p/fuse-emulator/code/HEAD/tree/trunk/fusetest/
- https://www.zxspectrum4.net/op_timing.php
- https://torinak.com/~jb/zx/ (Minfo; ULA test 3, whose 2011 source says `license GPL`)
- http://zxds.raxoft.cz/taps/misc/timingtest-0.3.zip
- https://web.archive.org/web/2006/http://www.ramsoft.bbk.org/tech/floatspy.zip
- https://zxe.io/depot/software/ZX%20Spectrum/ (azesmbog's, Woodmass's, Hikaru's, Wynne's and Weiv's files and
  their sources)
- the fixture lines in `fixtures.txt` give each file's exact URL.

Found but not pinned:

- **No reference output, or none to be had**: fusetest SVN r4115 (source only), Kendall's `contention.tap` and
  `iocontention`; Woodmass's Float48K/128K/+3, which stop at `scroll?` and have no published result; his Frame
  (INT length), which prints cryptic hex; INT Tester; Bobrowski's btime and stime, which are interactive.
- **Snow demos**: Hikaru's Snow is not synchronised to the interrupt, and the others have only video. Rak's test 1
  and the IR contention capture cover snow.
- **Pentagon**: no Pentagon-only test with a stable URL and a documented result. The Pentagon is covered by
  fusetest, Minfo and Frame Test.
- **Good next candidates**: Woodmass's and Weiv's other depot tests (IR Contention 128, OUTI Time, Out7FFC,
  LDIR-LDDR, OTIR-OTDR, Snow Hold, AY Undocumented, the screen-switching timing tests); most have expected GIFs.
  Woodmass's 2008 `z80tests.tap` is a CPU/MEMPTR test, left to the CPU's suites.

## 2. Demos that stress the timing

These only look right when contention, the ULA's fetch timing, the interrupt and the moment a border write lands
are all exact. None of the references below is a capture of real hardware. What hardware does comes from the
authors' own words, reviews, forum reports and MAME's bug tracker; each is cited. The ZXDB GIFs pinned for
Shock, Overscan, Eye Ache, Rage and Lyra II are dumps of screen memory: no cell in them has more than two colours,
and none shows the border, so they fix the layout only. The Nirvana+, Bifrost*2 and Old Tower PNGs are renders
of ZXDB's exact multicolour screens (`.ifl`/`.mlt`), so they are true multicolour pictures.

Several of these load more parts as they go. That needs automatic tape stop/start, or the ROM trap, or a key at
the right moment. Accelerated loading must not change the emulated timing: Shock's machine test is the check
for that.

| Fixture | What | Machine | How to run | Frames (from tape start) | Expected on hardware | Automate |
|---|---|---|---|---|---|---|
| `demo-shock.tzx` (loader, intro and part 2) and `demo-shock.tap` (all 8 parts, 644 s of tape) | Shock Megademo, ZXDB 0007726, ESI (Poland) 1992, code Kaz, music Ziutek | 48K or 128K/+2 (AY music) | LOAD "" / Tape Loader; SPACE leaves each part | loader ends ~1,190, then a speed test runs; intro loaded by ~4,047; press SPACE between ~4,050 and ~4,330 (TAP: 4,075–4,350, the next header's pilot); part 2 on screen from ~9,745 (TAP ~9,770); capture 9,800–9,900 | Part 2 (Your Sinclair 82: "full-screen single line rasters"): bars one scanline tall over the whole border and paper, behind the Shock logo, with a text scroller in a box at the bottom. Every border row is one colour, and the left and right border match on every row. The speed test counts a 23-T loop between two interrupts; a count whose low byte is 222 (3,038, a 48K) stores 48 at 25277 (0x62BD), anything else 128; a wrong pick makes the bars 8-pixel staircases | if memory can be read: byte 25277 = 0x30 on a 48K, 0x80 on a 128K, from frame 1,200. At 9,850: rows 0–47 and 240–295 each one colour across all 352 px; rows 48–239 with x 0–47 one colour and equal to x 304–351; rows 0–47 together at least 20 row-to-row changes and 4 colours |
| `demo-overscan.tzx` | Overscan Demo, ZXDB 0007636, Busy Software (Slavomír Lábsky) 1991, "third multicolor demo" | 48K (a separate Pentagon fix exists, so the original is not right on a Pentagon) | LOAD ""; SPACE on the text screens until the bars appear (order not confirmed) | L ~3,225 | the whole picture is horizontal colour bars one scanline tall: every row one colour edge to edge, so the paper's edge cannot be seen; every paper cell has more than 2 colours (as in the zxaaa capture of the Pentagon fix) | after SPACE: of rows 40–255, at least 95% one colour; at least 700 of the 768 cells with more than 2 colours; at least 6 colours down column 0 |
| `demo-aquaplane.tzx` (= `game-aquaplane.tzx`, the same file) | Aquaplane, ZXDB 0000227, John Hollis / Quicksilva 1983: "uses a border effect to extend the game screen" | 48K | LOAD ""; runs itself; menu `PRESS S TO START` (S start, H hold, 7 up, 6 down, 0 thrust) | L ~4,549 | border cyan above the horizon and blue below, changing on the scanline of the paper's horizon (paper line 48, frame row 96). The IM 2 handler sets cyan, scrolls with constant-time code, pads with NOPs and sets blue, so where the change lands depends on contention. Without contention it comes too early (MAME bug 8265) | at ~4,700 (or after S), in x 0–47 and 304–351: rows 0–94 colour 5, rows 97–295 colour 1, the change at row 95 or 96. `ref-demo-aquaplane.png` (320 × 240, with border) shows it |
| `demo-eyeache.tap` | Eye Ache, ZXDB 0007399, Code Busters, 3rd at Enlight'96 | **Pentagon only** ("its nice, but pentagon only", Pouët) | Tape Loader; one 35.9 KB block; runs itself, with AY music | L ~10,442 Pentagon frames | "multicolor madness": large waving areas of colour (cells 2–23) with a vertical EYE ACHE logo at the right; on a 128K it should tear (a prediction) | weak: from 10,600, many cells in x 16–191 with more than 2 colours; then a golden image checked by eye against https://www.youtube.com/watch?v=YmzTT58c6cw |
| `demo-rage.tap` | Rage, ZXDB 0007681, X-Trade, Enlight'97 | Pentagon 128 | Tape Loader; at the BASIC menu press R (T shows the notes, and the demo cannot be run after them) | L ~11,168 Pentagon frames | multicolour rotating pigs and hens, a border scroller, a "stunning rounded border", a full-screen border effect at the end; called "an etalon for fixing border emulation in Pentagon emulators"; its RAGE.TXT says the last effect fails on X128 and "Spectrum Emulator v3.00" | a PNG every 250 frames after R: during the border parts, at least 8 colour changes along each of rows 0–47; then golden images checked against https://www.youtube.com/watch?v=dl3wWxJmIZw. When each part starts is not known |
| `demo-mescaline-128.tap` (header MS_ZX128), `demo-mescaline-plus2a.tap` (MS_ZX2A) | Mescaline Synesthesia, ZXDB 0042388, deMarche, 1st at The Ultimate Meeting 2009 | each on its own model: 128/+2, or +2A/+3. The 128 build pages bank 6, the +2A build bank 3. Each bank is uncontended on its own model and contended on the other, so each build only times correctly on its own | Tape Loader; it calls LD-BYTES between scenes, so the tape must stop and start by itself (843 s of tape) | music loaded ~7,827, MESCAL00 ~13,032 | 64 × 30 "chunks" of 4 × 4 pixels with a gigascreen palette (two frames alternating, done in software), and border effects; the chunky area is paper lines 32–151, full width | each frame alone: in paper lines 32–151 every group of 4 lines identical and every 8-px cell two constant 4-px halves (a late attribute write breaks it); frames N and N+1 differ. `ref-demo-mescaline.png` is flicker-blended: compare structure, not colour |
| `demo-nirvana-plus.tap` | NIRVANA+ ENGINE demo, ZXDB 0030002, Einar Saukas 2015 | 48K, 128K, +2, +2A/+3; not Pentagon. The engine picks its delay from ROM byte 0x004C AND 2: 48.rom gives 0x02 (48K), 128-1 and plus3-3 0x38 (128K); 128-0 gives 0x7F, the wrong one, if it is paged in when the engine starts | LOAD ""; runs itself | L ~4,838 | 8 × 2 multicolour over all 32 columns, rows 1–23 (row 0 the title), no flicker or tearing (the reference has 486 multicolour cells) | the static brick tiles match `ref-demo-nirvana-plus.png` outside the sprites; colour changes inside a cell only at even pixel lines |
| `demo-bifrost2.tap` | BIFROST*2 ENGINE demo, ZXDB 0030003, Saukas 2016 | 48K, 128K/+2, +2A/+3; the installer reads ROM byte 0x0B53 (48.rom 0xA5, 128-1 0x9F, plus3-3 0x7E) and installs the matching variant | LOAD "" (it reads LASTK, so a key probably moves between stages: not verified) | L ~6,542 | 8 × 1 multicolour 16 × 16 tiles in columns 1–20, rows 1–22, animated in fours every 0.44 s; text at the right (`BIFROST*2 ENGINE BY EINAR`, `PAINTING TILES`) | columns 21–31 match `ref-demo-bifrost2.png` exactly; at least 80 cells in columns 1–20 with more than 2 colours (the reference has 100) |
| `demo-oldtower-48k.tap`, `-128k.tap`, `-pentagon.tap` | Old Tower, ZXDB 0034458, RetroSouls (Denis Grachev) 2018, "world's first multicolor scroller"; three builds | each on its own: 48K; 128K/+2/+3; Pentagon | LOAD "" / Tape Loader; `PUSH FIRE TO START` (SPACE or M) | L ~13,812 (48K), ~28,864 (128K), ~28,813 (Pentagon) | a 12-column playfield (columns 10–21, rows 2–19) in 8 × 1 multicolour, scrolling vertically, no tearing | each on its own model: at least 80 multicolour cells in columns 10–21, the layout of `ref-demo-oldtower.png`; on the wrong model it should tear (a prediction) |
| `demo-lyra2.tzx` | The Lyra II Megademo, ZXDB 0007538, ESI 1991 | 48K with AY, or 128K in USR 0 mode ("supposedly" freezes on +2A/+3 at the bottle part) | its own loader, with prompts (`START TAPE`, `CHANGE SIDE`); 9 parts, 1,222 s of tape | part 1 loaded ~7,445 | the intro scroller | smoke test only: part 1 runs and nothing crashes |

Sources:

- Shock:
  - https://spectrumcomputing.co.uk/zxsr.php?id=7726 (the Your Sinclair review)
  - https://misterfpga.org/viewtopic.php?p=37730. Fuse is right; fast tape loading makes it take a 48K for a
    128K.
  - https://github.com/mamedev/mame/pull/9670. A MAME 128K capture, `ref-demo-shock-128-mame.jpg`.
  - The speed test was read from the disassembly. The rest follows from it: a 128K counts 3,082 and a Pentagon
    3,116, and the test catches frame-length and interrupt-entry errors of more than about 5 T.
- Overscan: https://zxaaa.net/view_demo.php?id=9558
- Aquaplane:
  - https://worldofspectrum.net/interviews/HollisJohn.htm
  - https://mametesters.org/view.php?id=8265
  - https://www.skoolkit.ca/posts/2026/08/blurring-the-border-lines/
- Eye Ache: https://www.pouet.net/prod.php?which=2143
- Rage: https://www.pouet.net/prod.php?which=1929
- Mescaline: https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0042388/MescalineSynesthesia(EN).txt and
  https://www.pouet.net/prod.php?which=54207
- Nirvana+: https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0030002/NIRVANA+ENGINE.txt
- Lyra II: https://www.pouet.net/prod.php?which=2121

Not pinned:

- **Eye Ache 2**: SCL disk image only.
- **Power Up** (ZXDB 0007671): needs 71,680 T per frame and crashes on a real 128K/+2. A good Pentagon
  frame-length candidate.
- **DreamWalker** (ZXDB 0030084): overlaps Old Tower.
- **The Sentinel**: listed as having border effects, but what the effect is was not found.
- **zxsp's "games with hires timing"** (1942, Academy, BIFF, Black Lamp, Thing, Zythum): not researched.
- **Not in ZXDB**: "Insert No Disk", "Border Breaker", "Rasmus".

## 3. Games

Every game here is listed in ZXDB as **Available**; this was checked through the ZXInfo API
(`https://api.zxinfo.dk/v3/games/<id>?mode=compact`, `availability`). Where the archive has an original release,
that is the TZX pinned.

How the facts were found:

- **Loader types** come from three sources, which agree: ZXDB's `encodingScheme`, the TZX's blocks, and SkoolKit
  10.1's simulated load, which names the loader routine it finds.
- **Load times** (L, and S for when the loading screen is complete) are summed from each TZX's pulses and pauses,
  from the moment the tape starts.
- **What the screen shows after loading** comes from SkoolKit's Z80 simulator, driven with scripted keys. That is
  not a real machine: it has no contention, and its floating bus and Issue 2/3 behaviour are approximations. So
  the menus and title screens below are the game's own code run faithfully, not checked against hardware.
- **Loading screens** are compared with `ref-game-<slug>-load.scr`, ZXDB's exact dump of the screen. "load screen
  ≥ N" means that at least N of the 768 character cells (pixels and attribute) match it exactly, in the window
  given. The N given is what the simulator reached.

Only Saboteur, Saboteur II, Manic Miner's scroller and cavern names, Aquaplane's loading text and Rick
Dangerous's counter use the ROM font. Every other menu is in a game's own font, and is checked by picture.

### 3.1 Saboteur (ZXDB 0004293, "Saboteur!", Durell 1985, Clive Townsend; 48K)

The owner's first goal.

- **Fixtures**:
  - `saboteur.tzx` (the original release, `Saboteur.tzx.zip` › `Saboteur - Side 1.tzx`) is the one to test with.
  - `saboteur.tap` is a different, cracked edition (see below).
  - References: `ref-game-saboteur-load.scr` (`/pub/sinclair/screens/load/s/scr/Saboteur.scr`) and
    `ref-game-saboteur.gif` (`/pub/sinclair/screens/in-game/s/Saboteur.gif`, a mid-game guard room).
  - Instructions: https://spectrumcomputing.co.uk/pub/sinclair/games-info/s/Saboteur.txt
- **Machine**: 48K. A simulated load through the 128K's Tape Loader reached the game, and ZXDB lists no known
  errors, but real 128K hardware is unverified.

**The tape** (MakeTZX), block by block, with when each ends from the tape's start:

| # | Block | What | Ends |
|---|---|---|---|
| 1 | 0x10 header | Program `SABOTEUR` (the name carries INK 2: red), LINE 1, 313 bytes | 5.09 s |
| 2 | 0x10 data | the BASIC loader (315 bytes) | 9.72 s |
| 3 | 0x10 header | Bytes, 10 spaces, CODE 64036,1330 | 15.68 s |
| 4 | 0x10 data | the loader code (1,332) | 26.42 s |
| 5 | **0x11 turbo** header | 6,912 bytes | 30.12 s |
| 6 | 0x11 turbo data | the loading screen (6,914) | **50.52 s (S = 2,530 frames)** |
| 7 | 0x11 turbo header | name CHR$ 22 + CHR$ 0 + CHR$ 0 …, 38,500 bytes at 25200 | 54.30 s |
| 8 | 0x11 turbo data | the game (38,502) | 161.22 s |
| 9 | 0x10 header | Bytes, 1,836 at 63700 | 166.87 s |
| 10 | 0x10 data | 1,838 bytes, then a 58.5 s trailing pause | **180.49 s (L = 9,039 frames)** |

The turbo blocks are exactly twice ROM speed: pilot 2,165 T × 4,921, sync 714/714, a 0 bit 424 T, a 1 bit 849 T
(about 2,750 bits/s against the ROM's 1,365).

**The BASIC loader**, exactly:

```
1 BORDER 1: PAPER 1: INK 1: CLEAR VAL "25200": POKE VAL "23659",0
2 LOAD ""CODE : LET L=USR VAL "64036": LOAD ""CODE VAL "16384"
3 LET L=USR VAL "64036": LOAD CHR$ 22+CHR$ 0+CHR$ 0CODE
4 LOAD ""CODE : POKE 23659,2: LET l=USR VAL "63972"
5 SAVE "{INK 2}SABOTEUR"{INK 0} LINE 1: CLS : PRINT "STOP TAPE"
6 LOAD *"M";1;"PART2f"
65535 REM IF YOU PIRATE THIS THE MARTIAL ARTISTS WILL GET YOU!!
```

**The loader** ("unspecified custom loader" in ZXDB) is the ROM's own, moved:

- `USR 64036` steps BASIC past the next statement (it adds one to SUBPPC, 23623) and runs that LOAD itself, through
  a RAM copy of the ROM's SAVE-ETC, LD-BYTES and SA-BYTES at 64036–65365 (uncontended).
- The copy is byte for byte the ROM's, except:
  - the timing constants: an edge-wait delay of 12 for the ROM's 22, and the thresholds `8E C3 BE E2 EB E0` for
    `9C C6 C9 B2 CB B0`;
  - the border: `AND 2 : OR 8` where the ROM has `AND 7`. So **the turbo blocks draw black/red stripes for both
    pilot and data**; the standard blocks draw the ROM's red/cyan and blue/yellow.
- There is no counter.

**What the screen shows**:

1. Until the BASIC runs: the ROM's colours, and `Program: SABOTEUR` at the top.
2. Then a blue screen. The header messages print blue on blue, and cannot be seen.
3. The loading screen draws at turbo speed from 30.6 s to 50.5 s. It is byte for byte `ref-game-saboteur-load.scr`.
   Afterwards the hidden `Bytes:` messages change a few cells, all in rows 0, 2 and 5, columns 0–6 (attribute
   0x08 → 0x09; the simulator found 12 cells).
4. Within 2 frames of the end of loading, the **£100 REWARD** screen, in the ROM font. It waits for a key
   indefinitely. `USR 63972` calls 26000, which draws it. Rows 0–21 below are generated from the game's code,
   which holds them as 704 bytes of 32-column rows, and agree with the simulated screen read in the ROM font;
   rows 22–23 come from that screen. Each row is 32 characters, and £ is the ROM's character 0x60:

```
          £100  REWARD          
 If your copy  of this game does
not  have  a blue  cassette body
with DURELL  embossed on it, and
does not have DURELL on the lead
in strip then it is a forgery.  
 Please send any forgeries to   
       DURELL SOFTWARE Ltd.     
        Castle Lodge            
         Castle Green           
          TAUNTON               
          TA1 4AB               
          Somerset              
          ENGLAND               
     with your name and address,
and the name and address  of the
person  who  supplied  you  with
the forgery.                    
      You will be sent a genuine
replacement copy and a reward of
£100  if your information  leads
    to a successful prosecution.
                                
   PRESS ANY KEY TO CONTINUE    
```

5. After any key: a high-score table in the game's font beside ninja silhouettes (`$02000 THE CAT`, `$01800
   JOOLZ`, `$01600 MICKY`, `$01400 DAVE`, `$01200 GEOFF P`, `$01000 SHARFACE`, `$00800 HOLLY`, `$00600 BRAD`,
   `$00400 TOZZY`, `$00200 MAT LE FAT`). It alternates about every 1,900 frames with the menu: `J KEMPSTON`,
   `K KEYBOARD`, `P PROTEK`, `R REDEFINE KEYS`, `S START MISSION`. Any key on the table brings up the menu.

**To play**:

- Press any key, then K (keyboard), then S. At `ENTER SKILL LEVEL 1 TO 9` press 1. `YOUR MISSION WILL BE
  EXTREMELY EASY` shows for about 250 frames, then the game begins: the ninja in the dinghy at the pier.
- The panel shows `SHURIKEN`/`HELD`, `PAY : $ 00000`, a TIME box, and `NOTHING`/`NEAR`.
- Keys (from the inlay): A up/climb/kick, Z down/duck, N left, M right, SPACE throw/use/take/punch. Up with left
  or right jumps sideways; up also starts the helicopter at the end. Kempston and Protek joysticks work, and the
  keys can be redefined.
- The instructions list codes for skill levels 2–9 (JONIN, KIME, KUJI KIRI, SAIMENJITSU, GENIN, M1 LU KATA,
  DIM MAK, SATORI). How they are entered is unverified.

**The TAP** is a cracked edition:

- It has a plain ROM loader (BASIC `Sabot1.1`: `CLEAR 25200`, `LOAD ""SCREEN$`, `LOAD ""CODE` twice,
  `RANDOMIZE USR 63975`), and plays in 289.1 s (14,476 frames).
- Its game blocks are byte-identical to the TZX's.
- It enters at 63975, **skipping the £100 REWARD screen**, and goes straight to the high scores and menu.

**Checks** (48K, frames from the tape's start; add the boot and `LOAD ""` for frames from power-on):

1. The border, read from the loader's code (the simulator draws no border): during the first header's pilot
   (frames 10–240) only red and cyan (2, 5), the ROM's; during the game block's turbo data (frames 3,000–8,000)
   only black and red (0, 2). Between blocks it may briefly show the loader's restored blue (1) and the white
   (7) that LD-BYTES sets on entry, so leave the frames where a block starts or ends unchecked.
2. From 2,600 to 9,000, the paper matches `ref-game-saboteur-load.scr` in every cell outside rows 0, 2 and 5,
   columns 0–6 (at least 747 of 768).
3. From 9,100 until a key is pressed, `--text` equals the 24 rows above, exactly.
4. Press SPACE; then K, S and 1 a second apart; then run 300 frames. Rows 18–23 (the panel) match
   `ref-game-saboteur.gif` in at least 85% of cells. The simulator got 171 of 192; the held item, the time and
   the energy differ.
5. With the TAP: the high-score table or the menu appears by 14,600, and the REWARD text never does.

### 3.2 The other games

| Fixture | Game (ZXDB id) | Machine | Loader | L (s / frames) | To start | What it shows | Why it is here; check |
|---|---|---|---|---|---|---|---|
| `game-manic-miner.tzx` | Manic Miner (0003012), Bug-Byte 1983 | 48K | ROM: BASIC `CLEAR 30000 … LOAD ""CODE` ×2, `RANDOMIZE USR 33792`; "mmm" (256 bytes of attributes at 22784, done at 999 frames), "mm1" (32,768) | 191.6 / 9,597 | ENTER. Q,E,T,U,O left; W,R,Y,I,P right; bottom row jumps; Kempston | title `PRESS ENTER TO START` in its own font, the Blue Danube on the beeper (~1,200 frames), then a ROM-font scroller on row 19 (`© BUG-BYTE ltd. 1983 . . By Matthew Smith . . . Q to P = Left & Right . . Bottom row = Jump …`), then a demo through the caverns: row 16 the cavern's name (`Central Cavern`), row 17 `AIR`, row 19 `High Score 000000   Score 000000` | the archetypal ROM loader; beeper music timed in code. Load screen ≥ 755 from 1,100; about L + 2,300, `--text` has `High Score 000000   Score 000000` and `AIR`; in play rows 17–23 match `ref-game-manic-miner.gif` (Eugene's Lair) ~94% |
| `game-aquaplane.tzx` (= `demo-aquaplane.tzx`) | Aquaplane (0000227), Quicksilva 1983 | 48K | ROM | 90.8 / 4,550 | S start, H hold, 7 up, 6 down, 0 thrust, J Kempston | while loading, in the ROM font: row 4 `       A Q U A P L A N E`, row 6 `        © 1983 J.Hollis`, row 10 `    Loading.....please wait` (this is the load screen), then `Bytes: aquachar`, `Bytes: aquacode`; then a page of keys in its own font, alternating with `TODAYS GREATEST` | border effect timed from the interrupt (§2). `--text` from 600 to 4,500 has the three lines; after S the border check of §2 |
| `game-daley-thompsons-decathlon.tzx` | Daley Thompson's Decathlon (0001217), Ocean 1984 | 48K | **Speedlock 1**: a "clicky" pilot (2,165 T × ~250 pulses broken by 714/714 pairs), data 564/1,129 T (1.5 × ROM) | 210.0 / 10,518 | not verified (1, SPACE and ENTER did not start an event in the simulator) | menu `1 KEYBOARD 2 KEMPSTON INTERFACE 3 PROTEK INTERFACE 4 SINCLAIR INTERFACE 5 DEMO … WRITTEN BY P OWENS AND C URQUHART` | covers Speedlock 1. Load screen 768 at 10,400. Day 2 is the zip's other member |
| `game-arkanoid.tzx` | Arkanoid (0000255), Imagine 1987 | 48K | **Speedlock 2** | screen at 70.6 s; stop-the-tape at 217.7 / 10,901 | fire (and start) any of A–L; left CAPS SHIFT–V, right B–SPACE | a high-score table (MIKE 50000 … COLIN 25000); A gives `BUT ONLY TO BE TRAPPED IN SPACE…`, then round 1 | **the floating bus**: in play the code polls `IN (0xFF)` at 0x8493 and 0x84AE, and hangs at 0x848F–0x8496 where port FF reads FF (as on a +2A/+3). Load screen 768 at 10,800; press A at L + 100 and L + 400; columns 23–31 match the GIF but for the digits; the picture keeps changing for 300 frames on a 48K, and freezes on a +2A/+3 |
| `game-mag-max.tzx` | Mag Max (0002976), Imagine 1987 | 48K | **Speedlock 3** (a 6,889-byte loader "olyn", a ~14 s decryption tone) | 261.8 / 13,108 (S 125.0 s) | SPACE | `MAG MAX - ROBO-CENTURION / PRESS FIRE TO START` | covers Speedlock 3. Load screen ≥ 760; the SCORE/LIVES/HIGH panel matches the GIF |
| `game-renegade-48.tzx`, `game-renegade-128.tzx` | Renegade (0004082), Imagine 1987 | 48K / 128K | **Speedlock 4**: a 23 s pause, a long pilot, a countdown in the top-left 6 cells (ending `0m 00s 0`) | S 111.7 s; 48K: stop-the-tape at 265.2 s, then the game loads one more 1,412-byte standard block (274.5 / 13,747); 128K: 315.7 / 15,792 | not verified | menu `1 KEYBOARD 2 SINCLAIR 1 3 SINCLAIR 2 4 KEMPSTON 5 DEFINE KEYS` | **the tape must start again after a stop**: if it never restarts, the 48K hangs in the ROM's edge loop. Load screen ≥ 762 (the countdown differs); the countdown changes while loading |
| `game-match-day-2.tzx` | Match Day II (0003070), Ocean 1987 | 48K/128K | **Speedlock 5** (23.6 s decryption tone) | 250.2 / 12,532 (S 119.2 s) | ENTER three times | `SELECT JOYSTICK: KEYS/KEY JOYSTICK, KEMPSTON, FULLER / PRESS ENTER TO SELECT OPTION`; then the pitch, `RITMAN UTD 0 0 SOCCERAMA` (the GIF's bottom row) | load screen ≥ 762; the score row. 128K unverified (the simulator reset) |
| `game-platoon.tzx` | Platoon (0003759), Ocean 1988 | 48K/128K | **Speedlock 6** (data 714/1,428 T); 3 level blocks follow at 583/1,166 T, to 554.6 s | main load 185.6 / 9,296 (S 127.4 s) | not verified | `PRESS FIRE TO PLAY / R TO REDEFINE KEYS / C TO SELECT CONTROL (KEMPSTON) / HISCORE 00068000` | load screen 762 from 6,500 to 9,200 |
| `game-where-time-stood-still.tzx` | Where Time Stood Still (0005671), Ocean 1988 | **128K only** | **Speedlock 7** | 636.3 / 31,829 on the 128K (S 74.0 s) | 1 then 0 gives `CONFIRM. Y OR N` | `CONTROL SELECTION 0 SELECT 1 KEYBOARD 2 KEMPSTON 3 SINCLAIR 4 CURSOR`, with AY music (3,036 register writes in 300 frames) | load screen 768 at 31,700, then the menu; reference `ref-game-where-time-stood-still.png` (from zxinfo.dk) |
| `game-robocop.tzx` | RoboCop (0004179), Ocean 1988 | 48K/128K | **Speedlock 7**, and a **"stop the tape if 48K"** block | S 94.3 s; 48K stops at 163.2 / 8,173 (levels load later); 128K plays on through every level: 510.1 / 25,515 | — | 128K: a high-score table (MURPHY 50000 …), then `1 KEYBOARD 2 SINCLAIR 3 KEMPSTON 4 DEFINE KEYS`, heavy AY (17,308 writes in 300 frames); 48K: `ROBOCOP TM & © 1987 ORION PICTURES` | "stop if 48K" obeyed on a 48K and ignored on a 128K |
| `game-chase-hq.tzx` | Chase H.Q. (0000903), Ocean 1989 | 48K/128K | **Paul Owens protection** (0x11 blocks, 735/1,590 T) | S 76.6 s; 48K main load 266.6 / 13,351, then levels, with `STOP THE TAPE / PRESS ANY KEY TO CONTINUE`; 128K 739.0 / 36,965 (12.3 minutes) | 128K: ENTER for options | `PRESS ENTER FOR OPTIONS`; `1. SINCLAIR JOYSTICK 2. CURSOR JOYSTICK 3. KEMPSTON JOYSTICK 4. KEYBOARD 5. DEFINE KEYS`; AY music | load screen 768 |
| `game-cobra.tzx` | Cobra (0000996), Ocean 1986 | 48K | **Alkatraz** (two turbo blocks: pilot 2,165 × 6,182, then 167 s at 564/1,129) | 220.8 / 11,056 | a key past the credits (Martin Galway, Jonathan Smith); menu 1 KEYBOARD … 7 DEFINE KEYS; 1 gives `ROUND 01` | the loading screen ("Crime is a disease. He's the cure."), credits, menu, game | **the floating bus**: ZXDB's known errors quote the loop at 0x95FE (`IN A,($FF)` until below 0x3F); it freezes on a +2A/+3, and the Hit Squad re-release replaced it with a delay. SPACE then 1: rows 19–23 match the GIF ~95% (the SKORE digits differ); the picture keeps changing on a 48K, freezes on a +2A/+3 |
| `game-rick-dangerous.tzx` | Rick Dangerous (0004135), Firebird 1989 | 48K/128K | **Bleepload**: ~194 short turbo blocks at ROM speed, each with its own short "bleep" pilot; a `Loading NN` counter in the ROM font, rows 19–20, columns 14–25 (23 at block 100, 55 at 150, 87 at 200) | 379.7 / 19,015 (S ~117 s) | fire (unverified) | `1. KEYBOARD … PRESS FIRE TO START / C 1989 CORE DESIGN / C 1989 FIREBIRD`; AY on 128K | row 19 of `--text` has `Loading` and a rising number; load screen ≥ 744 |
| `game-dynamite-dan.tzx` | Dynamite Dan (0001551), Mirrorsoft 1985 | 48K | **Power-Load** (a turbo header, then pure data at 426/853 T, 2 × ROM) | 163.0 / 8,165 (S 40.5 s) | ENTER | a menu ending `ENTER/FIRE TO PLAY` | load screen 768; in play the bottom panel matches the GIF |
| `game-rasputin.tzx` | Rasputin, 48K tape (0004030), Firebird 1986 | 48K **Issue 2** | **SoftLock** (a turbo block at 673/1,346 with the screen, S ≤ 48.1 s, then 35 pure-data chunks) | 245.0 / 12,272 | 1 then 0 | `SELECT OPTION 0 = PLAY 1 = KEYBOARD 2 = INTERFACE II 3 = KEMPSTON 4 = CURSOR KEYS` | **needs an Issue 2 keyboard** (below). Load screen 768 at 12,000; on Issue 2 the menu starts the game, on Issue 3 it never responds |
| `game-abu-simbel-profanation.tzx` | Abu Simbel Profanation (0000048), Dinamic 1985 | 48K **Issue 2** | Dinamic's turbo (~610/1,220 T) | 210.4 / 10,539 (S 54.0 s) | after the credits, a key on the H–ENTER half-row (it reads port 49150 and loops while it reads 191); then 3. In play O left, P right, Q long jump, A short jump | ~1,200 frames of Spanish credits, then `2-KEMPSTON 3-TECLADO 4-INSTRUCCIONES` | **needs Issue 2**, not Issue 3 (below): on Issue 2, 3 starts the game; on Issue 3 the menu never responds. Load screen 768 |
| `game-exolon.tzx` | Exolon (0001686), Hewson 1987 | 48K/128K | **Hewson Slowload**: a 768-byte loader at 64512, then standard-speed blocks with a non-ROM header type 42 | 265.4 / 13,291 | 1; M fires | `1 START GAME 2 DEFINE KEYS 3 KEYBOARD 4 INTERFACE 2 5 KEMPSTON`; AY music on 128K | a non-standard header; reference `ref-game-exolon.png`. The instructions tell 128K owners to use 48K mode, yet the 128K load ran in the simulator |
| `game-saboteur-2-48.tzx`, `game-saboteur-2-128.tzx` | Saboteur II (0004295), Durell 1987 | 48K / 128K | ROM | S 54.4 s; 282.8 / 14,164 (48K), 305.2 / 15,269 (128K) | a key, then S | the same ROM-font REWARD screen, but row 0 is `          £100 REWARD           ` (one space); then `MISSION BRIEFING … PRESS ANY KEY TO CONTINUE`; AY on 128K | `--text` of the REWARD screen; load screen 768 |
| `game-fantasy-world-dizzy.tzx` | Fantasy World Dizzy (0009335), Codemasters 1989 | 48K/128K | ROM, with a "stop the tape if 48K" block | S 55.9 s; 48K 286.9 / 14,369; 128K 384.5 / 19,235 | SPACE starts and jumps (did not start in the simulator); ENTER picks up and uses | `DIZZY III / SPC OR FIRE TO START`, heavy AY | **128K contention by bank**: its sampled speech "sounds wrong on a 128 or grey +2, and correct on a +2A or +3", because different banks are contended on each (spectrumforeveryone.com; ZXDB lists a fixed re-release: "Speech FX no longer distorted on the 128K/+2"). The pinned file is the original |
| `game-black-raven.tzx` | Black Raven (Чёрный Ворон) (0012757), Copper Feet 1997 | 128K | ROM | 642.4 / 32,135 | — | `Черный Ворон Demo v0.04` with a Cyrillic help panel, then the strategy map | a Russian-made game, but this is the **demo from the ZX Files Megatape 2**; the full game is a TR-DOS disk. It does not match `ref-game-black-raven-load.scr` (0/768): use it only as a smoke test |
| `game-short-circuit.tzx` | Short Circuit, 48K (0004469), Ocean 1987 | 48K | **Speedlock 2**; part 2 follows after a stop | part 1 220.4 / 11,039 (S 77.5 s) | 1 then 0 | menu `0 START GAME 1 KEYBOARD … 5 REDEFINE KEYS`; `WELCOME TO SHORT CIRCUIT`, then the lab | **the floating bus**: it polls port FF at 0x883D, and without a floating bus hangs after `WELCOME TO SHORT CIRCUIT`. At L + 900, rows 0–15 are not all black on a 48K |

Every file is on spectrumcomputing.co.uk (the URL and member are in `fixtures.txt`). Each `ref-game-<slug>.gif`
is ZXDB's in-game screenshot (256 × 192, paper only), and each `ref-game-<slug>-load.scr` is ZXDB's loading
screen. The "Russian favourites" (Exolon, Saboteur II, Fantasy World Dizzy, and the Russian-made Black Raven) were
picked as games widely played on Soviet clones; how popular each was there is not sourced here.

### 3.3 What the games show about the machine

- **Issue 2 and 3.** **Abu Simbel Profanation and Rasputin need Issue 2.** The brief for this corpus said Abu
  Simbel needs Issue 3; the sources and the simulation both say Issue 2.
  - Both menus read the keyboard port and compare the whole byte with 253/251. That only works if bit 6 is high
    after the ROM's beeper, which only Issue 2 gives.
  - In the simulator, with Issue 2's rule (bit 6 = the last OUT's bit 3 OR bit 4) the menus start the game; with
    Issue 3's (bit 6 = bit 4) they never do.
  - This agrees with https://zx48.8bitchip.info/cassport.htm: only zx32's exact Issue 2 emulation started both
    games, and "the 48K version of Rasputin requires an issue 2 keyboard". MAME bug 06439 agrees too: there,
    Abu Simbel broke because the Issue 2/3 setting was inverted.
  - No game was found that needs Issue 3.
  - Not modelled: Issue 3's slow decay of bit 6 after an OUT (180–2,800 T).
  - The emulator's Issue 2 option is what these two games test.
- **The floating bus**: Arkanoid, Cobra and Short Circuit, original releases. Each hangs where port FF reads FF.
  Sidewize is "Distribution denied".
- **Tape control**: Renegade 48K must restart after a stop. RoboCop and Fantasy World Dizzy test "stop if 48K",
  obeyed on a 48K and ignored on a 128K. Chase H.Q. and Platoon are multiloads.
- **Excluded**, because ZXDB says "Distribution denied": Jetpac, Knight Lore, Chuckie Egg, Sidewize, Ghosts 'n
  Goblins, R-Type, Spindizzy, Lunar Jetman. So the standard ROM loader is covered by Manic Miner, Aquaplane,
  Saboteur II and Dizzy instead.
- **Not found**: a game with the Search Loader; ZXInfo cannot search by loader. Elite (SoftLock, and a Lenslok
  check) was left out; Rasputin covers SoftLock.

## 4. The palette and the visible area

### 4.1 What the hardware puts out

**No per-colour measurement of any Sinclair or Amstrad model has been published**: no oscilloscope, colorimeter or
capture figures for the fifteen colours. What exists is the circuits, and levels calculated from them:

| Model | Video path | Normal : bright | Kind | Source |
|---|---|---|---|---|
| 16K/48K (ULA 5C/6C) | the ULA puts out Y (with sync) and U, V to an LM1889 PAL modulator. Issue 2 shifts U/V with trimmers; Issue 3 shifts them actively ("greatly improving colour stability") | no published Y/U/V levels; BRIGHT raises only Y | circuit | 48K service manual [1]; [2] |
| 128K/+2 RGB socket | TTL R, G, B and a separate BRIGHT, through 68 Ω; the lead or monitor sets the levels | Farrow's SCART lead: 0.475 V vs 0.7 V = **0.68** (normal chosen to match the RF picture's contrast) | calculated | [3] |
| 128K/+2 composite | the TEA2000 encoder: 2 bits a primary, 4 "equally spaced" gamma-corrected levels; normal drives one input, bright both | normal is probably level 2 of 3 (which input is the high bit is not stated) | inference | [4], [5] |
| +2A/+3 | the gate array mixes BRIGHT in through 150 Ω and diodes; 1.67 V into 75 Ω | through Farrow's 330 Ω: 0.44 V vs 0.67 V = **0.66** | calculated | [3] |
| Harlequin (Chris Smith's clone) | its RGB drivers' targets: 0.55 V, bright 0.65 V | **0.846**: where 0xD7/0xD8 comes from (255 × 0.55/0.65) | a design target, not the ULA | [6] |
| ZX Spectrum Next | 3 bits a channel; normal 101, bright 111; HDMI repeats the bits (101 → 0xB6) | **0.714** | design | [7] |

**Bright black is black.** On the +2A/+3 and in Farrow's 128K lead, BRIGHT goes through diodes, so it only lifts a
channel that is already on. Read as voltage ratios, which are already gamma-encoded like sRGB, code ≈ 255 × V /
V_bright.

### 4.2 What emulators use

| Emulator | Normal | Bright | Rationale | Source |
|---|---|---|---|---|
| Fuse 1.10.0 (every UI and the screenshot code) | 0xC0 | 0xFF | none given | [8] |
| MAME | 0xBF | 0xFF | none | [9] |
| ZEsarUX, default | 0xC0 | 0xFF | none | [10] |
| ZEsarUX, "real 16/48/+" | per colour (below) | | "calculations by Richard Atkinson" (not traced) | [10] |
| Next (default palette) | 0xB6 | 0xFF (bright magenta FF24FF, avoiding the transparent colour) | its DAC | [7] |
| Unreal Speccy presets | 0xA0 (shipped default), 0xC0, 0xCD ("pulsar"), 0xAA ("ATM") | 0xFF | none | [11] |
| ZX-Art | 0xCD ("pulsar") | 0xFF | none | [12] |
| CLK | 0xAA | 0xFF | none | [13] |
| Wikipedia | 0xEE | 0xFF | 85% through a PAL→sRGB conversion, "probably not the real colours" | [2] |
| Spectaculator, SpecEmu, Retro Virtual Machine | not published | | | |

### 4.3 The palette to use

The recommended default is Fuse's, 0xC0 and 0xFF:

- No measurement exists to beat it.
- 0.75 lies inside the range the circuits give: 0.66 on the +2A/+3, 0.68 on the 128K, 0.71 on the Next, and
  0.74–0.76 for the normal primaries of the 48K-derived table below.
- It is bit for bit Fuse's and ZEsarUX's, and within one step of MAME's.
- The frame holds colour numbers, so the palette is the page's choice, and it can offer the others as presets.

| # | Colour | Default (Fuse) | "48K TV" (ZEsarUX/Atkinson) | Next | MAME |
|---|---|---|---|---|---|
| 0 | black | 000000 | 060800 | 000000 | 000000 |
| 1 | blue | 0000C0 | 0D13A7 | 0000B6 | 0000BF |
| 2 | red | C00000 | BD0707 | B60000 | BF0000 |
| 3 | magenta | C000C0 | C312AF | B600B6 | BF00BF |
| 4 | green | 00C000 | 07BA0C | 00B600 | 00BF00 |
| 5 | cyan | 00C0C0 | 0DC6B4 | 00B6B6 | 00BFBF |
| 6 | yellow | C0C000 | BCB914 | B6B600 | BFBF00 |
| 7 | white | C0C0C0 | C2C4BC | B6B6B6 | BFBFBF |
| 8 | bright black | 000000 | 060800 | 000000 | 000000 |
| 9 | bright blue | 0000FF | 161CB0 | 0000FF | 0000FF |
| 10 | bright red | FF0000 | CE1818 | FF0000 | FF0000 |
| 11 | bright magenta | FF00FF | DC2CC8 | FF24FF | FF00FF |
| 12 | bright green | 00FF00 | 28DC2D | 00FF00 | 00FF00 |
| 13 | bright cyan | 00FFFF | 36EFDE | 00FFFF | 00FFFF |
| 14 | bright yellow | FFFF00 | EEEB46 | FFFF00 | FFFF00 |
| 15 | bright white | FFFFFF | FDFFF7 | FFFFFF | FFFFFF |

Other presets worth offering:

- **"48K TV"** (the Atkinson table): each bright colour is its normal one plus an equal step in R, G and B that
  grows with the colour's luminance. That is BRIGHT raising only Y, as the 48K's Y/U/V design does.
- **"+2A/+3 SCART"**: 0xA8/0xFF, from 0.44/0.67 V.
- **"Next"**: 0xB6/0xFF.
- **"85%"**: 0xD8/0xFF. The redcode references are drawn in it, which is one more reason to compare by colour
  number.

Checks:

- The default palette equals the table above.
- `pal[8] == pal[0] == 000000`.
- In colours 1–7, each channel that is on is 0xC0 (0xFF when bright), and each that is off is 0.
- The colour number's bits are B = bit 0, R = bit 1, G = bit 2.
- Rec. 601 luma rises strictly from 0 to 7, and from 8 to 15.

### 4.4 The frame and what a television showed

| | 16K/48K | 128K/+2 | +2A/+3 | Pentagon 128 |
|---|---|---|---|---|
| T per line / pixels per line | 224 / 448 | 228 / 456 | 228 / 456 | 224 / 448 |
| lines per frame | 312 | 311 | 311 | 320 |
| pixel clock | 7 MHz | 7.0938 MHz | 7.0938 MHz | 7 MHz |
| lines from INT to the paper | 64 | 63 | 63 | 80 |
| T from INT to the first paper pixel | 14336 | 14362 | 14365 (Fuse), 14364 (WoS), ≈14363 (Next) | 17988 (Fuse), ≈17982 (Next) |
| first contended T | 14335 | 14361 | 14365 | none |
| INT length | 32 T | 36 T (Fuse, MiSTer); 32 (ZX-Uno) | 32 T | 36 T |

Some machines run every timing 1 T later (the "late timings"; Fuse's `late_timings` adds 1).

Sources:

- the WoS 48K and 128K references [14], [15];
- libspectrum's `timings.c` [16];
- Chris Smith [17];
- MAME [9] and the Next [7].

libspectrum gives the Pentagon 3,584,000 Hz. MAME and the Next give it 3.5 MHz, as `docs/architecture.md` does.

**What the ULA blanks.**

- **Vertically (48K)**, counted from the first paper line: lines 0–191 are paper, 192–247 the bottom border (56),
  248–255 blanking (8; vsync 248–251, INT asserted at 248), 256–311 the top border (56). That is 304 lines with
  picture: 56 + 192 + 56 (Chris Smith [17], ZX-Uno [18], the Next [7]).
- **Vertically, other models**: the 128K has 56 lines above and 55 below. The Pentagon blanks 16, with 64 above
  and 48 below.
- **Horizontally**: 96 px are blanked (13.71 µs, sync 32 px), which leaves **352 px of picture a line on every
  model**. Where the paper sits in those 352 px is not settled:
  - The Next's VHDL, after Chris Smith's analysis, has 32 px left and 64 right (128K: 40 / 64; Pentagon: 64 / 64).
  - Chris Smith, matching his clone to a real Spectrum marked on the TV glass, had to move to 32 / 64.
  - ZX-Uno gives about 44 / 52.
  - The WoS FAQ, Fuse and MAME split it 48 / 48. That is a convention on the CPU's timeline, not a measured
    blanking.

**This project's frame**, 352 × 296 with the paper at (48, 48): 48 lines above, 56 below, 48 px a side. It is
MAME's geometry.

- Vertically it is well founded: it leaves out the 8 lines after the blanking, which no television showed.
- Horizontally, if the Next and Chris Smith are right, the left 48 px include 16 that the ULA blanks, and 16 px of
  real right border are missing. A frame 368 px wide with the paper still at x = 48 would hold both readings.
  That is a design question, noted here and not changed.
- Whatever is decided, the checks hold:
  - with every attribute's PAPER different from the border, the paper is exactly x 48–303, y 48–239;
  - on a 48K, frame pixel (x, y) is drawn at T = 14336 + (y − 48) × 224 + (x − 48) / 2, so (0, 0) is at T 3560;
  - an OUT to FE that ends at T 3587–3590 recolours the border from (48, 0), and one that ends at 3591 from
    (56, 0). That is 8-pixel granularity. Late timings are 1 T later. These border times are derived from the
    WoS FAQ's figure (paper at 14336, a border change landing at the paper's corner for an OUT ending at
    14339–14342), not measured here.

**On a television** (derived from the standards, not measured):

- PAL's active line is 51.95 µs (364 px at 7 MHz), so the ULA's own 352 px fit inside it. The ULA's back porch
  (40 px, 5.71 µs) is PAL's 5.7 µs.
- A 4:3 set's overscan hid 3.3–6.7% a side horizontally (12–24 px) and 3.5–5% vertically (10–14 lines) [19].
- So a 48K showed roughly 15–31 px of border at the left, 40–56 at the right, 28–42 lines above and 40–54
  below, with the paper left of centre.
- A "full border" of 384 × 288 includes blanking: the ULA never puts out more than 352 px of picture a line.

What emulators show:

| Emulator | Frame | Border left / right / top / bottom |
|---|---|---|
| Fuse | 320 × 240 | 32 / 32 / 24 / 24 |
| MAME | 352 × 296 | 48 / 48 / 48 / 56 |
| ZEsarUX | 352 × 304 | 48 / 48 / 56 / 56 |
| the Next (HDMI, 48K) | 360 × 288 | 48 / 56 / 48 / 48 |

**Pixel aspect.** PAL's square-pixel rate is 14.75 MHz, so a Spectrum pixel is 14.75 / 7 / 2 = 1.054 times as
wide as it is tall on the 48K and Pentagon, and 1.040 on the 128K family (1.052 and 1.038 by the 12:11
convention) [20]. A page that corrects for it shows the 352-px frame about 371 px wide.

Sources:

- [1] 48K service manual, https://spectrumforeveryone.com/wp-content/uploads/2017/08/ZX-Spectrum-Service-Manual.pdf
- [2] https://en.wikipedia.org/wiki/ZX_Spectrum_graphic_modes
- [3] Paul Farrow, *RGB for ZX Spectrum 128, +2, +2A, +3* (2001), https://mts.speccy.cz/doc/128_rgb.pdf
- [4] 128K service manual, https://spectrumforeveryone.com/wp-content/uploads/2017/11/ZX-Spectrum-128-Service-Manual.pdf
- [5] TEA2000 datasheet, https://www.secarica.ro/zx/tea2000.pdf
- [6] Chris Smith, output driver design, https://web.archive.org/web/2019/http://www.zxdesign.info/ddrivedesign.shtml
- [7] the Next's FPGA source, https://gitlab.com/SpectrumNext/ZX_Spectrum_Next_FPGA (`cores/zxnext/src/video/zxula_timing.vhd`, `zxula.vhd`, `zxnext.vhd`)
- [8] Fuse, https://sourceforge.net/p/fuse-emulator/fuse/ci/master/tree/ (`ui/gtk3/gtkdisplay.c`, `display.h`, `machine.c`)
- [9] MAME, https://github.com/mamedev/mame/tree/master/src/mame/sinclair (`spectrum_v.cpp`, `spec128.h`, `pentagon.cpp`)
- [10] ZEsarUX, https://github.com/chernandezba/zesarux/blob/main/src/video/screen.c
- [11] Unreal Speccy, https://github.com/alfishe/unreal-speccy/blob/master/x32/unreal.ini
- [12] ZX-Art, https://github.com/moroz1999/zx-image/blob/master/ZxImage/Enum/PalettePreset.php
- [13] CLK, https://github.com/TomHarte/CLK/blob/master/Machines/Sinclair/ZXSpectrum/Video.hpp
- [14] https://worldofspectrum.org/faq/reference/48kreference.htm
- [15] https://worldofspectrum.org/faq/reference/128kreference.htm
- [16] https://sourceforge.net/p/fuse-emulator/libspectrum/ci/master/tree/timings.c
- [17] Chris Smith's research notes, https://web.archive.org/web/2019/http://www.zxdesign.info/ (`vidresearch`,
  `vertcontrol`, `horiztiming`, `displaycenter`)
- [18] ZX-Uno, https://github.com/zxdos/zxuno/blob/master/cores/Spectrum/common/pal_sync_generator.v
- [19] https://en.wikipedia.org/wiki/Overscan
- [20] https://en.wikipedia.org/wiki/Pixel_aspect_ratio
- the Ramsoft floating-bus report (first fetch sampled at T 14347 on the 48K and 14368 on the 128K, counted with
  the instruction's own offset), https://web.archive.org/web/2008/http://www.ramsoft.bbk.org/floatingbus.html

## 5. What could not be verified

Hold the emulator to the exact figures above. The things below are softer, so treat a mismatch with them as a
question to look into, not proof of a fault:

- **References from hardware are few.** These are captures or photos of real machines:
  - z80test's results, by construction;
  - the `-hw-` photos (ULA 48 Simple, ULA 128, ULA 128E, Rak's timing test on a +2, FloatFFD, IR contention on a
    CMOS 48K, the +2A floating bus);
  - the Butlers' timing-test logs.

  The redcode GIFs are emulator renders, checked by eye against those photos. The game screens after loading come
  from SkoolKit's simulator, which runs the game's own code but has no contention, no border, and only
  approximate floating-bus and Issue 2/3 behaviour.
- **Run times after loading are estimates**, except for z80test's (exact CPU cycles, from redcode's harness) and
  the tape times (exact, from the files' pulses). Use them as limits with a margin, never as exact frame numbers.
- **Expectations taken from one source**:
  - fusetest's 128K/+3/Pentagon lines are Fuse's own, with FIXMEs, and its `Contention offset: 0x08` is read from
    the source.
  - Minfo's `First contended` convention on the 128K and +3 is untested.
  - The AY/YM test's `255` and `11` are derived from MAME's register masks, not seen on a machine.
  - Shock's 48K/128K test was worked out from its disassembly.
  - On the 128K, the Butlers' test passes in full only with late timings; the toastrack's early timings fail
    five contended tests on the real machine too. The emulator's 128K model decides which result it must give.
- **The boot**: the frame at which each ROM's screen is complete is estimated from the 48K's RAM test, not
  measured. This project has no Pentagon ROM of its own; it uses the 128K's. Its +3 ROM is version 4.0; a +2A's
  4.1 may title its menu differently.
- **The palette**: no measured per-colour level of any model has been published. Fuse's 0xC0/0xFF is a convention
  that the circuit-derived ratios bracket.
- **The visible area**: where the 48K's paper sits within the 352 unblanked pixels (48/48, 44/52 or 32/64) is
  disputed. The TV overscan figures are derived from broadcast standards.
- **Games**:
  - How to start Daley Thompson's events, Platoon, Rick Dangerous, Renegade and Fantasy World Dizzy (SPACE did
    not start it in the simulator).
  - The skill codes of Saboteur.
  - Every 128K behaviour except the menus of Where Time Stood Still, RoboCop, Chase H.Q. and Saboteur II, and
    Saboteur's reaching its game (all in the simulator only).
  - Black Raven is only a demo.
  - z80test's count of `scroll?` prompts (about 7) is worked out from the ROM's SCR-CT logic, not counted.
  - No Search Loader game was found.
  - Jetpac, Knight Lore, Chuckie Egg and Sidewize cannot be pinned (distribution denied).
- **Demos**: there is no capture of real hardware for any of them. When each part of Rage, Eye Ache and Lyra II
  appears is not known, and Overscan's key order is not confirmed. That a build run on the wrong model tears is a
  prediction.
- **Pentagon**: no Pentagon-only test program with a stable URL and a documented result was found. The Pentagon
  is checked by fusetest, Minfo and Frame Test (frame length, no contention), and by Eye Ache, Rage and Old Tower.

## 6. Fixture index

Every fixture of this corpus, by section (168 in all; each line of
`fixtures.txt` gives its URL, zip member and SHA-256):

- **§1.1 z80test** (10): `test-z80full.tap`, `test-z80doc.tap`, `test-z80flags.tap`, `test-z80docflags.tap`, `test-z80ccf.tap`, `test-z80memptr.tap`, `test-z80ccfscr.tap`, `ref-z80ccfscr-zilog.png`, `ref-z80ccfscr-nec.png`, `ref-z80ccfscr-st-cmos.png`.
- **§1.2 machine tests** (64): `test-fusetest.tap`, `test-timing-tests-48k.sna`, `test-timing-tests-128k.szx`, `test-minfo.tap`, `test-minfo-2011.tap`, `test-ulatest3.tap`, `test-timingtest-rak.tap`, `test-floatspy.tap`, `test-ula48-simple.tap`, `test-ula128-timing.tap`, `test-ula128e-plus3.tap`, `test-im0-2.tap`, `test-int-retrigger.tap`, `test-floatffd.tap`, `test-ir-contention.tap`, `test-nec-contention.tap`, `test-plus3-floatbus.tap`, `test-plus3-paging.tap`, `test-basic-border.z80`, `test-frame-test.tzx`, `ref-floatspy-48k.gif`, `ref-floatspy-48k-selftest.gif`, `ref-floatspy-128k.gif`, `ref-floatspy-128k-selftest.gif`, `ref-ula48-simple.gif`, `ref-ula48-simple-hw-48k.jpg`, `ref-ula128-timing.gif`, `ref-ula128-timing-hw-plus2.jpg`, `ref-ula128e-plus3.gif`, `ref-ula128e-plus3-hw-plus2a.jpg`, `ref-timingtest-rak-48k-menu.gif`, `ref-timingtest-rak-48k-early-0.gif`, `ref-timingtest-rak-48k-early-1.gif`, `ref-timingtest-rak-48k-early-2.gif`, `ref-timingtest-rak-48k-3.gif`, `ref-timingtest-rak-48k-early-4.gif`, `ref-timingtest-rak-128k-early-0.gif`, `ref-timingtest-rak-128k-8.gif`, `ref-timingtest-rak-plus3-0.gif`, `ref-timingtest-rak-plus3-3.gif`, `ref-timingtest-rak-hw-plus2-128k-0.jpg`, `ref-minfo-2011-48k.png`, `ref-ulatest3-48k.gif`, `ref-im0-2.gif`, `ref-int-retrigger.gif`, `ref-floatffd-128k.png`, `ref-floatffd-hw-128k.jpg`, `ref-ir-contention.gif`, `ref-ir-contention-hw-48k-cmos.png`, `ref-plus3-floatbus-hw-plus2a.png`, `ref-basic-border.gif`, `ref-frame-test-48k.gif`, `ref-frame-test-128k.gif`, `ref-nec-contention-menu.gif`, `ref-nec-contention-0.gif`, `ref-nec-contention-1.gif`, `ref-nec-contention-2.gif`, `ref-nec-contention-3.gif`, `ref-nec-contention-4.gif`, `ref-nec-contention-5.gif`, `ref-timing-tests-48k-early.gif`, `ref-timing-tests-128k-early.gif`, `ref-timing-tests-128k-late.gif`, `test-ay-ym.tap`.
- **§2 demos** (25): `demo-shock.tzx`, `demo-shock.tap`, `demo-overscan.tzx`, `demo-aquaplane.tzx`, `demo-eyeache.tap`, `demo-rage.tap`, `demo-mescaline-128.tap`, `demo-mescaline-plus2a.tap`, `demo-nirvana-plus.tap`, `demo-bifrost2.tap`, `demo-oldtower-48k.tap`, `demo-oldtower-128k.tap`, `demo-oldtower-pentagon.tap`, `demo-lyra2.tzx`, `ref-demo-shock.gif`, `ref-demo-shock-128-mame.jpg`, `ref-demo-aquaplane.png`, `ref-demo-overscan.gif`, `ref-demo-eyeache.gif`, `ref-demo-rage.gif`, `ref-demo-lyra2.gif`, `ref-demo-nirvana-plus.png`, `ref-demo-bifrost2.png`, `ref-demo-oldtower.png`, `ref-demo-mescaline.png`.
- **§3 games** (69): `saboteur.tzx`, `saboteur.tap`, `ref-game-saboteur.gif`, `ref-game-saboteur-load.scr`, `game-manic-miner.tzx`, `game-aquaplane.tzx`, `game-daley-thompsons-decathlon.tzx`, `game-arkanoid.tzx`, `game-mag-max.tzx`, `game-renegade-48.tzx`, `game-renegade-128.tzx`, `game-match-day-2.tzx`, `game-platoon.tzx`, `game-where-time-stood-still.tzx`, `game-robocop.tzx`, `game-chase-hq.tzx`, `game-cobra.tzx`, `game-rick-dangerous.tzx`, `game-dynamite-dan.tzx`, `game-rasputin.tzx`, `game-abu-simbel-profanation.tzx`, `game-exolon.tzx`, `game-saboteur-2-48.tzx`, `game-saboteur-2-128.tzx`, `game-fantasy-world-dizzy.tzx`, `game-black-raven.tzx`, `game-short-circuit.tzx`, `ref-game-manic-miner.gif`, `ref-game-manic-miner-load.scr`, `ref-game-aquaplane.gif`, `ref-game-aquaplane-load.scr`, `ref-game-daley-thompsons-decathlon.gif`, `ref-game-daley-thompsons-decathlon-load.scr`, `ref-game-arkanoid.gif`, `ref-game-arkanoid-load.scr`, `ref-game-mag-max.gif`, `ref-game-mag-max-load.scr`, `ref-game-renegade.gif`, `ref-game-renegade-load.scr`, `ref-game-match-day-2.gif`, `ref-game-match-day-2-load.scr`, `ref-game-platoon.gif`, `ref-game-platoon-load.scr`, `ref-game-where-time-stood-still-load.scr`, `ref-game-robocop.gif`, `ref-game-robocop-load.scr`, `ref-game-chase-hq.gif`, `ref-game-chase-hq-load.scr`, `ref-game-cobra.gif`, `ref-game-cobra-load.scr`, `ref-game-rick-dangerous.gif`, `ref-game-rick-dangerous-load.scr`, `ref-game-dynamite-dan.gif`, `ref-game-dynamite-dan-load.scr`, `ref-game-rasputin.gif`, `ref-game-rasputin-load.scr`, `ref-game-abu-simbel-profanation.gif`, `ref-game-abu-simbel-profanation-load.scr`, `ref-game-exolon-load.scr`, `ref-game-saboteur-2.gif`, `ref-game-saboteur-2-load.scr`, `ref-game-fantasy-world-dizzy.gif`, `ref-game-fantasy-world-dizzy-load.scr`, `ref-game-black-raven.gif`, `ref-game-black-raven-load.scr`, `ref-game-short-circuit.gif`, `ref-game-short-circuit-load.scr`, `ref-game-where-time-stood-still.png`, `ref-game-exolon.png`.

Pinned for the parts' own tests, not part of this corpus: `fuse-z80-tests.in`, `fuse-z80-tests.expected`, `zexdoc.com`, `zexall.com`, `singlestep-z80.zip` (`crates/z80`), and `saboteur.tzx.zip`, `mexican-adventure.sna.zip`, `aquanoids-reduced.tap.zip`, `stab-des-druiden.z80.zip`, `snap-v1-acrojet.z80`, `snap-v1-raw-caverna.z80`, `snap-v2-48k-deathtrap.z80`, `snap-v2-128k-brokeout.z80`, `snap-v2-pentagon-21.z80`, `snap-v2-plus2-daytona48.z80`, `snap-v3-48k-betting.z80`, `snap-v3-128k-avalanche.z80`, `snap-v3-128k-legybator.z80`, `snap-v3-plus2-ministocks.z80`, `snap-v3-plus3-piramids.z80`, `snap-v3-tc2048-hunchback08.z80`, `snap-128k-chata3.sna`, `snap-128k-lombard.sna`, `snap-szx13-48k-fruitmachine.szx`, `snap-szx14-48k-piramide.szx`, `snap-szx15-128k-littlefish.szx`, `snap-szx13-128k-gamex2.szx`, `snap-slt-heavymetal.slt`, `snap-slt-killeduntildead.slt` (the
snapshot and unzip crates).
