//! The product's headers on every answer its router makes (crux#44): a server of the test's own, its table a page,
//! a sound, an asset of a built directory and the widget, telemetry's routes merged in and [`server::headers`] over
//! it all, asked over HTTP for each kind of answer there is: a file, a 304, a range, a redirect, the widget,
//! `/nerd/event` answered 204, 400, 413 and 429, a 404, a 405 of the table's and of telemetry's, and the 500 of a
//! route of the product's that panics.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use server::header::HeaderName;
use server::{Bytes, Dir, File, Site, Table};

const HTML: &str = "text/html; charset=utf-8";
const HASHED: &str = "/assets/index-BXkq3Lq_.js";

/// What the product names once: COOP and COEP, and a Referrer-Policy, which a file with its own keeps.
fn named() -> Vec<(HeaderName, &'static str)> {
    vec![
        (
            HeaderName::from_static("cross-origin-opener-policy"),
            "same-origin",
        ),
        (
            HeaderName::from_static("cross-origin-embedder-policy"),
            "require-corp",
        ),
        (server::header::REFERRER_POLICY, "no-referrer"),
    ]
}

/// A route of the product's that panics.
async fn panics() -> &'static str {
    panic!("the product's route panicked")
}

struct Scratch(std::path::PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The server, on a port of its own; and the directory its asset was read from, removed when it is dropped.
fn start() -> (String, Scratch) {
    let dist = std::env::temp_dir().join(format!("crux-headers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dist);
    std::fs::create_dir_all(dist.join("assets")).unwrap();
    std::fs::write(dist.join(&HASHED[1..]), "console.log('app');\n".repeat(50)).unwrap();
    let mut files = Dir::new(&dist).files().unwrap();
    files.push(File::new(
        "/about/",
        HTML,
        Bytes::from("<h1>About</h1>".repeat(20)),
    ));
    files.push(File::new(
        "/sound.mp3",
        "audio/mpeg",
        Bytes::from(vec![7u8; 1000]),
    ));
    files.push(
        File::new("/own.txt", "text/plain", Bytes::from_static(b"own"))
            .with(server::header::REFERRER_POLICY, "origin"),
    );
    files.push(widget::file());
    let not_found = File::new("", HTML, Bytes::from_static(b"<h1>Not here</h1>"));
    let site = Arc::new(Site::new(Table::build(files, not_found)));
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let app = server::router(site)
                .merge(telemetry::routes())
                .route("/panics", axum::routing::get(panics));
            let app = server::headers(app, named());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap().to_string()).unwrap();
            server::serve_on(listener, app).await.unwrap();
        });
    });
    (rx.recv().unwrap(), Scratch(dist))
}

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

fn request(addr: &str, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Reply {
    let mut s = TcpStream::connect(addr).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: crux.test\r\nConnection: close\r\n");
    for (n, v) in headers {
        req.push_str(&format!("{n}: {v}\r\n"));
    }
    req.push_str(&format!("Content-Length: {}\r\n\r\n{body}", body.len()));
    s.write_all(req.as_bytes()).unwrap();
    let mut reader = BufReader::new(s);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let status = line.split(' ').nth(1).unwrap().parse().unwrap();
    let mut headers = Vec::new();
    loop {
        let mut l = String::new();
        reader.read_line(&mut l).unwrap();
        let l = l.trim_end();
        if l.is_empty() {
            break;
        }
        let (n, v) = l.split_once(':').unwrap();
        headers.push((n.trim().to_string(), v.trim().to_string()));
    }
    let _ = reader.read_to_end(&mut Vec::new());
    Reply { status, headers }
}

/// A post to `/nerd/event` from `client`, as Cloud Run forwards it.
fn event(addr: &str, client: &str, body: &str) -> Reply {
    request(
        addr,
        "POST",
        "/nerd/event",
        &[
            ("Content-Type", "application/json"),
            ("X-Forwarded-For", client),
        ],
        body,
    )
}

#[test]
fn every_answer_has_the_headers_the_product_names() {
    let (addr, _dist) = start();
    let get = |path: &str, headers: &[(&str, &str)]| request(&addr, "GET", path, headers, "");
    let file = get("/about/", &[]);
    let etag = file.header("etag").unwrap().to_string();
    let mut answers = vec![
        ("a file", 200, file),
        (
            "a file asked for again",
            304,
            get("/about/", &[("If-None-Match", &etag)]),
        ),
        (
            "a range",
            206,
            get("/sound.mp3", &[("Range", "bytes=0-99")]),
        ),
        (
            "a range not there",
            416,
            get("/sound.mp3", &[("Range", "bytes=5000-")]),
        ),
        ("a redirect", 301, get("/about", &[])),
        ("the widget", 200, get(widget::PATH, &[])),
        ("a 404", 404, get("/missing.js", &[])),
        ("a route that panics", 500, get("/panics", &[])),
        (
            "the table's 405",
            405,
            request(&addr, "DELETE", "/about/", &[], ""),
        ),
        ("telemetry's 405", 405, get("/nerd/event", &[])),
        (
            "an event",
            204,
            event(&addr, "198.51.100.1", r#"{"name":"played"}"#),
        ),
        (
            "an event not one",
            400,
            event(&addr, "198.51.100.2", "not json"),
        ),
        (
            "an event too large",
            413,
            event(&addr, "198.51.100.3", &"x".repeat(telemetry::LIMIT + 1)),
        ),
    ];
    // A client past its burst; the share fills again a post a second, so how many are let in is not fixed by the clock.
    let mut posts = 0;
    let limited = loop {
        let r = event(&addr, "198.51.100.4", r#"{"name":"played"}"#);
        if r.status != 204 {
            break r;
        }
        posts += 1;
        assert!(posts <= 200, "a client let in {posts} times");
    };
    answers.push(("an event past the burst", 429, limited));
    // A file of the built directory, and one with a header of the same name, which keeps its own.
    answers.push(("a file of the directory", 200, get(HASHED, &[])));
    let own = get("/own.txt", &[]);
    assert_eq!(
        own.header("referrer-policy"),
        Some("origin"),
        "a file's own"
    );
    // Every answer that lacks one is said, not only the first, so that what a change leaves out is seen whole.
    let mut missing = Vec::new();
    for (what, status, r) in &answers {
        assert_eq!(r.status, *status, "{what}");
        for (name, value) in named() {
            if r.header(name.as_str()) != Some(value) {
                missing.push(format!(
                    "{what} ({status}): {name} {:?}",
                    r.header(name.as_str())
                ));
            }
        }
    }
    if own.header("cross-origin-opener-policy") != Some("same-origin") {
        missing.push("a file with its own: cross-origin-opener-policy".into());
    }
    assert!(missing.is_empty(), "\n{}", missing.join("\n"));
}

#[test]
#[should_panic(expected = "referrer-policy")]
fn a_value_no_header_can_have_is_said_as_the_product_starts() {
    let site = Arc::new(Site::new(Table::build(
        Vec::new(),
        File::new("", HTML, Bytes::new()),
    )));
    let _ = server::headers(
        server::router(site),
        [(server::header::REFERRER_POLICY, "no\nreferrer")],
    );
}
