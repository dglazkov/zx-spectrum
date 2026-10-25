//! A product's built directory, served whole (crux#33): what polivoks, synth-exp, zx-spectrum,
//! stitch-watch-face and reynolds-number each served from a Node server of their own.
//!
//! [`Dir::files`] reads every file in the directory, at its path from it, typed by its extension
//! ([`content_type`]); a directory's `index.html` at the directory's path too, as `/` and `/docs/`.
//! Nothing outside it is read: a symlink that leads out of it, or nowhere, is left out, and so is
//! every name that begins with a dot, a dotfile or a directory as `.git`, and what is in it. Where
//! `NAME.br` or `NAME.gz` sits beside `NAME`, it is `NAME`'s, sent as the build made it, and not a
//! file of its own. What the build named after its contents ([`hashed`]) is sent [`IMMUTABLE`].

use std::collections::{BTreeMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};

use super::{header, Bytes, File};

/// How long a browser keeps a file named after its contents: a year, and never asks again, as a
/// new build names a changed file anew.
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// A product's built directory, as Vite's `dist/`, to be served whole: what it is answered with,
/// for a path that names no file, and what headers the product sends with its files.
#[derive(Clone, Debug)]
pub struct Dir {
    root: PathBuf,
    fallback: Option<String>,
    headers: Vec<(String, header::HeaderName, String)>,
}

impl Dir {
    /// The directory at `root`, as it is when [`Dir::files`] reads it.
    pub fn new(root: impl Into<PathBuf>) -> Dir {
        Dir {
            root: root.into(),
            fallback: None,
            headers: Vec::new(),
        }
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
    /// contents, which is always [`IMMUTABLE`].
    pub fn header(
        mut self,
        prefix: impl Into<String>,
        name: header::HeaderName,
        value: impl Into<String>,
    ) -> Dir {
        self.headers.push((prefix.into(), name, value.into()));
        self
    }

    /// Every file of the directory, as it is now, ready for [`super::Table::build`]; the one its
    /// fallback names marked [`File::fallback`]. It fails where the directory cannot be read, or
    /// where its fallback names no file of it.
    pub fn files(&self) -> io::Result<Vec<File>> {
        let root = self.root.canonicalize()?;
        let mut found = BTreeMap::new();
        let mut seen = HashSet::from([root.clone()]);
        walk(&root, &root, "", &mut found, &mut seen)?;
        let read = |rel: &str| -> io::Result<Option<Bytes>> {
            match found.get(rel) {
                Some(p) => Ok(Some(std::fs::read(p)?.into())),
                None => Ok(None),
            }
        };
        let mut files = Vec::new();
        for rel in found.keys() {
            let packed = [".br", ".gz"]
                .iter()
                .any(|s| rel.strip_suffix(s).is_some_and(|n| found.contains_key(n)));
            if packed {
                continue;
            }
            let body = read(rel)?.unwrap_or_default();
            let path = format!("/{rel}");
            let mut paths = vec![path.clone()];
            if let Some(dir) = path.strip_suffix("index.html").filter(|d| d.ends_with('/')) {
                paths.push(dir.to_string());
            }
            for p in paths {
                let mut f = File::new(p.clone(), content_type(&path), body.clone());
                f.br = read(&format!("{rel}.br"))?;
                f.gzip = read(&format!("{rel}.gz"))?;
                f.headers = self.headers_of(&p);
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
