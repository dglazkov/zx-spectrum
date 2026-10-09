//! Saving: the MIC line's edges, as the ROM's SA-BYTES makes them, turned back into TAP blocks.
//!
//! SA-BYTES (0x04C2) writes a pilot of pulses 2,168 T-states long (8,063 of them before a header, 3,223
//! before data), a sync pulse of 667 and one of 735, then each bit as two equal pulses, 855 T-states each
//! for a 0 and 1,710 for a 1, most significant bit first, the flag byte first and the parity byte last
//! (The Complete Spectrum ROM Disassembly; <https://skoolkid.github.io/rom/asm/04C2.html>). The recorder
//! measures the time between edges and reads that back: a run of pilot pulses, two short ones, then pairs
//! of pulses, a pair shorter than 2,565 T-states (halfway between a 0's 1,710 and a 1's 3,420) a 0. A
//! block ends when the edges stop, or with a pulse longer than a 1's: the tail SA-BYTES ends a block with
//! is followed by silence, or, when a program calls SA-BYTES again straight away, by the next block's
//! pilot, which then begins. It counts T-states, which the 128K's SAVE makes the same as the 48K's, so
//! the clock does not matter.

use crate::tap;

/// The range of a pilot pulse, wide of the ROM's 2,168 to allow for contention and a little more.
const PILOT: std::ops::RangeInclusive<u64> = 1700..=2700;
/// The range of a sync pulse (the ROM's are 667 and 735).
const SYNC: std::ops::RangeInclusive<u64> = 400..=1100;
/// How many pilot pulses in a row mean a block is coming (the ROM's shortest pilot has 3,223).
const MIN_PILOT: u32 = 256;
/// The two pulses of a bit together: shorter than this is a 0.
const BIT_THRESHOLD: u64 = 855 + 1710;
/// A pulse longer than any a bit has ends the block: halfway between a 1's pulse (1,710) and a pilot's
/// (2,168), so that a pilot straight after a block begins the next.
const MAX_BIT_PULSE: u64 = (1710 + 2168) / 2;
/// No edge for this long ends the block.
const TIMEOUT: u64 = 10_000;

#[derive(Clone, Debug)]
enum State {
    /// Listening for a pilot; how many pilot pulses in a row so far.
    Pilot(u32),
    /// The first sync pulse has come.
    Sync,
    /// Reading bytes: those done, the bits of the next, and the first pulse of a bit when only it has come.
    Data {
        bytes: Vec<u8>,
        byte: u8,
        bits: u8,
        half: Option<u64>,
    },
}

/// Turns the MIC line into TAP blocks.
#[derive(Clone, Debug)]
pub struct Recorder {
    frame_start: u64,
    level: bool,
    last_edge: Option<u64>,
    state: State,
    blocks: Vec<Vec<u8>>,
}

impl Default for Recorder {
    fn default() -> Self {
        Self::new()
    }
}

impl Recorder {
    pub fn new() -> Recorder {
        Recorder {
            frame_start: 0,
            level: false,
            last_edge: None,
            state: State::Pilot(0),
            blocks: Vec::new(),
        }
    }

    /// The MIC line is at `level` from T-state `t` of this frame (bit 3 of what was written to port 0xFE).
    /// Called on every write, or only on changes: a write that does not change the level is no edge.
    pub fn mic(&mut self, t: u32, level: bool) {
        if level == self.level {
            return;
        }
        self.level = level;
        let now = self.frame_start + t as u64;
        if let Some(last) = self.last_edge {
            self.pulse(now.saturating_sub(last));
        }
        self.last_edge = Some(now);
    }

    /// The frame has ended after `frame_len` T-states. A block whose edges have stopped is finished.
    pub fn end_frame(&mut self, frame_len: u32) {
        let end = self.frame_start + frame_len as u64;
        if self
            .last_edge
            .is_some_and(|last| end - last.min(end) > TIMEOUT)
        {
            self.finish();
        }
        self.frame_start = end;
    }

    /// Whether a block is being received.
    pub fn is_recording(&self) -> bool {
        matches!(self.state, State::Data { .. } | State::Sync)
    }

    /// The blocks saved so far, each the flag byte, the data and the parity byte, as in a TAP file.
    pub fn blocks(&self) -> &[Vec<u8>] {
        &self.blocks
    }

    /// The blocks saved so far, as a TAP file.
    pub fn tap(&self) -> Vec<u8> {
        tap::write(&self.blocks)
    }

    /// Hands over the blocks saved so far, keeping none.
    pub fn take_blocks(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.blocks)
    }

    /// Ends the block being received, keeping the whole bytes it has.
    pub fn finish(&mut self) {
        if let State::Data { bytes, .. } = std::mem::replace(&mut self.state, State::Pilot(0))
            && !bytes.is_empty()
        {
            self.blocks.push(bytes);
        }
    }

    /// A pulse of `len` T-states has ended.
    fn pulse(&mut self, len: u64) {
        match &mut self.state {
            State::Pilot(n) => {
                if PILOT.contains(&len) {
                    *n += 1;
                } else if *n >= MIN_PILOT && SYNC.contains(&len) {
                    self.state = State::Sync;
                } else {
                    *n = 0;
                }
            }
            State::Sync => {
                self.state = if SYNC.contains(&len) {
                    State::Data {
                        bytes: Vec::new(),
                        byte: 0,
                        bits: 0,
                        half: None,
                    }
                } else {
                    State::Pilot(0)
                };
            }
            State::Data {
                bytes,
                byte,
                bits,
                half,
            } => {
                if len > MAX_BIT_PULSE {
                    self.finish();
                    // It may be the first pulse of the next block's pilot.
                    self.pulse(len);
                    return;
                }
                match half.take() {
                    None => *half = Some(len),
                    Some(first) => {
                        *byte = *byte << 1 | (first + len >= BIT_THRESHOLD) as u8;
                        *bits += 1;
                        if *bits == 8 {
                            bytes.push(*byte);
                            (*byte, *bits) = (0, 0);
                        }
                    }
                }
            }
        }
    }
}
