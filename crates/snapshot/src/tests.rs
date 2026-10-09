//! Snapshots built here for every model, written by each writer and read back; the formats told apart; the
//! paging; and damaged files of every kind failing cleanly.

use super::*;

/// RAM with what the .z80 compression has to get right in it: long runs, runs of EDs, single EDs before runs, and
/// bytes that do not repeat.
pub(crate) fn ram(seed: u32) -> Box<Bank> {
    let mut b = zero_bank();
    let mut x = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    let mut i = 0;
    while i < BANK_SIZE {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let len = (x >> 8) as usize % 300 + 1;
        let (byte, run) = match x % 6 {
            0 => (0x00, len),
            1 => (0xED, len % 7 + 1),
            2 => (0xED, 1),
            3 => ((x >> 16) as u8, len),
            _ => ((x >> 24) as u8, 1),
        };
        for _ in 0..run.min(BANK_SIZE - i) {
            b[i] = byte;
            i += 1;
        }
    }
    b
}

/// A snapshot of `model` with every field the .z80 format keeps set to something distinct.
pub(crate) fn sample(model: Model) -> Snapshot {
    let mut s = Snapshot::new(model);
    for &b in model.banks() {
        s.ram[b] = Some(ram(b as u32 * 7 + model as u32));
    }
    s.regs = Registers {
        af: 0x12C5,
        bc: 0x3456,
        de: 0x789A,
        hl: 0xBCDE,
        af_alt: 0xF00D,
        bc_alt: 0x1357,
        de_alt: 0x2468,
        hl_alt: 0x9BDF,
        ix: 0x5A5A,
        iy: 0x5C3A,
        sp: 0x7FF0,
        pc: 0x8A31,
        i: 0xFE,
        r: 0xB7,
        iff1: true,
        iff2: true,
        im: 2,
        ..Registers::default()
    };
    s.tstates = 12_345;
    s.port_fe = 5;
    s.issue2 = !model.is_128k();
    s.joystick = Some(Joystick::Kempston);
    if model.is_128k() {
        s.port_7ffd = 0x13;
        s.ay = Some(Ay {
            selected: 14,
            registers: [0x5D, 0x0E, 0x9F, 0x01, 0x22, 0x03, 0x1F, 0x38, 0x10, 0x0F, 0x07, 0x40, 0x9C, 0x0D, 0xFF, 0xBF],
            interface: AyInterface::BuiltIn,
        });
    }
    if model.has_1ffd() {
        s.port_1ffd = 0x04;
    }
    s
}

/// `sample`, with what only .szx keeps set too.
fn rich(model: Model) -> Snapshot {
    let mut s = sample(model);
    s.regs.memptr = Some(0x8A30);
    s.regs.interrupts_suppressed = true;
    s.regs.flags_set = true;
    s.port_fe = 0x18 | 5;
    s.late_timings = matches!(model, Model::Spectrum48 | Model::Spectrum128);
    s.joystick = Some(Joystick::Fuller);
    // The model's ROMs end to end, as zx-state's ROM block has them: one for a 16K or 48K, four for a +2A or +3,
    // two for the others.
    let roms = match model {
        Model::Spectrum16 | Model::Spectrum48 => 1,
        Model::Plus2A | Model::Plus3 => 4,
        _ => 2,
    };
    s.custom_rom = Some((0..0x4000u32 * roms).map(|i| (i % 253) as u8).collect());
    s.tape = Some(EmbeddedTape {
        extension: "tzx".into(),
        data: b"ZXTape!\x1a\x01\x14 and the rest".to_vec(),
        current_block: 3,
    });
    if !model.is_128k() {
        s.ay = Some(Ay { selected: 7, registers: [1; 16], interface: AyInterface::FullerBox });
    }
    s
}

#[test]
fn every_model_round_trips_through_z80() {
    for model in Model::ALL {
        let s = sample(model);
        let f = save_z80(&s);
        assert_eq!(detect(&f), Some(Format::Z80), "{model:?}");
        assert_eq!(load(&f).unwrap(), s, "{model:?}");
    }
}

#[test]
fn every_model_round_trips_through_szx() {
    for model in Model::ALL {
        for s in [sample(model), rich(model)] {
            let f = save_szx(&s);
            assert_eq!(detect(&f), Some(Format::Szx), "{model:?}");
            assert_eq!(load(&f).unwrap(), s, "{model:?}");
        }
    }
}

#[test]
fn every_model_through_sna_keeps_what_sna_can() {
    for model in Model::ALL {
        let s = sample(model);
        let f = save_sna(&s).unwrap();
        assert_eq!(detect(&f), Some(Format::Sna), "{model:?}");
        let t = load(&f).unwrap();
        let mut expected = s.clone();
        // .sna keeps no T-state, joystick, Issue 2 or AY; is a 48K or a Spectrum 128; and a 48K's PC goes on the
        // stack.
        expected.tstates = 0;
        expected.joystick = None;
        expected.issue2 = false;
        expected.port_1ffd = 0;
        if model.is_128k() {
            expected.model = Model::Spectrum128;
            expected.ay = Some(Ay::new(AyInterface::BuiltIn));
        } else {
            expected.model = Model::Spectrum48;
            expected.ram[2].get_or_insert_with(zero_bank);
            expected.ram[0].get_or_insert_with(zero_bank);
            let [lo, hi] = s.regs.pc.to_le_bytes();
            expected.poke(s.regs.sp - 2, lo);
            expected.poke(s.regs.sp - 1, hi);
        }
        assert_eq!(t, expected, "{model:?}");
    }
}

#[test]
fn what_each_format_loses() {
    // .z80 keeps none of these.
    let s = rich(Model::Spectrum48);
    let t = load(&save_z80(&s)).unwrap();
    assert_eq!(t.regs.memptr, None);
    assert!(!t.regs.interrupts_suppressed && !t.regs.flags_set && !t.late_timings);
    assert_eq!((t.port_fe, t.custom_rom.as_ref(), t.tape.as_ref()), (5, None, None));
    assert_eq!(t.joystick, Some(Joystick::Cursor)); // No Fuller in .z80: written as the cursor joystick.
    assert_eq!(t.ay.unwrap().interface, AyInterface::FullerBox); // But the Fuller Box's AY it keeps.
    // .szx keeps all but the level data.
    let mut s = sample(Model::Spectrum48);
    s.slt = Some(Slt { levels: [(1, vec![1, 2, 3])].into(), screen: None });
    assert_eq!(load(&save_z80(&s)).unwrap(), s);
    assert_eq!(load(&save_szx(&s)).unwrap().slt, None);
}

#[test]
fn halted_survives_szx_and_is_redone_by_the_others() {
    let mut s = sample(Model::Spectrum48);
    s.regs.halted = true;
    s.regs.pc = 0x9000;
    s.poke(0x9000, 0x76);
    assert_eq!(load(&save_szx(&s)).unwrap(), s);
    // The other formats lose the flag, but PC is at the HALT, which runs again.
    let t = load(&save_z80(&s)).unwrap();
    assert!(!t.regs.halted);
    assert_eq!(t.peek(t.regs.pc), Some(0x76));
}

#[test]
fn detecting_and_refusing() {
    assert_eq!(detect(b""), None);
    assert_eq!(load(b"not a snapshot").unwrap_err(), Error::Unrecognised);
    assert_eq!(load(&[0x55; 1000]).unwrap_err(), Error::Unrecognised);
    assert_eq!(load(b"ZXTape!\x1a\x01\x14").unwrap_err(), Error::Unrecognised);
    // A screen dump is not a snapshot.
    assert_eq!(detect(&[0; SCREEN_SIZE]), None);
    for f in Format::ALL_FOR_TESTS {
        assert_eq!(save(&sample(Model::Spectrum48), f).map(|b| detect(&b)), Ok(Some(f)));
    }
}

impl Format {
    const ALL_FOR_TESTS: [Format; 3] = [Format::Z80, Format::Sna, Format::Szx];
}

#[test]
fn damaged_files_fail_cleanly() {
    // Each writer's file for a 128K and a 48K, cut at every length, and with bytes changed: never a panic, and
    // a cut file never reads as if whole.
    for model in [Model::Spectrum48, Model::Plus3] {
        let s = rich(model);
        let z80 = save_z80(&s);
        let szx = save_szx(&s);
        let sna = save_sna(&s).unwrap();
        for f in [&z80, &szx, &sna] {
            let step = (f.len() / 2000).max(1);
            for cut in (0..f.len()).step_by(step).chain(f.len() - 40..f.len()) {
                let _ = load(&f[..cut]);
                let _ = load_z80(&f[..cut]);
                let _ = load_szx(&f[..cut]);
                let _ = load_sna(&f[..cut]);
            }
            for i in (0..f.len()).step_by(step * 3) {
                let mut bad = f.clone();
                bad[i] ^= 0xA5;
                let _ = load(&bad);
            }
        }
        // Headers in particular: every byte of the first 128 changed to every value.
        for f in [&z80, &szx] {
            for i in 0..128 {
                for v in [0x00, 0x01, 0x03, 0x37, 0x80, 0xFF] {
                    let mut bad = f.clone();
                    bad[i] = v;
                    let _ = load(&bad);
                }
            }
        }
        // A cut .szx or version 3 .z80 is an error, not a snapshot with RAM missing.
        assert!(load_szx(&szx[..szx.len() - 1]).is_err());
        assert!(load_z80(&z80[..z80.len() - 1]).is_err());
    }
}

#[test]
fn paging() {
    let mut s = sample(Model::Spectrum128);
    s.port_7ffd = 0x0B; // Bank 3 at C000h, the second screen shown.
    assert_eq!((0..4).map(|slot| s.paged_bank(slot)).collect::<Vec<_>>(), [None, Some(5), Some(2), Some(3)]);
    assert_eq!(s.peek(0xC000), Some(s.bank(3).unwrap()[0]));
    assert_eq!(s.peek(0x0000), None);
    assert!(!s.poke(0x1000, 1));
    assert!(s.poke(0xFFFF, 0x42));
    assert_eq!(s.bank(3).unwrap()[0x3FFF], 0x42);
    assert_eq!(&s.screen()[..], &s.bank(7).unwrap()[..SCREEN_SIZE]);
    s.port_7ffd = 0x03;
    assert_eq!(&s.screen()[..], &s.bank(5).unwrap()[..SCREEN_SIZE]);

    // The +2A/+3's special paging: 1FFDh bit 0, and bits 1 and 2 choosing one of four all-RAM arrangements.
    let mut s = sample(Model::Plus3);
    for (bits, banks) in [(0x01, [0, 1, 2, 3]), (0x03, [4, 5, 6, 7]), (0x05, [4, 5, 6, 3]), (0x07, [4, 7, 6, 3])] {
        s.port_1ffd = bits;
        assert_eq!((0..4).map(|slot| s.paged_bank(slot).unwrap()).collect::<Vec<_>>(), banks);
    }
    // A 16K has RAM at 4000h only; a 48K at 4000h, 8000h, C000h.
    let s = Snapshot::new(Model::Spectrum16);
    assert_eq!((0..4).map(|slot| s.paged_bank(slot)).collect::<Vec<_>>(), [None, Some(5), None, None]);
    assert_eq!(s.peek(0x8000), None);
    let s = Snapshot::new(Model::Spectrum48);
    assert_eq!((0..4).map(|slot| s.paged_bank(slot)).collect::<Vec<_>>(), [None, Some(5), Some(2), Some(0)]);
    assert_eq!(s.paged_bank(4), None);
}

#[test]
fn models() {
    for m in Model::ALL {
        let s = Snapshot::new(m);
        assert_eq!(s.ram.iter().filter(|b| b.is_some()).count(), m.banks().len());
        assert_eq!(s.ay.is_some(), m.is_128k());
        assert_eq!(m.frame_tstates() % 4, 0, "the .z80 counter counts quarter frames");
    }
    assert_eq!(Model::Spectrum48.frame_tstates(), 224 * 312);
    assert_eq!(Model::Plus3.frame_tstates(), 228 * 311);
    assert_eq!(Model::Pentagon128.frame_tstates(), 224 * 320);
    // Debug shows the banks by CRC rather than all their bytes.
    let shown = format!("{:?}", Snapshot::new(Model::Spectrum16));
    assert!(shown.len() < 1000 && shown.contains("5:ab54d286"), "{shown}");
}
