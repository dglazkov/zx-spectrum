//! The Spectrum at an instant, neutral of any file format: which model it is, its CPU's registers, how far into the
//! video frame it is, its RAM, its paging ports, its AY, and what else the snapshot formats carry that a machine
//! can use. `load` reads a snapshot in any of the formats, knowing which by its content and size; `save_z80`,
//! `save_sna` and `save_szx` write one. `load_scr` reads a screen dump.
//!
//! - `.z80`: Gerton Lunter's format, versions 1, 2 and 3 with the extensions other emulators made to it
//!   (`z80.rs`).
//! - `.sna`: the 48K format with the program counter on the stack, and its 128K extension (`sna.rs`).
//! - `.szx`: Spectaculator's zx-state format, the blocks a Spectrum without peripherals needs (`szx.rs`).
//!
//! docs/snapshot.md is the record of this crate: the specifications each part follows, where they were found,
//! the choices made where they are silent, and how each is tested.
//!
//! RAM is held as 16 KB banks indexed by bank number, as the 128K numbers them, so that every model is described
//! alike: a 48K's memory at 4000h, 8000h and C000h is banks 5, 2 and 0 (as it is on a 128K paged as a 48K), and
//! a 16K's is bank 5 alone.

mod rle;
mod scr;
mod sna;
mod szx;
mod z80;

use std::collections::BTreeMap;
use std::fmt;

pub use scr::load_scr;
pub use sna::{load_sna, save_sna};
pub use szx::{load_szx, save_szx};
pub use z80::{load_z80, save_z80};

/// The size of a RAM bank: 16 KB.
pub const BANK_SIZE: usize = 0x4000;

/// A 16 KB bank of RAM.
pub type Bank = [u8; BANK_SIZE];

/// The size of the screen in memory: 6,144 bytes of bitmap and 768 of attributes, from 4000h.
pub const SCREEN_SIZE: usize = 6912;

/// The screen as it is in memory from 4000h (or from the start of bank 7, the 128K's second screen).
pub type Screen = [u8; SCREEN_SIZE];

/// The models a snapshot can be of.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Model {
    Spectrum16,
    Spectrum48,
    Spectrum128,
    Plus2,
    /// The +2A, and the +2B, which is the same machine.
    Plus2A,
    Plus3,
    Pentagon128,
}

impl Model {
    pub const ALL: [Model; 7] = [
        Model::Spectrum16,
        Model::Spectrum48,
        Model::Spectrum128,
        Model::Plus2,
        Model::Plus2A,
        Model::Plus3,
        Model::Pentagon128,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Model::Spectrum16 => "ZX Spectrum 16K",
            Model::Spectrum48 => "ZX Spectrum 48K",
            Model::Spectrum128 => "ZX Spectrum 128",
            Model::Plus2 => "ZX Spectrum +2",
            Model::Plus2A => "ZX Spectrum +2A",
            Model::Plus3 => "ZX Spectrum +3",
            Model::Pentagon128 => "Pentagon 128",
        }
    }

    /// T-states in a video frame: 224 × 312 on the 16K and 48K, 228 × 311 on the 128K family, 224 × 320 on the
    /// Pentagon.
    pub fn frame_tstates(self) -> u32 {
        match self {
            Model::Spectrum16 | Model::Spectrum48 => 69_888,
            Model::Spectrum128 | Model::Plus2 | Model::Plus2A | Model::Plus3 => 70_908,
            Model::Pentagon128 => 71_680,
        }
    }

    /// The RAM banks the model has: bank 5 on a 16K; 5, 2 and 0 on a 48K (at 4000h, 8000h, C000h); all eight on
    /// the others.
    pub fn banks(self) -> &'static [usize] {
        match self {
            Model::Spectrum16 => &[5],
            Model::Spectrum48 => &[5, 2, 0],
            _ => &[0, 1, 2, 3, 4, 5, 6, 7],
        }
    }

    /// Whether the model has 128K memory paging through port 7FFD, and an AY.
    pub fn is_128k(self) -> bool {
        !matches!(self, Model::Spectrum16 | Model::Spectrum48)
    }

    /// Whether the model is a +2A or +3, with the second paging port 1FFD.
    pub fn has_1ffd(self) -> bool {
        matches!(self, Model::Plus2A | Model::Plus3)
    }

    /// How many T-states the ULA holds INT low at the start of each frame: 32 on the 48K and the Pentagon, 36 on
    /// the 128K family. Only the .szx writer uses it, to say how much of that time is left.
    pub fn interrupt_tstates(self) -> u32 {
        match self {
            Model::Spectrum128 | Model::Plus2 | Model::Plus2A | Model::Plus3 => 36,
            _ => 32,
        }
    }
}

/// The CPU's registers, and the parts of its state between instructions that a snapshot can carry.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Registers {
    /// A in the high byte, F in the low; likewise for the other pairs.
    pub af: u16,
    pub bc: u16,
    pub de: u16,
    pub hl: u16,
    /// The alternate set: AF', BC', DE', HL'.
    pub af_alt: u16,
    pub bc_alt: u16,
    pub de_alt: u16,
    pub hl_alt: u16,
    pub ix: u16,
    pub iy: u16,
    pub sp: u16,
    /// The address of the next instruction; while halted, the address of the HALT itself (see `halted`).
    pub pc: u16,
    pub i: u8,
    /// All eight bits of R.
    pub r: u8,
    pub iff1: bool,
    pub iff2: bool,
    /// Interrupt mode, 0 to 2.
    pub im: u8,
    /// MEMPTR (WZ), where the format has it (.szx from version 1.4, where zero means "not supported" and so
    /// reads as None); None where it does not.
    pub memptr: Option<u16>,
    /// The CPU is halted: it executes NOPs until an interrupt. The program counter is that of the HALT
    /// instruction itself (as Fuse, and the .szx files it writes, keep it); a format without this flag leaves PC
    /// at the HALT, which the CPU then executes again, coming to the same.
    pub halted: bool,
    /// The last instruction was EI (or a DD or FD prefix): an interrupt will not be accepted before the next
    /// instruction (.szx's ZXSTZF_SUPPRESS_INTS).
    pub interrupts_suppressed: bool,
    /// The last instruction set the flags, so that the hidden register Q equals F, which SCF and CCF read
    /// (.szx's ZXSTZF_FSET, from version 1.5).
    pub flags_set: bool,
}

/// What an AY is attached as.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AyInterface {
    /// The AY built into the 128K, +2, +2A, +3 and Pentagon, at ports FFFDh and BFFDh.
    BuiltIn,
    /// An AY added to a 16K or 48K on the 128K's ports (the Melodik, and the Spectaculator/xzx "AY in 48K mode").
    Melodik,
    /// The Fuller Box: an AY on ports 3Fh and 5Fh.
    FullerBox,
}

/// The AY-3-8912's state: which register is selected, and the sixteen registers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Ay {
    pub selected: u8,
    pub registers: [u8; 16],
    pub interface: AyInterface,
}

impl Ay {
    pub fn new(interface: AyInterface) -> Ay {
        Ay { selected: 0, registers: [0; 16], interface }
    }
}

/// A joystick interface. The formats keep which one the emulator had set up; a machine can take it as a hint.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Joystick {
    /// Read at port 1Fh.
    Kempston,
    /// Sinclair Interface 2's port 1 (the +2A/+3's joystick 1): keys 6 to 0.
    Sinclair1,
    /// Sinclair Interface 2's port 2 (the +2A/+3's joystick 2): keys 1 to 5.
    Sinclair2,
    /// Cursor, Protek or AGF: keys 5 to 8 and 0.
    Cursor,
    /// The Fuller Box's joystick, at port 7Fh.
    Fuller,
}

/// A tape file embedded in a snapshot (.szx's TAPE block), with where the tape head is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmbeddedTape {
    /// The tape file's extension, in lower case: "tzx", "tap", "csw"...
    pub extension: String,
    pub data: Vec<u8>,
    /// The block the tape head is at, from 0.
    pub current_block: u16,
}

/// The data of a super level loader snapshot (.slt), appended to a .z80 by Damien Burke's format: each level's data,
/// which the program loads by the instruction ED FB (not a Z80 instruction: the emulator's trap) with the level
/// number in A, to be written to memory from HL; and a loading screen.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Slt {
    pub levels: BTreeMap<u8, Vec<u8>>,
    pub screen: Option<Box<Screen>>,
}

/// The Spectrum at an instant.
#[derive(Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub model: Model,
    pub regs: Registers,
    /// T-states since the frame began (the moment the ULA raised INT), less than the model's frame length. A
    /// format that does not keep it (.sna, .z80 before version 3) gives 0.
    pub tstates: u32,
    /// The last byte written to port FEh: the border colour in bits 0 to 2, MIC in bit 3, EAR in bit 4. Only
    /// .szx keeps bits 3 and 4; the others give the border alone.
    pub port_fe: u8,
    /// The RAM, by bank number. A model's banks (`Model::banks`) are always there; no others are.
    pub ram: [Option<Box<Bank>>; 8],
    /// The last byte written to port 7FFDh (the 128K's paging); 0 on a 16K or 48K.
    pub port_7ffd: u8,
    /// The last byte written to port 1FFDh (the +2A/+3's paging); 0 on other models.
    pub port_1ffd: u8,
    /// The AY: always there on the 128K models, and on a 16K or 48K only where the snapshot says one was
    /// attached.
    pub ay: Option<Ay>,
    /// An Issue 2 keyboard, whose EAR bit reads differently (16K and 48K).
    pub issue2: bool,
    pub joystick: Option<Joystick>,
    /// The machine runs one T-state later than the usual timings, as some 48K and 128K boards do (.szx's
    /// ZXSTMF_ALTERNATETIMINGS).
    pub late_timings: bool,
    /// The TR-DOS ROM was paged in (the 128K .sna's last header byte); kept for writing back.
    pub trdos_paged: bool,
    /// A ROM to use instead of the model's own (.szx's ROM block), the model's ROMs end to end: 16K on a 16K or
    /// 48K, 32K on a 128K, +2 or Pentagon, 64K on a +2A or +3. A file whose ROM block is any other size is refused.
    pub custom_rom: Option<Vec<u8>>,
    pub tape: Option<EmbeddedTape>,
    pub slt: Option<Slt>,
}

impl Snapshot {
    /// A snapshot of `model` with its RAM zeroed and its registers zero: the starting point for building one.
    pub fn new(model: Model) -> Snapshot {
        let mut ram: [Option<Box<Bank>>; 8] = Default::default();
        for &b in model.banks() {
            ram[b] = Some(zero_bank());
        }
        Snapshot {
            model,
            regs: Registers::default(),
            tstates: 0,
            port_fe: 0,
            ram,
            port_7ffd: 0,
            port_1ffd: 0,
            ay: model.is_128k().then(|| Ay::new(AyInterface::BuiltIn)),
            issue2: false,
            joystick: None,
            late_timings: false,
            trdos_paged: false,
            custom_rom: None,
            tape: None,
            slt: None,
        }
    }

    /// The border colour, 0 to 7.
    pub fn border(&self) -> u8 {
        self.port_fe & 7
    }

    pub fn bank(&self, n: usize) -> Option<&Bank> {
        self.ram.get(n)?.as_deref()
    }

    pub fn bank_mut(&mut self, n: usize) -> Option<&mut Bank> {
        self.ram.get_mut(n)?.as_deref_mut()
    }

    /// Which RAM bank is paged in at slot `slot` (0 for 0000h, 1 for 4000h, 2 for 8000h, 3 for C000h), as the
    /// paging ports have it; None where the slot holds ROM, or nothing (a 16K above 8000h).
    pub fn paged_bank(&self, slot: usize) -> Option<usize> {
        match self.model {
            Model::Spectrum16 => (slot == 1).then_some(5),
            Model::Spectrum48 => [None, Some(5), Some(2), Some(0)].get(slot).copied().flatten(),
            m => {
                if m.has_1ffd() && self.port_1ffd & 1 != 0 {
                    // The +2A/+3's special paging: four configurations of all-RAM, from 1FFDh bits 1 and 2.
                    const SPECIAL: [[usize; 4]; 4] = [[0, 1, 2, 3], [4, 5, 6, 7], [4, 5, 6, 3], [4, 7, 6, 3]];
                    return SPECIAL[(self.port_1ffd as usize >> 1) & 3].get(slot).copied();
                }
                [None, Some(5), Some(2), Some((self.port_7ffd & 7) as usize)].get(slot).copied().flatten()
            }
        }
    }

    /// The byte at `addr` as the CPU would read it, where that is RAM.
    pub fn peek(&self, addr: u16) -> Option<u8> {
        let bank = self.paged_bank(addr as usize >> 14)?;
        Some(self.bank(bank)?[addr as usize & 0x3FFF])
    }

    /// Writes the byte at `addr` as the CPU would, where that is RAM; says whether it was.
    pub fn poke(&mut self, addr: u16, value: u8) -> bool {
        let Some(bank) = self.paged_bank(addr as usize >> 14) else { return false };
        match self.bank_mut(bank) {
            Some(b) => {
                b[addr as usize & 0x3FFF] = value;
                true
            }
            None => false,
        }
    }

    /// The screen the ULA is showing: bank 5's, or on a 128K model with bit 3 of 7FFDh set, bank 7's.
    pub fn screen(&self) -> Box<Screen> {
        let bank = if self.model.is_128k() && self.port_7ffd & 8 != 0 { 7 } else { 5 };
        let mut s = Box::new([0u8; SCREEN_SIZE]);
        if let Some(b) = self.bank(bank) {
            s.copy_from_slice(&b[..SCREEN_SIZE]);
        }
        s
    }

    /// Makes the RAM fit the model: a bank it lacks is added, zeroed (a file that left it out); one it does not
    /// have is dropped (a 16K saved as a 48K).
    fn fit_ram_to_model(&mut self) {
        let banks = self.model.banks();
        for (n, slot) in self.ram.iter_mut().enumerate() {
            if !banks.contains(&n) {
                *slot = None;
            } else if slot.is_none() {
                *slot = Some(zero_bank());
            }
        }
    }

    /// The bank's bytes, or zeros where the snapshot lacks it (writers use this).
    fn bank_or_zero(&self, n: usize) -> &Bank {
        static ZERO: Bank = [0; BANK_SIZE];
        self.bank(n).unwrap_or(&ZERO)
    }
}

/// Without the RAM's bytes, which would bury everything else: each bank is given by its CRC-32.
impl fmt::Debug for Snapshot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let banks: Vec<String> = self
            .ram
            .iter()
            .enumerate()
            .filter_map(|(n, b)| b.as_ref().map(|b| format!("{n}:{:08x}", crc32(&b[..]))))
            .collect();
        f.debug_struct("Snapshot")
            .field("model", &self.model)
            .field("regs", &self.regs)
            .field("tstates", &self.tstates)
            .field("port_fe", &self.port_fe)
            .field("ram", &banks)
            .field("port_7ffd", &self.port_7ffd)
            .field("port_1ffd", &self.port_1ffd)
            .field("ay", &self.ay)
            .field("issue2", &self.issue2)
            .field("joystick", &self.joystick)
            .field("late_timings", &self.late_timings)
            .field("trdos_paged", &self.trdos_paged)
            .field("custom_rom", &self.custom_rom.as_ref().map(|r| r.len()))
            .field("tape", &self.tape.as_ref().map(|t| (&t.extension, t.data.len(), t.current_block)))
            .field("slt", &self.slt.as_ref().map(|s| (s.levels.keys().collect::<Vec<_>>(), s.screen.is_some())))
            .finish()
    }
}

/// The formats `load` reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Format {
    Z80,
    Sna,
    Szx,
}

impl Format {
    pub fn extension(self) -> &'static str {
        match self {
            Format::Z80 => "z80",
            Format::Sna => "sna",
            Format::Szx => "szx",
        }
    }
}

/// Why a snapshot could not be read or written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// Not a snapshot in any format this crate reads.
    Unrecognised,
    /// The file ends before something it should hold.
    Truncated(String),
    /// The file's contents contradict themselves or the format.
    Corrupt(String),
    /// A machine or feature the snapshot is of, which this crate does not represent (a Timex, a Scorpion).
    Unsupported(String),
    /// The snapshot cannot be put in this format (a 48K .sna's stack in ROM).
    CannotSave(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Unrecognised => write!(f, "not a snapshot this emulator reads (.z80, .sna or .szx)"),
            Error::Truncated(what) => write!(f, "the snapshot is cut short: {what}"),
            Error::Corrupt(what) => write!(f, "the snapshot is corrupt: {what}"),
            Error::Unsupported(what) => write!(f, "the snapshot is of {what}, which this emulator does not run"),
            Error::CannotSave(what) => write!(f, "cannot save this snapshot so: {what}"),
        }
    }
}

impl std::error::Error for Error {}

/// Which snapshot format `bytes` is in, by content and size: a .szx by its signature; a .z80 whose header and
/// pages (or version 1 end marker) end exactly at the end of the file; a .sna by its exact size (49,179 bytes for
/// a 48K, 131,103 or 147,487 for a 128K) with a header that could be one; a .z80 by its header and what follows
/// it. A size alone is the weakest of these, so that a .z80 that happens to be a .sna's length is still a .z80
/// (as unzip's `Kind::sniff` takes it to be).
pub fn detect(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(szx::MAGIC) {
        Some(Format::Szx)
    } else if z80::conclusive(bytes) {
        Some(Format::Z80)
    } else if sna::plausible(bytes) {
        Some(Format::Sna)
    } else if z80::plausible(bytes) {
        Some(Format::Z80)
    } else {
        None
    }
}

/// Reads a snapshot in whichever format it is.
pub fn load(bytes: &[u8]) -> Result<Snapshot, Error> {
    match detect(bytes) {
        Some(Format::Szx) => load_szx(bytes),
        Some(Format::Sna) => load_sna(bytes),
        Some(Format::Z80) => load_z80(bytes),
        None => Err(Error::Unrecognised),
    }
}

/// Writes the snapshot in `format`.
pub fn save(snapshot: &Snapshot, format: Format) -> Result<Vec<u8>, Error> {
    match format {
        Format::Z80 => Ok(save_z80(snapshot)),
        Format::Sna => save_sna(snapshot),
        Format::Szx => Ok(save_szx(snapshot)),
    }
}

fn zero_bank() -> Box<Bank> {
    vec![0u8; BANK_SIZE].into_boxed_slice().try_into().expect("a bank's length")
}

fn bank_from(bytes: &[u8]) -> Box<Bank> {
    let mut b = zero_bank();
    b.copy_from_slice(bytes);
    b
}

/// Little-endian reads, from data whose length has already been checked.
fn le16(d: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([d[at], d[at + 1]])
}

fn le32(d: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([d[at], d[at + 1], d[at + 2], d[at + 3]])
}

/// Fails with `Truncated` unless `d` has at least `len` bytes.
fn need(d: &[u8], len: usize, what: &str) -> Result<(), Error> {
    if d.len() < len {
        Err(Error::Truncated(format!("{what} needs {len} bytes, and there are {}", d.len())))
    } else {
        Ok(())
    }
}

/// CRC-32 (the zip polynomial), for `Debug` and the tests.
fn crc32(data: &[u8]) -> u32 {
    let mut c = !0u32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

#[cfg(test)]
mod tests;
