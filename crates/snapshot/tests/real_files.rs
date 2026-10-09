//! Real snapshots from the Spectrum archive (spectrumcomputing.co.uk), of games ZXDB lists as available, one for
//! each version, model and writer the archive's files come in: fetched once by scripts/fixture, pinned by hash.
//! What each must read as was worked out by a second reader written separately from the format documents (in
//! Python; docs/snapshot.md), which agreed with this crate on all 457 snapshots of a survey of the archive. Each
//! is then written in each format and read back. A fixture that cannot be fetched is reported as skipped.

use std::path::PathBuf;
use std::process::Command;

use snapshot::{Error, Format, Model, Snapshot};

fn fixture(name: &str) -> Option<Vec<u8>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = Command::new(root.join("scripts/fixture")).arg(name).current_dir(&root).output().ok()?;
    if !out.status.success() {
        println!("SKIPPED: fixture {name} could not be fetched: {}", String::from_utf8_lossy(&out.stderr).trim());
        return None;
    }
    let path = String::from_utf8(out.stdout).ok()?;
    Some(std::fs::read(path.trim()).expect("a fetched fixture can be read"))
}

struct Expect {
    fixture: &'static str,
    format: Format,
    model: Model,
    pc: u16,
    sp: u16,
    af: u16,
    tstates: u32,
    border: u8,
    port_7ffd: u8,
    /// Each bank's CRC-32, in bank order 0 to 7 (a 48K's are banks 0, 2 and 5).
    banks: &'static [(usize, u32)],
}

const ZERO: u32 = 0xab54_d286;

#[rustfmt::skip]
const EXPECTED: &[Expect] = &[
    // Version 1, compressed, with the end marker.
    Expect { fixture: "snap-v1-acrojet.z80", format: Format::Z80, model: Model::Spectrum48, pc: 0x02ab, sp: 0x5fda, af: 0x0046, tstates: 0, border: 5, port_7ffd: 0, banks: &[(0, 0xfb72bb40), (2, 0x8d5b2780), (5, 0x5a745c77)] },
    // Version 1, the only uncompressed one in the survey.
    Expect { fixture: "snap-v1-raw-caverna.z80", format: Format::Z80, model: Model::Spectrum48, pc: 0x0604, sp: 0x6ff6, af: 0x0d47, tstates: 0, border: 0, port_7ffd: 0, banks: &[(0, 0x770032d9), (2, 0x48c92f73), (5, 0xa8f19bd0)] },
    Expect { fixture: "snap-v2-48k-deathtrap.z80", format: Format::Z80, model: Model::Spectrum48, pc: 0x755a, sp: 0xff40, af: 0x006a, tstates: 0, border: 1, port_7ffd: 0, banks: &[(0, 0x799e2a5f), (2, ZERO), (5, 0xb9e2942a)] },
    // Version 2's hardware mode 3, which is a 128K there (and a 48K with M.G.T. in version 3).
    Expect { fixture: "snap-v2-128k-brokeout.z80", format: Format::Z80, model: Model::Spectrum128, pc: 0xfaca, sp: 0x618c, af: 0xc1a1, tstates: 0, border: 0, port_7ffd: 0x10, banks: &[(0, 0x64622bef), (1, ZERO), (2, ZERO), (3, ZERO), (4, ZERO), (5, 0xa51a91cc), (6, ZERO), (7, 0x689b4a46)] },
    // Mode 9, every page stored uncompressed (length FFFFh).
    Expect { fixture: "snap-v2-pentagon-21.z80", format: Format::Z80, model: Model::Pentagon128, pc: 0x0038, sp: 0xa13f, af: 0x3d6a, tstates: 0, border: 3, port_7ffd: 0x30, banks: &[(0, 0xbd9b1739), (1, ZERO), (2, 0xb222bc4a), (3, ZERO), (4, ZERO), (5, 0xd1fffee0), (6, ZERO), (7, 0x8c264ac0)] },
    // Mode 3 with byte 37's bit 7: a +2 (locked into 48K paging, 7FFDh bit 5).
    Expect { fixture: "snap-v2-plus2-daytona48.z80", format: Format::Z80, model: Model::Plus2, pc: 0x0038, sp: 0xff46, af: 0x0054, tstates: 0, border: 0, port_7ffd: 0x30, banks: &[(0, 0x484d239d), (1, ZERO), (2, 0xa466dd57), (3, ZERO), (4, ZERO), (5, 0x0f3bac3a), (6, ZERO), (7, 0x194d0f6c)] },
    Expect { fixture: "snap-v3-48k-betting.z80", format: Format::Z80, model: Model::Spectrum48, pc: 0x0039, sp: 0xff42, af: 0x1339, tstates: 34_902, border: 4, port_7ffd: 0, banks: &[(0, 0x1514e9a4), (2, ZERO), (5, 0xc641b135)] },
    Expect { fixture: "snap-v3-128k-avalanche.z80", format: Format::Z80, model: Model::Spectrum128, pc: 0x0038, sp: 0x93f0, af: 0x03bb, tstates: 0, border: 0, port_7ffd: 0x30, banks: &[(0, 0xd2997775), (1, 0xaa770c56), (2, 0x72bcb6e4), (3, ZERO), (4, ZERO), (5, 0x34c8f8bb), (6, ZERO), (7, 0x69e3774a)] },
    // A low T-state counter larger than a quarter frame: read as Fuse reads it.
    Expect { fixture: "snap-v3-128k-legybator.z80", format: Format::Z80, model: Model::Spectrum128, pc: 0x25e0, sp: 0xff48, af: 0xcbaa, tstates: 28_093, border: 0, port_7ffd: 0x30, banks: &[(0, 0x71e5f96e), (1, ZERO), (2, 0xbef4a27e), (3, ZERO), (4, ZERO), (5, 0x862eb041), (6, ZERO), (7, 0x10e96f62)] },
    // Mode 12, the extension for the +2.
    Expect { fixture: "snap-v3-plus2-ministocks.z80", format: Format::Z80, model: Model::Plus2, pc: 0x0038, sp: 0xff4a, af: 0x23b3, tstates: 18, border: 0, port_7ffd: 0x10, banks: &[(0, 0x6d6c64fe), (1, 0xd426524b), (2, 0xa41e5dc5), (3, ZERO), (4, ZERO), (5, 0x8efd1ce6), (6, ZERO), (7, 0x6b2bbfdc)] },
    // Mode 7 with the 55-byte header that keeps 1FFDh.
    Expect { fixture: "snap-v3-plus3-piramids.z80", format: Format::Z80, model: Model::Plus3, pc: 0x0038, sp: 0x5efa, af: 0x0054, tstates: 35_453, border: 0, port_7ffd: 0x10, banks: &[(0, 0xdf92d715), (1, 0x7e296307), (2, 0x1596b938), (3, 0x69b32d74), (4, 0x69b32d74), (5, 0x188970c6), (6, 0x69b32d74), (7, 0xe41d5b74)] },
    // 128K .sna with bank 7 paged, and with bank 0 paged.
    Expect { fixture: "snap-128k-chata3.sna", format: Format::Sna, model: Model::Spectrum128, pc: 0x0038, sp: 0x5bf9, af: 0xdd54, tstates: 0, border: 0, port_7ffd: 0x07, banks: &[(0, 0x43cdb37c), (1, ZERO), (2, 0x963001b1), (3, ZERO), (4, ZERO), (5, 0xea6f7893), (6, ZERO), (7, 0x70033cbb)] },
    Expect { fixture: "snap-128k-lombard.sna", format: Format::Sna, model: Model::Spectrum128, pc: 0x0038, sp: 0x9c38, af: 0x005c, tstates: 0, border: 0, port_7ffd: 0x10, banks: &[(0, 0x778f46b8), (1, 0x193ec48a), (2, 0xdc18ad44), (3, 0x690b37d3), (4, 0x690b37d3), (5, 0x952a6827), (6, 0x690b37d3), (7, 0x5cfe9873)] },
    // zx-state 1.3 (SpecEmu), 1.4 (Spectaculator), 1.5 (Fuse) and 1.3 128K.
    Expect { fixture: "snap-szx13-48k-fruitmachine.szx", format: Format::Szx, model: Model::Spectrum48, pc: 0x0038, sp: 0x9c30, af: 0x0054, tstates: 24, border: 1, port_7ffd: 0, banks: &[(0, 0xb6961ee0), (2, 0x2bb12da9), (5, 0x14f2233e)] },
    Expect { fixture: "snap-szx14-48k-piramide.szx", format: Format::Szx, model: Model::Spectrum48, pc: 0x0038, sp: 0xff4d, af: 0x015c, tstates: 15, border: 0, port_7ffd: 0, banks: &[(0, 0x87c0050a), (2, 0xcd446431), (5, 0xaa347849)] },
    Expect { fixture: "snap-szx15-128k-littlefish.szx", format: Format::Szx, model: Model::Spectrum128, pc: 0x0038, sp: 0x5de4, af: 0x00bb, tstates: 14, border: 0, port_7ffd: 0x10, banks: &[(0, 0x8223ddb3), (1, 0xa048c9fe), (2, 0xd6f7e159), (3, 0x752bd6d4), (4, 0x532117fc), (5, 0x55274158), (6, 0x91f214aa), (7, 0x69e3774a)] },
    Expect { fixture: "snap-szx13-128k-gamex2.szx", format: Format::Szx, model: Model::Spectrum128, pc: 0x003a, sp: 0x5db2, af: 0x015c, tstates: 36, border: 1, port_7ffd: 0x10, banks: &[(0, 0xc248f831), (1, 0x55d62c7f), (2, 0x7091b393), (3, ZERO), (4, ZERO), (5, 0x27c4f5c2), (6, ZERO), (7, 0x444da1a8)] },
    // Super level loader snapshots: version 3 .z80s with level data after them.
    Expect { fixture: "snap-slt-heavymetal.slt", format: Format::Z80, model: Model::Spectrum128, pc: 0x72f3, sp: 0xe4e2, af: 0x0818, tstates: 70_683, border: 0, port_7ffd: 0x10, banks: &[(0, 0x382b6730), (1, 0x782e1f56), (2, 0xfdc0ec23), (3, ZERO), (4, ZERO), (5, 0xac0d5c2d), (6, ZERO), (7, 0x5c3112e0)] },
    Expect { fixture: "snap-slt-killeduntildead.slt", format: Format::Z80, model: Model::Spectrum48, pc: 0x8014, sp: 0x5ff8, af: 0xff42, tstates: 52_191, border: 0, port_7ffd: 0, banks: &[(0, 0x27de711f), (2, 0x80db9494), (5, 0x45aab7cd)] },
];

fn check(e: &Expect, bytes: &[u8]) -> Snapshot {
    assert_eq!(snapshot::detect(bytes), Some(e.format), "{}", e.fixture);
    let s = snapshot::load(bytes).unwrap_or_else(|err| panic!("{}: {err}", e.fixture));
    let got = (s.model, s.regs.pc, s.regs.sp, s.regs.af, s.tstates, s.border(), s.port_7ffd);
    assert_eq!(got, (e.model, e.pc, e.sp, e.af, e.tstates, e.border, e.port_7ffd), "{}", e.fixture);
    let banks: Vec<(usize, u32)> = (0..8).filter_map(|b| s.bank(b).map(|d| (b, unzip::crc32(&d[..])))).collect();
    assert_eq!(banks, e.banks, "{}", e.fixture);

    // Written in each format and read back: .z80 and .szx keep all of it but what each cannot hold, and .sna
    // what it can.
    let z80 = snapshot::load(&snapshot::save_z80(&s)).unwrap();
    let mut expected = s.clone();
    expected.regs.memptr = None;
    expected.regs.halted = false;
    expected.regs.interrupts_suppressed = false;
    expected.regs.flags_set = false;
    expected.port_fe &= 7;
    expected.late_timings = false;
    expected.tape = None;
    expected.custom_rom = None;
    if s.joystick.is_none() || s.joystick == Some(snapshot::Joystick::Fuller) {
        expected.joystick = Some(snapshot::Joystick::Cursor);
    }
    assert_eq!(z80, expected, "{} through .z80", e.fixture);
    let szx = snapshot::load(&snapshot::save_szx(&s)).unwrap();
    // zx-state keeps Issue 2 for the 16K and 48K alone ("For other models, set this member to 0"), where some 128K
    // .z80 files have it set.
    let issue2 = s.issue2 && !s.model.is_128k();
    assert_eq!(szx, Snapshot { slt: None, issue2, ..s.clone() }, "{} through .szx", e.fixture);
    let sna = snapshot::load(&snapshot::save_sna(&s).unwrap()).unwrap();
    assert_eq!(
        (sna.regs.pc, sna.regs.sp, sna.regs.af),
        (s.regs.pc, s.regs.sp, s.regs.af),
        "{} through .sna",
        e.fixture
    );
    if s.model.is_128k() {
        assert_eq!(sna.ram, s.ram, "{} through .sna", e.fixture);
    }
    s
}

#[test]
fn every_version_model_and_writer() {
    let mut checked = 0;
    for e in EXPECTED {
        if let Some(bytes) = fixture(e.fixture) {
            check(e, &bytes);
            checked += 1;
        }
    }
    println!("{checked} of {} real snapshots checked", EXPECTED.len());
}

#[test]
fn a_48k_sna_out_of_its_zip() {
    let Some(zip) = fixture("mexican-adventure.sna.zip") else { return };
    let files = unzip::spectrum_files(&zip).unwrap();
    let e = Expect {
        fixture: "MexicanAdventure.sna",
        format: Format::Sna,
        model: Model::Spectrum48,
        pc: 0x0038,
        sp: 0xe666,
        af: 0x005c,
        tstates: 0,
        border: 1,
        port_7ffd: 0,
        banks: &[(0, 0x32189a6a), (2, 0x76a96f24), (5, 0xadd9e7c4)],
    };
    let s = check(&e, &files[0].data);
    // Written back as a .sna, it is the same file: the PC pushed back where it was popped from.
    assert_eq!(snapshot::save_sna(&s).unwrap(), files[0].data);
}

#[test]
fn super_level_loader_levels_and_screen() {
    if let Some(bytes) = fixture("snap-slt-heavymetal.slt") {
        let slt = snapshot::load(&bytes).unwrap().slt.unwrap();
        let levels: Vec<(u8, usize, u32)> = slt.levels.iter().map(|(&l, d)| (l, d.len(), unzip::crc32(d))).collect();
        assert_eq!(
            levels,
            [(65, 17_591, 0xfeafffbb), (66, 12_334, 0x18eeab4b), (67, 16_828, 0x350807ea), (68, 6879, 0x5937f804)]
        );
        assert!(slt.screen.is_none());
    }
    if let Some(bytes) = fixture("snap-slt-killeduntildead.slt") {
        let slt = snapshot::load(&bytes).unwrap().slt.unwrap();
        assert_eq!(slt.levels.len(), 55);
        assert_eq!((slt.levels[&1].len(), unzip::crc32(&slt.levels[&1])), (36_674, 0x38f7a921));
        assert_eq!(unzip::crc32(&slt.screen.unwrap()[..]), 0xb17424af);
    }
}

#[test]
fn a_timex_is_refused_by_name() {
    let Some(bytes) = fixture("snap-v3-tc2048-hunchback08.z80") else { return };
    assert_eq!(snapshot::load(&bytes).unwrap_err(), Error::Unsupported("a Timex TC2048".into()));
}

#[test]
fn a_screen_dump_from_the_archive() {
    // Saboteur's loading screen, as the archive keeps it.
    let Some(bytes) = fixture("ref-game-saboteur-load.scr") else { return };
    let screen = snapshot::load_scr(&bytes).unwrap();
    assert_eq!(&screen[..], &bytes[..]);
    assert_eq!(snapshot::detect(&bytes), None);
}
