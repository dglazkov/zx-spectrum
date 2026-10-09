//! The zx-state (.szx) format, version 1.5, as its author Jonathan Needle specifies it for Spectaculator
//! (spectaculator.com/docs/zx-state/): an 8-byte header ("ZXST", the version, the machine, a flag) and then
//! blocks, each a four-character identifier and a length, so that a reader skips what it does not know. Read and
//! written here are the blocks a Spectrum without peripherals needs: CRTR (who wrote the file), Z80R (the CPU),
//! SPCR (the ULA's and the paging ports), RAMP (a 16K RAM page, zlib-compressed or not), AY, KEYB (Issue 2, the
//! keyboard's joystick), JOY, and also ROM (a custom ROM) and TAPE (a tape file embedded in the snapshot).
//!
//! The specification's rules followed: every block is skipped by its length when unknown; the blocks may come in
//! any order; files of any minor version of major version 1 are read, the minor version deciding only which
//! fields a block has (Z80R's flags from 1.1, its MEMPTR from 1.4; KEYB's joystick from 1.1; SPCR's port FEh from
//! 1.1). One quirk of a writer is allowed for: libspectrum (Fuse's library) to version 0.5.0 wrote Z80R's AF and
//! AF' with A and F the wrong way round, as Fuse's own reader knows by the CRTR block's "libspectrum: x.y.z".

use crate::{
    Ay, AyInterface, BANK_SIZE, EmbeddedTape, Error, Joystick, Model, Registers, Snapshot, bank_from, le16, le32, need,
};

pub(crate) const MAGIC: &[u8] = b"ZXST";

/// The version written: 1.5, the specification's current one.
const MAJOR: u8 = 1;
const MINOR: u8 = 5;

/// The header's flag for the "alternate" timings, one T-state later than the usual.
const ALTERNATE_TIMINGS: u8 = 1;

/// Z80R's flags.
const SUPPRESS_INTS: u8 = 1;
const HALTED: u8 = 2;
const FSET: u8 = 4;

/// RAMP's, ROM's and TAPE's flags.
const RAMP_COMPRESSED: u16 = 1;
const TAPE_EMBEDDED: u16 = 1;
const TAPE_COMPRESSED: u16 = 2;

/// The machine identifiers this crate's models are, in the header.
fn machine_id(model: Model) -> u8 {
    match model {
        Model::Spectrum16 => 0,
        Model::Spectrum48 => 1,
        Model::Spectrum128 => 2,
        Model::Plus2 => 3,
        Model::Plus2A => 4,
        Model::Plus3 => 5,
        Model::Pentagon128 => 7,
    }
}

/// Whether the header's alternate-timings flag applies to the model: "only applicable for the ZXSTMID_16K,
/// ZXSTMID_48K and ZXSTMID_128K models".
fn has_alternate_timings(model: Model) -> bool {
    matches!(model, Model::Spectrum16 | Model::Spectrum48 | Model::Spectrum128)
}

/// Whether KEYB's Issue 2 flag applies to the model: "only applicable for the 16k or 48k ZX Spectrum. For other
/// models, set this member to 0".
fn has_issue2(model: Model) -> bool {
    !model.is_128k()
}

/// The size of a custom ROM in the ROM block, as the specification lists it for each model: the model's ROMs end
/// to end. Fuse refuses a block of any other size, and so does this reader; a machine can then rely on it.
fn rom_size(model: Model) -> usize {
    match model {
        Model::Spectrum16 | Model::Spectrum48 => 0x4000,
        Model::Spectrum128 | Model::Plus2 | Model::Pentagon128 => 0x8000,
        Model::Plus2A | Model::Plus3 => 0x10000,
    }
}

/// The model a header's machine identifier names. The +3e and 128Ke differ from the +3 and 128 only in their
/// ROMs, which the file does not hold unless it has a ROM block; the NTSC 48K is taken as a 48K, its 60 Hz frame
/// not being one this crate's models have.
fn model_for(id: u8) -> Result<Model, Error> {
    let unsupported = |what: &str| Err(Error::Unsupported(what.into()));
    Ok(match id {
        0 => Model::Spectrum16,
        1 | 15 => Model::Spectrum48,
        2 | 16 => Model::Spectrum128,
        3 => Model::Plus2,
        4 => Model::Plus2A,
        5 | 6 => Model::Plus3,
        7 => Model::Pentagon128,
        8 => return unsupported("a Timex TC2048"),
        9 => return unsupported("a Timex TC2068"),
        10 => return unsupported("a Scorpion ZS-256"),
        11 => return unsupported("a ZX Spectrum SE"),
        12 => return unsupported("a Timex TS2068"),
        13 => return unsupported("a Pentagon 512"),
        14 => return unsupported("a Pentagon 1024"),
        n => return Err(Error::Unsupported(format!("machine {n}, which the specification does not list"))),
    })
}

/// The joystick types of JOY and KEYB, which share their numbers for the kinds this crate knows.
fn joystick_for(t: u8) -> Option<Joystick> {
    match t {
        0 => Some(Joystick::Kempston),
        1 => Some(Joystick::Fuller),
        2 => Some(Joystick::Cursor),
        3 => Some(Joystick::Sinclair1),
        4 => Some(Joystick::Sinclair2),
        // 5: Comcon (JOY) or the Spectrum+'s cursor keys (KEYB); 6, 7: Timex; 8: none.
        _ => None,
    }
}

fn joystick_type(j: Option<Joystick>) -> u8 {
    match j {
        Some(Joystick::Kempston) => 0,
        Some(Joystick::Fuller) => 1,
        Some(Joystick::Cursor) => 2,
        Some(Joystick::Sinclair1) => 3,
        Some(Joystick::Sinclair2) => 4,
        None => 8,
    }
}

/// Reads a .szx snapshot.
pub fn load_szx(d: &[u8]) -> Result<Snapshot, Error> {
    need(d, 8, "a zx-state header")?;
    if !d.starts_with(MAGIC) {
        return Err(Error::Unrecognised);
    }
    let (major, minor) = (d[4], d[5]);
    if major != MAJOR {
        return Err(Error::Unsupported(format!("zx-state version {major}.{minor}, of which only 1.x is read")));
    }
    let version = (major as u16) << 8 | minor as u16;
    let model = model_for(d[6])?;
    let mut s = Snapshot::new(model);
    s.late_timings = d[7] & ALTERNATE_TIMINGS != 0 && has_alternate_timings(model);

    // The blocks, and then each in turn, the creator first: it says how to read the CPU's.
    let mut blocks = Vec::new();
    let mut at = 8;
    while at < d.len() {
        need(&d[at..], 8, "a block's header")?;
        let id: [u8; 4] = d[at..at + 4].try_into().unwrap();
        let len = le32(d, at + 4) as usize;
        let body = d.get(at + 8..(at + 8).saturating_add(len)).ok_or_else(|| {
            Error::Truncated(format!("block {} of {len} bytes runs past the end of the file", show(&id)))
        })?;
        blocks.push((id, body));
        at += 8 + len;
    }
    let swap_af = blocks.iter().any(|(id, b)| id == b"CRTR" && wrote_af_swapped(b));

    let mut z80r = false;
    let mut seen_ram = [false; 8];
    let mut keyboard_joystick = None;
    let mut joy = None;
    for (id, b) in blocks {
        let short = |n: usize| need(b, n, &format!("block {}", show(&id)));
        match &id {
            b"Z80R" => {
                short(37)?;
                let af = |at: usize| if swap_af { u16::from_be_bytes([b[at], b[at + 1]]) } else { le16(b, at) };
                let im = b[28];
                if im > 2 {
                    return Err(Error::Corrupt(format!("interrupt mode {im}")));
                }
                let flags = if version >= 0x0101 { b[34] } else { 0 };
                s.regs = Registers {
                    af: af(0),
                    bc: le16(b, 2),
                    de: le16(b, 4),
                    hl: le16(b, 6),
                    af_alt: af(8),
                    bc_alt: le16(b, 10),
                    de_alt: le16(b, 12),
                    hl_alt: le16(b, 14),
                    ix: le16(b, 16),
                    iy: le16(b, 18),
                    sp: le16(b, 20),
                    pc: le16(b, 22),
                    i: b[24],
                    r: b[25],
                    iff1: b[26] != 0,
                    iff2: b[27] != 0,
                    im,
                    // "Set to 0 (zero) if not supported": a zero is taken as not known (and a machine that
                    // starts MEMPTR at zero comes to the same).
                    memptr: Some(le16(b, 35)).filter(|&m| version >= 0x0104 && m != 0),
                    halted: flags & HALTED != 0,
                    // The specification has the two flags exclude each other: a file with both is halted (the
                    // last instruction was the HALT, not an EI), as the writer here would write it.
                    interrupts_suppressed: flags & SUPPRESS_INTS != 0 && flags & HALTED == 0,
                    flags_set: flags & FSET != 0,
                };
                // A T-state past the frame's end is that far into the next: the interrupt is then due, as it is.
                s.tstates = le32(b, 29) % model.frame_tstates();
                z80r = true;
            }
            b"SPCR" => {
                short(8)?;
                let fe = if version >= 0x0101 { b[3] & 0xF8 } else { 0 };
                s.port_fe = fe | (b[0] & 7);
                if model.is_128k() {
                    s.port_7ffd = b[1];
                }
                if model.has_1ffd() {
                    s.port_1ffd = b[2];
                }
            }
            b"RAMP" => {
                short(3)?;
                let page = b[2] as usize;
                let data = if le16(b, 0) & RAMP_COMPRESSED != 0 {
                    inflate(&b[3..], BANK_SIZE, &format!("RAM page {page}"))?
                } else {
                    need(&b[3..], BANK_SIZE, &format!("RAM page {page}"))?;
                    b[3..3 + BANK_SIZE].to_vec()
                };
                if data.len() != BANK_SIZE {
                    return Err(Error::Corrupt(format!("RAM page {page} is {} bytes, not 16,384", data.len())));
                }
                if page >= 8 {
                    return Err(Error::Corrupt(format!("RAM page {page}, which a {} does not have", model.name())));
                }
                if std::mem::replace(&mut seen_ram[page], true) {
                    return Err(Error::Corrupt(format!("RAM page {page} appears twice")));
                }
                s.ram[page] = Some(bank_from(&data));
            }
            [b'A', b'Y', 0, 0] => {
                short(18)?;
                let mut registers = [0u8; 16];
                registers.copy_from_slice(&b[2..18]);
                let interface = if model.is_128k() {
                    Some(AyInterface::BuiltIn)
                } else if b[0] & 1 != 0 {
                    Some(AyInterface::FullerBox)
                } else if b[0] & 2 != 0 {
                    Some(AyInterface::Melodik)
                } else {
                    // A 48K's AY block with neither flag: no AY is attached.
                    None
                };
                s.ay = interface.map(|interface| Ay { selected: b[1], registers, interface });
            }
            b"KEYB" => {
                short(4)?;
                s.issue2 = le32(b, 0) & 1 != 0 && has_issue2(model);
                if b.len() >= 5 {
                    keyboard_joystick = joystick_for(b[4]);
                }
            }
            [b'J', b'O', b'Y', 0] => {
                short(6)?;
                joy = Some(joystick_for(b[4]));
            }
            [b'R', b'O', b'M', 0] => {
                short(6)?;
                let size = le32(b, 2) as usize;
                if size != rom_size(model) {
                    return Err(Error::Corrupt(format!(
                        "a custom ROM of {size} bytes, where a {}'s ROMs are {}",
                        model.name(),
                        rom_size(model)
                    )));
                }
                let rom = if le16(b, 0) & RAMP_COMPRESSED != 0 {
                    inflate(&b[6..], size, "the custom ROM")?
                } else {
                    need(&b[6..], size, "the custom ROM")?;
                    b[6..6 + size].to_vec()
                };
                if rom.len() != size {
                    return Err(Error::Corrupt(format!("the custom ROM is {} bytes, not {size}", rom.len())));
                }
                s.custom_rom = Some(rom);
            }
            b"TAPE" => {
                short(28)?;
                let flags = le16(b, 2);
                // Not embedded: the block names a file on the machine that wrote it, which is not here.
                if flags & TAPE_EMBEDDED != 0 {
                    let (size, stored) = (le32(b, 4) as usize, le32(b, 8) as usize);
                    let raw = b
                        .get(28..28usize.saturating_add(stored))
                        .ok_or_else(|| Error::Truncated("the embedded tape".into()))?;
                    let data = if flags & TAPE_COMPRESSED != 0 {
                        inflate(raw, size, "the embedded tape")?
                    } else {
                        raw.to_vec()
                    };
                    let extension = b[12..28].split(|&c| c == 0).next().unwrap_or(&[]);
                    s.tape = Some(EmbeddedTape {
                        extension: String::from_utf8_lossy(extension).to_ascii_lowercase(),
                        data,
                        current_block: le16(b, 0),
                    });
                }
            }
            _ => {}
        }
    }
    if !z80r {
        return Err(Error::Corrupt("there is no Z80R block, and so no CPU".into()));
    }
    // The joystick emulated (JOY) is the machine's; the one the PC's keyboard plays (KEYB) is a fallback.
    s.joystick = joy.unwrap_or(keyboard_joystick);
    s.fit_ram_to_model();
    Ok(s)
}

/// Whether a CRTR block is libspectrum's to version 0.5.0, which wrote AF the wrong way round.
fn wrote_af_swapped(crtr: &[u8]) -> bool {
    let custom = crtr.get(36..).unwrap_or(&[]);
    let text = String::from_utf8_lossy(custom);
    let Some(at) = text.find("libspectrum: ") else { return false };
    let mut parts = text[at + 13..].split(|c: char| !c.is_ascii_digit()).map(|p| p.parse::<u32>());
    match (parts.next(), parts.next(), parts.next()) {
        (Some(Ok(0)), Some(Ok(minor)), Some(Ok(patch))) => minor < 5 || (minor == 5 && patch == 0),
        _ => false,
    }
}

/// zlib-compressed `data`, inflated to no more than `limit` bytes.
fn inflate(data: &[u8], limit: usize, what: &str) -> Result<Vec<u8>, Error> {
    miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, limit)
        .map_err(|e| Error::Corrupt(format!("{what} does not inflate: {:?}", e.status)))
}

fn show(id: &[u8; 4]) -> String {
    id.iter().map(|&c| if c.is_ascii_graphic() { c as char } else { '·' }).collect()
}

/// The AY's registers with the bits it does not have cleared, as the specification asks of a writer.
fn ay_masked(registers: &[u8; 16]) -> [u8; 16] {
    const MASKS: [u8; 16] =
        [0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF];
    std::array::from_fn(|i| registers[i] & MASKS[i])
}

/// Writes the snapshot as a version 1.5 .szx, its RAM pages zlib-compressed. Lost: the super level loader's data;
/// and what the specification gives no place to: Issue 2 on a 128K model, late timings on a model other than the
/// 16K, 48K and 128K, a custom ROM of a size other than the model's ROMs, the AY register bits the chip lacks.
pub fn save_szx(s: &Snapshot) -> Vec<u8> {
    let r = &s.regs;
    let mut out = Vec::with_capacity(64 * 1024);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&[
        MAJOR,
        MINOR,
        machine_id(s.model),
        if s.late_timings && has_alternate_timings(s.model) { ALTERNATE_TIMINGS } else { 0 },
    ]);
    let block = |out: &mut Vec<u8>, id: &[u8; 4], body: &[u8]| {
        out.extend_from_slice(id);
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(body);
    };

    let mut crtr = [0u8; 36];
    let name = b"zx-spectrum (snapshot crate)";
    crtr[..name.len()].copy_from_slice(name);
    crtr[34] = 1; // Version 0.1.
    block(&mut out, b"CRTR", &crtr);

    let mut z = Vec::with_capacity(37);
    for v in [r.af, r.bc, r.de, r.hl, r.af_alt, r.bc_alt, r.de_alt, r.hl_alt, r.ix, r.iy, r.sp, r.pc] {
        z.extend_from_slice(&v.to_le_bytes());
    }
    let t = s.tstates % s.model.frame_tstates();
    z.extend_from_slice(&[r.i, r.r, u8::from(r.iff1), u8::from(r.iff2), r.im & 3]);
    z.extend_from_slice(&t.to_le_bytes());
    // How long INT has still to be held: the rest of the model's interrupt, if the frame is that young.
    z.push(s.model.interrupt_tstates().saturating_sub(t) as u8);
    let mut flags = 0;
    if r.halted {
        flags |= HALTED;
    } else if r.interrupts_suppressed {
        flags |= SUPPRESS_INTS;
    }
    if r.flags_set {
        flags |= FSET;
    }
    z.push(flags);
    z.extend_from_slice(&r.memptr.unwrap_or(0).to_le_bytes());
    block(&mut out, b"Z80R", &z);

    let port_7ffd = if s.model.is_128k() { s.port_7ffd } else { 0 };
    let port_1ffd = if s.model.has_1ffd() { s.port_1ffd } else { 0 };
    block(&mut out, b"SPCR", &[s.port_fe & 7, port_7ffd, port_1ffd, s.port_fe, 0, 0, 0, 0]);

    if s.joystick.is_some() {
        block(&mut out, b"JOY\0", &[0, 0, 0, 0, joystick_type(s.joystick), joystick_type(None)]);
    }
    block(&mut out, b"KEYB", &[u8::from(s.issue2 && has_issue2(s.model)), 0, 0, 0, joystick_type(None)]);

    if let Some(ay) = &s.ay {
        let flags = match (s.model.is_128k(), ay.interface) {
            (true, _) | (false, AyInterface::BuiltIn) => 0,
            (false, AyInterface::FullerBox) => 1,
            (false, AyInterface::Melodik) => 2,
        };
        let mut b = vec![flags, ay.selected & 0x0F];
        b.extend_from_slice(&ay_masked(&ay.registers));
        block(&mut out, b"AY\0\0", &b);
    }

    for &bank in s.model.banks() {
        let mut b = RAMP_COMPRESSED.to_le_bytes().to_vec();
        b.push(bank as u8);
        b.extend(miniz_oxide::deflate::compress_to_vec_zlib(s.bank_or_zero(bank), 6));
        block(&mut out, b"RAMP", &b);
    }

    // A ROM of another size than the model's is no ROM the block can hold (nor a machine use), and is left out.
    if let Some(rom) = s.custom_rom.as_ref().filter(|r| r.len() == rom_size(s.model)) {
        let mut b = RAMP_COMPRESSED.to_le_bytes().to_vec();
        b.extend_from_slice(&(rom.len() as u32).to_le_bytes());
        b.extend(miniz_oxide::deflate::compress_to_vec_zlib(rom, 6));
        block(&mut out, b"ROM\0", &b);
    }

    if let Some(tape) = &s.tape {
        let packed = miniz_oxide::deflate::compress_to_vec_zlib(&tape.data, 6);
        let mut b = tape.current_block.to_le_bytes().to_vec();
        b.extend_from_slice(&(TAPE_EMBEDDED | TAPE_COMPRESSED).to_le_bytes());
        b.extend_from_slice(&(tape.data.len() as u32).to_le_bytes());
        b.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        let mut ext = [0u8; 16];
        let e = tape.extension.as_bytes();
        ext[..e.len().min(15)].copy_from_slice(&e[..e.len().min(15)]);
        b.extend_from_slice(&ext);
        b.extend(packed);
        block(&mut out, b"TAPE", &b);
    }
    out
}

#[cfg(test)]
mod tests;
