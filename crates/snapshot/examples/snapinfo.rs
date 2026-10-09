//! `snapinfo`: what is in snapshots, as JSON, one line a snapshot. For looking into a snapshot that will not
//! load, and for surveying many at once.
//!
//!     cargo run -p snapshot --example snapinfo -- [--png DIR] [--roundtrip] [--convert z80|sna|szx DIR] FILE...
//!
//! Each FILE is a snapshot (.z80, .sna, .szx), or a zip of them, as the archive hands them out. For each
//! snapshot it prints its name, format, model, registers, T-state, ports, and each RAM bank's CRC-32; or the
//! error it fails with. `--png DIR` writes the screen each shows, with its border, as a PNG in DIR (to look at:
//! a snapshot read wrongly shows garbage there). `--roundtrip` writes each snapshot in each format and reads it
//! back, says which formats gave back what they were given, and whether writing it in its own format gives the
//! very file again. `--convert FORMAT DIR` writes each snapshot in that format into DIR, named as it was with the
//! format's extension added. The last line is a summary.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use snapshot::{Format, Snapshot};

fn main() {
    let mut png_dir: Option<PathBuf> = None;
    let mut roundtrip = false;
    let mut convert: Option<(Format, PathBuf)> = None;
    let mut files = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--png" => png_dir = args.next().map(PathBuf::from),
            "--roundtrip" => roundtrip = true,
            "--convert" => {
                let format = match args.next().as_deref() {
                    Some("z80") => Format::Z80,
                    Some("sna") => Format::Sna,
                    Some("szx") => Format::Szx,
                    other => {
                        eprintln!("snapinfo: --convert takes z80, sna or szx, not {other:?}");
                        std::process::exit(2);
                    }
                };
                convert = args.next().map(|dir| (format, PathBuf::from(dir)));
            }
            "-h" | "--help" => {
                println!("usage: snapinfo [--png DIR] [--roundtrip] [--convert z80|sna|szx DIR] FILE...");
                println!("  each FILE a snapshot (.z80, .sna, .szx) or a zip of them");
                return;
            }
            _ => files.push(PathBuf::from(a)),
        }
    }
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    for path in &files {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                println!("{{\"file\":{},\"error\":{}}}", json(&path.display().to_string()), json(&e.to_string()));
                continue;
            }
        };
        for (name, data) in snapshots_in(path, &bytes) {
            let line = describe(&name, &data, png_dir.as_deref(), roundtrip, convert.as_ref(), &mut outcomes);
            println!("{line}");
        }
    }
    let summary: Vec<String> = outcomes.iter().map(|(k, v)| format!("{}:{v}", json(k))).collect();
    println!("{{\"summary\":{{{}}}}}", summary.join(","));
}

/// The snapshots in a file: the file itself, or the snapshots in it if it is a zip.
fn snapshots_in(path: &Path, bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !unzip::is_zip(bytes) {
        return vec![(name, bytes.to_vec())];
    }
    match unzip::spectrum_files(bytes) {
        Ok(files) => {
            files.into_iter().filter(|f| f.kind.is_snapshot()).map(|f| (format!("{name}/{}", f.name), f.data)).collect()
        }
        Err(e) => {
            println!("{{\"file\":{},\"error\":{}}}", json(&name), json(&format!("zip: {e}")));
            Vec::new()
        }
    }
}

fn describe(
    name: &str,
    data: &[u8],
    png: Option<&Path>,
    roundtrip: bool,
    convert: Option<&(Format, PathBuf)>,
    outcomes: &mut BTreeMap<String, usize>,
) -> String {
    let format = snapshot::detect(data);
    let s = match snapshot::load(data) {
        Ok(s) => s,
        Err(e) => {
            let kind = format!("{e:?}").split('(').next().unwrap_or("").to_owned();
            *outcomes.entry(format!("error {kind}")).or_default() += 1;
            return format!(
                "{{\"file\":{},\"format\":{},\"error\":{}}}",
                json(name),
                json(&format!("{format:?}")),
                json(&e.to_string())
            );
        }
    };
    let version = match format {
        Some(Format::Z80) if data[6] | data[7] != 0 => "z80 v1".to_owned(),
        Some(Format::Z80) => format!("z80 v{}", if data[30] == 23 { 2 } else { 3 }),
        Some(Format::Szx) => format!("szx {}.{}", data[4], data[5]),
        Some(Format::Sna) => format!("sna {}", if data.len() == 49_179 { "48K" } else { "128K" }),
        None => "?".into(),
    };
    *outcomes.entry(format!("{version} {:?}", s.model)).or_default() += 1;
    let r = &s.regs;
    let banks: Vec<String> =
        (0..8).filter_map(|b| s.bank(b).map(|d| format!("\"{b}\":\"{:08x}\"", unzip::crc32(&d[..])))).collect();
    let mut line = format!(
        "{{\"file\":{},\"format\":{},\"model\":{},\"pc\":\"{:04x}\",\"sp\":\"{:04x}\",\"af\":\"{:04x}\",\
         \"iff\":[{},{}],\"im\":{},\"tstates\":{},\"border\":{},\"7ffd\":\"{:02x}\",\"1ffd\":\"{:02x}\",\
         \"ay\":{},\"joystick\":{},\"banks\":{{{}}}",
        json(name),
        json(&version),
        json(s.model.name()),
        r.pc,
        r.sp,
        r.af,
        r.iff1,
        r.iff2,
        r.im,
        s.tstates,
        s.border(),
        s.port_7ffd,
        s.port_1ffd,
        json(&format!("{:?}", s.ay.map(|a| a.interface))),
        json(&format!("{:?}", s.joystick)),
        banks.join(","),
    );
    if let Some(slt) = &s.slt {
        line += &format!(",\"slt_levels\":{}", slt.levels.len());
    }
    if roundtrip {
        let back: Vec<String> = [Format::Z80, Format::Sna, Format::Szx]
            .into_iter()
            .map(|f| {
                let ok =
                    snapshot::save(&s, f).ok().and_then(|b| snapshot::load(&b).ok()).is_some_and(|t| same(&s, &t, f));
                format!("\"{}\":{ok}", f.extension())
            })
            .collect();
        // Whether writing it again in its own format gives back the very file (expected of .sna, whose layout
        // is fixed; not of the compressed formats, whose compressors differ).
        let identical = format.and_then(|f| snapshot::save(&s, f).ok()).is_some_and(|b| b == data);
        line += &format!(",\"roundtrip\":{{{}}},\"rewritten_identical\":{identical}", back.join(","));
    }
    if let Some((f, dir)) = convert {
        let file = dir.join(format!("{}.{}", name.replace(['/', '\\', ' '], "_"), f.extension()));
        match snapshot::save(&s, *f).map(|b| std::fs::write(&file, b)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => line += &format!(",\"convert_error\":{}", json(&e.to_string())),
            Err(e) => line += &format!(",\"convert_error\":{}", json(&e.to_string())),
        }
    }
    if let Some(dir) = png {
        let file = dir.join(format!("{}.png", name.replace(['/', '\\', ' '], "_")));
        if let Err(e) = std::fs::write(&file, screen_png(&s)) {
            line += &format!(",\"png_error\":{}", json(&e.to_string()));
        }
    }
    line + "}"
}

/// Whether `t`, read back from format `f`, has what that format keeps of `s`.
fn same(s: &Snapshot, t: &Snapshot, f: Format) -> bool {
    let banks_match = (0..8).all(|b| s.bank(b) == t.bank(b) || (f == Format::Sna && !s.model.is_128k()));
    let regs = match f {
        Format::Szx => s.regs == t.regs,
        _ => {
            (s.regs.af, s.regs.bc, s.regs.de, s.regs.hl, s.regs.ix, s.regs.iy, s.regs.sp, s.regs.pc, s.regs.r)
                == (t.regs.af, t.regs.bc, t.regs.de, t.regs.hl, t.regs.ix, t.regs.iy, t.regs.sp, t.regs.pc, t.regs.r)
        }
    };
    banks_match && regs && s.port_7ffd == t.port_7ffd
}

/// The screen with a 32-pixel border, as an 8-bit RGB PNG.
fn screen_png(s: &Snapshot) -> Vec<u8> {
    const PALETTE: [[u8; 3]; 16] = [
        [0, 0, 0],
        [0, 0, 0xD7],
        [0xD7, 0, 0],
        [0xD7, 0, 0xD7],
        [0, 0xD7, 0],
        [0, 0xD7, 0xD7],
        [0xD7, 0xD7, 0],
        [0xD7, 0xD7, 0xD7],
        [0, 0, 0],
        [0, 0, 0xFF],
        [0xFF, 0, 0],
        [0xFF, 0, 0xFF],
        [0, 0xFF, 0],
        [0, 0xFF, 0xFF],
        [0xFF, 0xFF, 0],
        [0xFF, 0xFF, 0xFF],
    ];
    let screen = s.screen();
    let (w, h, b) = (320usize, 256usize, 32usize);
    let mut raw = Vec::with_capacity(h * (1 + 3 * w));
    for y in 0..h {
        raw.push(0); // No filter.
        for x in 0..w {
            let colour = if (b..b + 256).contains(&x) && (b..b + 192).contains(&y) {
                let (px, py) = (x - b, y - b);
                let byte = screen[((py & 0xC0) << 5) | ((py & 0x07) << 8) | ((py & 0x38) << 2) | (px >> 3)];
                let attr = screen[6144 + (py / 8) * 32 + px / 8];
                let bright = ((attr >> 3) & 8) as usize;
                let ink = byte & (0x80 >> (px & 7)) != 0;
                bright + if ink { attr & 7 } else { (attr >> 3) & 7 } as usize
            } else {
                s.border() as usize
            };
            raw.extend_from_slice(&PALETTE[colour]);
        }
    }
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], body: &[u8]| {
        png.extend_from_slice(&(body.len() as u32).to_be_bytes());
        let mut c = kind.to_vec();
        c.extend_from_slice(body);
        png.extend_from_slice(&c);
        png.extend_from_slice(&unzip::crc32(&c).to_be_bytes());
    };
    let mut ihdr = (w as u32).to_be_bytes().to_vec();
    ihdr.extend_from_slice(&(h as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    chunk(b"IDAT", &miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6));
    chunk(b"IEND", &[]);
    png
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
