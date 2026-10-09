//! Archives built here, byte by byte, for each thing a reader can meet: both methods, data descriptors with and
//! without their signature, names in each encoding, Zip64, a prepended stub, and each way an archive can be
//! damaged.

use super::*;

/// How to write one entry of a test archive.
#[derive(Clone)]
struct Spec {
    name: Vec<u8>,
    data: Vec<u8>,
    deflate: bool,
    flags: u16,
    /// Leave CRC and sizes out of the local header, and write a data descriptor (with its signature or not).
    descriptor: Option<bool>,
    made_by: u16,
    extra: Vec<u8>,
    method: Option<u16>,
    /// Write this CRC instead of the right one.
    crc: Option<u32>,
    /// Write these sizes in the directory instead of the right ones.
    size: Option<u32>,
    zip64: bool,
}

impl Spec {
    fn new(name: &str, data: &[u8]) -> Spec {
        Spec {
            name: name.as_bytes().to_vec(),
            data: data.to_vec(),
            deflate: true,
            flags: 0,
            descriptor: None,
            made_by: 20,
            extra: Vec::new(),
            method: None,
            crc: None,
            size: None,
            zip64: false,
        }
    }
    fn stored(mut self) -> Spec {
        self.deflate = false;
        self
    }
}

fn put16(v: &mut Vec<u8>, x: u16) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn put32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn put64(v: &mut Vec<u8>, x: u64) {
    v.extend_from_slice(&x.to_le_bytes());
}

/// An archive of `specs`, with `prefix` before it and `comment` after it, as an archiver would write it.
fn build(prefix: &[u8], specs: &[Spec], comment: &[u8]) -> Vec<u8> {
    let mut out = prefix.to_vec();
    let mut central = Vec::new();
    let zip64 = specs.iter().any(|s| s.zip64);
    for s in specs {
        let offset = (out.len() - prefix.len()) as u32;
        let packed = if s.deflate { miniz_oxide::deflate::compress_to_vec(&s.data, 6) } else { s.data.clone() };
        let method = s.method.unwrap_or(if s.deflate { 8 } else { 0 });
        let crc = s.crc.unwrap_or(crc32(&s.data));
        let flags = s.flags | if s.descriptor.is_some() { 8 } else { 0 };
        let (csize, usize_) = (packed.len() as u32, s.size.unwrap_or(s.data.len() as u32));
        let (dir_csize, dir_usize, dir_offset) =
            if s.zip64 { (0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF) } else { (csize, usize_, offset) };
        let mut extra = s.extra.clone();
        if s.zip64 {
            put16(&mut extra, 0x0001);
            put16(&mut extra, 24);
            put64(&mut extra, usize_ as u64);
            put64(&mut extra, csize as u64);
            put64(&mut extra, offset as u64);
        }

        put32(&mut out, LOCAL_HEADER);
        put16(&mut out, 20);
        put16(&mut out, flags);
        put16(&mut out, method);
        put16(&mut out, 0x6000); // 12:00:00
        put16(&mut out, (6 << 9) | (3 << 5) | 14); // 14 March 1986
        if s.descriptor.is_some() {
            out.extend_from_slice(&[0; 12]);
        } else {
            put32(&mut out, crc);
            put32(&mut out, csize);
            put32(&mut out, usize_);
        }
        put16(&mut out, s.name.len() as u16);
        put16(&mut out, 0);
        out.extend_from_slice(&s.name);
        out.extend_from_slice(&packed);
        if let Some(signed) = s.descriptor {
            if signed {
                put32(&mut out, 0x0807_4b50);
            }
            put32(&mut out, crc);
            put32(&mut out, csize);
            put32(&mut out, usize_);
        }

        put32(&mut central, CENTRAL_HEADER);
        put16(&mut central, s.made_by);
        put16(&mut central, 20);
        put16(&mut central, flags);
        put16(&mut central, method);
        put16(&mut central, 0x6000);
        put16(&mut central, (6 << 9) | (3 << 5) | 14);
        put32(&mut central, crc);
        put32(&mut central, dir_csize);
        put32(&mut central, dir_usize);
        put16(&mut central, s.name.len() as u16);
        put16(&mut central, extra.len() as u16);
        put16(&mut central, 0);
        put16(&mut central, 0);
        put16(&mut central, 0);
        put32(&mut central, 0);
        put32(&mut central, dir_offset);
        central.extend_from_slice(&s.name);
        central.extend_from_slice(&extra);
    }
    let cd_offset = (out.len() - prefix.len()) as u32;
    let cd_size = central.len() as u32;
    out.extend_from_slice(&central);
    if zip64 {
        let record = (out.len() - prefix.len()) as u64;
        put32(&mut out, ZIP64_END_OF_CENTRAL_DIRECTORY);
        put64(&mut out, 44);
        put16(&mut out, 45);
        put16(&mut out, 45);
        put32(&mut out, 0);
        put32(&mut out, 0);
        put64(&mut out, specs.len() as u64);
        put64(&mut out, specs.len() as u64);
        put64(&mut out, cd_size as u64);
        put64(&mut out, cd_offset as u64);
        put32(&mut out, ZIP64_LOCATOR);
        put32(&mut out, 0);
        put64(&mut out, record);
        put32(&mut out, 1);
    }
    put32(&mut out, END_OF_CENTRAL_DIRECTORY);
    put16(&mut out, 0);
    put16(&mut out, 0);
    let count = if zip64 { 0xFFFF } else { specs.len() as u16 };
    put16(&mut out, count);
    put16(&mut out, count);
    put32(&mut out, if zip64 { 0xFFFF_FFFF } else { cd_size });
    put32(&mut out, if zip64 { 0xFFFF_FFFF } else { cd_offset });
    put16(&mut out, comment.len() as u16);
    out.extend_from_slice(comment);
    out
}

/// Something a Spectrum could load: a TAP holding one BASIC header ("saboteur") and its data block.
fn tap() -> Vec<u8> {
    fn block(flag: u8, body: &[u8]) -> Vec<u8> {
        let mut b = vec![0, 0, flag];
        b.extend_from_slice(body);
        b.push(body.iter().fold(flag, |x, y| x ^ y));
        let len = (b.len() - 2) as u16;
        b[0..2].copy_from_slice(&len.to_le_bytes());
        b
    }
    let mut header = vec![0u8];
    header.extend_from_slice(b"saboteur  ");
    header.extend_from_slice(&[5, 0, 10, 0, 5, 0]);
    let mut t = block(0x00, &header);
    t.extend(block(0xFF, &[0xF3, 0xAF, 0xC9, 0x00, 0x0D]));
    t
}

fn text() -> Vec<u8> {
    b"SABOTEUR by Clive Townsend. Load with LOAD \"\"\r\n".repeat(20)
}

#[test]
fn stored_and_deflated_entries_list_and_extract() {
    let zip = build(&[], &[Spec::new("SABOTEUR.TAP", &tap()), Spec::new("README.TXT", &text()).stored()], b"");
    assert!(is_zip(&zip));
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.entries().len(), 2);
    let e = &a.entries()[0];
    assert_eq!(e.name, "SABOTEUR.TAP");
    assert_eq!(e.method, Method::Deflated);
    assert_eq!(e.size, tap().len() as u64);
    assert_eq!(e.modified, DosDateTime { year: 1986, month: 3, day: 14, hour: 12, minute: 0, second: 0 });
    assert_eq!(a.extract(e).unwrap(), tap());
    let readme = a.find("readme.txt").unwrap();
    assert_eq!(readme.method, Method::Stored);
    assert_eq!(a.extract(readme).unwrap(), text());
    assert!(a.find("nothing").is_none());
}

#[test]
fn data_descriptors_with_and_without_signature() {
    let mut signed = Spec::new("A.TAP", &tap());
    signed.descriptor = Some(true);
    let mut unsigned = Spec::new("B.TXT", &text());
    unsigned.descriptor = Some(false);
    let zip = build(&[], &[signed, unsigned], b"");
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.extract(&a.entries()[0]).unwrap(), tap());
    assert_eq!(a.extract(&a.entries()[1]).unwrap(), text());
}

#[test]
fn names_in_each_encoding() {
    // Code page 437, as a DOS archiver wrote "versión".
    let cp437 = Spec { name: b"versi\xa2n.tap".to_vec(), ..Spec::new("", &tap()) };
    // UTF-8, said so by bit 11.
    let flagged = Spec { name: "Ñandú.tap".as_bytes().to_vec(), flags: FLAG_UTF8, ..Spec::new("", &tap()) };
    // UTF-8 from a Unix archiver that did not say so.
    let unix = Spec { name: "Café.tap".as_bytes().to_vec(), made_by: (3 << 8) | 30, ..Spec::new("", &tap()) };
    // The same bytes from a DOS archiver are code page 437.
    let dos = Spec { name: "Café.tap".as_bytes().to_vec(), ..Spec::new("", &tap()) };
    // Info-ZIP's Unicode path field over a code page 437 name.
    let mut extra = Vec::new();
    let plain = b"Gruen.tap";
    let unicode = "Grün.tap".as_bytes();
    put16(&mut extra, EXTRA_UNICODE_PATH);
    put16(&mut extra, (5 + unicode.len()) as u16);
    extra.push(1);
    put32(&mut extra, crc32(plain));
    extra.extend_from_slice(unicode);
    let upath = Spec { name: plain.to_vec(), extra: extra.clone(), ..Spec::new("", &tap()) };
    // A Unicode path whose CRC no longer matches the name (renamed since) is ignored.
    let stale = Spec { name: b"Other.tap".to_vec(), extra, ..Spec::new("", &tap()) };
    let zip = build(&[], &[cp437, flagged, unix, dos, upath, stale], b"");
    let names: Vec<_> = Archive::new(&zip).unwrap().entries().iter().map(|e| e.name.clone()).collect();
    assert_eq!(names, ["versión.tap", "Ñandú.tap", "Café.tap", "Caf├⌐.tap", "Grün.tap", "Other.tap"]);
}

#[test]
fn a_prepended_stub_and_a_comment() {
    let stub = b"MZ this is a self-extractor's program".repeat(10);
    let zip = build(&stub, &[Spec::new("GAME.TAP", &tap())], b"Downloaded from the archive");
    assert!(!is_zip(&zip));
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.comment(), "Downloaded from the archive");
    assert_eq!(a.extract(&a.entries()[0]).unwrap(), tap());
}

#[test]
fn zip64_records_and_extra_fields() {
    let mut s = Spec::new("BIG.TAP", &tap());
    s.zip64 = true;
    let zip = build(&[], &[s, Spec::new("SMALL.TXT", &text())], b"");
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.entries().len(), 2);
    assert_eq!(a.entries()[0].size, tap().len() as u64);
    assert_eq!(a.extract(&a.entries()[0]).unwrap(), tap());
    assert_eq!(a.extract(&a.entries()[1]).unwrap(), text());
}

#[test]
fn an_empty_archive() {
    let zip = build(&[], &[], b"");
    assert_eq!(zip.len(), 22);
    assert!(is_zip(&zip));
    assert!(Archive::new(&zip).unwrap().entries().is_empty());
    assert!(spectrum_files(&zip).unwrap().is_empty());
}

#[test]
fn damage_fails_cleanly() {
    let zip = build(&[], &[Spec::new("SABOTEUR.TAP", &tap())], b"");
    // Not a zip at all; a zip with its end cut off; a zip cut in the middle of its data.
    assert_eq!(Archive::new(b"ZXTape!\x1a\x01\x14").unwrap_err(), Error::NotZip);
    assert_eq!(Archive::new(&zip[..zip.len() - 1]).unwrap_err(), Error::NotZip);
    for cut in 0..zip.len() {
        // Every prefix of the archive either fails as one, or (once the directory is whole) reads.
        if let Ok(a) = Archive::new(&zip[..cut]) {
            for e in a.entries() {
                let _ = a.extract(e);
            }
        }
    }
    // A byte of the deflated data changed: it no longer inflates, or no longer has its CRC.
    let at = 30 + "SABOTEUR.TAP".len() + 3;
    let mut bad = zip.clone();
    bad[at] ^= 0x55;
    let a = Archive::new(&bad).unwrap();
    assert!(matches!(a.extract(&a.entries()[0]), Err(Error::Corrupt { .. } | Error::Crc { .. })));
    // The local header's signature gone.
    let mut bad = zip.clone();
    bad[0] = b'X';
    let a = Archive::new(&bad).unwrap();
    assert!(matches!(a.extract(&a.entries()[0]), Err(Error::Damaged(_))));
    // Every single byte of the archive changed in turn: whatever it does, it does not panic.
    for i in 0..zip.len() {
        let mut bad = zip.clone();
        bad[i] = bad[i].wrapping_add(0x41);
        if let Ok(a) = Archive::new(&bad) {
            for e in a.entries() {
                let _ = a.extract(e);
            }
            let _ = a.spectrum_files();
        }
    }
}

#[test]
fn wrong_crc_and_wrong_size_are_caught() {
    let mut s = Spec::new("SABOTEUR.TAP", &tap());
    s.crc = Some(0x1234_5678);
    let zip = build(&[], &[s], b"");
    let a = Archive::new(&zip).unwrap();
    match a.extract(&a.entries()[0]) {
        Err(Error::Crc { expected, actual, .. }) => {
            assert_eq!(expected, 0x1234_5678);
            assert_eq!(actual, crc32(&tap()));
        }
        other => panic!("{other:?}"),
    }
    // Said to be smaller than it inflates to: refused without inflating further.
    let mut s = Spec::new("SABOTEUR.TAP", &tap());
    s.size = Some(10);
    let zip = build(&[], &[s], b"");
    let a = Archive::new(&zip).unwrap();
    assert!(matches!(a.extract(&a.entries()[0]), Err(Error::Corrupt { .. })));
    // Said to be larger.
    let mut s = Spec::new("SABOTEUR.TAP", &tap());
    s.size = Some(5000);
    let zip = build(&[], &[s], b"");
    let a = Archive::new(&zip).unwrap();
    assert!(matches!(a.extract(&a.entries()[0]), Err(Error::Corrupt { .. })));
}

#[test]
fn encryption_and_other_methods_are_refused_by_name() {
    let encrypted = Spec { flags: FLAG_ENCRYPTED, ..Spec::new("SECRET.TAP", &tap()).stored() };
    let bzip2 = Spec { method: Some(12), ..Spec::new("PACKED.TAP", &tap()).stored() };
    let zip = build(&[], &[encrypted, bzip2], b"");
    let a = Archive::new(&zip).unwrap();
    assert_eq!(a.extract(&a.entries()[0]).unwrap_err(), Error::Encrypted("SECRET.TAP".into()));
    let e = a.extract(&a.entries()[1]).unwrap_err();
    assert_eq!(e, Error::UnsupportedMethod { name: "PACKED.TAP".into(), method: 12 });
    assert!(e.to_string().contains("bzip2"));
    // Asked for the Spectrum files, these are errors rather than silently missing.
    assert!(a.spectrum_files().is_err());
}

#[test]
fn spectrum_files_by_name_and_by_content() {
    let mut tzx = b"ZXTape!\x1a\x01\x14".to_vec();
    tzx.extend_from_slice(&[0x10, 0xE8, 0x03, 0x13, 0x00]);
    let zip = build(
        &[],
        &[
            Spec::new("Game/", b"").stored(),
            Spec::new("Game/Saboteur - Side 1.tzx", &tzx),
            Spec::new("__MACOSX/Game/._Saboteur - Side 1.tzx", b"\0\x05\x16\x07 resource fork"),
            Spec::new("Game/._other.tap", &tap()),
            // The name lies: a TZX called .tap, a TAP with no extension.
            Spec::new("Game/side2.tap", &tzx),
            Spec::new("Game/LOADER", &tap()),
            Spec::new("Game/inlay.txt", &text()),
            // A screen by its size, but a text file of the same size is not one.
            Spec::new("Game/loading.scr", &[0x38; 6912]),
            Spec::new("Game/SCREEN", &[0x47; 6912]),
            Spec::new("Game/notes.txt", &[b'x'; 6912]),
            Spec::new("Game/level.SLT", &[0; 10]),
        ],
        b"",
    );
    let files = spectrum_files(&zip).unwrap();
    let got: Vec<_> = files.iter().map(|f| (f.name.as_str(), f.kind)).collect();
    assert_eq!(
        got,
        [
            ("Game/Saboteur - Side 1.tzx", Kind::Tzx),
            ("Game/side2.tap", Kind::Tzx),
            ("Game/LOADER", Kind::Tap),
            ("Game/loading.scr", Kind::Scr),
            ("Game/SCREEN", Kind::Scr),
            ("Game/level.SLT", Kind::Z80),
        ]
    );
    assert_eq!(files[0].data, tzx);
    assert_eq!(files[0].index, 1);
}

#[test]
fn sniffing_each_kind() {
    assert_eq!(Kind::sniff(&tap()), Some(Kind::Tap));
    // A TAP whose first block's checksum is wrong is not conclusively one.
    let mut t = tap();
    t[5] ^= 1;
    assert_eq!(Kind::sniff(&t), None);
    assert_eq!(classify("game.tap", &t), Some(Kind::Tap));
    assert_eq!(Kind::sniff(b"PZXT\x02\x00\x00\x00\x01\x00"), Some(Kind::Pzx));
    assert_eq!(Kind::sniff(b"Compressed Square Wave\x1a\x02\x00"), Some(Kind::Csw));
    assert_eq!(Kind::sniff(b"ZXST\x01\x04\x01\x00"), Some(Kind::Szx));
    assert_eq!(Kind::sniff(b"EXTENDED CPC DSK File\r\nDisk-Info\r\n"), Some(Kind::Dsk));
    assert_eq!(Kind::sniff(b"MV - CPCEMU Disk-File\r\nDisk-Info\r\n"), Some(Kind::Dsk));
    assert_eq!(Kind::sniff(b"SINCLAIR\x01boot    B"), Some(Kind::Scl));
    let mut trd = vec![0u8; 0x1000];
    trd[0x8E3] = 0x16;
    trd[0x8E7] = 0x10;
    assert_eq!(Kind::sniff(&trd), Some(Kind::Trd));
    // A version 3 .z80: header, then one compressed page and one stored page.
    let mut z80 = vec![0u8; 32 + 54];
    z80[30] = 54;
    z80.extend_from_slice(&[4, 0, 8, 0xED, 0xED, 0xFF, 0x00]);
    z80.extend_from_slice(&[0xFF, 0xFF, 4]);
    z80.extend_from_slice(&[0; 0x4000]);
    assert_eq!(Kind::sniff(&z80), Some(Kind::Z80));
    z80.push(0);
    assert_eq!(Kind::sniff(&z80), None);
    // A compressed version 1 .z80 ends with its end marker.
    let mut v1 = vec![0u8; 30];
    v1[6] = 0x34;
    v1[12] = 0x20;
    v1.extend_from_slice(&[0xED, 0xED, 0xFF, 0x00, 0x00, 0xED, 0xED, 0x00]);
    assert_eq!(Kind::sniff(&v1), Some(Kind::Z80));
    let mut sna = vec![0u8; 49_179];
    sna[25] = 1;
    assert_eq!(Kind::sniff(&sna), Some(Kind::Sna));
    assert_eq!(Kind::sniff(&[0u8; 6912]), Some(Kind::Scr));
    assert_eq!(Kind::sniff(&text()), None);
    assert_eq!(Kind::from_name("Saboteur - Side 1.TZX"), Some(Kind::Tzx));
    assert_eq!(Kind::from_name("dir.tap/README"), None);
    assert_eq!(Kind::from_name(".tap"), None);
    for k in Kind::ALL {
        assert_eq!(Kind::from_name(&format!("x.{}", k.extension())), Some(k));
        assert_eq!(1, [k.is_tape(), k.is_snapshot(), k.is_disk(), k == Kind::Scr].iter().filter(|b| **b).count());
    }
}

#[test]
fn inflating_to_exactly_the_stated_size_is_allowed() {
    // The limit given to the inflater is the size itself: an entry of exactly that size must come out whole.
    for len in [0usize, 1, 100, 32_768, 65_536, 100_000] {
        let data: Vec<u8> = (0..len).map(|i| (i * 7 % 251) as u8).collect();
        let zip = build(&[], &[Spec::new("X.BIN", &data)], b"");
        let a = Archive::new(&zip).unwrap();
        assert_eq!(a.extract(&a.entries()[0]).unwrap(), data, "{len}");
    }
}

#[test]
fn a_zip64_offset_that_overflows_with_a_stub_before_it() {
    // A self-extractor's stub before the archive moves every offset by its length; a Zip64 local header offset
    // near 2^64 then overflows when that length is added. It is damage, to be refused, not a panic.
    let stub = b"MZ a self-extractor".repeat(4);
    let mut s = Spec::new("BIG.TAP", &tap());
    s.zip64 = true;
    let mut zip = build(&stub, &[s], b"");
    let field = zip.windows(4).rposition(|w| w == [0x01, 0x00, 24, 0x00]).unwrap();
    zip[field + 20..field + 28].copy_from_slice(&u64::MAX.to_le_bytes());
    match Archive::new(&zip) {
        Ok(a) => assert!(a.extract(&a.entries()[0]).is_err()),
        Err(e) => assert!(matches!(e, Error::Damaged(_)), "{e:?}"),
    }
}

/// A small generator of the same numbers every run (xorshift64*), so that a failure found once is found again.
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

/// `data` with one damage of a kind real archives suffer (or a hostile one is made of): bits flipped, a field set
/// to an extreme, the end cut off, bytes inserted, removed or repeated. Offsets near a record's signature are
/// favoured, where the fields that say where everything else is are.
fn mutate(rng: &mut Rng, data: &[u8]) -> Vec<u8> {
    let mut d = data.to_vec();
    if d.is_empty() {
        return d;
    }
    let signatures: Vec<usize> = d.windows(2).enumerate().filter(|(_, w)| w == b"PK").map(|(i, _)| i).collect();
    let at = |rng: &mut Rng, len: usize| {
        if !signatures.is_empty() && rng.below(2) == 0 {
            (signatures[rng.below(signatures.len())] + rng.below(96)).min(len - 1)
        } else {
            rng.below(len)
        }
    };
    for _ in 0..1 + rng.below(3) {
        let len = d.len();
        if len == 0 {
            break;
        }
        match rng.below(7) {
            0 => {
                let i = at(rng, len);
                d[i] ^= 1 << rng.below(8);
            }
            1 => {
                let i = at(rng, len);
                d[i] = [0x00, 0x01, 0x7F, 0x80, 0xFF][rng.below(5)];
            }
            2 => {
                // A 16-, 32- or 64-bit field set to an extreme.
                let i = at(rng, len);
                let v: u64 = [0, 1, 0xFFFF, 0xFFFF_FFFF, u64::MAX, len as u64, (len as u64) << 1][rng.below(7)];
                let width = [2, 4, 8][rng.below(3)];
                for (k, b) in v.to_le_bytes()[..width].iter().enumerate() {
                    if i + k < len {
                        d[i + k] = *b;
                    }
                }
            }
            3 => d.truncate(rng.below(len)),
            4 => {
                let i = at(rng, len);
                let n = 1 + rng.below(16);
                let bytes: Vec<u8> = (0..n).map(|_| rng.next() as u8).collect();
                d.splice(i..i, bytes);
            }
            5 => {
                let i = at(rng, len);
                let end = (i + 1 + rng.below(64)).min(len);
                d.drain(i..end);
            }
            _ => {
                let i = at(rng, len);
                let end = (i + 1 + rng.below(64)).min(len);
                let copy = d[i..end].to_vec();
                let j = rng.below(d.len());
                d.splice(j..j, copy);
            }
        }
    }
    d
}

#[test]
fn random_damage_never_panics() {
    // Archives of every shape this crate reads, each damaged thousands of ways from a fixed seed: whatever an
    // archive says, reading it, listing it, extracting each entry and picking out the Spectrum files give an
    // answer or an error, never a panic or an overflow.
    let mut descriptor = Spec::new("A.TAP", &tap());
    descriptor.descriptor = Some(true);
    let mut bare = Spec::new("B.TXT", &text()).stored();
    bare.descriptor = Some(false);
    let mut big = Spec::new("BIG.TAP", &tap());
    big.zip64 = true;
    let cp437 = Spec { name: b"versi\xa2n.tap".to_vec(), ..Spec::new("", &tap()) };
    let mut extra = Vec::new();
    put16(&mut extra, EXTRA_UNICODE_PATH);
    put16(&mut extra, 5 + 8);
    extra.push(1);
    put32(&mut extra, crc32(b"Gruen.tap"));
    extra.extend_from_slice("Grün.tap".as_bytes());
    let upath = Spec { name: b"Gruen.tap".to_vec(), extra, ..Spec::new("", &tap()) };
    let bases = [
        build(&[], &[Spec::new("SABOTEUR.TAP", &tap()), Spec::new("README.TXT", &text()).stored()], b""),
        build(&[], &[descriptor, bare], b"a comment"),
        build(b"MZ stub", &[big, Spec::new("SMALL.TXT", &text())], b""),
        build(b"MZ", &[cp437, upath, Spec::new("Game/", b"").stored()], b"x"),
        build(&[], &[], b""),
    ];
    let mut rng = Rng(0x5EED_2026_1008);
    let mut read = 0;
    for i in 0..20_000 {
        let bad = mutate(&mut rng, &bases[i % bases.len()]);
        let _ = is_zip(&bad);
        if let Ok(a) = Archive::new(&bad) {
            read += 1;
            for e in a.entries() {
                let _ = (e.is_dir(), e.file_name(), e.is_junk());
                let _ = a.extract(e);
            }
            let _ = a.spectrum_files();
        }
    }
    // Most damage is caught by the directory; some is not, and that is the extraction's to catch.
    assert!(read > 2000, "only {read} of the damaged archives could still be read: the damage is not varied enough");
}
