//! `/nerd/event` and `/nerd/feedback`: what a product's pages send, printed as one line made of its own fields alone.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Request};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{from_fn, Next};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::event::{shaped, Event};

/// The most a body sent to either path may be: 64 KB. A longer one is refused, 413, and nothing of it printed.
pub const LIMIT: usize = 64 * 1024;

/// The most events one body sent to `/nerd/event` may hold, as a list: a page's load is six. A longer list is
/// refused, 400, and nothing of it printed.
pub const EVENTS: usize = 16;

/// How many posts a minute one client may send to the two paths, together: a page sends a few a visit.
pub const RATE: u32 = 60;

/// How many posts one client may send at once, before it waits on `RATE`.
pub const BURST: u32 = 30;

/// Where a line goes: standard output, but in the tests.
type Print = Arc<dyn Fn(&str) + Send + Sync>;

/// What time it is: the machine's, but in the tests.
type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

/// The two paths, for a product's router to take (`app.merge(telemetry::routes())`): each a POST of a JSON object,
/// up to `LIMIT`, printed on standard output as one line built again from its own fields, never the body as it came,
/// and answered 204; one whose name nerd would drop is answered 204 too, and printed not at all. `/nerd/event` takes a
/// list of up to `EVENTS` too, each its own line, so that what a page sends as it is torn down arrives whole or not at
/// all, as the part `load` sends a load's (crux#8). A body that is neither is answered 400, and nothing of it printed.
/// A load sent by a browser a probe drives, its user agent `HeadlessChrome`, is answered 204 and printed not at all,
/// so that a load nerd counts is a reader's (crux#23). A client posting more than `RATE` a minute, past a burst of
/// `BURST`, is answered 429, before its body is read, and printed not at all (crux#38).
pub fn routes<S: Clone + Send + Sync + 'static>() -> Router<S> {
    routes_to(
        Arc::new(|line| crate::write(std::io::stdout().lock(), line)),
        Arc::new(Instant::now),
    )
}

fn routes_to<S: Clone + Send + Sync + 'static>(print: Print, clock: Clock) -> Router<S> {
    let to = print.clone();
    let limit = Arc::new(Limit::new(clock));
    let limited = from_fn(move |request: Request, next: Next| {
        let limit = limit.clone();
        async move {
            if limit.allows(&client(&request)) {
                next.run(request).await
            } else {
                StatusCode::TOO_MANY_REQUESTS.into_response()
            }
        }
    });
    Router::new()
        .route(
            "/nerd/event",
            post(move |headers: HeaderMap, body: Bytes| async move {
                let probe = driven(&headers);
                answer(&body, |body| events(body, probe), &to)
            })
            .route_layer(limited.clone()),
        )
        .route(
            "/nerd/feedback",
            post(move |body: Bytes| async move {
                answer(
                    &body,
                    |body| {
                        body.as_object()
                            .map(|body| feedback(body).into_iter().collect())
                    },
                    &print,
                )
            })
            .route_layer(limited),
        )
        .layer(DefaultBodyLimit::max(LIMIT))
}

/// Who sent a request: the first address of X-Forwarded-For, where Cloud Run's load balancer puts the client's, or
/// else the socket's, where the server was served with it (as the part `server` serves); "?" where neither is known.
fn client(request: &Request) -> String {
    let forwarded = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|first| !first.is_empty());
    if let Some(first) = forwarded {
        return first.to_string();
    }
    match request.extensions().get::<ConnectInfo<SocketAddr>>() {
        Some(ConnectInfo(socket)) => socket.ip().to_string(),
        None => "?".to_string(),
    }
}

/// Each client's share of the two paths, as a token bucket: `BURST` at most, refilled at `RATE` a minute.
struct Limit {
    clock: Clock,
    buckets: Mutex<Buckets>,
}

struct Buckets {
    by_client: HashMap<String, Bucket>,
    swept: Instant,
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Limit {
    fn new(clock: Clock) -> Self {
        let swept = clock();
        Limit {
            clock,
            buckets: Mutex::new(Buckets {
                by_client: HashMap::new(),
                swept,
            }),
        }
    }

    /// Whether `client` may post now, taking one from its share where it may.
    fn allows(&self, client: &str) -> bool {
        let now = (self.clock)();
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // A client whose bucket has filled again is as one never heard from: forgotten, once a minute, so that
        // clients come and gone do not pile up.
        let full = Duration::from_secs_f64(f64::from(BURST) * 60.0 / f64::from(RATE));
        if now.saturating_duration_since(buckets.swept) >= Duration::from_secs(60) {
            buckets.swept = now;
            buckets
                .by_client
                .retain(|_, bucket| now.saturating_duration_since(bucket.at) < full);
        }
        let bucket = buckets
            .by_client
            .entry(client.to_string())
            .or_insert(Bucket {
                tokens: f64::from(BURST),
                at: now,
            });
        let since = now.saturating_duration_since(bucket.at).as_secs_f64();
        bucket.tokens = (bucket.tokens + since * f64::from(RATE) / 60.0).min(f64::from(BURST));
        bucket.at = now;
        if bucket.tokens < 1.0 {
            return false;
        }
        bucket.tokens -= 1.0;
        true
    }
}

/// Prints the lines of a body, or answers 400 where `lines` finds it not of its shape.
fn answer(body: &[u8], lines: impl Fn(&Value) -> Option<Vec<String>>, print: &Print) -> StatusCode {
    let Some(lines) = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|body| lines(&body))
    else {
        return StatusCode::BAD_REQUEST;
    };
    for line in lines {
        print(&line);
    }
    StatusCode::NO_CONTENT
}

/// Whether the request came from a browser a probe drives: Chrome headless, as blog's probes and crux's open a page,
/// says so in its user agent (`HeadlessChrome/154.0.0.0`), with `--headless=new` as with the old headless.
fn driven(headers: &HeaderMap) -> bool {
    let agent = headers
        .get(header::USER_AGENT)
        .map(|agent| agent.as_bytes());
    agent.is_some_and(|agent| agent.windows(14).any(|word| word == b"HeadlessChrome"))
}

/// Whether an event is of a page's load, as the part `load` names them: `load.lcp`, `load.cls` and the rest.
fn of_a_load(event: &Event) -> bool {
    event.name().starts_with("load.")
}

/// The lines of the events of a body: one object, or a list of up to `EVENTS` of them; those nerd would drop left out,
/// and, where a probe sent them, those of a load.
fn events(body: &Value, probe: bool) -> Option<Vec<String>> {
    let line = |body| {
        let event = Event::from_body(body);
        if probe && of_a_load(&event) {
            return None;
        }
        event.line()
    };
    match body {
        Value::Object(body) => Some(line(body).into_iter().collect()),
        Value::Array(list) if list.len() <= EVENTS => {
            let list: Option<Vec<_>> = list.iter().map(Value::as_object).collect();
            Some(list?.into_iter().filter_map(line).collect())
        }
        _ => None,
    }
}

/// The line of the person's feedback, from the widget: their words, as they wrote them, the page's path, the
/// product's last events and its console's last errors. None where it has no words, which nerd would drop.
fn feedback(body: &Map<String, Value>) -> Option<String> {
    #[derive(Serialize)]
    struct Line<'a> {
        nerd: &'static str,
        words: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        page: Option<&'a str>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        events: Vec<&'a str>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        errors: Vec<&'a str>,
    }
    let texts = |field| -> Vec<&str> {
        let list = body.get(field).and_then(Value::as_array);
        list.into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect()
    };
    let words = body.get("words").and_then(Value::as_str)?;
    if words.trim().is_empty() {
        return None;
    }
    let line = Line {
        nerd: "feedback",
        words,
        page: body.get("page").and_then(Value::as_str),
        events: texts("events")
            .into_iter()
            .filter(|name| shaped(name))
            .collect(),
        errors: texts("errors")
            .into_iter()
            .filter(|said| !said.trim().is_empty())
            .collect(),
    };
    Some(serde_json::to_string(&line).expect("a feedback's line is JSON"))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Mutex;

    use axum::body::Body;
    use axum::http::{Method, Request};
    use tower::ServiceExt;

    /// What the routes answer to a request, and the lines they printed for it.
    async fn send(method: Method, path: &str, body: impl Into<Body>) -> (StatusCode, Vec<String>) {
        send_as(None, method, path, body).await
    }

    /// The same, sent by a browser whose user agent is `agent`.
    async fn send_as(
        agent: Option<&str>,
        method: Method,
        path: &str,
        body: impl Into<Body>,
    ) -> (StatusCode, Vec<String>) {
        let printed = Arc::new(Mutex::new(Vec::new()));
        let to = printed.clone();
        let app: Router = routes_to(
            Arc::new(move |line: &str| to.lock().unwrap().push(line.to_string())),
            Arc::new(Instant::now),
        );
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json");
        if let Some(agent) = agent {
            request = request.header("user-agent", agent);
        }
        let request = request.body(body.into()).unwrap();
        let status = app.oneshot(request).await.unwrap().status();
        let printed = printed.lock().unwrap().clone();
        (status, printed)
    }

    async fn post(path: &str, body: &str) -> (StatusCode, Vec<String>) {
        send(Method::POST, path, body.to_string()).await
    }

    #[tokio::test]
    async fn an_event_is_printed_from_its_fields_alone() {
        let body = r#"{"nerd":"event","name":"song.made","kind":"drums","n":4,"ms":18.5,
            "severity":"ERROR","message":"Error: no","user":"anna@example.com","nested":{"name":"x"}}"#;
        assert_eq!(
            post("/nerd/event", body).await,
            (
                StatusCode::NO_CONTENT,
                vec![
                    r#"{"nerd":"event","name":"song.made","kind":"drums","n":4,"ms":18.5}"#
                        .to_string()
                ]
            )
        );
    }

    #[tokio::test]
    async fn a_field_of_another_type_is_left_out() {
        let body = r#"{"name":"take.kept","kind":3,"n":"4","ms":null}"#;
        assert_eq!(
            post("/nerd/event", body).await,
            (
                StatusCode::NO_CONTENT,
                vec![r#"{"nerd":"event","name":"take.kept"}"#.to_string()]
            )
        );
        let body = r#"{"name":"take.kept","kind":"Milk","n":-2}"#;
        assert_eq!(
            post("/nerd/event", body).await,
            (
                StatusCode::NO_CONTENT,
                vec![r#"{"nerd":"event","name":"take.kept","n":-2}"#.to_string()]
            )
        );
    }

    #[tokio::test]
    async fn an_event_nerd_would_drop_is_not_printed() {
        for body in [
            r#"{}"#,
            r#"{"severity":"ERROR","message":"Error: made up"}"#,
            r#"{"name":"Anna.opened","kind":"drums"}"#,
            r#"{"name":["song.made"]}"#,
            r#"{"name":"song made"}"#,
        ] {
            assert_eq!(
                post("/nerd/event", body).await,
                (StatusCode::NO_CONTENT, vec![]),
                "{body}"
            );
        }
    }

    #[tokio::test]
    async fn a_list_of_events_is_a_line_each() {
        let body = r#"[{"name":"load.lcp","kind":"post.phone","ms":1830,"severity":"ERROR"},
            {"name":"Anna.opened"},{"name":"load.cls","kind":"post.phone","n":42}]"#;
        assert_eq!(
            post("/nerd/event", body).await,
            (
                StatusCode::NO_CONTENT,
                vec![
                    r#"{"nerd":"event","name":"load.lcp","kind":"post.phone","ms":1830}"#
                        .to_string(),
                    r#"{"nerd":"event","name":"load.cls","kind":"post.phone","n":42}"#.to_string(),
                ]
            )
        );
        assert_eq!(
            post("/nerd/event", "[]").await,
            (StatusCode::NO_CONTENT, vec![])
        );
        // As navigator.sendBeacon sends it: text, not JSON, by its type.
        let request = Request::builder()
            .method(Method::POST)
            .uri("/nerd/event")
            .header("content-type", "text/plain;charset=UTF-8")
            .body(Body::from(
                r#"[{"name":"load.ready","kind":"home.desktop","ms":120}]"#,
            ))
            .unwrap();
        let printed = Arc::new(Mutex::new(Vec::new()));
        let to = printed.clone();
        let app: Router = routes_to(
            Arc::new(move |line: &str| to.lock().unwrap().push(line.to_string())),
            Arc::new(Instant::now),
        );
        assert_eq!(
            app.oneshot(request).await.unwrap().status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            *printed.lock().unwrap(),
            [r#"{"nerd":"event","name":"load.ready","kind":"home.desktop","ms":120}"#]
        );
    }

    /// A load's list, as the part `load` sends it, with an event of the product's own among it.
    const LOAD: &str = r#"[{"name":"load.ttfb","kind":"post.phone","ms":80},
        {"name":"load.lcp","kind":"post.phone","ms":1830},{"name":"load.cls","kind":"post.phone","n":42},
        {"name":"song.made","kind":"drums"},{"name":"load.ready","kind":"post.phone","ms":900}]"#;

    /// Chrome headless, as blog's probe/weigh.mjs and crux's probe open a page, new and old.
    const HEADLESS: [&str; 3] = [
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/111.0.5563.64 Safari/537.36",
    ];

    /// Readers' browsers, and a crawler, as blog's request log has them; and a request that says no agent at all.
    const READERS: [Option<&str>; 6] = [
        Some("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"),
        Some("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36"),
        Some("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"),
        Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0"),
        Some("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/154.0.0.0 Safari/537.36"),
        None,
    ];

    #[tokio::test]
    async fn a_load_a_probe_sent_is_not_printed() {
        for agent in HEADLESS {
            assert_eq!(
                send_as(Some(agent), Method::POST, "/nerd/event", LOAD).await,
                (
                    StatusCode::NO_CONTENT,
                    vec![r#"{"nerd":"event","name":"song.made","kind":"drums"}"#.to_string()]
                ),
                "{agent}"
            );
            // One event alone, as a page sends it outside a load.
            let one = r#"{"name":"load.lcp","kind":"home.desktop","ms":700}"#;
            assert_eq!(
                send_as(Some(agent), Method::POST, "/nerd/event", one).await,
                (StatusCode::NO_CONTENT, vec![]),
                "{agent}"
            );
            // Feedback is a person's words, whatever their browser.
            assert_eq!(
                send_as(
                    Some(agent),
                    Method::POST,
                    "/nerd/feedback",
                    r#"{"words":"Slow."}"#
                )
                .await,
                (
                    StatusCode::NO_CONTENT,
                    vec![r#"{"nerd":"feedback","words":"Slow."}"#.to_string()]
                ),
                "{agent}"
            );
        }
    }

    #[tokio::test]
    async fn a_load_a_reader_sent_is_printed_whole() {
        let whole = vec![
            r#"{"nerd":"event","name":"load.ttfb","kind":"post.phone","ms":80}"#.to_string(),
            r#"{"nerd":"event","name":"load.lcp","kind":"post.phone","ms":1830}"#.to_string(),
            r#"{"nerd":"event","name":"load.cls","kind":"post.phone","n":42}"#.to_string(),
            r#"{"nerd":"event","name":"song.made","kind":"drums"}"#.to_string(),
            r#"{"nerd":"event","name":"load.ready","kind":"post.phone","ms":900}"#.to_string(),
        ];
        for agent in READERS {
            assert_eq!(
                send_as(agent, Method::POST, "/nerd/event", LOAD).await,
                (StatusCode::NO_CONTENT, whole.clone()),
                "{agent:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_list_is_whole_or_not_at_all() {
        let event = r#"{"name":"load.ttfb","ms":80}"#;
        let list = |n: usize| format!("[{}]", vec![event; n].join(","));
        assert_eq!(EVENTS, 16);
        assert_eq!(post("/nerd/event", &list(EVENTS)).await.1.len(), EVENTS);
        for body in [
            list(EVENTS + 1),
            format!(r#"[{event},"load.fcp"]"#),
            format!("[{event},[{event}]]"),
            format!("[{event},null]"),
        ] {
            assert_eq!(
                post("/nerd/event", &body).await,
                (StatusCode::BAD_REQUEST, vec![]),
                "{body}"
            );
        }
        // Feedback is one, never a list.
        let body = r#"[{"words":"Slow."}]"#;
        assert_eq!(
            post("/nerd/feedback", body).await,
            (StatusCode::BAD_REQUEST, vec![])
        );
    }

    #[tokio::test]
    async fn feedback_is_printed_from_its_fields_alone() {
        let body = r#"{"nerd":"feedback","words":"The kick is too quiet after the drop.","page":"/song",
            "events":["take.kept","song.made"],"errors":["TypeError: x is undefined"],
            "severity":"ERROR","email":"anna@example.com"}"#;
        assert_eq!(
            post("/nerd/feedback", body).await,
            (
                StatusCode::NO_CONTENT,
                vec![concat!(
                    r#"{"nerd":"feedback","words":"The kick is too quiet after the drop.","page":"/song","#,
                    r#""events":["take.kept","song.made"],"errors":["TypeError: x is undefined"]}"#
                )
                .to_string()]
            )
        );
    }

    #[tokio::test]
    async fn feedback_keeps_only_what_is_of_its_shape() {
        let body = r#"{"words":"Slow.","page":7,"events":["take.kept","Anna",3,"x y"],"errors":"Error: one"}"#;
        assert_eq!(
            post("/nerd/feedback", body).await,
            (
                StatusCode::NO_CONTENT,
                vec![r#"{"nerd":"feedback","words":"Slow.","events":["take.kept"]}"#.to_string()]
            )
        );
        for body in [
            r#"{"page":"/"}"#,
            r#"{"words":"  \n"}"#,
            r#"{"words":4,"severity":"ERROR"}"#,
        ] {
            assert_eq!(
                post("/nerd/feedback", body).await,
                (StatusCode::NO_CONTENT, vec![]),
                "{body}"
            );
        }
    }

    #[tokio::test]
    async fn a_body_that_is_not_an_object_is_refused() {
        for path in ["/nerd/event", "/nerd/feedback"] {
            for body in [
                "",
                "not json",
                r#"["song.made"]"#,
                r#""song.made""#,
                r#"{"name":"song.made""#,
            ] {
                assert_eq!(
                    post(path, body).await,
                    (StatusCode::BAD_REQUEST, vec![]),
                    "{path} {body:?}"
                );
            }
        }
    }

    /// A body of `size` bytes, an event whose name is song.made, padded out with spaces.
    fn sized(size: usize) -> String {
        let body = r#"{"name":"song.made"}"#;
        format!("{body}{}", " ".repeat(size - body.len()))
    }

    #[tokio::test]
    async fn a_body_over_64_kb_is_refused() {
        assert_eq!(LIMIT, 65536);
        let line = r#"{"nerd":"event","name":"song.made"}"#.to_string();
        assert_eq!(
            post("/nerd/event", &sized(LIMIT)).await,
            (StatusCode::NO_CONTENT, vec![line])
        );
        assert_eq!(
            post("/nerd/event", &sized(LIMIT + 1)).await,
            (StatusCode::PAYLOAD_TOO_LARGE, vec![])
        );
        assert_eq!(
            post("/nerd/feedback", &sized(LIMIT + 1)).await.0,
            StatusCode::PAYLOAD_TOO_LARGE
        );

        // Sent in pieces, with no length said ahead, as a stream is.
        let pieces: Vec<Result<String, std::io::Error>> =
            (0..65).map(|_| Ok(" ".repeat(1024))).collect();
        let stream = Body::from_stream(futures_util::stream::iter(pieces));
        assert_eq!(
            send(Method::POST, "/nerd/event", stream).await,
            (StatusCode::PAYLOAD_TOO_LARGE, vec![])
        );
    }

    /// The routes on a clock of the test's, which moves only as it says, and the lines they printed.
    struct Clocked {
        app: Router,
        now: Arc<Mutex<Instant>>,
        printed: Arc<Mutex<Vec<String>>>,
    }

    impl Clocked {
        fn new() -> Self {
            let now = Arc::new(Mutex::new(Instant::now()));
            let printed = Arc::new(Mutex::new(Vec::new()));
            let (to, at) = (printed.clone(), now.clone());
            let app = routes_to(
                Arc::new(move |line: &str| to.lock().unwrap().push(line.to_string())),
                Arc::new(move || *at.lock().unwrap()),
            );
            Clocked { app, now, printed }
        }

        fn wait(&self, seconds: u64) {
            *self.now.lock().unwrap() += Duration::from_secs(seconds);
        }

        /// What a client answers to: `forwarded` as X-Forwarded-For, `socket` as the address it connected from.
        async fn send(
            &self,
            forwarded: Option<&str>,
            socket: Option<&str>,
            method: Method,
            path: &str,
            body: impl Into<Body>,
        ) -> (StatusCode, Vec<String>) {
            let before = self.printed.lock().unwrap().len();
            let mut request = Request::builder().method(method).uri(path);
            if let Some(forwarded) = forwarded {
                request = request.header("x-forwarded-for", forwarded);
            }
            let mut request = request.body(body.into()).unwrap();
            if let Some(socket) = socket {
                let socket: SocketAddr = socket.parse().unwrap();
                request.extensions_mut().insert(ConnectInfo(socket));
            }
            let status = self.app.clone().oneshot(request).await.unwrap().status();
            let printed = self.printed.lock().unwrap()[before..].to_vec();
            (status, printed)
        }

        async fn post(&self, forwarded: &str, path: &str) -> (StatusCode, Vec<String>) {
            let body = match path {
                "/nerd/event" => r#"{"name":"song.made"}"#,
                _ => r#"{"words":"Slow."}"#,
            };
            self.send(Some(forwarded), None, Method::POST, path, body)
                .await
        }

        /// How many of `n` posts in an instant, from `forwarded`, were answered 204 and printed.
        async fn let_in(&self, forwarded: &str, n: usize) -> usize {
            let mut answered = 0;
            for i in 0..n {
                let path = ["/nerd/event", "/nerd/feedback"][i % 2];
                match self.post(forwarded, path).await {
                    (StatusCode::NO_CONTENT, printed) if printed.len() == 1 => answered += 1,
                    (StatusCode::TOO_MANY_REQUESTS, printed) if printed.is_empty() => {}
                    other => panic!("{forwarded} {path}: {other:?}"),
                }
            }
            answered
        }
    }

    const EVENT: &str = r#"{"name":"song.made"}"#;
    const LINE: &str = r#"{"nerd":"event","name":"song.made"}"#;

    #[tokio::test]
    async fn a_client_posting_too_often_is_refused_and_let_back_in_as_its_minute_goes_on() {
        assert_eq!((RATE, BURST), (60, 30));
        let routes = Clocked::new();
        // The client is the first address Cloud Run's load balancer forwards; both paths are one share.
        let anna = "203.0.113.7, 10.0.0.1";
        assert_eq!(routes.let_in(anna, BURST as usize).await, 30);
        for path in ["/nerd/event", "/nerd/feedback"] {
            assert_eq!(
                routes.post(anna, path).await,
                (StatusCode::TOO_MANY_REQUESTS, vec![]),
                "{path}"
            );
        }
        // Refused before its body is read: one over the limit is 429, not 413.
        assert_eq!(
            routes
                .send(
                    Some(anna),
                    None,
                    Method::POST,
                    "/nerd/event",
                    sized(LIMIT + 1)
                )
                .await,
            (StatusCode::TOO_MANY_REQUESTS, vec![])
        );
        // The same client by another way through the balancer; what is not a post is still answered 405.
        assert_eq!(
            routes.post("203.0.113.7", "/nerd/event").await,
            (StatusCode::TOO_MANY_REQUESTS, vec![])
        );
        assert_eq!(
            routes
                .send(Some(anna), None, Method::GET, "/nerd/event", Body::empty())
                .await,
            (StatusCode::METHOD_NOT_ALLOWED, vec![])
        );

        // Another client is its own, whatever the address of the balancer's socket.
        let ben = "198.51.100.2, 10.0.0.1";
        assert_eq!(
            routes
                .send(
                    Some(ben),
                    Some("10.0.0.1:41000"),
                    Method::POST,
                    "/nerd/event",
                    EVENT
                )
                .await,
            (StatusCode::NO_CONTENT, vec![LINE.to_string()])
        );

        // A second later, one more; five seconds later, five; half a minute later, the whole burst again.
        routes.wait(1);
        assert_eq!(routes.let_in(anna, 3).await, 1);
        routes.wait(5);
        assert_eq!(routes.let_in(anna, 8).await, 5);
        routes.wait(30);
        assert_eq!(routes.let_in(anna, 40).await, 30);
        routes.wait(600);
        assert_eq!(routes.let_in(anna, 40).await, 30);
        assert_eq!(routes.let_in(ben, 40).await, 30);
    }

    #[tokio::test]
    async fn a_client_not_forwarded_is_its_socket_address() {
        let routes = Clocked::new();
        let post = |socket| routes.send(None, socket, Method::POST, "/nerd/event", EVENT);
        for _ in 0..BURST {
            assert_eq!(post(Some("192.0.2.9:5000")).await.0, StatusCode::NO_CONTENT);
        }
        // Another connection from the same address is the same client; another address is another.
        assert_eq!(
            post(Some("192.0.2.9:5001")).await,
            (StatusCode::TOO_MANY_REQUESTS, vec![])
        );
        assert_eq!(
            post(Some("[2001:db8::1]:5000")).await,
            (StatusCode::NO_CONTENT, vec![LINE.to_string()])
        );
        // An empty X-Forwarded-For says no one: the socket is the client.
        assert_eq!(
            routes
                .send(
                    Some(" "),
                    Some("192.0.2.9:5002"),
                    Method::POST,
                    "/nerd/event",
                    EVENT
                )
                .await,
            (StatusCode::TOO_MANY_REQUESTS, vec![])
        );
        // Where neither is known, every such request is the one client.
        for _ in 0..BURST {
            assert_eq!(post(None).await.0, StatusCode::NO_CONTENT);
        }
        assert_eq!(post(None).await, (StatusCode::TOO_MANY_REQUESTS, vec![]));
    }

    #[test]
    fn a_client_whose_share_is_whole_again_is_forgotten() {
        let now = Arc::new(Mutex::new(Instant::now()));
        let at = now.clone();
        let limit = Limit::new(Arc::new(move || *at.lock().unwrap()));
        let wait = |seconds| *now.lock().unwrap() += Duration::from_secs(seconds);
        for client in 0..1000 {
            assert!(limit.allows(&format!("198.51.100.{client}")));
        }
        assert!(limit.allows("anna"));
        wait(40);
        assert!(limit.allows("ben"));
        assert_eq!(limit.buckets.lock().unwrap().by_client.len(), 1002);
        // A minute on, those last heard from more than half a minute ago are full again, and forgotten.
        wait(20);
        assert!(limit.allows("ben"));
        assert_eq!(limit.buckets.lock().unwrap().by_client.len(), 1);
        // One refused is not forgotten while its share fills.
        for _ in 0..BURST {
            limit.allows("anna");
        }
        assert!(!limit.allows("anna"));
        wait(60);
        for _ in 0..BURST - 1 {
            assert!(limit.allows("anna"));
        }
    }

    #[tokio::test]
    async fn only_a_post_is_answered() {
        for path in ["/nerd/event", "/nerd/feedback"] {
            assert_eq!(
                send(Method::GET, path, Body::empty()).await,
                (StatusCode::METHOD_NOT_ALLOWED, vec![])
            );
        }
        assert_eq!(
            post("/nerd/other", r#"{"name":"song.made"}"#).await,
            (StatusCode::NOT_FOUND, vec![])
        );
    }
}
