//! .szx files built block by block from the specification, in its versions from 1.0 to 1.5.

use super::*;
use crate::tests::{ram, sample};

fn block(out: &mut Vec<u8>, id: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(id);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
}

fn header(minor: u8, machine: u8, flags: u8) -> Vec<u8> {
    let mut f = b"ZXST".to_vec();
    f.extend_from_slice(&[1, minor, machine, flags]);
    f
}

/// A Z80R block's body with every register distinct, AF as 0xA1F1 (F first, as the format has it).
fn z80r(flags: u8, memptr: u16, t: u32) -> Vec<u8> {
    let mut b = Vec::new();
    for v in [0xA1F1u16, 0xBBCC, 0xDDEE, 0x4411, 0xA2F2, 0x0BC1, 0x0DE1, 0x0441, 0x2222, 0x1111, 0x5FFE, 0x6E00] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b.extend_from_slice(&[0x3F, 0x9A, 1, 1, 1]);
    b.extend_from_slice(&t.to_le_bytes());
    b.extend_from_slice(&[0, flags]);
    b.extend_from_slice(&memptr.to_le_bytes());
    b
}

fn ramp(page: u8, compressed: bool) -> Vec<u8> {
    let data = ram(page as u32);
    let mut b = vec![u8::from(compressed), 0, page];
    if compressed {
        b.extend(miniz_oxide::deflate::compress_to_vec_zlib(&data[..], 9));
    } else {
        b.extend_from_slice(&data[..]);
    }
    b
}

/// A 48K file of the given minor version, its pages one compressed and the others not.
fn file_48k(minor: u8) -> Vec<u8> {
    let mut f = header(minor, 1, 0);
    block(&mut f, b"Z80R", &z80r(HALTED | FSET, 0x6DFF, 1000));
    block(&mut f, b"SPCR", &[3, 0x55, 0x66, 0x18, 0, 0, 0, 0]);
    block(&mut f, b"RAMP", &ramp(5, true));
    block(&mut f, b"RAMP", &ramp(2, false));
    block(&mut f, b"RAMP", &ramp(0, true));
    f
}

#[test]
fn version_1_5_every_field() {
    let mut f = file_48k(5);
    block(&mut f, b"KEYB", &[1, 0, 0, 0, 3]);
    let s = load_szx(&f).unwrap();
    assert_eq!(s.model, Model::Spectrum48);
    let r = s.regs;
    assert_eq!((r.af, r.bc, r.de, r.hl), (0xA1F1, 0xBBCC, 0xDDEE, 0x4411));
    assert_eq!((r.af_alt, r.bc_alt, r.de_alt, r.hl_alt), (0xA2F2, 0x0BC1, 0x0DE1, 0x0441));
    assert_eq!(
        (r.ix, r.iy, r.sp, r.pc, r.i, r.r, r.iff1, r.iff2, r.im),
        (0x2222, 0x1111, 0x5FFE, 0x6E00, 0x3F, 0x9A, true, true, 1)
    );
    assert_eq!((r.memptr, r.halted, r.flags_set, r.interrupts_suppressed), (Some(0x6DFF), true, true, false));
    assert_eq!(s.tstates, 1000);
    // The border from chBorder; EAR and MIC from chFe; on a 48K, no 7FFDh or 1FFDh.
    assert_eq!((s.port_fe, s.port_7ffd, s.port_1ffd), (0x18 | 3, 0, 0));
    for b in [5, 2, 0] {
        assert_eq!(s.bank(b), Some(&*ram(b as u32)));
    }
    assert_eq!((s.issue2, s.joystick, s.ay), (true, Some(Joystick::Sinclair1), None));
}

#[test]
fn older_versions_have_fewer_fields() {
    // 1.0: Z80R's flags and MEMPTR bytes were reserved, SPCR's chFe too, and KEYB had no joystick.
    let mut f = file_48k(0);
    block(&mut f, b"KEYB", &[0, 0, 0, 0]);
    let s = load_szx(&f).unwrap();
    assert_eq!((s.regs.memptr, s.regs.halted, s.regs.flags_set, s.port_fe), (None, false, false, 3));
    // 1.3: flags, but no MEMPTR.
    let s = load_szx(&file_48k(3)).unwrap();
    assert_eq!((s.regs.memptr, s.regs.halted, s.port_fe), (None, true, 0x1B));
    // 1.4: MEMPTR.
    assert_eq!(load_szx(&file_48k(4)).unwrap().regs.memptr, Some(0x6DFF));
}

#[test]
fn libspectrum_0_5_0_and_before_wrote_af_swapped() {
    for (creator, swapped) in [
        (&b"gcrypt: 1.2.0\nlibspectrum: 0.5.0\n"[..], true),
        (b"libspectrum: 0.4.9", true),
        (b"libspectrum: 0.5.1", false),
        (b"gcrypt: 1.8.2\nlibspectrum: 1.4.4\nuname: ", false),
        (b"", false),
    ] {
        let mut f = header(4, 1, 0);
        let mut crtr = vec![0u8; 36];
        crtr[..4].copy_from_slice(b"Fuse");
        crtr.extend_from_slice(creator);
        block(&mut f, b"CRTR", &crtr);
        f.extend_from_slice(&file_48k(4)[8..]);
        let s = load_szx(&f).unwrap();
        let expected = if swapped { (0xF1A1, 0xF2A2) } else { (0xA1F1, 0xA2F2) };
        assert_eq!((s.regs.af, s.regs.af_alt), expected, "{}", String::from_utf8_lossy(creator));
    }
}

#[test]
fn the_ay_keyboard_joystick_rom_and_tape_blocks() {
    let mut f = file_48k(5);
    // A 48K's AY block with neither flag is no AY; with the Fuller flag, the Fuller Box's.
    let mut ay = vec![0, 7];
    ay.extend(1..=16);
    block(&mut f, b"AY\0\0", &ay);
    assert_eq!(load_szx(&f).unwrap().ay, None);
    ay[0] = 1;
    block(&mut f, b"AY\0\0", &ay);
    let s = load_szx(&f).unwrap();
    assert_eq!(s.ay.map(|a| (a.interface, a.selected, a.registers[15])), Some((AyInterface::FullerBox, 7, 16)));
    ay[0] = 2;
    block(&mut f, b"AY\0\0", &ay);
    assert_eq!(load_szx(&f).unwrap().ay.unwrap().interface, AyInterface::Melodik);
    // JOY's player 1 is the joystick, over KEYB's.
    block(&mut f, b"KEYB", &[0, 0, 0, 0, 2]);
    assert_eq!(load_szx(&f).unwrap().joystick, Some(Joystick::Cursor));
    block(&mut f, b"JOY\0", &[0, 0, 0, 0, 0, 8]);
    assert_eq!(load_szx(&f).unwrap().joystick, Some(Joystick::Kempston));
    block(&mut f, b"JOY\0", &[0, 0, 0, 0, 8, 0]);
    assert_eq!(load_szx(&f).unwrap().joystick, None);
    // A custom ROM, compressed and not.
    let rom: Vec<u8> = (0..16_384u32).map(|i| (i * 31 % 256) as u8).collect();
    let mut g = file_48k(5);
    let mut b = vec![0, 0];
    b.extend_from_slice(&16_384u32.to_le_bytes());
    b.extend_from_slice(&rom);
    block(&mut g, b"ROM\0", &b);
    assert_eq!(load_szx(&g).unwrap().custom_rom.as_ref(), Some(&rom));
    // A tape named on the disk of the machine that wrote it is not here; an embedded one is.
    let mut tape = vec![0u8; 28];
    tape[8] = 20;
    tape[12..15].copy_from_slice(b"tap");
    tape.extend_from_slice(b"C:\\Games\\a.tap\0\0\0\0\0\0");
    block(&mut g, b"TAPE", &tape);
    assert_eq!(load_szx(&g).unwrap().tape, None);
    let mut tape = vec![4, 0, 1, 0];
    tape.extend_from_slice(&5u32.to_le_bytes());
    tape.extend_from_slice(&5u32.to_le_bytes());
    let mut ext = [0u8; 16];
    ext[..3].copy_from_slice(b"TZX");
    tape.extend_from_slice(&ext);
    tape.extend_from_slice(b"hello");
    block(&mut g, b"TAPE", &tape);
    let t = load_szx(&g).unwrap().tape.unwrap();
    assert_eq!((t.extension.as_str(), t.data.as_slice(), t.current_block), ("tzx", &b"hello"[..], 4));
}

#[test]
fn unknown_blocks_are_skipped_and_damage_fails() {
    let mut f = header(5, 2, 1);
    block(&mut f, b"MFCE", &[1, 2, 3]);
    block(&mut f, b"Z80R", &z80r(0, 0, 70_908 + 12));
    block(&mut f, b"AMXM", &[0; 7]);
    block(&mut f, b"IF1\0", &[0; 40]);
    block(&mut f, b"SPCR", &[1, 0x1F, 0x07, 0, 0, 0, 0, 0]);
    for p in 0..8 {
        block(&mut f, b"RAMP", &ramp(p, p % 2 == 0));
    }
    let s = load_szx(&f).unwrap();
    assert_eq!((s.model, s.port_7ffd, s.port_1ffd, s.late_timings), (Model::Spectrum128, 0x1F, 0, true));
    // A T-state past the frame's end is that far into the next frame.
    assert_eq!(s.tstates, 12);
    // A 128K without an AY block still has its AY.
    assert_eq!(s.ay, Some(Ay::new(AyInterface::BuiltIn)));
    for p in 0..8 {
        assert_eq!(s.bank(p), Some(&*ram(p as u32)));
    }

    // Each kind of damage.
    assert!(matches!(load_szx(&f[..f.len() - 1]), Err(Error::Truncated(_))));
    assert!(matches!(load_szx(&f[..7]), Err(Error::Truncated(_))));
    let no_cpu: Vec<u8> = header(5, 1, 0);
    assert!(matches!(load_szx(&no_cpu), Err(Error::Corrupt(_))));
    let mut v2 = f.clone();
    v2[4] = 2;
    assert!(matches!(load_szx(&v2), Err(Error::Unsupported(_))));
    let mut g = file_48k(5);
    block(&mut g, b"RAMP", &ramp(5, true));
    assert!(matches!(load_szx(&g), Err(Error::Corrupt(_))), "a page twice");
    let mut g = file_48k(5);
    block(&mut g, b"RAMP", &[1, 0, 7, 0x78, 0x9C, 0xFF, 0xFF]);
    assert!(matches!(load_szx(&g), Err(Error::Corrupt(_))), "zlib that does not inflate");
    let mut g = file_48k(5);
    block(&mut g, b"RAMP", &[0, 0, 7, 1, 2, 3]);
    assert!(matches!(load_szx(&g), Err(Error::Truncated(_))), "an uncompressed page cut short");
    let mut g = file_48k(5);
    block(&mut g, b"RAMP", &ramp(8, true));
    assert!(matches!(load_szx(&g), Err(Error::Corrupt(_))), "a ninth page");
    let mut small = miniz_oxide::deflate::compress_to_vec_zlib(&[0u8; 100], 6);
    small.splice(0..0, [1, 0, 7]);
    let mut g = file_48k(5);
    block(&mut g, b"RAMP", &small);
    assert!(matches!(load_szx(&g), Err(Error::Corrupt(_))), "a page that inflates to 100 bytes");
    let mut g = file_48k(5);
    block(&mut g, b"Z80R", &[0; 36]);
    assert!(matches!(load_szx(&g), Err(Error::Truncated(_))), "a CPU block short of a byte");
    let mut g = file_48k(5);
    let mut bad = z80r(0, 0, 0);
    bad[28] = 3;
    block(&mut g, b"Z80R", &bad);
    assert!(matches!(load_szx(&g), Err(Error::Corrupt(_))), "interrupt mode 3");
}

#[test]
fn machines() {
    for (id, model) in [
        (0, Some(Model::Spectrum16)),
        (1, Some(Model::Spectrum48)),
        (2, Some(Model::Spectrum128)),
        (3, Some(Model::Plus2)),
        (4, Some(Model::Plus2A)),
        (5, Some(Model::Plus3)),
        (6, Some(Model::Plus3)),
        (7, Some(Model::Pentagon128)),
        (8, None),
        (9, None),
        (10, None),
        (11, None),
        (12, None),
        (13, None),
        (14, None),
        (15, Some(Model::Spectrum48)),
        (16, Some(Model::Spectrum128)),
        (17, None),
    ] {
        let mut f = file_48k(5);
        f[6] = id;
        match model {
            Some(m) => assert_eq!(load_szx(&f).unwrap().model, m, "machine {id}"),
            None => assert!(matches!(load_szx(&f), Err(Error::Unsupported(_))), "machine {id}"),
        }
    }
    for m in Model::ALL {
        assert_eq!(model_for(machine_id(m)).unwrap(), m);
    }
}

#[test]
fn what_the_writer_writes() {
    let mut s = sample(Model::Plus3);
    s.regs.halted = true;
    s.regs.interrupts_suppressed = true;
    s.tstates = 10;
    let f = save_szx(&s);
    assert_eq!(&f[..8], &[b'Z', b'X', b'S', b'T', 1, 5, 5, 0]);
    // The blocks in the order the specification describes them, CRTR first.
    let mut ids = Vec::new();
    let mut at = 8;
    while at < f.len() {
        ids.push(String::from_utf8_lossy(&f[at..at + 4]).trim_end_matches('\0').to_owned());
        at += 8 + le32(&f, at + 4) as usize;
    }
    assert_eq!(
        ids,
        ["CRTR", "Z80R", "SPCR", "JOY", "KEYB", "AY", "RAMP", "RAMP", "RAMP", "RAMP", "RAMP", "RAMP", "RAMP", "RAMP"]
    );
    let z = &f[8 + 44 + 8..];
    assert_eq!(&z[29..33], &10u32.to_le_bytes());
    // INT held 36 T-states on a +3, 10 of them gone; halted alone of the two flags, as they exclude each other.
    assert_eq!((z[33], z[34]), (26, HALTED));
    // Unused AY bits cleared: register 1 is four bits.
    s.ay.as_mut().unwrap().registers[1] = 0xFF;
    let t = load_szx(&save_szx(&s)).unwrap();
    assert_eq!(t.ay.unwrap().registers[1], 0x0F);
}

#[test]
fn what_the_specification_restricts_to_some_models() {
    // HALTED and SUPPRESS_INTS "mutually exclusive": with both, the CPU is halted (the HALT was the last
    // instruction), as the writer would put it.
    let mut f = header(5, 1, 0);
    block(&mut f, b"Z80R", &z80r(HALTED | SUPPRESS_INTS, 0, 0));
    let s = load_szx(&f).unwrap();
    assert_eq!((s.regs.halted, s.regs.interrupts_suppressed), (true, false));
    assert_eq!(load_szx(&save_szx(&s)).unwrap(), s);

    // The alternate timings are "only applicable for the 16K, 48K and 128K"; Issue 2 "only applicable for the 16k
    // or 48k ZX Spectrum. For other models, set this member to 0".
    for (machine, model, applies) in
        [(1, Model::Spectrum48, true), (2, Model::Spectrum128, true), (5, Model::Plus3, false)]
    {
        let mut f = header(5, machine, ALTERNATE_TIMINGS);
        block(&mut f, b"Z80R", &z80r(0, 0, 0));
        block(&mut f, b"KEYB", &[1, 0, 0, 0, 8]);
        let s = load_szx(&f).unwrap();
        assert_eq!((s.model, s.late_timings, s.issue2), (model, applies, !model.is_128k()), "machine {machine}");
    }
    let mut s = sample(Model::Plus3);
    s.issue2 = true;
    s.late_timings = true;
    let f = save_szx(&s);
    assert_eq!(f[7], 0);
    let keyb = f.windows(4).position(|w| w == b"KEYB").unwrap();
    assert_eq!(f[keyb + 8], 0);

    // A custom ROM is the model's ROMs end to end: 16K on a 48K, 32K on a 128K, +2 or Pentagon, 64K on a +2A or
    // +3. Any other size is refused (as Fuse refuses it) rather than handed to a machine that cannot page it.
    for (model, size) in [(Model::Spectrum48, 0x4000), (Model::Plus2, 0x8000), (Model::Plus3, 0x10000)] {
        let mut s = sample(model);
        s.custom_rom = Some(vec![0xC9; size]);
        let f = save_szx(&s);
        assert_eq!(load_szx(&f).unwrap().custom_rom, s.custom_rom, "{model:?}");
        // The block's size field changed to another model's: refused.
        let rom = f.windows(4).position(|w| w == b"ROM\0").unwrap();
        let mut bad = f.clone();
        bad[rom + 10..rom + 14].copy_from_slice(&(if size == 0x4000 { 0x8000u32 } else { 0x4000 }).to_le_bytes());
        assert!(matches!(load_szx(&bad), Err(Error::Corrupt(_))), "{model:?}");
        // A snapshot whose ROM is not the model's size is written without it.
        s.custom_rom = Some(vec![0xC9; 100]);
        let f = save_szx(&s);
        assert!(!f.windows(4).any(|w| w == b"ROM\0"));
        assert_eq!(load_szx(&f).unwrap().custom_rom, None);
    }
}
