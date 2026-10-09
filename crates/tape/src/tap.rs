//! TAP: the blocks the ROM saves, one after another, each after its length.
//!
//! A TAP file is nothing but blocks, each a little-endian 16-bit length and then that many bytes: the flag
//! byte, the data, and the parity byte, exactly what SA-BYTES sends and LD-BYTES reads. It has no timings, so
//! each is played at the ROM's, with the second of silence after it that a TZX block 0x10 has by default.

use crate::block::{Block, rom};
use crate::{Error, Format, MAX_BLOCKS, Tape};

/// Reads a TAP file. A TAP has no signature, so this is also how [`Tape::parse`] decides that a file is one:
/// its lengths must account for it to the last byte, but for a last block cut short, which is kept as far as
/// it goes, with a warning. A block of no bytes at all (not even the flag) is nothing SA-BYTES ever wrote: it
/// is left out, with a warning, so that a file of zeros (whose lengths account for it exactly) is no tape.
pub fn parse(bytes: &[u8]) -> Result<Tape, Error> {
    let mut blocks = Vec::new();
    let mut warnings = Vec::new();
    let mut empty = 0usize;
    let mut at = 0;
    while at < bytes.len() {
        if blocks.len() >= MAX_BLOCKS {
            return Err(Error::Corrupt(format!(
                "more than {MAX_BLOCKS} blocks, which no tape has"
            )));
        }
        if at + 2 > bytes.len() {
            if blocks.is_empty() {
                return Err(Error::Unrecognised);
            }
            warnings.push(format!("a stray byte at the end, at offset {at}"));
            break;
        }
        let len = u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize;
        at += 2;
        if len == 0 {
            empty += 1;
            continue;
        }
        let end = at + len;
        if end > bytes.len() {
            if blocks.is_empty() {
                return Err(Error::Unrecognised);
            }
            warnings.push(format!(
                "block {} is cut short: {} of its {len} bytes",
                blocks.len(),
                bytes.len() - at
            ));
        }
        let data = bytes[at..end.min(bytes.len())].to_vec();
        blocks.push(Block::Standard {
            data,
            pause_ms: rom::TAP_PAUSE_MS,
        });
        at = end;
    }
    if blocks.is_empty() {
        return Err(Error::Unrecognised);
    }
    if empty > 0 {
        warnings.push(format!(
            "{empty} block{} of no bytes, left out",
            if empty == 1 { "" } else { "s" }
        ));
    }
    Ok(Tape {
        format: Format::Tap,
        blocks,
        warnings,
    })
}

/// Writes blocks (each the flag byte, the data and the parity byte) as a TAP file.
pub fn write<B: AsRef<[u8]>>(blocks: &[B]) -> Vec<u8> {
    let mut out = Vec::new();
    for block in blocks {
        let block = block.as_ref();
        let len = block.len().min(u16::MAX as usize);
        out.extend_from_slice(&(len as u16).to_le_bytes());
        out.extend_from_slice(&block[..len]);
    }
    out
}

/// The parity byte SA-BYTES appends: every byte before it, the flag included, XORed together.
pub fn parity(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0, |a, b| a ^ b)
}

/// A block as SA-BYTES makes it from a flag and data: the flag, the data, and the parity.
pub fn block(flag: u8, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 2);
    out.push(flag);
    out.extend_from_slice(data);
    out.push(parity(&out));
    out
}
