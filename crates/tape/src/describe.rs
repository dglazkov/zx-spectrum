//! What each block is, in words, for the page's list of a tape.
//!
//! A header says what the ROM's LOAD would print for it ("Program: SABOTEUR"), with what SAVE would have
//! been typed to make it after: the line it starts at, the array, the address and length of the bytes.

use crate::Tape;
use crate::block::*;
use crate::signal::{self, TAPE_HZ};
use crate::text::spectrum;

/// A tape header: the 17 bytes after the flag of a block the ROM's SAVE writes before the data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Header {
    /// 0 a program, 1 a number array, 2 a character array, 3 bytes.
    pub kind: u8,
    /// The name as the screen shows it (see [`crate::text::spectrum`]), and as it is on the tape.
    pub name: String,
    pub raw_name: [u8; 10],
    /// The data's length.
    pub length: u16,
    /// For a program, the line it runs from (32768 and above: none); for an array, its variable's name in
    /// the high byte; for bytes, their start address.
    pub param1: u16,
    /// For a program, the length of the program without its variables.
    pub param2: u16,
}

impl Header {
    /// The header in a block's bytes (flag, 17 bytes, parity), if they are one.
    pub fn parse(data: &[u8]) -> Option<Header> {
        if data.len() != 19 || data[0] != 0 {
            return None;
        }
        let word = |at: usize| u16::from_le_bytes([data[at], data[at + 1]]);
        let raw_name: [u8; 10] = data[2..12].try_into().ok()?;
        Some(Header {
            kind: data[1],
            name: spectrum(&raw_name),
            raw_name,
            length: word(12),
            param1: word(14),
            param2: word(16),
        })
    }

    /// As LOAD prints it, and how SAVE made it: "Program: SABOTEUR LINE 1", "Bytes: screen CODE 16384,6912".
    pub fn describe(&self) -> String {
        let name = if self.name.is_empty() {
            String::new()
        } else {
            format!(" {}", self.name)
        };
        // An array's variable: its letter in the low five bits of param1's high byte.
        let var = (((self.param1 >> 8) as u8 & 0x1F) | 0x60) as char;
        match self.kind {
            0 if self.param1 < 32768 => format!("Program:{name} LINE {}", self.param1),
            0 => format!("Program:{name}"),
            1 => format!("Number array:{name} DATA {var}()"),
            2 => format!("Character array:{name} DATA {var}$()"),
            3 => format!("Bytes:{name} CODE {},{}", self.param1, self.length),
            k => format!("Header of type {k}:{name}, {} bytes", self.length),
        }
    }
}

/// What a block's bytes hold, as LOAD would see them.
fn content(data: &[u8]) -> String {
    if let Some(h) = Header::parse(data) {
        return h.describe();
    }
    match data {
        [0xFF, rest @ ..] if !rest.is_empty() => format!("Data: {} bytes", rest.len() - 1),
        [flag, rest @ ..] if !rest.is_empty() => {
            format!("Data, flag {flag:#04X}: {} bytes", rest.len() - 1)
        }
        _ => format!("{} bytes", data.len()),
    }
}

/// Seconds, as few digits as say them: "1 s", "0.872 s".
fn seconds(t35: u64) -> String {
    let s = format!("{:.3}", t35 as f64 / TAPE_HZ as f64);
    format!("{} s", s.trim_end_matches('0').trim_end_matches('.'))
}

fn list<T: std::fmt::Display>(items: impl Iterator<Item = T>, max: usize) -> String {
    let items: Vec<String> = items.map(|i| i.to_string()).collect();
    if items.len() > max {
        format!("{}, … ({} in all)", items[..max].join(", "), items.len())
    } else {
        items.join(", ")
    }
}

/// The name TZX gives an archive info entry's identification byte.
pub fn archive_field(id: u8) -> &'static str {
    match id {
        0x00 => "Title",
        0x01 => "Publisher",
        0x02 => "Author",
        0x03 => "Year",
        0x04 => "Language",
        0x05 => "Type",
        0x06 => "Price",
        0x07 => "Protection",
        0x08 => "Origin",
        0xFF => "Comment",
        _ => "Info",
    }
}

const COMPUTERS: &[&str] = &[
    "ZX Spectrum 16K",
    "ZX Spectrum 48K, Plus",
    "ZX Spectrum 48K Issue 1",
    "ZX Spectrum 128K + (Sinclair)",
    "ZX Spectrum 128K +2 (grey case)",
    "ZX Spectrum 128K +2A, +3",
    "Timex Sinclair TC-2048",
    "Timex Sinclair TS-2068",
    "Pentagon 128",
    "Sam Coupé",
    "Didaktik M",
    "Didaktik Gama",
    "ZX-80",
    "ZX-81",
    "ZX Spectrum 128K, Spanish version",
    "ZX Spectrum, Arabic version",
    "Microdigital TK 90-X",
    "Microdigital TK 95",
    "Byte",
    "Elwro 800-3",
    "ZS Scorpion 256",
    "Amstrad CPC 464",
    "Amstrad CPC 664",
    "Amstrad CPC 6128",
    "Amstrad CPC 464+",
    "Amstrad CPC 6128+",
    "Jupiter ACE",
    "Enterprise",
    "Commodore 64",
    "Commodore 128",
    "Inves Spectrum+",
    "Profi",
    "GrandRomMax",
    "Kay 1024",
    "Ice Felix HC 91",
    "Ice Felix HC 2000",
    "Amaterske RADIO Mistrum",
    "Quorum 128",
    "MicroART ATM",
    "MicroART ATM Turbo 2",
    "Chrome",
    "ZX Badaloc",
    "TS-1500",
    "Lambda",
    "TK-65",
    "ZX-97",
];
const STORAGE: &[&str] = &[
    "ZX Microdrive",
    "Opus Discovery",
    "MGT Disciple",
    "MGT Plus-D",
    "Rotronics Wafadrive",
    "TR-DOS (BetaDisk)",
    "Byte Drive",
    "Watsford",
    "FIZ",
    "Radofin",
    "Didaktik disk drives",
    "BS-DOS (MB-02)",
    "ZX Spectrum +3 disk drive",
    "JLO (Oliger) disk interface",
    "Timex FDD3000",
    "Zebra disk drive",
    "Ramex Millenia",
    "Larken",
    "Kempston disk interface",
    "Sandy",
    "ZX Spectrum +3e hard disk",
    "ZXATASP",
    "DivIDE",
    "ZXCF",
];
const MEMORY: &[&str] = &[
    "Sam Ram",
    "Multiface ONE",
    "Multiface 128K",
    "Multiface +3",
    "MultiPrint",
    "MB-02 ROM/RAM expansion",
    "SoftROM",
    "1K",
    "16K",
    "48K",
    "Memory in 8-16K used",
];
const SOUND: &[&str] = &[
    "Classic AY hardware (128K compatible)",
    "Fuller Box AY sound hardware",
    "Currah microSpeech",
    "SpecDrum",
    "AY ACB stereo (A+C left, B+C right); Melodik",
    "AY ABC stereo (A+B left, B+C right)",
    "RAM Music Machine",
    "Covox",
    "General Sound",
    "Intec Electronics Digital Interface B8001",
    "Zon-X AY",
    "QuickSilva AY",
    "Jupiter ACE",
];
const JOYSTICKS: &[&str] = &[
    "Kempston",
    "Cursor, Protek, AGF",
    "Sinclair 2 Left (12345)",
    "Sinclair 1 Right (67890)",
    "Fuller",
];
const MICE: &[&str] = &["AMX mouse", "Kempston mouse"];
const CONTROLLERS: &[&str] = &[
    "Trickstick",
    "ZX Light Gun",
    "Zebra Graphics Tablet",
    "Defender Light Gun",
];
const SERIAL: &[&str] = &["ZX Interface 1", "ZX Spectrum 128K"];
const PARALLEL: &[&str] = &[
    "Kempston S",
    "Kempston E",
    "ZX Spectrum +3",
    "Tasman",
    "DK'Tronics",
    "Hilderbay",
    "INES Printerface",
    "ZX LPrint Interface 3",
    "MultiPrint",
    "Opus Discovery",
    "Standard 8255 chip with ports 31,63,95",
];
const PRINTERS: &[&str] = &[
    "ZX Printer, Alphacom 32 and compatibles",
    "Generic printer",
    "EPSON compatible",
];
const MODEMS: &[&str] = &["Prism VTX 5000", "T/S 2050 or Westridge 2050"];
const DIGITIZERS: &[&str] = &[
    "RD Digital Tracer",
    "DK'Tronics Light Pen",
    "British MicroGraph Pad",
    "Romantic Robot Videoface",
];
const NETWORK: &[&str] = &["ZX Interface 1"];
const KEYPADS: &[&str] = &["Keypad for ZX Spectrum 128K"];
const CONVERTERS: &[&str] = &["Harley Systems ADC 8.2", "Blackboard Electronics"];
const EPROM: &[&str] = &["Orme Electronics"];
const GRAPHICS: &[&str] = &["WRX Hi-Res", "G007", "Memotech", "Lambda Colour"];
const KINDS: &[(&str, &[&str])] = &[
    ("Computer", COMPUTERS),
    ("External storage", STORAGE),
    ("ROM/RAM add-on", MEMORY),
    ("Sound device", SOUND),
    ("Joystick", JOYSTICKS),
    ("Mouse", MICE),
    ("Controller", CONTROLLERS),
    ("Serial port", SERIAL),
    ("Parallel port", PARALLEL),
    ("Printer", PRINTERS),
    ("Modem", MODEMS),
    ("Digitizer", DIGITIZERS),
    ("Network adapter", NETWORK),
    ("Keyboard or keypad", KEYPADS),
    ("AD/DA converter", CONVERTERS),
    ("EPROM programmer", EPROM),
    ("Graphics", GRAPHICS),
];

impl HardwareInfo {
    /// The hardware's name, from the TZX specification's list.
    pub fn name(&self) -> String {
        match KINDS.get(self.kind as usize) {
            Some((_, names)) => match names.get(self.id as usize) {
                Some(n) => n.to_string(),
                None => format!("{} {:#04X}", KINDS[self.kind as usize].0, self.id),
            },
            None => format!("Hardware {:#04X}/{:#04X}", self.kind, self.id),
        }
    }

    /// What the tape does with it.
    pub fn relation(&self) -> &'static str {
        match self.info {
            0 => "runs on",
            1 => "uses",
            2 => "runs on, without using",
            3 => "does not run on",
            _ => "?",
        }
    }
}

impl Block {
    /// A few words for the kind of block it is.
    pub fn kind(&self) -> &'static str {
        match self {
            Block::Standard { .. } => "Standard speed data",
            Block::Turbo(t) if t.rom_timed() => "Standard speed data",
            Block::Turbo(_) => "Turbo speed data",
            Block::PureTone { .. } => "Pure tone",
            Block::Pulses(_) | Block::PzxPulses(_) => "Pulse sequence",
            Block::PureData(_) => "Pure data",
            Block::DirectRecording(_) => "Direct recording",
            Block::Csw(_) => "CSW recording",
            Block::Generalized(_) => "Generalized data",
            Block::Pause { ms: 0 } => "Stop the tape",
            Block::Pause { .. } | Block::PzxPause { .. } => "Pause",
            Block::GroupStart(_) => "Group start",
            Block::GroupEnd => "Group end",
            Block::Jump(_) => "Jump",
            Block::LoopStart(_) => "Loop start",
            Block::LoopEnd => "Loop end",
            Block::Call(_) => "Call sequence",
            Block::Return => "Return from sequence",
            Block::Select(_) => "Select block",
            Block::StopIf48k => "Stop the tape if 48K",
            Block::SetLevel(_) => "Set signal level",
            Block::Text(_) => "Text description",
            Block::Message { .. } => "Message",
            Block::ArchiveInfo(_) => "Archive info",
            Block::Hardware(_) => "Hardware type",
            Block::CustomInfo { .. } => "Custom info",
            Block::Glue => "Glue",
            Block::Skipped {
                id: 0x16 | 0x17 | 0x34 | 0x40,
                ..
            } => "Deprecated block",
            Block::Skipped { .. } => "Unknown block",
            Block::PzxHeader { .. } => "PZX header",
            Block::PzxData(_) => "Data",
            Block::Browse(_) => "Browse point",
        }
    }

    /// The header the block carries, if its bytes are one.
    pub fn header(&self) -> Option<Header> {
        match self {
            Block::Standard { data, .. } => Header::parse(data),
            Block::Turbo(t) => Header::parse(&t.data),
            Block::PureData(d) => Header::parse(&d.data),
            _ => None,
        }
    }

    /// The block in a line, for the page: "Program: SABOTEUR LINE 1", "Turbo: Data: 6912 bytes",
    /// "Pause: 1 s", "Text: Created with Ramsoft MakeTZX".
    pub fn describe(&self) -> String {
        match self {
            Block::Standard { data, .. } => content(data),
            Block::Turbo(t) if t.rom_timed() => content(&t.data),
            Block::Turbo(t) => format!("Turbo: {}", content(&t.data)),
            Block::PureTone { pulse, count } => format!("Pure tone: {count} pulses of {pulse} T"),
            Block::Pulses(p) => format!("Pulses: {} T", list(p.iter(), 6)),
            Block::PureData(d) => format!("Pure data: {}", content(&d.data)),
            Block::DirectRecording(d) => {
                let rate = TAPE_HZ as f64 / d.tstates_per_sample.max(1) as f64;
                format!(
                    "Direct recording: {}, {:.0} samples a second",
                    seconds(signal::duration(self)),
                    rate
                )
            }
            Block::Csw(c) => format!(
                "CSW recording: {} at {} Hz",
                seconds(signal::duration(self)),
                c.sample_rate
            ),
            Block::Generalized(g)
                if g.bits_per_symbol == 1 && g.data_count.is_multiple_of(8) && g.data_count > 0 =>
            {
                format!(
                    "Generalized data: {}",
                    content(&g.data[..g.data_count as usize / 8])
                )
            }
            Block::Generalized(g) => format!("Generalized data: {} symbols", g.data_count),
            Block::Pause { ms: 0 } => "Stop the tape".into(),
            Block::Pause { ms } => format!("Pause: {}", seconds(*ms as u64 * 3500)),
            Block::GroupStart(name) => format!("Group: {name}"),
            Block::GroupEnd => "Group end".into(),
            Block::Jump(n) => format!("Jump to block {n:+}"),
            Block::LoopStart(n) => format!("Loop: {n} times"),
            Block::LoopEnd => "Loop end".into(),
            Block::Call(c) => format!(
                "Call blocks {}",
                list(c.iter().map(|o| format!("{o:+}")), 8)
            ),
            Block::Return => "Return from sequence".into(),
            Block::Select(s) => format!("Select: {}", list(s.iter().map(|s| s.text.clone()), 8)),
            Block::StopIf48k => "Stop the tape if 48K".into(),
            Block::SetLevel(high) => {
                format!("Signal level: {}", if *high { "high" } else { "low" })
            }
            Block::Text(t) => format!("Text: {t}"),
            Block::Message { text, .. } => format!("Message: {text}"),
            Block::ArchiveInfo(texts) => {
                let mut fields: Vec<&(u8, String)> =
                    texts.iter().filter(|(id, _)| *id <= 3).collect();
                fields.sort_by_key(|(id, _)| *id);
                format!(
                    "Archive info: {}",
                    list(fields.iter().map(|(_, t)| t.replace('\n', "; ")), 4)
                )
            }
            Block::Hardware(h) => {
                format!(
                    "Hardware: {}",
                    list(
                        h.iter().map(|h| format!("{} {}", h.relation(), h.name())),
                        6
                    )
                )
            }
            Block::CustomInfo { id, data } => format!("Custom info: {id}, {} bytes", data.len()),
            Block::Glue => "Glue: another TZX joined on".into(),
            Block::Skipped { id, len } => {
                let what = match id {
                    0x16 => "C64 ROM data (deprecated)",
                    0x17 => "C64 turbo data (deprecated)",
                    0x34 => "Emulation info (deprecated)",
                    0x40 => "Snapshot (deprecated)",
                    _ => "Unknown block",
                };
                format!("{what}, ID {id:#04X}: {len} bytes skipped")
            }
            Block::PzxHeader {
                major,
                minor,
                title,
                ..
            } => {
                if title.is_empty() {
                    format!("PZX {major}.{minor}")
                } else {
                    format!("PZX {major}.{minor}: {title}")
                }
            }
            Block::PzxPulses(p) => {
                let entries = p.iter().map(|p| {
                    if p.count == 1 {
                        format!("{}", p.duration)
                    } else {
                        format!("{} × {}", p.count, p.duration)
                    }
                });
                format!("Pulses: {} T", list(entries, 6))
            }
            Block::PzxData(d) if d.bits.is_multiple_of(8) && d.bits > 0 => {
                format!("Data: {}", content(&d.data))
            }
            Block::PzxData(d) => format!("Data: {} bits", d.bits),
            Block::PzxPause { duration, .. } => format!("Pause: {}", seconds(*duration as u64)),
            Block::Browse(t) => format!("Browse point: {t}"),
        }
    }
}

impl Tape {
    /// What the tape says of itself (TZX archive info, PZX's header): field and text, in order.
    pub fn info(&self) -> Vec<(String, String)> {
        let mut info = Vec::new();
        for block in &self.blocks {
            match block {
                Block::ArchiveInfo(texts) => info.extend(
                    texts
                        .iter()
                        .map(|(id, t)| (archive_field(*id).to_string(), t.clone())),
                ),
                Block::PzxHeader {
                    title, info: pairs, ..
                } => {
                    if !title.is_empty() {
                        info.push(("Title".to_string(), title.clone()));
                    }
                    info.extend(pairs.iter().cloned());
                }
                _ => {}
            }
        }
        info
    }
}
