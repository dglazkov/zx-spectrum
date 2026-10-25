//! The pass-through, in front of the page's files:
//!
//!   /archive/<path>    https://spectrumcomputing.co.uk/<path>, for the files the page uses only: Spectrum files,
//!                      their manuals and their pictures, in the archive's directories of software (games, demos,
//!                      utilities...) and the ZXDB's entries; not its books or magazines. The archive's files come
//!                      without cross-origin headers, so the page cannot fetch them itself. Up to 16 MB, a minute for
//!                      the whole of it; nothing is kept on disk.
//!   /zxinfo/v3/<path>  https://api.zxinfo.dk/v3/<path>, for /search, /games/<id> and /suggest/<term> only: the API's
//!                      answers carry Access-Control-Allow-Origin twice, which browsers refuse (docs/web.md), and it
//!                      asks its clients to say who they are, which a browser cannot. Where the API answers 5xx, cannot
//!                      be reached, or has not answered within 5 s, /search and /games/<id> are answered from the
//!                      ZXDB's own index instead ([`crate::zxdb`], built from the ZXDB's dump into the image), and for
//!                      a minute after without asking the API; the API stays the first choice.
//!
//! What goes wrong is said once, where it is met ([`Said`]): what the server cannot mend (the origin not reached, a
//! 5xx with nothing to answer in its place) an error with its stack, as crux's telemetry logs one; what is not the
//! server's failure (the archive slow, a redirect elsewhere, a file too large) a line at WARNING.

use std::collections::HashMap;
use std::io;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::connect_info::ConnectInfo;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode};
use axum::middleware::{self, Next};
use regex::Regex;
use reqwest::Url;

use crate::conn::Peer;
use crate::zxdb::Zxdb;

/// Who asks, as the ZXInfo API asks its clients to say.
pub const AGENT: &str = "zx-spectrum (https://zx-spectrum.lab.glazkov.ai)";

/// Where an answer from the ZXDB's own index is said to be from, in `X-Answered-By`.
pub const ANSWERED_BY: &str = "zxdb-index";

/// What comes through is data for the page, never a page: an HTML answer (an error page) opened on this origin runs
/// nothing and reaches nothing.
const POLICY: &str = "default-src 'none'; sandbox";

/// What may be passed through, where to, and how much of it.
pub struct Route {
    pub prefix: String,
    pub origin: String,
    /// Hosts (with a port, where it is not the scheme's) that redirects may go to.
    pub hosts: Vec<String>,
    /// The paths passed through, as they are once decoded.
    pub allow: Regex,
    pub max_bytes: u64,
    /// For the whole exchange, the body's streaming to the client included.
    pub timeout: Duration,
    /// Whether the query string goes with the path.
    pub query: bool,
    /// The Cache-Control of an OK answer.
    pub cache: String,
    pub fallback: Option<Fallback>,
}

/// What answers in the origin's place where it is down, how long the origin has to begin its answer, and how long
/// the fallback answers after without asking the origin.
pub struct Fallback {
    pub index: Arc<Zxdb>,
    pub wait: Duration,
    pub hold: Duration,
}

/// The two routes: the archive, and the ZXInfo API at `zxinfo` where it is given (a stand-in, for a test: its host
/// alone is followed), answered from the index at `index` where it is down.
pub fn routes(zxinfo: Option<&str>, index: Arc<Zxdb>) -> Vec<Route> {
    let (origin, hosts) = match zxinfo {
        Some(o) => (o.to_string(), vec![host(&Url::parse(o).expect("ZXINFO_ORIGIN is a URL"))]),
        None => ("https://api.zxinfo.dk/v3".into(), vec!["api.zxinfo.dk".into(), "internal.zxinfo.dk".into()]),
    };
    vec![
        Route {
            prefix: "/archive".into(),
            origin: "https://spectrumcomputing.co.uk".into(),
            hosts: vec!["spectrumcomputing.co.uk".into(), "www.spectrumcomputing.co.uk".into()],
            // The software's directories and the ZXDB's entries (and its pokes); Spectrum files, text and pictures.
            allow: Regex::new(r"(?i)^/(pub/sinclair/(games|games-info|games-inlays|games-maps|screens|demos|utils|tools|educational|compilations|slt)|zxdb/sinclair/(entries|pokes))/[^?#]+\.(zip|tap|tzx|csw|pzx|z80|sna|szx|slt|scr|txt|pok|jpe?g|gif|png)$").unwrap(),
            max_bytes: 16 * 1024 * 1024,
            timeout: Duration::from_secs(60),
            query: false,
            cache: "public, max-age=86400".into(),
            fallback: None,
        },
        Route {
            prefix: "/zxinfo/v3".into(),
            origin,
            hosts,
            allow: Regex::new(r"^/(search|games/[0-9]{1,7}|suggest/[^/]{1,80})$").unwrap(),
            max_bytes: 4 * 1024 * 1024,
            timeout: Duration::from_secs(15),
            query: true,
            cache: "public, max-age=600".into(),
            fallback: Some(Fallback { index, wait: Duration::from_secs(5), hold: Duration::from_secs(60) }),
        },
    ]
}

/// A URL's host as `Location` is checked against: with its port, where it is not the scheme's.
fn host(url: &Url) -> String {
    let name = url.host_str().unwrap_or("");
    match url.port() {
        Some(port) => format!("{name}:{port}"),
        None => name.to_string(),
    }
}

/// Where a request is passed through to.
#[derive(Debug)]
pub struct Target {
    /// Which of the routes.
    pub route: usize,
    pub url: String,
    /// Its path under the route's prefix, decoded, as it was checked.
    pub path: String,
    /// Its query string, as it came, where the route takes one.
    pub query: String,
}

/// Decodes `%XX`, as JavaScript's `decodeURIComponent`: none where a `%` is not followed by two hex digits, or what it
/// decodes to is not UTF-8.
fn decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok().filter(|_| hex.bytes().all(|b| b.is_ascii_hexdigit()))?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Encodes a segment, as JavaScript's `encodeURIComponent`: all but `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
fn encode(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for &b in segment.as_bytes() {
        match b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            true => out.push(b as char),
            false => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Where a request's path (as it came, percent-encoded) is passed through to, or none if it is not one to pass
/// through. A path with a '.' or '..' segment, an empty one, a backslash or a control character is refused; each
/// segment is encoded again, so that what reaches the archive is exactly the path that was checked.
pub fn target(raw_path: &str, raw_query: &str, routes: &[Route]) -> Option<Target> {
    for (i, route) in routes.iter().enumerate() {
        let Some(rest) = raw_path.strip_prefix(route.prefix.as_str()).filter(|r| r.starts_with('/')) else {
            continue;
        };
        let path = decode(rest)?;
        if path.chars().any(|c| ('\u{0}'..='\u{1f}').contains(&c) || c == '\u{7f}' || c == '\\') {
            return None;
        }
        let segments: Vec<&str> = path.split('/').collect();
        if segments.iter().enumerate().any(|(i, s)| (i > 0 && s.is_empty()) || *s == "." || *s == "..") {
            return None;
        }
        if !route.allow.is_match(&path) {
            return None;
        }
        let query = match route.query {
            true => raw_query.to_string(),
            false => String::new(),
        };
        let encoded: Vec<String> = segments.iter().map(|s| encode(s)).collect();
        let url = format!("{}{}{}", route.origin, encoded.join("/"), if query.is_empty() { String::new() } else { format!("?{query}") });
        return Some(Target { route: i, url, path, query });
    }
    None
}

/// What goes wrong, said once: a line at WARNING, or an error's line with its stack, as crux's telemetry writes one.
#[derive(Clone, Debug, PartialEq)]
pub enum Said {
    Warning(String),
    Error(String),
}

/// Where what goes wrong is said.
pub type Say = Arc<dyn Fn(Said) + Send + Sync>;

/// Says it as Cloud Logging reads it: a warning as one line of JSON on standard output, an error's line on standard
/// error.
pub fn say_out() -> Say {
    Arc::new(|said| match said {
        Said::Warning(message) => {
            let line = serde_json::json!({ "severity": "WARNING", "message": message }).to_string();
            println!("{line}");
        }
        Said::Error(line) => eprintln!("{line}"),
    })
}

/// Milliseconds, as the pass-through's clock reads them: a test gives its own.
pub type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

/// Milliseconds since the server began.
pub fn wall() -> Clock {
    let start = Instant::now();
    Arc::new(move || start.elapsed().as_millis() as u64)
}

/// Requests passed through, a client at a time: so many a minute, as a token bucket refilled steadily. The page asks
/// for a few a game (its tape, its manual, its inlay, a search or two); a client asking for hundreds a minute is not
/// the page.
pub struct Limiter {
    per_minute: f64,
    burst: f64,
    now: Clock,
    buckets: Mutex<(HashMap<String, (f64, u64)>, u64)>,
}

impl Limiter {
    pub fn new(per_minute: f64, burst: f64, now: Clock) -> Limiter {
        let swept = now();
        Limiter { per_minute, burst, now, buckets: Mutex::new((HashMap::new(), swept)) }
    }

    /// Whether the client at `ip` may have one more now.
    pub fn allow(&self, ip: &str) -> bool {
        let t = (self.now)();
        let mut guard = self.buckets.lock().unwrap();
        let (buckets, swept) = &mut *guard;
        let (tokens, at) = buckets.entry(ip.to_string()).or_insert((self.burst, t));
        *tokens = self.burst.min(*tokens + (t.saturating_sub(*at) as f64 / 60_000.0) * self.per_minute);
        *at = t;
        let allowed = *tokens >= 1.0;
        if allowed {
            *tokens -= 1.0;
        }
        // Clients not heard from in ten minutes are forgotten.
        if t.saturating_sub(*swept) > 600_000 {
            *swept = t;
            buckets.retain(|_, (_, at)| t.saturating_sub(*at) <= 600_000);
        }
        allowed
    }
}

/// The client a request came from: the first address of X-Forwarded-For (the platform's load balancer puts it
/// there), or the connection's.
pub fn client(headers: &HeaderMap, peer: Option<&Peer>) -> String {
    let forwarded = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).unwrap_or("");
    match forwarded.split(',').next().map(str::trim).filter(|ip| !ip.is_empty()) {
        Some(ip) => ip.to_string(),
        None => peer.map_or("?".into(), |p| p.addr.ip().to_string()),
    }
}

/// The pass-through: its routes, its limit on each client, its clock, and where it says what goes wrong.
pub struct Pass {
    routes: Vec<Route>,
    limit: Option<Limiter>,
    now: Clock,
    down_until: Mutex<HashMap<usize, u64>>,
    client: reqwest::Client,
    say: Say,
}

impl Pass {
    pub fn new(routes: Vec<Route>, limit: Option<Limiter>, now: Clock, say: Say) -> Pass {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(AGENT)
            .build()
            .expect("an HTTP client");
        Pass { routes, limit, now, down_until: Mutex::new(HashMap::new()), client, say }
    }

    /// The routes, the limit and the clock the deployed server has: 120 a minute a client, a burst of 60.
    pub fn deployed(routes: Vec<Route>) -> Pass {
        let now = wall();
        Pass::new(routes, Some(Limiter::new(120.0, 60.0, now.clone())), now, say_out())
    }

    /// The answer to a request, where it is one to pass through or to refuse; the request back where it is not.
    pub async fn answer(&self, req: Request) -> Result<Response<Body>, Request> {
        let raw = req.uri().path_and_query().map_or("/", |p| p.as_str());
        let (path, query) = raw.split_once('?').unwrap_or((raw, ""));
        let Some(target) = target(path, query, &self.routes) else {
            let ours = self.routes.iter().any(|r| {
                let first: Vec<&str> = r.prefix.split('/').take(2).collect();
                raw.starts_with(&format!("{}/", first.join("/")))
            });
            return match ours {
                true => Ok(text(StatusCode::FORBIDDEN, "Not a path this server passes through\n", &[])),
                false => Err(req),
            };
        };
        let method = req.method().clone();
        if method != Method::GET && method != Method::HEAD {
            return Ok(text(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed\n", &[(header::ALLOW, "GET, HEAD")]));
        }
        let peer = req.extensions().get::<ConnectInfo<Peer>>().map(|c| c.0.clone());
        if let Some(limit) = &self.limit {
            if !limit.allow(&client(req.headers(), peer.as_ref())) {
                let busy = "Too many requests: try again in a little while\n";
                return Ok(text(StatusCode::TOO_MANY_REQUESTS, busy, &[(header::RETRY_AFTER, "30")]));
            }
        }
        Ok(self.exchange(target, method, peer).await)
    }

    /// The answer from the route's fallback, where it has one and it answers the path.
    fn from_fallback(&self, route: &Route, target: &Target, head: bool) -> Option<Response<Body>> {
        let (status, json) = route.fallback.as_ref()?.index.answer(&target.path, &target.query)?;
        let res = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CONTENT_LENGTH, json.len())
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_SECURITY_POLICY, POLICY)
            .header("cross-origin-resource-policy", "same-origin")
            .header("x-answered-by", ANSWERED_BY);
        Some(res.body(if head { Body::empty() } else { Body::from(json) }).unwrap())
    }

    /// The origin down, as `why` says: the fallback answers, where it has an answer, and does for a while without
    /// waiting on the origin again; and that is said, as a warning, as the visitor is answered.
    fn down(&self, target: &Target, head: bool, why: &str) -> Option<Response<Body>> {
        let route = &self.routes[target.route];
        let fallback = route.fallback.as_ref()?;
        self.down_until.lock().unwrap().insert(target.route, (self.now)() + fallback.hold.as_millis() as u64);
        let res = self.from_fallback(route, target, head)?;
        let hold = fallback.hold.as_secs();
        (self.say)(Said::Warning(format!("{}: {why}; answered from the ZXDB index for {hold} s", route.prefix)));
        Some(res)
    }

    fn warn(&self, words: String) {
        (self.say)(Said::Warning(words));
    }

    fn error(&self, error: telemetry::Error) {
        (self.say)(Said::Error(error.line()));
    }

    /// The request to the origin, redirects followed by hand: to the route's own hosts, by the same protocol, three
    /// at most.
    async fn begin(&self, route: &Route, target: &Target, method: &Method) -> Begun {
        let mut url = target.url.clone();
        let accept = if route.query { "application/json" } else { "*/*" };
        let protocol = Url::parse(&route.origin).map(|u| u.scheme().to_string()).unwrap_or_default();
        for hops in 0.. {
            let res = match self.client.request(method.clone(), &url).header(header::ACCEPT, accept).send().await {
                Ok(res) => res,
                Err(e) => return Begun::Unreached(e),
            };
            if !res.status().is_redirection() {
                return Begun::Answered(res, url);
            }
            let here = Url::parse(&url).ok();
            let next = res.headers().get(header::LOCATION).and_then(|l| l.to_str().ok());
            let to = match (here, next) {
                (Some(here), Some(next)) => here.join(next).ok(),
                _ => None,
            };
            match to {
                Some(to) if to.scheme() == protocol && route.hosts.contains(&host(&to)) && hops < 3 => url = to.to_string(),
                _ => return Begun::Elsewhere,
            }
        }
        unreachable!()
    }

    /// Passes a request through: the whole exchange, the body's streaming to the client included, within the route's
    /// time, the client let go of then, and the origin's connection with it; where there is a fallback, the origin has
    /// its `wait` to begin its answer.
    async fn exchange(&self, target: Target, method: Method, peer: Option<Peer>) -> Response<Body> {
        let route = &self.routes[target.route];
        let head = method == Method::HEAD;
        let lately_down = self.down_until.lock().unwrap().get(&target.route).copied().unwrap_or(0) > (self.now)();
        if route.fallback.is_some() && lately_down {
            if let Some(res) = self.from_fallback(route, &target, head) {
                return res;
            }
        }
        let deadline = tokio::time::Instant::now() + route.timeout;
        let wait = route.fallback.as_ref().map(|f| f.wait);
        let slow = async {
            match wait {
                Some(wait) => tokio::time::sleep(wait).await,
                None => std::future::pending().await,
            }
        };
        let begun = tokio::select! {
            begun = tokio::time::timeout_at(deadline, self.begin(route, &target, &method)) => begun.unwrap_or(Begun::TimedOut),
            _ = slow => Begun::Slow,
        };
        let origin = Url::parse(&target.url).map(|u| host(&u)).unwrap_or_default();
        let could_not = |words: &str| text(StatusCode::BAD_GATEWAY, &format!("The archive could not be reached: {words}\n"), &[]);
        let (res, url) = match begun {
            Begun::Answered(res, url) => (res, url),
            Begun::Elsewhere => {
                self.warn(format!("{}: the origin redirected somewhere this server does not go", route.prefix));
                return text(StatusCode::BAD_GATEWAY, "The archive redirected somewhere this server does not go\n", &[]);
            }
            Begun::Slow => {
                let ms = wait.unwrap_or_default().as_millis();
                if let Some(res) = self.down(&target, head, &format!("{origin} gave no answer in {ms} ms")) {
                    return res;
                }
                let words = format!("no answer in {ms} ms");
                self.error(telemetry::Error::msg(&words));
                return could_not(&words);
            }
            Begun::TimedOut => {
                let ms = route.timeout.as_millis();
                self.warn(format!("{}: the origin took longer than {ms} ms", route.prefix));
                return text(StatusCode::GATEWAY_TIMEOUT, &format!("The archive could not be reached: no answer in {ms} ms\n"), &[]);
            }
            Begun::Unreached(e) => {
                if let Some(res) = self.down(&target, head, &format!("{origin} could not be reached ({})", cause(&e))) {
                    return res;
                }
                let words = e.to_string();
                self.error(telemetry::Error::from(e));
                return could_not(&words);
            }
        };
        // The origin up but failing behind its front (ZXInfo's nginx answering 502 for every path, on Oct 18) is the
        // origin not reached, as a refused connection is: answered from the fallback where there is one, which is a
        // warning, as the visitor is answered; and otherwise said once, with its host and status, rather than passed
        // on as its page.
        let status = res.status();
        if status.is_server_error() {
            drop(res);
            let at = Url::parse(&url).map(|u| host(&u)).unwrap_or_default();
            let code = status.as_u16();
            if let Some(res) = self.down(&target, head, &format!("{at} answered {code}")) {
                return res;
            }
            self.error(telemetry::Error::msg(format!("{}: {at} answered {code}", route.prefix)));
            let words = format!("{at} answered {code}: try again in a little while\n");
            return text(StatusCode::BAD_GATEWAY, &words, &[(header::CACHE_CONTROL, "no-store")]);
        }
        // A body the client decoded (the origin's gzip) has no length of its own: it goes without one (chunked),
        // checked against the cap as it streams.
        let encoded = res.headers().get(header::CONTENT_ENCODING).is_some_and(|e| !e.as_bytes().eq_ignore_ascii_case(b"identity"));
        let length = match encoded {
            true => 0,
            false => res.headers().get(header::CONTENT_LENGTH).and_then(|l| l.to_str().ok()?.parse::<u64>().ok()).unwrap_or(0),
        };
        if length > route.max_bytes {
            self.warn(format!("{}: {length} bytes, too large to pass through", route.prefix));
            return text(StatusCode::BAD_GATEWAY, "Too large to pass through\n", &[]);
        }
        let kind = res.headers().get(header::CONTENT_TYPE).cloned().unwrap_or(HeaderValue::from_static("application/octet-stream"));
        let cache = if status.is_success() { route.cache.as_str() } else { "no-store" };
        let mut answer = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, kind)
            .header(header::CACHE_CONTROL, cache)
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_SECURITY_POLICY, POLICY)
            // For this page's own use: another site's page may not take it.
            .header("cross-origin-resource-policy", "same-origin");
        if length > 0 {
            answer = answer.header(header::CONTENT_LENGTH, length);
        }
        if head {
            return answer.body(Body::empty()).unwrap();
        }
        answer.body(self.stream(res, route, deadline, peer)).unwrap()
    }

    /// The origin's body, as the client takes it, cut off past the route's size; on the time running out, the client
    /// going, or the cap, every part of it torn down, and what it was said once.
    fn stream(&self, mut res: reqwest::Response, route: &Route, deadline: tokio::time::Instant, peer: Option<Peer>) -> Body {
        let (tx, rx) = tokio::sync::mpsc::channel::<io::Result<axum::body::Bytes>>(2);
        let (prefix, max, timeout, say) = (route.prefix.clone(), route.max_bytes, route.timeout, self.say.clone());
        tokio::spawn(async move {
            let pumped = tokio::time::timeout_at(deadline, async {
                let mut sent = 0u64;
                loop {
                    match res.chunk().await {
                        Ok(Some(chunk)) => {
                            sent += chunk.len() as u64;
                            if sent > max {
                                let _ = tx.send(Err(io::Error::other("too large to pass through"))).await;
                                return Pumped::TooLarge;
                            }
                            if tx.send(Ok(chunk)).await.is_err() {
                                return Pumped::Gone;
                            }
                        }
                        Ok(None) => return Pumped::Done,
                        Err(e) => {
                            let _ = tx.send(Err(io::Error::other(e.to_string()))).await;
                            return Pumped::Failed(e);
                        }
                    }
                }
            })
            .await;
            match pumped {
                Err(_) => {
                    say(Said::Warning(format!("{prefix}: the origin took longer than {} ms", timeout.as_millis())));
                    if let Some(peer) = peer {
                        peer.let_go();
                    }
                }
                Ok(Pumped::TooLarge) => say(Said::Warning(format!("{prefix}: too large to pass through, cut off"))),
                Ok(Pumped::Failed(e)) => say(Said::Error(telemetry::Error::from(e).line())),
                Ok(Pumped::Done | Pumped::Gone) => {}
            }
            // The origin's connection goes with `res`, here, whatever became of the exchange.
        });
        Body::from_stream(futures_util::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|c| (c, rx)) }))
    }
}

/// What became of the request to the origin.
enum Begun {
    Answered(reqwest::Response, String),
    Elsewhere,
    Slow,
    TimedOut,
    Unreached(reqwest::Error),
}

/// What became of the origin's body.
enum Pumped {
    Done,
    Gone,
    TooLarge,
    Failed(reqwest::Error),
}

/// Why a request did not get there, in its own words: the last of its causes ("Connection refused").
fn cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut last = e;
    while let Some(next) = last.source() {
        last = next;
    }
    last.to_string()
}

fn text(status: StatusCode, words: &str, more: &[(header::HeaderName, &str)]) -> Response<Body> {
    let mut res = Response::builder().status(status).header(header::CONTENT_TYPE, "text/plain; charset=utf-8");
    for (name, value) in more {
        res = res.header(name, *value);
    }
    res.body(Body::from(words.to_string())).unwrap()
}

/// `app` with the pass-through in front of it: a request it passes or refuses is answered by it, any other by `app`.
pub fn layer(app: axum::Router, pass: Arc<Pass>) -> axum::Router {
    app.layer(middleware::from_fn_with_state(pass, |State(pass): State<Arc<Pass>>, req: Request, next: Next| async move {
        match pass.answer(req).await {
            Ok(res) => res,
            Err(req) => next.run(req).await,
        }
    }))
}
