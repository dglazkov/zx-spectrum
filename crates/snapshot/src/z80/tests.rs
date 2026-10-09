//! .z80 files built byte by byte from the documentation, in each version and hardware mode.

use super::*;
use crate::tests::{ram, sample};
use crate::{Format, detect};

/// A version 1 header with every register distinct.
fn v1_header(compressed: bool) -> Vec<u8> {
    let mut h = vec![0u8; 30];
    h[0] = 0xA1; // A
    h[1] = 0xF1; // F
    h[2..4].copy_from_slice(&0xBBCCu16.to_le_bytes()); // BC
    h[4..6].copy_from_slice(&0x4411u16.to_le_bytes()); // HL
    h[6..8].copy_from_slice(&0x6E00u16.to_le_bytes()); // PC
    h[8..10].copy_from_slice(&0x5FFEu16.to_le_bytes()); // SP
    h[10] = 0x3F; // I
    h[11] = 0xFF; // R, bit 7 not significant
    h[12] = 0x01 | (6 << 1) | if compressed { 0x20 } else { 0 }; // R bit 7, border 6, compressed
    h[13..15].copy_from_slice(&0xDDEEu16.to_le_bytes()); // DE
    h[15..17].copy_from_slice(&0x0BC1u16.to_le_bytes()); // BC'
    h[17..19].copy_from_slice(&0x0DE1u16.to_le_bytes()); // DE'
    h[19..21].copy_from_slice(&0x0441u16.to_le_bytes()); // HL'
    h[21] = 0xA2; // A'
    h[22] = 0xF2; // F'
    h[23..25].copy_from_slice(&0x1111u16.to_le_bytes()); // IY
    h[25..27].copy_from_slice(&0x2222u16.to_le_bytes()); // IX
    h[27] = 1; // IFF1
    h[28] = 0; // IFF2
    h[29] = 2 | 4 | (1 << 6); // IM 2, Issue 2, Kempston
    h
}

fn ram_48k() -> Vec<u8> {
    let mut m = Vec::new();
    for b in [5, 2, 0] {
        m.extend_from_slice(&ram(b)[..]);
    }
    m
}

#[test]
fn version_1_every_field() {
    let mut f = v1_header(true);
    f.extend(rle::compress(&ram_48k()));
    f.extend_from_slice(&[0x00, 0xED, 0xED, 0x00]);
    assert_eq!(detect(&f), Some(Format::Z80));
    let s = load_z80(&f).unwrap();
    assert_eq!(s.model, Model::Spectrum48);
    let r = s.regs;
    assert_eq!((r.af, r.bc, r.de, r.hl), (0xA1F1, 0xBBCC, 0xDDEE, 0x4411));
    assert_eq!((r.af_alt, r.bc_alt, r.de_alt, r.hl_alt), (0xA2F2, 0x0BC1, 0x0DE1, 0x0441));
    assert_eq!((r.ix, r.iy, r.sp, r.pc, r.i, r.r), (0x2222, 0x1111, 0x5FFE, 0x6E00, 0x3F, 0xFF));
    assert_eq!((r.iff1, r.iff2, r.im), (true, false, 2));
    assert_eq!((s.border(), s.issue2, s.joystick, s.tstates), (6, true, Some(Joystick::Kempston), 0));
    assert_eq!(s.ay, None);
    for (i, b) in [5, 2, 0].into_iter().enumerate() {
        assert_eq!(&s.bank(b).unwrap()[..], &ram_48k()[i * BANK_SIZE..(i + 1) * BANK_SIZE]);
    }
    // Uncompressed, and with byte 12 at FFh (which reads as 1: R's bit 7 set, border 0, not compressed).
    let mut u = v1_header(false);
    u.extend(ram_48k());
    assert_eq!(load_z80(&u).unwrap(), s);
    u[12] = 0xFF;
    let t = load_z80(&u).unwrap();
    assert_eq!((t.regs.r, t.border()), (0xFF, 0));
    assert_eq!(t.bank(5), s.bank(5));
    // Each of the version 1 joysticks.
    for (bits, j) in
        [(0, Joystick::Cursor), (1, Joystick::Kempston), (2, Joystick::Sinclair2), (3, Joystick::Sinclair1)]
    {
        u[29] = bits << 6;
        assert_eq!(load_z80(&u).unwrap().joystick, Some(j));
    }
    // R's top bit comes from byte 12 alone.
    u[11] = 0x80;
    u[12] = 0;
    assert_eq!(load_z80(&u).unwrap().regs.r, 0x00);
}

#[test]
fn version_1_damage() {
    let mut f = v1_header(true);
    f.extend(rle::compress(&ram_48k()));
    // Without the end marker it still reads; short of 48K it does not.
    assert!(load_z80(&f).is_ok());
    assert!(matches!(load_z80(&f[..f.len() - 10]), Err(Error::Truncated(_))));
    let mut u = v1_header(false);
    u.extend(&ram_48k()[..0xBFFF]);
    assert!(matches!(load_z80(&u), Err(Error::Truncated(_))));
    f[29] = 3;
    assert!(matches!(load_z80(&f), Err(Error::Corrupt(_))));
}

/// A version 2 or 3 file of the given hardware mode, with the pages a machine of `pages` has.
fn v23(version: u8, mode: u8, b37: u8, pages: &[u8]) -> Vec<u8> {
    let extra = if version == 2 { V2_EXTRA } else { V3_EXTRA };
    let mut f = v1_header(false);
    f[6] = 0;
    f[7] = 0;
    f.extend_from_slice(&(extra as u16).to_le_bytes());
    f.resize(32 + extra, 0);
    f[32..34].copy_from_slice(&0x8123u16.to_le_bytes());
    f[34] = mode;
    f[35] = 0x17;
    f[37] = b37;
    f[38] = 0x0B;
    for i in 0..16 {
        f[39 + i] = 0x10 + i as u8;
    }
    for &p in pages {
        write_page(&mut f, p, &ram(p as u32));
    }
    f
}

const PAGES_48: [u8; 3] = [4, 5, 8];
const PAGES_128: [u8; 8] = [3, 4, 5, 6, 7, 8, 9, 10];

#[test]
fn every_hardware_mode_in_both_versions() {
    use Model::*;
    // (version, byte 34, byte 37 bit 7) and what it is.
    let table: &[(u8, u8, bool, Option<Model>)] = &[
        (2, 0, false, Some(Spectrum48)),
        (2, 1, false, Some(Spectrum48)),
        (2, 2, false, Some(Spectrum48)),
        (2, 3, false, Some(Spectrum128)),
        (2, 4, false, Some(Spectrum128)),
        (2, 5, false, None),
        (2, 6, false, None),
        (3, 0, false, Some(Spectrum48)),
        (3, 1, false, Some(Spectrum48)),
        (3, 2, false, Some(Spectrum48)),
        (3, 3, false, Some(Spectrum48)),
        (3, 4, false, Some(Spectrum128)),
        (3, 5, false, Some(Spectrum128)),
        (3, 6, false, Some(Spectrum128)),
        (3, 7, false, Some(Plus3)),
        (2, 7, false, Some(Plus3)),
        (3, 8, false, Some(Plus3)),
        (3, 9, false, Some(Pentagon128)),
        (2, 9, false, Some(Pentagon128)),
        (3, 10, false, None),
        (3, 11, false, None),
        (3, 12, false, Some(Plus2)),
        (3, 13, false, Some(Plus2A)),
        (3, 14, false, None),
        (3, 15, false, None),
        (3, 128, false, None),
        (3, 77, false, None),
        // Bit 7: a 48K becomes a 16K, a 128K a +2, a +3 a +2A; others are as they were.
        (2, 0, true, Some(Spectrum16)),
        (3, 0, true, Some(Spectrum16)),
        (3, 1, true, Some(Spectrum16)),
        (2, 3, true, Some(Plus2)),
        (2, 4, true, Some(Plus2)),
        (3, 4, true, Some(Plus2)),
        (3, 7, true, Some(Plus2A)),
        (3, 8, true, Some(Plus2A)),
        (3, 9, true, Some(Pentagon128)),
        (3, 12, true, Some(Plus2)),
        (3, 13, true, Some(Plus2A)),
    ];
    for &(version, mode, modified, expected) in table {
        let pages: &[u8] = match expected {
            Some(m) if m.is_128k() => &PAGES_128,
            _ => &PAGES_48,
        };
        let f = v23(version, mode, if modified { 0x80 } else { 0 }, pages);
        let got = load_z80(&f);
        match expected {
            Some(m) => {
                let s = got.unwrap_or_else(|e| panic!("v{version} mode {mode}: {e}"));
                assert_eq!(s.model, m, "v{version} mode {mode} bit 7 {modified}");
                assert_eq!(s.regs.pc, 0x8123);
                if m.is_128k() {
                    assert_eq!(s.port_7ffd, 0x17);
                    for bank in 0..8 {
                        assert_eq!(s.bank(bank), Some(&*ram(bank as u32 + 3)), "{m:?} bank {bank}");
                    }
                    let ay = s.ay.unwrap();
                    assert_eq!((ay.selected, ay.registers[15], ay.interface), (0x0B, 0x1F, AyInterface::BuiltIn));
                } else {
                    assert_eq!(s.port_7ffd, 0);
                    assert_eq!(s.ay, None);
                    assert_eq!(s.bank(5), Some(&*ram(8)));
                    if m == Spectrum48 {
                        assert_eq!(s.bank(2), Some(&*ram(4)));
                        assert_eq!(s.bank(0), Some(&*ram(5)));
                    } else {
                        assert_eq!((s.bank(2), s.bank(0)), (None, None));
                    }
                }
            }
            None => assert!(
                matches!(got, Err(Error::Unsupported(_) | Error::Corrupt(_))),
                "v{version} mode {mode}: {got:?}"
            ),
        }
    }
}

#[test]
fn version_3_tstate_counter() {
    for model in Model::ALL {
        let frame = model.frame_tstates();
        let q = frame / 4;
        // Just after the interrupt the high counter is 3 and the low one counts down from a quarter less one.
        assert_eq!(encode_tstates(model, 0), ((q - 1) as u16, 3));
        assert_eq!(encode_tstates(model, q - 1), (0, 3));
        assert_eq!(encode_tstates(model, q), ((q - 1) as u16, 0));
        assert_eq!(encode_tstates(model, frame - 1), (0, 2));
        for t in (0..frame).step_by(97).chain([q - 1, q, 2 * q - 1, 2 * q, 3 * q, frame - 1]) {
            let (low, high) = encode_tstates(model, t);
            assert_eq!(decode_tstates(model, low, high), t, "{model:?} {t}");
        }
        // A low counter beyond the quarter's length counts back into the quarter before, as Fuse reads it; one
        // that counts back past the frame's start gives 0.
        assert_eq!(decode_tstates(model, q as u16 + 5, 0), q - 6);
        assert_eq!(decode_tstates(model, 0xFFFF, 3), 0);
    }
    // The documented counts: 17471 (48K) and 17726 (128K) at the top of each quarter.
    assert_eq!(encode_tstates(Model::Spectrum48, 0).0, 17_471);
    assert_eq!(encode_tstates(Model::Spectrum128, 0).0, 17_726);
    // Read from a file.
    let mut f = v23(3, 4, 0, &PAGES_128);
    f[55..57].copy_from_slice(&100u16.to_le_bytes());
    f[57] = 1;
    // Quarter 2 (high 1), 17726 - 100 into it.
    assert_eq!(load_z80(&f).unwrap().tstates, 2 * 17_727 + 17_626);
}

#[test]
fn the_ay_on_a_48k_and_port_1ffd() {
    let s = load_z80(&v23(3, 0, 0x04, &PAGES_48)).unwrap();
    assert_eq!(s.ay.map(|a| (a.interface, a.selected, a.registers[0])), Some((AyInterface::Melodik, 0x0B, 0x10)));
    let s = load_z80(&v23(3, 0, 0x44, &PAGES_48)).unwrap();
    assert_eq!(s.ay.unwrap().interface, AyInterface::FullerBox);
    // 1FFDh, in byte 86 of a 55-byte version 3 header.
    let mut f = v23(3, 7, 0, &[]);
    f[30] = 55;
    f.insert(86, 0x05);
    for p in PAGES_128 {
        write_page(&mut f, p, &ram(p as u32));
    }
    let s = load_z80(&f).unwrap();
    assert_eq!((s.model, s.port_1ffd), (Model::Plus3, 0x05));
    // Written back, with the 55-byte header.
    let w = save_z80(&s);
    assert_eq!((w[30], w[34], w[37], w[86]), (55, 7, 0, 0x05));
    assert_eq!(load_z80(&w).unwrap(), s);
}

#[test]
fn what_the_writer_puts_in_the_header() {
    for (model, mode, b37, len) in [
        (Model::Spectrum16, 0, 0x80, 54),
        (Model::Spectrum48, 0, 0x00, 54),
        (Model::Spectrum128, 4, 0x00, 54),
        (Model::Plus2, 4, 0x80, 54),
        (Model::Plus2A, 7, 0x80, 55),
        (Model::Plus3, 7, 0x00, 55),
        (Model::Pentagon128, 9, 0x00, 54),
    ] {
        let f = save_z80(&sample(model));
        assert_eq!((f[6], f[7], f[30], f[34], f[37]), (0, 0, len, mode, b37), "{model:?}");
        assert_eq!(&f[61..63], &[0xFF, 0xFF], "{model:?}: ROM at 0000h");
        // A 16K is written with a 48K's three pages.
        let pages = if model.is_128k() { 8 } else { 3 };
        let mut at = 32 + len as usize;
        let mut n = 0;
        while at < f.len() {
            let l = le16(&f, at);
            at += 3 + if l == 0xFFFF { BANK_SIZE } else { l as usize };
            n += 1;
        }
        assert_eq!((n, at), (pages, f.len()), "{model:?}");
    }
    // The +3's all-RAM paging: bytes 61 and 62 say RAM.
    let mut s = sample(Model::Plus3);
    s.port_1ffd = 0x03;
    assert_eq!(&save_z80(&s)[61..63], &[0, 0]);
}

#[test]
fn version_3_user_defined_joystick() {
    let mut s = sample(Model::Spectrum48);
    for j in [Joystick::Kempston, Joystick::Sinclair1, Joystick::Sinclair2, Joystick::Cursor] {
        s.joystick = Some(j);
        assert_eq!(load_z80(&save_z80(&s)).unwrap().joystick, Some(j));
    }
    // Interface 2's left port written as user-defined keys, with the documentation's row and mask: '1' is 0x0103.
    s.joystick = Some(Joystick::Sinclair2);
    let f = save_z80(&s);
    assert_eq!(f[29] >> 6, 2);
    assert_eq!(&f[63..67], &[3, 0x01, 3, 0x02]);
    assert_eq!(&f[73..83], b"1\x002\x003\x004\x005\x00");
    // Keys that are no joystick's: none.
    let mut f = f;
    f[63] = 6;
    assert_eq!(load_z80(&f).unwrap().joystick, None);
}

#[test]
fn pages() {
    // A ROM page, and the Multiface's, are passed over; a page twice, or one no machine has, is corrupt.
    let mut f = v23(3, 0, 0, &[0, 1, 2, 4, 5, 8, 11]);
    let s = load_z80(&f).unwrap();
    assert_eq!(s.bank(5), Some(&*ram(8)));
    write_page(&mut f, 4, &ram(1));
    assert!(matches!(load_z80(&f), Err(Error::Corrupt(_))));
    let f = v23(3, 0, 0, &[4, 5, 8, 19]);
    assert!(matches!(load_z80(&f), Err(Error::Corrupt(_))));
    // A page left out is zeros.
    let s = load_z80(&v23(3, 4, 0, &[8, 10])).unwrap();
    assert_eq!(s.bank(5), Some(&*ram(8)));
    assert_eq!(s.bank(0), Some(&[0u8; BANK_SIZE]));
    // Stored uncompressed (length FFFFh), and stored uncompressed with its true length (some writers do).
    let mut f = v23(3, 0, 0, &[]);
    for p in PAGES_48 {
        f.extend_from_slice(&[0xFF, 0xFF, p]);
        f.extend_from_slice(&ram(p as u32)[..]);
    }
    let a = load_z80(&f).unwrap();
    let mut g = v23(3, 0, 0, &[]);
    for p in PAGES_48 {
        g.extend_from_slice(&[0x00, 0x40, p]);
        g.extend_from_slice(&ram(p as u32)[..]);
    }
    assert_eq!(load_z80(&g).unwrap(), a);
    assert_eq!(a.bank(2), Some(&*ram(4)));
    // A page whose data decompresses to the wrong size.
    let mut f = v23(3, 0, 0, &[4, 5]);
    f.extend_from_slice(&[4, 0, 8, 0xED, 0xED, 0x10, 0x00]);
    assert!(matches!(load_z80(&f), Err(Error::Corrupt(_))));
    // A byte or two after the last page are let be; a cut page is not.
    let mut f = v23(3, 0, 0, &PAGES_48);
    f.push(0);
    assert!(load_z80(&f).is_ok());
    f.push(0);
    assert!(load_z80(&f).is_ok());
    f.push(0);
    assert!(load_z80(&f).is_err());
    // A second header of a length no version has.
    let mut f = v23(3, 0, 0, &PAGES_48);
    f[30] = 30;
    assert!(matches!(load_z80(&f), Err(Error::Corrupt(_))));
}

#[test]
fn super_level_loader_data() {
    let mut s = sample(Model::Spectrum48);
    let mut levels = std::collections::BTreeMap::new();
    levels.insert(1, ram(1)[..7000].to_vec());
    levels.insert(2, vec![0xED, 0xED, 0, 0, 0, 0, 0, 0, 1]);
    levels.insert(65, vec![]);
    let screen: Box<crate::Screen> = Box::new([0x38; SCREEN_SIZE]);
    s.slt = Some(Slt { levels, screen: Some(screen) });
    let f = save_z80(&s);
    let at = f.windows(6).position(|w| w == SLT_SIGNATURE).unwrap();
    // The table follows the signature directly: level 1's entry first.
    assert_eq!(&f[at + 6..at + 10], &[1, 0, 1, 0]);
    assert_eq!(load_z80(&f).unwrap(), s);
    assert_eq!(detect(&f), Some(Format::Z80));
    // An entry of another type (2, instructions) is passed over, its data with it.
    let mut g = f[..at + 6].to_vec();
    for (kind, id, len) in [(2u16, 0u16, 3u32), (1, 7, 2)] {
        g.extend_from_slice(&kind.to_le_bytes());
        g.extend_from_slice(&id.to_le_bytes());
        g.extend_from_slice(&len.to_le_bytes());
    }
    g.extend_from_slice(&[0; 8]);
    g.extend_from_slice(b"abcXY");
    let t = load_z80(&g).unwrap().slt.unwrap();
    assert_eq!(t.levels.into_iter().collect::<Vec<_>>(), [(7, b"XY".to_vec())]);
    assert_eq!(t.screen, None);
    // Level data cut short, and a level number beyond A's.
    assert!(load_z80(&g[..g.len() - 1]).is_err());
    let mut h = g.clone();
    // The second entry's identifier: 0101h.
    h[at + 6 + 10] = 1;
    h[at + 6 + 11] = 1;
    assert!(matches!(load_z80(&h), Err(Error::Corrupt(_))));
}

#[test]
fn fuse_s_interface_2_keys_are_its_left_port() {
    // libspectrum writes Interface 2's left port (keys 1 to 5) as user-defined keys with masks of its own, 0F 08 04
    // 02 01 in half-row 3, and the ASCII words '1' to '5'; it reads them back as that joystick, and so does this.
    let mut f = save_z80(&sample(Model::Spectrum48));
    f[29] = (f[29] & 0x3F) | (2 << 6);
    for (i, (word, key)) in [0x0F03u16, 0x0803, 0x0403, 0x0203, 0x0103].into_iter().zip(*b"12345").enumerate() {
        f[63 + 2 * i..65 + 2 * i].copy_from_slice(&word.to_le_bytes());
        f[73 + 2 * i..75 + 2 * i].copy_from_slice(&(key as u16).to_le_bytes());
    }
    assert_eq!(load_z80(&f).unwrap().joystick, Some(Joystick::Sinclair2));
    // The same keys in another order are no joystick's.
    f.swap(64, 66);
    assert_eq!(load_z80(&f).unwrap().joystick, None);
}

#[test]
fn a_z80_of_a_sna_s_length_is_a_z80() {
    // A version 3 128K file whose pages come to 131,103 bytes in all, the length of a 128K .sna, with IX's low byte
    // (byte 25, a .sna's interrupt mode) 1: its pages, which end exactly at the end of the file, say it is a .z80.
    let mut f = v23(3, 4, 0, &[]);
    f[25] = 1;
    for page in 3..10 {
        f.extend_from_slice(&[0xFF, 0xFF, page]);
        f.extend_from_slice(&ram(page as u32)[..]);
    }
    // The last page: literals and one run, compressed to exactly what the length needs.
    let want = 131_103 - f.len() - 3;
    let run = BANK_SIZE - (want - 4);
    assert!((5..=255).contains(&run), "{want}");
    let mut page: Vec<u8> = (0..want - 4).map(|i| [0x11, 0x22, 0x33][i % 3]).collect();
    page.extend_from_slice(&[0xED, 0xED, run as u8, 0x44]);
    f.extend_from_slice(&(want as u16).to_le_bytes());
    f.push(10);
    f.extend_from_slice(&page);
    assert_eq!(f.len(), 131_103);
    assert_eq!(detect(&f), Some(Format::Z80));
    let s = crate::load(&f).unwrap();
    assert_eq!((s.model, s.regs.pc, s.bank(7).unwrap()[BANK_SIZE - 1]), (Model::Spectrum128, 0x8123, 0x44));

    // A compressed version 1 file of 49,179 bytes, a 48K .sna's length, ended by its marker.
    let mut v1 = v1_header(true);
    v1[25] = 2;
    let literals = 49_179 - 30 - 4 - 4;
    v1.extend((0..literals).map(|i| [0x01, 0x02, 0x03, 0x04][i % 4]));
    v1.extend_from_slice(&[0xED, 0xED, (0xC000 - literals) as u8, 0x99]);
    v1.extend_from_slice(&[0x00, 0xED, 0xED, 0x00]);
    assert_eq!(v1.len(), 49_179);
    assert_eq!(detect(&v1), Some(Format::Z80));
    assert_eq!(crate::load(&v1).unwrap().regs.pc, 0x6E00);
    // Without its marker it could as well be a .sna, and the length decides.
    let n = v1.len();
    v1[n - 4..].copy_from_slice(&[0x11, 0x22, 0x33, 0x44]);
    assert_eq!(detect(&v1), Some(Format::Sna));
}
