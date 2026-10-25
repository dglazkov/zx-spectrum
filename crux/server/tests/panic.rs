//! A panic in a route a product adds beside the table (crux#42), as synth-exp's `/version.json` and zx-spectrum's
//! `/archive` are: its server, served by `server::serve` on a port of its own in a process of the test's own, which
//! this same program is, started again with `PANIC_CHILD` set, as the hook is the process's. A request whose answer
//! panics, in a route merged in, one nested, a POST, and the fallback, is answered 500, not kept; the server answers
//! on, each route that does not panic as it did; and each panic is said once on standard error, one line at severity
//! ERROR, its words first and its stack from where it panicked, with nothing of Rust's own words.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};

use axum::routing::{get, post};
use serde_json::Value;

/// A route's answer that cannot be written: the top frame of its panic's stack.
#[inline(never)]
fn version() -> &'static str {
    panic!("the version of {:?} could not be read", "/version.json")
}

fn child() {
    let product = server::Router::new()
        .route("/version.json", get(|| async { version() }))
        .route("/archive", post(|| async { version() }))
        .route("/here", get(|| async { "here" }));
    let app = server::Router::new()
        .merge(product)
        .nest(
            "/zxinfo",
            server::Router::new().route("/boom", get(|| async { version() })),
        )
        .fallback(|| async { version() });
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(server::serve(app))
        .unwrap();
}

/// The status and cache-control of what `addr` answers to `method path`.
fn ask(addr: &str, method: &str, path: &str) -> (u16, Option<String>) {
    let mut s = TcpStream::connect(addr).unwrap();
    write!(
        s,
        "{method} {path} HTTP/1.1\r\nHost: crux.test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw)
        .unwrap_or_else(|e| panic!("{method} {path}: {e}"));
    let status = raw
        .split(' ')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("{method} {path} was not answered: {raw:?}"));
    let kept = raw.lines().find_map(|l| {
        l.to_ascii_lowercase()
            .strip_prefix("cache-control:")
            .map(|v| v.trim().to_string())
    });
    (status, kept)
}

/// What the test runner asked, as nextest asks a harness of a program's own
/// (https://nexte.st/docs/design/custom-test-harnesses/): `--list` is answered with the one test, `panic`, and none
/// where only the ignored are asked for; and the check runs where no test is named, or `panic` is (`--exact` the name
/// whole, else a part of it), and not where it is skipped.
fn asked() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut list, mut ignored, mut exact) = (false, false, false);
    let (mut names, mut skips) = (vec![], vec![]);
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--list" => list = true,
            "--ignored" => ignored = true,
            "--exact" => exact = true,
            "--skip" => skips.extend(it.next().map(String::as_str)),
            "--format" | "--color" | "--test-threads" | "--logfile" | "-Z" => {
                it.next();
            }
            a if a.starts_with('-') => {}
            a => names.push(a),
        }
    }
    let is = |name: &str| {
        if exact {
            name == "panic"
        } else {
            "panic".contains(name)
        }
    };
    let run = (names.is_empty() || names.iter().any(|n| is(n))) && !skips.iter().any(|s| is(s));
    if list {
        if run && !ignored {
            println!("panic: test");
        }
        return false;
    }
    run
}

fn main() {
    if std::env::var_os("PANIC_CHILD").is_some() {
        return child();
    }
    if !asked() {
        return;
    }
    let mut child = Command::new(std::env::current_exe().unwrap())
        .env("PANIC_CHILD", "1")
        .env("PORT", "0")
        .env_remove("RUST_BACKTRACE")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    let addr = line
        .trim()
        .strip_prefix("listening on http://")
        .unwrap_or_else(|| panic!("the server did not say it listens: {line:?}"))
        .replace("0.0.0.0", "127.0.0.1");

    let panics = [
        ("GET", "/version.json"),
        ("POST", "/archive"),
        ("GET", "/zxinfo/boom"),
        ("GET", "/no/such/route"),
    ];
    for (method, path) in panics {
        assert_eq!(
            ask(&addr, method, path),
            (500, Some("no-store".into())),
            "{method} {path}"
        );
        assert_eq!(
            ask(&addr, "GET", "/here"),
            (200, None),
            "after {method} {path}"
        );
    }
    let _ = child.kill();
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    let _ = child.wait();

    let lines: Vec<&str> = stderr.lines().collect();
    assert_eq!(lines.len(), panics.len(), "not a line a panic:\n{stderr}");
    for line in lines {
        let Value::Object(fields) = serde_json::from_str(line).expect(line) else {
            panic!("{line}")
        };
        assert_eq!(fields["severity"], "ERROR", "{line}");
        let message = fields["message"].as_str().unwrap();
        let said: Vec<&str> = message.lines().collect();
        assert!(
            said[0]
                .starts_with(r#"the version of "/version.json" could not be read (panicked at "#),
            "{message}"
        );
        assert!(
            said[1].starts_with("    at panic::version (") && said[1].contains("panic.rs:"),
            "the top frame is not where it panicked: {message}"
        );
    }
    println!("panic: each answered 500 and said once, the server answering on");
}
