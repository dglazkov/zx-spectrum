//! The app's page at one of its routes, answered as it is at its own path, each way the table's own
//! tests and tests/dir.rs do not ask it (crux#68): a range of it, with If-Range by its tag and
//! without, and a HEAD, which says the length a GET would send and sends nothing.

use axum::http::{HeaderMap, Method, StatusCode};
use server::header;
use server::{Answer, Bytes, File, Table};

const HTML: &str = "text/html; charset=utf-8";

fn table() -> Table {
    let mut index = File::new("/index.html", HTML, Bytes::from("app ".repeat(200)));
    index.fallback = true;
    Table::build(
        vec![index],
        File::new("", HTML, Bytes::from("not here ".repeat(20))),
    )
}

fn ask(t: &Table, method: Method, path: &str, headers: &[(header::HeaderName, &str)]) -> Answer {
    let mut h = HeaderMap::new();
    for (name, value) in headers {
        h.insert(name.clone(), value.parse().unwrap());
    }
    t.respond(&method, path, None, &h)
}

/// The answers are the same: status, body and every header.
fn same(a: &Answer, b: &Answer, what: &str) {
    assert_eq!(a.status, b.status, "{what}");
    assert_eq!(a.body, b.body, "{what}");
    assert_eq!(a.headers, b.headers, "{what}");
}

#[test]
fn a_range_of_the_page_at_a_route() {
    let t = table();
    let whole = ask(&t, Method::GET, "/index.html", &[]);
    let tag = whole.header(header::ETAG).unwrap().to_string();
    for range in ["bytes=0-9", "bytes=-5", "bytes=795-"] {
        let at = ask(&t, Method::GET, "/index.html", &[(header::RANGE, range)]);
        assert_eq!(at.status, StatusCode::PARTIAL_CONTENT, "{range}");
        for route in ["/route", "/a/deep/route"] {
            let what = format!("{route} {range}");
            same(
                &ask(&t, Method::GET, route, &[(header::RANGE, range)]),
                &at,
                &what,
            );
            // While the browser holds the page as it is, by its tag; and not once it holds another.
            same(
                &ask(
                    &t,
                    Method::GET,
                    route,
                    &[(header::RANGE, range), (header::IF_RANGE, &tag)],
                ),
                &at,
                &what,
            );
            same(
                &ask(
                    &t,
                    Method::GET,
                    route,
                    &[(header::RANGE, range), (header::IF_RANGE, "\"other\"")],
                ),
                &whole,
                &what,
            );
        }
    }
    // A range past the page's end is a 416 at a route as at its path.
    let past = ask(
        &t,
        Method::GET,
        "/index.html",
        &[(header::RANGE, "bytes=900-")],
    );
    assert_eq!(past.status, StatusCode::RANGE_NOT_SATISFIABLE);
    same(
        &ask(&t, Method::GET, "/route", &[(header::RANGE, "bytes=900-")]),
        &past,
        "past",
    );
}

#[test]
fn a_head_of_the_page_at_a_route() {
    let t = table();
    for accept in ["br", "gzip", ""] {
        let enc = [(header::ACCEPT_ENCODING, accept)];
        let get = ask(&t, Method::GET, "/route", &enc);
        let head = ask(&t, Method::HEAD, "/route", &enc);
        assert_eq!(head.status, StatusCode::OK, "{accept:?}");
        assert!(head.body.is_empty(), "{accept:?}");
        assert_eq!(head.headers, get.headers, "{accept:?}");
        assert_eq!(
            head.header(header::CONTENT_LENGTH),
            Some(get.body.len().to_string().as_str()),
            "{accept:?}"
        );
        same(&ask(&t, Method::HEAD, "/index.html", &enc), &head, accept);
    }
}
