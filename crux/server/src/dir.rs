//! A product's built directory, served whole (crux#33): what polivoks, synth-exp, zx-spectrum,
//! stitch-watch-face and reynolds-number each served from a Node server of their own.
//!
//! [`Dir::files`] reads every file in the directory, at its path from it, typed by its extension
//! ([`content_type`]); a directory's `index.html` at the directory's path too, as `/` and `/docs/`.
//! [`Dir::unread`] gives the same files unread, each read when it is first asked for or by the pass
//! a [`super::Site`] begins once it is first asked for anything, so that a product listens before a
//! byte of a large directory is read (crux#54); what it reads is what [`Dir::files`] would have.
//! Nothing outside it is read: a symlink that leads out of it, or nowhere, is left out, and so is
//! every name that begins with a dot, a dotfile or a directory as `.git`, and what is in it. Where
//! `NAME.br` or `NAME.gz` sits beside `NAME`, it is `NAME`'s, sent as the build made it, and not a
//! file of its own. What the build named after its contents ([`hashed`]) is sent [`IMMUTABLE`].
//! A file read late is read only where it still is inside the directory, as it was when it was
//! listed: one that became a symlink out of it since is not read, and is answered 503.
//!
//! [`Dir::header`] reaches only the files it reads: not the widget, telemetry's answers, the
//! not-found page nor a 405. A header every answer must have, as COOP and COEP, is named with
//! [`super::headers`] over the product's whole router instead (crux#44); [`Dir::header`] is for
//! what goes by path, as a policy on the pages or a Cache-Control on a directory.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{header, Bytes, File, Unread};

/// How long a browser keeps a file named after its contents: a year, and never asks again, as a
/// new build names a changed file anew.
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// What a file is read with, by its path on the disk.
type Reader = Arc<dyn Fn(&Path) -> io::Result<Vec<u8>> + Send + Sync>;

/// What a file is made, once it is read, before it is served.
type Map = Arc<dyn Fn(File) -> File + Send + Sync>;

/// A product's built directory, as Vite's `dist/`, to be served whole: what it is answered with,
/// for a path that names no file, what headers the product sends with its files, what it makes of
/// each once read, and what reads it.
#[derive(Clone)]
pub struct Dir {
    root: PathBuf,
    fallback: Option<String>,
    headers: Vec<(String, header::HeaderName, String)>,
    map: Option<Map>,
    reader: Reader,
}

impl std::fmt::Debug for Dir {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dir")
            .field("root", &self.root)
            .field("fallback", &self.fallback)
            .field("headers", &self.headers)
            .field("map", &self.map.is_some())
            .finish()
    }
}

impl Dir {
    /// The directory at `root`, as it is when [`Dir::files`] or [`Dir::unread`] lists it.
    pub fn new(root: impl Into<PathBuf>) -> Dir {
        Dir {
            root: root.into(),
            fallback: None,
            headers: Vec::new(),
            map: None,
            reader: Arc::new(|p: &Path| std::fs::read(p)),
        }
    }

    /// The same, each file made `map(file)` once it is read, before it is served: as a page with
    /// a tag put in its `<head>`. A directory's `index.html` is read once for both its paths, and
    /// given `map` at the one that ends `index.html`, where both are sent with the same headers.
    pub fn map(mut self, map: impl Fn(File) -> File + Send + Sync + 'static) -> Dir {
        self.map = Some(Arc::new(map));
        self
    }

    /// The same, each file's bytes, and its build's `.br` and `.gz`, read with `reader`, by
    /// where they are on the disk, in place of [`std::fs::read`]: as a test reads them slowly.
    pub fn reader(
        mut self,
        reader: impl Fn(&Path) -> io::Result<Vec<u8>> + Send + Sync + 'static,
    ) -> Dir {
        self.reader = Arc::new(reader);
        self
    }

    /// The same, a path with no extension that names no file answered, with 200, by the file at
    /// `path`, as an app's `/index.html` answers its routes; without it, such a path is the table's
    /// not-found page, as any other. A path with an extension that names nothing is never answered
    /// so: a script or a picture not there is a 404.
    pub fn fallback(mut self, path: impl Into<String>) -> Dir {
        self.fallback = Some(path.into());
        self
    }

    /// The same, each file whose path begins with `prefix` sent with `name: value`: `/` for every
    /// file, `/assets/` for those under it. Given again for the same name, the one given later
    /// is sent where both apply; a Cache-Control is sent so, but on a file named after its
    /// contents, which is always [`IMMUTABLE`]. A header for every answer, and not only the
    /// directory's files, is [`super::headers`]'s.
    pub fn header(
        mut self,
        prefix: impl Into<String>,
        name: header::HeaderName,
        value: impl Into<String>,
    ) -> Dir {
        self.headers.push((prefix.into(), name, value.into()));
        self
    }

    /// Every file of the directory, as it is now, read, ready for [`super::Table::build`]; the one
    /// its fallback names marked [`File::fallback`]. It fails where the directory, or a file of it,
    /// cannot be read, or where its fallback names no file of it.
    pub fn files(&self) -> io::Result<Vec<File>> {
        // Each file read once, though it is at two paths, so that it is one entry of the table.
        let mut read: HashMap<*const (), File> = HashMap::new();
        let mut files = Vec::new();
        for f in self.unread()? {
            let Some(u) = &f.unread else { continue };
            let key = Arc::as_ptr(&u.read) as *const ();
            let got = match read.get(&key) {
                Some(got) => got.clone(),
                None => read.entry(key).or_insert(u.read()?).clone(),
            };
            files.push(File {
                path: f.path,
                fallback: f.fallback,
                ..got
            });
        }
        Ok(files)
    }

    /// Every file of the directory, as it is listed now, none of it read: each [`File::unread`],
    /// read, with its build's `.br` and `.gz`, and made what [`Dir::map`] makes it, when it is
    /// first asked for or by the pass that reads the table ([`super::Table::read`]), whichever
    /// comes first; nothing but the names read now, so that the product listens at once, however
    /// large the directory (crux#54). The one its fallback names is marked
    /// [`File::fallback`]. It fails where the directory cannot be listed, or where its fallback
    /// names no file of it.
    pub fn unread(&self) -> io::Result<Vec<File>> {
        let root = self.root.canonicalize()?;
        let mut found = BTreeMap::new();
        let mut seen = HashSet::from([root.clone()]);
        walk(&root, &root, "", &mut found, &mut seen)?;
        let root = Arc::new(root);
        let mut files = Vec::new();
        for (rel, real) in &found {
            let packed = [".br", ".gz"]
                .iter()
                .any(|s| rel.strip_suffix(s).is_some_and(|n| found.contains_key(n)));
            if packed {
                continue;
            }
            let path = format!("/{rel}");
            let mut paths = vec![path.clone()];
            if let Some(dir) = path.strip_suffix("index.html").filter(|d| d.ends_with('/')) {
                paths.insert(0, dir.to_string());
            }
            let size = std::fs::metadata(real).map_or(0, |m| m.len());
            let source = Arc::new(Source {
                root: root.clone(),
                real: real.clone(),
                br: found.get(&format!("{rel}.br")).cloned(),
                gzip: found.get(&format!("{rel}.gz")).cloned(),
                reader: self.reader.clone(),
                map: self.map.clone(),
            });
            let mut shared: Option<(Vec<(header::HeaderName, String)>, Unread)> = None;
            for p in paths.iter().rev() {
                let headers = self.headers_of(p);
                let unread = match &shared {
                    Some((h, u)) if *h == headers => u.clone(),
                    _ => {
                        let (source, at, ct, h) = (
                            source.clone(),
                            p.clone(),
                            content_type(&path),
                            headers.clone(),
                        );
                        let u = Unread::new(size, move || source.read(&at, ct, &h));
                        shared = Some((headers.clone(), u.clone()));
                        u
                    }
                };
                let mut f = File::unread(p.clone(), content_type(&path), unread);
                f.headers = headers;
                f.fallback = self.fallback.as_deref() == Some(p.as_str());
                files.push(f);
            }
        }
        if let Some(page) = &self.fallback {
            if !files.iter().any(|f| f.fallback) {
                let not = format!("its fallback {page} is not in {}", self.root.display());
                return Err(io::Error::new(io::ErrorKind::NotFound, not));
            }
        }
        Ok(files)
    }

    /// What a file at `path` is sent with, of the product's and its Cache-Control.
    fn headers_of(&self, path: &str) -> Vec<(header::HeaderName, String)> {
        let mut out: Vec<(header::HeaderName, String)> = Vec::new();
        for (prefix, name, value) in &self.headers {
            if path.starts_with(prefix.as_str()) {
                out.retain(|(n, _)| n != name);
                out.push((name.clone(), value.clone()));
            }
        }
        if hashed(path) {
            out.retain(|(n, _)| *n != header::CACHE_CONTROL);
            out.push((header::CACHE_CONTROL, IMMUTABLE.into()));
        }
        out
    }
}

/// A file of the directory, where it was listed, to be read.
struct Source {
    root: Arc<PathBuf>,
    real: PathBuf,
    br: Option<PathBuf>,
    gzip: Option<PathBuf>,
    reader: Reader,
    map: Option<Map>,
}

impl Source {
    /// The file, at `path`, read now: its bytes, and its build's `.br` and `.gz`, each only where
    /// it is still inside the directory; made what the directory's map makes it.
    fn read(
        &self,
        path: &str,
        content_type: &str,
        headers: &[(header::HeaderName, String)],
    ) -> io::Result<File> {
        let read = |p: &Path| -> io::Result<Bytes> {
            let inside = p
                .canonicalize()
                .is_ok_and(|real| real.starts_with(&*self.root));
            if !inside {
                let not = format!("{} is no longer in {}", p.display(), self.root.display());
                return Err(io::Error::new(io::ErrorKind::NotFound, not));
            }
            match (self.reader)(p) {
                Ok(bytes) => Ok(bytes.into()),
                Err(e) => Err(io::Error::new(e.kind(), format!("{}: {e}", p.display()))),
            }
        };
        let mut f = File::new(path, content_type, read(&self.real)?);
        f.br = self.br.as_deref().map(read).transpose()?;
        f.gzip = self.gzip.as_deref().map(read).transpose()?;
        f.headers = headers.to_vec();
        Ok(match &self.map {
            Some(map) => map(f),
            None => f,
        })
    }
}

/// Every file under `dir`, by its path from `root` with `/` between its names, to where it is read:
/// none whose name begins with a dot, nor a symlink that leads outside `root` or nowhere; a
/// directory reached twice, by a symlink, read once.
fn walk(
    root: &Path,
    dir: &Path,
    prefix: &str,
    found: &mut BTreeMap<String, PathBuf>,
    seen: &mut HashSet<PathBuf>,
) -> io::Result<()> {
    let mut names: Vec<_> = std::fs::read_dir(dir)?.collect::<Result<_, _>>()?;
    names.sort_by_key(|e| e.file_name());
    for e in names {
        let Some(name) = e.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let Ok(real) = e.path().canonicalize() else {
            continue;
        };
        if !real.starts_with(root) {
            continue;
        }
        let rel = format!("{prefix}{name}");
        if real.is_dir() {
            if seen.insert(real.clone()) {
                walk(root, &real, &format!("{rel}/"), found, seen)?;
            }
        } else if real.is_file() {
            found.insert(rel, real);
        }
    }
    Ok(())
}

/// What a file at `path` is served as, by its extension, in any case: what a browser takes it
/// for; `application/octet-stream` where the extension is none of these.
pub fn content_type(path: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = match name.rsplit_once('.') {
        Some((_, ext)) => ext.to_ascii_lowercase(),
        None => String::new(),
    };
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "txt" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "xml" => "application/xml",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "pdf" => "application/pdf",
        "tgz" | "gz" => "application/gzip",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// Whether the file at `path` is named after its contents, as Vite names what it builds,
/// `assets/NAME-HASH.EXT`: in a directory named `assets`, its name before its first dot ending in
/// a dash and 8 to 32 of `A-Z a-z 0-9 _ -`, among them a digit or a capital, as a hash in base64
/// has, and as a word seldom does.
pub fn hashed(path: &str) -> bool {
    let mut names = path.rsplit('/');
    let name = names.next().unwrap_or("");
    if names.next() != Some("assets") {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").as_bytes();
    (8..=32).any(|n| {
        let Some(at) = stem.len().checked_sub(n + 1).filter(|&at| at > 0) else {
            return false;
        };
        let hash = &stem[at + 1..];
        stem[at] == b'-'
            && hash
                .iter()
                .all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
            && hash
                .iter()
                .any(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
    })
}
