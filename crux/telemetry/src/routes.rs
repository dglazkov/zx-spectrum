//! `/nerd/event` and `/nerd/feedback`: what a product's pages send, printed as one line made of its own fields alone.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::DefaultBodyLimit;
use axum::http::{header, HeaderMap, StatusCode};
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

/// Where a line goes: standard output, but in the tests.
type Print = Arc<dyn Fn(&str) + Send + Sync>;

/// The two paths, for a product's router to take (`app.merge(telemetry::routes())`): each a POST of a JSON object,
/// up to `LIMIT`, printed on standard output as one line built again from its own fields, never the body as it came,
/// and answered 204; one whose name nerd would drop is answered 204 too, and printed not at all. `/nerd/event` takes a
/// list of up to `EVENTS` too, each its own line, so that what a page sends as it is torn down arrives whole or not at
/// all, as the part `load` sends a load's (crux#8). A body that is neither is answered 400, and nothing of it printed.
/// A load sent by a browser a probe drives, its user agent `HeadlessChrome`, is answered 204 and printed not at all,
/// so that a load nerd counts is a reader's (crux#23).
pub fn routes<S: Clone + Send + Sync + 'static>() -> Router<S> {
    routes_to(Arc::new(|line| {
        crate::write(std::io::stdout().lock(), line)
    }))
}

fn routes_to<S: Clone + Send + Sync + 'static>(print: Print) -> Router<S> {
    let to = print.clone();
    Router::new()
        .route(
            "/nerd/event",
            post(move |headers: HeaderMap, body: Bytes| async move {
                let probe = driven(&headers);
                answer(&body, |body| events(body, probe), &to)
            }),
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
            }),
        )
        .layer(DefaultBodyLimit::max(LIMIT))
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
        let app: Router = routes_to(Arc::new(move |line: &str| {
            to.lock().unwrap().push(line.to_string())
        }));
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
        let app: Router = routes_to(Arc::new(move |line: &str| {
            to.lock().unwrap().push(line.to_string())
        }));
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
