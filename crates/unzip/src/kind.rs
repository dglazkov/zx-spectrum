//! What kind of Spectrum file something is, from its name and from its content.
//!
//! The content is conclusive where the format signs itself (TZX, PZX, CSW, SZX, DSK, SCL), or where its
//! structure leaves no doubt: a TAP's chain of length-prefixed blocks that ends exactly at the end of the file,
//! with a good checksum on the first; a .z80 of version 2 or 3, whose header and chain of memory pages do the
//! same; a compressed version 1 .z80, which ends with its end marker; a TR-DOS disk's system sector. A size alone
//! (49,179 bytes for a 48K .sna, 6,912 for a screen) is not conclusive, and is used only when the name does not
//! say otherwise.

/// The kinds of file a Spectrum can use.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    /// Tape: TZX ("perfect" tape, every block kind).
    Tzx,
    /// Tape: TAP (the ROM's own blocks).
    Tap,
    /// Tape: CSW (compressed square wave, a sampled recording).
    Csw,
    /// Tape: PZX (pulses).
    Pzx,
    /// Snapshot: .z80 (versions 1 to 3, and its .slt extension).
    Z80,
    /// Snapshot: .sna (48K and 128K).
    Sna,
    /// Snapshot: .szx (zx-state).
    Szx,
    /// A 6,912-byte screen dump.
    Scr,
    /// Disk: +3 (CPC) DSK, standard or extended.
    Dsk,
    /// Disk: TR-DOS image.
    Trd,
    /// Disk: TR-DOS files in Hobeta's SCL container.
    Scl,
}

impl Kind {
    pub const ALL: [Kind; 11] = [
        Kind::Tzx,
        Kind::Tap,
        Kind::Csw,
        Kind::Pzx,
        Kind::Z80,
        Kind::Sna,
        Kind::Szx,
        Kind::Scr,
        Kind::Dsk,
        Kind::Trd,
        Kind::Scl,
    ];

    /// The file extension this kind goes by, in lower case.
    pub fn extension(self) -> &'static str {
        match self {
            Kind::Tzx => "tzx",
            Kind::Tap => "tap",
            Kind::Csw => "csw",
            Kind::Pzx => "pzx",
            Kind::Z80 => "z80",
            Kind::Sna => "sna",
            Kind::Szx => "szx",
            Kind::Scr => "scr",
            Kind::Dsk => "dsk",
            Kind::Trd => "trd",
            Kind::Scl => "scl",
        }
    }

    pub fn is_tape(self) -> bool {
        matches!(self, Kind::Tzx | Kind::Tap | Kind::Csw | Kind::Pzx)
    }

    pub fn is_snapshot(self) -> bool {
        matches!(self, Kind::Z80 | Kind::Sna | Kind::Szx)
    }

    pub fn is_disk(self) -> bool {
        matches!(self, Kind::Dsk | Kind::Trd | Kind::Scl)
    }

    /// The kind a file name's extension says, ignoring case: `Saboteur - Side 1.tzx` is a TZX. A super level
    /// loader snapshot (`.slt`) is a .z80 with level data after it.
    pub fn from_name(name: &str) -> Option<Kind> {
        let ext = extension(name)?;
        if ext.eq_ignore_ascii_case("slt") {
            return Some(Kind::Z80);
        }
        Kind::ALL.into_iter().find(|k| ext.eq_ignore_ascii_case(k.extension()))
    }

    /// The kind `data` is, by its content alone: conclusively where the content can say, and failing that by an
    /// exact size that only one kind has (see `classify`, which lets a name overrule the size).
    pub fn sniff(data: &[u8]) -> Option<Kind> {
        sniff_conclusive(data).or_else(|| sniff_by_size(data))
    }
}

/// What a file named `name` holding `data` is: its content, where that is conclusive; otherwise its name; and
/// otherwise its size, unless its name says it is a document or a picture (a 6,912-byte text file is not a
/// screen).
pub fn classify(name: &str, data: &[u8]) -> Option<Kind> {
    sniff_conclusive(data).or_else(|| Kind::from_name(name)).or_else(|| {
        let ext = extension(name).map(str::to_ascii_lowercase);
        if ext.as_deref().is_some_and(|e| NOT_SPECTRUM.contains(&e)) { None } else { sniff_by_size(data) }
    })
}

/// Extensions of files that travel with Spectrum files in archives but are never one: instructions, inlay
/// scans, POKEs, the archive's own notes.
const NOT_SPECTRUM: &[&str] = &[
    "txt", "doc", "docx", "rtf", "pdf", "htm", "html", "nfo", "diz", "inf", "me", "md", "1st", "jpg", "jpeg", "gif",
    "png", "bmp", "pok", "xml", "json", "csv", "wav", "mp3", "ogg", "zip", "exe", "com", "bas",
];

/// The extension of the last part of `name`, if it has one.
fn extension(name: &str) -> Option<&str> {
    let file = name.rsplit(['/', '\\']).next()?;
    let (stem, ext) = file.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then_some(ext)
}

fn sniff_conclusive(d: &[u8]) -> Option<Kind> {
    let starts = |magic: &[u8]| d.starts_with(magic);
    if starts(b"ZXTape!\x1A") {
        Some(Kind::Tzx)
    } else if starts(b"PZXT") {
        Some(Kind::Pzx)
    } else if starts(b"Compressed Square Wave\x1A") {
        Some(Kind::Csw)
    } else if starts(b"ZXST") {
        Some(Kind::Szx)
    } else if starts(b"MV - CPC") || starts(b"EXTENDED CPC DSK") {
        Some(Kind::Dsk)
    } else if starts(b"SINCLAIR") && d.len() > 9 {
        Some(Kind::Scl)
    } else if is_tap(d) {
        Some(Kind::Tap)
    } else if is_z80(d) {
        Some(Kind::Z80)
    } else if is_trd(d) {
        Some(Kind::Trd)
    } else {
        None
    }
}

fn sniff_by_size(d: &[u8]) -> Option<Kind> {
    match d.len() {
        // 48K, and 128K with the paged bank one of 5 or 2 or not (docs/snapshot.md); interrupt mode 0 to 2.
        49_179 | 131_103 | 147_487 if d[25] <= 2 => Some(Kind::Sna),
        6912 => Some(Kind::Scr),
        // An uncompressed version 1 .z80: the 30-byte header and 48K, with the compressed flag clear.
        49_182 if d[6] | d[7] != 0 && (d[12] == 0xFF || d[12] & 0x20 == 0) => Some(Kind::Z80),
        _ => None,
    }
}

/// A TAP: blocks of a 16-bit length and that many bytes (flag, data, checksum), end to end to the end of the
/// file, the first block's bytes XORing to zero.
fn is_tap(d: &[u8]) -> bool {
    let mut at = 0usize;
    let mut blocks = 0;
    while at < d.len() {
        let Some(len) = d.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize) else {
            return false;
        };
        if len < 2 || at + 2 + len > d.len() {
            return false;
        }
        if blocks == 0 && d[at + 2..at + 2 + len].iter().fold(0, |x, b| x ^ b) != 0 {
            return false;
        }
        at += 2 + len;
        blocks += 1;
    }
    blocks > 0
}

/// A .z80: version 2 or 3 (program counter zero in the first header, a second header of a known length, then
/// memory pages end to end, or the "\0\0\0SLT" that begins level data), or a compressed version 1 (its last
/// four bytes the end marker 00 ED ED 00).
fn is_z80(d: &[u8]) -> bool {
    if d.len() < 34 {
        return false;
    }
    let pc = u16::from_le_bytes([d[6], d[7]]);
    if pc != 0 {
        let compressed = d[12] != 0xFF && d[12] & 0x20 != 0;
        return compressed && d.ends_with(&[0x00, 0xED, 0xED, 0x00]);
    }
    let extra = u16::from_le_bytes([d[30], d[31]]) as usize;
    if !matches!(extra, 23 | 54 | 55) {
        return false;
    }
    let mut at = 32 + extra;
    let mut pages = 0;
    while at < d.len() {
        if d[at..].starts_with(b"\0\0\0SLT") {
            return pages > 0;
        }
        let Some(h) = d.get(at..at + 3) else { return false };
        let len = match u16::from_le_bytes([h[0], h[1]]) {
            0xFFFF => 0x4000,
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

/// A TR-DOS disk image: whole 256-byte sectors, and in the system sector (track 0, sector 9) the TR-DOS
/// identifier 10h at offset E7h and a disk type of 16h to 19h (80 or 40 tracks, two sides or one) at E3h.
fn is_trd(d: &[u8]) -> bool {
    d.len() >= 0x900 && d.len().is_multiple_of(256) && d[0x8E7] == 0x10 && (0x16..=0x19).contains(&d[0x8E3])
}
