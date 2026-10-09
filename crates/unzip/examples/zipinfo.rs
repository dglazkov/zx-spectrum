//! `zipinfo`: what is in ZIP archives, as JSON, a line an entry, each extracted and checked; and which entries a
//! Spectrum can load, and as what.
//!
//!     cargo run -p unzip --example zipinfo -- FILE.zip...
//!
//! Each line gives an entry's name, method, sizes, whether it extracted with the right size and CRC (or the error
//! it gave), the kind of Spectrum file `spectrum_files` takes it for (null for the others), and the kind its
//! content alone says (`Kind::sniff`). The last line is a summary: archives read, entries extracted, how many of
//! each kind, and how many of those the content alone told.

use std::collections::BTreeMap;

fn main() {
    let files: Vec<String> = std::env::args().skip(1).collect();
    if files.is_empty() || files.iter().any(|f| f == "-h" || f == "--help") {
        println!("usage: zipinfo FILE.zip...");
        return;
    }
    let mut count: BTreeMap<String, usize> = BTreeMap::new();
    for path in &files {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                println!("{{\"archive\":{},\"error\":{}}}", json(path), json(&e.to_string()));
                continue;
            }
        };
        let archive = match unzip::Archive::new(&bytes) {
            Ok(a) => a,
            Err(e) => {
                *count.entry("archives that failed".into()).or_default() += 1;
                println!("{{\"archive\":{},\"error\":{}}}", json(path), json(&e.to_string()));
                continue;
            }
        };
        *count.entry("archives".into()).or_default() += 1;
        let kinds: BTreeMap<usize, unzip::Kind> = match archive.spectrum_files() {
            Ok(files) => files.into_iter().map(|f| (f.index, f.kind)).collect(),
            Err(e) => {
                *count.entry("spectrum_files errors".into()).or_default() += 1;
                println!("{{\"archive\":{},\"spectrum_files_error\":{}}}", json(path), json(&e.to_string()));
                BTreeMap::new()
            }
        };
        for (i, e) in archive.entries().iter().enumerate() {
            let mut sniffed = None;
            let extracted = match archive.extract(e) {
                Ok(data) => {
                    sniffed = unzip::Kind::sniff(&data);
                    "true".to_owned()
                }
                Err(err) => {
                    *count.entry("entries that failed".into()).or_default() += 1;
                    json(&err.to_string())
                }
            };
            *count.entry("entries".into()).or_default() += 1;
            let kind = kinds.get(&i).map(|k| json(k.extension())).unwrap_or_else(|| "null".into());
            if let Some(k) = kinds.get(&i) {
                *count.entry(format!("kind {}", k.extension())).or_default() += 1;
                let by_content = if sniffed == Some(*k) { "told by content" } else { "told by name" };
                *count.entry(format!("kind {} {by_content}", k.extension())).or_default() += 1;
            }
            let sniffed = sniffed.map(|k| json(k.extension())).unwrap_or_else(|| "null".into());
            println!(
                "{{\"archive\":{},\"name\":{},\"method\":{},\"size\":{},\"compressed\":{},\"flags\":{},\"extracted\":{},\"kind\":{},\"sniffed\":{}}}",
                json(path),
                json(&e.name),
                json(&format!("{:?}", e.method)),
                e.size,
                e.compressed_size,
                e.flags,
                extracted,
                kind,
                sniffed
            );
        }
    }
    let summary: Vec<String> = count.iter().map(|(k, v)| format!("{}:{v}", json(k))).collect();
    println!("{{\"summary\":{{{}}}}}", summary.join(","));
}

fn json(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out += "\\\"",
            '\\' => out += "\\\\",
            c if (c as u32) < 0x20 => out += &format!("\\u{:04x}", c as u32),
            c => out.push(c),
        }
    }
    out + "\""
}
