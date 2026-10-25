//! The copy against the widget `nerd telemetry widget` prints, and the part `server` answering
//! `/nerd-feedback.js` with it, compressed, over HTTP.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use super::*;

#[test]
fn the_copy_is_nerds() {
    let out = std::process::Command::new("nerd")
        .args(["telemetry", "widget"])
        .output()
        .expect("nerd, to print its widget: is it installed?");
    assert!(
        out.status.success(),
        "nerd telemetry widget: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        String::from_utf8_lossy(&out.stdout).contains("window.nerdFeedback"),
        "nerd telemetry widget printed no widget"
    );
    assert!(
        SCRIPT == out.stdout.as_slice(),
        "nerd-feedback.js is not the widget nerd prints: write it out again with \
         `nerd telemetry widget > nerd-feedback.js` in the part's directory"
    );
}

/// A server of the test's own, on a port of its own, its table the widget and nothing else.
fn server() -> String {
    let not_found = File::new("", "text/plain", Bytes::from_static(b"not here"));
    let site = Arc::new(server::Site::new(server::Table::build(
        vec![file()],
        not_found,
    )));
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap().to_string()).unwrap();
            server::serve_on(listener, server::router(site))
                .await
                .unwrap();
        });
    });
    rx.recv().unwrap()
}

/// The status, the headers (named in lower case) and the body of a GET of `path`.
fn get(addr: &str, path: &str, accept: &str) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let mut s = TcpStream::connect(addr).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    write!(
        s,
        "GET {path} HTTP/1.1\r\nHost: crux.test\r\nAccept-Encoding: {accept}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut all = Vec::new();
    s.read_to_end(&mut all).unwrap();
    let end = all.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8(all[..end].to_vec()).unwrap();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap().split(' ').nth(1).unwrap();
    let headers = lines
        .map(|l| l.split_once(':').unwrap())
        .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    (status.parse().unwrap(), headers, all[end + 4..].to_vec())
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.as_str())
}

#[test]
fn the_server_serves_it_compressed() {
    let addr = server();
    for (accept, encoding) in [
        ("br, gzip", Some("br")),
        ("gzip", Some("gzip")),
        ("identity", None),
    ] {
        let (status, headers, body) = get(&addr, PATH, accept);
        assert_eq!(status, 200, "{accept}");
        assert_eq!(header(&headers, "content-type"), Some(CONTENT_TYPE));
        assert_eq!(header(&headers, "content-encoding"), encoding, "{accept}");
        let script = match encoding {
            Some("br") => {
                let mut out = Vec::new();
                brotli::BrotliDecompress(&mut body.as_slice(), &mut out).unwrap();
                out
            }
            Some("gzip") => {
                let mut out = Vec::new();
                flate2::read::GzDecoder::new(body.as_slice())
                    .read_to_end(&mut out)
                    .unwrap();
                out
            }
            _ => body.clone(),
        };
        if encoding.is_some() {
            assert!(
                body.len() < SCRIPT.len() / 2,
                "{accept}: {} bytes of {}",
                body.len(),
                SCRIPT.len()
            );
        }
        assert!(script == SCRIPT, "{accept}: the widget, whole");
    }
}
