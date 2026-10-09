# Tapes: `crates/tape`

The tape deck. It reads TAP, TZX 1.20 (every block), CSW 1 and 2, and PZX; plays any of them into the EAR
line at any T-state of the machine's clock, through every TZX block; hands the machine's LD-BYTES trap the
blocks the ROM could load, for loading at once; records the MIC line back into TAP blocks as SAVE makes them;
and says what each block is, for the page. It knows nothing of the Spectrum but its tape signal, and reads no
clock: time is what the machine says it is.

Loading a game from tape is the heart of the owner's experience: the tape is what is heard, and what stripes
the border. So the signal is made as the specifications define it, edge by edge, and tested against the ROM's
own loading routine, modelled T-state by T-state.

## What it does, and its API

```rust
// Reading. Format known by its contents: TZX, CSW and PZX by signature, TAP by its lengths adding up.
Tape::parse(bytes: &[u8]) -> Result<Tape, Error>
Tape::from_blocks<B: AsRef<[u8]>>(blocks: &[B]) -> Tape        // TAP blocks, as SAVE makes them
Tape { format: Format, blocks: Vec<Block>, warnings: Vec<String> }
Tape::seconds(&self) -> f64;  Tape::info(&self) -> Vec<(String, String)>   // archive info, PZX header
Block::describe(&self) -> String      // "Program: SABOTEUR LINE 1", "Turbo: Data: 6912 bytes"
Block::kind(&self) -> &'static str    // "Standard speed data", "Pure tone", ...
Block::header(&self) -> Option<Header>;  Block::rom_data(&self) -> Option<&[u8]>;  Block::tzx_id(&self)
tape::duration(&Block) -> u64         // T-states of 3.5 MHz the block lasts
tap::write(blocks) -> Vec<u8>;  tap::block(flag, data) -> Vec<u8>;  tap::parity(bytes) -> u8
tape::rom::{PILOT, SYNC1, SYNC2, ZERO, ONE, HEADER_PILOT_PULSES, DATA_PILOT_PULSES, LD_BYTES, SA_BYTES, near,
            pilot_found}
CLOCK_48K = 3_500_000;  CLOCK_128K = 3_546_900

// The deck. `t` is always a T-state of the current frame, as every part counts it.
Player::new(tape: impl Into<Arc<Tape>>, clock_hz) -> Player  // stopped, at the start; the tape shared, not copied
                                                          // (a player cloned, as the instant load's probe is, shares it)
player.level_at(t: u32) -> bool                           // the EAR level; asked at every IN from 0xFE
                                                          // (low while the tape is not playing)
player.next_edge(t: u32) -> Option<u32>                   // when it next changes (may be past the frame)
player.edges_until(t: u32, f: impl FnMut(u32, bool))      // every change up to t, for the tape's sound
player.end_frame(frame_len: u32)
player.play(t);  player.stop(t);  player.rewind(t);  player.seek(block, t)
player.set_48k(bool)                                      // for TZX 0x2A and PZX STOP 1; default: not
player.set_clock(hz)                                      // the machine changed under the tape
player.status() -> Status   // playing, block, block_elapsed, block_seconds, tape_elapsed, tape_seconds,
                            // stopped_by: Option<StopReason>, at_end, message: Option<usize>
player.block_seconds(i) -> f64;  player.tape_seconds() -> f64;  player.durations() -> &[u64]
player.is_playing();  player.at_end();  player.tape() -> &Tape

// Instant loading, for the machine that traps LD-BYTES (0x0556).
player.take_rom_block(t: u32) -> Option<RomBlock>
RomBlock { index: usize, bytes: Vec<u8> }   // flag, data, parity: as LD-BYTES reads it
rom_block.ld_bytes(flag: u8, length: u16) -> LdBytes { loaded: Vec<u8>, ok: bool }

// Saving.
Recorder::new();  recorder.mic(t: u32, level: bool);  recorder.end_frame(frame_len: u32)
recorder.blocks() -> &[Vec<u8>];  recorder.take_blocks();  recorder.tap() -> Vec<u8>
recorder.is_recording() -> bool;  recorder.finish()
```

And a command, `tape` (`cargo run -p tape --bin tape -- list FILE`): `list FILE [--json]` (the blocks, their
lengths and what they are), `edges FILE [--128k] [--from BLOCK] [--count N]` (the level's changes, T-state by
T-state), `roms FILE [--json]` (what the instant load would hand LD-BYTES).

## The signal

### TZX's rules, as played

A tape is pulses: stretches of time at one level. The deck keeps two levels as it plays (`src/signal.rs`):

- the **pulse level**, TZX's "current pulse level": the level the next pulse is played at. Each pulse of
  blocks 0x10–0x14 and 0x19, and of PZX's PULS, DATA and PAUS, is played at it, and it then flips ("so that a
  subsequent pulse will produce an edge");
- the **line**: the level the last pulse was played at, which a generalized block's symbols start from.

From the specification's "Rules and definitions":

- **Start**: the pulse level is low when a tape starts to play, "either from the start or from a certain
  position": a rewind, a seek, and the block after an instant load all start low.
- **Pauses** (block 0x20, and every block's own pause): the first millisecond holds the pulse level ("at least
  1 ms. pause of the opposite level" of the last pulse, which finishes it with its edge), then low to the end.
  The pulse level is low after, so a pulse that follows begins with no edge. A pause of 0 is nothing (and a
  block 0x20 of 0 stops the tape).
- **Recordings**: after a direct recording (0x15) or a CSW block (0x18) the pulse level is the last level
  played. A 0x15's samples are levels (1 high); a CSW's pulses start at the pulse level and alternate, and
  the last is held. A CSW file states its first level (bit 0 of its flags).
- **Generalized data** (0x19): each symbol begins as its flags say: 0 the opposite of the line (an edge), 1
  the same (prolonging the last pulse), 2 low, 3 high; its pulses then alternate. Zeros in the symbol table
  only end a shorter symbol. The stream gives each symbol in ceil(log2(alphabet)) bits, most significant
  first.
- **Set signal level** (0x2B) sets both levels.
- **Stops and the end**: when the tape stops itself (0x20 of 0; 0x2A on a 48K; PZX STOP) or ends, the last
  pulse is ended as a pause would end it: the line takes the pulse level (the edge a loader reading the last
  bit waits for), holds it for a millisecond if that is high, and goes low. A tape that is not playing gives
  no signal: `level_at` is low while it stands, however it was stopped, as the EAR bit is with no tape (so
  that a program reading the keyboard's port with the tape stopped reads what it would on the real machine).
  Played again after a stop, the tape goes on from the next block from low, as TZX asks of a tape started
  "from a certain position"; stopped by `stop` in the middle of a pulse, it goes on with that pulse. At its
  end it stays stopped until rewound.
- **Flow**: jumps (0x23) are relative to the jump block, off the tape is its end; loops (0x24/0x25) play
  their body the count given (nested loops work, as a stack, though TZX asks for none); calls (0x26) play
  each sequence to its return (0x27) and then go on after the call; a return with no call, or a loop end with
  no loop, is passed. Select (0x28) is passed in play: choosing is the page's, by `seek`. Blocks that carry
  no signal take no time. A tape that loops among blocks of no signal for ever (a jump of 0) stops itself
  after a million of them, with `StopReason::EndlessLoop`.
- **Standard blocks**: a TAP block or 0x10 has a pilot of 8,063 pulses if its flag is below 0x80, else 3,223,
  of 2,168 T-states; syncs of 667 and 735; each bit two pulses of 855 (0) or 1,710 (1), most significant
  first. A TAP block is followed by a pause of 1,000 ms, as a 0x10 is by default.
- **Turbo and pure data** (0x11, 0x14) play only the used bits of their last byte (taken as 8 when the field
  is not 1 to 8).

So a standard block starts with its first pilot pulse low, the first sync pulse is high and the second low,
and each bit starts high: what PZX's specification says the ROM's SAVE makes. Tested to the T-state in
`tests/formats.rs`.

### PZX

Each block states its first level (PULS low; DATA and PAUS as their top bit says), and the level changes after
every pulse, zero-length ones included; so a PZX is played by setting the pulse level at each block. PULS is
decoded by the specification's own pseudocode (repeat counts, 31-bit durations, a zero pulse turning the
level). DATA plays its bits as its two pulse sequences, then its tail pulse. PAUS is its level held for its
duration (the deck makes no noise in it), which stays the pulse level after it: every block after one states
its own first level, so this differs from turning the level only where the tape stops or ends after a PAUS,
which then makes no edge. BRWS and PZXT are information; STOP with flags 1 stops a 48K only, anything else
always.
Blocks of other tags are skipped, as the specification asks.

### Time

TZX and PZX count T-states of 3.5 MHz. The deck keeps the tape's position in those, from where it was last
put (rewind, seek, instant load), and gives each edge the machine T-state `base + floor((pos - pos₀) × clock /
3,500,000)`: worked out from the base each time, never stepped, so nothing rounds twice and nothing drifts. On
the 128K family that is ×5067/5000 exactly. A CSW's samples are turned into T-states the same way, from the
start of its block (`floor(samples so far × 3,500,000 / rate)`), so an edge falls in the 3.5 MHz T-state its
exact time does; at the 128K's clock that T-state is scaled as every other is, which can put a CSW edge one
machine T-state before its exact time. Frame-relative times come and go through `end_frame`, like every
part's; absolute counts are 64-bit.

`level_at` is cheap: it compares the time asked with when the next change is due, and only then does work.
Asked an earlier time than before, it gives the latest level (the machine asks in order within a frame).
`next_edge` looks ahead without moving the tape, for skipping ahead. `edges_until(t, f)` hands over every
change up to `t`, for the sound of the tape: called before each read of the port and at each frame's end, it
puts every edge into the audio where it falls, whether or not the program was reading.

## Instant loading

`take_rom_block(t)` is for the machine that traps LD-BYTES at 0x0556. It considers the block LD-BYTES would
hear the whole of from `t`: the block now playing if it is still in its first piece of signal (its pilot),
else the next. It passes what carries no signal (texts, groups, archive info, glue), pauses, and the blocks
that stop the tape (a person loading would have pressed PLAY), following jumps, loops and calls. It takes
only what the real LD-BYTES would load from the edges (a false refusal costs time, as the block is then
loaded from the edges; a false taking loads what the machine would not), so beyond the table every pilot
must be one LD-BYTES finds: `rom::pilot_found`, a second and 520 pulses of it. From the pilot's first edge
the ROM waits a second (0x415 passes of a 3,349 T-state loop), then counts 256 pairs of pilot pulses before
it looks for the sync; the model needs 2,127 pulses of 2,168 at 3.5 MHz (2,107 at 3,546,900 Hz) and fails
at 2,126, and `pilot_found` asks for 2,135. It takes:

| What | Taken when |
|---|---|
| TAP block, TZX 0x10 | always: they are the ROM's by definition |
| TZX 0x11 | every timing within a tenth of the ROM's (`rom::near`), and all 8 bits of the last byte |
| TZX 0x12, 0x13, 0x14 | a 0x12 pilot near 2,168, then (past texts) a 0x13 of exactly the two syncs, then a 0x14 at the ROM's bits with all 8 bits |
| TZX 0x19 | a pilot of pulses near 2,168 ending in the two syncs, two data symbols that are the ROM's 0 and 1 (either order), one bit a symbol, whole bytes; every symbol of polarity 0, so that every pulse begins with an edge (LD-BYTES hears nothing else) |
| PZX PULS + DATA | the same: a pilot and syncs as they are heard (a zero-length pulse joins the two either side of it), then DATA whose first pulse makes an edge after the second sync, bits of two pulses each at the ROM's, whole bytes |

It does not take turbo blocks (Saboteur's four), direct recordings, CSW recordings (even of standard-speed
blocks: they would need decoding from samples, and they play faithfully as they are), or a pure data block
with no pilot before it. Those are played, and the machine's LD-BYTES (or the game's own loader) reads them
from the edges as the real one would.

Taken, the tape is moved to the start of the taken block's pause, level low, the tape's time going on: where
the real tape is when LD-BYTES returns, so that a loader the block brought in, which reads the next block
with its own routine (no trap sees it), has the gap the tape gives it, a second and the next pilot. (Skipping
the pause, as this deck first did, leaves such a loader one second less: one that spends a second before
it listens misses a data block's two-second pilot, `tests/deck.rs`.) A block with no pause of its own
leaves the tape at the start of the block after it. The status shows the taken block, its pause playing;
the next `take_rom_block` passes the pause. `RomBlock::ld_bytes(flag, length)` says what LD-BYTES does with the
bytes, as the ROM does it: a flag other than the one asked for loads nothing and fails; then each byte is
stored, up to `length`; the byte after the `length`th is the parity, and all of them from the flag on XOR to
0 or it fails. A block shorter than that stores what it has and fails; a longer one is judged by the byte
after the `length`th. Asked for 0 bytes, the ROM reads only the flag, compares it with nothing, and takes it
as its own parity: it succeeds only if it is 0 (found by the model, and matched).

## Saving

The `Recorder` takes the MIC line's level at each OUT to 0xFE (bit 3) and measures the time between edges: a
run of 256 or more pilot pulses (1,700–2,700 T), two syncs (400–1,100), then pairs of pulses, a pair shorter
than 2,565 T (halfway between a 0's 1,710 and a 1's 3,420) a 0. A pulse longer than any a bit has (1,939 T,
halfway between a 1's 1,710 and a pilot's 2,168), or no edge for 10,000 T (seen at the next edge or
`end_frame`), ends the block, whose whole bytes become a TAP block; that pulse may begin the next block's
pilot, as it does when a program calls SA-BYTES again straight away (the next pilot then follows the last
block's tail by about 2,400 T, which a limit of 2,700 took for a bit, running the two blocks into one). It counts
T-states, which the 128K's SAVE spends as the 48K's does, so it needs no clock. BEEP, noise and sound on the
MIC line make no block (no pilot). `tap()` gives the file the page can offer for download.

## Sources

- TZX format, revision 1.20, 19 December 2006 (Tomaz Kac, Martijn van der Heide, Ramsoft):
  https://worldofspectrum.net/TZXformat.html. Every block's layout, the rules for levels and pauses, the
  general extension rule (every block since 1.10 starts with a 32-bit length, how unknown blocks are skipped),
  the deprecated blocks 0x16, 0x17, 0x34, 0x40 (0x16 and 0x17's length field is described both as "of the
  whole block" and as following the extension rule; the length of their data, which they also carry, settles
  where they end), the hardware list (`describe.rs` carries it).
- CSW format, revision 2.00, 1 August 2003 (Ramsoft), with the old 1.01 header:
  https://k1.spdns.de/Develop/Projects/zxsp/Info/File%20Formats/CSW%20technical%20specifications.html (the
  original ramsoft.bbk.org page is gone). Z-RLE is the RLE stream through zlib's deflate: inflated with
  `miniz_oxide`'s zlib reader, a raw deflate stream accepted too.
- PZX file format version 1.0, 28 June 2007 (Patrik Rak): http://zxds.raxoft.cz/docs/pzx.txt. Blocks, the
  PULS decoding pseudocode, and the measured shape of the ROM's SAVE: the first sync high, each bit starting
  high, pulses varying by +1, −3 and −1 T-states at the first bit after the sync, of each byte and of the
  parity byte, and a 945 T-state tail.
- The Complete Spectrum ROM Disassembly (Ian Logan, Frank O'Hara, 1983), in Richard Dymond's annotated
  edition: https://skoolkid.github.io/rom/asm/04C2.html (SA-BYTES), https://skoolkid.github.io/rom/asm/0556.html
  (LD-BYTES) and https://skoolkid.github.io/rom/asm/05E3.html (LD-EDGE-1 and -2). The tests' models of both
  routines are written from these, instruction by instruction. (The disassembly gives 58 T-states for a pass
  of the sampling loop; its instructions add up to 59, which the model uses.)
- libspectrum's tape code (FUSE), https://sourceforge.net/p/fuse-emulator/libspectrum/ci/master/tree/ —
  `tape.c`, `tzx_read.c` — and FUSE's `tape.c`, which applies each edge as the pulse after it begins
  (https://sourceforge.net/p/fuse-emulator/fuse/ci/master/tree/tape.c) — read for comparison, not copied.
  Where they differ from the specification's rules as played here: a pause block (0x20) goes low at once, so a
  last pulse that was low before it gets no closing edge, where TZX asks for a millisecond of the opposite
  level first; a data block's own pause holds the closing level for the whole pause and goes low only as the
  next block begins, where TZX has it low after a millisecond; and an unknown TZX block is an error, where TZX
  1.10's rule lets it be skipped by its length.

## Tests

`nerd test tape` (`cargo test -p tape`): 69 tests in 6 files and 2 unit tests, about 1 s to run and 4 to 5 s
with the build. No wall clock anywhere: time is the T-states the tests count.

- `tests/common/mod.rs`: the machine's clock around the deck (frames ended as they pass); **LD-BYTES** modelled
  instruction by instruction with each one's T-states (uncontended; the port read 7 T-states into `IN A,(n)`);
  **SA-BYTES** likewise, giving the MIC line's edges; a generic two-pulse-bit loader for turbo blocks; a TZX
  writer for every block; the fixture loader, which prints `SKIPPED` straight to the terminal (past the test
  harness's capture) when a fixture cannot be had.
- `formats.rs` (29): every TZX block kind built to the spec, read back, and played: the exact T-state and level
  of every edge against the rules above (the standard block's every pulse, the polarities, the pause's
  millisecond, used bits, zero-length pulses, direct recording levels, CSW in RLE and Z-RLE to the T-state,
  generalized symbols' polarities and a four-symbol alphabet, loops, jumps, calls, stop, stop-if-48K on both,
  set level, information blocks taking no time, deprecated and unknown blocks skipped, a file cut short; the
  millisecond that ends the last pulse when the tape stops or ends, and the silence after);
  TAP read and written; CSW 1 and 2 files and their polarity; a CSW recording of a ROM block sampled at
  44.1 kHz loaded by LD-BYTES at the 128K clock; PZX's every block, its levels, and a PZX ROM block loaded by
  LD-BYTES, and a PAUS held through a STOP after it with no edge; the TZX specification's own generalized-block
  header (59 bytes, checksum 0xC1) loaded by LD-BYTES; every block's description.
- `rom_loading.rs` (11): TAP blocks loaded by LD-BYTES at 3.5 MHz and 3,546,900 Hz: headers, all-0, all-1,
  alternating, every value up and down, runs, 2,000 bytes of noise, one byte, another flag; four 6,912-byte
  screens (80 seconds of tape, thousands of frames) at both clocks; LD-BYTES started mid-pilot; a wrong flag
  refused and the next block loaded; timings 0.91–1.09 of the ROM's loaded, half-speed not; the ROM's own
  window of timings pinned (below); a block cut short failing as the ROM fails it; DE = 0; the pilot LD-BYTES
  needs (2,126 pulses fail, 2,127 load) and `pilot_found`'s shortest, at pilots of 1,952, 2,168 and 2,384 and
  both clocks, loading, within ten pulses of the ROM's need, and taken by the deck from that length only; a
  block with no pause loading when the tape stops or ends after it, the stopped tape silent.
- `saboteur.rs` (7): the TZX's and the TAP's blocks listed and described; every block's length to the T-state;
  the whole TZX played through at both clocks, LD-BYTES loading the six standard blocks (each header asking for
  its data) and the turbo loader its four, every byte matched; the TAP likewise; all 837,508 edges at 128K
  equal to the 48K's ×5067/5000 (the count derived from the blocks); instant loading taking blocks 1–4, leaving
  the turbo blocks to be played and read, then taking 9 and 10.
- `deck.rs` (15): 10,000 edges at 128K across frames each at `floor(k × 2168 × 5067/5000)`; every edge heard
  by `edges_until` between reads of the port and across frames; stop and play, the line silent while stopped
  in a high pulse and that pulse going on after;
  times asked again or earlier; seek, rewind, the end; the status's every field; a clock changed mid-tape;
  instant loading of TAP, of info and stop blocks passed, of ROM-timed 0x11 and not turbo, of 0x12+0x13+0x14,
  of 0x19 both ways round, of PZX (two blocks with a PAUS between), mid-pilot and not mid-data, the tape left
  at the taken block's pause, and a block loaded by LD-BYTES from the edges after one is taken; eight blocks
  the ROM's shape in all but one thing (pilots of 1 and 100 pulses, edgeless bits or pilot in a 0x19, a short
  0x11 and a short 0x12, a PZX DATA starting at the sync's level, a PZX sync joined by a zero pulse) that
  the LD-BYTES model fails on and the deck does not take, and three it loads that the deck takes; a loader
  that waits a second after two taken blocks and then reads the third with its own LD-BYTES, which loads.
- `recorder.rs` (6): the SA-BYTES model's pulses equal PZX's measurements of the ROM's (2,168; 667, 735; 1,711
  and 856 first; −3 for each byte; −1 for the parity; 945 tail); a SAVE of a header and a screen recorded at
  both frame lengths, with up to 6 T-states of contention on each edge; every byte value; what is recorded
  loads back through LD-BYTES at both clocks; sound on the MIC line makes no block; three SA-BYTES calls one
  straight after another (60 T-states between) recorded as three blocks, at both frame lengths, with jitter.
- `cli.rs` (1): the `tape` command's three subcommands.
- Unit tests in `src/text.rs`: names in the Spectrum's character set, Latin-1.

## Measured

- **What LD-BYTES accepts** (the model, each timing varied alone in steps of 4 T-states, a 300-byte block):

  | timing (ROM's) | at 3.5 MHz | at 3,546,900 Hz |
  |---|---|---|
  | pilot (2,168) | 1,792–3,368 (and some of 1,720–1,784, where the edge loop beats with the pulse) | 1,828–3,320 (some of 1,696–1,820) |
  | sync 1 (667) | 168–1,072 | 168–1,048 |
  | sync 2 (735) | 184–3,448 | 184–3,380 |
  | 0 bit (855) | 488–1,236 | 484–1,220 |
  | 1 bit (1,710) | 1,272–2,772 | 1,256–2,736 |

  So the ROM's 0/1 threshold is about 1,250 T-states a pulse (Logan and O'Hara: "approx. 2,400" for the pair),
  and a tenth either side of every timing, the instant load's test, is well inside.
- Saboteur's TZX: 11 blocks, 238.966 s, 837,508 edges; its TAP: 8 blocks, 290.055 s.
- Speed (release build, this machine): `level_at` about 4 ns a call, asked every 50 T-states through the whole
  of Saboteur at 128K, edges included; `next_edge` about 37 ns an edge; a `Player` for Saboteur made in 0.1 ms.

## Limits

What is no tape, however it parses, is refused rather than built: a file of anything can need memory without end,
and the browser's machine never gives memory back (an engineer's review loaded 1 MB of zeros as half a million TAP
blocks, and a 64 KB CSW that inflated to 1.15 GB).

- **A TAP block of no bytes** (not even the flag) is nothing SA-BYTES ever wrote: it is left out, with a warning, so a
  file of zeros (whose lengths add up exactly) is no TAP.
- **`MAX_BLOCKS`, 8,192 blocks**, in TAP, TZX and PZX alike, checked as they are read: the longest real tapes
  (compilations, Bleepload's many small blocks) have a few hundred.
- **CSW**: Z-RLE inflates to 16 MB at most (`INFLATE_LIMIT`), and a recording holds **`MAX_PULSES`, 8,388,608
  pulses**, three quarters of an hour at the densest loaders' rate (a whole side of a 128K multi-load is a few
  million); the pulses are allocated once, as many as there can be, rather than doubling to their last.

`tests/formats.rs` holds each: zeros refused, empty blocks left out and said, 8,193 blocks refused in TAP and TZX
(8,192 taken), a CSW of 12 million pulses in 12 KB refused, one that inflates past 16 MB refused as it inflates, a
player and its clone sharing their tape. (The machine refuses files over 16 MB, and a tape with nothing on it to play:
docs/machine.md.)

## Known gaps and choices

- `take_rom_block`, `play`, `stop`, `rewind` and `seek` take the frame's T-state `t`, which docs/architecture.md
  leaves out: the tape's time carries on from that moment exactly. The rest is as the architecture says.
- The LD-BYTES and SA-BYTES models are uncontended. Port 0xFE's contention moves a sample by up to 6 T-states,
  which the recorder's test adds as jitter; the machine's contention is the `spectrum` crate's.
- Instant loading does not decode CSW or direct recordings of standard blocks; they play.
- A generalized block's pilot symbol with no pulses is skipped whole, its polarity flag with it (it could only
  change the level for no time); in the data such a symbol's polarity is applied, for no time.
- Instant loading takes a block whose pilot is playing however little of it is left. The real LD-BYTES needs
  about 1.3 s of pilot from when it begins to listen, and would miss a block whose pilot is nearly over (and
  look for the next); the deck gives the person the block they were loading.
- A tape stopped by `stop` (the person's, or the machine's automatic stop) is silent at once; no edge is
  handed to `edges_until` for that, or for the pulse it stood in when it plays again.
- PZX PAUS is played as a steady level, without the noise the specification allows.
- The recorder reads the ROM's SAVE (and anything at its speed); a turbo saver's blocks are not decoded.
- No TZX or PZX writer: what is saved comes out as TAP, which is all the ROM makes.
- `set_clock` re-anchors at the last time the deck was asked about, to within a T-state.
- Only TZX major version 1 and PZX major version 1 are read, as their specifications ask.
