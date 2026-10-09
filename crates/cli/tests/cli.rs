//! The `zx` command: each subcommand run as an agent runs it, on files made here (no fixture).

use std::path::PathBuf;
use std::process::Command;

fn zx(args: &[&str]) -> (i32, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_zx"))
        .args(args)
        .output()
        .expect("run zx");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("zx-cli-test-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn every_command_has_help() {
    let (code, out, _) = zx(&["--help"]);
    assert_eq!(code, 0);
    for cmd in [
        "run", "tape", "snap", "disasm", "screen", "bench", "compare",
    ] {
        assert!(
            out.contains(&format!("zx {cmd}")),
            "the overview names {cmd}"
        );
        let (code, out, _) = zx(&[cmd, "--help"]);
        assert_eq!(code, 0, "{cmd} --help");
        assert!(out.starts_with(&format!("zx {cmd}")), "{cmd} --help: {out}");
    }
    let (code, _, err) = zx(&["nonsense"]);
    assert_eq!(code, 2);
    assert!(err.contains("no command"));
}

#[test]
fn run_boots_and_reads_the_screen_as_json() {
    let d = dir();
    let png = d.join("boot.png");
    let (code, out, _) = zx(&[
        "run",
        "--frames",
        "150",
        "--json",
        "--peek",
        "0x5C48",
        "--png",
        png.to_str().unwrap(),
    ]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["model"], "48k");
    assert_eq!(v["frames"], 150);
    assert!(
        v["text"][23]
            .as_str()
            .unwrap()
            .starts_with("© 1982 Sinclair Research Ltd")
    );
    assert_eq!(v["peek"]["0x5C48"], 0x38, "BORDCR: white border");
    let bytes = std::fs::read(&png).unwrap();
    let pic = zx_cli::image::read_png(&bytes).unwrap();
    assert_eq!((pic.width, pic.height), (352, 296));
    // The same picture compares equal; with --until-text, a run that never sees the text fails.
    let (code, _, _) = zx(&["compare", png.to_str().unwrap(), png.to_str().unwrap()]);
    assert_eq!(code, 0);
    let (code, _, err) = zx(&["run", "--until-text", "NEVER THERE", "--max-frames", "20"]);
    assert_eq!(code, 1);
    assert!(err.contains("not seen"));
}

#[test]
fn run_types_and_saves_what_it_was_given() {
    let d = dir();
    let snap = d.join("s.z80");
    let state = d.join("s.state");
    let (code, out, _) = zx(&[
        "run",
        "--model",
        "48k",
        "--type",
        "150=10p1\n",
        "--frames",
        "300",
        "--text",
        "--save-snapshot",
        snap.to_str().unwrap(),
        "--save-state",
        state.to_str().unwrap(),
    ]);
    assert_eq!(code, 0);
    assert!(
        out.contains("10>PRINT 1"),
        "the listing, with its current-line marker: {out}"
    );
    let (code, out, _) = zx(&["snap", snap.to_str().unwrap(), "--json"]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["model"], "48k");
    let (code, out, _) = zx(&[
        "run",
        "--load-state",
        state.to_str().unwrap(),
        "--frames",
        "1",
        "--json",
    ]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert!(
        v["text"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str().unwrap().contains("PRINT 1"))
    );
}

#[test]
fn tape_lists_blocks_and_run_loads_them() {
    let d = dir();
    // A BASIC program, as SAVE makes it: 10 BORDER 2 (the tokens), LINE 10.
    let line: Vec<u8> = vec![
        0x00, 0x0A, 0x09, 0x00, 0xE7, 0x32, 0x0E, 0x00, 0x00, 0x02, 0x00, 0x00, 0x0D,
    ];
    let mut header = vec![0x00];
    header.extend_from_slice(b"border    ");
    header.extend_from_slice(&(line.len() as u16).to_le_bytes());
    header.extend_from_slice(&10u16.to_le_bytes());
    header.extend_from_slice(&(line.len() as u16).to_le_bytes());
    let tap = tape::tap::write(&[
        tape::tap::block(0x00, &header),
        tape::tap::block(0xFF, &line),
    ]);
    let path = d.join("border.tap");
    std::fs::write(&path, &tap).unwrap();
    let (code, out, _) = zx(&["tape", path.to_str().unwrap(), "--json"]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["blocks"][0]["kind"], "header");
    assert!(v["blocks"][0]["label"].as_str().unwrap().contains("border"));
    // Loaded (LOAD "" typed, the tape playing from the edges), the program runs: the border red.
    for style in ["realtime", "instant"] {
        let (code, out, _) = zx(&[
            "run",
            path.to_str().unwrap(),
            "--tape",
            style,
            "--frames",
            "1400",
            "--json",
            "--peek",
            "0x5C48",
        ]);
        assert_eq!(code, 0, "{style}");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(
            v["peek"]["0x5C48"].as_u64().unwrap() & 0x38,
            2 << 3,
            "{style}: BORDCR after BORDER 2"
        );
    }
}

#[test]
fn disasm_screen_and_bench() {
    let (code, out, _) = zx(&["disasm", "--count", "4"]);
    assert_eq!(code, 0);
    let lines: Vec<&str> = out.lines().collect();
    assert!(
        lines[0].contains("DI") && lines[1].contains("XOR A") && lines[3].contains("JP $11CB"),
        "{out}"
    );
    // A screen of the ROM's font: "HELLO" at the top left.
    let mut scr = vec![0u8; 6912];
    let rom = include_bytes!("../../../roms/48.rom");
    for (i, ch) in "HELLO".bytes().enumerate() {
        for y in 0..8 {
            scr[(y << 8) | i] = rom[0x3D00 + (ch as usize - 32) * 8 + y];
        }
    }
    scr[6144..].fill(0x38);
    let d = dir();
    let path = d.join("hello.scr");
    std::fs::write(&path, &scr).unwrap();
    let (code, out, _) = zx(&["screen", path.to_str().unwrap(), "--text"]);
    assert_eq!(code, 0);
    assert!(out.starts_with("HELLO"), "{out}");
    let (code, out, _) = zx(&["bench", "--model", "48k", "--frames", "20", "--json"]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v[0]["frames"], 20);
}

#[test]
fn a_joystick_asked_for_wins_over_the_snapshots() {
    // A 48K snapshot saying "cursor joystick" whose program reads port 1Fh into 9000h: with --joystick
    // kempston the Kempston interface answers (00h, nothing pressed); without it, nothing does (FFh, the
    // floating bus in the top border).
    let d = dir();
    let path = d.join("joystick.z80");
    let mut snap = snapshot::Snapshot::new(snapshot::Model::Spectrum48);
    for (i, b) in [0xDB, 0x1F, 0x32, 0x00, 0x90, 0x18, 0xFE]
        .into_iter()
        .enumerate()
    {
        snap.poke(0x8000 + i as u16, b);
    }
    snap.regs.pc = 0x8000;
    snap.regs.sp = 0xFF00;
    snap.regs.af = 0x0000;
    snap.joystick = Some(snapshot::Joystick::Cursor);
    std::fs::write(&path, snapshot::save(&snap, snapshot::Format::Z80).unwrap()).unwrap();
    let peek = |extra: &[&str]| {
        let mut args = vec![
            "run",
            path.to_str().unwrap(),
            "--frames",
            "2",
            "--json",
            "--peek",
            "0x9000",
        ];
        args.extend_from_slice(extra);
        let (code, out, err) = zx(&args);
        assert_eq!(code, 0, "{err}");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        v["peek"]["0x9000"].as_u64().unwrap()
    };
    assert_eq!(peek(&[]), 0xFF);
    assert_eq!(peek(&["--joystick", "kempston"]), 0x00);
}
