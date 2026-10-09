# The machine: `crates/spectrum`, and `zx`: `crates/cli`

The Spectrum itself: the CPU (`z80`) on a bus that is the ULA, the memory and the ports, with the AY (`ay`), the
sound (`audio`) and the tape deck (`tape`) attached as the real machines attach them, in seven models: the 16K,
the 48K (Issue 2 or 3 keyboard, early or late ULA timings), the 128K, the +2, the +2A, the +3 (no disk drive) and
the Pentagon 128. Every machine cycle lands on the ULA's timeline where the real one does: contention by model,
memory and I/O, T-state by T-state; the picture drawn lazily, exactly as the ULA fetched it; the floating bus;
the border at its real granularity; the interrupt; the EAR line. The test is the corpus (docs/test-corpus.md):
98 parts, from z80test through the tape to Saboteur's REWARD screen and its game, all of which pass.

`zx` is the machine headless: run anything, press keys at frames or when a text appears, take pictures, read the
screen as text, compare pictures with references, and look into a program (where it spends its time, its port
writes, what was done to its tape).

## The API

```rust
use spectrum::{Machine, Model, Options, Stop, Joystick, keys, joy};

// Making one
Machine::new(Model) -> Machine;                     // switched on, the default options
Machine::with_options(Model, Options) -> Machine;
zx.power_on(Model);                                 // off and on again (as another model too); the tape stays
zx.reset();                                         // the RESET button: CPU and paging latches; RAM kept
zx.nmi();                                           // an NMI (a Multiface-style button), at the next boundary
zx.model() -> Model;  zx.options() -> Options;  zx.set_options(Options);

// Running
zx.run_frame() -> Stop;                             // Stop::FrameEnd, or Stop::Breakpoint(pc) mid-frame
zx.run(steps: u64) -> Stop;                         // at most `steps` CPU steps (Stop::Steps)
zx.step_instruction() -> Stop;                      // one instruction with its prefixes
zx.frame() -> &[u8];                                // the last frame: 352 × 296 colours 0-15 (8-15 bright)
zx.frame_width() -> usize; zx.frame_height() -> usize;   // 352, 296 (FRAME_WIDTH, FRAME_HEIGHT; PAPER_X/Y 48)
zx.audio() -> &[f32];                               // the last frame's sound, stereo interleaved
zx.set_sample_rate(hz);  zx.sample_rate() -> u32;   // 48,000 until set
zx.frame_count() -> u64;                            // frames run since made (not restored by load_state)
zx.frames() -> u64;  zx.tstate() -> u32;            // frames since power-on (part of the state); T in frame

// Input
zx.key(code: u8, down: bool);                       // code = half-row × 5 + bit (spectrum::keys::*)
zx.key_down(code) -> bool;  zx.release_keys();
zx.joystick(Joystick, bits: u8);                    // None, Kempston, Sinclair1, Sinclair2, Cursor; joy::RIGHT 1,
                                                    // LEFT 2, DOWN 4, UP 8, FIRE 16
zx.type_text(&str) -> u64;                          // typed from the next frame at the ROM's pace
zx.type_chords(&[Vec<u8>]) -> u64;                  // keys held together, one chord after another
zx.press(chord, frames);  zx.press_at(chord, delay, frames);   // a game's press: held, no pacing
zx.typing() -> bool;
spectrum::char_chords(char), key_code(&str), key_name(u8), Typist   // the same pacing, for a page or a script

// Files and the tape
zx.load(&[u8], name) -> Result<Loaded, LoadError>;  // Loaded { kind: Tape|Snapshot|Screen, name, model, others }
zx.tape_play(); zx.tape_stop(); zx.tape_rewind(); zx.tape_seek(block); zx.eject_tape();
zx.has_tape(); zx.tape_name() -> Option<&str>;
zx.tape_state() -> TapeState;                       // { loaded, playing, block, position s, length s }: cheap
zx.tape_blocks() -> Vec<TapeBlock>;                 // { kind: header|data|turbo|tone|pause|stop|group|info,
                                                    //   label, bytes, seconds }
zx.tape_active() -> bool;                           // the tape is playing: run flat out (accelerated loading)
zx.tape_status() -> Option<tape::Status>;  zx.tape_log() -> Vec<(frame, t, op)>;
zx.saved_tap() -> Vec<u8>;                          // what a SAVE recorded on the MIC line, as a TAP

// State
zx.snapshot() -> snapshot::Snapshot;  zx.restore(&Snapshot);
zx.save_state() -> Vec<u8>;  zx.load_state(&[u8]) -> Result<(), StateError>;

// The debugger
zx.registers() -> Registers;                        // af bc de hl af_ bc_ de_ hl_ ix iy sp pc i r im iff1 iff2
                                                    // halted memptr t
zx.cpu() -> &z80::Regs;  zx.cpu_mut() -> &mut z80::Regs;   // everything, writable
zx.peek(addr) -> u8;  zx.poke(addr, value);         // as the CPU sees memory now (ROM not written)
zx.ram_bank(n) -> &[u8];  zx.paging() -> (7FFDh, 1FFDh, locked);  zx.port_fe();  zx.ay_registers();
zx.add_breakpoint(pc); zx.remove_breakpoint(pc); zx.clear_breakpoints(); zx.breakpoints();
zx.disassemble(addr) -> (String, u8);
zx.set_tstate(t);  zx.redraw();  zx.set_border_now(colour);
zx.trace_ports(bool);  zx.port_writes() -> Vec<(t, port, value)>;
zx.screen_text() -> ScreenText;                     // { rows: 24 × 32 chars, inverse: [[bool; 32]; 24] }
spectrum::screen::read_frame(frame, ink) -> ScreenText;   // the same for any picture
spectrum::PALETTE: [[u8; 3]; 16];                   // Fuse's 0xC0/0xFF, by colour number
```

`Options`: `issue2`, `late_timings`, `instant_load`, `auto_tape` (default on), `tape_sound` (on), `snow` (on),
`ay_on_48k`, `ay_stereo` (`Mono`: the machine's own, `Abc`, `Acb`), `tone` (`None`: the model's own),
`volume`, `ghosting` (on), `sound` (on; off for flat-out runs: no output stage, `audio()` empty).

Everything is plain values, slices and `Vec`s, with no callbacks, generics or lifetimes in the API, so that the
C interface (`crates/wasm`) wraps it directly. The crate builds for `wasm32-unknown-unknown`. Nothing reads a
clock: time is T-states and frames.

## Models and their timings

Time is counted in T-states from the moment the ULA raises INT (docs/architecture.md). Each figure, and where it
comes from:

| | 16K/48K | 128K, +2 | +2A, +3 | Pentagon 128 |
|---|---|---|---|---|
| clock | 3,500,000 Hz | 3,546,900 | 3,546,900 | 3,500,000 |
| line × lines = frame | 224 × 312 = 69,888 | 228 × 311 = 70,908 | 228 × 311 = 70,908 | 224 × 320 = 71,680 |
| INT held from T 0 | 32 T | 36 T | 32 T | 36 T |
| first paper pixel | 14,336 | 14,362 | 14,365 | 17,988 |
| contention | 6,5,4,3,2,1,0,0 from 14,335 | the same from 14,361 | 1,0,7,6,5,4,3,2 from 14,361 | none |
| contended T-states a line | 128 | 128 | 129 | — |
| contended where | 4000h-7FFFh | banks 1, 3, 5, 7 | banks 4-7 | — |
| internal (no MREQ) T-states and I/O contended | yes | yes | no | — |
| ULA fetch of a column pair | paper + 2 + 8k: bitmap, attribute, bitmap, attribute | the same | the same (14,367: Hikaru) | the same (assumed) |
| border latched | every 4 T (8 px), a write at w shows from group g when w ≤ g + 3 | every 4 T, w ≤ g + 2 | every 4 T, w ≤ g + 2 | every T (2 px), w ≤ u + 3 |
| floating bus | the byte being fetched, else FFh | the same | ports 0000xxxx xxxxxx0x: the last byte on the bus with bit 0 set, when paging is not locked; else FFh | FFh |
| snow | yes (I in 40h-7Fh) | yes (I's page contended) | no | no |
| late timings | +1 T to all of the above | +1 T | — | — |

- **Frame, line, clock, the 48K's 14,336 and its pattern from 14,335; the 128K's 3.5469 MHz, 228 × 311 and the
  pattern from 14,361; the border for an OUT ending at 14,339-14,342 (48K) and 14,365-14,368 (128K); the
  +2A/+3's pattern 1,0,7,6,5,4,3,2; its banks 4-7; the +2A/+3's port FEh not contended**: the comp.sys.sinclair
  FAQ's 48K and 128K references (WoS). Chris Smith's research notes for his ULA book confirm the 14,336 by
  measurement ("exactly 14336 T-states pass from the interrupt generation to the first display byte").
- **INT lengths, the paper of the +2A/+3 (14,365) and the Pentagon (17,988), the Pentagon's 224 × 320**:
  libspectrum's `timings.c` (Fuse). MiSTer's ULA agrees on 32/36 T. The architecture gives the Pentagon 3.5 MHz;
  libspectrum gives it 3,584,000 Hz; this follows the architecture.
- **The +2A/+3's pattern from 14,361, not the FAQ's 14,365, and 129 T-states a line**: Patrik Rak's timing test
  on a +3 (the redcode wiki's capture, checked against hardware photos) shows a contended NOP from 14,361 and a
  delay of 1 at 14,489; Fuse starts the pattern at 14,361 too (its `contend_delay_common` with offset 4). With
  14,365 the capture is missed by 4 T-states throughout; with 128 T-states a line, by one cell. The FAQ's own
  "until cycle 14494" from 14,365 is 129 T-states long.
- **The 128K's border latch one T-state earlier against its picture than the 48K's**: azesmbog's ULA 128 timing
  test, whose capture the redcode wiki checked against a photograph of a +2 (`ref-ula128-timing-hw-plus2.jpg`),
  matches to the pixel with `w ≤ g + 2` and misses one 8-pixel group with `g + 3` (frame (40-47, 152), the
  first row of the white bar: `g + 3` cuts a black notch into it, and the photograph's bar has none). Early and
  late timings give the same picture here (the test's OUTs are contended, and move with the ULA), so the
  photograph says `g + 2` whichever the photographed +2 has. On the 48K the reverse holds:
  Woodmass's IR contention test matches with 3 and not with 2; the FAQ's figures are 3. The +2A/+3
  is taken as the 128's (its ULA 128E test matches both; the FAQ puts the +3's top-left pixel at 14,364, a
  T-state before libspectrum's 14,365, which is the same picture).
- **The Pentagon's border at every T-state**: MiSTer's ULA ("1T update for border in Pentagon mode") and the ZX
  Spectrum Next's `zxula.vhd`, both FPGA reimplementations. Its latency is taken as the others' (no capture).
- **The fetch times** (bitmap of the even column 2 T-states after its first pixel, then its attribute, then the
  odd column's): the floating bus's first byte at 14,338 on the 48K, 14,364 on the 128K (Fuse's
  `spectrum_unattached_port`, from Ramsoft's floating-bus guide) and 14,367 on the +3 (Hikaru's +2A/+3
  floating-bus test, on a real +2A).
- **Late timings**: "some machines use the timings given in this FAQ, while others are one T state later for
  all timings" (WoS FAQ); the redcode wiki's Late timings page (the 128K/+2's INT a T-state earlier;
  MartianGirl's 2025 finding for the 48K, that INT begins a T-state earlier when /RFSH is low the T-state
  before, is not modelled: here late is simply everything one later). The models default to early; Woodmass's
  IM0-2 test and the Butlers' timing tests detect early and late correctly.

## The bus

The CPU (`z80`) reports each machine cycle; the bus applies the model's delays at the cycle's first T-state, as
docs/z80.md asks:

- **Opcode fetch, memory read and write**: the delay table's value at the cycle's start, if the address's slot
  is contended. The tables are precomputed per model and timing (a `u8` per T-state of the frame, and 512 more
  of zeros for an instruction that runs over its end).
- **Internal T-states with an address on the bus** (INC rr's 2 at IR, LDIR's 5 at DE, ...): each T-state
  contended on its own on the Ferranti ULAs (the "IR contention" when I points at contended memory); none on
  the gate array, which contends MREQ cycles only (the FAQ: on the +2A/+3 "these entries are combined into just
  one"; Fuse's `contend_delay_no_mreq` of none; the Next's VHDL waits on MREQ only for the +3).
- **I/O** (the FAQ's Contended Input/Output), by whether the port's high byte addresses a contended slot (Fuse
  looks at the memory map the same way, so ports C000h-FFFFh are contended on the 128K when an odd bank is
  paged) and whether A0 is low (the ULA): N:4; N:1, C:3; C:1, C:3; C:1, C:1, C:1, C:1. A write lands at the
  cycle's second T-state (after the first contention), a read is sampled at its last but one: Fuse's
  `writeport`/`readport`. None of it on the +2A/+3 or the Pentagon.
- **The interrupt acknowledge** is uncontended (INT is in the top border), and reads the floating bus.

## The picture

Drawn lazily: nothing is drawn until something is about to change what an undrawn part would show (a border
write, a write to the bank on screen in its first 6,912 bytes, a 7FFDh/1FFDh change of screen bank, the
frame's end), and then everything up to that T-state is drawn as the ULA would have drawn it. The frame is cut
into 2-pixel units, one a T-state; a border unit is ready once its group's latch T-state has passed, a paper
column once both of its bytes are fetched (a write between the bitmap's fetch and the attribute's lands in the
attribute alone: the bitmap is taken at its fetch). Readiness rises along a row, so the first unready unit is
found by halving and runs are drawn in bulk.

- **FLASH**: ink and paper swapped for 16 frames in every 32 (WoS FAQ: "every 16 frames"), counted from
  power-on.
- **Snow** (16K/48K, 128K, +2 with I's page contended): an opcode fetch whose refresh (its T4) falls on the
  ULA's bitmap fetch of an even column makes the ULA fetch that column's bitmap and attribute with R as their
  addresses' low byte; one on the odd column's fetch shows the even column's bytes again (Weiv's account, 2022,
  the redcode wiki's Snow effect page, and MartianGirl's addition). The phases are as described there, relative
  to the fetch times above; no capture with snow was available to check them against, though Woodmass's IR
  contention test shows snow where a CMOS 48K's capture does, and with snow off matches the (snow-off)
  reference exactly. An option, on by default.
- **The frame's geometry**: 352 × 296, the paper at (48, 48), as docs/architecture.md and the redcode
  references have it (MAME's geometry). Pixel (x, y) is drawn at `paper + (y − 48) × line + (x − 48) / 2`.
  docs/test-corpus.md §4.4 notes that the 48K's ULA may blank 16 of the left 48 pixels and show 16 more at the
  right (Chris Smith, the Next); nothing here compels a change (every 352 × 296 reference matches to the pixel,
  border included), so the frame is kept. On the Pentagon the last 8 rows fall in its vertical blanking (its
  bottom border is 48 lines): they are drawn in the border colour at the frame's end.
- **The palette**: the frame holds colour numbers; `spectrum::PALETTE` is Fuse's 0xC0/0xFF (docs/test-corpus.md
  §4.3), used for `zx`'s PNGs.

## The floating bus

On the 16K/48K, 128K and +2, a read of a port nothing answers gives the byte the ULA is fetching at the read's
sample T-state (bitmap, attribute, bitmap, attribute of a column pair, then four idle T-states of FFh), and FFh
in the borders (Ramsoft's guide; Fuse). The 128K and +2 also write what a read of a 7FFDh-decoded port reads into
the paging latch (Woodmass's FloatFFD; Fuse's `readport`). The +2A/+3 return, on ports matching 0000xxxx
xxxxxx0x while paging is not locked, the last byte that went over the gate array's bus (its own last screen
fetch, or the CPU's last read or write of contended memory, whichever came later) with bit 0 set, and FFh
elsewhere (Hikaru's test and its description on the redcode wiki). The Pentagon reads FFh.

## Interrupts

INT is raised at T-state 0 and held for 32 T-states (36 on the 128K, +2 and Pentagon). It is offered at each
instruction boundary `t` with `t < length`, after the frame's T-states have wrapped: Fuse's condition
(`tstates < interrupt_length` in `z80_interrupt`), the one the FAQ's figures are measured against. Minfo
measures 32 and 36; Woodmass's interrupt retriggering test passes on the 48K, 128K and Pentagon. A taken
interrupt (or NMI) returns to the boundary before its handler's first instruction runs, so a breakpoint there
stops. NMI is an edge, offered at the next boundary.

## The ports

- **FEh** (A0 low on every model): keys in bits 0-4, the AND of every half-row whose address line is low (WoS
  FAQ); bits 5 and 7 high; bit 6 the EAR line. Written: the border (bits 0-2), MIC (3) and EAR (4).
  - **EAR, with the tape playing**: the tape's level at the read's sample T-state; on the machines whose pin 28
    carries input and output together (all but the +2A/+3), an EAR output (bit 4) held high holds the input
    high whatever the tape does (the FAQ: bit 6 reads high over 0.70 V, and EAR out puts 3.5 V on the pin).
  - **With no tape signal**: Issue 3: bit 6 = the last OUT's bit 4; Issue 2: bit 4 or bit 3 (the FAQ's table,
    from Pera Putnik's measurement); the 128K, +2 and Pentagon as Issue 3 (Fuse); the +2A/+3 always 0 (the FAQ:
    "always returns 0 if there is no signal"). Issue 3's slow decay of bit 6 after an OUT (180-2,800 T) is not
    modelled.
  - **Ghosting**: the matrix has no diodes, so keys down on two half-rows in one column join the rows: three keys
    at a rectangle's corners read as the fourth (the FAQ's CAPS SHIFT, B and V reading as BREAK). An option, on.
- **Kempston** (when the joystick is one): any port with A5 low (the interface's decoding, Fuse's "loose"),
  000FUDLR, taking priority over the keyboard (FAQ). Sinclair 1 (6, 7, 8, 9, 0), Sinclair 2 (1-5) and cursor (5,
  8, 6, 7, 0) are keys, as Fuse maps them.
- **7FFDh**: decoded A15 = 0, A1 = 0 on the 128K, +2 and Pentagon (FAQ: "bits 1 and 15 reset"); A15 = 0, A14 = 1,
  A1 = 0 on the +2A/+3. Bits 0-2 the bank at C000h, 3 the screen (bank 5 or 7), 4 the ROM, 5 locks until reset.
- **1FFDh** (+2A/+3): A15-A13 = 0, A12 = 1, A1 = 0. Bit 0 the special (all-RAM) mode with bits 1-2 choosing 0-1-2-3,
  4-5-6-7, 4-5-6-3, 4-7-6-3; else bit 2 the ROM's high bit (ROM 0 menu, 1 syntax, 2 +3DOS, 3 48 BASIC). Ignored
  while 7FFDh is locked, as 7FFDh is (Fuse's `specplus3_memoryport2_write`; kept but not acted on, a write made
  while locked took effect at the next state loaded or snapshot restored). Woodmass's +2A/+3 paging test agrees
  on every combination, both orders.
- **The AY**: FFFDh (A15, A14 = 1, A1 = 0) selects and reads; BFFDh (A15 = 1, A14 = 0, A1 = 0) writes; the +2A/+3
  read BFFDh as FFFDh (Fuse). An unselected chip leaves the bus to the floating bus.
- **The +3's disk controller with no drive** (2FFDh status, 3FFDh data): +3DOS (ROM 2 at 1F28h) takes a status
  of FFh for no controller (`ADD A,1 : CCF`), which is a +2A: its menu then says "128 +2A" and "Drive M:
  available.". A minimal µPD765A answers instead: status 80h idle (RQM), every command's phases, reads and READ ID
  ending Not Ready, SEEK and RECALIBRATE raising an interrupt that SENSE INTERRUPT STATUS reports with Seek End and
  Not Ready (NEC's data sheet). So the +3 boots as a +3 ("128 +3", "Drives A: and M: available."), and its
  Loader, finding no disk, loads from tape. The +2A has no controller (FFh).

## Sound

Into one `audio::Buffer` at the host's rate: the beeper (a `Level` set at each OUT that changes EAR or MIC), the
tape heard through the speaker (a `Level` at each edge, handed over by the deck's `edges_until` before each read
of port FEh and at the frame's end), and the AY (through an adapter that keeps what it has put into the buffer,
so that a restored state goes on exactly). The span of 1.0 the output stage's headroom is built for (the audio
review's note) is shared:

| | beeper | tape heard | AY |
|---|---|---|---|
| 16K/48K | 0.90 | 0.10 | — |
| with an AY (the 128K family, the Pentagon, a 48K with one) | 0.418 | 0.05 | 0.532 |

The beeper's level for EAR and MIC: the 48K's speaker behind its junction drops (MIC alone 0, EAR alone 0.94,
both 1.0); the 128K family heard linearly (MIC alone 0.095, EAR 0.958, both 1): docs/audio.md's figures, from the
FAQ's pin 28 voltages and the service manuals. The beeper-to-AY ratio 0.44 : 0.56 is docs/audio.md's, from the
128K's mixing resistors. The output tone by model: the 48K's speaker (`Tone::Speaker`), a television for the rest
(`Tone::Television`). The AY: the 128K family's three outputs joined on one track (`ay::Stereo::Joined`) unless
ABC or ACB stereo is chosen; clocked at half the CPU's clock (1,773,450 Hz; the Pentagon's 1,750,000), a 48K's
added AY at 1,773,400 (a Melodik's). The tape heard is an option, on: on the 48K one heard the tape load.

## The tape

`tape::Player` on the machine's clock (`set_48k` on the 16K/48K, for TZX's "stop the tape if 48K"), its level
asked at the T-state of each read of port FEh and cached until its next edge (a read between edges costs a
comparison).

- **Instant loading** (an option): at 056Ch (LD-START, once LD-BYTES at 0556h has set the border and pushed
  SA/LD-RET, as Fuse's trap at the `RET NZ` before it), with the 48 BASIC ROM paged (ROM 0 on the 16K/48K, 1 on
  the 128K, +2 and Pentagon, 3 on the +2A/+3; their LD-BYTES is byte for byte the same), `take_rom_block_if`
  takes the block and the trap runs the ROM's loop (05A9h-05E2h) over its bytes, so that every register is left
  as the routine leaves it, whether the load succeeds or fails: L the last byte read (the parity byte of a whole
  block), H the XOR of every byte read, B B0h after a byte, IX and DE moved by the bytes stored or verified; a
  wrong flag or a byte that does not verify returns their XOR in A with its flags and D OR E (swapped in by
  LD-LOOP's `EX AF,AF'`) in AF'; a verified byte leaves 0044h in AF'; a block that ends first fails as LD-EDGE
  times out (A 0, F 50h, B 0, L 1); after DE bytes `LD A,H : CP 1`. C, which holds the border and the EAR level
  as the pilot left them, is taken as 01h (as Fuse's trap does), AF' with it. `tests/ld_bytes.rs` runs each case
  (load, verify, a byte that does not verify, the wrong flag loading and verifying, a parity error, a block
  shorter than asked, a flag byte alone, DE = 0) from the edges and trapped and asks for the same registers,
  memory and tape position. (Fuse's trap, which this one first followed, leaves L at the last data byte, B and
  AF' untouched on a wrong flag, and A 0 with Z set on a byte that does not verify.) A block longer than
  LD-BYTES reads (DE bytes, the flag and the parity byte; the flag alone when DE is 0) is left to play from the
  edges, as Fuse leaves it: the rest of it plays on under whatever reads the tape next. Execution returns
  through the RET at 05E2h to SA/LD-RET, which restores the border and enables interrupts. Whatever it cannot
  take (turbo blocks, recordings) plays from the edges.
- **The automatic tape** (an option, on): started when LD-BYTES is entered (0556h, 48 BASIC paged), or, as Fuse's
  loader detection does, when ten reads of port FEh in a row come within 500 T-states of each other with B
  counting by one (an edge loop); stopped, when the deck started itself, after ten reads in a row that do not
  look like a loader's (more than 1,000 T-states apart, or B not held or counting by one: a keyboard scan), or
  when nothing has read port FEh for five seconds (not sooner: the ROM's own LD-BYTES spends a second at LD-WAIT reading nothing, and a loader may
  decrypt for longer while a tone plays). The deck stops itself at stop blocks; a loader still polling starts it
  again, as a person would press PLAY (Renegade needs it).
- **SAVE**: the MIC line's edges into `tape::Recorder`; `saved_tap()` is the TAP.
- **Accelerated loading**: `tape_active()` says the tape is playing; the page runs flat out. Nothing in the
  emulation changes.

## Loading anything

`load(bytes, name)` takes a TAP, TZX, CSW or PZX (inserted, stopped), a .z80, .sna, .szx or .slt (the machine
switched on as its model and restored), a .scr (onto the screen), or a .zip of any of them (`unzip::spectrum_files`:
the first tape, else snapshot, else screen; the others named in `Loaded::others`). Disk images are refused by
name. The super level loader's `ED FBh` trap loads level A to HL from the snapshot's levels (Fuse's `slt_trap`). A
tape with nothing on it to play (no header, data, turbo or tone block: a damaged file whose first real block could not
be read, or one of text alone) is refused as damaged, the deck as it was, so that the page does not switch the
machine on afresh to LOAD it. A zip's members are extracted, to tell what they are, to 64 MB in all
(`unzip::spectrum_files`), each to 64 MB. The deck's tape is shared (`Arc<Tape>`) with its player, a probe's clone of
it and every copy of the machine (a state loaded keeps one to fall back on): one copy of a recording, not five.

## State

- **Snapshots**: `snapshot()` gives a `snapshot::Snapshot` (HALT as the snapshot's convention, PC at the HALT;
  between a DD/FD prefix and its opcode, PC on the prefix, which runs again, since no format can say a prefix is
  pending); `restore` switches the machine on as the snapshot's model and puts its RAM, registers (MEMPTR and Q
  where the format has them), paging, port FEh, AY registers, joystick, Issue 2, late timings, custom ROM and
  embedded tape in place. Twenty-one snapshot fixtures, restored and taken again, give back what they hold;
  through .z80 and .szx and back, they run on 50 frames to the same CPU, RAM and picture.
- **`save_state()`**: `ZXST`, a version (1), and a deflated body (miniz_oxide, level 1): the model and the options
  that make the machine what it is (Issue 2, late timings, an AY on a 48K, snow); the CPU (every register, the EI
  delay, a pending prefix, Q); the T-state, frames and a pending NMI; RAM; the paging ports and lock; port FEh;
  the picture (where the frame has got to, the border, FLASH's count, the frame so far at 4 bits a pixel, this
  frame's snow, a latched bitmap byte); the +2A/+3's bus latch; the AY's state and what it has put into the
  sound; the sound buffer's whole state (an addition to `audio`, below) and the beeper's and tape's levels; the
  disk controller; and the tape deck's log (the tape's hash, and every control with its frame and T-state, from
  which the deck rebuilds the player and replays it on load: the tape exactly where it was, its loop counters
  and all) and its loader detection's counters. After those, tagged fields (a state without them loads with
  their defaults; a reader that does not know them stops before them): how far into the frame the tape's
  edges have been heard (the rebuilt player passes them again without handing them to the sound: a state taken
  while a loader reads the tape mid-frame heard them twice, and its sound went its own way), and the ROMs when
  they are not the model's own (a snapshot's custom ROM, which a state loaded into another machine lost). Not in it, being the person's: keys held, the joystick's bits,
  typing, breakpoints, the preference options, the tape's contents (a state from another tape leaves the deck
  stopped where it is), a SAVE in progress. 4-9 KB for a running game (34 KB for Saboteur's, once its tape has
  played). `Machine::state_picture(bytes)` reads the picture a state holds without building a machine from it (no
  RAM copied, no tape replayed: the inflating alone, 0.76 ms in the browser), for the page's rewind preview; the
  wasm crate's test holds it to the picture `load_state` gives, for every model. Run, save, run 120 frames; load, run 120
  frames: the frames, the sound and the state after are the same to the bit, in the same machine and in a fresh
  one of another model (`state › determinism`: the 48K loading Saboteur, the 128K loading Where Time Stood
  Still, the +3 and the Pentagon loading test programs), and taken mid-frame, with the picture half drawn and
  LD-BYTES reading the tape (`tests/state.rs`: the 48K, 128K and +3, and a machine put back run side by side
  with the one the state was taken from). Damaged states are refused, never a panic.

## Typing

`type_text`/`type_chords` pace keys as the page's `KeyFeeder` (web/src/input/feeder.ts) does for the ROM's
KEYBOARD routine (02BFh): each key held 3 frames, 3 between, a key not pressed again until the KSTATE set holding
it is free (6 frames after its release), nor a third while both sets are held. `LOAD ""` on a 48K is J, SYMBOL
SHIFT + P twice, ENTER. Text is literal keys: in K mode a letter types its keyword.

## `zx`

```
zx run [FILE...] [options]     --model (16k 48k 128k plus2 plus2a plus3 pentagon; 48k-issue2, 48k-late, ...),
                               --issue2 --late --early --ay48 --no-snow --joystick --stereo;
                               --tape realtime|instant|flat, --no-auto-tape, --play F, --stop F, --no-load;
                               --key F=KEYS[/HOLD], --type F=TEXT, --when TEXT=KEYS [--when-row R], --shot F=PATH,
                               --frames N, --until-text TEXT --max-frames N;
                               --png PATH [--scale N], --text, --peek ADDR, --wav PATH, --save-snapshot PATH,
                               --save-state PATH, --load-state PATH, --json;
                               --profile N, --trace-ports [MASK=]VALUE, --tape-log
zx tape FILE [--json]          the blocks
zx snap FILE [--json]          what a snapshot holds
zx disasm [FILE] [--model M] [--org A] [--from A] [--count N] [--json]
zx screen FILE [--png PATH] [--scale N] [--border C] [--text] [--json]   (.scr, or a PNG/GIF read as text)
zx bench [--model M] [--frames N] [FILE] [--instant] [--json]
zx compare A B [--offset X,Y] [--diff PATH] [--json]                     by colour number; exit 0 when equal
```

A tape given to `zx run` is loaded with LOAD "" (or the 128's ENTER) typed once the ROM is ready. Options given on
the command line win over what a snapshot or state says. `flat` is `realtime`: `zx` always runs flat out. Text
is read from the picture against the 48K ROM's font, ink or paper either way round (`inverse` marks which);
cells the font does not have read as ▒. `zx compare` maps each picture's pixels to colour numbers in its own
palette (any normal level, 0xFF bright), bright black as black, and places a 352 × 240 reference at (0, 24) and
a 256 × 192 one at (48, 48).

## Tests and their results

`nerd test machine` (crates/spectrum's tests and zx's own, the ROMs alone, a few seconds) and `nerd test corpus`
(the corpus, a release build, 98 parts on up to eight threads, 22-42 s here; each part reported with its time in
emulated seconds). All pass.

**machine** (55 tests): every model booting to its ROM; frame lengths and the sound's sample count following the
clock; the 48K's contention 6,5,4,3,2,1,0,0 from 14,335, the right border, the next line, late timings; the 128K's
banks and the +3's 1,0,7,6,5,4,3,2 from 14,361 for 129 T-states; IR contention on the ULA and not the gate
array; I/O contention's four patterns and none on the +3; the floating bus byte by byte from 14,338, the 128K's
from 14,364, the Pentagon's FFh, the +3's bit 0; the border's group at 3,587/3,588 (48K), 3,420/3,421 (128K) and
the Pentagon's 2-pixel units; port FEh's keys, Issue 2 and 3, the Kempston; paging and its lock; LD-BYTES
called with a TAP, loaded from the edges (over a hundred frames) and trapped (under two) to the same bytes and
carry; the trap against the ROM run from the edges, register by register, in ten cases that succeed and fail
(tests/ld_bytes.rs); SA-BYTES recorded as exactly the TAP; typing LOAD "" at the ROM's pace; the fast state bit
for bit and in a fresh machine, taken mid-frame while LD-BYTES reads the tape, and with a custom ROM
(tests/state.rs); 1FFDh held by the lock; --joystick winning over a snapshot's; .szx round trips on four models; breakpoints at the interrupt handler, NMI, stepping; the AY
written, read back and heard; snow where I is contended and not on the +3; the SLT trap; ghosting; 600 damaged
states refused; the units' own (contention tables, paging, the video's latch and fetch rules, typing pacing,
the font index); every zx command.

**corpus** (docs/test-corpus.md):

| Part | Result |
|---|---|
| boot, 7 models | 16K and 48K: `© 1982 Sinclair Research Ltd` on row 23 at frames 48 and 87 (the corpus's estimate 85); 128K, +2, +3, Pentagon: their menus by frame 58; 48 BASIC from the menu: `© 1982 Sinclair Research Ltd` (128K), `© 1982 Amstrad` (+2, +3). The +2A titles itself `128 +2A`, the +3 `128 +3` |
| +3 loads a tape | its Loader falls back to tape; a test program loads and runs |
| loading stripes | the first header's pilot red/cyan for 200 frames, its data blue/yellow |
| z80test full, doc, flags, docflags, ccf, memptr | through the tape on the 48K, ENTER at each `scroll?`: `Result: all tests passed.`, no `FAILED`, `0 OK, 20:1`; full at frame 21,278 (the corpus: load 4,470 + 16,207) |
| z80test ccfscr | the Zilog picture exactly (84,480 pixels), and not NEC's or the ST CMOS's |
| fusetest 48K, 128K, +3, Pentagon | the listings exactly, nothing failed |
| Butlers' timing tests 48K | `TYPE1 (Early) timings detected`, `All Tests Complete 100% Pass` |
| Butlers' 128K | late: tests 1-34 pass, `9 STOP statement, 1350:1`; early: exactly tests 4, 17, 18, 26, 33 fail, as on a real toastrack |
| Minfo 48K, 128K, Pentagon; 2011 | `Frame time: 69888`, `INT time: 32`, `First contended: 14336`, `Line time: 224`; 70908, 36, 14362, 228; 71680, `Failed`, `Skipped`; `EI is prefix: yes`. See below on 14,336 |
| ULA test 3 | every row's bytes and its contention marks (bytes 2-7 inverse), the frame as the reference above its running counter |
| Rak's timing test | the menu and tests 48K 0-4, 128K 0 and 8, +3 0 and 3: each capture exactly |
| contention tables (no fixture) | a release build's tables: a NOP in contended memory from every T-state of paper lines 0 and 191 and around them, on the 48K, the 128K (bank 1) and the +3 (bank 4), takes 4 T and the pattern's delay |
| Floating Spy 48K, 128K | `ULA TYPE: 48K`, `IM2 T_OFS: 29`, `IN() TIME: 14347` (128K: 25, 14368); the self-tests `Floating bus  OK  for ULA 48K` / `128K`, OK inverse (at frames 16,694 and 18,471: the corpus guessed 5,000-6,000) |
| azesmbog's ULA 48 Simple, ULA 128 timing, ULA 128E +3 | each capture exactly, border included |
| IM0-2 | early: `Machine uses early timings`, `IM 0 response = 13T`, the capture exactly; late: `late timings` |
| interrupt retrigger 48K, 128K, Pentagon | `Your emulator is good` |
| FloatFFD | 128K: `IN (#7FFD): FF`, `IN (#FF): 13`, `Paged bank: 07`, no mismatch; 48K: `Not a 128K Spectrum` |
| IR contention | snow off: the capture exactly; snow on: the border exactly and 209 paper pixels of snow |
| NEC contention suite | the menu and all six tests exactly (test 1 with snow off, as captured) |
| +2A/+3 floating bus | rows 14368-14488 as photographed on a +2A, 14496-14536 all 41 |
| +2A/+3 paging | `v4.0 ROMs detected`, every pair equal in both orders |
| BASIC border | the capture exactly |
| Frame Test 48K, 128K | `69888 cycles/frame`, `70908`; `9 STOP statement, 130:1` |
| AY/YM | `123`, `255`, `123`, `11` in 48 BASIC (see below) |
| Saboteur (TZX, real time) | tape from frame 109; the header's pilot red/cyan, the turbo data black/red; the loading screen complete at tape frame 2,527 (the corpus: about 2,530) and every cell from 2,600 to 8,990 outside the hidden messages; the REWARD screen exactly at tape frame 9,046 (the load ends at 9,039; the game then prints 22 rows); a key, K, K, S, skill 1: the game, its panel 171 of 192 cells as ZXDB's picture (the corpus's simulator: 171) |
| Saboteur instant | the six ROM blocks taken at once, the four turbo blocks played; REWARD at frame 6,876 |
| Saboteur TAP | the tape ends at frame 14,635, then the high scores; never the REWARD screen |
| Manic Miner (ROM) | the loading screen at 1,125; the demo's `High Score 000000   Score 000000` and `AIR` |
| Arkanoid (Speedlock 2) | the loading screen exactly; A, A: round 1 in play, the floating bus answering its poll (82 of 300 frames change) |
| Cobra (Alkatraz) | the loading screen but Alkatraz's own countdown (3 cells); in play (84 of 300 frames change); the panel 143 of 160 cells |
| Short Circuit (Speedlock 2) | after 1 and 0, the lab (not the hang after WELCOME) |
| Renegade 48K (Speedlock 4) | the loading screen (762: its countdown), the tape stopped and started again for the last block, the menu |
| Rasputin (SoftLock), Abu Simbel (Dinamic) | Issue 2: the menu starts the game; Issue 3: it never responds |
| Dynamite Dan (Power-Load) | the loading screen; the bottom panel 153 of 160 cells |
| Where Time Stood Still (128K, Speedlock 7) | the loading screen exactly |
| RoboCop | 48K: the deck stops itself at "stop the tape if 48K" (frame 8,431, 163.2 s); 128K: plays on through every level |
| Saboteur II 48K, 128K | the loading screen; the REWARD screen with its one space |
| Exolon (Hewson) | the loading screen but Hewson's counter box (15 cells) |
| Rick Dangerous (Bleepload) | `Loading NN` rising: 0, 1, 2, 3, 5, 6, 7, 8 |
| Daley Thompson (Speedlock 1), Mag Max (3), Match Day II (5), Platoon (6), Chase H.Q. (Paul Owens), Renegade 128K, Fantasy World Dizzy (128K) | each loading screen |
| Aquaplane | its loading text in the ROM font; then the horizon: the side border cyan to row 94, blue from 97 |
| Shock | the speed test stores 30h at 25277 on a 48K, 80h on a 128K; part 2 at tape frame 9,850: every border row one colour, the sides alike on every row, 44 changes and 8 colours in the top border |
| NIRVANA+ | 199 multicolour cells, every 8 × 2 band two colours |
| Overscan | SPACE through its 23 text pages to "Press ENTER to part two.", ENTER: the bars, every one of rows 40-255 one colour edge to edge in each of 10 frames, 8 colours down column 0, up to 768 of 768 cells multicolour |
| BIFROST*2 | 166 multicolour cells in columns 1-20; the title in columns 21-31 exactly the reference; a key gives ANIMATED TILES, 0 PAINTING TILES (whose playfield stays empty until someone paints it: the reference is such a painting) |
| Old Tower 128K, Pentagon | 90 multicolour cells in the playfield once play starts |
| Lyra II (48K with an AY), Eye Ache (Pentagon) | part 1's scroller runs; up to 420 multicolour cells |
| state determinism; snapshot round trips | above |

**Where the corpus's expectations are, I believe, wrong** (each part asserts what the machine gives, with the
reason; worth a second look):

- **Minfo's `First contended`**: the corpus expects 14335 (the FAQ's first contended T-state); the machine
  prints 14336 (and 14362 on the 128K). Minfo counts its 0T as the T-state in which INT is sampled, one before
  the interrupt's response begins (its source: `inst-int.asm`'s handler "20T+" after a 19-T IM 2 response,
  `first-cont.asm`'s arithmetic); the FAQ counts from where the earliest response can begin. With the FAQ's
  timings, which this machine has and the Butlers' and Woodmass's hardware-checked tests confirm as early
  timings, Minfo prints 14336. So does the author's own picture of it on his page
  (https://torinak.com/~jb/zx/minfo.png: `Frame time: 69888`, `INT time: 32`, `First contended: 14336`,
  `Line time: 224`).
- **AY/YM's fourth line**: in 128 BASIC (the corpus runs it from the Tape Loader) it prints 255, not 11: the 128
  ROM's interrupt routine selects AY registers 7 and 14 every other frame (its keypad scan), so the register the
  program selects in one statement is not always the one it reads in the next. In 48 BASIC it prints 11, as the
  part runs it. (The corpus marks this test unverified.)
- **The +2A's and +3's menu titles**: the corpus gives `128 +3` for both; the ROM titles a machine without a disk
  controller (the +2A) `128 +2A`.
- **Floating Spy's self-test** takes about 14,000 frames, not 5,000-6,000.
- **Saboteur's REWARD screen** is complete 7 frames after the load ends, not 2 (it is printed through the ROM).

**Not made parts**: Rage, Mescaline and Black Raven. Rage, R at its BASIC menu (Pentagon), runs through its
parts to the full-screen border effect and its END (judged by eye: the colour sectors run on across the
paper's edge with no seam); the corpus gives no measure for it. Mescaline's tape is 843 s (some 42,000
frames).

## Speed

Measured, never judged (the machine is shared): `zx bench`, release build (opt-level 3, fat LTO), sound on at 48 kHz, on
this machine (Intel Core i7-14700, 28 threads, a load average of 2.4 at the time):

| | frames/s | × real time |
|---|---|---|
| each model idle in its ROM (5,000 frames) | 5,406-5,641 | 108-115 |
| 48K loading Saboteur from the edges (9,300 frames) | 4,140 | 83 |
| 48K loading Saboteur, instant (7,000 frames) | 4,031 | 80 |
| 128K loading Where Time Stood Still (5,000 frames) | 4,138 | 83 |

Most of a frame is the CPU (about 11 ns an instruction, the core's own speed with a plain bus); the rest the
picture (~40 µs a frame), the sound's output stage (~30 µs; off with `Options::sound`), and the tape. Two things
found on the way: the sound's output filters sank into subnormal numbers after half a minute of a held level and
made every frame after 40 times slower in the sound (fixed in `audio`, below); every read of port FEh walked the
tape player even between edges (now cached).

## Changes to the crates below

- **`audio`: a bug fixed.** After a level held for about 30 s (any silence), the output stage's f64 filters
  decay into subnormal numbers, where a first-order recursion rounds back to the same small value for ever
  (0.9995 × n rounds to n): every later sample cost tens of times more (the Butlers' timing test ran at 25× real
  time instead of 90×). `Biquad::process` now flushes what has decayed below 1e-30 to zero. The test
  `a_held_level_settles_to_zero_not_into_subnormals` (tests/buffer.rs) fails without the fix ("a filter holds the
  subnormal 4.72e-321") and passes with it.
- **`audio`: an addition.** `Buffer::state() -> BufferState` and `Buffer::set_state(&BufferState)`, plain data
  (the pending samples, the integrated level, the fraction of a sample, the output and the filters' histories),
  so that the machine's state can carry the sound and go on bit for bit (the contract: "loadState() puts the
  machine back exactly, sound and tape position included"). Nothing else in `audio` changes; the test
  `a_state_put_back_goes_on_to_the_bit` checks it through every tone.

- **`tape`: bounds, and a shared tape.** `MAX_BLOCKS`, `MAX_PULSES`, a smaller `INFLATE_LIMIT` and TAP's empty blocks
  left out (docs/tape.md, Limits); `Player::new` takes an `Arc<Tape>` (a `Tape` still does), so that a recording is
  held once. **`unzip`**: what `spectrum_files` extracts is 64 MB in all.

## Decisions

- **INT at the boundary** `t < length` (Fuse's), not at the instruction's last T-state: the FAQ's figures and the
  hardware-checked tests are measured against it.
- **The +2A/+3's contention** from 14,361 for 129 T-states (Rak's capture, Fuse), not the FAQ's 14,365.
- **The border latch**: 3 on the 48K, 2 on the 128K family (the captures).
- **Early timings by default** on every model; late is an option (the +2 is usually late on real boards).
- **The +3 has its disk controller, with no drive**; the +2A has none.
- **Power-on RAM**: DRAM comes up in no defined state, and a real machine shows noise for the moment before its
  ROM clears the screen; this one fills RAM with a fixed pseudo-random pattern (a 32-bit xorshift from a constant
  seed), so that power-on is the same every time. The 16K's missing upper RAM reads FFh (Fuse).
- **The automatic tape** restarts a tape a stop block stopped when a loader polls it (a person pressing PLAY).
- **Snow on**, **ghosting on**, **the tape heard**: the hardware's behaviour, each an option.

## Known gaps

- **The toolchain**: rustc 1.98.1's optimiser compiled the contention table's fill (`pattern[(i % 8) as usize]`,
  i a u32) into reads past the 8-byte pattern once `timing_base` held a call it could not see through (found in
  review, by a temporary `std::env::var` there): every other 8 T-states of each line got stack garbage, in
  release builds only (opt-level 2 or 3, with or without LTO; not with the test profile's overflow checks). It
  reproduces in a 40-line program. The fill now runs over an iterator, which compiles rightly, and the corpus's
  `machine › contention tables` part checks the tables a release build makes; the machine's own tests cannot,
  being built otherwise.

- Snow's phases follow Weiv's description; no capture with snow on was available to check them.
- Issue 3's slow decay of bit 6 after an OUT, and MartianGirl's late-timing mechanism on the 48K, are not
  modelled; late timings are everything one T-state later.
- The Pentagon's border latency and fetch offset are assumed as the others'; its last 8 rows (its vertical
  blanking) are drawn in the border colour.
- The +3's disk drive is not emulated (no drive attached); TR-DOS and the Beta disk are not either.
- `save_state` leaves out a SAVE in progress (the recorder) and the tape's contents.
- No ULAplus, Timex modes, Interface 1 or Multiface; the NMI button is there, but no Multiface ROM.
- Demos not judged by a part: Rage (looked at by eye), Mescaline, Black Raven (above).

## Sources

- comp.sys.sinclair FAQ, 48K reference: https://worldofspectrum.org/faq/reference/48kreference.htm (port FEh,
  Issue 2/3 and the pin 28 voltages, the floating bus, snow, the frame, the border, FLASH, contended memory and
  I/O).
- comp.sys.sinclair FAQ, 128K reference: https://worldofspectrum.org/faq/reference/128kreference.htm (the 128K's
  timings and paging; the +2A/+3's 1FFDh, special modes, contention table, port FEh and floating bus).
- libspectrum, `timings.c`: https://sourceforge.net/p/fuse-emulator/libspectrum/ci/master/tree/timings.c
- Fuse (read, not copied): https://sourceforge.net/p/fuse-emulator/fuse/ci/master/tree/ — `spectrum.c`
  (`contend_delay_common`, `spectrum_unattached_port`), `machine.c` (`line_times`), `periph.c` (`readport`,
  `writeport`, the 128's 7FFDh read), `peripherals/ula.c` (port FEh, Issue 2/3), `peripherals/joystick.c`,
  `peripherals/sound/ay.c` (the AY's ports), `machines/*.c` (memory maps, contention), `display_dirty.c` and
  `display_border.c` (the beam), `z80/z80.c` (`z80_interrupt`), `tape_traps.c` (the LD-BYTES trap), `loader.c`
  (the loader detection), `slt.c`.
- Chris Smith, research notes for *The ZX Spectrum ULA: How to Design a Microcomputer* (2010), ZX Design:
  https://web.archive.org/web/2019/http://www.zxdesign.info/ (the interrupt to the first display byte, 14,336 T,
  measured; horizontal timing). The book itself was not consulted.
- The redcode wiki's test catalogue and notes: https://github.com/redcode/ZXSpectrum/wiki/ — Timings, Late
  timings, Snow effect (Weiv, MartianGirl), +2A/+3 Floating Bus Test (Hikaru's fetch times and the +2A/+3's
  latch), and each test's page and captures (pinned in fixtures.txt).
- Ramsoft, floating bus guide: https://web.archive.org/web/2008/http://www.ramsoft.bbk.org/floatingbus.html
- Jan Bobrowski, Minfo 2025 source: https://torinak.com/~jb/zx/minfo.tar.gz
- MiSTer's ZX Spectrum ULA (`ula.sv`) and the ZX Spectrum Next's `zxula.vhd`
  (https://gitlab.com/SpectrumNext/ZX_Spectrum_Next_FPGA): the Pentagon's border at every T-state, the +3's
  contention on MREQ only, INT lengths.
- NEC µPD765A/µPD7265 data sheet: the controller's commands, phases and status bits.
- The +3 ROM (`roms/plus3-2.rom`, 1F28h): its test for a controller.
- docs/z80.md, docs/audio.md, docs/tape.md, docs/snapshot.md, docs/test-corpus.md, docs/web.md (feeder.ts).
