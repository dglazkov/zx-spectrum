//! Starts the server on a stand-in table, on a port of its own, and reads a file of each kind from
//! it over HTTP, as a browser would: as blog's `serve` test does its own; and each in part, as a
//! sound or video is sought (crux#24).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use server::{Bytes, File, Site};

const HTML: &str = "text/html; charset=utf-8";

fn page(title: &str) -> String {
    format!(
        "<!doctype html><title>{title}</title><h1>{title}</h1>{}",
        "<p>A paragraph of the page, long enough to be worth compressing.</p>".repeat(20)
    )
}

fn files(home: &str) -> Vec<File> {
    let text = |path: &str, t: &str, body: String| File::new(path, t, Bytes::from(body));
    vec![
        text("/", HTML, page(home)).with(
            server::header::CONTENT_SECURITY_POLICY,
            "default-src 'self'",
        ),
        text("/about/", HTML, page("About")),
        text("/style.css", "text/css", "body { margin: 0 }\n".repeat(30)),
        text(
            "/app.js",
            "text/javascript",
            "console.log('hi');\n".repeat(30),
        ),
        text("/data.json", "application/json", "[1, 2, 3]".repeat(30)),
        text(
            "/logo.svg",
            "image/svg+xml",
            format!("<svg>{}</svg>", "<g/>".repeat(30)),
        ),
        File::new("/photo.png", "image/png", Bytes::from(vec![0x89u8; 2000])),
        File::later("/sound.mp3", "audio/mpeg", "sound", "1"),
    ]
}

fn not_found() -> File {
    File::new("", HTML, Bytes::from(page("Not here")))
}

/// A server of the test's own, on a port of its own, answering from a stand-in table; the site it
/// serves, to change while it serves; and how many times it read the file given later.
fn server() -> (String, Arc<Site>, Arc<std::sync::atomic::AtomicUsize>) {
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = reads.clone();
    let read: server::Read = Arc::new(move |key| {
        counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(async move {
            assert_eq!(key, "sound");
            Ok(Bytes::from_static(b"ID3 the sound"))
        })
    });
    let site = Arc::new(Site::new(server::Table::build(files("Home"), not_found())).reading(read));
    let (tx, rx) = std::sync::mpsc::channel();
    let served = site.clone();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap().to_string()).unwrap();
            server::serve_on(listener, server::router(served))
                .await
                .unwrap();
        });
    });
    (rx.recv().unwrap(), site, reads)
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
        String::from_utf8(self.body.clone()).unwrap()
    }
}

fn request(addr: &str, method: &str, path: &str, headers: &[(&str, &str)]) -> Reply {
    let mut s = TcpStream::connect(addr).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: crux.test\r\nConnection: close\r\n");
    for (n, v) in headers {
        req.push_str(&format!("{n}: {v}\r\n"));
    }
    req.push_str("\r\n");
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
    let reply = Reply {
        status,
        headers,
        body,
    };
    if method == "GET" {
        if let Some(len) = reply.header("content-length") {
            assert_eq!(
                len.parse::<usize>().unwrap(),
                reply.body.len(),
                "{path}: the whole body"
            );
        }
    }
    reply
}

fn get(addr: &str, path: &str, accept: &str) -> Reply {
    request(addr, "GET", path, &[("Accept-Encoding", accept)])
}

fn unpacked(r: &Reply) -> Vec<u8> {
    let mut out = Vec::new();
    match r.header("content-encoding") {
        Some("br") => {
            brotli::Decompressor::new(&r.body[..], 4096)
                .read_to_end(&mut out)
                .unwrap();
        }
        Some("gzip") => {
            flate2::read::GzDecoder::new(&r.body[..])
                .read_to_end(&mut out)
                .unwrap();
        }
        None => out = r.body.clone(),
        Some(other) => panic!("sent in {other}"),
    }
    out
}

#[test]
fn each_kind_of_file() {
    let (addr, _, reads) = server();
    for (path, kind, compressed) in [
        ("/", "text/html", true),
        ("/about/", "text/html", true),
        ("/style.css", "text/css", true),
        ("/app.js", "text/javascript", true),
        ("/data.json", "application/json", true),
        ("/logo.svg", "image/svg+xml", true),
        ("/photo.png", "image/png", false),
        ("/sound.mp3", "audio/mpeg", false),
    ] {
        let plain = get(&addr, path, "");
        assert_eq!(plain.status, 200, "{path}");
        assert_eq!(plain.header("content-encoding"), None, "{path}");
        assert!(
            plain.header("content-type").unwrap().starts_with(kind),
            "{path}"
        );
        assert_eq!(
            plain.header("x-content-type-options"),
            Some("nosniff"),
            "{path}"
        );
        assert!(plain.header("etag").is_some(), "{path}");
        // Only a file never compressed says it is sent in part, though each is (crux#25).
        let says = (!compressed).then_some("bytes");
        assert_eq!(plain.header("accept-ranges"), says, "{path}");
        // In part, as Chrome seeks a sound: the bytes as they are, whatever it takes.
        let len = plain.body.len();
        for (range, first, last) in [("bytes=0-", 0, len - 1), ("bytes=2-6", 2, 6)] {
            let r = request(
                &addr,
                "GET",
                path,
                &[("Accept-Encoding", "identity;q=1, *;q=0"), ("Range", range)],
            );
            let r2 = request(
                &addr,
                "GET",
                path,
                &[("Accept-Encoding", "gzip, deflate, br"), ("Range", range)],
            );
            for r in [r, r2] {
                assert_eq!(r.status, 206, "{path} {range}");
                assert_eq!(r.header("content-encoding"), None, "{path} {range}");
                assert_eq!(r.body, plain.body[first..=last], "{path} {range}");
                assert_eq!(
                    r.header("content-range"),
                    Some(format!("bytes {first}-{last}/{len}").as_str()),
                    "{path} {range}"
                );
            }
        }
        let r = request(&addr, "GET", path, &[("Range", &format!("bytes={len}-"))]);
        assert_eq!(r.status, 416, "{path}");
        assert_eq!(
            r.header("content-range"),
            Some(format!("bytes */{len}").as_str())
        );
        for (accept, coding) in [("gzip, deflate, br", "br"), ("gzip", "gzip")] {
            let r = get(&addr, path, accept);
            assert_eq!(r.status, 200, "{path} {accept}");
            let want = compressed.then_some(coding);
            assert_eq!(r.header("content-encoding"), want, "{path} {accept}");
            assert_eq!(unpacked(&r), plain.body, "{path} {accept}");
            if compressed {
                assert!(r.body.len() < plain.body.len(), "{path} {accept}");
                assert_eq!(r.header("vary"), Some("Accept-Encoding"), "{path}");
            }
            // Asked for again with its tag, it is not sent again.
            let tag = r.header("etag").unwrap();
            let again = request(
                &addr,
                "GET",
                path,
                &[("Accept-Encoding", accept), ("If-None-Match", tag)],
            );
            assert_eq!(again.status, 304, "{path} {accept}");
            assert!(again.body.is_empty());
        }
    }
    assert_eq!(get(&addr, "/sound.mp3", "").text(), "ID3 the sound");
    assert_eq!(
        reads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "read once"
    );
    let home = get(&addr, "/", "");
    assert!(home.text().contains("<h1>Home</h1>"));
    assert_eq!(
        home.header("content-security-policy"),
        Some("default-src 'self'")
    );
    assert_eq!(home.header("cache-control"), Some(server::CACHE));
}

#[test]
fn not_found_redirects_and_methods() {
    let (addr, _, _) = server();
    for path in ["/nowhere/", "/nowhere", "/photo.png/x", "//"] {
        let r = get(&addr, path, "br");
        assert_eq!(r.status, 404, "{path}");
        assert!(
            String::from_utf8(unpacked(&r))
                .unwrap()
                .contains("<h1>Not here</h1>"),
            "{path}"
        );
    }
    for (from, to) in [
        ("/about", "/about/"),
        ("/about?x=1", "/about/?x=1"),
        ("/app.js/", "/app.js"),
    ] {
        let r = get(&addr, from, "");
        assert_eq!(r.status, 301, "{from}");
        assert_eq!(r.header("location"), Some(to), "{from}");
    }
    let r = request(&addr, "HEAD", "/", &[("Accept-Encoding", "br")]);
    assert_eq!(r.status, 200);
    assert!(r.body.is_empty());
    assert_eq!(r.header("content-encoding"), Some("br"));
    let r = request(&addr, "POST", "/", &[("Content-Length", "0")]);
    assert_eq!(r.status, 405);
    assert_eq!(r.header("allow"), Some("GET, HEAD"));
}

#[test]
fn swapped_whole_while_it_serves() {
    let (addr, site, _) = server();
    let before = get(&addr, "/", "br");
    let style = get(&addr, "/style.css", "br");
    let mut changed = files("Home, again");
    changed.retain(|f| f.path != "/about/");
    assert_eq!(
        site.update(changed, not_found()),
        1,
        "only the home page is new"
    );
    let after = get(&addr, "/", "br");
    assert!(String::from_utf8(unpacked(&after))
        .unwrap()
        .contains("<h1>Home, again</h1>"));
    assert_ne!(after.header("etag"), before.header("etag"));
    let r = request(
        &addr,
        "GET",
        "/",
        &[
            ("Accept-Encoding", "br"),
            ("If-None-Match", before.header("etag").unwrap()),
        ],
    );
    assert_eq!(r.status, 200, "the old tag is not the new page's");
    let r = request(
        &addr,
        "GET",
        "/style.css",
        &[
            ("Accept-Encoding", "br"),
            ("If-None-Match", style.header("etag").unwrap()),
        ],
    );
    assert_eq!(r.status, 304, "what did not change keeps its tag");
    assert_eq!(get(&addr, "/about/", "").status, 404);
}
