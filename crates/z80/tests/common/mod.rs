//! What the test suites share: their fixtures, their report to nerd, and reading the SingleStepTests zip.

#![allow(dead_code)]

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

/// The local path of a fixture (scripts/fixture fetches it into the cache first if need be), or None when it
/// cannot be fetched (no network): the test then reports itself skipped, on stderr and to nerd, and passes
/// nothing. Any other failure of the script (a fixture not in fixtures.txt, a hash that does not match) fails.
pub fn fixture(name: &str, part: &str) -> Option<PathBuf> {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/fixture");
    let out = Command::new(script)
        .arg(name)
        .output()
        .expect("run scripts/fixture");
    match out.status.code() {
        Some(0) => Some(PathBuf::from(String::from_utf8(out.stdout).unwrap().trim())),
        Some(3) => {
            let said = format!("SKIPPED: fixture {name} could not be fetched");
            // Straight to stderr: libtest captures print!, not the stream itself.
            let _ = writeln!(std::io::stderr(), "{part}: {said}");
            report(part, 0.0, "skipped", Some(&said));
            None
        }
        _ => panic!(
            "scripts/fixture {name} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ),
    }
}

/// One line for nerd's report of this test's parts (the file NERD_REPORT names), when nerd runs it.
pub fn report(part: &str, seconds: f64, outcome: &str, said: Option<&str>) {
    let Ok(path) = std::env::var("NERD_REPORT") else {
        return;
    };
    let mut line = serde_json::json!({ "part": format!("z80 › {part}"), "seconds": seconds, "outcome": outcome });
    if let Some(said) = said {
        line["said"] = said.into();
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{line}");
    }
}

/// Runs a part of a suite: `body` returns the failures it found (empty when all passed) and a summary; the
/// part is reported to nerd, the summary printed, and the test fails with the first failures listed.
pub fn part(name: &str, body: impl FnOnce() -> Option<(Vec<String>, String)>) {
    let start = Instant::now();
    let Some((failures, summary)) = body() else {
        return;
    };
    let seconds = start.elapsed().as_secs_f64();
    let _ = writeln!(std::io::stderr(), "{name}: {summary}");
    if failures.is_empty() {
        report(name, seconds, "passed", Some(&summary));
    } else {
        let said = format!("{summary}; first: {}", failures[0]);
        report(name, seconds, "failed", Some(&said));
        let shown: Vec<&str> = failures.iter().take(20).map(String::as_str).collect();
        panic!("{name}: {summary}\n{}", shown.join("\n"));
    }
}

/// A zip archive read through its central directory, members inflated on demand.
pub struct Zip {
    file: File,
    pub entries: Vec<Entry>,
}

pub struct Entry {
    pub name: String,
    method: u16,
    compressed: u64,
    pub size: u64,
    local_header: u64,
}

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

impl Zip {
    pub fn open(path: &PathBuf) -> Zip {
        let mut file = File::open(path).expect("open zip");
        let len = file.metadata().unwrap().len();
        let tail_len = len.min(65_536 + 22);
        let mut tail = vec![0; tail_len as usize];
        file.seek(SeekFrom::Start(len - tail_len)).unwrap();
        file.read_exact(&mut tail).unwrap();
        let eocd = (0..tail.len() - 21)
            .rev()
            .find(|&i| u32_at(&tail, i) == 0x0605_4b50)
            .expect("zip end record");
        let count = u16_at(&tail, eocd + 10) as usize;
        let cd_size = u32_at(&tail, eocd + 12) as usize;
        let cd_offset = u32_at(&tail, eocd + 16) as u64;
        let mut cd = vec![0; cd_size];
        file.seek(SeekFrom::Start(cd_offset)).unwrap();
        file.read_exact(&mut cd).unwrap();
        let mut entries = Vec::with_capacity(count);
        let mut at = 0;
        for _ in 0..count {
            assert_eq!(u32_at(&cd, at), 0x0201_4b50, "zip central directory");
            let name_len = u16_at(&cd, at + 28) as usize;
            let extra_len = u16_at(&cd, at + 30) as usize;
            let comment_len = u16_at(&cd, at + 32) as usize;
            entries.push(Entry {
                name: String::from_utf8_lossy(&cd[at + 46..at + 46 + name_len]).into_owned(),
                method: u16_at(&cd, at + 10),
                compressed: u32_at(&cd, at + 20) as u64,
                size: u32_at(&cd, at + 24) as u64,
                local_header: u32_at(&cd, at + 42) as u64,
            });
            at += 46 + name_len + extra_len + comment_len;
        }
        Zip { file, entries }
    }

    /// Up to `limit` compressed bytes of a member's data.
    fn compressed(&mut self, e: usize, limit: u64) -> Vec<u8> {
        let (local_header, compressed) = (self.entries[e].local_header, self.entries[e].compressed);
        let mut header = [0u8; 30];
        self.file.seek(SeekFrom::Start(local_header)).unwrap();
        self.file.read_exact(&mut header).unwrap();
        assert_eq!(u32_at(&header, 0), 0x0403_4b50, "zip local header");
        let skip = u16_at(&header, 26) as u64 + u16_at(&header, 28) as u64;
        let n = compressed.min(limit);
        let mut data = vec![0; n as usize];
        self.file
            .seek(SeekFrom::Start(local_header + 30 + skip))
            .unwrap();
        self.file.read_exact(&mut data).unwrap();
        data
    }

    /// A whole member (by its index in `entries`), inflated.
    pub fn read(&mut self, e: usize) -> Vec<u8> {
        let data = self.compressed(e, u64::MAX);
        match self.entries[e].method {
            0 => data,
            8 => miniz_oxide::inflate::decompress_to_vec(&data).expect("inflate"),
            m => panic!("zip method {m}"),
        }
    }

    /// The first `max` bytes of a member (by its index; or fewer, if it is shorter), inflating only as much as that needs.
    pub fn read_prefix(&mut self, e: usize, max: usize) -> Vec<u8> {
        let (method, compressed) = (self.entries[e].method, self.entries[e].compressed);
        use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};
        // Deflate rarely does better than 20:1 on this JSON; read what should be enough, and more if not.
        let mut limit = (max as u64 / 4).max(4096);
        loop {
            let data = self.compressed(e, limit);
            if method == 0 {
                return data[..data.len().min(max)].to_vec();
            }
            let mut out = vec![0; max];
            let mut r = DecompressorOxide::new();
            let more = if (data.len() as u64) < compressed {
                inflate_flags::TINFL_FLAG_HAS_MORE_INPUT
            } else {
                0
            };
            let (_, _, written) = decompress(
                &mut r,
                &data,
                &mut out,
                0,
                more | inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
            );
            if written == max || data.len() as u64 == compressed {
                out.truncate(written);
                return out;
            }
            limit *= 4;
        }
    }
}

/// The complete top-level objects at the start of a JSON array whose text may be cut off: each as its slice.
pub fn json_array_objects(text: &[u8], max: usize) -> Vec<&[u8]> {
    let mut objects = Vec::new();
    let (mut depth, mut in_string, mut escaped, mut start) = (0usize, false, false, 0usize);
    for (i, &c) in text.iter().enumerate() {
        if in_string {
            match c {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match c {
            b'"' => in_string = true,
            b'{' | b'[' => {
                if depth == 1 && c == b'{' {
                    start = i;
                }
                depth += 1;
            }
            b'}' | b']' => {
                depth -= 1;
                if depth == 1 && c == b'}' {
                    objects.push(&text[start..=i]);
                    if objects.len() == max {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    objects
}
