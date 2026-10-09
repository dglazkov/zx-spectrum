//! PZX, Patrik Rak's "perfect ZX tape": pulses, each block stating the level it starts at.
//!
//! From the specification ("PZX file format version 1.0", 28 June 2007, <http://zxds.raxoft.cz/docs/pzx.txt>):
//! a file is a sequence of blocks, each a four-letter tag, a 32-bit size and that many bytes. PZXT (the
//! header, first), PULS, DATA and PAUS are what every implementation must read; BRWS and STOP are read too.
//! A block of any other tag is skipped, as the specification asks.

use crate::block::*;
use crate::{Error, Format, Tape};

/// The tag a PZX file starts with.
pub const SIGNATURE: &[u8; 4] = b"PZXT";

/// Reads a PZX file.
pub fn parse(bytes: &[u8]) -> Result<Tape, Error> {
    if bytes.len() < 8 || &bytes[..4] != SIGNATURE {
        return Err(Error::Unrecognised);
    }
    let mut blocks = Vec::new();
    let mut warnings = Vec::new();
    let (mut major, mut minor) = (1, 0);
    let mut at = 0;
    while at < bytes.len() {
        if at + 8 > bytes.len() {
            warnings.push(format!("a block header cut short at offset {at}"));
            break;
        }
        let tag = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
        let size = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]])
            as usize;
        let body_at = at + 8;
        let Some(body) = body_at
            .checked_add(size)
            .and_then(|end| bytes.get(body_at..end))
        else {
            warnings.push(format!(
                "block {} ({}) is cut short; the tape ends there",
                blocks.len(),
                name(&tag)
            ));
            break;
        };
        at = body_at + size;
        let block = match &tag {
            b"PZXT" => {
                if body.len() < 2 {
                    warnings.push("a PZXT block too short for its version".into());
                    continue;
                }
                if body[0] != 1 {
                    return Err(Error::Unsupported(format!(
                        "PZX version {}.{}",
                        body[0], body[1]
                    )));
                }
                (major, minor) = (body[0], body[1]);
                header(body)
            }
            b"PULS" => Block::PzxPulses(pulses(body)),
            b"DATA" => match data(body) {
                Some(d) => Block::PzxData(d),
                None => {
                    warnings.push(format!(
                        "block {}: a DATA block shorter than its contents",
                        blocks.len()
                    ));
                    continue;
                }
            },
            b"PAUS" if body.len() >= 4 => {
                let v = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                Block::PzxPause {
                    duration: v & 0x7FFF_FFFF,
                    high: v >> 31 != 0,
                }
            }
            b"BRWS" => Block::Browse(String::from_utf8_lossy(body).into_owned()),
            // Flags 1 stops a 48K only; anything else, as the specification asks, always.
            b"STOP" if body.len() >= 2 => {
                if u16::from_le_bytes([body[0], body[1]]) == 1 {
                    Block::StopIf48k
                } else {
                    Block::Pause { ms: 0 }
                }
            }
            _ => continue,
        };
        blocks.push(block);
    }
    Ok(Tape {
        format: Format::Pzx { major, minor },
        blocks,
        warnings,
    })
}

fn name(tag: &[u8; 4]) -> String {
    String::from_utf8_lossy(tag).into_owned()
}

/// PZXT: the version, then strings ended by a zero (or by the block's end): the title, then keys and values.
fn header(body: &[u8]) -> Block {
    // The zero that ends the last string, when it has one, starts no string after it.
    let rest = &body[2..];
    let rest = rest.strip_suffix(&[0]).unwrap_or(rest);
    let mut strings = rest
        .split(|&b| b == 0)
        .map(|s| String::from_utf8_lossy(s).into_owned());
    let title = strings.next().unwrap_or_default();
    let mut info = Vec::new();
    while let Some(key) = strings.next() {
        info.push((key, strings.next().unwrap_or_default()));
    }
    Block::PzxHeader {
        major: body[0],
        minor: body[1],
        title,
        info,
    }
}

/// PULS: each pulse an optional repeat count (bit 15 set) and a duration of 15 bits, or of 31 bits over two
/// words when bit 15 of the first is set; decoded as the specification's own pseudocode does.
fn pulses(body: &[u8]) -> Vec<PzxPulse> {
    let words: Vec<u16> = body
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&w| u16::from_le_bytes(w))
        .collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let mut count = 1;
        let mut duration = words[i] as u32;
        i += 1;
        if duration > 0x8000 {
            count = (duration & 0x7FFF) as u16;
            let Some(&d) = words.get(i) else { break };
            duration = d as u32;
            i += 1;
        }
        if duration >= 0x8000 {
            let Some(&low) = words.get(i) else { break };
            duration = (duration & 0x7FFF) << 16 | low as u32;
            i += 1;
        }
        out.push(PzxPulse { count, duration });
    }
    out
}

/// DATA: the bit count and initial level, the tail, the two pulse sequences, the bits.
fn data(body: &[u8]) -> Option<PzxData> {
    let head = body.get(..8)?;
    let count = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let tail = u16::from_le_bytes([head[4], head[5]]);
    let (p0, p1) = (head[6] as usize, head[7] as usize);
    let seq = |from: usize, n: usize| -> Option<Vec<u16>> {
        let s = body.get(from..from + 2 * n)?;
        Some(
            s.as_chunks::<2>()
                .0
                .iter()
                .map(|&w| u16::from_le_bytes(w))
                .collect(),
        )
    };
    let zero = seq(8, p0)?;
    let one = seq(8 + 2 * p0, p1)?;
    let bits = count & 0x7FFF_FFFF;
    let from = 8 + 2 * (p0 + p1);
    let data = body.get(from..from + (bits as usize).div_ceil(8))?.to_vec();
    Some(PzxData {
        initial_high: count >> 31 != 0,
        bits,
        tail,
        zero,
        one,
        data,
    })
}
