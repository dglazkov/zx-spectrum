# Snapshots and zips: `crates/snapshot` and `crates/unzip`

Two crates that know nothing of the machine:

- **`snapshot`** is the Spectrum at an instant, neutral of any file format (`Snapshot`), and the formats it comes
  in: `.z80` (versions 1, 2 and 3, and the `.slt` extension), `.sna` (48K and 128K) and `.szx` (zx-state), each
  read and written, plus `.scr` screen dumps, read.
- **`unzip`** reads ZIP archives as the archive hands most files out (`Saboteur.tzx.zip`), and picks out the
  entries a Spectrum can load, by name and by content.

Both are pure Rust, depending on `miniz_oxide` (inflate and deflate, and zlib for `.szx`) alone, so that they build
for WebAssembly as they are.

## What they do

### `snapshot`

```rust
pub fn load(bytes: &[u8]) -> Result<Snapshot, Error>          // any of the three, known by content and size
pub fn detect(bytes: &[u8]) -> Option<Format>                  // Format::{Z80, Sna, Szx}
pub fn load_z80(&[u8]) / load_sna(&[u8]) / load_szx(&[u8]) -> Result<Snapshot, Error>
pub fn save_z80(&Snapshot) -> Vec<u8>                          // version 3
pub fn save_sna(&Snapshot) -> Result<Vec<u8>, Error>           // 48K or 128K; can refuse (below)
pub fn save_szx(&Snapshot) -> Vec<u8>                          // version 1.5, RAM zlib-compressed
pub fn save(&Snapshot, Format) -> Result<Vec<u8>, Error>
pub fn load_scr(bytes: &[u8]) -> Result<Box<Screen>, Error>    // the 6,912 bytes for 4000h
```

`Snapshot` holds: `model` (`Spectrum16`, `Spectrum48`, `Spectrum128`, `Plus2`, `Plus2A`, `Plus3`, `Pentagon128`);
`regs` (this crate's own `Registers`: AF, BC, DE, HL, the alternate set, IX, IY, SP, PC, I, all eight bits of R,
IFF1, IFF2, IM, `memptr: Option<u16>`, `halted`, `interrupts_suppressed` (the EI delay), `flags_set` (Q = F));
`tstates` into the frame; `port_fe` (border in bits 0–2, MIC and EAR in 3 and 4); `ram`, sixteen-K banks indexed
by bank number (`[Option<Box<Bank>>; 8]`: a 48K is banks 5, 2, 0 at 4000h, 8000h, C000h, a 16K bank 5 alone, the
others all eight); `port_7ffd`, `port_1ffd`; `ay: Option<Ay>` (selected register, sixteen registers, and whether it
is built in, a Melodik, or a Fuller Box); `issue2`; `joystick: Option<Joystick>` (Kempston, Sinclair 1 and 2,
Cursor, Fuller); `late_timings`; `trdos_paged`; `custom_rom`; `tape` (a tape file embedded in a `.szx`, with the
block its head is at); `slt` (level data and loading screen). `Snapshot::new(model)`, `bank`, `paged_bank(slot)`,
`peek`, `poke`, `screen()` (bank 5's, or bank 7's when 7FFDh bit 3 shows it) and `border()` help build and read
one; `Model` gives `frame_tstates`, `banks`, `is_128k`, `has_1ffd`, `interrupt_tstates`.

What a machine has to know to restore one:

- **T-states** count from the moment the ULA raised INT, and are always less than the model's frame. A format that
  does not keep them (`.sna`, `.z80` before version 3) gives 0, at which INT is active: if IFF1 is set the
  interrupt is taken at once, as it would be at the top of any frame.
- **Halted**: PC is the address of the HALT itself (Fuse's convention, and so that of the `.szx` files Fuse
  writes). The formats without the flag leave PC at the HALT, which runs again and comes to the same.
- **MEMPTR** is `None` unless the file is a `.szx` of version 1.4 or later; the specification writes 0 for "not
  supported", which reads as `None` too.
- **Joystick** is what the snapshot's emulator had set up: a hint, not hardware state. `.z80`'s byte 29 always
  names one (0 is the cursor joystick).
- **Super level loader** data: the program loads level `A` to the address in `HL` by executing `ED FB`, which is no
  Z80 instruction but the emulator's trap (Fuse: `z80.pl`'s `slttrap`, `slt.c`'s `slt_trap(HL, A)`). A machine that
  wants these games implements the trap from `Snapshot::slt.levels`.

### `unzip`

```rust
pub fn is_zip(data: &[u8]) -> bool
pub fn spectrum_files(zip: &[u8]) -> Result<Vec<SpectrumFile>, Error>   // SpectrumFile { index, name, kind, data }
impl<'a> Archive<'a> {
    pub fn new(data: &'a [u8]) -> Result<Archive<'a>, Error>
    pub fn entries(&self) -> &[Entry]                                    // name, raw_name, method, sizes, crc32, flags, modified, comment
    pub fn find(&self, name: &str) -> Option<&Entry>
    pub fn extract(&self, entry: &Entry) -> Result<Vec<u8>, Error>
    pub fn spectrum_files(&self) -> Result<Vec<SpectrumFile>, Error>
    pub fn comment(&self) -> &str
}
pub enum Kind { Tzx, Tap, Csw, Pzx, Z80, Sna, Szx, Scr, Dsk, Trd, Scl }  // from_name, sniff, extension, is_tape...
pub fn classify(name: &str, data: &[u8]) -> Option<Kind>
pub fn crc32(data: &[u8]) -> u32
```

The central directory is the authority on each entry: its method, sizes and CRC are final even when the local
header left them to a data descriptor, so descriptors (with or without their signature) need no reading. Every
entry is checked against its size and CRC-32 as it is extracted, and inflated no further than its stated size.
Names are UTF-8 where bit 11 says so or Info-ZIP's Unicode Path field (0x7075) gives one whose CRC still matches;
UTF-8 from a Unix or macOS archiver that did not say so; code page 437 otherwise. Zip64 records and a stub before
the archive (a self-extractor) are read. Refused, by name and cleanly: encrypted entries, methods other than stored
and deflated, archives split over several disks.

`spectrum_files` picks entries by content where the content is conclusive (the signatures of TZX, PZX, CSW, SZX,
DSK and SCL; a TAP's chain of blocks ending exactly at the end with a good first checksum; a `.z80`'s header and
page chain; a compressed version 1 `.z80`'s end marker; a TR-DOS disk's system sector), then by extension, then by
an exact size (49,179 bytes is a `.sna`, 6,912 a screen) unless the name says it is a document or picture. Mac
resource forks (`__MACOSX/`, `._name`) and directories are left out. An entry whose name says it is a Spectrum file
but that is damaged or encrypted is an error, not quietly missing.

## Sources

- **.z80**: "Z80 File Format", comp.sys.sinclair FAQ on World of Spectrum,
  <https://worldofspectrum.org/faq/reference/z80format.htm> (`$Id: z80format.htm,v 1.12 2004/07/05`), from Gerton
  Lunter's documentation of his emulator Z80: both headers byte by byte, the compression and its rules ("every byte
  directly following a single ED is not taken into a block"), the version 1 end marker, the hardware modes and
  how they differ between versions 2 and 3, the extensions (modes 7 to 15 and 128), byte 37's bit 7 ("any 48K
  machine becomes a 16K machine, any 128K machines becomes a +2 and any +3 machine becomes a +2A"), the T-state
  counter, the page numbering. Its successor on the Sinclair Wiki, <https://sinclair.wiki.zxnet.co.uk/wiki/Z80_format>,
  restates the compression.
- **.sna and .slt**: "File Formats", comp.sys.sinclair FAQ on World of Spectrum,
  <https://worldofspectrum.org/faq/reference/formats.htm>: the 48K header, PC on the stack and Rui Ribeiro's note on
  the two bytes under SP, the 128K extension and the order of its banks; Damien Burke's super level loader table.
- **.szx**: "The zx-state File Format 1.5" by Jonathan Needle, Spectaculator's author (the task named Spin's author;
  zx-state is Spectaculator's format, which Spin and Fuse also write),
  <https://www.spectaculator.com/docs/zx-state/intro.shtml> and its pages `basic_info.html`, `header.html`,
  `block.html`, `creator.html`, `z80regs.html`, `specregs.html`, `rampage.html`, `ay.html`, `keyboard.html`,
  `joystick.html`, `custom_rom.html`, `cassette_recorder.html` and `version.html` under
  <https://www.spectaculator.com/docs/zx-state/>.
- **The de facto reader**, for what the documents leave open: libspectrum, Fuse's library (GPL; read, not copied),
  <https://github.com/speccytools/libspectrum> (`z80.c`, `sna.c`, `szx.c`): its T-state arithmetic, its reading of
  Spectaculator's extensions, the CRTR check for libspectrum ≤ 0.5.0's swapped AF, the 128K `.sna` read; and Fuse,
  <https://github.com/speccytools/fuse> (`z80/z80.pl`, `slt.c`), for the `ED FB` level trap and the HALT convention.
- **ZIP**: PKWARE's APPNOTE.TXT, version 6.3.10, <https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT>:
  the records (4.3.7–4.3.16), the flag bits (4.4.4), Zip64 (4.5.3), the Unicode Path field (4.6.9), the character
  sets (appendix D).
- **TR-DOS images**: "TR-DOS flat-file disk image", <https://formats.kaitai.io/tr_dos_image>: the system sector's
  identifier 10h at E7h and disk types 16h–19h at E3h.
- **The archive**: the ZXInfo API over ZXDB, <https://api.zxinfo.dk/v3/>, to find games listed as Available whose
  files are snapshots, and the files themselves from <https://spectrumcomputing.co.uk/pub/sinclair/> and
  `/zxdb/sinclair/`.

## Choices where the documents are silent

- **Version 1 end marker**: decoding stops at 49,152 bytes and takes the marker if it follows; a file without it
  still reads (every one of the 109 compressed version 1 files in the survey has it).
- **A page stored with its true length** (4000h) rather than FFFFh, which some writers did, is taken raw when it
  does not decompress to 16K.
- **A low T-state counter larger than a quarter frame** (4 of the 117 version 3 files surveyed) is read with the
  documented sum, t = (q + 1) × quarter − (low + 1), which counts back into an earlier quarter, as Fuse reads it; a
  sum outside the frame gives 0.
- **Version 3's "user defined" joystick** is read as Sinclair 1, Sinclair 2 or Cursor when its five keys are
  exactly theirs by the documentation's half-row and mask (`'1'` is 0x0103, Enter 0x0106, 'g' 0x1001, as the
  documentation gives them and as real files have them), and as none otherwise (a game's own keys, O P Z A 5, are
  no joystick's). Fuse writes Interface 2's left port with masks of its own (0x0F03, 0x0803, 0x0403, 0x0203, 0x0103
  for left, right, down, up, fire; its ASCII words '1' to '5') and reads those back as that joystick, and so does
  this. Sinclair 2 is written with the documentation's masks.
- **Writing a 16K, +2 and +2A** uses byte 37's bit 7 over the extension modes 12 and 13, as Spectaculator did, so
  that a reader that does not know the bit still finds the nearest machine it does (48K, 128K, +3). A 16K is
  written with a 48K's three pages.
- **What `.z80` cannot model**: Interface 1, M.G.T. and SamRam snapshots are read as the 48K or 128K they run on
  (their ROM pages, page 1 and SamRam's shadow pages, skipped); the Multiface's page 11 is skipped. Timex machines,
  the Scorpion and the Didaktik are refused by name (`Error::Unsupported`).
- **128K .sna** is taken as a Spectrum 128 (Fuse takes it as a Pentagon); the TR-DOS byte is kept as
  `trdos_paged`. When the paged bank is 5 or 2 the file has it twice; the first copy, in the bank's own place, is
  kept (Fuse refuses a file whose two copies differ). A file whose length does not fit its paging is refused.
- **48K .sna**: the two bytes PC was pushed to keep it after loading, as after the RETN the format was made for
  (zeroing them, Ribeiro's suggestion, is a guess, and is not made). Writing pushes PC into the file's RAM, not the
  snapshot's, and refuses a stack whose push would land in ROM (SP 4000h, 4001h, or below) or, on a 16K, above
  8000h. IFF1 is IFF2 on reading. Written back, a `.sna` from the archive is the very file, but for header bytes
  19 and 26 where its writer set bits the format does not use.
- **.szx**: a 48K's AY block with neither the Fuller nor the Melodik flag is no AY; with the Melodik flag, as 17
  of the survey's 20 48K files have it (SpecEmu, Spectaculator, Spin and Fuse all wrote their "AY in 48K mode"
  setting so), the snapshot says a Melodik is attached, and whether to attach one is the machine's choice; a
  T-state past the frame's end is that far into the next frame; a missing RAM page is zeros; a page
  number above 7, a page twice, a page that does not inflate to 16K are refused. The +3e and 128Ke are read as the
  +3 and 128 (they differ in ROM only), the NTSC 48K as a 48K. The writer clears the AY register bits the chip does
  not have, as the specification asks. What the specification restricts, both reader and writer restrict: the
  alternate timings flag counts on the 16K, 48K and 128K alone, KEYB's Issue 2 on the 16K and 48K alone (some 128K
  `.z80` files have Issue 2 set, which goes no further than `.z80`); Z80R's HALTED and SUPPRESS_INTS "are mutually
  exclusive", and a file with both is read as halted, as the writer writes it. A ROM block is the model's ROMs end to
  end, 16K, 32K (128K, +2, Pentagon) or 64K (+2A, +3), and one of another size is refused, as Fuse refuses it (and
  is inflated no further than that size); a snapshot whose `custom_rom` is not that size is written without it.
- **Telling the formats apart**: a `.szx` by its signature; then a `.z80` whose pages run exactly to the end of the
  file (or whose version 1 data decompresses to just before the end marker that ends it); then a `.sna` by its
  size; then a `.z80` by its header. A compressed `.z80` can be any length, a `.sna`'s among them, and its structure
  says more than a length does; unzip's `Kind::sniff` takes the same order.
- **.scr**: 6,912 bytes; also 6,144 (bitmap alone, attributes 38h) and 6,976 (ULAplus, its palette left);
  Timex hi-colour and hi-res dumps are refused.

## How it is tested

`nerd test snapshot` runs `cargo test -p snapshot -p unzip` (69 tests, about 4 seconds once built):

- **The compression** (`rle.rs`): the documented cases (five equal bytes coded, four not; ED ED as ED ED 02 ED; ED
  and six zeros as ED 00 ED ED 05 00); runs over 255 (256, 259, 300; 256 and 257 EDs, where the one left over is a
  single ED whose next byte is then left alone); every sequence of up to seven bytes from {00, ED, 01} round-trips
  and never puts a code after a single ED; the version 1 end marker present, absent and followed by more; a run
  overshooting 48K; codes cut short.
- **.z80** (`z80/tests.rs`): a version 1 header with every register distinct, compressed and not, byte 12 at FFh,
  each joystick; every hardware mode in both versions with and without bit 7 (38 cases, including the refused ones);
  the T-state counter at every quarter's edges in every model, the documented 17471 and 17726, and from a file;
  the AY on a 48K (Melodik, Fuller); 1FFDh in a 55-byte header, written back; what the writer puts in the header for
  each model; the user-defined joystick, and Fuse's keys for Interface 2; ROM, Multiface, duplicate, unknown,
  missing and uncompressed pages; super level loader data, round-tripped, with an entry of another type skipped and
  damage refused; a version 3 file of exactly a 128K `.sna`'s length and a version 1 file of a 48K `.sna`'s, both
  told for `.z80`s.
- **.sna** (`sna.rs`): the 48K header field by field and PC on the stack; SP at 0000h, 4002h, and the values whose
  push or pop would touch ROM; IFF2 into both flip-flops; a 16K written as a 48K; the 128K layout for each of the
  eight paged banks; a doubled bank whose two copies differ; a length that does not fit the paging.
- **.szx** (`szx/tests.rs`): a 1.5 file with every field; 1.0, 1.3 and 1.4 files' fewer fields; libspectrum
  ≤ 0.5.0's swapped AF; the AY, KEYB, JOY, ROM and TAPE blocks (embedded and linked); unknown blocks skipped; every
  machine identifier; each kind of damage; what the writer writes; the flags and blocks the specification
  restricts to some models (HALTED with SUPPRESS_INTS, the alternate timings, Issue 2, the ROM block's size).
- **All of it** (`tests.rs`): every model through each writer and back (`.z80` and `.szx` give back exactly what
  they keep, `.sna` what it keeps); what each format loses; the formats told apart; damaged files (each writer's
  output cut at hundreds of lengths and with bytes changed, every one of the first 128 header bytes set to six
  values) never panic, and a cut file is never read as whole; the paging, including the +3's four all-RAM
  arrangements.
- **Random damage** (`tests/fuzz.rs`): 5,000 damaged files from a fixed seed (bits flipped, fields set to extremes,
  run codes spliced in, bytes inserted, removed, cut off), made from each writer's file for every model with level
  data, a custom ROM, an embedded tape and the CPU's flags, a version 1 file compressed and raw, and seven of the
  real files. Every reader answers or refuses, never panics; whatever is read has its model's banks and no others, a
  T-state inside the frame, IM 0 to 2, an AY exactly where the model has one built in, ports its model has, a ROM
  of its model's size; and each writer's file is told for what it is, by `detect` and by unzip's sniffer, and
  reads back as what that format keeps (exactly, for `.z80` and `.szx`). It found a `.szx` whose Z80R had both
  HALTED and SUPPRESS_INTS read with both and written with one; since that was mended, 40,000 from each of two
  seeds have found nothing.
- **unzip** (`src/tests.rs`): archives built byte by byte: stored and deflated, data descriptors with and without
  their signature, names in code page 437, flagged UTF-8, unflagged Unix UTF-8 and the Unicode Path field (and a
  stale one ignored), a prepended stub and a comment, Zip64, an empty archive, every byte changed in turn and every
  prefix (no panic), a wrong CRC and wrong sizes, encryption and bzip2 refused by name, `spectrum_files` by name and
  by content (a TZX named `.tap`, a TAP with no name, screens by size but not a text file of that size, Mac
  resource forks), each kind sniffed, entries inflating to exactly their size; a Zip64 offset near 2^64 behind a
  stub, whose sum with the stub's length overflowed (a panic in a test build, a wrong offset in a release one) and
  is now refused as damage; and 20,000 archives of every shape damaged at random from a fixed seed, never a panic.
- **Real files**, fetched by `scripts/fixture` and pinned by hash (a test whose fixture cannot be fetched prints
  `SKIPPED` and checks nothing): twenty snapshots, one of each version, model and writer the archive has (version 1
  compressed and raw; version 2 48K, 128K in mode 3, Pentagon stored uncompressed, +2 by bit 7; version 3 48K,
  128K, 128K with the out-of-range counter, +2 by mode 12, +3 with 1FFDh, a TC2048 refused; 128K `.sna` with bank 7
  and bank 0 paged; zx-state 1.3, 1.4 and 1.5 from SpecEmu, Spectaculator and Fuse; two `.slt`), each checked for
  model, PC, SP, AF, T-state, border, 7FFDh and every bank's CRC-32, and written in each format and read back;
  a 48K `.sna` taken out of its zip and written back byte for byte; the two `.slt` files' levels and screen;
  Saboteur's loading screen. For unzip: Saboteur's TZX archive (both sides, the first the same file as the tape's
  own fixture), an archive with a data descriptor, one with a code page 437 name, and one of nine entries with
  directories, stored GIFs and Word documents beside two snapshots.

The expected values of the real files were not taken from this crate: they come from a second reader, written
separately from the same documents in Python, which reads model, registers, T-state, ports and banks.

### The survey

To find what real files hold, 589 zips were taken from the archive: 451 of every snapshot of available games in
the first 10,000 ZXDB entries (all the `.sna`, `.szx` and `.slt`, and 320 `.z80` chosen at random), and 138 tape and
disk archives. The tools that did it are in the crates (below).

- **ZIP**: all 589 read, all 707 entries extract with the right size and CRC. 696 are deflated and 11 stored; no
  other method appears. One entry has a data descriptor; one name is code page 437 non-ASCII; the archivers were
  MS-DOS (host 0) and Unix (host 3) ones, with extra fields 5455h, 7855h, 7875h and 000Ah. Of the 660 Spectrum
  files among them (332 `.z80`/`.slt`, 104 `.sna`, 22 `.szx`, 59 `.scr`, 62 `.tzx`, 42 `.tap`, 15 `.dsk`, 15
  `.trd`, 8 `.scl`, 1 `.pzx`), every one is told by its content alone, and no content contradicts a name.
- **Snapshots**: 458 in those zips: 332 `.z80` (6 of them `.slt`): 110 of version 1 (109 compressed, all with the
  end marker; 1 raw), 105 of version 2, 117 of version 3 (one with the 55-byte header); 94 48K and 10 128K `.sna`;
  22 `.szx` (7 of version 1.3, 12 of 1.4, 3 of 1.5). Hardware modes seen: version 2's 0, 1, 3, 3 with bit 7, 4, 4 with bit 7, 9; version 3's 0,
  1, 3, 4, 5, 6, 7, 12, 14. All load but one, a TC2048 (mode 14), refused by name. All 457 agree with the separate
  Python reader on model, PC, SP, AF, T-state, border, 7FFDh and the CRC of every bank, and all go through each
  writer and back. 71 of the 104 `.sna` are rewritten byte for byte; 25 differ in byte 19 alone (their writers set
  every bit of the interrupt byte, not just bit 2) and 8 in byte 26 alone (bits above the border's).
- **Screens**: each snapshot's screen was drawn to a PNG and looked at; a wrongly read snapshot shows garbage
  there, and none did.
- **A second sample**, taken by the review from the 951 `.z80` zips of the same list that the survey left out (260
  zips at random, seed 20261008; 262 snapshots: 92 of version 1, 94 of version 2 including 4 Pentagon and 2 +2, 76
  of version 3): all load, all go through each writer and back, and their screens, looked at on contact sheets, are
  all the games' own. Three have a user-defined joystick of a game's own keys (O P Z A 5, 1 3 SPACE SPACE 0), read
  as none. The survey's 458 read the same after the review's changes as before them.

### Tools

- `cargo run -p snapshot --example snapinfo -- [--png DIR] [--roundtrip] [--convert z80|sna|szx DIR] FILE...`:
  each snapshot (or each in a zip) as a line of JSON (format and version, model, registers, T-state, ports, each
  bank's CRC), or its error; its screen as a PNG; whether it survives each writer; converted to another format.
- `cargo run -p unzip --example zipinfo -- FILE.zip...`: each entry as a line of JSON (method, sizes, whether it
  extracted and checked, the kind `spectrum_files` takes it for, the kind its content alone says), and a summary.

## Known gaps

- The super level loader's `ED FB` trap is the machine's to implement; this crate only carries the levels.
- `.z80` keeps no custom ROM here (its ROM pages are skipped); `.szx` does, in its ROM block.
- Peripherals' state is not read: Interface 1 and its microdrives, the +3's disk drive, the Multiface, the
  Beta 128, the AMX mouse, the printer and the rest of `.szx`'s blocks are skipped by their lengths; `.szx`'s DOCK
  and the Timex registers have no model to go to.
- Models not represented: the Timex TC2048, TC2068 and TS2068, the Scorpion ZS-256, the Didaktik Kompakt, the
  Spectrum SE, and the Pentagon 512 and 1024 are refused; the NTSC 48K is read as a PAL one.
- A version 3 `.z80`'s user-defined joystick whose keys are no joystick's (a game's own keys) is read as no
  joystick: `Snapshot` has no place for an arbitrary mapping.
- `Model::interrupt_tstates` (used only for zx-state's chHoldIntReqCycles, which libspectrum does not read) gives 36
  for the whole 128K family and 32 for the Pentagon; libspectrum's timings give 32 for the +2A/+3 and 36 for the
  Pentagon, and Unreal Speccy 32 for the Pentagon. A machine should take its interrupt length from its own
  timings, not from here.
- `.szx`'s linked tape (a file name on the writer's disk) is not followed; nor is any tape in `.z80` or `.sna`,
  which have none.
- ZIP methods other than stored and deflated (none in the survey), encryption and spanned archives are refused.
