//! The build of a product's engine to WebAssembly (crux#34), lifted from zx-spectrum's `scripts/build-wasm.sh`, in
//! place of the scripts polivoks, synth-exp and zx-spectrum each had. Run from the product's workspace:
//!
//!     cargo run -p wasm -- build CRATE --out FILE [--features F] [--opt] [--json]
//!
//! - CRATE, a member of the workspace whose lib is a `cdylib`, is built for wasm32-unknown-unknown in release, with
//!   Cargo.lock as it is (`--locked`) and its symbols stripped.
//! - The build is reproducible: the paths compiled in (a panic names its file) are written as `/workspace` for the
//!   workspace, `/cargo` for cargo's home and `/target` for where it builds, so the same sources with the same
//!   toolchain make the same bytes wherever they are built, in a Dockerfile's stage as on this machine. The remaps
//!   join the rustflags the workspace's `.cargo/config.toml` gives `target.wasm32-unknown-unknown`; RUSTFLAGS would
//!   take their place, so it is refused.
//! - A crate whose Cargo.toml says `[package.metadata.wasm] memory = "shared"` has no memory of its own: it is built
//!   against one it is handed, shared between threads, as synth-exp's render-mix: `+atomics,+bulk-memory` for it
//!   alone, the memory imported and shared, at most 4 GiB, with no stack (no two threads share one) and `__heap_base`
//!   exported.
//! - `--opt` runs wasm-opt -O3 (binaryen) on it. wasm-opt is `$WASM_OPT` where that is set, else `wasm-opt` on the
//!   PATH: one lookup, and where it finds none the build fails, rather than writing a module that was not optimised.
//! - FILE is written beside its place and moved in, so that two builds at once never leave half a file, and a build
//!   that fails leaves what was there.
//! - It says on stderr what it wrote; `--json` says it on stdout, as `{"crate", "out" (its whole path), "bytes",
//!   "sha256", "opt", "memory", "features"}`.
//!
//! It builds in the workspace's target directory, under `wasm/`, so that it never waits on the lock of a build of the
//! product's server, nor makes it build again.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

use serde::Deserialize;
use sha2::{Digest, Sha256};

const TARGET: &str = "wasm32-unknown-unknown";

const HELP: &str = "\
wasm: builds a crate of this workspace to WebAssembly, the same bytes wherever it is built (crux's part wasm).

usage: wasm build CRATE --out FILE [--features F] [--opt] [--json]

  CRATE          a member of the workspace whose lib is a cdylib; built for wasm32-unknown-unknown in release,
                 --locked, its symbols stripped, the paths compiled in written as /workspace, /cargo and /target.
                 [package.metadata.wasm] memory = \"shared\" in its Cargo.toml builds it against shared memory it
                 imports (+atomics,+bulk-memory, --shared-memory, no stack, __heap_base exported).
  --out FILE     where the module goes, written whole or not at all
  --features F   the crate's features, as cargo takes them
  --opt          runs wasm-opt -O3 on it. wasm-opt is $WASM_OPT where that is set, else wasm-opt on the PATH
                 (binaryen); where neither is there, the build fails.
  --json         says what it built on stdout: crate, out, bytes, sha256, opt, memory, features

Run it from the product's workspace: cargo run -p wasm -- build CRATE --out FILE.
";

/// What `build` was asked for.
#[derive(Debug, Default, PartialEq)]
struct Ask {
    krate: String,
    out: PathBuf,
    features: Option<String>,
    opt: bool,
    json: bool,
}

/// The arguments after `build`, or what is wrong with them.
fn ask(args: &[String]) -> Result<Ask, String> {
    let mut a = Ask::default();
    let mut out = None;
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| {
            it.next()
                .cloned()
                .ok_or_else(|| format!("{name} takes a value"))
        };
        match arg.as_str() {
            "--out" => out = Some(PathBuf::from(value("--out")?)),
            "--features" => a.features = Some(value("--features")?),
            "--opt" => a.opt = true,
            "--json" => a.json = true,
            flag if flag.starts_with('-') => return Err(format!("{flag}: not a flag of build")),
            name if a.krate.is_empty() => a.krate = name.to_string(),
            extra => return Err(format!("{extra}: build takes one crate")),
        }
    }
    if a.krate.is_empty() {
        return Err("build takes the crate to build".into());
    }
    a.out = out.ok_or("build takes --out FILE, where the module goes")?;
    Ok(a)
}

#[derive(Deserialize)]
struct Metadata {
    packages: Vec<Package>,
    workspace_root: PathBuf,
    target_directory: PathBuf,
}

#[derive(Deserialize)]
struct Package {
    name: String,
    targets: Vec<Target>,
    #[serde(default)]
    metadata: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Target {
    name: String,
    crate_types: Vec<String>,
}

/// The crate as its workspace has it: the name its module is built under, and whether it builds against shared
/// memory.
struct Crate {
    lib: String,
    shared: bool,
}

/// The workspace's root and target directory, and the crate in it.
fn workspace(cargo: &str, krate: &str) -> Result<(Metadata, Crate), String> {
    let out = Command::new(cargo)
        .args(["metadata", "--format-version", "1", "--no-deps", "--locked"])
        .stderr(Stdio::inherit())
        .output()
        .map_err(|e| format!("{cargo} metadata: {e}"))?;
    if !out.status.success() {
        return Err("cargo metadata failed: run this from the product's workspace".into());
    }
    let m: Metadata =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("cargo metadata: {e}"))?;
    let p = m.packages.iter().find(|p| p.name == krate).ok_or_else(|| {
        format!(
            "{krate} is not a member of the workspace at {}",
            m.workspace_root.display()
        )
    })?;
    let lib = p
        .targets
        .iter()
        .find(|t| t.crate_types.iter().any(|c| c == "cdylib"))
        .ok_or_else(|| {
            format!("{krate} has no cdylib to build: its Cargo.toml says [lib] crate-type = [\"cdylib\"]")
        })?
        .name
        .replace('-', "_");
    let memory = p
        .metadata
        .as_ref()
        .and_then(|m| m.pointer("/wasm/memory"))
        .map(|v| v.as_str().unwrap_or_default().to_string());
    let shared = match memory.as_deref() {
        None | Some("own") => false,
        Some("shared") => true,
        Some(other) => {
            return Err(format!(
                "{krate}: [package.metadata.wasm] memory is {other:?}, where it is \"shared\" or \"own\""
            ))
        }
    };
    Ok((m, Crate { lib, shared }))
}

/// Where cargo's home is, as cargo finds it.
fn cargo_home() -> Option<PathBuf> {
    std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".cargo")))
        .and_then(|h| h.canonicalize().ok())
}

/// The rustflags that make the build the same wherever it is built: each place a path compiled in can start from,
/// written as a name of its own, the most particular last, as the last that matches is the one rustc takes.
fn remaps(root: &Path, home: Option<&Path>, target: &Path) -> Vec<String> {
    let mut flags = vec![format!("--remap-path-prefix={}=/workspace", root.display())];
    if let Some(home) = home {
        flags.push(format!("--remap-path-prefix={}=/cargo", home.display()));
    }
    flags.push(format!("--remap-path-prefix={}=/target", target.display()));
    flags
}

/// What a crate built against shared memory takes, for it alone: synth-exp's render-mix's flags.
const SHARED: &[&str] = &[
    "-C",
    "target-feature=+atomics,+bulk-memory",
    "-C",
    "link-arg=--import-memory",
    "-C",
    "link-arg=--shared-memory",
    "-C",
    "link-arg=--max-memory=4294967296",
    "-C",
    "link-arg=-zstack-size=0",
    "-C",
    "link-arg=--export=__heap_base",
];

/// What wasm-opt is told the module may use: what rustc's wasm32 has on by default, SIMD, which polivoks and
/// synth-exp turn on, and threads, for a module of shared memory.
const FEATURES: &[&str] = &[
    "--enable-bulk-memory",
    "--enable-nontrapping-float-to-int",
    "--enable-sign-ext",
    "--enable-mutable-globals",
    "--enable-multivalue",
    "--enable-reference-types",
    "--enable-simd",
];

/// wasm-opt, as `--opt` finds it: `$WASM_OPT` where that is set, else on the PATH.
fn wasm_opt() -> Result<PathBuf, String> {
    if let Some(named) = std::env::var_os("WASM_OPT").filter(|v| !v.is_empty()) {
        let named = PathBuf::from(named);
        return match named.is_file() {
            true => Ok(named),
            false => Err(format!(
                "--opt: WASM_OPT names {}, which is not there",
                named.display()
            )),
        };
    }
    std::env::var_os("PATH")
        .iter()
        .flat_map(std::env::split_paths)
        .map(|dir| dir.join("wasm-opt"))
        .find(|p| p.is_file())
        .ok_or_else(|| {
            "--opt: wasm-opt is not on the PATH, and WASM_OPT is not set: install binaryen, or set WASM_OPT to its wasm-opt"
                .to_string()
        })
}

/// Runs a command to its end, all it prints on stderr, as `--json` keeps stdout for what was built.
fn run(what: &str, cmd: &mut Command) -> Result<(), String> {
    let status = cmd
        .stdout(std::io::stderr())
        .status()
        .map_err(|e| format!("{what}: {e}"))?;
    match status.success() {
        true => Ok(()),
        false => Err(format!("{what} failed ({status})")),
    }
}

/// A file written beside its place, removed unless it was moved in.
struct Temp(PathBuf);

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn build(a: &Ask) -> Result<serde_json::Value, String> {
    for var in ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"] {
        if std::env::var_os(var).is_some_and(|v| !v.is_empty()) {
            return Err(format!(
                "{var} is set: it would take the place of the workspace's rustflags and of the paths the build \
                 writes the same everywhere; unset it, or put what it says in .cargo/config.toml"
            ));
        }
    }
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let (m, c) = workspace(&cargo, &a.krate)?;
    // Found before the build, so that a build asked to be optimised fails at once where it cannot be.
    let opt = match a.opt {
        true => Some(wasm_opt()?),
        false => None,
    };
    let target = m.target_directory.join("wasm");
    let rustflags = remaps(&m.workspace_root, cargo_home().as_deref(), &target);
    let rustflags: Vec<String> = rustflags
        .iter()
        .map(|f| serde_json::to_string(f).unwrap())
        .collect();
    let mut cmd = Command::new(&cargo);
    cmd.args([
        "rustc",
        "-q",
        "--release",
        "--locked",
        "--target",
        TARGET,
        "-p",
        &a.krate,
        "--lib",
    ])
    .arg("--config")
    .arg(format!(
        "target.{TARGET}.rustflags=[{}]",
        rustflags.join(",")
    ))
    .args(["--config", "profile.release.strip=\"symbols\""])
    .env("CARGO_TARGET_DIR", &target)
    .current_dir(&m.workspace_root);
    if let Some(f) = &a.features {
        cmd.args(["--features", f]);
    }
    if c.shared {
        cmd.arg("--").args(SHARED);
    }
    run(&format!("cargo rustc -p {}", a.krate), &mut cmd)?;
    let built = target
        .join(TARGET)
        .join("release")
        .join(format!("{}.wasm", c.lib));
    if !built.is_file() {
        return Err(format!("cargo built no module at {}", built.display()));
    }

    let dir = match a.out.parent() {
        Some(d) if !d.as_os_str().is_empty() => d.to_path_buf(),
        _ => PathBuf::from("."),
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = a
        .out
        .file_name()
        .ok_or_else(|| format!("--out {}: not a file", a.out.display()))?;
    let temp = Temp(dir.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id()
    )));
    match &opt {
        Some(tool) => {
            let mut cmd = Command::new(tool);
            cmd.arg("-O3").args(FEATURES);
            if c.shared {
                cmd.arg("--enable-threads");
            }
            cmd.arg(&built).arg("-o").arg(&temp.0);
            run(&format!("{} -O3", tool.display()), &mut cmd)?;
        }
        None => {
            std::fs::copy(&built, &temp.0).map_err(|e| format!("{}: {e}", temp.0.display()))?;
        }
    }
    let bytes = std::fs::read(&temp.0).map_err(|e| format!("{}: {e}", temp.0.display()))?;
    if !bytes.starts_with(b"\0asm") {
        return Err(format!(
            "what {} wrote is not a module",
            opt.as_deref().unwrap_or(&built).display()
        ));
    }
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp.0, std::fs::Permissions::from_mode(0o644))
            .map_err(|e| format!("{}: {e}", temp.0.display()))?;
    }
    std::fs::rename(&temp.0, &a.out).map_err(|e| format!("{}: {e}", a.out.display()))?;
    let sha256: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    eprintln!(
        "wasm: {} ({} bytes{})",
        a.out.display(),
        bytes.len(),
        if a.opt { ", wasm-opt -O3" } else { "" }
    );
    Ok(serde_json::json!({
        "crate": a.krate,
        "out": a.out.canonicalize().unwrap_or_else(|_| a.out.clone()),
        "bytes": bytes.len(),
        "sha256": sha256,
        "opt": a.opt,
        "memory": if c.shared { "shared" } else { "own" },
        "features": a.features.as_deref().unwrap_or(""),
    }))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty()
        || args
            .iter()
            .any(|a| a == "--help" || a == "-h" || a == "help")
    {
        print!("{HELP}");
        return match args.is_empty() {
            true => ExitCode::FAILURE,
            false => ExitCode::SUCCESS,
        };
    }
    let done = match args[0].as_str() {
        "build" => ask(&args[1..]).and_then(|a| build(&a).map(|said| (a.json, said))),
        other => Err(format!("{other}: wasm's command is build (wasm --help)")),
    };
    match done {
        Ok((json, said)) => {
            if json {
                let mut out = std::io::stdout().lock();
                let _ = writeln!(out, "{said}");
            }
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("wasm: {err}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn build_takes_a_crate_and_where_it_goes() {
        let a = ask(&args(
            "engine --out web/engine.wasm --features loud --opt --json",
        ))
        .unwrap();
        assert_eq!(
            a,
            Ask {
                krate: "engine".into(),
                out: "web/engine.wasm".into(),
                features: Some("loud".into()),
                opt: true,
                json: true,
            }
        );
        assert!(ask(&args("engine")).is_err());
        assert!(ask(&args("--out x.wasm")).is_err());
        assert!(ask(&args("engine other --out x.wasm")).is_err());
        assert!(ask(&args("engine --out")).is_err());
        assert!(ask(&args("engine --out x.wasm --fast")).is_err());
    }

    #[test]
    fn the_most_particular_remap_is_last() {
        let flags = remaps(
            Path::new("/home/a/p"),
            Some(Path::new("/home/a/.cargo")),
            Path::new("/home/a/p/target/wasm"),
        );
        assert_eq!(
            flags,
            [
                "--remap-path-prefix=/home/a/p=/workspace",
                "--remap-path-prefix=/home/a/.cargo=/cargo",
                "--remap-path-prefix=/home/a/p/target/wasm=/target",
            ]
        );
    }
}
