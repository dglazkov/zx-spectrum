//! The `tape` command, on a tape written for it.

mod common;

use common::*;

fn run(args: &[&str]) -> (bool, String) {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_tape"))
        .args(args)
        .output()
        .expect("tape runs");
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    )
}

#[test]
fn the_command_lists_a_tape_and_its_rom_blocks() {
    let dir = std::env::temp_dir().join(format!("tape-cli-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("two.tzx");
    let file = tzx(&[
        b30("made for the test"),
        b10(1000, &header(3, "screen", 6912, 16384, 0)),
        b12(1000, 4),
    ]);
    std::fs::write(&path, file).unwrap();
    let path = path.to_str().unwrap();

    let (ok, list) = run(&["list", path]);
    assert!(ok);
    assert!(list.contains("Text: made for the test"));
    assert!(list.contains("Bytes: screen CODE 16384,6912"));
    let (ok, json) = run(&["list", path, "--json"]);
    assert!(ok);
    assert!(json.starts_with("{\"format\":\"Tzx { major: 1, minor: 20 }\""));
    assert!(json.contains("\"kind\":\"Pure tone\""));
    let (ok, roms) = run(&["roms", path, "--json"]);
    assert!(ok);
    assert_eq!(roms.trim(), "[{\"index\":1,\"flag\":0,\"length\":19}]");
    let (ok, edges) = run(&["edges", path, "--from", "2", "--count", "9"]);
    assert!(ok);
    let lines: Vec<&str> = edges.lines().collect();
    assert_eq!(
        lines[1].split_whitespace().collect::<Vec<_>>(),
        ["1000", "high", "block", "2"]
    );
    assert!(lines.last().unwrap().contains("EndOfTape"));
    assert!(!run(&["list", "/nonexistent.tap"]).0);
    std::fs::remove_dir_all(&dir).unwrap();
}
