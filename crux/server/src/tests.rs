//! The table's own tests, lifted from blog's with it: the encodings chosen, a tag asked for again,
//! the compression settings, a file not text sent as it is, and what a new table keeps of the old;
//! and a range of a file, sent as it is (crux#24).

use super::*;

const HTML: &str = "text/html; charset=utf-8";
/// Long enough, and repeated enough, that brotli and gzip each make it smaller.
const HOME: &str = "<p>home home home home home home home home home home home home home home</p>";

fn file(path: &str, content_type: &str, body: &str) -> File {
    File::new(path, content_type, Bytes::copy_from_slice(body.as_bytes()))
}

fn files() -> Vec<File> {
    vec![
        file("/", HTML, HOME),
        file("/2025/01/20/a/", HTML, &"<p>a post, a post</p>".repeat(8)),
        file("/2025/01/20/a/my photo.png", "image/png", &"png".repeat(40)),
        file(
            "/feed/",
            "application/atom+xml; charset=utf-8",
            &"<feed></feed>".repeat(8),
        ),
    ]
}

fn not_found() -> File {
    file("", HTML, &"<p>not here</p>".repeat(8))
}

fn table() -> Table {
    Table::build(files(), not_found())
}

fn get(t: &Table, path: &str, query: Option<&str>, accept: &str) -> Answer {
    t.respond(&Method::GET, path, query, &with(accept, None))
}

fn with(accept: &str, if_none_match: Option<&str>) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        header::ACCEPT_ENCODING,
        HeaderValue::from_str(accept).unwrap(),
    );
    if let Some(t) = if_none_match {
        h.insert(header::IF_NONE_MATCH, HeaderValue::from_str(t).unwrap());
    }
    h
}

#[test]
fn redirects_by_the_trailing_slash() {
    let t = table();
    for (from, query, to) in [
        ("/2025/01/20/a", None, "/2025/01/20/a/"),
        ("/feed", None, "/feed/"),
        ("/2025/01/20/a", Some("x=1"), "/2025/01/20/a/?x=1"),
        (
            "/2025/01/20/a/my%20photo.png/",
            None,
            "/2025/01/20/a/my photo.png",
        ),
    ] {
        let a = get(&t, from, query, "");
        assert_eq!(a.status, StatusCode::MOVED_PERMANENTLY, "{from}");
        assert_eq!(a.header(header::LOCATION), Some(to), "{from}");
    }
    for missing in ["/nothing", "/nothing/", "//", "//feed"] {
        assert_eq!(
            get(&t, missing, None, "").status,
            StatusCode::NOT_FOUND,
            "{missing}"
        );
    }
    assert_eq!(get(&t, "/nothing/", None, "").body, not_found().body);
}

#[test]
fn encodings() {
    let t = table();
    let a = get(&t, "/", None, "gzip, deflate, br");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
    let a = get(&t, "/", None, "gzip, br;q=0");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("gzip"));
    let a = get(&t, "/", None, "GZIP;q=0.5");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("gzip"));
    for none in ["identity", "", "deflate", "br;q=0, gzip;q=0"] {
        let a = get(&t, "/", None, none);
        assert_eq!(a.header(header::CONTENT_ENCODING), None, "{none:?}");
        assert_eq!(a.body, HOME.as_bytes(), "{none:?}");
    }
    let a = get(&t, "/2025/01/20/a/my%20photo.png", None, "br, gzip");
    assert_eq!(
        a.header(header::CONTENT_ENCODING),
        None,
        "images are sent as they are"
    );
    assert_eq!(a.header(header::VARY), None);
    assert_eq!(a.body, "png".repeat(40).as_bytes());
    assert_eq!(a.header(header::CONTENT_TYPE), Some("image/png"));
    let a = get(&t, "/feed/", None, "br");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
    assert_eq!(a.header(header::VARY), Some("Accept-Encoding"));
}

#[test]
fn what_is_text() {
    for t in [
        "text/html; charset=utf-8",
        "text/css",
        "text/javascript",
        "application/javascript",
        "application/json",
        "application/manifest+json",
        "application/atom+xml",
        "image/svg+xml",
        "application/wasm",
    ] {
        assert!(is_text(t), "{t}");
    }
    for t in [
        "image/png",
        "image/jpeg",
        "audio/mpeg",
        "font/woff2",
        "application/octet-stream",
    ] {
        assert!(!is_text(t), "{t}");
    }
}

#[test]
fn never_sent_larger() {
    // Too short for either to make smaller: gzip's header alone is ten bytes.
    let t = Table::build(vec![file("/tiny/", HTML, "<p>a</p>")], not_found());
    for accept in ["br", "gzip", "gzip, br"] {
        let a = get(&t, "/tiny/", None, accept);
        assert_eq!(a.header(header::CONTENT_ENCODING), None, "{accept}");
        assert_eq!(a.body, &b"<p>a</p>"[..], "{accept}");
        assert_eq!(
            a.header(header::ETAG),
            get(&t, "/tiny/", None, "").header(header::ETAG)
        );
    }
    assert!(t.entries["/tiny/"].ready());
    let p = t.entries["/tiny/"].packed().unwrap();
    assert!(p.br.is_none() && p.gzip.is_none());

    // Where brotli's is no smaller but gzip's is, gzip is sent to a request that takes both.
    let entry = Entry::new(file("/", HTML, HOME));
    let _ = entry.packed.as_ref().unwrap().set(Packed {
        br: None,
        gzip: Some(Bytes::from_static(b"gz")),
    });
    let t = Table {
        entries: HashMap::from([("/".to_string(), Arc::new(entry))]),
        not_found: Arc::new(Entry::new(not_found())),
        fallback: None,
    };
    let a = get(&t, "/", None, "gzip, br");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("gzip"));
    assert_eq!(a.body, &b"gz"[..]);
}

#[test]
fn not_modified() {
    let t = table();
    let a = get(&t, "/", None, "br");
    let etag = a.header(header::ETAG).unwrap().to_string();
    assert_eq!(
        t.respond(&Method::GET, "/", None, &with("br", Some(&etag)))
            .status,
        StatusCode::NOT_MODIFIED
    );
    let listed = format!("\"other\", {etag}");
    assert_eq!(
        t.respond(&Method::GET, "/", None, &with("gzip, br", Some(&listed)))
            .status,
        StatusCode::NOT_MODIFIED
    );
    // The same tag, asked for in gzip, is another body; and so is one for the file as it is.
    for accept in ["gzip", ""] {
        let a = t.respond(&Method::GET, "/", None, &with(accept, Some(&etag)));
        assert_eq!(a.status, StatusCode::OK, "{accept:?}");
        assert_ne!(a.header(header::ETAG), Some(etag.as_str()), "{accept:?}");
        let again = a.header(header::ETAG).unwrap();
        let b = t.respond(&Method::GET, "/", None, &with(accept, Some(again)));
        assert_eq!(b.status, StatusCode::NOT_MODIFIED, "{accept:?}");
        assert!(b.body.is_empty());
    }
    // A browser that holds the gzip body, and now takes brotli too, is sent brotli's.
    let gz = get(&t, "/", None, "gzip");
    let a = t.respond(
        &Method::GET,
        "/",
        None,
        &with("gzip, br", gz.header(header::ETAG)),
    );
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
    // Another file's tag is not this one's.
    let other = get(&t, "/feed/", None, "br");
    let a = t.respond(
        &Method::GET,
        "/",
        None,
        &with("br", other.header(header::ETAG)),
    );
    assert_eq!(a.status, StatusCode::OK);
    // A 404 has no tag, and is never a 304.
    let a = get(&t, "/nothing/", None, "br");
    assert_eq!(a.header(header::ETAG), None);
    let a = t.respond(&Method::GET, "/nothing/", None, &with("br", Some("*")));
    assert_eq!(a.status, StatusCode::NOT_FOUND);
}

#[test]
fn methods() {
    let t = table();
    let h = HeaderMap::new();
    let a = t.respond(&Method::HEAD, "/", None, &h);
    assert_eq!(a.status, StatusCode::OK);
    assert!(a.body.is_empty());
    assert_eq!(
        a.header(header::CONTENT_LENGTH),
        Some(HOME.len().to_string().as_str())
    );
    let a = t.respond(&Method::HEAD, "/", None, &with("br", None));
    assert!(a.body.is_empty());
    let br = get(&t, "/", None, "br");
    assert_eq!(
        a.header(header::CONTENT_LENGTH),
        Some(br.body.len().to_string().as_str())
    );
    for m in [Method::POST, Method::PUT, Method::DELETE] {
        let a = t.respond(&m, "/", None, &h);
        assert_eq!(a.status, StatusCode::METHOD_NOT_ALLOWED, "{m}");
        assert_eq!(a.header(header::ALLOW), Some("GET, HEAD"));
    }
}

#[test]
fn the_products_own_headers() {
    let t = Table::build(
        vec![
            file("/", HTML, HOME).with(header::CONTENT_SECURITY_POLICY, "default-src 'none'"),
            file("/app.js", "text/javascript", "x")
                .with(header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
        ],
        not_found(),
    );
    let a = get(&t, "/", None, "br");
    assert_eq!(
        a.header(header::CONTENT_SECURITY_POLICY),
        Some("default-src 'none'")
    );
    assert_eq!(a.header(header::CACHE_CONTROL), Some(CACHE));
    assert_eq!(a.header(header::X_CONTENT_TYPE_OPTIONS), Some("nosniff"));
    let a = get(&t, "/app.js", None, "");
    let caches: Vec<_> = a
        .headers
        .iter()
        .filter(|(n, _)| *n == header::CACHE_CONTROL)
        .collect();
    assert_eq!(caches.len(), 1, "{caches:?}");
    assert_eq!(caches[0].1, "public, max-age=31536000, immutable");
    assert_eq!(a.header(header::CONTENT_SECURITY_POLICY), None);
}

#[test]
fn compressed_when_first_wanted_and_at_the_best() {
    let t = table();
    assert!(t
        .entries
        .values()
        .all(|e| e.ready() == (e.content_type == "image/png")));
    assert!(!t.not_found.ready());

    // What is sent in no encoding, as a 304, or as an image, compresses nothing.
    let etag = get(&t, "/", None, "")
        .header(header::ETAG)
        .unwrap()
        .to_string();
    assert!(!t.entries["/"].ready());
    let tag = etag.trim_end_matches('"').to_string() + "-br\"";
    let a = t.respond(&Method::GET, "/", None, &with("br", Some(&tag)));
    assert_eq!(a.status, StatusCode::NOT_MODIFIED);
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
    assert!(!t.entries["/"].ready());
    get(&t, "/2025/01/20/a/my%20photo.png", None, "br");

    // A request in brotli compresses that file, and only it, with brotli at 11 and its widest
    // window, and gzip at its best: no smaller setting, whatever made it.
    let a = get(&t, "/", None, "br");
    let mut best = Vec::new();
    ::brotli::BrotliCompress(
        &mut HOME.as_bytes(),
        &mut best,
        &::brotli::enc::BrotliEncoderParams {
            quality: 11,
            lgwin: 22,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(a.body, best);
    assert_eq!(a.header(header::ETAG), Some(tag.as_str()));
    assert!(t.entries["/"].ready());
    assert!(!t.entries["/feed/"].ready() && !t.not_found.ready());
    let a = get(&t, "/", None, "gzip");
    let mut w = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(9));
    w.write_all(HOME.as_bytes()).unwrap();
    assert_eq!(a.body, w.finish().unwrap());

    // A 404 is compressed as it is sent.
    let a = get(&t, "/nothing/", None, "br");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
    assert!(t.not_found.ready());

    // What is left, compress does, once.
    let (n, _) = t.compress();
    assert_eq!(n, 2, "the post and the feed");
    assert!(t.entries.values().all(|e| e.ready()));
    assert_eq!(t.compress().0, 0);
    let a = get(&t, "/feed/", None, "br");
    assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"));
}

#[test]
fn keeps_what_did_not_change() {
    let old = table();
    get(&old, "/", None, "br");
    // Equal bytes, given again: not the same memory.
    let mut again: Vec<File> = files()
        .into_iter()
        .map(|f| File {
            body: Bytes::copy_from_slice(&f.body),
            ..f
        })
        .collect();
    let changed = again.iter_mut().find(|f| f.path == "/feed/").unwrap();
    changed.body = Bytes::from_static(b"<feed>new</feed>");
    let typed = again
        .iter_mut()
        .find(|f| f.path == "/2025/01/20/a/")
        .unwrap();
    typed.content_type = "text/plain".into();
    let headed = again
        .iter_mut()
        .find(|f| f.path == "/2025/01/20/a/my photo.png")
        .unwrap();
    headed
        .headers
        .push((header::CACHE_CONTROL, "no-store".into()));
    let (new, made) = Table::build_from(again, not_found(), Some(&old));
    assert_eq!(made, 3);
    for (path, e) in &new.entries {
        assert_eq!(Arc::ptr_eq(e, &old.entries[path]), path == "/", "{path}");
    }
    assert!(Arc::ptr_eq(&new.not_found, &old.not_found));
    assert!(new.entries["/"].ready(), "kept compressed");
    assert!(!new.entries["/feed/"].ready());
    assert_eq!(get(&new, "/feed/", None, "").body, &b"<feed>new</feed>"[..]);
    let (gone, _) = Table::build_from(vec![file("/", HTML, HOME)], not_found(), Some(&new));
    assert_eq!(gone.entries.len(), 1);
    assert_eq!(get(&gone, "/feed/", None, "").status, StatusCode::NOT_FOUND);
}

#[test]
fn holds_each_file_once() {
    // From the product's bytes to the table and the wire, a file is the same memory, never a copy.
    let held = Bytes::from(vec![7u8; 4096]);
    let t = Table::build(
        vec![File::new("/big.png", "image/png", held.clone())],
        not_found(),
    );
    let served = &t.entries["/big.png"].identity;
    assert_eq!((served.as_ptr(), served.len()), (held.as_ptr(), held.len()));
    let a = get(&t, "/big.png", None, "");
    assert_eq!(a.body.as_ptr(), held.as_ptr());
    // And a table made again keeps what it held.
    let (again, _) = Table::build_from(
        vec![File::new("/big.png", "image/png", held.clone())],
        not_found(),
        Some(&t),
    );
    assert!(Arc::ptr_eq(
        &again.entries["/big.png"],
        &t.entries["/big.png"]
    ));
}

#[test]
fn what_a_range_asks_for() {
    use Ranged::*;
    for (range, want) in [
        ("bytes=0-0", Part(0, 0)),
        ("bytes=2-5", Part(2, 5)),
        ("bytes=2-", Part(2, 9)),
        ("bytes=-3", Part(7, 9)),
        ("bytes=0-", Part(0, 9)),
        ("bytes=9-9", Part(9, 9)),
        // Past the end is to the end, and a suffix longer than the file is all of it.
        ("bytes=5-100", Part(5, 9)),
        ("bytes=-100", Part(0, 9)),
        ("bytes=0-99999999999999999999999", Part(0, 9)),
        ("Bytes=2-5", Part(2, 5)),
        (" bytes = 2-5 ", Part(2, 5)),
        ("bytes=10-", Outside),
        ("bytes=10-20", Outside),
        ("bytes=-0", Outside),
        ("bytes=99999999999999999999999-", Outside),
        ("", Whole),
        ("bytes", Whole),
        ("bytes=", Whole),
        ("bytes=-", Whole),
        ("bytes=5-2", Whole),
        ("bytes=a-b", Whole),
        ("bytes=1-2-3", Whole),
        ("bytes=+1-2", Whole),
        ("bytes=0-1,4-5", Whole),
        ("bytes=0-1, 20-30", Whole),
        ("items=0-1", Whole),
    ] {
        assert_eq!(ranged(range, 10), want, "{range:?}");
    }
    assert_eq!(ranged("bytes=0-", 0), Outside);
    assert_eq!(ranged("bytes=-1", 0), Outside);
}

fn ranged_get(t: &Table, path: &str, accept: &str, range: &str, if_range: Option<&str>) -> Answer {
    let mut h = with(accept, None);
    h.insert(header::RANGE, HeaderValue::from_str(range).unwrap());
    if let Some(r) = if_range {
        h.insert(header::IF_RANGE, HeaderValue::from_str(r).unwrap());
    }
    t.respond(&Method::GET, path, None, &h)
}

#[test]
fn says_it_takes_a_range_only_of_a_file_never_compressed() {
    // A page's 200, in brotli or as it is, says nothing of ranges: 22 B on every page, that no
    // browser uses (crux#25). A sound's says it, as a browser seeks it; and each is sent in part.
    let wav = "RIFF".repeat(40);
    let t = Table::build(
        vec![file("/", HTML, HOME), file("/a.wav", "audio/wav", &wav)],
        not_found(),
    );
    for accept in ["br", ""] {
        let a = get(&t, "/", None, accept);
        assert_eq!(a.status, StatusCode::OK);
        assert_eq!(a.header(header::ACCEPT_RANGES), None, "{accept:?}");
        let a = get(&t, "/a.wav", None, accept);
        assert_eq!(a.status, StatusCode::OK);
        assert_eq!(a.header(header::CONTENT_ENCODING), None);
        assert_eq!(a.header(header::ACCEPT_RANGES), Some("bytes"), "{accept:?}");
    }
    assert_eq!(
        get(&t, "/", None, "br").header(header::CONTENT_ENCODING),
        Some("br")
    );
    for (path, whole) in [("/", HOME), ("/a.wav", wav.as_str())] {
        let a = ranged_get(&t, path, "br", "bytes=0-3", None);
        assert_eq!(a.status, StatusCode::PARTIAL_CONTENT, "{path}");
        assert_eq!(&a.body[..], &whole.as_bytes()[..4], "{path}");
        assert_eq!(a.header(header::ACCEPT_RANGES), Some("bytes"), "{path}");
    }
}

#[test]
fn sends_a_range_as_it_is() {
    let t = table();
    // A file not text, and one that is: each in part as it is, brotli taken or not.
    for (path, whole) in [
        ("/2025/01/20/a/my%20photo.png", "png".repeat(40)),
        ("/", HOME.to_string()),
    ] {
        let len = whole.len();
        for accept in ["", "gzip, br"] {
            let full = get(&t, path, None, accept);
            assert_eq!(full.status, StatusCode::OK, "{path}");
            // Only a file never compressed says on its 200 that it is sent in part (crux#25).
            let says = (!path.ends_with('/')).then_some("bytes");
            assert_eq!(full.header(header::ACCEPT_RANGES), says, "{path}");
            assert_eq!(full.header(header::CONTENT_RANGE), None, "{path}");
            for (range, first, last) in [
                ("bytes=0-0", 0, 0),
                ("bytes=3-10", 3, 10),
                ("bytes=4-", 4, len - 1),
                ("bytes=-5", len - 5, len - 1),
                ("bytes=0-100000", 0, len - 1),
            ] {
                let a = ranged_get(&t, path, accept, range, None);
                let at = format!("{path} {accept:?} {range}");
                assert_eq!(a.status, StatusCode::PARTIAL_CONTENT, "{at}");
                assert_eq!(&a.body[..], &whole.as_bytes()[first..=last], "{at}");
                assert_eq!(
                    a.header(header::CONTENT_RANGE),
                    Some(format!("bytes {first}-{last}/{len}").as_str()),
                    "{at}"
                );
                assert_eq!(
                    a.header(header::CONTENT_LENGTH),
                    Some((last + 1 - first).to_string().as_str()),
                    "{at}"
                );
                assert_eq!(a.header(header::CONTENT_ENCODING), None, "{at}");
                assert_eq!(a.header(header::ACCEPT_RANGES), Some("bytes"), "{at}");
                assert_eq!(
                    a.header(header::CONTENT_TYPE),
                    full.header(header::CONTENT_TYPE)
                );
                // Its tag is the file's as it is, whatever was taken.
                assert_eq!(
                    a.header(header::ETAG),
                    get(&t, path, None, "").header(header::ETAG),
                    "{at}"
                );
            }
            // Outside the file: a 416, saying how long it is, and nothing a cache would keep.
            for range in [format!("bytes={len}-"), "bytes=-0".into()] {
                let a = ranged_get(&t, path, accept, &range, None);
                assert_eq!(
                    a.status,
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    "{path} {range}"
                );
                assert_eq!(
                    a.header(header::CONTENT_RANGE),
                    Some(format!("bytes */{len}").as_str())
                );
                assert!(a.body.is_empty());
                assert_eq!(a.header(header::CACHE_CONTROL), None);
                assert_eq!(a.header(header::ETAG), None);
            }
            // Not a range that can be read, or more than one: the whole file, as without one.
            for range in ["bytes=5-2", "lines=0-1", "bytes=0-1,4-5"] {
                let a = ranged_get(&t, path, accept, range, None);
                assert_eq!(a.status, StatusCode::OK, "{path} {range}");
                assert_eq!(a.body, full.body, "{path} {range}");
                assert_eq!(
                    a.header(header::CONTENT_ENCODING),
                    full.header(header::CONTENT_ENCODING)
                );
            }
        }
    }
}

#[test]
fn a_range_with_everything_else() {
    let t = table();
    let path = "/";
    let tag = get(&t, path, None, "")
        .header(header::ETAG)
        .unwrap()
        .to_string();
    let br = get(&t, path, None, "br")
        .header(header::ETAG)
        .unwrap()
        .to_string();
    // If-Range: the range while the browser holds the file as it is now, else the whole file.
    let a = ranged_get(&t, path, "br", "bytes=0-3", Some(&tag));
    assert_eq!(a.status, StatusCode::PARTIAL_CONTENT);
    for other in [
        br.as_str(),
        "\"0000000000000000\"",
        &format!("W/{tag}"),
        "Fri, 24 Oct 2026 18:55:00 GMT",
    ] {
        let a = ranged_get(&t, path, "br", "bytes=0-3", Some(other));
        assert_eq!(a.status, StatusCode::OK, "{other}");
        assert_eq!(a.header(header::CONTENT_ENCODING), Some("br"), "{other}");
    }
    // If-None-Match for the file as it is comes first: a 304.
    let mut h = with("br", Some(&tag));
    h.insert(header::RANGE, HeaderValue::from_static("bytes=0-3"));
    assert_eq!(
        t.respond(&Method::GET, path, None, &h).status,
        StatusCode::NOT_MODIFIED
    );
    // HEAD is never in part, though a picture's says ranges are taken.
    let mut h = with("", None);
    h.insert(header::RANGE, HeaderValue::from_static("bytes=0-3"));
    let a = t.respond(&Method::HEAD, path, None, &h);
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.header(header::ACCEPT_RANGES), None);
    assert_eq!(a.header(header::CONTENT_RANGE), None);
    assert_eq!(
        a.header(header::CONTENT_LENGTH),
        Some(HOME.len().to_string().as_str())
    );
    let a = t.respond(&Method::HEAD, "/2025/01/20/a/my%20photo.png", None, &h);
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.header(header::ACCEPT_RANGES), Some("bytes"));
    assert_eq!(a.header(header::CONTENT_RANGE), None);
    // A 404 is never in part, nor says it could be.
    let a = ranged_get(&t, "/nothing/", "", "bytes=0-3", None);
    assert_eq!(a.status, StatusCode::NOT_FOUND);
    assert_eq!(a.body, not_found().body);
    assert_eq!(a.header(header::ACCEPT_RANGES), None);
    let a = ranged_get(&t, "/nothing/", "", "bytes=100000-", None);
    assert_eq!(a.status, StatusCode::NOT_FOUND);
    // Nor is a redirect.
    let a = ranged_get(&t, "/feed", "", "bytes=0-3", None);
    assert_eq!(a.status, StatusCode::MOVED_PERMANENTLY);
}

#[test]
fn reads_what_is_given_later() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = reads.clone();
    let read: Read = Arc::new(move |key| {
        counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(async move {
            match key.as_str() {
                "photo" => Ok(Bytes::from_static(b"the photo")),
                _ => Err(format!("no {key}")),
            }
        })
    });
    let later = || File::later("/photo.png", "image/png", "photo", "1");
    let t = Table::build(
        vec![later(), File::later("/gone.png", "image/png", "gone", "1")],
        not_found(),
    );
    let e = &t.entries["/photo.png"];
    assert!(e.bytes().is_none());
    assert!(e.ready(), "never compressed");
    assert_eq!(
        get(&t, "/photo.png", None, "").status,
        StatusCode::SERVICE_UNAVAILABLE
    );
    runtime.block_on(e.fill(&read)).unwrap();
    runtime.block_on(e.fill(&read)).unwrap();
    assert_eq!(
        reads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "read once"
    );
    let a = get(&t, "/photo.png", None, "br");
    assert_eq!((a.status, &a.body[..]), (StatusCode::OK, &b"the photo"[..]));
    assert_eq!(a.header(header::CONTENT_ENCODING), None);
    let part = ranged_get(&t, "/photo.png", "br", "bytes=4-", None);
    assert_eq!(part.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(&part.body[..], b"photo");
    assert_eq!(part.header(header::CONTENT_RANGE), Some("bytes 4-8/9"));
    assert!(runtime
        .block_on(t.entries["/gone.png"].fill(&read))
        .is_err());

    // Kept, read, while its version does not change; made again, unread, when it does.
    let (kept, _) = Table::build_from(vec![later()], not_found(), Some(&t));
    assert!(Arc::ptr_eq(&kept.entries["/photo.png"], e));
    let (again, _) = Table::build_from(
        vec![File::later("/photo.png", "image/png", "photo", "2")],
        not_found(),
        Some(&t),
    );
    assert!(again.entries["/photo.png"].bytes().is_none());
    assert_ne!(
        get(&again, "/photo.png", None, "").header(header::ETAG),
        a.header(header::ETAG)
    );
}

#[test]
fn decodes_paths() {
    assert_eq!(decode("/a%20b/"), "/a b/");
    assert_eq!(decode("/caf%C3%A9"), "/café");
    assert_eq!(decode("/100%"), "/100%");
    assert_eq!(decode("/%zz"), "/%zz");
    assert_eq!(decode("/%4"), "/%4");
}

#[test]
fn ports() {
    assert_eq!(port(None), Ok(8080));
    assert_eq!(port(Some("0")), Ok(0));
    assert_eq!(port(Some("9000")), Ok(9000));
    assert!(port(Some("eighty")).is_err());
    assert!(port(Some("70000")).is_err());
}
