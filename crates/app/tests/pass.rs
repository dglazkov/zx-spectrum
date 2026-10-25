//! The pass-through: what it lets through and what it refuses, against an origin of the test's own; what it says when
//! that goes wrong, and at which severity; a client asking too often; and, with ZXInfo down, the answers from the
//! ZXDB's own index (tests/zxdb-index.txt, the index web/tools/zxdb-index.mjs builds from the dump's excerpt in
//! web/tests/fixtures/zxdb/, which web/tests/zxdb.test.mjs holds it to). Ported from web/tests/server.test.mjs and
//! the block "the server, with ZXInfo down" of web/tests/zxdb.test.mjs, each named as it was.

use std::io::Write;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use app::pass::{self, Clock, Limiter, Pass, Route, Said, Say, Timer};
use app::zxdb::Zxdb;
use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::Response;
use axum::Router;
use regex::Regex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const INDEX: &[u8] = include_bytes!("zxdb-index.txt");

/// api.zxinfo.dk's answer to every path on Oct 18 2026, as its nginx gave it (#5, #6).
const NGINX_502: &str = "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

fn production() -> Vec<Route> {
    pass::routes(None, Arc::new(Zxdb::of(INDEX)))
}

fn url_of(path: &str) -> Option<String> {
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    pass::target(path, query, &production()).map(|t| t.url)
}

#[test]
fn passes_the_archives_game_files_and_the_zxdbs_own() {
    assert_eq!(url_of("/archive/pub/sinclair/games/s/Saboteur.tzx.zip").as_deref(), Some("https://spectrumcomputing.co.uk/pub/sinclair/games/s/Saboteur.tzx.zip"));
    assert_eq!(url_of("/archive/zxdb/sinclair/entries/0004293/Saboteur(Encore).tzx.zip").as_deref(), Some("https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0004293/Saboteur(Encore).tzx.zip"));
    assert_eq!(url_of("/archive/zxdb/sinclair/pokes/s/Saboteur!%20(1985).pok").as_deref(), Some("https://spectrumcomputing.co.uk/zxdb/sinclair/pokes/s/Saboteur!%20(1985).pok"));
}

#[test]
fn passes_the_zxinfo_searches_and_entries_the_page_asks_for_with_their_queries() {
    assert_eq!(url_of("/zxinfo/v3/search?query=saboteur&mode=compact").as_deref(), Some("https://api.zxinfo.dk/v3/search?query=saboteur&mode=compact"));
    assert_eq!(url_of("/zxinfo/v3/games/0004293?mode=compact").as_deref(), Some("https://api.zxinfo.dk/v3/games/0004293?mode=compact"));
}

#[test]
fn refuses_anything_else_however_it_is_spelled() {
    for path in [
        "/archive/pub/other/file.zip",
        "/archive/pub/sinclair/",
        "/archive/pub/sinclair/../../etc/passwd",
        "/archive/pub/sinclair/%2e%2e/%2e%2e/etc/passwd",
        "/archive/pub/sinclair/games/./x.zip",
        // The route's own pattern would take these: the segments alone refuse them.
        "/archive/pub/sinclair/games/../../../etc/x.zip",
        "/archive/pub/sinclair/games/%2e%2e/%2E%2E/screens/x.png",
        "/zxinfo/v3/suggest/..",
        "/archive/pub/sinclair/games//x.zip",
        "/archive/pub/sinclair/games/a%5cb.zip",
        "/archive/pub/sinclair/games/a%00b.zip",
        "/archive/pub/sinclair/games/%zz.zip",
        "/archive//evil.example/pub/sinclair/x",
        // The archive's books and magazines, and anything that is not a Spectrum file, text or a picture: not the page's.
        "/archive/pub/sinclair/books-pics/m/Manual.pdf",
        "/archive/pub/sinclair/magazines/Crash/Issue01.zip",
        "/archive/pub/sinclair/games/s/Saboteur.exe",
        "/archive/pub/sinclair/games/s/",
        "/zxinfo/v3/admin",
        "/zxinfo/v3/games/../search",
        "/zxinfo/v2/search",
    ] {
        assert_eq!(url_of(path), None, "{path}");
    }
}

// --- An origin of the test's own, and the pass-through in front of it ---------------------------------------------

/// What the origin was asked, and what it saw.
#[derive(Default)]
struct Origin {
    asked: AtomicUsize,
    /// The huge file's connection, closed by the other end.
    huge_closed: AtomicBool,
    /// 0 down (nginx's 502), 1 hanging, 2 up.
    mode: AtomicUsize,
}

/// A body that goes on for ever, and says when it is let go of.
struct Huge(Arc<Origin>);

impl Drop for Huge {
    fn drop(&mut self) {
        self.0.huge_closed.store(true, Ordering::SeqCst);
    }
}

async fn listen(app: Router) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(app::conn::serve_on(listener, app));
    addr
}

fn answer(status: u16, headers: &[(&str, &str)], body: impl Into<Body>) -> Response {
    let mut res = Response::builder().status(status);
    for (k, v) in headers {
        res = res.header(*k, *v);
    }
    res.body(body.into()).unwrap()
}

/// The origin: the archive's paths as the tests need them, and ZXInfo's as its mode says.
async fn origin(state: Arc<Origin>) -> SocketAddr {
    let app = Router::new().fallback(move |uri: Uri, headers: HeaderMap| {
        let state = state.clone();
        async move {
            state.asked.fetch_add(1, Ordering::SeqCst);
            match uri.path() {
                "/pub/sinclair/ok.tap" => answer(200, &[], "TAPE"),
                "/pub/sinclair/big.tap" => answer(200, &[], vec![7u8; 5000]),
                "/pub/sinclair/missing.tap" => answer(404, &[], "no"),
                "/pub/sinclair/moved.tap" => answer(301, &[("location", "/pub/sinclair/ok.tap")], ""),
                "/pub/sinclair/away.tap" => answer(302, &[("location", "https://evil.example/x")], ""),
                // The same origin by another name, by the same protocol: a host not the route's, which answers.
                "/pub/sinclair/aside.tap" => {
                    let port = headers["host"].to_str().unwrap().rsplit(':').next().unwrap().to_string();
                    answer(302, &[("location", &format!("http://localhost:{port}/pub/sinclair/ok.tap"))], "")
                }
                // An origin that compresses (as nginx may for whatever it is set to): its Content-Length is of the
                // compressed body.
                "/pub/sinclair/gzipped.json" => {
                    let hits: Vec<_> = (0..100).map(|i| serde_json::json!({ "id": i, "title": "Saboteur" })).collect();
                    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
                    gz.write_all(serde_json::json!({ "hits": hits }).to_string().as_bytes()).unwrap();
                    let body = gz.finish().unwrap();
                    let length = body.len().to_string();
                    answer(200, &[("content-type", "application/json"), ("content-encoding", "gzip"), ("content-length", &length)], body)
                }
                "/pub/sinclair/error.html" => answer(404, &[("content-type", "text/html")], "<script>alert(1)</script>"),
                // Far more than a socket holds, for a client that stops reading.
                "/pub/sinclair/huge.tap" => {
                    let huge = Huge(state.clone());
                    let chunks = futures_util::stream::unfold(huge, |huge| async move {
                        Some((Ok::<_, std::io::Error>(Bytes::from(vec![1u8; 64 * 1024])), huge))
                    });
                    answer(200, &[("content-type", "application/octet-stream")], Body::from_stream(chunks))
                }
                "/pub/sinclair/chunked.tap" => {
                    let parts = futures_util::stream::iter([Bytes::from(vec![7u8; 2500]), Bytes::from(vec![7u8; 2500])].map(Ok::<_, std::io::Error>));
                    answer(200, &[("content-type", "application/octet-stream")], Body::from_stream(parts))
                }
                // As api.zxinfo.dk answered every path on Oct 18: its nginx up, what is behind it not.
                "/pub/sinclair/down.tap" => answer(502, &[("content-type", "text/html")], NGINX_502),
                p if p.starts_with("/v3/") => match state.mode.load(Ordering::SeqCst) {
                    0 => answer(502, &[("server", "nginx"), ("content-type", "text/html")], NGINX_502),
                    1 => std::future::pending().await,
                    _ => answer(200, &[("content-type", "application/json")], r#"{"hits":{"total":{"value":1},"hits":[{"_id":"0000001","_source":{"title":"From ZXInfo"}}]}}"#),
                },
                _ => answer(500, &[], ""),
            }
        }
    });
    listen(app).await
}

/// A port nothing listens on: an origin that cannot be reached.
async fn dead() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    addr.to_string()
}

fn route(prefix: &str, at: &str, allow: &str, max_bytes: u64, timeout: Duration, cache: &str) -> Route {
    Route {
        prefix: prefix.into(),
        origin: format!("http://{at}"),
        hosts: vec![at.into()],
        allow: Regex::new(allow).unwrap(),
        max_bytes,
        timeout,
        query: false,
        cache: cache.into(),
        fallback: None,
    }
}

/// What the pass-through said.
#[derive(Clone, Default)]
struct Heard(Arc<Mutex<Vec<Said>>>);

impl Heard {
    fn say(&self) -> Say {
        let heard = self.0.clone();
        Arc::new(move |said| heard.lock().unwrap().push(said))
    }

    fn take(&self) -> Vec<Said> {
        std::mem::take(&mut self.0.lock().unwrap())
    }
}

/// The pass-through's timers, in the test's hands: none ends but by `due`, however busy the machine, so that an origin
/// is late, or a client too slow, only where the test makes it so. (On Oct 24, a machine kept busy made the stand-in's
/// 502 later than the fallback's 300 ms on the wall clock, and the test read "gave no answer" for "answered 502": #10.)
#[derive(Clone, Default)]
struct Timers(Arc<Mutex<Vec<(Duration, tokio::sync::oneshot::Sender<()>)>>>);

impl Timers {
    fn timer(&self) -> Timer {
        let timers = self.0.clone();
        Arc::new(move |d| {
            let (tx, rx) = tokio::sync::oneshot::channel();
            timers.lock().unwrap().push((d, tx));
            Box::pin(async move {
                if rx.await.is_err() {
                    std::future::pending::<()>().await;
                }
            })
        })
    }

    /// Ends the waits of `d` begun so far, once there is one: the exchange has begun.
    async fn due(&self, d: Duration) {
        loop {
            let ended: Vec<_> = {
                let mut timers = self.0.lock().unwrap();
                let (ended, kept) = std::mem::take(&mut *timers).into_iter().partition(|(at, _)| *at == d);
                *timers = kept;
                ended
            };
            if !ended.is_empty() {
                for (_, tx) in ended {
                    let _ = tx.send(());
                }
                return;
            }
            tokio::task::yield_now().await;
        }
    }
}

/// The pass-through in front of a page that answers 418 to whatever it does not take.
async fn front(routes: Vec<Route>, limit: Option<Limiter>, now: Clock, after: Timer, say: Say) -> String {
    let pass = Arc::new(Pass::new(routes, limit, now, after, say));
    let app = pass::layer(Router::new().fallback(|| async { StatusCode::IM_A_TEAPOT }), pass);
    format!("http://{}", listen(app).await)
}

fn still() -> Clock {
    Arc::new(|| 0)
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn get(url: String) -> reqwest::Response {
    client().get(url).send().await.unwrap()
}

/// The pass-through of "passing through": the archive's route, and one of its own for the stalled client (a large
/// cap, and a short time for the whole exchange).
async fn passing() -> (String, Arc<Origin>, Timers) {
    let state = Arc::new(Origin::default());
    let at = origin(state.clone()).await.to_string();
    let routes = vec![
        route("/archive", &at, r"^/pub/sinclair/[a-z]+\.(tap|json|html)$", 4000, Duration::from_secs(5), "public, max-age=60"),
        route("/slow", &at, r"^/pub/sinclair/huge\.tap$", 1 << 30, Duration::from_millis(300), "no-store"),
    ];
    let now = pass::wall();
    let timers = Timers::default();
    let base = front(routes, Some(Limiter::new(120.0, 60.0, now.clone())), now, timers.timer(), Heard::default().say()).await;
    (base, state, timers)
}

#[tokio::test]
async fn hands_the_file_over_as_it_is_with_a_cache_header() {
    let (base, _, _) = passing().await;
    let res = get(format!("{base}/archive/pub/sinclair/ok.tap")).await;
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["cache-control"], "public, max-age=60");
    assert_eq!(res.text().await.unwrap(), "TAPE");
}

#[tokio::test]
async fn follows_a_redirect_on_the_same_host_and_no_other() {
    let (base, _, _) = passing().await;
    assert_eq!(get(format!("{base}/archive/pub/sinclair/moved.tap")).await.text().await.unwrap(), "TAPE");
    assert_eq!(get(format!("{base}/archive/pub/sinclair/away.tap")).await.status(), 502);
    assert_eq!(get(format!("{base}/archive/pub/sinclair/aside.tap")).await.status(), 502);
}

#[tokio::test]
async fn passes_on_a_missing_file_as_missing() {
    let (base, _, _) = passing().await;
    assert_eq!(get(format!("{base}/archive/pub/sinclair/missing.tap")).await.status(), 404);
}

#[tokio::test]
async fn refuses_a_file_over_its_size_whether_it_says_so_or_not() {
    let (base, _, _) = passing().await;
    assert_eq!(get(format!("{base}/archive/pub/sinclair/big.tap")).await.status(), 502);
    let chunked = match client().get(format!("{base}/archive/pub/sinclair/chunked.tap")).send().await {
        Ok(res) => res.bytes().await.map(|b| b.len()),
        Err(e) => Err(e),
    };
    assert!(chunked.is_err() || chunked.unwrap() < 5000);
}

#[tokio::test]
async fn hands_over_a_body_the_origin_compressed_whole_with_no_length_that_is_not_its_own() {
    let (base, _, _) = passing().await;
    let res = get(format!("{base}/archive/pub/sinclair/gzipped.json")).await;
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = serde_json::from_str(&res.text().await.unwrap()).unwrap();
    assert_eq!(body["hits"].as_array().unwrap().len(), 100);
}

#[tokio::test]
async fn lets_nothing_it_passes_through_run_as_the_page_no_script_no_frame_no_sniffing() {
    let (base, _, _) = passing().await;
    let res = get(format!("{base}/archive/pub/sinclair/error.html")).await;
    assert_eq!(res.status(), 404);
    let policy = res.headers()["content-security-policy"].to_str().unwrap();
    assert!(policy.contains("sandbox"), "{policy}");
    assert!(policy.contains("default-src 'none'"), "{policy}");
    assert_eq!(res.headers()["x-content-type-options"], "nosniff");
}

#[tokio::test]
async fn lets_go_of_a_client_that_stops_reading_once_the_time_is_up_the_archives_connection_with_it() {
    let (base, state, timers) = passing().await;
    // Read the first bytes, then read no more: the server's writes back up, and it must not wait for ever. Its time
    // up, it tears the exchange down, the archive's connection with it (which the origin sees close), and lets go of
    // the client.
    let addr = base.trim_start_matches("http://");
    let mut client = tokio::net::TcpStream::connect(addr).await.unwrap();
    client.write_all(format!("GET /slow/pub/sinclair/huge.tap HTTP/1.1\r\nHost: {addr}\r\n\r\n").as_bytes()).await.unwrap();
    let mut first = [0u8; 1024];
    assert!(client.read(&mut first).await.unwrap() > 0);
    timers.due(Duration::from_millis(300)).await;
    let closed = tokio::time::timeout(Duration::from_secs(20), async {
        while !state.huge_closed.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });
    assert!(closed.await.is_ok(), "the archive's connection is still open");
    // What the sockets held, then the end: the connection let go of, not waiting on the client.
    let mut rest = vec![0u8; 1 << 20];
    let ended = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match client.read(&mut rest).await {
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
        }
    });
    assert!(ended.await.is_ok(), "the client's connection was not let go of");
}

#[tokio::test]
async fn marks_what_it_passes_through_as_the_pages_own_no_other_site_may_take_it() {
    let (base, _, _) = passing().await;
    assert_eq!(get(format!("{base}/archive/pub/sinclair/ok.tap")).await.headers()["cross-origin-resource-policy"], "same-origin");
}

#[tokio::test]
async fn refuses_a_path_it_does_not_pass_and_leaves_other_paths_to_the_page() {
    let (base, _, _) = passing().await;
    assert_eq!(get(format!("{base}/archive/pub/other/x")).await.status(), 403);
    assert_eq!(get(format!("{base}/index.html")).await.status(), 418);
}

// --- What goes wrong, said once at its severity ----------------------------------------------------------------------

async fn going_wrong() -> (String, Heard) {
    let state = Arc::new(Origin::default());
    let at = origin(state).await.to_string();
    let dead = dead().await;
    let heard = Heard::default();
    let routes = vec![
        route("/archive", &at, r"^/pub/sinclair/[^?#]+$", 4000, Duration::from_secs(5), "no-store"),
        route("/dead", &dead, r"^/pub/sinclair/[^?#]+$", 4000, Duration::from_secs(5), "no-store"),
    ];
    let base = front(routes, None, still(), Timers::default().timer(), heard.say()).await;
    (base, heard)
}

/// An error's message, as its line says it.
fn message(line: &str) -> String {
    let line: serde_json::Value = serde_json::from_str(line).unwrap();
    assert_eq!(line["severity"], "ERROR");
    line["message"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn an_origin_that_cannot_be_reached_is_the_servers_error_once_with_its_stack() {
    let (base, heard) = going_wrong().await;
    assert_eq!(get(format!("{base}/dead/pub/sinclair/x.tap")).await.status(), 502);
    let said = heard.take();
    assert_eq!(said.len(), 1, "{said:?}");
    let Said::Error(line) = &said[0] else { panic!("not an error: {said:?}") };
    assert!(message(line).contains("\n    at "), "no stack: {line}");
}

#[tokio::test]
async fn an_origin_that_answers_5xx_is_not_reached_either_once_with_its_host_and_status_and_not_its_page() {
    let (base, heard) = going_wrong().await;
    let res = get(format!("{base}/archive/pub/sinclair/down.tap")).await;
    assert_eq!(res.status(), 502);
    assert!(res.headers()["content-type"].to_str().unwrap().starts_with("text/plain"));
    assert_eq!(res.headers()["cache-control"], "no-store");
    assert!(Regex::new(r"^127\.0\.0\.1:\d+ answered 502").unwrap().is_match(&res.text().await.unwrap()));
    let said = heard.take();
    assert_eq!(said.len(), 1, "{said:?}");
    let Said::Error(line) = &said[0] else { panic!("not an error: {said:?}") };
    let message = message(line);
    assert!(Regex::new(r"^/archive: 127\.0\.0\.1:\d+ answered 502\n").unwrap().is_match(&message), "{message}");
    assert!(message.contains("\n    at "), "no stack: {message}");
}

#[tokio::test]
async fn a_redirect_elsewhere_and_a_file_too_large_are_the_archives_not_the_servers_a_warning_each_no_error() {
    let (base, heard) = going_wrong().await;
    assert_eq!(get(format!("{base}/archive/pub/sinclair/away.tap")).await.status(), 502);
    assert_eq!(get(format!("{base}/archive/pub/sinclair/big.tap")).await.status(), 502);
    let said = heard.take();
    assert!(matches!(said.as_slice(), [Said::Warning(_), Said::Warning(_)]), "{said:?}");
}

#[tokio::test]
async fn a_missing_file_is_said_by_its_status_alone() {
    let (base, heard) = going_wrong().await;
    assert_eq!(get(format!("{base}/archive/pub/sinclair/missing.tap")).await.status(), 404);
    assert_eq!(heard.take(), []);
}

// --- A client asking too often -----------------------------------------------------------------------------------------

#[test]
fn is_refused_past_its_burst_and_let_back_in_as_the_minute_goes_on() {
    let t = Arc::new(AtomicU64::new(0));
    let clock = t.clone();
    let limit = Limiter::new(60.0, 10.0, Arc::new(move || clock.load(Ordering::SeqCst)));
    let client = |ip: &str| {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", format!("{ip}, 10.0.0.1").parse().unwrap());
        pass::client(&headers, None)
    };
    let granted = (0..15).filter(|_| limit.allow(&client("1.2.3.4"))).count();
    assert_eq!(granted, 10);
    // Another client is its own.
    assert!(limit.allow(&client("5.6.7.8")));
    // A second later, one more; five seconds later, five.
    t.fetch_add(1000, Ordering::SeqCst);
    assert!(limit.allow(&client("1.2.3.4")));
    assert!(!limit.allow(&client("1.2.3.4")));
    t.fetch_add(5000, Ordering::SeqCst);
    assert_eq!((0..8).filter(|_| limit.allow(&client("1.2.3.4"))).count(), 5);
}

#[tokio::test]
async fn refuses_past_a_clients_share_by_the_first_address_it_was_forwarded_for_with_retry_after() {
    let state = Arc::new(Origin::default());
    let at = origin(state).await.to_string();
    let routes = vec![route("/archive", &at, r"^/pub/sinclair/[^?#]+$", 4000, Duration::from_secs(5), "no-store")];
    let base = front(routes, Some(Limiter::new(60.0, 2.0, still())), still(), Timers::default().timer(), Heard::default().say()).await;
    let ask = |ip: &'static str| client().get(format!("{base}/archive/pub/sinclair/ok.tap")).header("x-forwarded-for", format!("{ip}, 10.0.0.1")).send();
    assert_eq!(ask("1.2.3.4").await.unwrap().status(), 200);
    assert_eq!(ask("1.2.3.4").await.unwrap().status(), 200);
    let refused = ask("1.2.3.4").await.unwrap();
    assert_eq!(refused.status(), 429);
    assert_eq!(refused.headers()["retry-after"], "30");
    assert_eq!(ask("5.6.7.8").await.unwrap().status(), 200);
    // And what is not a GET or a HEAD is refused before it counts.
    let posted = client().post(format!("{base}/archive/pub/sinclair/ok.tap")).send().await.unwrap();
    assert_eq!(posted.status(), 405);
    assert_eq!(posted.headers()["allow"], "GET, HEAD");
}

// --- With ZXInfo down: the ZXDB's own index ------------------------------------------------------------------------------

struct Down {
    base: String,
    state: Arc<Origin>,
    clock: Arc<AtomicU64>,
    heard: Heard,
    timers: Timers,
}

async fn zxinfo_down() -> Down {
    let state = Arc::new(Origin::default());
    let at = origin(state.clone()).await.to_string();
    let dead = dead().await;
    let index = Arc::new(Zxdb::of(INDEX));
    let route = |prefix: &str, at: &str| Route {
        prefix: prefix.into(),
        origin: format!("http://{at}/v3"),
        hosts: vec![at.into()],
        allow: Regex::new(r"^/(search|games/[0-9]{1,7}|suggest/[^/]{1,80})$").unwrap(),
        max_bytes: 1 << 20,
        timeout: Duration::from_secs(10),
        query: true,
        cache: "no-store".into(),
        fallback: Some(pass::Fallback { index: index.clone(), wait: Duration::from_millis(300), hold: Duration::from_secs(60) }),
    };
    let clock = Arc::new(AtomicU64::new(0));
    let now = clock.clone();
    let heard = Heard::default();
    let routes = vec![route("/zxinfo/v3", &at), route("/dead/v3", &dead)];
    let timers = Timers::default();
    let base = front(routes, None, Arc::new(move || now.load(Ordering::SeqCst)), timers.timer(), heard.say()).await;
    Down { base, state, clock, heard, timers }
}

impl Down {
    async fn search(&self, prefix: &str) -> reqwest::Response {
        get(format!("{}{prefix}/search?query=Saboteur&mode=compact&size=24&offset=0&sort=rel_desc&contenttype=SOFTWARE&machinetype=ZXSPECTRUM&availability=Available", self.base)).await
    }

    fn warnings(&self, said: &[Said]) -> Vec<String> {
        said.iter().filter_map(|s| match s { Said::Warning(w) => Some(w.clone()), _ => None }).collect()
    }

    fn errors(&self, said: &[Said]) -> Vec<String> {
        said.iter().filter_map(|s| match s { Said::Error(e) => Some(message(e)), _ => None }).collect()
    }
}

async fn json(res: reqwest::Response) -> serde_json::Value {
    serde_json::from_str(&res.text().await.unwrap()).unwrap()
}

#[tokio::test]
async fn answers_a_search_from_the_index_where_zxinfo_answers_502_and_says_so_once_as_a_warning_the_visitor_is_answered() {
    let down = zxinfo_down().await;
    let res = down.search("/zxinfo/v3").await;
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["x-answered-by"], "zxdb-index");
    assert_eq!(res.headers()["cache-control"], "no-store");
    assert_eq!(json(res).await["hits"]["hits"][0]["_source"]["title"], "Saboteur!");
    assert_eq!(down.state.asked.load(Ordering::SeqCst), 1);
    let said = down.heard.take();
    assert_eq!(down.errors(&said), Vec::<String>::new());
    let warnings = down.warnings(&said);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(Regex::new(r"^/zxinfo/v3: 127\.0\.0\.1:\d+ answered 502; answered from the ZXDB index for 60 s$").unwrap().is_match(&warnings[0]), "{warnings:?}");
}

#[tokio::test]
async fn then_answers_from_the_index_for_a_minute_without_asking_zxinfo_an_entry_by_its_id_among_it_then_asks_again() {
    let down = zxinfo_down().await;
    down.search("/zxinfo/v3").await;
    down.heard.take();
    down.clock.store(1_000, Ordering::SeqCst);
    down.state.mode.store(2, Ordering::SeqCst);
    down.state.asked.store(0, Ordering::SeqCst);
    let game = get(format!("{}/zxinfo/v3/games/0002514?mode=compact", down.base)).await;
    assert_eq!(game.headers()["x-answered-by"], "zxdb-index");
    assert_eq!(json(game).await["_source"]["title"], "International Match Day");
    assert_eq!(get(format!("{}/zxinfo/v3/games/0999999?mode=compact", down.base)).await.status(), 404);
    assert_eq!(down.state.asked.load(Ordering::SeqCst), 0);
    assert_eq!(down.errors(&down.heard.take()), Vec::<String>::new());
    down.clock.store(61_001, Ordering::SeqCst);
    let res = down.search("/zxinfo/v3").await;
    assert!(res.headers().get("x-answered-by").is_none());
    assert_eq!(json(res).await["hits"]["hits"][0]["_source"]["title"], "From ZXInfo");
    assert_eq!(down.state.asked.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn answers_from_the_index_where_zxinfo_gives_no_answer_in_time() {
    let down = zxinfo_down().await;
    down.state.mode.store(1, Ordering::SeqCst);
    // ZXInfo hangs, and its 10 s never end: the 300 ms, ended here, are all that can answer, where the server keeps them.
    let answered = tokio::time::timeout(Duration::from_secs(20), async { tokio::join!(down.search("/zxinfo/v3"), down.timers.due(Duration::from_millis(300))).0 });
    let res = answered.await.expect("no answer once its 300 ms were up");
    assert_eq!(res.headers()["x-answered-by"], "zxdb-index");
    assert_eq!(json(res).await["hits"]["hits"][0]["_id"], "0004293");
    let warnings = down.warnings(&down.heard.take());
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(Regex::new(r"gave no answer in 300 ms; answered from the ZXDB index").unwrap().is_match(&warnings[0]), "{warnings:?}");
}

#[tokio::test]
async fn answers_from_the_index_where_zxinfo_cannot_be_reached_at_all() {
    let down = zxinfo_down().await;
    let res = down.search("/dead/v3").await;
    assert_eq!(res.headers()["x-answered-by"], "zxdb-index");
    assert_eq!(json(res).await["hits"]["hits"][0]["_id"], "0004293");
    let said = down.heard.take();
    assert_eq!(down.errors(&said), Vec::<String>::new());
    let warnings = down.warnings(&said);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(Regex::new(r"could not be reached .*; answered from the ZXDB index").unwrap().is_match(&warnings[0]), "{warnings:?}");
}

#[tokio::test]
async fn says_zxinfo_is_down_where_the_index_has_no_answer_for_the_path_the_servers_error_once_with_its_stack() {
    let down = zxinfo_down().await;
    let res = get(format!("{}/zxinfo/v3/suggest/sabot", down.base)).await;
    assert_eq!(res.status(), 502);
    assert!(res.text().await.unwrap().contains("answered 502"));
    let said = down.heard.take();
    assert_eq!(down.warnings(&said), Vec::<String>::new());
    let errors = down.errors(&said);
    assert_eq!(errors.len(), 1, "{errors:?}");
    assert!(Regex::new(r"^/zxinfo/v3: 127\.0\.0\.1:\d+ answered 502\n").unwrap().is_match(&errors[0]), "{errors:?}");
    assert!(errors[0].contains("\n    at "), "no stack: {errors:?}");
}
