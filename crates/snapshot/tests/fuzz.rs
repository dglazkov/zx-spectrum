//! Snapshots damaged at random, thousands of ways from a fixed seed (so that a failure found once is found again):
//! every reader gives an answer or an error, never a panic or an overflow; and whatever is read is a snapshot the
//! rest of the crate can use as it promises. Its banks are its model's, its T-state is inside the frame, a custom
//! ROM is the model's ROMs, and each writer's file reads back as what that writer keeps of it.

use std::path::PathBuf;
use std::process::Command;

use snapshot::{
    Ay, AyInterface, BANK_SIZE, EmbeddedTape, Format, Joystick, Model, Registers, SCREEN_SIZE, Slt, Snapshot, detect,
    load, load_scr, load_sna, load_szx, load_z80, save_sna, save_szx, save_z80,
};

/// xorshift64*: the same numbers on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

fn fixture(name: &str) -> Option<Vec<u8>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = Command::new(root.join("scripts/fixture")).arg(name).current_dir(&root).output().ok()?;
    if !out.status.success() {
        println!("SKIPPED: fixture {name} could not be fetched: {}", String::from_utf8_lossy(&out.stderr).trim());
        return None;
    }
    std::fs::read(String::from_utf8(out.stdout).ok()?.trim()).ok()
}

/// RAM with what the formats have to get right: runs, runs of EDs, single EDs, bytes that do not repeat.
fn ram(rng: &mut Rng) -> Box<[u8; BANK_SIZE]> {
    let mut b = Box::new([0u8; BANK_SIZE]);
    let mut i = 0;
    while i < BANK_SIZE {
        let x = rng.next();
        let (byte, run) = match x % 5 {
            0 => (0x00, (x >> 8) as usize % 400 + 1),
            1 => (0xED, (x >> 8) as usize % 6 + 1),
            2 => ((x >> 16) as u8, (x >> 8) as usize % 300 + 1),
            _ => ((x >> 24) as u8, 1),
        };
        for _ in 0..run.min(BANK_SIZE - i) {
            b[i] = byte;
            i += 1;
        }
    }
    b
}

fn snapshot(rng: &mut Rng, model: Model) -> Snapshot {
    let mut s = Snapshot::new(model);
    for &b in model.banks() {
        s.ram[b] = Some(ram(rng));
    }
    s.regs = Registers {
        af: rng.next() as u16,
        bc: rng.next() as u16,
        hl: rng.next() as u16,
        sp: 0x6000 + rng.below(0x1000) as u16,
        pc: 0x8000 + rng.below(0x100) as u16,
        r: rng.next() as u8,
        iff1: true,
        iff2: true,
        im: rng.below(3) as u8,
        ..Registers::default()
    };
    s.tstates = rng.below(model.frame_tstates() as usize) as u32;
    s.port_fe = rng.below(8) as u8;
    if model.is_128k() {
        s.port_7ffd = rng.below(64) as u8;
    } else {
        s.ay = Some(Ay { selected: 3, registers: [0x0A; 16], interface: AyInterface::Melodik });
    }
    s.joystick = Some([Joystick::Kempston, Joystick::Sinclair1, Joystick::Sinclair2, Joystick::Cursor][rng.below(4)]);
    s
}

/// The snapshots and files to damage: each writer's for several models, with the extras each keeps; a version 1
/// .z80, compressed and raw; and the real files the other tests read, where they can be fetched.
fn bases(rng: &mut Rng) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    for model in Model::ALL {
        let mut s = snapshot(rng, model);
        out.push(save_z80(&s));
        out.push(save_szx(&s));
        if let Ok(f) = save_sna(&s) {
            out.push(f);
        }
        // The extras: level data, a custom ROM, an embedded tape, MEMPTR and the CPU's flags.
        s.slt = Some(Slt {
            levels: [(1, vec![0xED, 0xED, 7, 0, 1, 2]), (2, vec![0x55; 700])].into(),
            screen: Some(Box::new([0x38; SCREEN_SIZE])),
        });
        out.push(save_z80(&s));
        s.custom_rom = Some(vec![0xC9; rom_size(model)]);
        s.tape = Some(EmbeddedTape { extension: "tap".into(), data: vec![0x13, 0, 0, 3, 1, 2, 3], current_block: 1 });
        s.regs.memptr = Some(0x1234);
        s.regs.halted = true;
        s.regs.flags_set = true;
        out.push(save_szx(&s));
    }
    // A 128K .sna with bank 5 paged, so that it is in the file twice.
    let mut s = snapshot(rng, Model::Spectrum128);
    s.port_7ffd = 5;
    out.push(save_sna(&s).unwrap());
    // Version 1: the header, then the 48K compressed (runs of zeros only, so as to need no compressor here) and
    // ended by the marker; and raw.
    let mut v1 = save_z80(&snapshot(rng, Model::Spectrum48))[..30].to_vec();
    v1[6] = 0x34;
    v1[12] = 0x20 | (3 << 1);
    let mut raw = v1.clone();
    raw[12] = 3 << 1;
    for _ in 0..0xC000 / 0xC0 {
        v1.extend_from_slice(&[0xED, 0xED, 0xBF, 0x00, 0x42]);
    }
    v1.extend_from_slice(&[0x00, 0xED, 0xED, 0x00]);
    out.push(v1);
    raw.extend((0..0xC000).map(|i| (i * 7 % 251) as u8));
    out.push(raw);
    for name in [
        "snap-v1-acrojet.z80",
        "snap-v2-pentagon-21.z80",
        "snap-v3-plus3-piramids.z80",
        "snap-128k-chata3.sna",
        "snap-szx13-48k-fruitmachine.szx",
        "snap-szx15-128k-littlefish.szx",
        "snap-slt-killeduntildead.slt",
    ] {
        if let Some(f) = fixture(name) {
            out.push(f);
        }
    }
    out
}

/// The size of a model's ROMs end to end, as .szx's ROM block has them.
fn rom_size(model: Model) -> usize {
    match model {
        Model::Spectrum16 | Model::Spectrum48 => 0x4000,
        Model::Plus2A | Model::Plus3 => 0x10000,
        _ => 0x8000,
    }
}

/// Where damage does the most: the headers, the fields after each .szx block's name, and after .slt's signature.
fn hot_spots(d: &[u8]) -> Vec<usize> {
    let mut spots: Vec<usize> = (0..d.len().min(96)).collect();
    for id in [&b"Z80R"[..], b"SPCR", b"RAMP", b"AY\0\0", b"KEYB", b"JOY\0", b"ROM\0", b"TAPE", b"CRTR", b"SLT"] {
        for (i, _) in d.windows(id.len()).enumerate().filter(|(_, w)| *w == id) {
            spots.extend(i..(i + 48).min(d.len()));
        }
    }
    spots
}

fn mutate(rng: &mut Rng, base: &[u8], spots: &[usize]) -> Vec<u8> {
    let mut d = base.to_vec();
    for _ in 0..1 + rng.below(3) {
        let len = d.len();
        if len == 0 {
            break;
        }
        let at = |rng: &mut Rng| {
            if !spots.is_empty() && rng.below(3) != 0 {
                spots[rng.below(spots.len())].min(len - 1)
            } else {
                rng.below(len)
            }
        };
        match rng.below(8) {
            0 => {
                let i = at(rng);
                d[i] ^= 1 << rng.below(8);
            }
            1 => {
                let i = at(rng);
                d[i] = [0x00, 0x01, 0x02, 0x03, 0x05, 0x07, 0x80, 0xED, 0xFF][rng.below(9)];
            }
            2 => {
                let i = at(rng);
                let v: u32 = [0, 1, 37, 0x3FFF, 0x4000, 0xFFFF, 0x1_0000, 0x7FFF_FFFF, 0xFFFF_FFFF][rng.below(9)];
                let width = [2, 4][rng.below(2)];
                for (k, b) in v.to_le_bytes()[..width].iter().enumerate() {
                    if i + k < len {
                        d[i + k] = *b;
                    }
                }
            }
            3 => d.truncate(rng.below(len)),
            4 => {
                let i = at(rng);
                let bytes: Vec<u8> = (0..1 + rng.below(8)).map(|_| rng.next() as u8).collect();
                d.splice(i..i, bytes);
            }
            5 => {
                let i = at(rng);
                let end = (i + 1 + rng.below(32)).min(len);
                d.drain(i..end);
            }
            6 => {
                // The run codes, in pages and level data.
                let i = rng.below(len);
                let code = [0xED, 0xED, [0, 1, 2, 0xFF][rng.below(4)], rng.next() as u8];
                d.splice(i..(i + rng.below(5)).min(len), code);
            }
            _ => {
                let i = rng.below(len);
                d[i] = rng.next() as u8;
            }
        }
    }
    d
}

/// What the crate promises of any snapshot it reads, and of what its writers make of it.
fn check(s: &Snapshot, from: &str) {
    let m = s.model;
    for n in 0..8 {
        assert_eq!(s.bank(n).is_some(), m.banks().contains(&n), "{from}: bank {n} of a {m:?}");
    }
    assert!(s.tstates < m.frame_tstates(), "{from}: T-state {} in a frame of {}", s.tstates, m.frame_tstates());
    assert!(s.regs.im <= 2, "{from}: IM {}", s.regs.im);
    assert_eq!(s.ay.is_some_and(|a| a.interface == AyInterface::BuiltIn), m.is_128k(), "{from}: {:?}", s.ay);
    if !m.is_128k() {
        assert_eq!(s.port_7ffd, 0, "{from}");
    }
    if !m.has_1ffd() {
        assert_eq!(s.port_1ffd, 0, "{from}");
    }
    if let Some(rom) = &s.custom_rom {
        assert_eq!(rom.len(), rom_size(m), "{from}: a custom ROM for a {m:?}");
    }
    for a in (0..=0xFFFF).step_by(97) {
        let _ = s.peek(a as u16);
    }
    let _ = s.screen();

    // Each writer's file is recognised as that format, and reads back as what the format keeps.
    // And unzip, which picks snapshots out of archives by their content, takes each for what it is.
    let z80 = save_z80(s);
    assert_eq!(detect(&z80), Some(Format::Z80), "{from}: written as .z80");
    assert_eq!(unzip::Kind::sniff(&z80), Some(unzip::Kind::Z80), "{from}: written as .z80");
    let mut kept = s.clone();
    kept.regs.memptr = None;
    kept.regs.halted = false;
    kept.regs.interrupts_suppressed = false;
    kept.regs.flags_set = false;
    kept.port_fe &= 7;
    kept.late_timings = false;
    kept.custom_rom = None;
    kept.tape = None;
    if matches!(kept.joystick, None | Some(Joystick::Fuller)) {
        kept.joystick = Some(Joystick::Cursor);
    }
    assert_eq!(load(&z80).unwrap(), kept, "{from}: through .z80");

    let szx = save_szx(s);
    assert_eq!(detect(&szx), Some(Format::Szx), "{from}: written as .szx");
    assert_eq!(unzip::Kind::sniff(&szx), Some(unzip::Kind::Szx), "{from}: written as .szx");
    let mut kept = s.clone();
    kept.slt = None;
    if let Some(ay) = &mut kept.ay {
        // The writer clears the bits the AY does not have.
        const MASKS: [u8; 16] =
            [0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF];
        ay.selected &= 0x0F;
        for (r, mask) in ay.registers.iter_mut().zip(MASKS) {
            *r &= mask;
        }
    }
    if m.is_128k() {
        // zx-state keeps Issue 2 for the 16K and 48K alone.
        kept.issue2 = false;
    }
    assert_eq!(load(&szx).unwrap(), kept, "{from}: through .szx");

    if let Ok(sna) = save_sna(s) {
        assert_eq!(detect(&sna), Some(Format::Sna), "{from}: written as .sna");
        assert_eq!(unzip::Kind::sniff(&sna), Some(unzip::Kind::Sna), "{from}: written as .sna");
        let t = load(&sna).unwrap();
        assert_eq!((t.regs.pc, t.regs.sp, t.regs.af, t.port_7ffd), (s.regs.pc, s.regs.sp, s.regs.af, s.port_7ffd));
    }
}

#[test]
fn random_damage_is_read_or_refused_never_a_panic() {
    let mut rng = Rng(0x2026_1008_0000_5A5A);
    let bases = bases(&mut rng);
    for (i, b) in bases.iter().enumerate() {
        check(&load(b).unwrap_or_else(|e| panic!("base {i}: {e}")), &format!("base {i}"));
    }
    let spots: Vec<Vec<usize>> = bases.iter().map(|b| hot_spots(b)).collect();
    let (mut read, mut refused) = (0, 0);
    for i in 0..5000 {
        let k = i % bases.len();
        let bad = mutate(&mut rng, &bases[k], &spots[k]);
        let _ = (load_z80(&bad), load_sna(&bad), load_szx(&bad), load_scr(&bad));
        match load(&bad) {
            Ok(s) => {
                check(&s, &format!("damage {i} of base {k}"));
                read += 1;
            }
            Err(_) => refused += 1,
        }
    }
    println!("{read} damaged snapshots read, {refused} refused");
    assert!(read > 400 && refused > 400, "{read} read and {refused} refused: the damage is not varied enough");
}
