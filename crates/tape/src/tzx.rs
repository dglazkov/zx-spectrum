//! TZX 1.20: every block the format defines, the deprecated ones skipped by their lengths, and blocks it does
//! not define skipped by the length that every block added since TZX 1.10 carries in its first four bytes.
//!
//! The layout of each block is the specification's ("TZX format, revision 1.20", 19 December 2006,
//! <https://worldofspectrum.net/TZXformat.html>). Values are little-endian; texts are ISO 8859-1.

use crate::block::*;
use crate::csw;
use crate::text::latin1;
use crate::{Error, Format, MAX_BLOCKS, Tape};

/// The signature a TZX file starts with: "ZXTape!" and the end-of-text marker.
pub const SIGNATURE: &[u8; 8] = b"ZXTape!\x1A";

/// Reads a TZX file. A block cut short by the end of the file ends the tape there, with a warning; so does
/// a block that makes no sense (a CSW block whose data does not decompress, say).
pub fn parse(bytes: &[u8]) -> Result<Tape, Error> {
    if bytes.len() < 10 || &bytes[..8] != SIGNATURE {
        return Err(Error::Unrecognised);
    }
    let (major, minor) = (bytes[8], bytes[9]);
    if major != 1 {
        return Err(Error::Unsupported(format!(
            "TZX version {major}.{minor:02}"
        )));
    }
    let mut blocks = Vec::new();
    let mut warnings = Vec::new();
    let mut r = Reader { bytes, at: 10 };
    while r.at < bytes.len() {
        if blocks.len() >= MAX_BLOCKS {
            return Err(Error::Corrupt(format!(
                "more than {MAX_BLOCKS} blocks, which no tape has"
            )));
        }
        let start = r.at;
        let id = r.u8().unwrap_or(0);
        match block(id, &mut r) {
            Ok(block) => blocks.push(block),
            Err(why) => {
                warnings.push(format!(
                    "block {} (ID {id:02X}, at offset {start}): {why}; the tape ends there",
                    blocks.len()
                ));
                break;
            }
        }
    }
    Ok(Tape {
        format: Format::Tzx { major, minor },
        blocks,
        warnings,
    })
}

/// Reads one block's body, the ID already read.
fn block(id: u8, r: &mut Reader) -> Result<Block, String> {
    const SHORT: &str = "cut short by the end of the file";
    let block = match id {
        0x10 => {
            let pause_ms = r.u16()?;
            let len = r.u16()? as usize;
            Block::Standard {
                pause_ms,
                data: r.bytes(len)?.to_vec(),
            }
        }
        0x11 => {
            let pilot = r.u16()?;
            let sync1 = r.u16()?;
            let sync2 = r.u16()?;
            let zero = r.u16()?;
            let one = r.u16()?;
            let pilot_pulses = r.u16()?;
            let used_bits = r.u8()?;
            let pause_ms = r.u16()?;
            let len = r.u24()? as usize;
            let data = r.bytes(len)?.to_vec();
            Block::Turbo(Turbo {
                pilot,
                sync1,
                sync2,
                zero,
                one,
                pilot_pulses,
                used_bits,
                pause_ms,
                data,
            })
        }
        0x12 => Block::PureTone {
            pulse: r.u16()?,
            count: r.u16()?,
        },
        0x13 => {
            let n = r.u8()? as usize;
            Block::Pulses((0..n).map(|_| r.u16()).collect::<Result<_, _>>()?)
        }
        0x14 => {
            let zero = r.u16()?;
            let one = r.u16()?;
            let used_bits = r.u8()?;
            let pause_ms = r.u16()?;
            let len = r.u24()? as usize;
            Block::PureData(PureData {
                zero,
                one,
                used_bits,
                pause_ms,
                data: r.bytes(len)?.to_vec(),
            })
        }
        0x15 => {
            let tstates_per_sample = r.u16()?;
            let pause_ms = r.u16()?;
            let used_bits = r.u8()?;
            let len = r.u24()? as usize;
            let data = r.bytes(len)?.to_vec();
            Block::DirectRecording(DirectRecording {
                tstates_per_sample,
                pause_ms,
                used_bits,
                data,
            })
        }
        0x18 => {
            let len = r.u32()? as usize;
            let mut b = Reader {
                bytes: r.bytes(len)?,
                at: 0,
            };
            let pause_ms = b.u16()?;
            let sample_rate = b.u24()?;
            let compression = b.u8()?;
            let count = b.u32()?;
            let pulses = csw::decode(compression, b.rest(), count)?;
            if sample_rate == 0 {
                return Err("a CSW block with a sample rate of 0".into());
            }
            Block::Csw(Csw {
                sample_rate,
                pulses,
                pause_ms,
                initial: None,
            })
        }
        0x19 => {
            let len = r.u32()? as usize;
            Block::Generalized(generalized(&mut Reader {
                bytes: r.bytes(len)?,
                at: 0,
            })?)
        }
        0x20 => Block::Pause { ms: r.u16()? },
        0x21 => {
            let n = r.u8()? as usize;
            Block::GroupStart(latin1(r.bytes(n)?))
        }
        0x22 => Block::GroupEnd,
        0x23 => Block::Jump(r.u16()? as i16),
        0x24 => Block::LoopStart(r.u16()?),
        0x25 => Block::LoopEnd,
        0x26 => {
            let n = r.u16()? as usize;
            Block::Call(
                (0..n)
                    .map(|_| r.u16().map(|v| v as i16))
                    .collect::<Result<_, _>>()?,
            )
        }
        0x27 => Block::Return,
        0x28 => {
            let len = r.u16()? as usize;
            let mut b = Reader {
                bytes: r.bytes(len)?,
                at: 0,
            };
            let n = b.u8()?;
            let mut choices = Vec::new();
            for _ in 0..n {
                let offset = b.u16()? as i16;
                let l = b.u8()? as usize;
                choices.push(Selection {
                    offset,
                    text: latin1(b.bytes(l)?),
                });
            }
            Block::Select(choices)
        }
        0x2A => {
            let len = r.u32()? as usize;
            r.bytes(len)?;
            Block::StopIf48k
        }
        0x2B => {
            let len = r.u32()? as usize;
            let body = r.bytes(len)?;
            Block::SetLevel(body.first().is_some_and(|&l| l != 0))
        }
        0x30 => {
            let n = r.u8()? as usize;
            Block::Text(latin1(r.bytes(n)?))
        }
        0x31 => {
            let seconds = r.u8()?;
            let n = r.u8()? as usize;
            Block::Message {
                seconds,
                text: latin1(r.bytes(n)?),
            }
        }
        0x32 => {
            let len = r.u16()? as usize;
            let mut b = Reader {
                bytes: r.bytes(len)?,
                at: 0,
            };
            let n = b.u8()?;
            let mut texts = Vec::new();
            for _ in 0..n {
                let kind = b.u8()?;
                let l = b.u8()? as usize;
                texts.push((kind, latin1(b.bytes(l)?)));
            }
            Block::ArchiveInfo(texts)
        }
        0x33 => {
            let n = r.u8()? as usize;
            let mut list = Vec::new();
            for _ in 0..n {
                let e = r.bytes(3)?;
                list.push(HardwareInfo {
                    kind: e[0],
                    id: e[1],
                    info: e[2],
                });
            }
            Block::Hardware(list)
        }
        0x35 => {
            let id = latin1(r.bytes(16)?).trim_end().to_string();
            let len = r.u32()? as usize;
            Block::CustomInfo {
                id,
                data: r.bytes(len)?.to_vec(),
            }
        }
        0x5A => {
            r.bytes(9)?;
            Block::Glue
        }
        // The deprecated Commodore 64 blocks. Their first four bytes are a length that the specification
        // calls both "of the whole block" and "following the extension rule", which tools have read both
        // ways; the length of their data, further in, settles where they end.
        0x16 | 0x17 => {
            let (head, len_at) = if id == 0x16 {
                (0x28, 0x25)
            } else {
                (0x16, 0x13)
            };
            let fixed = r.peek(head).ok_or(SHORT)?;
            let data_len =
                u32::from_le_bytes([fixed[len_at], fixed[len_at + 1], fixed[len_at + 2], 0])
                    as usize;
            let len = head + data_len;
            r.bytes(len)?;
            Block::Skipped { id, len }
        }
        0x34 => {
            r.bytes(8)?;
            Block::Skipped { id, len: 8 }
        }
        0x40 => {
            let head = r.bytes(4)?;
            let len = u32::from_le_bytes([head[1], head[2], head[3], 0]) as usize;
            r.bytes(len)?;
            Block::Skipped { id, len: 4 + len }
        }
        // An ID the format does not define: since TZX 1.10 every new block starts with its length.
        _ => {
            let len = r.u32()? as usize;
            r.bytes(len)?;
            Block::Skipped { id, len: 4 + len }
        }
    };
    Ok(block)
}

/// The body of a generalized data block (0x19), after its length.
fn generalized(b: &mut Reader) -> Result<Generalized, String> {
    let pause_ms = b.u16()?;
    let totp = b.u32()?;
    let npp = b.u8()? as usize;
    let asp = alphabet(b.u8()?);
    let totd = b.u32()?;
    let npd = b.u8()? as usize;
    let asd = alphabet(b.u8()?);
    let mut pilot_symbols = Vec::new();
    let mut pilot = Vec::new();
    if totp > 0 {
        pilot_symbols = symbols(b, asp, npp)?;
        for _ in 0..totp {
            let symbol = b.u8()?;
            pilot.push((symbol, b.u16()?));
        }
    }
    let mut data_symbols = Vec::new();
    let bits_per_symbol = bits_for(asd);
    let mut data = Vec::new();
    if totd > 0 {
        data_symbols = symbols(b, asd, npd)?;
        let len = (bits_per_symbol as u64 * totd as u64).div_ceil(8) as usize;
        data = b.bytes(len)?.to_vec();
    }
    Ok(Generalized {
        pause_ms,
        pilot_symbols,
        pilot,
        data_symbols,
        data_count: totd,
        bits_per_symbol,
        data,
    })
}

/// An alphabet's size: 0 means 256.
fn alphabet(n: u8) -> u16 {
    if n == 0 { 256 } else { n as u16 }
}

/// A table of `count` symbols of up to `max` pulses each; a zero ends a shorter one.
fn symbols(b: &mut Reader, count: u16, max: usize) -> Result<Vec<Symbol>, String> {
    let mut table = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let polarity = b.u8()? & 3;
        let mut pulses = Vec::with_capacity(max);
        let mut ended = false;
        for _ in 0..max {
            let p = b.u16()?;
            ended |= p == 0;
            if !ended {
                pulses.push(p);
            }
        }
        table.push(Symbol { polarity, pulses });
    }
    Ok(table)
}

/// Little-endian fields from a slice, each failing when the slice ends first.
pub(crate) struct Reader<'a> {
    pub bytes: &'a [u8],
    pub at: usize,
}

impl<'a> Reader<'a> {
    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(n).filter(|&e| e <= self.bytes.len());
        let end = end.ok_or_else(|| "cut short by the end of the file".to_string())?;
        let s = &self.bytes[self.at..end];
        self.at = end;
        Ok(s)
    }
    pub fn peek(&self, n: usize) -> Option<&'a [u8]> {
        self.bytes.get(self.at..self.at.checked_add(n)?)
    }
    pub fn rest(&mut self) -> &'a [u8] {
        let s = &self.bytes[self.at..];
        self.at = self.bytes.len();
        s
    }
    pub fn u8(&mut self) -> Result<u8, String> {
        Ok(self.bytes(1)?[0])
    }
    pub fn u16(&mut self) -> Result<u16, String> {
        let b = self.bytes(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    pub fn u24(&mut self) -> Result<u32, String> {
        let b = self.bytes(3)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], 0]))
    }
    pub fn u32(&mut self) -> Result<u32, String> {
        let b = self.bytes(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
}
