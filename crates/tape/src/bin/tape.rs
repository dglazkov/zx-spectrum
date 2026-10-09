//! `tape`: what is on a tape, from the command line.
//!
//!     tape list FILE [--json]                         the blocks: kind, length, what each is
//!     tape edges FILE [--128k] [--from N] [--count N]  the EAR level's changes, T-state by T-state
//!     tape roms FILE [--json]                         the blocks the ROM's LD-BYTES could be handed at once
//!
//! FILE is a TAP, TZX, CSW or PZX. `--json` writes one JSON value to standard output.

use std::process::ExitCode;

use tape::{CLOCK_48K, CLOCK_128K, Player, Tape};

const USAGE: &str = "usage: tape list FILE [--json]
       tape edges FILE [--128k] [--from BLOCK] [--count N]
       tape roms FILE [--json]";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    let (Some(command), Some(path)) = (args.first(), args.get(1)) else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let flag = |name: &str| args.iter().any(|a| a == name);
    let value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .and_then(|v| v.parse::<usize>().ok())
    };
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("tape: {path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let tape = match Tape::parse(&bytes) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("tape: {path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    for w in &tape.warnings {
        eprintln!("tape: {path}: {w}");
    }
    match command.as_str() {
        "list" => list(&tape, flag("--json")),
        "edges" => edges(
            tape,
            flag("--128k"),
            value("--from").unwrap_or(0),
            value("--count").unwrap_or(100),
        ),
        "roms" => roms(tape, flag("--json")),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    }
    ExitCode::SUCCESS
}

/// A string as JSON.
fn json(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn list(tape: &Tape, as_json: bool) {
    let player = Player::new(tape.clone(), CLOCK_48K);
    if as_json {
        let blocks: Vec<String> = tape
            .blocks
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let id = b.tzx_id().map_or("null".to_string(), |id| id.to_string());
                format!(
                    "{{\"index\":{i},\"id\":{id},\"kind\":{},\"seconds\":{:.6},\"description\":{}}}",
                    json(b.kind()),
                    player.block_seconds(i),
                    json(&b.describe())
                )
            })
            .collect();
        let info: Vec<String> = tape
            .info()
            .iter()
            .map(|(k, v)| format!("[{},{}]", json(k), json(v)))
            .collect();
        println!(
            "{{\"format\":{},\"seconds\":{:.6},\"info\":[{}],\"blocks\":[{}]}}",
            json(&format!("{:?}", tape.format)),
            player.tape_seconds(),
            info.join(","),
            blocks.join(",")
        );
        return;
    }
    println!(
        "{:?}, {} blocks, {:.3} s",
        tape.format,
        tape.blocks.len(),
        player.tape_seconds()
    );
    for (k, v) in tape.info() {
        println!("  {k}: {v}");
    }
    for (i, b) in tape.blocks.iter().enumerate() {
        let id = b
            .tzx_id()
            .map_or("  ".to_string(), |id| format!("{id:02X}"));
        println!(
            "{i:4}  {id}  {:<22} {:>9.3} s  {}",
            b.kind(),
            player.block_seconds(i),
            b.describe()
        );
    }
}

/// The level's changes, from block `from`, as T-state and level, the T-state counted from where the tape
/// starts playing.
fn edges(tape: Tape, at_128k: bool, from: usize, count: usize) {
    let mut p = Player::new(tape, if at_128k { CLOCK_128K } else { CLOCK_48K });
    p.seek(from, 0);
    p.play(0);
    // One long frame: T-states count from the start, up to u32's range.
    let mut t = 0;
    println!("{t:>12}  {}", if p.level_at(0) { "high" } else { "low" });
    for _ in 0..count {
        let Some(e) = p.next_edge(t) else {
            println!("{:>12}  {:?}", "stop", p.status().stopped_by);
            break;
        };
        t = e;
        println!(
            "{t:>12}  {}  block {}",
            if p.level_at(t) { "high" } else { "low" },
            p.status().block
        );
    }
}

fn roms(tape: Tape, as_json: bool) {
    let mut p = Player::new(tape, CLOCK_48K);
    let mut taken = Vec::new();
    loop {
        match p.take_rom_block(0) {
            Some(b) => taken.push(b),
            None => {
                // Not one the ROM loads: play past this block and look again.
                let next = p.status().block + 1;
                if next >= p.tape().blocks.len() {
                    break;
                }
                p.seek(next, 0);
            }
        }
    }
    if as_json {
        let items: Vec<String> = taken
            .iter()
            .map(|b| {
                format!(
                    "{{\"index\":{},\"flag\":{},\"length\":{}}}",
                    b.index,
                    b.bytes[0],
                    b.bytes.len()
                )
            })
            .collect();
        println!("[{}]", items.join(","));
        return;
    }
    for b in taken {
        let parity = tape::tap::parity(&b.bytes) == 0;
        let what = p.tape().blocks[b.index].describe();
        println!(
            "{:4}  flag {:#04X}  {:6} bytes  parity {}  {what}",
            b.index,
            b.bytes[0],
            b.bytes.len(),
            if parity { "ok" } else { "BAD" }
        );
    }
}
