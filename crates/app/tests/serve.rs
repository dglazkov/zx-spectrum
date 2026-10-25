//! The server as the image runs it (the binary, on a built directory of the test's own): the page and the build log
//! handed out, each with the load's tag, the widget loaded once, the fonts kept a week, no cross-origin isolation; and
//! nerd's paths, /nerd/event and /nerd/feedback, as crux's telemetry prints them, ported from the block "nerd's paths"
//! of web/tests/server.test.mjs.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// The server, running, and what it prints, a line at a time.
struct Running {
    child: Child,
    base: String,
    lines: mpsc::Receiver<String>,
    dir: std::path::PathBuf,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// A build as Vite writes it: the two pages (the first loading the widget itself, as web/index.html does), a hashed
/// asset, a font.
fn dist(dir: &Path) {
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::create_dir_all(dir.join("fonts")).unwrap();
    let page = "<!doctype html><html><head><meta charset=\"utf-8\"><script src=\"/nerd-feedback.js\"></script><title>ZX Spectrum</title></head><body><div id=\"app\"></div></body></html>";
    std::fs::write(dir.join("index.html"), page).unwrap();
    std::fs::write(dir.join("how.html"), "<!doctype html><html><head><title>ZX Spectrum Build Log</title></head><body></body></html>").unwrap();
    std::fs::write(dir.join("assets/index-Bx7kQ2mZ.js"), "console.log(1)").unwrap();
    std::fs::write(dir.join("fonts/plex-mono-400.woff2"), [0u8; 64]).unwrap();
}

fn start() -> Running {
    let dir = std::env::temp_dir().join(format!("zx-app-serve-{}-{:?}", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_dir_all(&dir);
    dist(&dir);
    let mut child = Command::new(env!("CARGO_BIN_EXE_app"))
        .arg(&dir)
        .env("PORT", "0")
        .env("ZXDB_INDEX", dir.join("none.txt.gz"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let (tx, lines) = mpsc::channel();
    let out = BufReader::new(child.stdout.take().unwrap());
    std::thread::spawn(move || {
        for line in out.lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                return;
            }
        }
    });
    let first = lines.recv_timeout(Duration::from_secs(60)).expect("the server said nothing");
    let addr = first.strip_prefix("listening on http://0.0.0.0:").unwrap_or_else(|| panic!("not where it listens: {first}"));
    Running { child, base: format!("http://127.0.0.1:{addr}"), lines, dir }
}

impl Running {
    /// The next line printed. A marker event is sent after what should print nothing, and its line is the next.
    fn next(&self) -> String {
        self.lines.recv_timeout(Duration::from_secs(20)).expect("nothing printed")
    }

    async fn post(&self, path: &str, body: impl Into<reqwest::Body>) -> Result<reqwest::Response, reqwest::Error> {
        reqwest::Client::new().post(format!("{}{path}", self.base)).header("content-type", "application/json").body(body).send().await
    }

    /// Sends the marker, and says whether it is the next line printed: nothing was printed before it.
    async fn nothing_printed(&self) -> bool {
        assert_eq!(self.post("/nerd/event", r#"{"name":"test.marker"}"#).await.unwrap().status(), 204);
        self.next() == r#"{"nerd":"event","name":"test.marker"}"#
    }
}

#[tokio::test]
async fn prints_an_event_as_one_line_of_its_own_fields_and_nothing_else_of_the_body() {
    let s = start();
    let body = r#"{"nerd":"event","name":"game.loaded","kind":"shelf","ms":830,"severity":"ERROR","title":"Saboteur","message":"x"}"#;
    assert_eq!(s.post("/nerd/event", body).await.unwrap().status(), 204);
    assert_eq!(s.next(), r#"{"nerd":"event","name":"game.loaded","kind":"shelf","ms":830}"#);
}

#[tokio::test]
async fn prints_feedback_as_one_line_of_its_own_fields_the_words_the_page_the_events_and_the_errors() {
    let s = start();
    let body = serde_json::json!({ "words": "The tape loads too slowly.", "page": "/", "events": ["game.loaded", "game.started"], "errors": ["TypeError: x"], "severity": "ERROR", "nerd": "event", "httpRequest": {} });
    assert_eq!(s.post("/nerd/feedback", body.to_string()).await.unwrap().status(), 204);
    let line: serde_json::Value = serde_json::from_str(&s.next()).unwrap();
    assert_eq!(line, serde_json::json!({ "nerd": "feedback", "words": "The tape loads too slowly.", "page": "/", "events": ["game.loaded", "game.started"], "errors": ["TypeError: x"] }));
    assert!(s.nothing_printed().await);
}

// The client's share of nerd's paths (60 a minute, a burst of 30, which web/server.mjs had) is crux's telemetry's to
// give: dglazkov/crux#38.
#[tokio::test]
async fn refuses_what_is_not_a_post_of_a_json_object_up_to_64_kb_and_prints_nothing_for_it() {
    let s = start();
    assert_eq!(reqwest::get(format!("{}/nerd/event", s.base)).await.unwrap().status(), 405);
    assert_eq!(s.post("/nerd/event", "not json").await.unwrap().status(), 400);
    assert_eq!(s.post("/nerd/event", "[1,2]").await.unwrap().status(), 400);
    assert_eq!(s.post("/nerd/event", "null").await.unwrap().status(), 400);
    let large = s.post("/nerd/feedback", serde_json::json!({ "words": "a".repeat(70 * 1024) }).to_string()).await;
    assert!(large.is_err() || large.unwrap().status() == 413);
    assert!(s.nothing_printed().await);
}

#[tokio::test]
async fn leaves_every_other_path_to_the_page_its_spellings_with_them() {
    let s = start();
    for path in ["/nerd", "/nerd/", "/nerd/events", "/nerd/event/x", "/NERD/event", "/x/nerd/event"] {
        let status = s.post(path, r#"{"name":"x"}"#).await.unwrap().status();
        assert_ne!(status, 204, "{path}");
    }
    assert!(s.nothing_printed().await);
    assert_eq!(s.post("/nerd/event?x=1", r#"{"name":"game.loaded"}"#).await.unwrap().status(), 204);
    assert_eq!(s.next(), r#"{"nerd":"event","name":"game.loaded"}"#);
}

#[tokio::test]
async fn hands_out_both_pages_each_load_measured_the_widget_once_and_no_isolation() {
    let s = start();
    for (path, view) in [("/", "home"), ("/index.html", "home"), ("/how.html", "how")] {
        let res = reqwest::get(format!("{}{path}", s.base)).await.unwrap();
        assert_eq!(res.status(), 200, "{path}");
        assert!(res.headers()["content-type"].to_str().unwrap().starts_with("text/html"), "{path}");
        assert!(res.headers().get("cross-origin-opener-policy").is_none(), "{path}");
        assert!(res.headers().get("cross-origin-embedder-policy").is_none(), "{path}");
        let html = res.text().await.unwrap();
        let tag = format!("<script data-view=\"{view}\">");
        let at = html.find(&tag).unwrap_or_else(|| panic!("{path}: no load tag for {view}"));
        assert!(html[at..].find("</script></head>").is_some(), "{path}: the load's tag is not at the end of the head");
        let widgets = html.matches("/nerd-feedback.js").count();
        assert_eq!(widgets, if view == "home" { 1 } else { 0 }, "{path}: the widget is loaded {widgets} times");
    }
    let widget = reqwest::get(format!("{}/nerd-feedback.js", s.base)).await.unwrap();
    assert_eq!(widget.status(), 200);
    assert!(widget.headers()["content-type"].to_str().unwrap().starts_with("text/javascript"));
    assert!(widget.text().await.unwrap().contains("nerdFeedback"));
}

#[tokio::test]
async fn keeps_the_fonts_a_week_the_hashed_assets_a_year_and_says_what_is_not_there() {
    let s = start();
    let font = reqwest::get(format!("{}/fonts/plex-mono-400.woff2", s.base)).await.unwrap();
    assert_eq!(font.status(), 200);
    assert_eq!(font.headers()["cache-control"], "public, max-age=604800");
    assert_eq!(font.headers()["content-type"], "font/woff2");
    let asset = reqwest::get(format!("{}/assets/index-Bx7kQ2mZ.js", s.base)).await.unwrap();
    assert_eq!(asset.headers()["cache-control"], "public, max-age=31536000, immutable");
    assert_eq!(reqwest::get(format!("{}/nothing.js", s.base)).await.unwrap().status(), 404);
    // The pass-through is in front of the files: a path under it that it does not pass is refused.
    assert_eq!(reqwest::get(format!("{}/archive/index.php", s.base)).await.unwrap().status(), 403);
}
