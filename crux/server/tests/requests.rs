//! Each request, off Cloud Run, printed as Cloud Run logs it (crux#76): a server served by `server::serve` on a port of
//! its own, in a process of the test's own, which this same program is, started again with `REQUESTS_CHILD` set, as
//! `K_SERVICE` is read as it starts. Where `K_SERVICE` is unset, each request is one line on standard error, its
//! method, its path without its query, its status, its latency as Cloud Logging writes it, and its severity, ERROR for
//! a 5xx, WARNING for a 4xx and INFO for the rest, with nothing of who asked; where it is set, as Cloud Run sets it,
//! none is.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;

use axum::http::StatusCode;
use axum::routing::{get, post};
use serde_json::{json, Value};

/// How long `/slow` takes to answer, and so the least its latency may be.
const SLOW: Duration = Duration::from_millis(50);

async fn boom() -> &'static str {
    panic!("boom")
}

fn child() {
    let app = server::Router::new()
        .route("/here", get(|| async { "here" }))
        .route("/made", post(|| async { StatusCode::CREATED }))
        .route(
            "/slow",
            get(|| async {
                tokio::time::sleep(SLOW).await;
                "slow"
            }),
        )
        .route("/refused", get(|| async { StatusCode::FORBIDDEN }))
        .route("/boom", get(boom))
        .route("/broken", get(|| async { StatusCode::SERVICE_UNAVAILABLE }));
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(server::serve(app))
        .unwrap();
}

/// The status `addr` answers `method target` with, asked as a browser asks, its address, user agent and referer
/// all said.
fn ask(addr: &str, method: &str, target: &str) -> u16 {
    let mut s = TcpStream::connect(addr).unwrap();
    write!(
        s,
        "{method} {target} HTTP/1.1\r\nHost: crux.test\r\nUser-Agent: Mozilla/5.0 (crux-test-agent)\r\n\
         Referer: https://crux-test-referer.example/\r\nX-Forwarded-For: 203.0.113.9\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw)
        .unwrap_or_else(|e| panic!("{method} {target}: {e}"));
    raw.split(' ')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("{method} {target} was not answered: {raw:?}"))
}

/// The lines the server printed on standard error, but for its panic's, once it was asked each of `asks`, run with
/// `K_SERVICE` set to `service`, or unset where it is none.
fn served(service: Option<&str>, asks: &[(&str, &str, u16)]) -> Vec<String> {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .env("REQUESTS_CHILD", "1")
        .env("PORT", "0")
        .env_remove("K_SERVICE")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(service) = service {
        command.env("K_SERVICE", service);
    }
    let mut child = command.spawn().unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    let addr = line
        .trim()
        .strip_prefix("listening on http://")
        .unwrap_or_else(|| panic!("the server did not say it listens: {line:?}"))
        .replace("0.0.0.0", "127.0.0.1");
    for &(method, target, status) in asks {
        assert_eq!(ask(&addr, method, target), status, "{method} {target}");
    }
    // Each line is printed before its answer is sent: all are there once the last is answered.
    let _ = child.kill();
    let mut said = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut said)
        .unwrap();
    let _ = child.wait();
    said.lines()
        .filter(|l| !l.contains("\"message\":\"boom"))
        .map(str::to_string)
        .collect()
}

/// What the test runner asked, as nextest asks a harness of a program's own
/// (https://nexte.st/docs/design/custom-test-harnesses/): `--list` is answered with the one test, `requests`, and
/// none where only the ignored are asked for; and the check runs where no test is named, or `requests` is (`--exact`
/// the name whole, else a part of it), and not where it is skipped.
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
            name == "requests"
        } else {
            "requests".contains(name)
        }
    };
    let run = (names.is_empty() || names.iter().any(|n| is(n))) && !skips.iter().any(|s| is(s));
    if list {
        if run && !ignored {
            println!("requests: test");
        }
        return false;
    }
    run
}

fn main() {
    if std::env::var_os("REQUESTS_CHILD").is_some() {
        return child();
    }
    if !asked() {
        return;
    }
    let asks = [
        ("GET", "/here?token=crux-test-secret&q=1", 200, "INFO"),
        ("POST", "/made", 201, "INFO"),
        ("HEAD", "/here", 200, "INFO"),
        ("GET", "/slow", 200, "INFO"),
        ("GET", "/refused", 403, "WARNING"),
        ("GET", "/no/such/route?x=1", 404, "WARNING"),
        ("POST", "/here", 405, "WARNING"),
        ("GET", "/broken", 503, "ERROR"),
        ("GET", "/boom", 500, "ERROR"),
    ];
    let statuses: Vec<_> = asks.iter().map(|&(m, t, s, _)| (m, t, s)).collect();

    let lines = served(None, &statuses);
    assert_eq!(
        lines.len(),
        asks.len(),
        "not a line a request:\n{}",
        lines.join("\n")
    );
    for (line, &(method, target, status, severity)) in lines.iter().zip(&asks) {
        let path = target.split('?').next().unwrap();
        let mut said: Value = serde_json::from_str(line).expect(line);
        let latency = said["httpRequest"]["latency"]
            .as_str()
            .unwrap_or_else(|| panic!("no latency: {line}"))
            .to_string();
        said["httpRequest"]["latency"] = json!("");
        assert_eq!(
            said,
            json!({
                "httpRequest": {
                    "requestMethod": method,
                    "requestUrl": path,
                    "status": status,
                    "latency": "",
                },
                "severity": severity,
            }),
            "{line}"
        );
        let secs = latency
            .strip_suffix('s')
            .unwrap_or_else(|| panic!("{latency} is not in seconds: {line}"));
        let digits = secs.split_once('.').map_or(0, |(_, f)| f.len());
        assert!(
            [0, 3, 6, 9].contains(&digits) && secs.parse::<f64>().is_ok(),
            "{latency} is not as Cloud Logging writes a duration: {line}"
        );
        if path == "/slow" {
            assert!(
                secs.parse::<f64>().unwrap() >= SLOW.as_secs_f64(),
                "{latency} is less than /slow took: {line}"
            );
        }
        for nothing in [
            "crux-test-secret",
            "127.0.0.1",
            "203.0.113.9",
            "crux-test-agent",
            "crux-test-referer",
        ] {
            assert!(!line.contains(nothing), "{nothing} is in {line}");
        }
    }

    let on_cloud_run = served(Some("crux-test"), &statuses);
    assert!(
        on_cloud_run.is_empty(),
        "with K_SERVICE set, as on Cloud Run, a request was printed:\n{}",
        on_cloud_run.join("\n")
    );
    println!("requests: each a line off Cloud Run, as Cloud Run logs it, and none on it");
}
