//! The shell a product's pages are served from, lifted out of blog (crux#1).
//!
//! A product gives it its files, each a path, a type and its bytes ([`File`]), and whatever headers
//! of its own each is sent with, such as its content policy; the part neither renders nor reads a
//! store, so pages rendered on the server and files built for the browser are served the same way.
//!
//! [`Table::build`] keeps every file in memory, its bytes shared with the product's rather than
//! copied; [`Table::respond`] answers a request from the table alone, so that serving is a lookup
//! and a write. A file may be given [`File::later`], to be read when it is first asked for
//! ([`Entry::fill`]). A text file is compressed once, with brotli at its best and with gzip at its
//! best, the first time a request or [`Table::compress`] wants it, so that the table is ready to
//! serve at once; and a compressed body no smaller than the file is never sent. [`Site`] holds the
//! table served, and swaps it whole when the product's files change; [`router`] answers from it
//! with axum, and [`serve`] puts that on the port in `PORT`.
//!
//! A panic in answering a request, in the table's answer or in a route the product adds beside it, is that
//! request's alone (crux#42): what [`serve`] answers with is [`guarded`], and a request whose answer panicked is
//! answered 500, the server answering on; and [`serve`] has the part telemetry say each panic once, as an error is
//! said, with its stack ([`telemetry::panics`]). A product whose release profile has `panic = "abort"`, as a
//! workspace with an engine in wasm has, builds its server in a profile that unwinds, or a panic ends it.
//!
//! A client that stops reading what it is sent holds the server's write (crux#45): [`serve`] lets
//! go of a connection whose write makes no headway for [`STALL`], and a route may let go of its own
//! at once with its [`Peer`] ([`Peer::let_go`]), as a pass-through does once its time is up.
//!
//! A product whose pages are built into a directory, as Vite's `dist/`, gives the table that
//! directory whole, with [`Dir`] (crux#33): each file at its path, typed by its extension, sent
//! compressed as its build compressed it where it did, a hashed asset kept for a year, the
//! product's headers on all of them or by prefix, and an app's page for any path with no extension
//! that names no file. [`Dir::unread`] gives it each file [`File::unread`], so that the server
//! listens before a byte of the directory is read, however large it is (crux#54): a file is read
//! when it is first asked for, or by the pass [`Site`] begins once it is first asked for anything
//! ([`Table::read`]), whichever comes first, and a request waits on no file but its own.
//!
//! Off Cloud Run, where `K_SERVICE` is unset, [`serve`] prints a line on standard error for each request it
//! answers, as Cloud Run logs one there (crux#76):
//! `{"httpRequest":{"requestMethod","requestUrl","status","latency"},"severity"}`, its path alone and not its query,
//! and nothing of who asked ([`logged`]); so that nerd counts a product's requests at home as it counts them on Cloud
//! Run, and on Cloud Run, which logs them itself, none twice. On standard error, not output, as products' tests read
//! their server's standard output for telemetry's events alone.
//!
//! A header that must be on every answer the product makes, and not only on its files, as COOP and
//! COEP must for a page to be cross-origin isolated, is named once, with [`headers`], over the
//! whole router, its own routes and telemetry's merged in: the widget, a 404, a 405, a redirect
//! and telemetry's answers have it too, which neither [`Dir::header`] nor [`File::with`] reach. Use
//! those for what goes on some files and not others, as a page's content policy.

use std::collections::HashMap;
use std::future::Future;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{self, Write};
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::task::Poll;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
pub use axum::http::header;
use axum::http::{HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
/// What [`router`] makes, for a product's routes to be merged into without naming axum.
pub use axum::Router;
pub use bytes::Bytes;

mod conn;
mod dir;
pub use conn::{Peer, STALL};
pub use dir::{content_type, hashed, Dir, IMMUTABLE};

/// How long a browser may keep a file that does not say: five minutes.
pub const CACHE: &str = "public, max-age=300";

/// One of a product's files, as it gives it.
#[derive(Clone, Debug)]
pub struct File {
    /// Where it is served, as `/`, `/about/` or `/app.js`.
    pub path: String,
    pub content_type: String,
    /// Its bytes; empty where it is given [`File::later`].
    pub body: Bytes,
    /// What it is read by, and its version, where it is given [`File::later`].
    pub later: Option<(String, String)>,
    /// What else it is sent with, as its Cache-Control (else [`CACHE`]) or its content policy.
    pub headers: Vec<(header::HeaderName, String)>,
    /// Its build's own brotli and gzip of `body`, sent as they are where they are smaller, in place
    /// of the table's: as `NAME.br` and `NAME.gz` beside it ([`Dir`]).
    pub br: Option<Bytes>,
    pub gzip: Option<Bytes>,
    /// Whether it answers, with 200, a path with no extension that names no file, as an app's
    /// `index.html` does; where more than one says so, the first.
    pub fallback: bool,
    /// How it is read, where it is given [`File::unread`]: its type, headers and bodies are then
    /// those of the file read.
    pub unread: Option<Unread>,
}

/// How a file given [`File::unread`] is read: in full, as the file it is then, once, when it is
/// first asked for or by the pass that reads the table ([`Table::read`]), whichever comes first.
#[derive(Clone)]
pub struct Unread {
    read: Arc<dyn Fn() -> io::Result<File> + Send + Sync>,
    /// How large it is thought to be, so that the pass reads the largest first.
    size: u64,
}

impl Unread {
    pub fn new(size: u64, read: impl Fn() -> io::Result<File> + Send + Sync + 'static) -> Unread {
        Unread {
            read: Arc::new(read),
            size,
        }
    }

    /// The file, read now.
    pub fn read(&self) -> io::Result<File> {
        (self.read)()
    }

    /// Whether it is `other`, read the same way.
    pub fn is(&self, other: &Unread) -> bool {
        Arc::ptr_eq(&self.read, &other.read)
    }
}

impl std::fmt::Debug for Unread {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Unread({} B)", self.size)
    }
}

impl File {
    pub fn new(path: impl Into<String>, content_type: impl Into<String>, body: Bytes) -> File {
        File {
            path: path.into(),
            content_type: content_type.into(),
            body,
            later: None,
            headers: Vec::new(),
            br: None,
            gzip: None,
            fallback: false,
            unread: None,
        }
    }

    /// A file not read yet, served at `path` once `unread` has read it, as it is then: compressed
    /// and tagged as it would have been, given with the rest. What it is sent with is the file
    /// read's; `content_type` and `headers`, which [`Table::build_from`] compares, are what it is
    /// known by until then.
    pub fn unread(
        path: impl Into<String>,
        content_type: impl Into<String>,
        unread: Unread,
    ) -> File {
        File {
            unread: Some(unread),
            ..File::new(path, content_type, Bytes::new())
        }
    }

    /// A file not read with the rest, read when it is first asked for by `key`, as the [`Read`]
    /// the [`Site`] is given reads it; `version` changes whenever its bytes do. It is sent as it
    /// is, never compressed, as a large image or sound would be.
    pub fn later(
        path: impl Into<String>,
        content_type: impl Into<String>,
        key: impl Into<String>,
        version: impl Into<String>,
    ) -> File {
        File {
            later: Some((key.into(), version.into())),
            ..File::new(path, content_type, Bytes::new())
        }
    }

    /// The same file, sent with `name: value` too.
    pub fn with(mut self, name: header::HeaderName, value: impl Into<String>) -> File {
        self.headers.push((name, value.into()));
        self
    }

    /// The same file with `body` in place of its own, as a page with a tag put in it: its build's
    /// compressed bodies, which were of the old, are let go, and the table compresses it again.
    pub fn with_body(self, body: impl Into<Bytes>) -> File {
        File {
            body: body.into(),
            br: None,
            gzip: None,
            ..self
        }
    }
}

/// Whether a file of this type is compressed: text, and what is made of text.
pub fn is_text(content_type: &str) -> bool {
    let t = content_type.to_ascii_lowercase();
    t.starts_with("text/")
        || ["xml", "json", "javascript", "wasm"]
            .iter()
            .any(|s| t.contains(s))
}

/// One file, as it is, and compressed where it is text.
pub struct Entry {
    pub content_type: String,
    headers: Vec<(header::HeaderName, String)>,
    /// Its bytes, where they were given with the rest; else none, and [`Entry::fill`] reads them.
    identity: Bytes,
    later: Option<Later>,
    /// Whether it is text, which the table compresses where its build did not.
    text: bool,
    /// Its build's own brotli and gzip, where it gave them.
    built: Packed,
    /// Brotli's and gzip's, made the first time either is wanted, or its build's; none for a file
    /// that is not text and that its build did not compress, or that was given later.
    packed: Option<OnceLock<Packed>>,
    etag: String,
    /// Where it was given [`File::unread`]: how it is read, and what it is once read; the fields
    /// above are then not used.
    unread: Option<Reading>,
}

/// A file given [`File::unread`]: how it is read, and its entry once it is. A second caller while
/// it is read waits for the first, and a caller for another file waits for neither.
struct Reading {
    unread: Unread,
    read: OnceLock<Box<Entry>>,
    lock: Mutex<()>,
}

/// A file not read with the rest: what it is read by, its version, and its bytes once read.
struct Later {
    key: String,
    version: String,
    bytes: tokio::sync::OnceCell<Bytes>,
}

/// A text file, compressed: each body only where it is smaller than the file.
#[derive(Clone, Default)]
pub struct Packed {
    pub br: Option<Bytes>,
    pub gzip: Option<Bytes>,
}

/// Reads a file given [`File::later`], by its key, to its bytes.
pub type Read = Arc<
    dyn Fn(String) -> Pin<Box<dyn Future<Output = Result<Bytes, String>> + Send>> + Send + Sync,
>;

impl Entry {
    fn new(mut f: File) -> Entry {
        let unread = f.unread.take().map(|unread| Reading {
            unread,
            read: OnceLock::new(),
            lock: Mutex::new(()),
        });
        let mut h = DefaultHasher::new();
        let (later, packed) = match f.later {
            Some((key, version)) => {
                (&key, &version).hash(&mut h);
                let later = Later {
                    key,
                    version,
                    bytes: tokio::sync::OnceCell::new(),
                };
                (Some(later), None)
            }
            None => {
                (&f.body, &f.br, &f.gzip).hash(&mut h);
                let packed = is_text(&f.content_type) || f.br.is_some() || f.gzip.is_some();
                (None, packed.then(OnceLock::new))
            }
        };
        Entry {
            text: is_text(&f.content_type),
            built: match later {
                Some(_) => Packed::default(),
                None => Packed {
                    br: f.br,
                    gzip: f.gzip,
                },
            },
            content_type: f.content_type,
            headers: f.headers,
            etag: format!("{:016x}", h.finish()),
            identity: f.body,
            later,
            packed: packed.filter(|_| unread.is_none()),
            unread,
        }
    }

    /// The entry to answer from: itself, or, where it was given [`File::unread`], the file read,
    /// read now where it was not yet; an error where it could not be read, read again when next
    /// asked for.
    fn now(&self) -> Result<&Entry, String> {
        let Some(r) = &self.unread else {
            return Ok(self);
        };
        if let Some(e) = r.read.get() {
            return Ok(e);
        }
        let _one = r.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(e) = r.read.get() {
            return Ok(e);
        }
        let f = r.unread.read().map_err(|e| e.to_string())?;
        Ok(r.read.get_or_init(|| Box::new(Entry::new(f))))
    }

    /// How large it is, or is thought to be where it is not read yet.
    fn size(&self) -> u64 {
        match &self.unread {
            Some(r) => r.read.get().map_or(r.unread.size, |e| e.size()),
            None => self.identity.len() as u64,
        }
    }

    /// Whether it is `f` as it is now: kept, compressed or read or not, where it is.
    fn is(&self, f: &File) -> bool {
        self.content_type == f.content_type
            && self.headers == f.headers
            && match (&self.unread, &f.unread) {
                (Some(r), Some(u)) => r.unread.is(u),
                (None, None) => true,
                _ => false,
            }
            && match (&self.later, &f.later) {
                (Some(l), Some((key, version))) => l.key == *key && l.version == *version,
                (None, None) => {
                    let same_or_none = |a: &Option<Bytes>, b: &Option<Bytes>| match (a, b) {
                        (Some(a), Some(b)) => same(a, b),
                        (a, b) => a.is_none() && b.is_none(),
                    };
                    same(&self.identity, &f.body)
                        && same_or_none(&self.built.br, &f.br)
                        && same_or_none(&self.built.gzip, &f.gzip)
                }
                _ => false,
            }
    }

    /// Its bytes; none for a file given later, or unread, and not read yet.
    pub fn bytes(&self) -> Option<&Bytes> {
        if let Some(r) = &self.unread {
            return r.read.get().and_then(|e| e.bytes());
        }
        match &self.later {
            None => Some(&self.identity),
            Some(l) => l.bytes.get(),
        }
    }

    /// Reads it with `read`, where it was given later and has not been read: once, as a second
    /// caller meanwhile waits for the first.
    pub async fn fill(&self, read: &Read) -> Result<(), String> {
        if let Some(l) = &self.later {
            l.bytes.get_or_try_init(|| read(l.key.clone())).await?;
        }
        Ok(())
    }

    /// Its compressed bodies, its build's as they are and the rest made now where they were not
    /// yet; none where it is not text and its build compressed none. A second caller while they are
    /// made waits for them, and nothing is compressed twice. A file given [`File::unread`] is read
    /// first, where it was not yet; none where it cannot be.
    pub fn packed(&self) -> Option<&Packed> {
        if self.unread.is_some() {
            return self.now().ok()?.packed();
        }
        self.packed.as_ref().map(|p| {
            p.get_or_init(|| {
                let smaller = |b: Bytes| (b.len() < self.identity.len()).then_some(b);
                let body = |built: &Option<Bytes>, make: fn(&[u8]) -> Vec<u8>| match built {
                    Some(b) => smaller(b.clone()),
                    None if self.text => smaller(make(&self.identity).into()),
                    None => None,
                };
                Packed {
                    br: body(&self.built.br, brotli),
                    gzip: body(&self.built.gzip, gzip),
                }
            })
        })
    }

    /// Whether it is read and compressed already, or is not compressed at all.
    pub fn ready(&self) -> bool {
        if let Some(r) = &self.unread {
            return r.read.get().is_some_and(|e| e.ready());
        }
        self.packed.as_ref().is_none_or(|p| p.get().is_some())
    }

    /// Its tag, as sent with the body in `coding`.
    fn tag(&self, coding: Encoding) -> String {
        let suffix = match coding {
            Encoding::Br => "-br",
            Encoding::Gzip => "-gz",
            Encoding::Identity => "",
        };
        format!("\"{}{suffix}\"", self.etag)
    }
}

/// Brotli at its best: quality 11, and its widest window.
fn brotli(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut w = ::brotli::CompressorWriter::new(&mut out, 4096, 11, 22);
        w.write_all(body).unwrap();
    }
    out
}

/// Gzip at its best.
fn gzip(body: &[u8]) -> Vec<u8> {
    let mut w = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    w.write_all(body).unwrap();
    w.finish().unwrap()
}

/// Every file of the product, ready to send. An entry is shared with the table that follows it,
/// where it did not change, compressed or not.
pub struct Table {
    pub entries: HashMap<String, Arc<Entry>>,
    /// What is sent, as a 404, for a path that is not in the table.
    pub not_found: Arc<Entry>,
    /// Where the file is that answers, with 200, a path with no extension that names no file
    /// ([`File::fallback`]); none, and such a path is answered as any other not in the table.
    pub fallback: Option<String>,
}

/// An answer, before it is put on the wire.
#[derive(Debug)]
pub struct Answer {
    pub status: StatusCode,
    pub headers: Vec<(header::HeaderName, String)>,
    pub body: Bytes,
}

impl Answer {
    pub fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.as_str())
    }

    /// The answer as axum sends it.
    pub fn response(self) -> Response<Body> {
        let mut r = Response::new(Body::from(self.body));
        *r.status_mut() = self.status;
        for (name, value) in self.headers {
            if let Ok(v) = HeaderValue::from_str(&value) {
                r.headers_mut().insert(name, v);
            }
        }
        r
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Encoding {
    Br,
    Gzip,
    Identity,
}

/// The encodings `accept` takes of those `entry` may be sent in, best first: brotli, then gzip.
fn accepted(accept: &str, entry: &Entry) -> Vec<Encoding> {
    let accepts = |name: &str| {
        accept.split(',').any(|part| {
            let mut bits = part.split(';');
            let coding = bits.next().unwrap_or("").trim();
            let q = bits
                .find_map(|b| b.trim().strip_prefix("q="))
                .and_then(|q| q.trim().parse::<f32>().ok());
            coding.eq_ignore_ascii_case(name) && q.is_none_or(|q| q > 0.0)
        })
    };
    if entry.packed.is_none() {
        return Vec::new();
    }
    [(Encoding::Br, "br"), (Encoding::Gzip, "gzip")]
        .into_iter()
        .filter(|(_, name)| accepts(name))
        .map(|(e, _)| e)
        .collect()
}

/// `%xx` in a path, as the bytes it stands for.
pub fn decode(path: &str) -> String {
    let b = path.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The same bytes: the same memory, or bytes that are equal.
fn same(a: &Bytes, b: &Bytes) -> bool {
    (a.as_ptr() == b.as_ptr() && a.len() == b.len()) || a == b
}

impl Table {
    /// Every file, kept to be compressed when it is first wanted; `not_found`'s path is not used.
    pub fn build(files: Vec<File>, not_found: File) -> Table {
        Table::build_from(files, not_found, None).0
    }

    /// Every file, keeping from `old` each entry that is there as it is now, compressed or read
    /// or not; with how many are new.
    pub fn build_from(files: Vec<File>, not_found: File, old: Option<&Table>) -> (Table, usize) {
        let mut entries = HashMap::new();
        let mut new = 0;
        let mut fallback = None;
        // Each entry made here, by its bytes or by what reads it, so that a file given at two
        // paths, as a directory's index.html at `/docs/` and at `/docs/index.html`, is one entry,
        // read and compressed once.
        let mut made: HashMap<(usize, usize), Arc<Entry>> = HashMap::new();
        let key = |f: &File| match &f.unread {
            Some(u) => (Arc::as_ptr(&u.read) as *const () as usize, usize::MAX),
            None => (f.body.as_ptr() as usize, f.body.len()),
        };
        for f in files {
            if f.fallback && fallback.is_none() {
                fallback = Some(f.path.clone());
            }
            let kept = old
                .and_then(|t| t.entries.get(&f.path))
                .filter(|e| e.is(&f))
                .or_else(|| made.get(&key(&f)))
                .filter(|e| e.is(&f));
            let entry = match kept {
                Some(e) => e.clone(),
                None => {
                    new += 1;
                    let e = Arc::new(Entry::new(f.clone()));
                    if !f.body.is_empty() || f.unread.is_some() {
                        made.insert(key(&f), e.clone());
                    }
                    e
                }
            };
            entries.insert(f.path, entry);
        }
        let not_found = match old {
            Some(t) if t.not_found.is(&not_found) => t.not_found.clone(),
            _ => Arc::new(Entry::new(not_found)),
        };
        let table = Table {
            entries,
            not_found,
            fallback,
        };
        (table, new)
    }

    /// Compresses every file given with the rest not compressed yet, on as many threads as there
    /// are cores, while requests compress what they ask for first; with how many it compressed,
    /// and how long it took. A file given [`File::unread`] is [`Table::read`]'s.
    pub fn compress(&self) -> (usize, Duration) {
        self.pass(false)
    }

    /// Reads every file given [`File::unread`] not read yet, and compresses it, on as many
    /// threads as there are cores, while requests read what they ask for first; with how many it
    /// read, and how long it took.
    pub fn read(&self) -> (usize, Duration) {
        self.pass(true)
    }

    /// Whether a file given [`File::unread`] is among them.
    pub fn unread(&self) -> bool {
        std::iter::once(&self.not_found)
            .chain(self.entries.values())
            .any(|e| e.unread.is_some())
    }

    /// Readies each file not ready yet, of those given unread or of the rest.
    fn pass(&self, unread: bool) -> (usize, Duration) {
        let started = Instant::now();
        let mut todo: Vec<&Arc<Entry>> = std::iter::once(&self.not_found)
            .chain(self.entries.values())
            .filter(|e| e.unread.is_some() == unread && !e.ready())
            .collect();
        // The largest first, so that no thread is left with a long one at the end.
        todo.sort_by_key(|e| std::cmp::Reverse(e.size()));
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        let next = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|s| {
            for _ in 0..threads.min(todo.len()) {
                s.spawn(|| loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(e) = todo.get(i) else { break };
                    e.packed();
                });
            }
        });
        (todo.len(), started.elapsed())
    }

    /// The answer to a request, from the table alone.
    pub fn respond(
        &self,
        method: &Method,
        path: &str,
        query: Option<&str>,
        headers: &HeaderMap,
    ) -> Answer {
        let text =
            |h: header::HeaderName| headers.get(h).and_then(|v| v.to_str().ok()).unwrap_or("");
        if method != Method::GET && method != Method::HEAD {
            return Answer {
                status: StatusCode::METHOD_NOT_ALLOWED,
                headers: vec![(header::ALLOW, "GET, HEAD".into())],
                body: Bytes::new(),
            };
        }
        let path = decode(path);
        let Some(entry) = self.entries.get(&path) else {
            // A path that differs only by its trailing slash goes, for good, to the one that is there.
            let other = match path.strip_suffix('/') {
                Some(p) if !p.is_empty() => p.to_string(),
                Some(_) => String::new(),
                None => format!("{path}/"),
            };
            if !other.is_empty() && self.entries.contains_key(&other) && !path.starts_with("//") {
                let to = match query {
                    Some(q) => format!("{other}?{q}"),
                    None => other,
                };
                return Answer {
                    status: StatusCode::MOVED_PERMANENTLY,
                    headers: vec![
                        (header::LOCATION, to),
                        (header::CACHE_CONTROL, "public, max-age=86400".into()),
                    ],
                    body: Bytes::new(),
                };
            }
            if let Some(page) = self.fallback.as_ref().filter(|_| falls_back(&path)) {
                if let Some(entry) = self.entries.get(page) {
                    return send(
                        StatusCode::OK,
                        entry,
                        text(header::ACCEPT_ENCODING),
                        text(header::IF_NONE_MATCH),
                        (text(header::RANGE), text(header::IF_RANGE)),
                        method,
                    );
                }
            }
            return send(
                StatusCode::NOT_FOUND,
                &self.not_found,
                text(header::ACCEPT_ENCODING),
                "",
                ("", ""),
                method,
            );
        };
        send(
            StatusCode::OK,
            entry,
            text(header::ACCEPT_ENCODING),
            text(header::IF_NONE_MATCH),
            (text(header::RANGE), text(header::IF_RANGE)),
            method,
        )
    }
}

/// Whether a path not in the table is answered with its fallback: one with no extension, its last
/// name without a dot, and none of whose names begins with one, as `..`, `.` or a dotfile, however
/// it was spelled; `/` and `//` past its start, which no browser asks for, neither.
fn falls_back(path: &str) -> bool {
    let Some(rest) = path.strip_prefix('/') else {
        return false;
    };
    let names: Vec<&str> = rest.split('/').collect();
    let last = names.len() - 1;
    names
        .iter()
        .enumerate()
        .all(|(i, n)| !n.starts_with('.') && !n.contains('\\') && (i == last || !n.is_empty()))
        && !names[last].contains('.')
}

/// What a request's `Range` asks for of a file `len` bytes long.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ranged {
    /// The whole file: no range was asked for, or not one range of bytes that can be read.
    Whole,
    /// The bytes from the first to the last, both in the file.
    Part(u64, u64),
    /// A range none of whose bytes is in the file: a 416.
    Outside,
}

/// What `range` asks for of a file `len` bytes long, as `bytes=a-b`, `bytes=a-` or `bytes=-n` (the
/// last n) says it; anything else, as more than one range, asks for the whole file.
pub fn ranged(range: &str, len: u64) -> Ranged {
    let Some((unit, spec)) = range.split_once('=') else {
        return Ranged::Whole;
    };
    let Some((first, last)) = spec.trim().split_once('-') else {
        return Ranged::Whole;
    };
    // A number too large to hold is past the end of any file.
    let number = |s: &str| {
        (!s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
            .then(|| s.parse().unwrap_or(u64::MAX))
    };
    if !unit.trim().eq_ignore_ascii_case("bytes") || spec.contains(',') {
        return Ranged::Whole;
    }
    match (number(first), number(last)) {
        (None, Some(n)) if first.is_empty() => match n.min(len) {
            0 => Ranged::Outside,
            n => Ranged::Part(len - n, len - 1),
        },
        (Some(a), None) if last.is_empty() => match a < len {
            true => Ranged::Part(a, len - 1),
            false => Ranged::Outside,
        },
        (Some(a), Some(b)) if a <= b => match a < len {
            true => Ranged::Part(a, b.min(len - 1)),
            false => Ranged::Outside,
        },
        _ => Ranged::Whole,
    }
}

fn send(
    status: StatusCode,
    entry: &Entry,
    accept: &str,
    if_none_match: &str,
    (range, if_range): (&str, &str),
    method: &Method,
) -> Answer {
    let entry = match entry.now() {
        Ok(e) => e,
        Err(err) => {
            eprintln!("could not read a file: {err}");
            return Answer {
                status: StatusCode::SERVICE_UNAVAILABLE,
                headers: vec![(header::RETRY_AFTER, "1".into())],
                body: Bytes::new(),
            };
        }
    };
    let Some(identity) = entry.bytes() else {
        return Answer {
            status: StatusCode::SERVICE_UNAVAILABLE,
            headers: vec![(header::RETRY_AFTER, "1".into())],
            body: Bytes::new(),
        };
    };
    let mut headers = vec![
        (header::CONTENT_TYPE, entry.content_type.clone()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
    ];
    if !entry
        .headers
        .iter()
        .any(|(n, _)| *n == header::CACHE_CONTROL)
    {
        headers.push((header::CACHE_CONTROL, CACHE.into()));
    }
    headers.extend(entry.headers.iter().cloned());
    if entry.packed.is_some() {
        headers.push((header::VARY, "Accept-Encoding".into()));
    }
    let held = |tag: &str| {
        if_none_match
            .split(',')
            .any(|t| t.trim() == tag || t.trim() == "*")
    };
    // A range is of the file as it is, and only where the request is a GET for a file of the table:
    // where it says If-Range, only while the browser holds the file as it is now, by its tag, and
    // not a date, as a file here has none. Any file of the table is sent in part, but only one never
    // compressed (a sound, a video, a picture) says so on its 200, as only those are seeked: on a page
    // sent in brotli it would be 22 B on the wire that promise nothing used (crux#25).
    let mut part = Ranged::Whole;
    if status == StatusCode::OK {
        if entry.packed.is_none() {
            headers.push((header::ACCEPT_RANGES, "bytes".into()));
        }
        if method == Method::GET
            && (if_range.is_empty() || if_range.trim() == entry.tag(Encoding::Identity))
        {
            part = ranged(range, identity.len() as u64);
        }
    }
    let accepted = match part {
        Ranged::Whole => accepted(accept, entry),
        _ => Vec::new(),
    };
    // A tag is given only with the body it names, and the same file is always sent in the same
    // encoding to the same request: so the browser that holds the tag of the best encoding it
    // accepts is told so before anything is compressed.
    if status == StatusCode::OK {
        if let Some(&best) = accepted.first() {
            let tag = entry.tag(best);
            if held(&tag) {
                headers.push((header::CONTENT_ENCODING, coding(best).into()));
                headers.push((header::ETAG, tag));
                return not_modified(headers);
            }
        }
    }
    // Only here, past that 304, is the body compressed where it is not yet; and what is sent is
    // the best encoding accepted whose body is smaller than the file.
    let packed = (!accepted.is_empty()).then(|| entry.packed()).flatten();
    let (enc, body) = accepted
        .iter()
        .find_map(|&e| {
            let p = packed?;
            let b = match e {
                Encoding::Br => p.br.as_ref(),
                Encoding::Gzip => p.gzip.as_ref(),
                Encoding::Identity => None,
            }?;
            Some((e, b))
        })
        .unwrap_or((Encoding::Identity, identity));
    if enc != Encoding::Identity {
        headers.push((header::CONTENT_ENCODING, coding(enc).into()));
    }
    if status == StatusCode::OK {
        let tag = entry.tag(enc);
        headers.push((header::ETAG, tag.clone()));
        if held(&tag) {
            return not_modified(headers);
        }
    }
    let (status, body) = match part {
        Ranged::Whole => (status, body.clone()),
        Ranged::Part(first, last) => {
            if entry.packed.is_some() {
                headers.push((header::ACCEPT_RANGES, "bytes".into()));
            }
            headers.push((
                header::CONTENT_RANGE,
                format!("bytes {first}-{last}/{}", body.len()),
            ));
            let part = body.slice(first as usize..=last as usize);
            (StatusCode::PARTIAL_CONTENT, part)
        }
        // Said with nothing else, so that no cache keeps it for the file.
        Ranged::Outside => {
            return Answer {
                status: StatusCode::RANGE_NOT_SATISFIABLE,
                headers: vec![
                    (header::CONTENT_RANGE, format!("bytes */{}", body.len())),
                    (header::ACCEPT_RANGES, "bytes".into()),
                    (header::CONTENT_LENGTH, "0".into()),
                ],
                body: Bytes::new(),
            }
        }
    };
    headers.push((header::CONTENT_LENGTH, body.len().to_string()));
    let body = if method == Method::HEAD {
        Bytes::new()
    } else {
        body
    };
    Answer {
        status,
        headers,
        body,
    }
}

fn coding(e: Encoding) -> &'static str {
    match e {
        Encoding::Br => "br",
        Encoding::Gzip => "gzip",
        Encoding::Identity => "identity",
    }
}

fn not_modified(headers: Vec<(header::HeaderName, String)>) -> Answer {
    Answer {
        status: StatusCode::NOT_MODIFIED,
        headers,
        body: Bytes::new(),
    }
}

/// The table served, swapped whole when the product's files change, so that a request is answered
/// from one table or the other, never a mix; how files given later are read; and whether it has
/// been asked for anything yet.
pub struct Site {
    table: RwLock<Arc<Table>>,
    read: Option<Read>,
    asked: Arc<Asked>,
}

/// Whether a site has been asked for anything yet, for a pass to wait on.
#[derive(Default)]
struct Asked {
    yet: std::sync::atomic::AtomicBool,
    lock: Mutex<bool>,
    cv: std::sync::Condvar,
}

impl Asked {
    fn now(&self) {
        if !self.yet.swap(true, std::sync::atomic::Ordering::AcqRel) {
            *self.lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
            self.cv.notify_all();
        }
    }

    fn wait(&self) {
        let yet = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        drop(self.cv.wait_while(yet, |yet| !*yet));
    }
}

/// Compresses what `table` has not yet, on threads of its own, and says in the log when it is done;
/// then, once the site is first asked for anything, so that nothing of it is read before it
/// listens, reads what was given unread, and says so too.
fn compress(table: Arc<Table>, asked: Arc<Asked>) {
    std::thread::spawn(move || {
        let (n, took) = table.compress();
        if n > 0 {
            eprintln!("compressed {n} files in {} ms", took.as_millis());
        }
        if table.unread() {
            asked.wait();
            let (n, took) = table.read();
            if n > 0 {
                eprintln!("read {n} files in {} ms", took.as_millis());
            }
        }
    });
}

impl Site {
    /// Serves `table` at once, while a thread of its own compresses what is text, and, once the
    /// site is first asked for anything, reads what was given [`File::unread`] that no request
    /// has read first (crux#54).
    pub fn new(table: Table) -> Site {
        let table = Arc::new(table);
        let asked = Arc::new(Asked::default());
        compress(table.clone(), asked.clone());
        Site {
            table: RwLock::new(table),
            read: None,
            asked,
        }
    }

    /// The same site, reading each file given [`File::later`] with `read` as it is first asked for.
    pub fn reading(mut self, read: Read) -> Site {
        self.read = Some(read);
        self
    }

    /// The table as it is now.
    pub fn table(&self) -> Arc<Table> {
        self.table.read().unwrap().clone()
    }

    /// Serves `table` in place of the one served, whole, and compresses what is new in it.
    pub fn swap(&self, table: Table) {
        let table = Arc::new(table);
        compress(table.clone(), self.asked.clone());
        *self.table.write().unwrap() = table;
    }

    /// Serves `files` in place of what is served, keeping each entry that did not change,
    /// compressed or read; with how many are new.
    pub fn update(&self, files: Vec<File>, not_found: File) -> usize {
        let (table, new) = Table::build_from(files, not_found, Some(&self.table()));
        self.swap(table);
        new
    }

    /// The answer to a request, from the table as it is now: a file given later is read first,
    /// and the body is compressed, where it is, off the workers that serve the rest.
    pub async fn answer(&self, method: Method, uri: Uri, headers: HeaderMap) -> Answer {
        self.asked.now();
        let table = self.table();
        if let (Some(read), true) = (&self.read, method == Method::GET || method == Method::HEAD) {
            if let Some(e) = table.entries.get(&decode(uri.path())) {
                if let Err(err) = e.fill(read).await {
                    eprintln!("could not read {}: {err}", uri.path());
                    return Answer {
                        status: StatusCode::SERVICE_UNAVAILABLE,
                        headers: vec![(header::RETRY_AFTER, "1".into())],
                        body: Bytes::new(),
                    };
                }
            }
        }
        tokio::task::spawn_blocking(move || {
            table.respond(&method, uri.path(), uri.query(), &headers)
        })
        .await
        .unwrap_or_else(|_| Answer {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            headers: Vec::new(),
            body: Bytes::new(),
        })
    }
}

async fn handle(
    State(site): State<Arc<Site>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response<Body> {
    site.answer(method, uri, headers).await.response()
}

/// Answers every request from `site`: a product adds its own routes to it, or answers from
/// [`Site::answer`] in a handler of its own.
pub fn router(site: Arc<Site>) -> Router {
    axum::Router::new().fallback(handle).with_state(site)
}

/// The answer to `req`, or 500, not kept, where answering it panicked: the panic is said where it happened, by the
/// process's hook.
async fn caught(req: Request, next: axum::middleware::Next) -> axum::response::Response {
    let mut answer = std::pin::pin!(next.run(req));
    std::future::poll_fn(|cx| {
        match std::panic::catch_unwind(AssertUnwindSafe(|| answer.as_mut().poll(cx))) {
            Ok(polled) => polled,
            Err(_) => Poll::Ready(
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(Body::empty())
                    .unwrap(),
            ),
        }
    })
    .await
}

/// `app`, each request whose answer panics answered 500, not kept, and the server answering on: every route of it,
/// the product's merged in or nested and its fallback among them. [`serve_on`] serves `app` so; a product that answers
/// with `app` some other way, as in a test, guards it with this.
pub fn guarded(app: Router) -> Router {
    app.layer(axum::middleware::from_fn(caught))
}

/// `app`, every answer it makes sent with each of `headers` (crux#44): its files, a 304, a range
/// and a redirect, the widget, the not-found page, a 405, and the answers of every route merged
/// into it before, telemetry's 204, 400, 413 and 429 among them, and the 500 of one that panics,
/// which it answers as [`guarded`] does. A product puts it over its whole
/// router, last, and names there what must be on all of them, as COOP and COEP, which make a page
/// cross-origin isolated only where every answer has them; [`Dir::header`] is for what goes by
/// path. An answer that has a header of the same name keeps its own, as an asset kept a year its
/// Cache-Control. A value HTTP does not allow in a header stops the product as it starts, and
/// names the header, rather than be left off.
pub fn headers<V: AsRef<str>>(
    app: Router,
    headers: impl IntoIterator<Item = (header::HeaderName, V)>,
) -> Router {
    let headers: Arc<Vec<(header::HeaderName, HeaderValue)>> = Arc::new(
        headers
            .into_iter()
            .map(
                |(name, value)| match HeaderValue::from_str(value.as_ref()) {
                    Ok(v) => (name, v),
                    Err(_) => panic!("{name}: {:?} is not a header's value", value.as_ref()),
                },
            )
            .collect(),
    );
    guarded(app).layer(axum::middleware::map_response(
        move |mut r: Response<Body>| {
            let headers = headers.clone();
            async move {
                for (name, value) in headers.iter() {
                    if !r.headers().contains_key(name) {
                        r.headers_mut().insert(name.clone(), value.clone());
                    }
                }
                r
            }
        },
    ))
}

/// The port in `port`, as `PORT` says it: 8080 where it is not set, and 0 for any.
pub fn port(port: Option<&str>) -> Result<u16, String> {
    match port {
        Some(p) => p.parse().map_err(|_| format!("PORT {p:?} is not a port")),
        None => Ok(8080),
    }
}

/// Answers with `app` on the port in `PORT` (8080 where unset; 0 for any), on every address,
/// printing "listening on http://ADDR" once it answers, until the process is told to stop (an
/// interrupt, or Cloud Run's SIGTERM); each panic of the process said once, as an error, with its stack.
pub async fn serve(app: axum::Router) -> Result<(), String> {
    telemetry::panics();
    let port = port(std::env::var("PORT").ok().as_deref())?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("port {port}: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    println!("listening on http://{addr}");
    serve_on(listener, app).await.map_err(|e| e.to_string())
}

/// Answers with `app` on `listener`, until the process is told to stop (an interrupt, or Cloud
/// Run's SIGTERM). Each request carries the address it came from, as `ConnectInfo<SocketAddr>`,
/// as the part telemetry's limit asks for where no load balancer said it (crux#38), and its
/// [`Peer`], as `ConnectInfo<Peer>`, for a route to let go of its connection; a connection whose
/// write makes no headway for [`STALL`], as a client that stopped reading leaves it, is let go of
/// (crux#45); a request whose answer panics is answered 500 ([`guarded`]); and, off Cloud Run, each request is printed
/// as Cloud Run logs it ([`logged`]).
pub async fn serve_on(listener: tokio::net::TcpListener, app: axum::Router) -> std::io::Result<()> {
    serve_on_within(listener, app, STALL).await
}

/// As [`serve_on`], a connection let go of once its write makes no headway for `stall`.
pub async fn serve_on_within(
    listener: tokio::net::TcpListener,
    app: axum::Router,
    stall: Duration,
) -> std::io::Result<()> {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let app = guarded(app)
        .layer(axum::middleware::from_fn(addressed))
        .layer(axum::middleware::from_fn_with_state(
            std::env::var_os("K_SERVICE").is_none(),
            logged,
        ))
        .into_make_service_with_connect_info::<Peer>();
    let listener = conn::Listener {
        tcp: listener,
        stall,
    };
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        })
        .await
}

/// The answer to `req`, and, where `print` is so, as it is off Cloud Run (`K_SERVICE` unset, as Cloud Run sets it), one
/// line on standard error saying it, as Cloud Run logs a request and nerd reads it ([`request_line`]), written whole
/// as the part telemetry writes its lines. Its latency is the time to the answer's head, not to its last byte.
async fn logged(
    State(print): State<bool>,
    req: Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    if !print {
        return next.run(req).await;
    }
    let began = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let answer = next.run(req).await;
    let line = request_line(method.as_str(), &path, answer.status(), began.elapsed());
    // One write, under stderr's lock, as eprint! takes it: and so a test's harness captures it as it does eprintln!.
    eprint!("{line}");
    answer
}

/// The line a request is printed as, with its newline: `{"httpRequest":{"requestMethod","requestUrl","status",
/// "latency"},"severity"}`, the URL its path alone, the latency as Cloud Logging writes it ([`latency`]), and the
/// severity ERROR for a 5xx, WARNING for a 4xx and INFO for the rest. Nothing of who asked: no address, user agent or
/// referer.
fn request_line(method: &str, path: &str, status: StatusCode, took: Duration) -> String {
    let severity = match status.as_u16() {
        500.. => "ERROR",
        400..=499 => "WARNING",
        _ => "INFO",
    };
    format!(
        "{{\"httpRequest\":{{\"requestMethod\":{},\"requestUrl\":{},\"status\":{},\"latency\":\"{}\"}},\"severity\":\"{severity}\"}}\n",
        quoted(method),
        quoted(path),
        status.as_u16(),
        latency(took),
    )
}

/// `took` as Cloud Logging writes a duration, in seconds, with 0, 3, 6 or 9 digits after the point, the fewest
/// that say it whole: `"0.012s"`, `"1.000500s"`, `"2s"`.
fn latency(took: Duration) -> String {
    let (secs, nanos) = (took.as_secs(), took.subsec_nanos());
    if nanos == 0 {
        format!("{secs}s")
    } else if nanos % 1_000_000 == 0 {
        format!("{secs}.{:03}s", nanos / 1_000_000)
    } else if nanos % 1_000 == 0 {
        format!("{secs}.{:06}s", nanos / 1_000)
    } else {
        format!("{secs}.{nanos:09}s")
    }
}

/// `text` as a JSON string.
fn quoted(text: &str) -> String {
    let mut q = String::with_capacity(text.len() + 2);
    q.push('"');
    for c in text.chars() {
        match c {
            '"' => q.push_str("\\\""),
            '\\' => q.push_str("\\\\"),
            c if (c as u32) < 0x20 => q.push_str(&format!("\\u{:04x}", c as u32)),
            c => q.push(c),
        }
    }
    q.push('"');
    q
}

/// `req`, carrying the address its [`Peer`] came from, as `ConnectInfo<SocketAddr>`.
async fn addressed(mut req: Request, next: axum::middleware::Next) -> axum::response::Response {
    let addr = req
        .extensions()
        .get::<ConnectInfo<Peer>>()
        .map(|ConnectInfo(peer)| peer.addr);
    if let Some(addr) = addr {
        req.extensions_mut().insert(ConnectInfo(addr));
    }
    next.run(req).await
}

#[cfg(test)]
mod tests;
