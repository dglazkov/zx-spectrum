//! What the ROM's LD-BYTES can load, for the instant load that traps it.
//!
//! LD-BYTES (0x0556) listens for a pilot of pulses about 2,168 T-states long, then the two short sync
//! pulses, then reads bits as pairs of pulses, a pair shorter than about 2,400 T-states a 0 and a longer one
//! a 1 (The Complete Spectrum ROM Disassembly, Logan and O'Hara, 1983; Richard Dymond's annotated edition at
//! <https://skoolkid.github.io/rom/asm/0556.html>). A block whose signal is that, at the ROM's timings, is one
//! the real routine would load, so a machine that traps the routine can put its bytes into memory at once
//! and be faithful. The shapes recognised are in [`crate::Player::take_rom_block`].

use crate::block::{Block, Generalized, PzxData, PzxPulse, Symbol, rom};
use crate::signal::Signal;

/// A block LD-BYTES can load, taken off the tape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RomBlock {
    /// The tape block it came from (for a pilot, sync and data in blocks of their own, the first).
    pub index: usize,
    /// The block as LD-BYTES reads it: the flag byte, the data, the parity byte.
    pub bytes: Vec<u8>,
}

/// What the ROM's LD-BYTES would have done with a block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LdBytes {
    /// The bytes it stores, from IX upwards (when loading; when verifying, the bytes it compares).
    pub loaded: Vec<u8>,
    /// Whether it returns with the carry flag set: the flag matched, the block held `length` bytes and a
    /// parity byte, and the parity came out right.
    pub ok: bool,
}

impl RomBlock {
    /// The flag byte (0x00 a header, 0xFF data, as the ROM saves them).
    pub fn flag(&self) -> Option<u8> {
        self.bytes.first().copied()
    }

    /// What LD-BYTES does with this block when asked, in A, for flag `flag` and, in DE, for `length` bytes.
    ///
    /// As the ROM does it: the first byte must be the flag asked for, or nothing is loaded and it fails;
    /// then each byte read is stored, up to `length` of them, a parity is kept of every byte from the flag
    /// on, and the byte after the `length`th is read as the parity byte, after which all of them XORed
    /// together must be 0. A block shorter than that loads what it has and fails (the real routine waits
    /// for the edges of the bytes that do not come); a longer one loads `length` bytes and judges the
    /// parity by the byte that follows them, the rest of the block unread. Asked for no bytes at all, it
    /// reads the flag byte alone, compares it with nothing, and takes it as its own parity byte: it
    /// succeeds only if that byte is 0.
    pub fn ld_bytes(&self, flag: u8, length: u16) -> LdBytes {
        let length = length as usize;
        if length == 0 {
            return LdBytes {
                loaded: Vec::new(),
                ok: self.flag() == Some(0),
            };
        }
        if self.flag() != Some(flag) {
            return LdBytes {
                loaded: Vec::new(),
                ok: false,
            };
        }
        let data = &self.bytes[1..];
        let loaded = data[..length.min(data.len())].to_vec();
        let ok = data.len() > length && self.bytes[..length + 2].iter().fold(0, |a, b| a ^ b) == 0;
        LdBytes { loaded, ok }
    }
}

/// The bytes of the ROM-loadable block (or blocks: pilot, sync and data apart) at `signal`'s block, moving
/// `signal` to the block after them; `None`, with `signal` left anywhere, if they are not ROM-loadable.
pub(crate) fn take(blocks: &[Block], signal: &mut Signal) -> Option<Vec<u8>> {
    let first = blocks.get(signal.index)?;
    signal.next();
    match first {
        Block::Standard { data, .. } => Some(data.clone()),
        Block::Turbo(t) if t.rom_timed() => Some(t.data.clone()),
        Block::PureTone { pulse, count }
            if rom::near(*pulse as u32, rom::PILOT)
                && rom::pilot_found(*count as u32, *pulse as u32) =>
        {
            let Block::Pulses(sync) = next_signal(blocks, signal)? else {
                return None;
            };
            if !is_sync(sync.iter().map(|&p| p as u32)) {
                return None;
            }
            let Block::PureData(d) = next_signal(blocks, signal)? else {
                return None;
            };
            let rom_bits = rom::near(d.zero as u32, rom::ZERO) && rom::near(d.one as u32, rom::ONE);
            (rom_bits && crate::block::used_bits(d.used_bits) == 8).then(|| d.data.clone())
        }
        Block::Generalized(g) => generalized(g),
        Block::PzxPulses(p) => {
            let (lead_in, sync2_high) = pzx_pulses(p)?;
            if !is_lead_in(&lead_in) {
                return None;
            }
            let Block::PzxData(d) = next_signal(blocks, signal)? else {
                return None;
            };
            // The first bit's first pulse must begin with an edge after the second sync pulse.
            if d.initial_high == sync2_high {
                return None;
            }
            pzx_data(d)
        }
        _ => None,
    }
}

/// The next block, past those that only inform (texts, groups), moving `signal` past it.
fn next_signal<'a>(blocks: &'a [Block], signal: &mut Signal) -> Option<&'a Block> {
    loop {
        let block = blocks.get(signal.index)?;
        signal.next();
        match block {
            Block::GroupStart(_)
            | Block::GroupEnd
            | Block::Text(_)
            | Block::Message { .. }
            | Block::ArchiveInfo(_)
            | Block::Hardware(_)
            | Block::CustomInfo { .. }
            | Block::Glue
            | Block::Skipped { .. }
            | Block::Browse(_)
            | Block::PzxHeader { .. }
            | Block::Select(_) => continue,
            _ => return Some(block),
        }
    }
}

/// Whether pulses are exactly the two sync pulses.
fn is_sync(mut pulses: impl Iterator<Item = u32>) -> bool {
    matches!((pulses.next(), pulses.next(), pulses.next()),
        (Some(a), Some(b), None) if rom::near(a, rom::SYNC1) && rom::near(b, rom::SYNC2))
}

/// Whether pulses are a pilot at the ROM's timing, long enough for LD-BYTES to find, and then the sync:
/// what the ROM's SAVE makes before data.
fn is_lead_in(pulses: &[u32]) -> bool {
    let n = pulses.len();
    if n < 3 {
        return false;
    }
    let pilot = &pulses[..n - 2];
    pilot.iter().all(|&p| rom::near(p, rom::PILOT))
        && rom::pilot_found(pilot.len() as u32, pilot.iter().copied().min().unwrap_or(0))
        && is_sync(pulses[n - 2..].iter().copied())
}

/// The most pulses a lead-in is looked through for: a header's pilot is 8,063.
const LEAD_IN_LIMIT: usize = 20_000;

/// A PZX pulse sequence as it is heard: it starts low and turns after every pulse, so that a pulse of no
/// length makes the pulses either side of it one. With the level of the last pulse heard; `None` if there
/// is none, or too many to be a lead-in.
fn pzx_pulses(list: &[PzxPulse]) -> Option<(Vec<u32>, bool)> {
    let mut heard: Vec<(u32, bool)> = Vec::new();
    let mut high = false;
    for p in list {
        if p.duration == 0 {
            high ^= p.count % 2 == 1;
            continue;
        }
        for _ in 0..p.count {
            match heard.last_mut() {
                Some((len, level)) if *level == high => *len = len.saturating_add(p.duration),
                _ => {
                    if heard.len() >= LEAD_IN_LIMIT {
                        return None;
                    }
                    heard.push((p.duration, high));
                }
            }
            high = !high;
        }
    }
    let last = heard.last()?.1;
    Some((heard.into_iter().map(|(len, _)| len).collect(), last))
}

/// Whether a bit's pulses are the ROM's: two, each near `length`.
fn rom_bit(pulses: &[u16], length: u16) -> bool {
    pulses.len() == 2 && pulses.iter().all(|&p| rom::near(p as u32, length))
}

fn pzx_data(d: &PzxData) -> Option<Vec<u8>> {
    let rom = rom_bit(&d.zero, rom::ZERO) && rom_bit(&d.one, rom::ONE) && d.bits.is_multiple_of(8);
    rom.then(|| d.data[..d.bits as usize / 8].to_vec())
}

/// A generalized data block that is a ROM block written another way, as the TZX specification's own
/// example of a header is: a pilot and sync at the ROM's timings, and two data symbols that are the ROM's
/// bits, every symbol beginning with an edge.
fn generalized(g: &Generalized) -> Option<Vec<u8>> {
    // Every symbol must begin with an edge (polarity 0), as the ROM's own pulses do: LD-BYTES hears
    // nothing else.
    let edged = |s: &Symbol| s.polarity == 0 || s.pulses.is_empty();
    let mut pulses = Vec::new();
    for &(s, reps) in &g.pilot {
        let symbol = g.pilot_symbols.get(s as usize)?;
        if reps > 0 && !edged(symbol) {
            return None;
        }
        if pulses.len() + reps as usize * symbol.pulses.len() > LEAD_IN_LIMIT {
            return None;
        }
        for _ in 0..reps {
            pulses.extend(symbol.pulses.iter().map(|&p| p as u32));
        }
    }
    if !is_lead_in(&pulses)
        || g.data_symbols.len() != 2
        || !g.data_symbols.iter().all(edged)
        || g.bits_per_symbol != 1
        || !g.data_count.is_multiple_of(8)
    {
        return None;
    }
    let (s0, s1) = (&g.data_symbols[0].pulses, &g.data_symbols[1].pulses);
    let invert = if rom_bit(s0, rom::ZERO) && rom_bit(s1, rom::ONE) {
        false
    } else if rom_bit(s0, rom::ONE) && rom_bit(s1, rom::ZERO) {
        true
    } else {
        return None;
    };
    let bytes = &g.data[..g.data_count as usize / 8];
    Some(bytes.iter().map(|&b| if invert { !b } else { b }).collect())
}
