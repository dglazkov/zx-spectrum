//! CSW, Ramsoft's "compressed square wave": a recording kept as the lengths of its pulses, in samples.
//!
//! From the specification ("CSW format, revision 2.00", Ramsoft, 1 August 2003; kept at
//! <https://k1.spdns.de/Develop/Projects/zxsp/Info/File%20Formats/CSW%20technical%20specifications.html>):
//! version 1.01 has a 32-byte header with a 16-bit sample rate and RLE only; version 2 has a 52-byte header
//! (plus an extension of a length it gives) with a 32-bit sample rate, the count of pulses, and RLE or Z-RLE,
//! which is the RLE stream deflated with zlib. Bit 0 of the flags is the level of the first pulse.
//!
//! RLE: a byte from 1 to 255 is a pulse of that many samples; a 0 is followed by a 32-bit length.

use crate::block::{Block, Csw};
use crate::{Error, Format, Tape};

/// The signature a CSW file starts with, and the end-of-text marker after it.
pub const SIGNATURE: &[u8; 23] = b"Compressed Square Wave\x1A";

/// The most a Z-RLE stream may inflate to: a recording of hours at 44.1 kHz is a few megabytes.
const INFLATE_LIMIT: usize = 256 << 20;

/// Reads a CSW file, version 1 or 2, as a tape of one block.
pub fn parse(bytes: &[u8]) -> Result<Tape, Error> {
    if bytes.len() < 0x20 || &bytes[..23] != SIGNATURE {
        return Err(Error::Unrecognised);
    }
    let (major, minor) = (bytes[0x17], bytes[0x18]);
    let le32 =
        |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (rate, compression, flags, count, data) = match major {
        1 => (
            u16::from_le_bytes([bytes[0x19], bytes[0x1A]]) as u32,
            bytes[0x1B],
            bytes[0x1C],
            None,
            &bytes[0x20..],
        ),
        2 => {
            if bytes.len() < 0x34 {
                return Err(Error::Corrupt("the CSW header is cut short".into()));
            }
            let start = 0x34 + bytes[0x23] as usize;
            if start > bytes.len() {
                return Err(Error::Corrupt(
                    "the CSW header extension is cut short".into(),
                ));
            }
            (
                le32(0x19),
                bytes[0x21],
                bytes[0x22],
                Some(le32(0x1D)),
                &bytes[start..],
            )
        }
        _ => {
            return Err(Error::Unsupported(format!(
                "CSW version {major}.{minor:02}"
            )));
        }
    };
    if rate == 0 {
        return Err(Error::Corrupt("a sample rate of 0".into()));
    }
    let pulses = decode(compression, data, count.unwrap_or(0)).map_err(Error::Corrupt)?;
    let mut warnings = Vec::new();
    if let Some(count) = count
        && count as usize != pulses.len()
    {
        warnings.push(format!(
            "the header counts {count} pulses, and the data holds {}",
            pulses.len()
        ));
    }
    let block = Block::Csw(Csw {
        sample_rate: rate,
        pulses,
        pause_ms: 0,
        initial: Some(flags & 1 != 0),
    });
    Ok(Tape {
        format: Format::Csw { major, minor },
        blocks: vec![block],
        warnings,
    })
}

/// The pulses of CSW data compressed as `compression` (1 RLE, 2 Z-RLE). `count`, the number of pulses the
/// header says there are, only sizes the result.
pub(crate) fn decode(compression: u8, data: &[u8], count: u32) -> Result<Vec<u32>, String> {
    let inflated;
    let rle = match compression {
        1 => data,
        2 => {
            // zlib's format, as the specification's reference code writes it; a raw deflate stream is taken
            // too, as some tools have written that.
            inflated = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, INFLATE_LIMIT)
                .or_else(|_| {
                    miniz_oxide::inflate::decompress_to_vec_with_limit(data, INFLATE_LIMIT)
                })
                .map_err(|e| format!("the Z-RLE data does not inflate ({:?})", e.status))?;
            &inflated
        }
        c => return Err(format!("compression type {c}, which CSW does not define")),
    };
    let mut pulses = Vec::with_capacity((count as usize).min(rle.len()));
    let mut at = 0;
    while at < rle.len() {
        let b = rle[at];
        at += 1;
        if b != 0 {
            pulses.push(b as u32);
        } else {
            let long = rle
                .get(at..at + 4)
                .ok_or("a long pulse cut short at the end of the data")?;
            pulses.push(u32::from_le_bytes([long[0], long[1], long[2], long[3]]));
            at += 4;
        }
    }
    Ok(pulses)
}

/// Pulses as RLE: what compression 1 holds, each pulse a byte or a 0 and four bytes.
pub fn encode_rle(pulses: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pulses.len());
    for &p in pulses {
        if (1..=255).contains(&p) {
            out.push(p as u8);
        } else {
            out.push(0);
            out.extend_from_slice(&p.to_le_bytes());
        }
    }
    out
}
