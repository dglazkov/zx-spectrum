//! Real archives from the Spectrum archive (spectrumcomputing.co.uk), fetched once by scripts/fixture and pinned by
//! hash. Each was picked for something a reader must get right: a data descriptor, a code page 437 name,
//! directories and stored entries, an archive of several files. A fixture that cannot be fetched is reported as
//! skipped, never passed.

use std::path::PathBuf;
use std::process::Command;

use unzip::{Archive, Kind, Method};

/// The fixture's bytes, or None (having said so) when it cannot be fetched here.
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

#[test]
fn saboteur_tzx_zip() {
    let Some(zip) = fixture("saboteur.tzx.zip") else { return };
    let a = Archive::new(&zip).unwrap();
    let files = a.spectrum_files().unwrap();
    let names: Vec<_> = files.iter().map(|f| (f.name.as_str(), f.kind, f.data.len())).collect();
    assert_eq!(names, [("Saboteur - Side 1.tzx", Kind::Tzx, 49_142), ("Saboteur - Side 2.tzx", Kind::Tzx, 47_973)]);
    // The same file the tape's own fixture is (that one taken out of this archive by Python's zipfile).
    if let Some(tzx) = fixture("saboteur.tzx") {
        assert_eq!(files[0].data, tzx);
    }
}

#[test]
fn a_data_descriptor() {
    // Written by Info-ZIP on Unix with bit 3 set: the local header has no CRC or sizes.
    let Some(zip) = fixture("mexican-adventure.sna.zip") else { return };
    let a = Archive::new(&zip).unwrap();
    let e = &a.entries()[0];
    assert_eq!(e.name, "MexicanAdventure.sna");
    assert_eq!(e.flags & 8, 8);
    assert_eq!(e.method, Method::Deflated);
    let files = a.spectrum_files().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].kind, Kind::Sna);
    assert_eq!(files[0].data.len(), 49_179);
}

#[test]
fn a_code_page_437_name() {
    // "Aquanoids (versión reducida) beta2.6.tap", its ó stored as A2h by a DOS-era archiver.
    let Some(zip) = fixture("aquanoids-reduced.tap.zip") else { return };
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.entries()[0].raw_name[16], 0xA2);
    let files = a.spectrum_files().unwrap();
    let names: Vec<_> = files.iter().map(|f| (f.name.as_str(), f.kind)).collect();
    assert!(names.contains(&("Aquanoids (versión reducida) beta2.6.tap", Kind::Tap)), "{names:?}");
}

#[test]
fn directories_pictures_and_documents_beside_the_snapshots() {
    // Nine entries: a directory, four stored GIFs, two Word documents and two .z80 snapshots, all under a path.
    let Some(zip) = fixture("stab-des-druiden.z80.zip") else { return };
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.entries().len(), 9);
    assert_eq!(a.entries().iter().filter(|e| e.is_dir()).count(), 1);
    assert_eq!(a.entries().iter().filter(|e| e.method == Method::Stored).count(), 5);
    for e in a.entries() {
        assert_eq!(a.extract(e).unwrap().len() as u64, e.size, "{}", e.name);
    }
    let files = a.spectrum_files().unwrap();
    let names: Vec<_> = files.iter().map(|f| (f.name.rsplit('/').next().unwrap(), f.kind)).collect();
    assert_eq!(names, [("Druide.z80", Kind::Z80), ("D11.z80", Kind::Z80)]);
}
