//! The tool, as a product runs it (crux#34): the fixture's workspace (tests/fixture/ws, its cargo home
//! tests/fixture/home) copied to a directory of each test's own and built there, as `cargo run -p wasm -- build`
//! builds it.
//!
//! - Built in two places, each its own workspace, cargo home and target directory, the engine is the same bytes.
//! - A feature changes them; `--json` says the module's bytes and hash as they are.
//! - A crate that asks for shared memory imports memory that is shared; one that does not has its own, not shared.
//! - `--opt` runs the wasm-opt `$WASM_OPT` names, or the PATH's; where there is none, or it fails, the build fails,
//!   and what was at `--out` is as it was, with nothing left beside it.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// The fixture, copied afresh to a directory of the test's own: its `ws` and its `home`.
fn fixture(name: &str) -> PathBuf {
    let to = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("wasm-tests")
        .join(name);
    if to.exists() {
        std::fs::remove_dir_all(&to).unwrap();
    }
    copy(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixture"),
        &to,
    );
    to
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        if e.file_name() == "target" {
            continue;
        }
        let (from, to) = (e.path(), to.join(e.file_name()));
        match e.file_type().unwrap().is_dir() {
            true => copy(&from, &to),
            false => {
                std::fs::copy(&from, &to).unwrap();
            }
        }
    }
}

/// The tool, run in the fixture's workspace at `dir`, its cargo home `dir/home`.
fn wasm(dir: &Path, args: &[&str]) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_wasm"));
    c.arg("build")
        .args(args)
        .current_dir(dir.join("ws"))
        .env("CARGO_HOME", dir.join("home"))
        .env(
            "CARGO",
            std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()),
        )
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("CARGO_TARGET_DIR")
        .env_remove("WASM_OPT");
    c
}

fn ok(mut c: Command) -> serde_json::Value {
    let out = c.output().unwrap();
    assert!(
        out.status.success(),
        "{c:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "{c:?} said {:?}, not JSON: {e}",
            String::from_utf8_lossy(&out.stdout)
        )
    })
}

fn failed(mut c: Command) -> Output {
    let out = c.output().unwrap();
    assert!(!out.status.success(), "{c:?} did not fail");
    out
}

fn sha256(bytes: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// What was built, checked against what `--json` said of it.
fn built(said: &serde_json::Value) -> Vec<u8> {
    let bytes = std::fs::read(said["out"].as_str().unwrap()).unwrap();
    assert_eq!(said["bytes"], bytes.len(), "{said}");
    assert_eq!(said["sha256"], sha256(&bytes), "{said}");
    bytes
}

/// What is in the directory, but for what was put there before.
fn left(dir: &Path, but: &[&str]) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| !but.contains(&n.as_str()))
        .collect()
}

#[test]
fn built_in_two_places_it_is_the_same_bytes() {
    let (a, b) = (fixture("same-a"), fixture("same-b"));
    let one = ok(wasm(
        &a,
        &["fixture-engine", "--out", "../out/engine.wasm", "--json"],
    ));
    // The other where cargo builds elsewhere, outside its workspace, as CARGO_TARGET_DIR puts it.
    let two = ok({
        let mut c = wasm(
            &b,
            &["fixture-engine", "--out", "../out/engine.wasm", "--json"],
        );
        c.env("CARGO_TARGET_DIR", b.with_extension("target"));
        c
    });
    let (one, two) = (built(&one), built(&two));
    assert!(
        one == two,
        "the engine built in {} and in {} is not the same bytes",
        a.display(),
        b.display()
    );
    // Each place a path starts from is in it, as a name of its own, and none of where it was built.
    let text = String::from_utf8_lossy(&one);
    for path in [
        "engine/src/lib.rs",
        "/cargo/kit/src/lib.rs",
        "tune/src/lib.rs",
        "/out/generated.rs",
    ] {
        assert!(text.contains(path), "the engine has no {path} in it");
    }
    assert!(text.contains("/target/wasm32-unknown-unknown/release/build/fixture-engine-"));
    let tmp = env!("CARGO_TARGET_TMPDIR");
    assert!(!text.contains(tmp), "the engine has {tmp} in it");
}

#[test]
fn a_feature_changes_the_bytes() {
    let dir = fixture("feature");
    let plain = ok(wasm(
        &dir,
        &["fixture-engine", "--out", "../out/plain.wasm", "--json"],
    ));
    let loud = ok(wasm(
        &dir,
        &[
            "fixture-engine",
            "--out",
            "../out/loud.wasm",
            "--features",
            "loud",
            "--json",
        ],
    ));
    assert_eq!(plain["features"], "");
    assert_eq!(loud["features"], "loud");
    assert_ne!(
        built(&plain),
        built(&loud),
        "--features loud built the same bytes"
    );
    assert_ne!(plain["sha256"], loud["sha256"]);
}

/// A module's memories, imported and its own: whether each is shared.
fn memories(wasm: &[u8]) -> (Vec<bool>, Vec<bool>) {
    fn leb(b: &[u8], at: &mut usize) -> u64 {
        let (mut v, mut shift) = (0u64, 0);
        loop {
            let byte = b[*at];
            *at += 1;
            v |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return v;
            }
            shift += 7;
        }
    }
    fn name(b: &[u8], at: &mut usize) {
        let n = leb(b, at) as usize;
        *at += n;
    }
    /// A memory's limits: whether it is shared, past its bounds.
    fn limits(b: &[u8], at: &mut usize) -> bool {
        let flags = leb(b, at);
        leb(b, at);
        if flags & 1 != 0 {
            leb(b, at);
        }
        flags & 2 != 0
    }
    assert_eq!(&wasm[..8], b"\0asm\x01\0\0\0", "not a module");
    let (mut imported, mut own) = (Vec::new(), Vec::new());
    let mut at = 8;
    while at < wasm.len() {
        let id = wasm[at];
        at += 1;
        let size = leb(wasm, &mut at) as usize;
        let end = at + size;
        let mut p = at;
        match id {
            2 => {
                for _ in 0..leb(wasm, &mut p) {
                    name(wasm, &mut p);
                    name(wasm, &mut p);
                    match wasm[p] {
                        0x00 => {
                            p += 1;
                            leb(wasm, &mut p);
                        }
                        0x01 => {
                            p += 2;
                            limits(wasm, &mut p);
                        }
                        0x02 => {
                            p += 1;
                            imported.push(limits(wasm, &mut p));
                        }
                        0x03 => p += 3,
                        k => panic!("an import of kind {k}"),
                    }
                }
            }
            5 => {
                for _ in 0..leb(wasm, &mut p) {
                    own.push(limits(wasm, &mut p));
                }
            }
            _ => {}
        }
        at = end;
    }
    (imported, own)
}

#[test]
fn a_crate_that_asks_for_shared_memory_imports_it_shared() {
    let dir = fixture("shared");
    let shared = ok(wasm(
        &dir,
        &["fixture-shared", "--out", "../out/shared.wasm", "--json"],
    ));
    assert_eq!(shared["memory"], "shared");
    assert_eq!(memories(&built(&shared)), (vec![true], vec![]));
    let engine = ok(wasm(
        &dir,
        &["fixture-engine", "--out", "../out/engine.wasm", "--json"],
    ));
    assert_eq!(engine["memory"], "own");
    assert_eq!(memories(&built(&engine)), (vec![], vec![false]));
}

/// A stand-in for wasm-opt: it writes down what it was asked, and writes the module with a custom section `opt`
/// after it, or fails where told to.
fn stand_in(dir: &Path, fails: bool) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let tool = bin.join("wasm-opt");
    // Where it fails, it does so having written half a module where it was told to.
    let script = format!(
        "#!/bin/sh\necho \"$@\" > \"{asked}\"\nin=\"\" out=\"\"\nwhile [ $# -gt 0 ]; do\n  case \"$1\" in\n    -o) out=\"$2\"; shift ;;\n    -*) ;;\n    *) in=\"$1\" ;;\n  esac\n  shift\ndone\n{fail}\ncat \"$in\" > \"$out\"\nprintf '\\000\\004\\003opt' >> \"$out\"\n",
        asked = dir.join("asked").display(),
        fail = if fails {
            "head -c 8 \"$in\" > \"$out\"; echo 'wasm-opt: refused' >&2; exit 1"
        } else {
            ""
        },
    );
    std::fs::write(&tool, script).unwrap();
    std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
    tool
}

#[test]
fn opt_runs_the_wasm_opt_it_finds() {
    let dir = fixture("opt");
    let tool = stand_in(&dir, false);
    let plain = ok(wasm(
        &dir,
        &["fixture-engine", "--out", "../out/plain.wasm", "--json"],
    ));
    let plain = built(&plain);

    // Named by WASM_OPT.
    let opt = ok({
        let mut c = wasm(
            &dir,
            &[
                "fixture-engine",
                "--out",
                "../out/opt.wasm",
                "--opt",
                "--json",
            ],
        );
        c.env("WASM_OPT", &tool);
        c
    });
    assert_eq!(opt["opt"], true);
    let mut want = plain.clone();
    want.extend_from_slice(b"\0\x04\x03opt");
    assert!(
        built(&opt) == want,
        "--opt did not write what wasm-opt made"
    );
    let asked = std::fs::read_to_string(dir.join("asked")).unwrap();
    assert!(asked.starts_with("-O3 "), "wasm-opt was asked {asked}");
    for feature in [
        "--enable-simd",
        "--enable-bulk-memory",
        "--enable-nontrapping-float-to-int",
    ] {
        assert!(
            asked.contains(feature),
            "wasm-opt was asked {asked}, without {feature}"
        );
    }
    assert!(
        !asked.contains("--enable-threads"),
        "wasm-opt was asked {asked}"
    );

    // On the PATH, for a crate of shared memory, which takes threads.
    std::fs::remove_file(dir.join("asked")).unwrap();
    let path = format!(
        "{}:{}",
        tool.parent().unwrap().display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let shared = ok({
        let mut c = wasm(
            &dir,
            &[
                "fixture-shared",
                "--out",
                "../out/shared.wasm",
                "--opt",
                "--json",
            ],
        );
        c.env("PATH", path);
        c
    });
    assert!(built(&shared).ends_with(b"\0\x04\x03opt"));
    let asked = std::fs::read_to_string(dir.join("asked")).unwrap();
    assert!(
        asked.contains("--enable-threads"),
        "wasm-opt was asked {asked}"
    );
}

#[test]
fn opt_with_no_wasm_opt_fails_and_writes_nothing() {
    let dir = fixture("no-opt");
    let out = dir.join("out");
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join("engine.wasm"), "what was there").unwrap();
    let kept = |why: &str| {
        assert_eq!(
            std::fs::read_to_string(out.join("engine.wasm")).unwrap(),
            "what was there",
            "{why}: --out was written"
        );
        assert_eq!(
            left(&out, &["engine.wasm"]),
            Vec::<String>::new(),
            "{why}: left beside it"
        );
    };

    // WASM_OPT names what is not there.
    let said = failed({
        let mut c = wasm(
            &dir,
            &["fixture-engine", "--out", "../out/engine.wasm", "--opt"],
        );
        c.env("WASM_OPT", dir.join("bin/wasm-opt"));
        c
    });
    let err = String::from_utf8_lossy(&said.stderr);
    assert!(
        err.contains("WASM_OPT") && err.contains("not there"),
        "it said {err}"
    );
    kept("WASM_OPT not there");

    // None on the PATH: the toolchain's directory alone, where cargo and rustc are.
    let cargo = PathBuf::from(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    let path = match cargo.parent() {
        Some(p) if p.join("rustc").exists() && !p.join("wasm-opt").exists() => p.to_path_buf(),
        _ => PathBuf::from("/nonexistent"),
    };
    let said = failed({
        let mut c = wasm(
            &dir,
            &["fixture-engine", "--out", "../out/engine.wasm", "--opt"],
        );
        c.env("PATH", path);
        c
    });
    let err = String::from_utf8_lossy(&said.stderr);
    assert!(err.contains("wasm-opt is not on the PATH"), "it said {err}");
    kept("no wasm-opt on the PATH");

    // One that fails.
    let tool = stand_in(&dir, true);
    let said = failed({
        let mut c = wasm(
            &dir,
            &["fixture-engine", "--out", "../out/engine.wasm", "--opt"],
        );
        c.env("WASM_OPT", &tool);
        c
    });
    let err = String::from_utf8_lossy(&said.stderr);
    assert!(
        err.contains("wasm-opt: refused") && err.contains("failed"),
        "it said {err}"
    );
    kept("wasm-opt failed");

    // And without --opt, the same build writes it whole, and leaves nothing beside it.
    ok(wasm(
        &dir,
        &["fixture-engine", "--out", "../out/engine.wasm", "--json"],
    ));
    assert!(std::fs::read(out.join("engine.wasm"))
        .unwrap()
        .starts_with(b"\0asm"));
    assert_eq!(left(&out, &["engine.wasm"]), Vec::<String>::new());
}

#[test]
fn rustflags_are_refused() {
    let dir = fixture("rustflags");
    let said = failed({
        let mut c = wasm(&dir, &["fixture-engine", "--out", "../out/engine.wasm"]);
        c.env("RUSTFLAGS", "-C opt-level=1");
        c
    });
    assert!(String::from_utf8_lossy(&said.stderr).contains("RUSTFLAGS is set"));
    assert!(!dir.join("out").exists());
}
