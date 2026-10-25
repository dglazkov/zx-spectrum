//! A tag asked for again, each way a browser or a cache says it that the table's own tests do not
//! (crux#68): `If-None-Match: *` for a file that is there, a HEAD with the file's tag, and the
//! app's page asked for again at another of its routes, by the tag it was sent with at the first.
//! Each is a 304 that says the tag and the encoding it names, with no body.

use axum::http::{HeaderMap, Method, StatusCode};
use server::header;
use server::{Answer, Bytes, File, Table};

const HTML: &str = "text/html; charset=utf-8";

/// Long enough, and repeated enough, that brotli and gzip each make it smaller.
fn text(word: &str) -> Bytes {
    Bytes::from(format!("{word} ").repeat(200))
}

fn table() -> Table {
    let mut index = File::new("/index.html", HTML, text("app"));
    index.fallback = true;
    Table::build(
        vec![
            index,
            File::new("/style.css", "text/css", text("body")),
            File::new("/photo.png", "image/png", Bytes::from(vec![0x89u8; 2000])),
        ],
        File::new("", HTML, text("not here")),
    )
}

fn ask(t: &Table, method: Method, path: &str, accept: &str, tag: Option<&str>) -> Answer {
    let mut h = HeaderMap::new();
    h.insert(header::ACCEPT_ENCODING, accept.parse().unwrap());
    if let Some(tag) = tag {
        h.insert(header::IF_NONE_MATCH, tag.parse().unwrap());
    }
    t.respond(&method, path, None, &h)
}

/// A 304 for `sent`'s body: its tag and encoding said again, and nothing sent.
fn held(a: &Answer, sent: &Answer, what: &str) {
    assert_eq!(a.status, StatusCode::NOT_MODIFIED, "{what}");
    assert!(a.body.is_empty(), "{what}");
    assert_eq!(a.header(header::ETAG), sent.header(header::ETAG), "{what}");
    assert_eq!(
        a.header(header::CONTENT_ENCODING),
        sent.header(header::CONTENT_ENCODING),
        "{what}"
    );
}

#[test]
fn any_tag_for_a_file_that_is_there() {
    let t = table();
    for (path, accept) in [
        ("/style.css", "br"),
        ("/style.css", "gzip"),
        ("/style.css", ""),
        ("/photo.png", "br"),
    ] {
        let what = format!("{path} {accept:?}");
        let sent = ask(&t, Method::GET, path, accept, None);
        assert_eq!(sent.status, StatusCode::OK, "{what}");
        held(&ask(&t, Method::GET, path, accept, Some("*")), &sent, &what);
        held(
            &ask(&t, Method::GET, path, accept, Some("\"other\", *")),
            &sent,
            &what,
        );
    }
    // A path that names no file is the not-found page's, which is never held, nor the app's page.
    assert_eq!(
        ask(&t, Method::GET, "/missing.js", "br", Some("*")).status,
        StatusCode::NOT_FOUND
    );
}

#[test]
fn a_head_with_the_tag() {
    let t = table();
    for accept in ["br", "gzip", ""] {
        let sent = ask(&t, Method::GET, "/style.css", accept, None);
        let tag = sent.header(header::ETAG).unwrap();
        held(
            &ask(&t, Method::HEAD, "/style.css", accept, Some(tag)),
            &sent,
            accept,
        );
        // Another encoding's tag is another body: a HEAD for this one says it, and sends nothing.
        let other = ask(&t, Method::HEAD, "/style.css", accept, Some("\"other\""));
        assert_eq!(other.status, StatusCode::OK, "{accept:?}");
        assert!(other.body.is_empty(), "{accept:?}");
        assert_eq!(other.header(header::ETAG), Some(tag), "{accept:?}");
    }
}

#[test]
fn the_apps_page_at_another_route() {
    let t = table();
    for accept in ["br", "gzip", ""] {
        let sent = ask(&t, Method::GET, "/route", accept, None);
        assert_eq!(sent.status, StatusCode::OK, "{accept:?}");
        let tag = sent.header(header::ETAG).unwrap();
        for path in ["/route", "/another/route", "/index.html"] {
            held(
                &ask(&t, Method::GET, path, accept, Some(tag)),
                &sent,
                &format!("{path} {accept:?}"),
            );
        }
    }
}
