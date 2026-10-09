//! The .z80 format, versions 1, 2 and 3, as the .z80 page on World of Spectrum documents it
//! (worldofspectrum.org/faq/reference/z80format.htm, from Gerton Lunter's own documentation of his emulator Z80),
//! with the extensions other emulators made to it and that page lists: more hardware modes (+3, Pentagon, +2,
//! +2A...), Spectaculator's "modify hardware" bit (byte 37, bit 7: a 48K becomes a 16K, a 128K a +2, a +3 a
//! +2A), the AY on a 48K (bit 2, with bit 6 for the Fuller Box), port 1FFDh in a 55-byte version 3 header, and
//! Damien Burke's super level loader data after the pages (.slt).
//!
//! Version 1 is a 30-byte header and the 48K, compressed or not. Versions 2 and 3 set the header's PC to zero,
//! follow it with a second header (23 bytes long in version 2; 54, or 55 with 1FFDh, in version 3) and then 16K
//! pages, each with its compressed length (FFFFh: not compressed) and its number. The hardware mode in byte 34
//! means different machines in versions 2 and 3 for values 3 to 6.

use crate::{
    Ay, AyInterface, BANK_SIZE, Bank, Error, Joystick, Model, Registers, SCREEN_SIZE, Slt, Snapshot, bank_from, le16,
    le32, need, rle,
};

/// The length of the first header, and of the second header in each version.
const V1_HEADER: usize = 30;
const V2_EXTRA: usize = 23;
const V3_EXTRA: usize = 54;
const V3_EXTRA_1FFD: usize = 55;

/// What follows the last page of a super level loader snapshot: three zero bytes (an empty page header, at which
/// an old reader stops) and "SLT".
const SLT_SIGNATURE: &[u8] = b"\0\0\0SLT";

/// Whether `d` has the shape of a .z80: a version 2 or 3 header of a known length, or a version 1 file whose
/// 48K decompresses (or, uncompressed, is all there).
pub(crate) fn plausible(d: &[u8]) -> bool {
    if d.len() < V1_HEADER + 2 {
        return false;
    }
    if le16(d, 6) == 0 {
        return matches!(le16(d, 30) as usize, V2_EXTRA | V3_EXTRA | V3_EXTRA_1FFD);
    }
    if flag_byte(d) & 0x20 != 0 { rle::decompress_48k(&d[V1_HEADER..]).is_ok() } else { d.len() >= V1_HEADER + 0xC000 }
}

/// Whether `d` is a .z80 by a structure that leaves no doubt, as unzip's sniffer has it: a version 2 or 3 header
/// whose pages run end to end to the end of the file (or to the super level loader's signature); or a compressed
/// version 1 file whose 48K decompresses to just before the end marker that ends it. A file of a .sna's size that
/// is this is taken for a .z80: a compressed .z80 can come out at any length, a .sna's among them.
pub(crate) fn conclusive(d: &[u8]) -> bool {
    if d.len() < V1_HEADER + 2 {
        return false;
    }
    if le16(d, 6) != 0 {
        return flag_byte(d) & 0x20 != 0
            && d.ends_with(&[0x00, 0xED, 0xED, 0x00])
            && rle::decompress_48k(&d[V1_HEADER..]).is_ok_and(|(_, used)| V1_HEADER + used == d.len());
    }
    let extra = le16(d, 30) as usize;
    if !matches!(extra, V2_EXTRA | V3_EXTRA | V3_EXTRA_1FFD) {
        return false;
    }
    let mut at = V1_HEADER + 2 + extra;
    let mut pages = 0;
    while at < d.len() {
        if d[at..].starts_with(SLT_SIGNATURE) {
            return pages > 0;
        }
        let Some(h) = d.get(at..at + 3) else { return false };
        let len = match u16::from_le_bytes([h[0], h[1]]) {
            0xFFFF => BANK_SIZE,
            n => n as usize,
        };
        if h[2] > 18 || at + 3 + len > d.len() {
            return false;
        }
        at += 3 + len;
        pages += 1;
    }
    pages > 0
}

/// Byte 12, which "has to be regarded as being 1" when it is FFh (old files).
fn flag_byte(d: &[u8]) -> u8 {
    if d[12] == 0xFF { 1 } else { d[12] }
}

/// Reads a .z80 snapshot of any version.
pub fn load_z80(d: &[u8]) -> Result<Snapshot, Error> {
    need(d, V1_HEADER, "a .z80 header")?;
    let b12 = flag_byte(d);
    let im = d[29] & 3;
    if im == 3 {
        return Err(Error::Corrupt("interrupt mode 3".into()));
    }
    let regs = Registers {
        af: u16::from_be_bytes([d[0], d[1]]),
        bc: le16(d, 2),
        hl: le16(d, 4),
        pc: le16(d, 6),
        sp: le16(d, 8),
        i: d[10],
        r: (d[11] & 0x7F) | (b12 << 7),
        de: le16(d, 13),
        bc_alt: le16(d, 15),
        de_alt: le16(d, 17),
        hl_alt: le16(d, 19),
        af_alt: u16::from_be_bytes([d[21], d[22]]),
        iy: le16(d, 23),
        ix: le16(d, 25),
        iff1: d[27] != 0,
        iff2: d[28] != 0,
        im,
        ..Registers::default()
    };
    let joystick_bits = d[29] >> 6;

    if regs.pc != 0 {
        // Version 1: a 48K, its memory from 4000h after the header.
        let mut s = Snapshot::new(Model::Spectrum48);
        s.regs = regs;
        s.port_fe = (b12 >> 1) & 7;
        s.issue2 = d[29] & 4 != 0;
        s.joystick = joystick_v1(joystick_bits);
        let data = &d[V1_HEADER..];
        let ram = if b12 & 0x20 != 0 {
            rle::decompress_48k(data)?.0
        } else {
            need(data, 0xC000, "an uncompressed version 1 file's 48K")?;
            data[..0xC000].to_vec()
        };
        for (i, bank) in [5, 2, 0].into_iter().enumerate() {
            s.ram[bank] = Some(bank_from(&ram[i * BANK_SIZE..(i + 1) * BANK_SIZE]));
        }
        return Ok(s);
    }

    need(d, V1_HEADER + 2, "a version 2 or 3 header's length")?;
    let extra = le16(d, 30) as usize;
    let version = match extra {
        V2_EXTRA => 2,
        V3_EXTRA | V3_EXTRA_1FFD => 3,
        n => return Err(Error::Corrupt(format!("a second header of {n} bytes, which no version has"))),
    };
    let start = V1_HEADER + 2 + extra;
    need(d, start, "the second header")?;
    let mode = d[34];
    let b37 = d[37];
    let model = model_for(version, mode, b37 & 0x80 != 0)?;

    let mut s = Snapshot::new(model);
    s.regs = Registers { pc: le16(d, 32), ..regs };
    s.port_fe = (b12 >> 1) & 7;
    s.issue2 = d[29] & 4 != 0;
    s.joystick = if version == 2 { joystick_v1(joystick_bits) } else { joystick_v3(joystick_bits, &d[63..73]) };
    if model.is_128k() {
        s.port_7ffd = d[35];
    }
    let mut registers = [0u8; 16];
    registers.copy_from_slice(&d[39..55]);
    let interface = if model.is_128k() {
        Some(AyInterface::BuiltIn)
    } else if b37 & 0x04 != 0 {
        Some(if b37 & 0x40 != 0 { AyInterface::FullerBox } else { AyInterface::Melodik })
    } else {
        None
    };
    s.ay = interface.map(|interface| Ay { selected: d[38], registers, interface });
    if version == 3 {
        s.tstates = decode_tstates(model, le16(d, 55), d[57]);
    }
    if extra == V3_EXTRA_1FFD && model.has_1ffd() {
        s.port_1ffd = d[86];
    }

    // The pages, each mapped to the bank it is by the model's numbering.
    let mut seen = [false; 8];
    let mut at = start;
    while at < d.len() {
        if d[at..].starts_with(SLT_SIGNATURE) {
            s.slt = Some(read_slt(&d[at + SLT_SIGNATURE.len()..])?);
            break;
        }
        if d.len() - at < 3 {
            // A byte or two after the last page: nothing a reader can make a page of, and harmless.
            break;
        }
        let len = le16(d, at);
        let page = d[at + 2];
        at += 3;
        let (data, used) = read_page(&d[at..], len, page)?;
        at += used;
        let Some(bank) = bank_for(model, page)? else { continue };
        if std::mem::replace(&mut seen[bank], true) {
            return Err(Error::Corrupt(format!("page {page} appears twice")));
        }
        s.ram[bank] = Some(data);
    }
    s.fit_ram_to_model();
    Ok(s)
}

/// The machine a version 2 or 3 file's hardware mode (byte 34) names, with byte 37's bit 7 ("modify hardware").
fn model_for(version: u8, mode: u8, modified: bool) -> Result<Model, Error> {
    let unsupported = |what: &str| Err(Error::Unsupported(what.into()));
    let model = match (version, mode) {
        // 48K, with Interface 1, with SamRam (whose ROMs and shadow pages are not kept), with an M.G.T. disk
        // interface: the Spectrum is a 48K in each.
        (_, 0..=2) | (3, 3) => Model::Spectrum48,
        // Version 2's 128K and 128K with Interface 1; version 3's 128K, with Interface 1, with M.G.T.
        (2, 3 | 4) | (3, 4..=6) => Model::Spectrum128,
        (2, 5 | 6) => return Err(Error::Corrupt(format!("hardware mode {mode}, which version 2 does not have"))),
        // The extensions, in either version.
        (_, 7 | 8) => Model::Plus3, // 8: XZX-Pro's mistaken +3.
        (_, 9) => Model::Pentagon128,
        (_, 10) => return unsupported("a Scorpion ZS-256"),
        (_, 11) => return unsupported("a Didaktik Kompakt"),
        (_, 12) => Model::Plus2,
        (_, 13) => Model::Plus2A,
        (_, 14) => return unsupported("a Timex TC2048"),
        (_, 15) => return unsupported("a Timex TC2068"),
        (_, 128) => return unsupported("a Timex TS2068"),
        (_, m) => {
            return Err(Error::Unsupported(format!("a machine of hardware mode {m}, which no emulator documents")));
        }
    };
    Ok(match (modified, model) {
        (true, Model::Spectrum48) => Model::Spectrum16,
        (true, Model::Spectrum128) => Model::Plus2,
        (true, Model::Plus3) => Model::Plus2A,
        (_, m) => m,
    })
}

/// The RAM bank a page holds, or None for a page that is not RAM the model has (a ROM, the Multiface's).
fn bank_for(model: Model, page: u8) -> Result<Option<usize>, Error> {
    if page > 18 {
        return Err(Error::Corrupt(format!("page {page}, which no machine has")));
    }
    Ok(if model.is_128k() {
        // Pages 3 to 10 are banks 0 to 7; 0 to 2 are ROMs, 11 the Multiface's ROM, 12 to 18 a Scorpion's RAM.
        (3..=10).contains(&page).then(|| page as usize - 3)
    } else {
        // In 48K mode, page 8 is 4000h, 4 is 8000h and 5 is C000h.
        match page {
            8 => Some(5),
            4 => Some(2),
            5 => Some(0),
            _ => None,
        }
    })
}

/// A page's 16K from its data, `len` bytes of it compressed (or 16,384 uncompressed when `len` is FFFFh), and how
/// many bytes of `src` it took.
fn read_page(src: &[u8], len: u16, page: u8) -> Result<(Box<Bank>, usize), Error> {
    if len == 0xFFFF {
        need(src, BANK_SIZE, &format!("page {page}"))?;
        return Ok((bank_from(&src[..BANK_SIZE]), BANK_SIZE));
    }
    let len = len as usize;
    need(src, len, &format!("page {page}"))?;
    let data = rle::decompress(&src[..len]);
    match data {
        Ok(data) if data.len() == BANK_SIZE => Ok((bank_from(&data), len)),
        // Some writers store an uncompressed page with its true length rather than FFFFh.
        _ if len == BANK_SIZE => Ok((bank_from(&src[..BANK_SIZE]), len)),
        Ok(data) => Err(Error::Corrupt(format!("page {page} decompresses to {} bytes, not 16,384", data.len()))),
        Err(e) => Err(e),
    }
}

/// The T-state in the frame from version 3's counter: "The hi T state counter counts up modulo 4. Just after the
/// ULA generates its once-in-every-20-ms interrupt, it is 3, and is increased by one every 5 emulated
/// milliseconds. In these 1/200s intervals, the low T state counter counts down from 17471 to 0 (17726 in 128K
/// modes)". So in each quarter frame q (0 to 3) the high counter is (q + 3) mod 4, and the low one is the quarter's
/// length less one, less the T-states into it: t = (q + 1) × quarter − (low + 1).
///
/// Some files' low counter is larger than a quarter (4 of the 117 version 3 files in a survey of the archive's:
/// docs/snapshot.md). The same sum then counts back into an earlier quarter, as Fuse's reader (libspectrum's
/// z80.c) has it, and this follows the de facto reader; a sum that falls outside the frame altogether gives 0.
fn decode_tstates(model: Model, low: u16, high: u8) -> u32 {
    let quarter = model.frame_tstates() as i64 / 4;
    let q = (high as i64 + 1) % 4;
    let t = (q + 1) * quarter - (low as i64 + 1);
    u32::try_from(t).ok().filter(|&t| t < model.frame_tstates()).unwrap_or(0)
}

/// Version 3's counter for T-state `t` of the frame: (low, high).
fn encode_tstates(model: Model, t: u32) -> (u16, u8) {
    let quarter = model.frame_tstates() / 4;
    let t = t % model.frame_tstates();
    ((quarter - 1 - t % quarter) as u16, ((t / quarter + 3) % 4) as u8)
}

/// Byte 29's joystick in versions 1 and 2: cursor, Kempston, and the Interface 2's left port (keys 1 to 5) and
/// right port (keys 6 to 0).
fn joystick_v1(bits: u8) -> Option<Joystick> {
    Some(match bits {
        0 => Joystick::Cursor,
        1 => Joystick::Kempston,
        2 => Joystick::Sinclair2,
        _ => Joystick::Sinclair1,
    })
}

/// Byte 29's joystick in version 3, where 2 is "user defined": the keys at bytes 63 to 72, which this reads as
/// the Interface 2 or cursor joystick when they are its keys, and as no joystick otherwise.
fn joystick_v3(bits: u8, keys: &[u8]) -> Option<Joystick> {
    match bits {
        0 => Some(Joystick::Cursor),
        1 => Some(Joystick::Kempston),
        3 => Some(Joystick::Sinclair1),
        _ => {
            let mapped: Vec<(u8, u8)> = keys.chunks(2).map(|k| (k[0], k[1])).collect();
            if mapped == FUSE_SINCLAIR2 {
                return Some(Joystick::Sinclair2);
            }
            [Joystick::Sinclair2, Joystick::Sinclair1, Joystick::Cursor]
                .into_iter()
                .find(|j| mapped == user_keys(*j).map(|(row, mask, _)| (row, mask)))
        }
    }
}

/// The user-defined keys Fuse (libspectrum's z80.c, `if2_left_map_*`) writes for Interface 2's left port, keys 1
/// to 5, and reads back as that joystick: half-row 3, but with masks 0Fh, 08h, 04h, 02h, 01h rather than the
/// documentation's 01h to 10h. Its ASCII words say '1' to '5'; the masks are its own, and only it reads them so.
const FUSE_SINCLAIR2: [(u8, u8); 5] = [(3, 0x0F), (3, 0x08), (3, 0x04), (3, 0x02), (3, 0x01)];

/// The keys a joystick presses, for version 3's user-defined joystick, in its order (left, right, down, up,
/// fire): (half-row, bit mask, the key's character). The half-rows are numbered as docs/architecture.md numbers
/// them, and the masks are the documentation's ("Enter ... is stored as 0x0106 (row 6 and column 1)").
fn user_keys(joystick: Joystick) -> [(u8, u8, u8); 5] {
    match joystick {
        // 1 2 3 4 5: half-row 3 (F7FEh), bits 0 to 4.
        Joystick::Sinclair2 => [(3, 0x01, b'1'), (3, 0x02, b'2'), (3, 0x04, b'3'), (3, 0x08, b'4'), (3, 0x10, b'5')],
        // 6 7 8 9 0: half-row 4 (EFFEh), whose bits run 0 9 8 7 6.
        Joystick::Sinclair1 => [(4, 0x10, b'6'), (4, 0x08, b'7'), (4, 0x04, b'8'), (4, 0x02, b'9'), (4, 0x01, b'0')],
        // 5 8 6 7 0.
        _ => [(3, 0x10, b'5'), (4, 0x04, b'8'), (4, 0x10, b'6'), (4, 0x08, b'7'), (4, 0x01, b'0')],
    }
}

/// The super level loader's table and data, after its signature: entries of a type (0 ends the table, 1 is a
/// level, 3 the loading screen; others are skipped, as the format asks), an identifier and a length, then the
/// data of each in the table's order, compressed as pages are (a screen of exactly 6,912 bytes is not).
fn read_slt(d: &[u8]) -> Result<Slt, Error> {
    let mut entries = Vec::new();
    let mut at = 0;
    loop {
        need(d, at + 8, "the super level loader's table")?;
        let (kind, id, len) = (le16(d, at), le16(d, at + 2), le32(d, at + 4) as usize);
        at += 8;
        if kind == 0 {
            break;
        }
        entries.push((kind, id, len));
    }
    let mut slt = Slt::default();
    for (kind, id, len) in entries {
        let data = d
            .get(at..at.saturating_add(len))
            .ok_or_else(|| Error::Truncated(format!("level data of {len} bytes is not all there")))?;
        at += len;
        match kind {
            1 => {
                let level = u8::try_from(id).map_err(|_| Error::Corrupt(format!("level {id}")))?;
                if slt.levels.insert(level, rle::decompress(data)?).is_some() {
                    return Err(Error::Corrupt(format!("level {level} appears twice")));
                }
            }
            3 => {
                let screen = if len == SCREEN_SIZE { data.to_vec() } else { rle::decompress(data)? };
                let screen: Box<crate::Screen> = screen
                    .into_boxed_slice()
                    .try_into()
                    .map_err(|_| Error::Corrupt("the super level loader's screen is not 6,912 bytes".into()))?;
                slt.screen = Some(screen);
            }
            _ => {}
        }
    }
    Ok(slt)
}

/// Writes the snapshot as a version 3 .z80, with the 55-byte header that keeps 1FFDh on the +2A and +3. What the
/// format cannot keep is lost: MEMPTR, the halted and suppressed-interrupt flags, EAR and MIC, late timings, an
/// embedded tape, a custom ROM, the Fuller joystick.
pub fn save_z80(s: &Snapshot) -> Vec<u8> {
    let r = &s.regs;
    let extra = if s.model.has_1ffd() { V3_EXTRA_1FFD } else { V3_EXTRA };
    let mut h = vec![0u8; V1_HEADER + 2 + extra];
    let put16 = |h: &mut Vec<u8>, at: usize, v: u16| h[at..at + 2].copy_from_slice(&v.to_le_bytes());
    h[0..2].copy_from_slice(&r.af.to_be_bytes());
    put16(&mut h, 2, r.bc);
    put16(&mut h, 4, r.hl);
    // PC at 6 stays zero: that is what says version 2 or 3.
    put16(&mut h, 8, r.sp);
    h[10] = r.i;
    h[11] = r.r & 0x7F;
    h[12] = (r.r >> 7) | ((s.port_fe & 7) << 1);
    put16(&mut h, 13, r.de);
    put16(&mut h, 15, r.bc_alt);
    put16(&mut h, 17, r.de_alt);
    put16(&mut h, 19, r.hl_alt);
    h[21..23].copy_from_slice(&r.af_alt.to_be_bytes());
    put16(&mut h, 23, r.iy);
    put16(&mut h, 25, r.ix);
    h[27] = if r.iff1 { 0xFF } else { 0 };
    h[28] = if r.iff2 { 0xFF } else { 0 };
    let joystick = match s.joystick {
        Some(Joystick::Kempston) => 1,
        Some(Joystick::Sinclair2) => 2,
        Some(Joystick::Sinclair1) => 3,
        _ => 0,
    };
    h[29] = (r.im & 3) | (u8::from(s.issue2) << 2) | (joystick << 6);

    put16(&mut h, 30, extra as u16);
    put16(&mut h, 32, r.pc);
    // The hardware mode, and whether bit 7 of byte 37 modifies it, as Spectaculator wrote a 16K, +2 and +2A:
    // a reader that does not know the bit still finds the nearest machine it does know.
    let (mode, modified) = match s.model {
        Model::Spectrum16 => (0, true),
        Model::Spectrum48 => (0, false),
        Model::Spectrum128 => (4, false),
        Model::Plus2 => (4, true),
        Model::Plus2A => (7, true),
        Model::Plus3 => (7, false),
        Model::Pentagon128 => (9, false),
    };
    h[34] = mode;
    h[35] = if s.model.is_128k() { s.port_7ffd } else { 0 };
    let mut b37 = if modified { 0x80 } else { 0 };
    if let Some(ay) = &s.ay {
        if !s.model.is_128k() {
            b37 |= match ay.interface {
                AyInterface::FullerBox => 0x44,
                _ => 0x04,
            };
        }
        h[38] = ay.selected;
        h[39..55].copy_from_slice(&ay.registers);
    }
    h[37] = b37;
    let (low, high) = encode_tstates(s.model, s.tstates);
    put16(&mut h, 55, low);
    h[57] = high;
    // Bytes 61 and 62: FFh where 0000h-1FFFh and 2000h-3FFFh are ROM, 0 where RAM (the +2A/+3's special paging).
    let rom = if s.paged_bank(0).is_some() { 0 } else { 0xFF };
    h[61] = rom;
    h[62] = rom;
    if s.joystick == Some(Joystick::Sinclair2) {
        for (i, (row, mask, key)) in user_keys(Joystick::Sinclair2).into_iter().enumerate() {
            h[63 + 2 * i] = row;
            h[64 + 2 * i] = mask;
            h[73 + 2 * i] = key;
        }
    }
    if extra == V3_EXTRA_1FFD {
        h[86] = s.port_1ffd;
    }

    let pages: Vec<(u8, usize)> = if s.model.is_128k() {
        (0..8).map(|bank| (bank as u8 + 3, bank)).collect()
    } else {
        // A 16K is written as a 48K's three pages, so that a reader that does not know bit 7 still has them.
        vec![(4, 2), (5, 0), (8, 5)]
    };
    for (page, bank) in pages {
        write_page(&mut h, page, s.bank_or_zero(bank));
    }
    if let Some(slt) = &s.slt {
        write_slt(&mut h, slt);
    }
    h
}

/// A page: compressed, unless that would not make it smaller.
fn write_page(out: &mut Vec<u8>, page: u8, data: &Bank) {
    let c = rle::compress(data);
    if c.len() < BANK_SIZE {
        out.extend_from_slice(&(c.len() as u16).to_le_bytes());
        out.push(page);
        out.extend_from_slice(&c);
    } else {
        out.extend_from_slice(&[0xFF, 0xFF, page]);
        out.extend_from_slice(data);
    }
}

fn write_slt(out: &mut Vec<u8>, slt: &Slt) {
    let mut table = Vec::new();
    let mut data = Vec::new();
    let mut entry = |kind: u16, id: u16, bytes: &[u8]| {
        table.extend_from_slice(&kind.to_le_bytes());
        table.extend_from_slice(&id.to_le_bytes());
        table.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        data.extend_from_slice(bytes);
    };
    for (&level, bytes) in &slt.levels {
        entry(1, level as u16, &rle::compress(bytes));
    }
    if let Some(screen) = &slt.screen {
        let c = rle::compress(&screen[..]);
        entry(3, 0, if c.len() < SCREEN_SIZE { &c } else { &screen[..] });
    }
    out.extend_from_slice(SLT_SIGNATURE);
    out.extend_from_slice(&table);
    out.extend_from_slice(&[0; 8]);
    out.extend_from_slice(&data);
}

#[cfg(test)]
mod tests;
