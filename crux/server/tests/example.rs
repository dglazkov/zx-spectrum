//! The example, examples/dir.rs, a product's main.rs serving its built directory (crux#33): built with the
//! rest, and run on a directory of the test's own, as a build writes it, answering over HTTP as a browser asks:
//! each page with the widget and the load's tag in it, the build's brotli, a route of the app, the product's headers,
//! the widget, the telemetry's paths, and nothing outside the directory, however it is asked for.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

#[path = "../examples/dir.rs"]
#[allow(dead_code)]
mod example;

const SECRET: &str = "the secret beside dist";
const HASHED: &str = "/assets/index-BXkq3Lq_.js";

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A build's `dist/`, beside a secret: its app's page, a page of its own, a script with the build's brotli, a dotfile
/// and a symlink out.
fn build() -> (Scratch, PathBuf) {
    let top = std::env::temp_dir().join(format!("crux-example-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&top);
    let dist = top.join("dist");
    std::fs::create_dir_all(dist.join("assets")).unwrap();
    std::fs::write(top.join("outside.txt"), SECRET).unwrap();
    let page = |title: &str| {
        format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
             <body><h1>{title}</h1>{}</body></html>",
            "<p>A paragraph, long enough to be worth compressing.</p>".repeat(20)
        )
    };
    std::fs::write(dist.join("index.html"), page("App")).unwrap();
    std::fs::write(dist.join("index.html.br"), brotli(page("App").as_bytes())).unwrap();
    std::fs::write(dist.join("About Us.html"), page("About")).unwrap();
    let js = "console.log('app');\n".repeat(50);
    std::fs::write(dist.join(&HASHED[1..]), &js).unwrap();
    std::fs::write(
        dist.join(format!("{}.br", &HASHED[1..])),
        brotli(js.as_bytes()),
    )
    .unwrap();
    std::fs::write(dist.join(".env"), SECRET).unwrap();
    std::os::unix::fs::symlink("../outside.txt", dist.join("out.txt")).unwrap();
    (Scratch(top), dist)
}

/// The build's brotli of `body`, at 4, not the table's 11.
fn brotli(body: &[u8]) -> Vec<u8> {
    let mut br = Vec::new();
    {
        let mut w = brotli::CompressorWriter::new(&mut br, 4096, 4, 22);
        w.write_all(body).unwrap();
    }
    br
}

/// The example's server on a port of its own, serving `dist`.
fn start(dist: PathBuf) -> String {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let app = example::app(&dist).unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap().to_string()).unwrap();
            server::serve_on(listener, app).await.unwrap();
        });
    });
    rx.recv().unwrap()
}

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// `method path` as it is on the wire, not made over by a client: `..` and `%2e%2e` reach the server as written.
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
    let mut body = Vec::new();
    reader.read_to_end(&mut body).unwrap();
    Reply {
        status,
        headers,
        body,
    }
}

fn get(addr: &str, path: &str, accept: &str) -> Reply {
    request(addr, "GET", path, &[("Accept-Encoding", accept)], "")
}

#[test]
fn serves_a_built_directory_with_the_parts_a_product_starts_with() {
    let (_s, dist) = build();
    let addr = start(dist.clone());
    // Each page, the widget first in its <head>, and the load's tag, with its view, at its end; the app's page for
    // its routes, with the same view.
    for (path, view) in [
        ("/", "home"),
        ("/index.html", "home"),
        ("/some/route", "home"),
        ("/About%20Us.html", "about-us"),
    ] {
        let r = get(&addr, path, "");
        assert_eq!(r.status, 200, "{path}");
        let html = r.text();
        let head = &html[..html.find("</head>").unwrap()];
        assert!(
            head.starts_with(
                "<!doctype html><html><head><script src=\"/nerd-feedback.js\"></script>"
            ),
            "{path}: {head}"
        );
        assert!(
            head.ends_with(&load::tag(view)),
            "{path}: the load's tag for {view}"
        );
        assert_eq!(r.header("cross-origin-opener-policy"), Some("same-origin"));
        assert_eq!(
            r.header("cross-origin-embedder-policy"),
            Some("require-corp")
        );
    }
    // A page changed so is compressed by the table, not sent as its build's brotli of the page before, which
    // is not served as a file of its own either.
    let r = get(&addr, "/", "br");
    assert_eq!(r.header("content-encoding"), Some("br"));
    let mut page = String::new();
    brotli::Decompressor::new(&r.body[..], 4096)
        .read_to_string(&mut page)
        .unwrap();
    assert!(page.contains(&load::tag("home")));
    // The build's brotli as it is, kept a year.
    let r = get(&addr, HASHED, "br, gzip");
    assert_eq!(r.status, 200);
    assert_eq!(r.header("content-encoding"), Some("br"));
    assert_eq!(
        r.body,
        std::fs::read(dist.join(format!("{}.br", &HASHED[1..]))).unwrap()
    );
    assert_eq!(r.header("cache-control"), Some(server::IMMUTABLE));
    assert_eq!(
        r.header("cross-origin-embedder-policy"),
        Some("require-corp")
    );
    // The widget, and what the pages send.
    let r = get(&addr, "/nerd-feedback.js", "");
    assert_eq!(r.status, 200);
    assert_eq!(r.body, widget::SCRIPT);
    let r = request(
        &addr,
        "POST",
        "/nerd/event",
        &[("Content-Type", "application/json")],
        r#"{"name":"played"}"#,
    );
    assert_eq!(r.status, 204);
    // A client posting past its burst, here the test's own socket, is refused; another, as Cloud Run forwards it,
    // is not. The share fills again a post a second, so the count of those let in is not fixed by the clock.
    let post = |forwarded: &[(&str, &str)]| {
        request(
            &addr,
            "POST",
            "/nerd/event",
            forwarded,
            r#"{"name":"played"}"#,
        )
        .status
    };
    let mut let_in = 1;
    while post(&[]) == 204 {
        let_in += 1;
        assert!(let_in <= 200, "a client let in {let_in} times");
    }
    assert!(let_in >= telemetry::BURST, "{let_in}");
    assert_eq!(post(&[]), 429);
    assert_eq!(post(&[("X-Forwarded-For", "198.51.100.2, 10.0.0.1")]), 204);
    // What is not the build's, nor named, is not found.
    for path in [
        "/missing.js",
        "/../outside.txt",
        "/%2e%2e/outside.txt",
        "/assets/..%2f..%2foutside.txt",
        "/out.txt",
        "/.env",
        "/assets/index-BXkq3Lq_.js.br",
        "/index.html.br",
    ] {
        let r = get(&addr, path, "");
        assert_eq!(r.status, 404, "{path}");
        assert!(r.text().contains("Not here"), "{path}");
        assert!(!r.text().contains(SECRET), "{path}");
    }
}

#[test]
fn a_directory_that_is_not_there_is_said() {
    let err = example::app(std::path::Path::new("/nowhere/dist")).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
}
