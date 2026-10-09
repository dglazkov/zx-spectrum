//! Tapes for the ZX Spectrum: read, played into the EAR line to the T-state, loaded at once where the ROM
//! would load them, and recorded from the MIC line.
//!
//! - [`Tape::parse`] reads TAP, TZX 1.20 (every block), CSW 1 and 2, and PZX into [`Block`]s, each of
//!   which can say what it is for the page ([`Block::describe`]: "Program: SABOTEUR LINE 1").
//! - A [`Player`] is the tape deck: it gives the EAR level at any T-state of the machine's clock, scaling
//!   the tape's 3.5 MHz timings to the machine's exactly, through every TZX block (loops, calls, jumps, the
//!   stop blocks), and says where it is ([`Status`]).
//! - [`Player::take_rom_block`] hands the machine that traps the ROM's LD-BYTES the next block the ROM
//!   could load, so that it can put it into memory at once, and [`RomBlock::ld_bytes`] says what LD-BYTES
//!   would have done with it.
//! - A [`Recorder`] turns the MIC line's edges, as SAVE makes them, into TAP blocks.
//!
//! Nothing here knows the rest of the Spectrum, or reads a clock: time is what the machine says it is.
//! `docs/tape.md` gives the sources, the rules of each format as they are played, and how it is tested.

#![forbid(unsafe_code)]

mod block;
pub mod csw;
mod describe;
mod instant;
mod player;
pub mod pzx;
mod recorder;
mod signal;
pub mod tap;
pub mod text;
pub mod tzx;

pub use block::{
    Block, Csw, DirectRecording, Generalized, HardwareInfo, PureData, PzxData, PzxPulse, Selection,
    Symbol, Turbo, rom,
};
pub use describe::{Header, archive_field};
pub use instant::{LdBytes, RomBlock};
pub use player::{Player, Status};
pub use recorder::Recorder;
pub use signal::{StopReason, duration};

/// The clocks a tape plays at: the 16K, 48K and Pentagon run at 3.5 MHz, which is also what TZX and PZX
/// count their T-states in; the 128K, +2, +2A and +3 at 3,546,900 Hz.
pub const CLOCK_48K: u32 = 3_500_000;
pub const CLOCK_128K: u32 = 3_546_900;

/// The most blocks a tape may have. The longest real tapes (compilations, Bleepload's hundreds of small blocks)
/// have a few hundred; a file of more is not a tape but something else that happens to parse as one (a file of
/// zeros is half a million empty TAP blocks), and each block costs memory and a row in the page's list.
pub const MAX_BLOCKS: usize = 8192;

/// The most pulses a recording (CSW, or TZX's CSW block) may hold: 8 million, three quarters of an hour of tape at
/// the densest loaders' rate (a whole side of a 128K multi-load is a few million). A few kilobytes of Z-RLE can
/// inflate to far more, and the browser's machine never gives memory back.
pub const MAX_PULSES: usize = 8 << 20;

/// A tape: its blocks, in order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tape {
    pub format: Format,
    pub blocks: Vec<Block>,
    /// What was wrong with the file but did not stop it being read (a last block cut short).
    pub warnings: Vec<String>,
}

/// What kind of file a tape was read from, and its version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Tap,
    Tzx { major: u8, minor: u8 },
    Csw { major: u8, minor: u8 },
    Pzx { major: u8, minor: u8 },
}

/// Why a file could not be read as a tape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// It is none of the formats.
    Unrecognised,
    /// It is a version of a format that is not known.
    Unsupported(String),
    /// It is one of the formats, but broken where it cannot be read past.
    Corrupt(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Unrecognised => write!(f, "not a tape (TAP, TZX, CSW or PZX)"),
            Error::Unsupported(what) => write!(f, "{what} is not supported"),
            Error::Corrupt(why) => write!(f, "the tape is broken: {why}"),
        }
    }
}

impl std::error::Error for Error {}

impl Tape {
    /// Reads a tape, knowing its format by its contents: TZX, CSW and PZX by their signatures, TAP by its
    /// block lengths adding up to the file.
    pub fn parse(bytes: &[u8]) -> Result<Tape, Error> {
        if bytes.starts_with(tzx::SIGNATURE) {
            tzx::parse(bytes)
        } else if bytes.starts_with(csw::SIGNATURE) {
            csw::parse(bytes)
        } else if bytes.starts_with(pzx::SIGNATURE) {
            pzx::parse(bytes)
        } else {
            tap::parse(bytes)
        }
    }

    /// A tape of TAP blocks (each the flag, the data and the parity byte), as a TAP file of them is.
    pub fn from_blocks<B: AsRef<[u8]>>(blocks: &[B]) -> Tape {
        let blocks = blocks
            .iter()
            .map(|b| Block::Standard {
                data: b.as_ref().to_vec(),
                pause_ms: rom::TAP_PAUSE_MS,
            })
            .collect();
        Tape {
            format: Format::Tap,
            blocks,
            warnings: Vec::new(),
        }
    }

    /// How long the tape lasts, each block played once, in seconds.
    pub fn seconds(&self) -> f64 {
        self.blocks.iter().map(duration).sum::<u64>() as f64 / CLOCK_48K as f64
    }
}
