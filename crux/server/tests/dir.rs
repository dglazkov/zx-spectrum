//! A product's built directory, served whole (crux#33): a stand-in of a build's `dist/`, made in a
//! directory of the test's own, read by [`Dir`] and answered by the table, each file of each type,
//! compressed as the build compressed it or as the table does, kept a year where it is named after
//! its contents, the product's headers on all and by prefix, an app's page for its routes, and
//! nothing outside the directory, nor a dotfile, reached however it is asked for: each of it with the
//! files read before the table is built ([`Dir::files`]), and with them read as they are first
//! asked for ([`Dir::unread`]). And a directory slow to read, answered before it is read (crux#54).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::http::{HeaderMap, Method};
use server::header::{self, HeaderName};
use server::{Answer, Bytes, Dir, File, Table};

const HASHED: &str = "/assets/index-BXkq3Lq_.js";
const SECRET: &str = "the secret beside dist, which no request reaches";

/// Long enough, and repeated enough, that brotli and gzip each make it smaller.
fn text(word: &str) -> String {
    format!("{word} ").repeat(200)
}

fn brotli(body: &[u8], quality: u32) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut w = brotli::CompressorWriter::new(&mut out, 4096, quality, 22);
        std::io::Write::write_all(&mut w, body).unwrap();
    }
    out
}

fn gzip(body: &[u8], level: u32) -> Vec<u8> {
    let mut w = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(level));
    std::io::Write::write_all(&mut w, body).unwrap();
    w.finish().unwrap()
}

fn unbrotli(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    brotli::Decompressor::new(body, 4096)
        .read_to_end(&mut out)
        .unwrap();
    out
}

fn ungzip(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(body)
        .read_to_end(&mut out)
        .unwrap();
    out
}

/// Each extension the five products' builds hold, what it is served as, and whether it is text,
/// which the table compresses; what is compressed already (a sound, an archive, a picture) is not.
const TYPES: &[(&str, &str, bool)] = &[
    ("html", "text/html; charset=utf-8", true),
    ("htm", "text/html; charset=utf-8", true),
    ("js", "text/javascript; charset=utf-8", true),
    ("mjs", "text/javascript; charset=utf-8", true),
    ("css", "text/css; charset=utf-8", true),
    ("json", "application/json", true),
    ("map", "application/json", true),
    ("svg", "image/svg+xml", true),
    ("txt", "text/plain; charset=utf-8", true),
    ("webmanifest", "application/manifest+json", true),
    ("xml", "application/xml", true),
    ("wasm", "application/wasm", true),
    ("png", "image/png", false),
    ("jpg", "image/jpeg", false),
    ("jpeg", "image/jpeg", false),
    ("gif", "image/gif", false),
    ("webp", "image/webp", false),
    ("avif", "image/avif", false),
    ("ico", "image/x-icon", false),
    ("woff2", "font/woff2", false),
    ("woff", "font/woff", false),
    ("mp3", "audio/mpeg", false),
    ("wav", "audio/wav", false),
    ("ogg", "audio/ogg", false),
    ("mp4", "video/mp4", false),
    ("tgz", "application/gzip", false),
    ("zip", "application/zip", false),
    ("pdf", "application/pdf", false),
    ("PNG", "image/png", false),
    ("bin", "application/octet-stream", false),
];

/// A directory of the test's own, gone when it is dropped.
struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A build's `dist/`, as Vite and a hand-built page write theirs, beside a secret it must not
/// serve; with the build's own brotli and gzip of some files, and symlinks out of it and in it.
fn build() -> (Scratch, PathBuf) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let top = std::env::temp_dir().join(format!("crux-dir-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&top);
    let dist = top.join("dist");
    let write = |rel: &str, body: &[u8]| {
        let p = dist.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    };
    std::fs::create_dir_all(&top).unwrap();
    std::fs::write(top.join("outside.txt"), SECRET).unwrap();
    std::fs::write(top.join("outside"), SECRET).unwrap();
    write("index.html", text("<p>the app</p>").as_bytes());
    write("about.html", text("<p>about</p>").as_bytes());
    write("sub/index.html", text("<p>sub</p>").as_bytes());
    // Vite's: its script, with the build's brotli (at 5, not the table's 11, so that whose is sent
    // shows) and gzip beside it; its style with brotli alone.
    let js = text("console.log('app');");
    write(&HASHED[1..], js.as_bytes());
    write(&format!("{}.br", &HASHED[1..]), &brotli(js.as_bytes(), 5));
    write(&format!("{}.gz", &HASHED[1..]), &gzip(js.as_bytes(), 1));
    let css = text("body { margin: 0 }");
    write("assets/style-Ck2_x9Qa.css", css.as_bytes());
    write("assets/style-Ck2_x9Qa.css.br", &brotli(css.as_bytes(), 5));
    write("assets/logo.svg", text("<svg></svg>").as_bytes());
    write("assets/my-component.js", text("export {}").as_bytes());
    write("app-BXkq3Lq_.js", text("console.log('top');").as_bytes());
    // An archive that is a .gz with nothing beside it: a file of its own.
    write("data.tar.gz", &gzip(text("tar").as_bytes(), 9));
    for (ext, _, is_text) in TYPES {
        let body = match is_text {
            true => text(&format!("type {ext}")).into_bytes(),
            false => text(ext).into_bytes(),
        };
        write(&format!("types/x.{ext}"), &body);
    }
    write(".env", SECRET.as_bytes());
    write(".git/config", SECRET.as_bytes());
    write("sub/.hidden.js", SECRET.as_bytes());
    let link = |to: &str, at: &str| std::os::unix::fs::symlink(to, dist.join(at)).unwrap();
    link("../outside.txt", "out.txt");
    link("..", "up");
    link(
        &top.join("outside.txt").display().to_string(),
        "absolute.txt",
    );
    link("nowhere.txt", "dangling.txt");
    link("about.html", "inside.html");
    link(".", "loop");
    (Scratch(top), dist)
}

fn get(t: &Table, path: &str, accept: &str) -> Answer {
    let mut h = HeaderMap::new();
    h.insert(header::ACCEPT_ENCODING, accept.parse().unwrap());
    t.respond(&Method::GET, path, None, &h)
}

fn not_found() -> File {
    File::new("", "text/plain", Bytes::from_static(b"not here"))
}

/// The directory's table, its files read before it is built, and with them read as they are first
/// asked for: each answers as the other does.
fn tables(dir: &Dir) -> [Table; 2] {
    [
        Table::build(dir.files().unwrap(), not_found()),
        Table::build(dir.unread().unwrap(), not_found()),
    ]
}

fn read(dist: &Path, rel: &str) -> Vec<u8> {
    std::fs::read(dist.join(rel)).unwrap()
}

#[test]
fn every_file_at_its_path_typed_by_its_extension() {
    let (_s, dist) = build();
    for t in tables(&Dir::new(&dist)) {
        for (ext, want, is_text) in TYPES {
            let path = format!("/types/x.{ext}");
            let a = get(&t, &path, "br, gzip");
            assert_eq!(a.status, 200, "{path}");
            assert_eq!(a.header(header::CONTENT_TYPE), Some(*want), "{path}");
            assert_eq!(server::content_type(&path), *want, "{path}");
            match is_text {
                true => {
                    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"), "{path}");
                    assert_eq!(unbrotli(&a.body), read(&dist, &path[1..]), "{path}");
                }
                // Compressed already: sent as it is, though it would compress, and not said to vary.
                false => {
                    assert_eq!(a.header(header::CONTENT_ENCODING), None, "{path}");
                    assert_eq!(a.header(header::VARY), None, "{path}");
                    assert_eq!(a.body, read(&dist, &path[1..]), "{path}");
                }
            }
        }
        let a = get(&t, "/data.tar.gz", "br, gzip");
        assert_eq!(a.status, 200);
        assert_eq!(a.header(header::CONTENT_TYPE), Some("application/gzip"));
        assert_eq!(a.header(header::CONTENT_ENCODING), None);
        assert_eq!(a.body, read(&dist, "data.tar.gz"));
        // A directory's index.html at the directory's path too, the same entry, compressed once.
        for (dir, index) in [("/", "/index.html"), ("/sub/", "/sub/index.html")] {
            assert_eq!(get(&t, dir, "").body, read(&dist, &index[1..]));
            assert_eq!(get(&t, index, "").body, read(&dist, &index[1..]));
            assert!(Arc::ptr_eq(&t.entries[dir], &t.entries[index]), "{dir}");
        }
        assert_eq!(get(&t, "/sub", "").status, 301);
        assert_eq!(get(&t, "/sub", "").header(header::LOCATION), Some("/sub/"));
    }
}

#[test]
fn the_builds_own_compression_sent_as_it_is() {
    let (_s, dist) = build();
    let [t, late] = tables(&Dir::new(&dist));
    for t in [&t, &late] {
        let js = read(&dist, &HASHED[1..]);
        let br = read(&dist, &format!("{}.br", &HASHED[1..]));
        let gz = read(&dist, &format!("{}.gz", &HASHED[1..]));
        assert_ne!(br, brotli(&js, 11), "the build's is not the table's");
        for (accept, coding, body) in [
            ("br, gzip", Some("br"), &br),
            ("gzip, deflate", Some("gzip"), &gz),
            ("deflate", None, &js),
            ("", None, &js),
        ] {
            let a = get(t, HASHED, accept);
            assert_eq!(a.header(header::CONTENT_ENCODING), coding, "{accept}");
            assert_eq!(&a.body, body, "{accept}");
            assert_eq!(
                a.header(header::CONTENT_TYPE),
                Some(server::content_type(HASHED))
            );
        }
        // Its brotli and gzip are its, not files of their own.
        for packed in [format!("{HASHED}.br"), format!("{HASHED}.gz")] {
            assert_eq!(get(t, &packed, "br").status, 404, "{packed}");
            assert!(!t.entries.contains_key(&packed), "{packed}");
        }
        // Brotli the build's, and gzip, which it did not make, the table's.
        let style = "/assets/style-Ck2_x9Qa.css";
        let css = read(&dist, &style[1..]);
        let a = get(t, style, "br");
        assert_eq!(a.body, read(&dist, &format!("{}.br", &style[1..])));
        let a = get(t, style, "gzip");
        assert_eq!(a.header(header::CONTENT_ENCODING), Some("gzip"));
        assert_eq!(ungzip(&a.body), css);
        // A file with none beside it, compressed by the table, at its best.
        let about = read(&dist, "about.html");
        let a = get(t, "/about.html", "br");
        assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
        assert_eq!(a.body, brotli(&about, 11));
        let a = get(t, "/about.html", "gzip");
        assert_eq!(ungzip(&a.body), about);
        // Each body has a tag of its own, and is told not modified by it.
        let tagged = get(t, HASHED, "br");
        let tag = tagged.header(header::ETAG).unwrap();
        let mut h = HeaderMap::new();
        h.insert(header::ACCEPT_ENCODING, "br".parse().unwrap());
        h.insert(header::IF_NONE_MATCH, tag.parse().unwrap());
        let again = t.respond(&Method::GET, HASHED, None, &h);
        assert_eq!(again.status, 304);
        assert_ne!(get(t, HASHED, "gzip").header(header::ETAG), Some(tag));
    }
    // The same file has the same tag, read first or late.
    assert_eq!(
        get(&t, HASHED, "br").header(header::ETAG),
        get(&late, HASHED, "br").header(header::ETAG)
    );
    let js = read(&dist, &HASHED[1..]);
    let br = read(&dist, &format!("{}.br", &HASHED[1..]));
    let tag = get(&t, HASHED, "br")
        .header(header::ETAG)
        .unwrap()
        .to_string();
    let mut h = HeaderMap::new();
    h.insert(header::ACCEPT_ENCODING, "br".parse().unwrap());
    h.insert(header::IF_NONE_MATCH, tag.parse().unwrap());
    let tag = tag.as_str();
    assert_ne!(brotli(&js, 1), br, "a body of its own");
    // The build's brotli made again, its file as it was: a body of its own, and a tag of its own, so
    // that a browser that holds the old one is sent the new.
    // Listed before the change, and not asked for until after.
    let listed = Table::build(Dir::new(&dist).unread().unwrap(), not_found());
    std::fs::write(dist.join(format!("{}.br", &HASHED[1..])), brotli(&js, 1)).unwrap();
    let (rebuilt, new) = Table::build_from(Dir::new(&dist).files().unwrap(), not_found(), Some(&t));
    assert_eq!(new, 1, "only the script is new");
    let fresh = rebuilt.respond(&Method::GET, HASHED, None, &h);
    assert_eq!(fresh.status, 200);
    assert_eq!(fresh.body, brotli(&js, 1));
    assert_ne!(fresh.header(header::ETAG), Some(tag));
    // Read late, as it is when it is read: the table that listed it before the change sends the new.
    let fresh = listed.respond(&Method::GET, HASHED, None, &h);
    assert_eq!(fresh.status, 200);
    assert_eq!(fresh.body, brotli(&js, 1));
    assert_ne!(fresh.header(header::ETAG), Some(tag));
}

#[test]
fn what_is_named_after_its_contents_is_kept_a_year() {
    let (_s, dist) = build();
    for t in tables(&Dir::new(&dist)) {
        for (path, cache) in [
            (HASHED, server::IMMUTABLE),
            ("/assets/style-Ck2_x9Qa.css", server::IMMUTABLE),
            ("/assets/logo.svg", server::CACHE),
            ("/assets/my-component.js", server::CACHE),
            ("/app-BXkq3Lq_.js", server::CACHE),
            ("/index.html", server::CACHE),
            ("/", server::CACHE),
        ] {
            let a = get(&t, path, "br");
            let caches: Vec<_> = a
                .headers
                .iter()
                .filter(|(n, _)| *n == header::CACHE_CONTROL)
                .collect();
            assert_eq!(caches.len(), 1, "{path}: {caches:?}");
            assert_eq!(caches[0].1, cache, "{path}");
        }
    }
    for (path, is) in [
        ("/assets/index-BXkq3Lq_.js", true),
        ("/assets/index-D-3kR9xq.js", true),
        ("/assets/index-a1b2c3d4.js.map", true),
        ("/x/assets/chunk-0123456789abcdef0123.mjs", true),
        ("/assets/index-abcdefgh.js", false),
        ("/assets/my-component.js", false),
        ("/assets/index-BXkq3Lq.js", false),
        ("/assets/-BXkq3Lq_.js", false),
        ("/assets/index-BXkq3L!_.js", false),
        ("/app-BXkq3Lq_.js", false),
        ("/assets/", false),
    ] {
        assert_eq!(server::hashed(path), is, "{path}");
    }
}

#[test]
fn the_apps_page_for_a_path_that_names_no_file() {
    let (_s, dist) = build();
    let index = read(&dist, "index.html");
    for (on, off) in tables(&Dir::new(&dist).fallback("/index.html"))
        .into_iter()
        .zip(tables(&Dir::new(&dist)))
    {
        for path in ["/route", "/a/deep/route", "/route/", "/types"] {
            let a = get(&on, path, "");
            assert_eq!(a.status, 200, "{path}");
            assert_eq!(a.body, index, "{path}");
            assert_eq!(
                a.header(header::CONTENT_TYPE),
                Some("text/html; charset=utf-8")
            );
            assert_eq!(get(&off, path, "").status, 404, "{path}");
            assert_eq!(get(&off, path, "").body, &b"not here"[..], "{path}");
        }
        // Compressed and tagged as the page is, wherever it is asked for.
        let a = get(&on, "/route", "br");
        assert_eq!(unbrotli(&a.body), index);
        assert_eq!(
            a.header(header::ETAG),
            get(&on, "/", "br").header(header::ETAG)
        );
        // A path with an extension that names nothing is not the app's: a script not there is a 404.
        for path in [
            "/missing.js",
            "/assets/gone-BXkq3Lq_.js",
            "/route/x.png",
            "/a.b/c.d",
        ] {
            assert_eq!(get(&on, path, "").status, 404, "{path}");
        }
        // What is there is itself; a directory goes to its slash.
        assert_eq!(get(&on, "/about.html", "").body, read(&dist, "about.html"));
        assert_eq!(get(&on, "/sub", "").status, 301);
        assert_eq!(get(&on, "/sub/", "").body, read(&dist, "sub/index.html"));
    }
    // A fallback that names no file of the directory is said, not served as a 404 to every route.
    for err in [
        Dir::new(&dist).fallback("/app.html").files().unwrap_err(),
        Dir::new(&dist).fallback("/app.html").unread().unwrap_err(),
    ] {
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        assert!(err.to_string().contains("/app.html"), "{err}");
    }
    // Nor is a directory not there.
    assert!(Dir::new(dist.join("gone")).files().is_err());
    assert!(Dir::new(dist.join("gone")).unread().is_err());
}

#[test]
fn the_products_headers_on_all_and_by_prefix() {
    let (_s, dist) = build();
    let coop = HeaderName::from_static("cross-origin-opener-policy");
    let coep = HeaderName::from_static("cross-origin-embedder-policy");
    for t in tables(
        &Dir::new(&dist)
            .fallback("/index.html")
            .header("/", coop.clone(), "same-origin")
            .header("/", coep.clone(), "credentialless")
            .header("/assets/", coep.clone(), "require-corp")
            .header(
                "/sub/",
                header::REFERRER_POLICY,
                "strict-origin-when-cross-origin",
            )
            .header("/", header::CACHE_CONTROL, "no-cache"),
    ) {
        for (path, embedder, referrer, cache) in [
            ("/", "credentialless", None, "no-cache"),
            ("/route", "credentialless", None, "no-cache"),
            ("/types/x.png", "credentialless", None, "no-cache"),
            (HASHED, "require-corp", None, server::IMMUTABLE),
            (
                "/sub/",
                "credentialless",
                Some("strict-origin-when-cross-origin"),
                "no-cache",
            ),
        ] {
            let a = get(&t, path, "br");
            assert_eq!(a.status, 200, "{path}");
            assert_eq!(a.header(coop.clone()), Some("same-origin"), "{path}");
            assert_eq!(a.header(coep.clone()), Some(embedder), "{path}");
            assert_eq!(a.header(header::REFERRER_POLICY), referrer, "{path}");
            let count = |n: &HeaderName| a.headers.iter().filter(|(h, _)| h == n).count();
            assert_eq!(count(&coep), 1, "{path}");
            assert_eq!(count(&header::CACHE_CONTROL), 1, "{path}");
            assert_eq!(a.header(header::CACHE_CONTROL), Some(cache), "{path}");
        }
    }
}

#[test]
fn nothing_outside_the_directory_nor_a_dotfile() {
    let (_s, dist) = build();
    let dir = Dir::new(&dist).fallback("/index.html");
    let files = dir.files().unwrap();
    for f in &files {
        assert_ne!(f.body, SECRET.as_bytes(), "{} is the secret", f.path);
        assert!(
            !f.path.contains("/.") && !f.path.contains("up/") && !f.path.contains("loop/"),
            "{}",
            f.path
        );
    }
    let late = dir.unread().unwrap();
    for f in &late {
        assert!(
            !f.path.contains("/.") && !f.path.contains("up/") && !f.path.contains("loop/"),
            "{}",
            f.path
        );
    }
    assert_eq!(
        files.iter().map(|f| &f.path).collect::<Vec<_>>(),
        late.iter().map(|f| &f.path).collect::<Vec<_>>(),
        "the same files, read first or late"
    );
    let index = read(&dist, "index.html");
    for (on, off) in tables(&dir).into_iter().zip(tables(&Dir::new(&dist))) {
        // Each, and whether the app's page answers it, with that on: a path none of whose names
        // begins with a dot, and whose last has none, is one of the app's routes, and gets its page.
        for (path, app) in [
            ("/../outside.txt", false),
            ("/../outside", false),
            ("/assets/../../outside.txt", false),
            ("/%2e%2e/outside.txt", false),
            ("/%2E%2E/outside", false),
            ("/%2e%2e%2foutside.txt", false),
            ("/assets/..%2f..%2foutside", false),
            ("/..", false),
            ("/./index.html", false),
            ("/out.txt", false),
            ("/absolute.txt", false),
            ("/dangling.txt", false),
            ("/up/outside.txt", false),
            ("/up/outside", true),
            ("/up/dist/index.html", false),
            ("/.env", false),
            ("/.git/config", false),
            ("/.git", false),
            ("/%2egit/config", false),
            ("/sub/.hidden.js", false),
            ("/loop/index.html", false),
        ] {
            let a = get(&off, path, "");
            assert_eq!(a.status, 404, "{path}");
            assert!(a.body == b"not here"[..], "{path}");
            let a = get(&on, path, "");
            match app {
                true => assert!(a.status == 200 && a.body == index, "{path}"),
                false => assert!(a.status == 404 && a.body == b"not here"[..], "{path}"),
            }
        }
        // A symlink that stays inside is served, as the file it names.
        assert_eq!(get(&on, "/inside.html", "").body, read(&dist, "about.html"));
    }
}

/// What the test's reader read before the server listened, what it has read since, whether it
/// holds the slow files, and whether it lets them be read.
#[derive(Default)]
struct Reads {
    early: Vec<PathBuf>,
    done: Vec<PathBuf>,
    listening: bool,
    open: bool,
}

/// A directory whose files are slow to read (crux#54): once the server listens, the test's reader
/// holds every file but one small page until the test lets them go; before, it holds none, and
/// says what was read, so that a server that reads its directory before it listens is caught
/// rather than kept waiting. The server answers the page with nothing read before it listened and
/// nothing but the page read since, and once the rest are let go, reads them all, once each, with
/// no request asking.
#[test]
fn a_directory_slow_to_read_is_answered_before_it_is_read() {
    use std::io::{BufRead, BufReader, Write};
    use std::sync::{Condvar, Mutex};

    let (_s, dist) = build();
    let small = dist.join("about.html").canonicalize().unwrap();
    let reads = Arc::new((Mutex::new(Reads::default()), Condvar::new()));
    let reader = {
        let (reads, small) = (reads.clone(), small.clone());
        move |p: &Path| {
            let (lock, cv) = &*reads;
            let mut r = lock.lock().unwrap();
            if !r.listening {
                r.early.push(p.to_path_buf());
                return std::fs::read(p);
            }
            if *p != small {
                r = cv.wait_while(r, |r| !r.open).unwrap();
            }
            r.done.push(p.to_path_buf());
            cv.notify_all();
            std::fs::read(p)
        }
    };
    let dir = Dir::new(&dist).fallback("/index.html").reader(reader);
    let site = Arc::new(server::Site::new(Table::build(
        dir.unread().unwrap(),
        not_found(),
    )));
    reads.0.lock().unwrap().listening = true;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            listener.set_nonblocking(true).unwrap();
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            server::serve_on(listener, server::router(site))
                .await
                .unwrap();
        });
    });
    let ask = |path: &str| -> (String, Vec<u8>) {
        let mut s = std::net::TcpStream::connect(addr).unwrap();
        let req = format!("GET {path} HTTP/1.1\r\nHost: crux.test\r\nConnection: close\r\n\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut reader = BufReader::new(s);
        let mut status = String::new();
        reader.read_line(&mut status).unwrap();
        let mut length = 0;
        loop {
            let mut l = String::new();
            reader.read_line(&mut l).unwrap();
            if l.trim_end().is_empty() {
                break;
            }
            if let Some((n, v)) = l.split_once(':') {
                if n.eq_ignore_ascii_case("content-length") {
                    length = v.trim().parse().unwrap();
                }
            }
        }
        let mut body = vec![0; length];
        std::io::Read::read_exact(&mut reader, &mut body).unwrap();
        (status.trim_end().to_string(), body)
    };
    let (status, body) = ask("/about.html");
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(body, read(&dist, "about.html"));
    let (lock, cv) = &*reads;
    let early = lock.lock().unwrap().early.clone();
    assert!(early.is_empty(), "read before it listened: {early:?}");
    let before: Vec<PathBuf> = lock.lock().unwrap().done.clone();
    assert!(
        !before.is_empty() && before.iter().all(|p| *p == small),
        "the page is answered with nothing else read: {before:?}"
    );
    lock.lock().unwrap().open = true;
    cv.notify_all();
    // Let go, a file asked for is read as any.
    let (status, body) = ask("/route");
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(body, read(&dist, "index.html"));
    // And the rest by the pass, with no request asking: each file listed once, a directory's
    // index.html read once for both its paths, with its build's .br and .gz.
    let mut want: HashMap<PathBuf, usize> = HashMap::new();
    for f in dir
        .unread()
        .unwrap()
        .iter()
        .filter(|f| !f.path.ends_with('/'))
    {
        let p = dist.join(&f.path[1..]).canonicalize().unwrap();
        for s in ["", ".br", ".gz"] {
            let p = PathBuf::from(format!("{}{s}", p.display()));
            if p.is_file() {
                *want.entry(p).or_default() += 1;
            }
        }
    }
    let count = |done: &[PathBuf]| {
        let mut n: HashMap<PathBuf, usize> = HashMap::new();
        for p in done {
            *n.entry(p.clone()).or_default() += 1;
        }
        n
    };
    let all = cv
        .wait_while(lock.lock().unwrap(), |r| {
            let n = count(&r.done);
            !want.iter().all(|(p, w)| n.get(p).is_some_and(|n| n >= w))
        })
        .unwrap();
    assert_eq!(count(&all.done), want, "each file read once for each entry");
}

/// What `Dir` guards still holds for a file read late: one that became a symlink out of the
/// directory after it was listed is not read, and is answered 503, not with what it leads to.
#[test]
fn a_file_read_late_is_read_only_inside_the_directory() {
    let (_s, dist) = build();
    let t = Table::build(Dir::new(&dist).unread().unwrap(), not_found());
    std::fs::remove_file(dist.join("about.html")).unwrap();
    std::os::unix::fs::symlink("../outside.txt", dist.join("about.html")).unwrap();
    let a = get(&t, "/about.html", "");
    assert_eq!(a.status, 503);
    assert_ne!(a.body, SECRET.as_bytes());
    // Its build's brotli too.
    let br = format!("{}.br", &HASHED[1..]);
    std::fs::remove_file(dist.join(&br)).unwrap();
    std::os::unix::fs::symlink("../../outside.txt", dist.join(&br)).unwrap();
    assert_eq!(get(&t, HASHED, "br").status, 503);
    // Put back, it is read when next asked for.
    std::fs::remove_file(dist.join("about.html")).unwrap();
    std::fs::write(dist.join("about.html"), "back").unwrap();
    assert_eq!(get(&t, "/about.html", "").body, &b"back"[..]);
}

/// What the product makes of each file once read, read first or late: a page with a tag in it,
/// compressed and tagged as the page it made, at both paths of a directory's index.html.
#[test]
fn each_file_made_what_the_product_makes_it() {
    let (_s, dist) = build();
    let dir = Dir::new(&dist).map(|f| match f.content_type.starts_with("text/html") {
        true => {
            let html = String::from_utf8_lossy(&f.body).replacen("<p>", "<p>made ", 1);
            f.with_body(html)
                .with(header::REFERRER_POLICY, "no-referrer")
        }
        false => f,
    });
    for t in tables(&dir) {
        for (path, file) in [
            ("/", "index.html"),
            ("/index.html", "index.html"),
            ("/sub/", "sub/index.html"),
        ] {
            let want = String::from_utf8(read(&dist, file))
                .unwrap()
                .replacen("<p>", "<p>made ", 1);
            let a = get(&t, path, "br");
            assert_eq!(unbrotli(&a.body), want.as_bytes(), "{path}");
            assert_eq!(a.header(header::REFERRER_POLICY), Some("no-referrer"));
        }
        assert!(Arc::ptr_eq(&t.entries["/"], &t.entries["/index.html"]));
        assert_eq!(get(&t, HASHED, "").body, read(&dist, &HASHED[1..]));
    }
}
