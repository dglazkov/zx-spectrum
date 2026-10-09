//! What is inside a ZIP archive, as the Spectrum archives hand most files out (`Saboteur.tzx.zip`,
//! `JetSetWilly.z80.zip`): the entries' names and sizes, any one of them extracted and checked, and the ones a
//! Spectrum can load picked out by name and by content.
//!
//! The format is PKWARE's APPNOTE.TXT (version 6.3.10). The central directory at the end of the archive is the
//! authority on every entry (its method, sizes and CRC are final even where the local header left them for a data
//! descriptor); the local header only says where the entry's data begins. Entries are stored or deflated, as
//! every archive in a survey of 589 of the archive's zips was (docs/snapshot.md); other methods and encryption
//! are refused by name rather than misread. Names are UTF-8 where the archive says so (general purpose bit 11,
//! or Info-ZIP's Unicode Path extra field), and IBM code page 437 otherwise, as the APPNOTE's appendix D has it.
//! Zip64 records, a stub prepended to the archive (a self-extractor) and an archive comment are all read; an
//! archive split over several disks is refused.
//!
//! ```no_run
//! let bytes = std::fs::read("Saboteur.tzx.zip").unwrap();
//! for file in unzip::spectrum_files(&bytes).unwrap() {
//!     println!("{} is a {:?} of {} bytes", file.name, file.kind, file.data.len());
//! }
//! ```

mod cp437;
mod crc32;
mod kind;

use std::fmt;

pub use crc32::crc32;
pub use kind::{Kind, classify};

/// Signatures, as the APPNOTE gives them (section 4.3).
const LOCAL_HEADER: u32 = 0x0403_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY: u32 = 0x0606_4b50;
const ZIP64_LOCATOR: u32 = 0x0706_4b50;

/// Extra field tags (APPNOTE 4.5.3 and 4.6.9).
const EXTRA_ZIP64: u16 = 0x0001;
const EXTRA_UNICODE_PATH: u16 = 0x7075;

/// General purpose flag bits (APPNOTE 4.4.4).
const FLAG_ENCRYPTED: u16 = 1 << 0;
const FLAG_UTF8: u16 = 1 << 11;

/// Entries larger than this are not extracted to be looked at by `spectrum_files` (a Spectrum file is far
/// smaller; this is a manual's scan or a video someone zipped alongside).
const LARGEST_TO_SNIFF: u64 = 64 << 20;

/// Whether `data` begins as a ZIP archive does: with a local file header, or the end record of an empty archive.
/// (A self-extracting archive begins with a program instead; `Archive::new` reads those too.)
pub fn is_zip(data: &[u8]) -> bool {
    data.len() >= 4 && matches!(le32(data, 0), Some(LOCAL_HEADER | END_OF_CENTRAL_DIRECTORY))
}

/// Why an archive or an entry could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// No end of central directory record: this is not a ZIP archive, or its end is missing.
    NotZip,
    /// The archive is one of several disks (a spanned or split archive), of which this is not the whole.
    Spanned,
    /// A structure that should be in the archive is not, or runs past its end.
    Damaged(String),
    /// The entry is encrypted; there is no password to give it.
    Encrypted(String),
    /// The entry is compressed with a method other than storing or deflating.
    UnsupportedMethod { name: String, method: u16 },
    /// The entry's data does not inflate, or comes out a size other than the directory says.
    Corrupt { name: String, why: String },
    /// The entry came out the right size, but not with the CRC-32 the directory gives.
    Crc { name: String, expected: u32, actual: u32 },
    /// The entry is larger than this machine can hold in memory at once.
    TooLarge(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotZip => write!(f, "not a ZIP archive (no end of central directory record)"),
            Error::Spanned => write!(f, "a ZIP archive split over several disks, of which this is one"),
            Error::Damaged(why) => write!(f, "damaged ZIP archive: {why}"),
            Error::Encrypted(name) => write!(f, "{name} is encrypted"),
            Error::UnsupportedMethod { name, method } => {
                write!(f, "{name} is compressed with method {method} ({}), which is not read", method_name(*method))
            }
            Error::Corrupt { name, why } => write!(f, "{name} is corrupt: {why}"),
            Error::Crc { name, expected, actual } => {
                write!(f, "{name} has CRC-32 {actual:08x}, not {expected:08x}: it is damaged")
            }
            Error::TooLarge(name) => write!(f, "{name} is too large to extract here"),
        }
    }
}

impl std::error::Error for Error {}

/// How an entry's data is compressed (APPNOTE 4.4.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Stored,
    Deflated,
    /// Any other method, by its number: 1 shrunk, 6 imploded, 9 Deflate64, 12 bzip2, 14 LZMA, 93 Zstandard...
    Other(u16),
}

impl Method {
    fn from_u16(m: u16) -> Method {
        match m {
            0 => Method::Stored,
            8 => Method::Deflated,
            m => Method::Other(m),
        }
    }
}

fn method_name(m: u16) -> &'static str {
    match m {
        0 => "stored",
        1 => "shrunk",
        2..=5 => "reduced",
        6 => "imploded",
        8 => "deflated",
        9 => "Deflate64",
        12 => "bzip2",
        14 => "LZMA",
        93 => "Zstandard",
        95 => "XZ",
        98 => "PPMd",
        99 => "AES-encrypted",
        _ => "unknown",
    }
}

/// An MS-DOS date and time, as an entry's last modification is kept (APPNOTE 4.4.6): local time, to two seconds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct DosDateTime {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl DosDateTime {
    fn from_dos(date: u16, time: u16) -> DosDateTime {
        DosDateTime {
            year: 1980 + (date >> 9),
            month: ((date >> 5) & 0x0F) as u8,
            day: (date & 0x1F) as u8,
            hour: (time >> 11) as u8,
            minute: ((time >> 5) & 0x3F) as u8,
            second: ((time & 0x1F) * 2) as u8,
        }
    }
}

/// One entry of the archive, as its central directory describes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// The name, path and all, with `/` between its parts, decoded to Unicode.
    pub name: String,
    /// The name's bytes as the archive holds them.
    pub raw_name: Vec<u8>,
    pub method: Method,
    pub compressed_size: u64,
    /// The size the entry extracts to.
    pub size: u64,
    pub crc32: u32,
    /// The general purpose bit flag.
    pub flags: u16,
    pub modified: DosDateTime,
    pub comment: String,
    /// Where the entry's local header is in the archive's bytes (any prepended stub allowed for).
    local_header: u64,
}

impl Entry {
    /// Whether this is a directory rather than a file: its name ends in a slash.
    pub fn is_dir(&self) -> bool {
        self.name.ends_with('/') || self.name.ends_with('\\')
    }

    pub fn is_encrypted(&self) -> bool {
        self.flags & FLAG_ENCRYPTED != 0
    }

    /// The last part of the name: the file's own name without the directories it is in.
    pub fn file_name(&self) -> &str {
        self.name.rsplit(['/', '\\']).next().unwrap_or(&self.name)
    }

    /// Whether this is something an archiver added that is no one's file: the AppleDouble resource forks a Mac
    /// zips up beside each file (`__MACOSX/...`, `._NAME`).
    pub fn is_junk(&self) -> bool {
        self.name.starts_with("__MACOSX/") || self.file_name().starts_with("._")
    }
}

/// A file a Spectrum can use, taken out of an archive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpectrumFile {
    /// Which of the archive's entries it is.
    pub index: usize,
    /// Its name in the archive.
    pub name: String,
    pub kind: Kind,
    pub data: Vec<u8>,
}

/// A ZIP archive, read from its bytes. Reading it reads only its directory; `extract` reads an entry's data.
#[derive(Clone, Debug)]
pub struct Archive<'a> {
    data: &'a [u8],
    entries: Vec<Entry>,
    comment: String,
}

impl<'a> Archive<'a> {
    /// Reads the archive's central directory.
    pub fn new(data: &'a [u8]) -> Result<Archive<'a>, Error> {
        let eocd = find_end_of_central_directory(data).ok_or(Error::NotZip)?;
        let field16 = |at: usize| le16(data, eocd + at).unwrap_or(0);
        let mut this_disk = field16(4) as u32;
        let mut cd_disk = field16(6) as u32;
        let mut total = field16(10) as u64;
        let mut cd_size = le32(data, eocd + 12).unwrap_or(0) as u64;
        let mut cd_offset = le32(data, eocd + 16).unwrap_or(0) as u64;
        let comment_len = field16(20) as usize;
        let comment = cp437::decode(data.get(eocd + 22..eocd + 22 + comment_len).unwrap_or(&[]));

        // The central directory ends where the record after it begins: the end record, or the Zip64 one.
        let mut cd_end = eocd as u64;
        if let Some(z64) = find_zip64_end(data, eocd) {
            this_disk = le32(data, z64 + 16).unwrap_or(0);
            cd_disk = le32(data, z64 + 20).unwrap_or(0);
            total = le64(data, z64 + 32).unwrap_or(0);
            cd_size = le64(data, z64 + 40).unwrap_or(0);
            cd_offset = le64(data, z64 + 48).unwrap_or(0);
            cd_end = z64 as u64;
        }
        if this_disk != 0 || cd_disk != 0 {
            return Err(Error::Spanned);
        }

        // Offsets in the archive count from its first local header. Where something was put before that (a
        // self-extractor's program), every offset is out by its length: the directory is then found by where it
        // ends rather than where it says it starts.
        let mut prefix = 0u64;
        if le32_at(data, cd_offset) != Some(CENTRAL_HEADER) && total > 0 {
            let start = cd_end
                .checked_sub(cd_size)
                .ok_or_else(|| Error::Damaged("the central directory is larger than the archive".into()))?;
            prefix = start
                .checked_sub(cd_offset)
                .ok_or_else(|| Error::Damaged("the central directory is not where the end record says".into()))?;
        }

        let mut entries = Vec::new();
        let mut at = cd_offset + prefix;
        while (entries.len() as u64) < total || le32_at(data, at) == Some(CENTRAL_HEADER) {
            if le32_at(data, at) != Some(CENTRAL_HEADER) {
                return Err(Error::Damaged(format!(
                    "the central directory has {} of the {} entries its end record counts",
                    entries.len(),
                    total
                )));
            }
            let (entry, len) = read_central_header(data, at as usize, prefix)?;
            entries.push(entry);
            at += len as u64;
        }
        Ok(Archive { data, entries, comment })
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// The archive's comment.
    pub fn comment(&self) -> &str {
        &self.comment
    }

    /// The entry named `name`: exactly, or failing that, ignoring case.
    pub fn find(&self, name: &str) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|e| e.name == name)
            .or_else(|| self.entries.iter().find(|e| e.name.eq_ignore_ascii_case(name)))
    }

    /// The entry's data, inflated if it was deflated, and checked against the size and CRC-32 the directory
    /// gives for it.
    pub fn extract(&self, entry: &Entry) -> Result<Vec<u8>, Error> {
        let name = || entry.name.clone();
        if entry.is_encrypted() {
            return Err(Error::Encrypted(name()));
        }
        let damaged = |what: &str| Error::Damaged(format!("{}: {what}", entry.name));
        let lh = usize::try_from(entry.local_header).map_err(|_| damaged("its local header is past the end"))?;
        if le32(self.data, lh) != Some(LOCAL_HEADER) {
            return Err(damaged("its local header is missing"));
        }
        let name_len = le16(self.data, lh + 26).ok_or_else(|| damaged("its local header is cut short"))? as usize;
        let extra_len = le16(self.data, lh + 28).ok_or_else(|| damaged("its local header is cut short"))? as usize;
        let start = lh + 30 + name_len + extra_len;
        let len = usize::try_from(entry.compressed_size).map_err(|_| Error::TooLarge(name()))?;
        let size = usize::try_from(entry.size).map_err(|_| Error::TooLarge(name()))?;
        let raw = start
            .checked_add(len)
            .and_then(|end| self.data.get(start..end))
            .ok_or_else(|| damaged("its data runs past the end of the archive"))?;

        let out = match entry.method {
            Method::Stored => {
                if len != size {
                    return Err(Error::Corrupt {
                        name: name(),
                        why: format!("stored as {len} bytes but said to be {size}"),
                    });
                }
                raw.to_vec()
            }
            Method::Deflated => {
                // Inflating no further than the size the directory gives keeps a lying size from filling memory.
                miniz_oxide::inflate::decompress_to_vec_with_limit(raw, size).map_err(|e| Error::Corrupt {
                    name: name(),
                    why: match e.status {
                        miniz_oxide::inflate::TINFLStatus::HasMoreOutput => {
                            format!("it inflates to more than the {size} bytes it is said to be")
                        }
                        status => format!("it does not inflate ({status:?})"),
                    },
                })?
            }
            Method::Other(method) => return Err(Error::UnsupportedMethod { name: name(), method }),
        };
        if out.len() != size {
            return Err(Error::Corrupt {
                name: name(),
                why: format!("it inflates to {} bytes, not the {size} it is said to be", out.len()),
            });
        }
        let actual = crc32(&out);
        if actual != entry.crc32 {
            return Err(Error::Crc { name: name(), expected: entry.crc32, actual });
        }
        Ok(out)
    }

    /// The entries a Spectrum can load, extracted, each with what it is, in the archive's order. What an entry is
    /// comes from its content where that is conclusive (a TZX's signature, a TAP's chain of blocks), so that a
    /// file whose name lies, or that has no extension, is still found; and from its name where the content
    /// cannot tell (`classify`). Directories, a Mac's resource forks, and files of no Spectrum kind (the
    /// inlay's scan, the instructions) are left out. An entry whose name says it is a Spectrum file but which
    /// is damaged or encrypted is an error, rather than quietly missing.
    pub fn spectrum_files(&self) -> Result<Vec<SpectrumFile>, Error> {
        let mut files = Vec::new();
        for (index, entry) in self.entries.iter().enumerate() {
            if entry.is_dir() || entry.is_junk() || entry.size > LARGEST_TO_SNIFF {
                continue;
            }
            let named = Kind::from_name(&entry.name).is_some();
            match self.extract(entry) {
                Ok(data) => {
                    if let Some(kind) = classify(&entry.name, &data) {
                        files.push(SpectrumFile { index, name: entry.name.clone(), kind, data });
                    }
                }
                Err(e) if named => return Err(e),
                Err(_) => {}
            }
        }
        Ok(files)
    }
}

/// The files a Spectrum can load in the ZIP archive `zip`: `Archive::spectrum_files`.
pub fn spectrum_files(zip: &[u8]) -> Result<Vec<SpectrumFile>, Error> {
    Archive::new(zip)?.spectrum_files()
}

/// Reads the central directory header at `at`, returning the entry and the header's length.
fn read_central_header(data: &[u8], at: usize, prefix: u64) -> Result<(Entry, usize), Error> {
    let cut = || Error::Damaged(format!("the central directory header at {at} is cut short"));
    let f16 = |o: usize| le16(data, at + o).ok_or_else(cut);
    let f32 = |o: usize| le32(data, at + o).ok_or_else(cut);
    let made_by = f16(4)?;
    let flags = f16(8)?;
    let method = Method::from_u16(f16(10)?);
    let modified = DosDateTime::from_dos(f16(14)?, f16(12)?);
    let crc = f32(16)?;
    let mut compressed_size = f32(20)? as u64;
    let mut size = f32(24)? as u64;
    let name_len = f16(28)? as usize;
    let extra_len = f16(30)? as usize;
    let comment_len = f16(32)? as usize;
    let mut local_header = f32(42)? as u64;
    let name_at = at + 46;
    let raw_name = data.get(name_at..name_at + name_len).ok_or_else(cut)?;
    let extra = data.get(name_at + name_len..name_at + name_len + extra_len).ok_or_else(cut)?;
    let comment_at = name_at + name_len + extra_len;
    let raw_comment = data.get(comment_at..comment_at + comment_len).ok_or_else(cut)?;

    let mut unicode_name = None;
    for (id, body) in extra_fields(extra) {
        match id {
            // Zip64: the 8-byte values of whichever of these fields were too large for theirs, in this order.
            EXTRA_ZIP64 => {
                let mut values = body.as_chunks::<8>().0.iter().map(|c| u64::from_le_bytes(*c));
                if size == 0xFFFF_FFFF {
                    size = values.next().ok_or_else(cut)?;
                }
                if compressed_size == 0xFFFF_FFFF {
                    compressed_size = values.next().ok_or_else(cut)?;
                }
                if local_header == 0xFFFF_FFFF {
                    local_header = values.next().ok_or_else(cut)?;
                }
            }
            // Info-ZIP's Unicode path: the name in UTF-8, valid while the CRC of the plain name still matches.
            EXTRA_UNICODE_PATH if body.len() >= 5 && body[0] == 1 => {
                let name_crc = u32::from_le_bytes(body[1..5].try_into().unwrap());
                if name_crc == crc32(raw_name) {
                    unicode_name = std::str::from_utf8(&body[5..]).ok().map(str::to_owned);
                }
            }
            _ => {}
        }
    }

    // A Zip64 offset can be anything up to 2^64, and a stub's length added to it can then pass that.
    let local_header = local_header
        .checked_add(prefix)
        .ok_or_else(|| Error::Damaged(format!("the central directory header at {at} puts its entry past 2^64")))?;
    let host = (made_by >> 8) as u8;
    let name = unicode_name.unwrap_or_else(|| decode_name(raw_name, flags, host));
    let comment = decode_name(raw_comment, flags, host);
    let entry = Entry {
        name,
        raw_name: raw_name.to_vec(),
        method,
        compressed_size,
        size,
        crc32: crc,
        flags,
        modified,
        comment,
        local_header,
    };
    Ok((entry, 46 + name_len + extra_len + comment_len))
}

/// A name or comment as text: UTF-8 where bit 11 says so; otherwise code page 437 (APPNOTE appendix D), except
/// from an archiver on Unix or macOS (host 3 or 19), which wrote the system's own encoding, today UTF-8, without
/// saying so: those are taken as UTF-8 when they are valid UTF-8.
fn decode_name(raw: &[u8], flags: u16, host: u8) -> String {
    let utf8 = std::str::from_utf8(raw).ok();
    match utf8 {
        Some(s) if flags & FLAG_UTF8 != 0 || matches!(host, 3 | 19) => s.to_owned(),
        _ => cp437::decode(raw),
    }
}

/// The extra fields in an extra field block: (tag, data) pairs (APPNOTE 4.5.1). A field that claims more than is
/// left ends the list.
fn extra_fields(mut extra: &[u8]) -> impl Iterator<Item = (u16, &[u8])> {
    std::iter::from_fn(move || {
        let id = u16::from_le_bytes(extra.get(0..2)?.try_into().ok()?);
        let len = u16::from_le_bytes(extra.get(2..4)?.try_into().ok()?) as usize;
        let body = extra.get(4..4 + len)?;
        extra = &extra[4 + len..];
        Some((id, body))
    })
}

/// Where the end of central directory record is: the last one in the archive's final 64 KB and 22 bytes (the
/// most a comment leaves room for), whose comment fits in what follows it.
fn find_end_of_central_directory(data: &[u8]) -> Option<usize> {
    if data.len() < 22 {
        return None;
    }
    let lowest = data.len().saturating_sub(22 + 0xFFFF);
    (lowest..=data.len() - 22).rev().find(|&at| {
        le32(data, at) == Some(END_OF_CENTRAL_DIRECTORY)
            && at + 22 + le16(data, at + 20).unwrap_or(0) as usize <= data.len()
    })
}

/// Where the Zip64 end of central directory record is, when the archive has one: its locator lies just before the
/// end record, and gives its offset (which a prepended stub would put out; the record is then just before the
/// locator, where it would be if it had no extensible data).
fn find_zip64_end(data: &[u8], eocd: usize) -> Option<usize> {
    let locator = eocd.checked_sub(20)?;
    if le32(data, locator) != Some(ZIP64_LOCATOR) {
        return None;
    }
    let stated = le64(data, locator + 8).and_then(|o| usize::try_from(o).ok());
    [stated, locator.checked_sub(56)]
        .into_iter()
        .flatten()
        .find(|&at| le32(data, at) == Some(ZIP64_END_OF_CENTRAL_DIRECTORY))
}

fn le16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(data.get(at..at.checked_add(2)?)?.try_into().ok()?))
}

fn le32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(data.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

fn le32_at(data: &[u8], at: u64) -> Option<u32> {
    le32(data, usize::try_from(at).ok()?)
}

fn le64(data: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(data.get(at..at.checked_add(8)?)?.try_into().ok()?))
}

#[cfg(test)]
mod tests;
