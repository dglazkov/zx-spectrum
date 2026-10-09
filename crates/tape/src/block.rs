//! What a tape is made of: its blocks, as the formats define them.
//!
//! One enum holds the blocks of every format, so that the player and the page deal with a single kind of
//! thing. A TAP block is a [`Block::Standard`] with a pause of one second, as a TZX block 0x10 is; a CSW file
//! is a single [`Block::Csw`]; PZX's blocks have variants of their own where TZX has nothing that means the
//! same (PZX's STOP becomes [`Block::Pause`] of 0 ms or [`Block::StopIf48k`], which mean what it means).
//!
//! Timings are in T-states of a 3.5 MHz clock, as both TZX and PZX define them; the [`crate::Player`] scales
//! them to the machine's clock.

/// One block of a tape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Block {
    /// A block at the ROM's own timings: a TAP block, or TZX block 0x10. `data` is the block as LD-BYTES
    /// reads it: the flag byte, the bytes, and the parity byte last.
    Standard { data: Vec<u8>, pause_ms: u16 },
    /// TZX 0x11: a pilot, two sync pulses and data, at timings of its own.
    Turbo(Turbo),
    /// TZX 0x12: `count` pulses of `pulse` T-states each.
    PureTone { pulse: u16, count: u16 },
    /// TZX 0x13: pulses of the lengths given, in T-states.
    Pulses(Vec<u16>),
    /// TZX 0x14: data alone, with no pilot or sync.
    PureData(PureData),
    /// TZX 0x15: the EAR level sampled, a bit a sample.
    DirectRecording(DirectRecording),
    /// TZX 0x18, or a CSW file: pulses measured in samples.
    Csw(Csw),
    /// TZX 0x19: pilot, sync and data as sequences of symbols, each symbol a sequence of pulses.
    Generalized(Generalized),
    /// TZX 0x20: silence for `ms` milliseconds; 0 stops the tape.
    Pause { ms: u16 },
    /// TZX 0x21: the start of a group of blocks, with its name.
    GroupStart(String),
    /// TZX 0x22: the end of a group.
    GroupEnd,
    /// TZX 0x23: go on from the block this many blocks away (1 is the next).
    Jump(i16),
    /// TZX 0x24: play the blocks up to the loop's end this many times.
    LoopStart(u16),
    /// TZX 0x25: the end of a loop.
    LoopEnd,
    /// TZX 0x26: play the sequences starting at these offsets, each until a [`Block::Return`], then go on.
    Call(Vec<i16>),
    /// TZX 0x27: the end of a called sequence.
    Return,
    /// TZX 0x28: the parts of the tape a person may choose to load.
    Select(Vec<Selection>),
    /// TZX 0x2A, or PZX STOP with flags 1: stop the tape if the machine is a 48K.
    StopIf48k,
    /// TZX 0x2B: the signal level from here on (true is high).
    SetLevel(bool),
    /// TZX 0x30: a line of text about this part of the tape.
    Text(String),
    /// TZX 0x31: a message to show for `seconds` (0: until a key is pressed).
    Message { seconds: u8, text: String },
    /// TZX 0x32: the title, publisher, authors, year and the rest, each with the TZX's identification byte.
    ArchiveInfo(Vec<(u8, String)>),
    /// TZX 0x33: the machines and hardware the tape runs on or uses.
    Hardware(Vec<HardwareInfo>),
    /// TZX 0x35: information for some program, under a 16-character identifier.
    CustomInfo { id: String, data: Vec<u8> },
    /// TZX 0x5A: the header of another TZX file, left where two were joined.
    Glue,
    /// A TZX block that carries no signal for a Spectrum: the deprecated 0x16 and 0x17 (Commodore 64
    /// data), 0x34 (emulation info) and 0x40 (a snapshot), or an ID the format does not define, skipped by the
    /// length that TZX 1.10 and later guarantee. `len` is the bytes skipped after the ID.
    Skipped { id: u8, len: usize },
    /// PZX PZXT: the file's version and its title and other information as key and value.
    PzxHeader {
        major: u8,
        minor: u8,
        title: String,
        info: Vec<(String, String)>,
    },
    /// PZX PULS: pulses, the first one low.
    PzxPulses(Vec<PzxPulse>),
    /// PZX DATA: bits, each as a sequence of pulses, from a level given, with a tail pulse after.
    PzxData(PzxData),
    /// PZX PAUS: the given level held for the given duration (and after it, until a block states its own).
    PzxPause { duration: u32, high: bool },
    /// PZX BRWS: a point on the tape worth winding to, with what it is.
    Browse(String),
}

/// TZX block 0x11: a block at timings of its own (in 3.5 MHz T-states).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turbo {
    pub pilot: u16,
    pub sync1: u16,
    pub sync2: u16,
    pub zero: u16,
    pub one: u16,
    pub pilot_pulses: u16,
    /// How many bits of the last byte are played, from its most significant (1 to 8).
    pub used_bits: u8,
    pub pause_ms: u16,
    pub data: Vec<u8>,
}

/// TZX block 0x14: data with no pilot or sync.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PureData {
    pub zero: u16,
    pub one: u16,
    pub used_bits: u8,
    pub pause_ms: u16,
    pub data: Vec<u8>,
}

/// TZX block 0x15: the EAR level a sample at a time, most significant bit first, 1 high.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirectRecording {
    pub tstates_per_sample: u16,
    pub pause_ms: u16,
    /// How many samples of the last byte are played (1 to 8).
    pub used_bits: u8,
    pub data: Vec<u8>,
}

/// Pulses measured in samples at `sample_rate`: TZX block 0x18, or a whole CSW file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Csw {
    pub sample_rate: u32,
    /// Each pulse's length in samples; the level changes between pulses.
    pub pulses: Vec<u32>,
    pub pause_ms: u16,
    /// The level of the first pulse, which a CSW file states and TZX block 0x18 leaves to the level the tape
    /// is at (`None`).
    pub initial: Option<bool>,
}

/// TZX block 0x19, the generalized data block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Generalized {
    pub pause_ms: u16,
    /// The pilot and sync alphabet.
    pub pilot_symbols: Vec<Symbol>,
    /// The pilot and sync as runs: a symbol of the alphabet, and how many times it is repeated.
    pub pilot: Vec<(u8, u16)>,
    /// The data alphabet.
    pub data_symbols: Vec<Symbol>,
    /// How many symbols the data stream holds.
    pub data_count: u32,
    /// How many bits of the stream make one symbol: the smallest n with 2^n at least the alphabet's size.
    pub bits_per_symbol: u8,
    /// The data stream, symbols packed most significant bit first.
    pub data: Vec<u8>,
}

/// A symbol of a generalized data block: how it begins, and its pulses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Symbol {
    /// The level of its first pulse: 0 the opposite of the level before it (an edge), 1 the same (no edge),
    /// 2 low, 3 high.
    pub polarity: u8,
    /// The lengths of its pulses (the table's zero that ends a shorter symbol is not kept).
    pub pulses: Vec<u16>,
}

/// One choice of a TZX select block (0x28).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    /// The block it starts at, relative to the select block.
    pub offset: i16,
    pub text: String,
}

/// One entry of a TZX hardware type block (0x33).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HardwareInfo {
    /// The kind of hardware (0 computers, 1 external storage, 3 sound devices, 4 joysticks, ...).
    pub kind: u8,
    /// Which one of that kind.
    pub id: u8,
    /// 0 runs on it, 1 uses it, 2 runs but does not use it, 3 does not run on it.
    pub info: u8,
}

/// One entry of a PZX pulse sequence: a pulse of `duration` T-states, `count` times.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PzxPulse {
    pub count: u16,
    pub duration: u32,
}

/// PZX DATA.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PzxData {
    /// The level of the first pulse.
    pub initial_high: bool,
    /// How many bits are played, most significant of each byte first.
    pub bits: u32,
    /// A last pulse after the bits (0: none).
    pub tail: u16,
    /// The pulses that make a 0 bit, and a 1 bit.
    pub zero: Vec<u16>,
    pub one: Vec<u16>,
    pub data: Vec<u8>,
}

/// The ROM's own timings, in T-states, and what it saves (SA-BYTES at 0x04C2) and loads (LD-BYTES at 0x0556).
pub mod rom {
    /// A pilot pulse.
    pub const PILOT: u16 = 2168;
    /// The two sync pulses.
    pub const SYNC1: u16 = 667;
    pub const SYNC2: u16 = 735;
    /// Each of the two pulses of a 0 bit, and of a 1 bit.
    pub const ZERO: u16 = 855;
    pub const ONE: u16 = 1710;
    /// The pilot's pulses before a header (flag below 0x80), and before data.
    pub const HEADER_PILOT_PULSES: u16 = 8063;
    pub const DATA_PILOT_PULSES: u16 = 3223;
    /// The ROM's LD-BYTES, where a machine traps the loading of a block.
    pub const LD_BYTES: u16 = 0x0556;
    /// The ROM's SA-BYTES.
    pub const SA_BYTES: u16 = 0x04C2;
    /// The pause a TAP block is given after it, as TZX's block 0x10 has by default.
    pub const TAP_PAUSE_MS: u16 = 1000;

    /// Whether a timing is the ROM's, give or take a tenth: well inside what LD-BYTES itself accepts (with
    /// the others at the ROM's, and measured with a model of it at 3.5 MHz: a pilot pulse from 1,792 to
    /// 3,368 T-states, the syncs from 168 to 1,072 and from 184 to 3,448, a 0 bit's pulses from 488 to
    /// 1,236 and a 1's from 1,272 to 2,772; docs/tape.md has the 128K's), and wide enough for a tape that
    /// was saved, or copied, a little fast or slow.
    pub fn near(value: u32, rom: u16) -> bool {
        value.abs_diff(rom as u32) * 10 <= rom as u32
    }

    /// Whether LD-BYTES finds a pilot of `pulses` pulses of `length` T-states each, listening from the
    /// silence before it. From the pilot's first edge it waits a second (0x415 passes of a 3,349 T-state
    /// loop) and then counts 256 pairs of pilot pulses before it looks for the sync: a shorter pilot is over
    /// before then, and the ROM misses the block. At 2,168 T-states the model of LD-BYTES needs 2,127
    /// pulses at 3.5 MHz and 2,107 at the 128K's clock; this asks for a second and 520 pulses, 2,135, a few
    /// more for the moment the ROM begins listening (tests/rom_loading.rs pins it across the pilot's tenth).
    pub fn pilot_found(pulses: u32, length: u32) -> bool {
        pulses.saturating_sub(520) as u64 * length as u64 >= 3_500_000
    }
}

impl Block {
    /// The block's signal as data the ROM's LD-BYTES reads, when it is one: the bytes of a TAP block or a TZX
    /// 0x10, or of a 0x11 the ROM loads ([`Turbo::rom_timed`]: its timings, a pilot it finds, all bits of its
    /// last byte).
    pub fn rom_data(&self) -> Option<&[u8]> {
        match self {
            Block::Standard { data, .. } => Some(data),
            Block::Turbo(t) if t.rom_timed() => Some(&t.data),
            _ => None,
        }
    }

    /// Whether the block carries a signal (as opposed to information, or directing the tape).
    pub fn sounds(&self) -> bool {
        matches!(
            self,
            Block::Standard { .. }
                | Block::Turbo(_)
                | Block::PureTone { .. }
                | Block::Pulses(_)
                | Block::PureData(_)
                | Block::DirectRecording(_)
                | Block::Csw(_)
                | Block::Generalized(_)
                | Block::PzxPulses(_)
                | Block::PzxData(_)
                | Block::PzxPause { .. }
        ) || matches!(self, Block::Pause { ms } if *ms > 0)
    }

    /// The TZX block ID this block has, or would have (PZX's blocks have none).
    pub fn tzx_id(&self) -> Option<u8> {
        Some(match self {
            Block::Standard { .. } => 0x10,
            Block::Turbo(_) => 0x11,
            Block::PureTone { .. } => 0x12,
            Block::Pulses(_) => 0x13,
            Block::PureData(_) => 0x14,
            Block::DirectRecording(_) => 0x15,
            Block::Csw(_) => 0x18,
            Block::Generalized(_) => 0x19,
            Block::Pause { .. } => 0x20,
            Block::GroupStart(_) => 0x21,
            Block::GroupEnd => 0x22,
            Block::Jump(_) => 0x23,
            Block::LoopStart(_) => 0x24,
            Block::LoopEnd => 0x25,
            Block::Call(_) => 0x26,
            Block::Return => 0x27,
            Block::Select(_) => 0x28,
            Block::StopIf48k => 0x2A,
            Block::SetLevel(_) => 0x2B,
            Block::Text(_) => 0x30,
            Block::Message { .. } => 0x31,
            Block::ArchiveInfo(_) => 0x32,
            Block::Hardware(_) => 0x33,
            Block::CustomInfo { .. } => 0x35,
            Block::Glue => 0x5A,
            Block::Skipped { id, .. } => *id,
            _ => return None,
        })
    }
}

impl Turbo {
    /// Whether the ROM's LD-BYTES loads it: every timing within a tenth of the ROM's, a pilot it finds,
    /// and the whole of its last byte played.
    pub fn rom_timed(&self) -> bool {
        rom::pilot_found(self.pilot_pulses as u32, self.pilot as u32)
            && rom::near(self.pilot as u32, rom::PILOT)
            && rom::near(self.sync1 as u32, rom::SYNC1)
            && rom::near(self.sync2 as u32, rom::SYNC2)
            && rom::near(self.zero as u32, rom::ZERO)
            && rom::near(self.one as u32, rom::ONE)
            && used_bits(self.used_bits) == 8
    }
}

/// The bits of a last byte that are played: TZX says 1 to 8; anything else is taken as all of them.
pub(crate) fn used_bits(n: u8) -> u8 {
    if (1..=8).contains(&n) { n } else { 8 }
}

/// How many bits a block of `len` bytes plays when `used` of its last byte are.
pub(crate) fn bit_count(len: usize, used: u8) -> u64 {
    if len == 0 {
        0
    } else {
        (len as u64 - 1) * 8 + used_bits(used) as u64
    }
}

impl Generalized {
    /// The symbol at `index` of the data stream.
    pub fn data_symbol(&self, index: u32) -> u8 {
        let nb = self.bits_per_symbol as u64;
        if nb == 0 {
            return 0;
        }
        let first = index as u64 * nb;
        let mut value = 0u32;
        for bit in first..first + nb {
            let byte = self.data.get((bit / 8) as usize).copied().unwrap_or(0);
            value = value << 1 | ((byte >> (7 - bit % 8)) & 1) as u32;
        }
        value as u8
    }
}

/// The smallest n with 2^n at least `symbols`: the bits a generalized block's data stream spends on a symbol.
pub(crate) fn bits_for(symbols: u16) -> u8 {
    let mut n = 0;
    while (1u32 << n) < symbols as u32 {
        n += 1;
    }
    n
}
