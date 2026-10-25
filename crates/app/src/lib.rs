//! The deployed server (crux#35, zx-spectrum#9): the page built into `web/dist`, served whole by crux's part `server`
//! as crux's `examples/dir.rs` serves a built directory, and two things passed through for it.
//!
//! - every file of the build by [`Dir`]: its hashed assets kept a year, `/fonts/` a week, the rest as `Dir` sends
//!   them; no COOP or COEP, which the page does not need;
//! - nerd's feedback widget in the table (`widget`), which `index.html` loads first in its `<head>` itself;
//! - each load of a page measured (`load`), its tag at the end of each page's `<head>`: `home` and `how`;
//! - nerd's `/nerd/event` and `/nerd/feedback` (`telemetry`), merged into the router;
//! - `/archive` and `/zxinfo/v3`, passed through to the archive and the ZXInfo API ([`pass`]), answering from the
//!   ZXDB's own index where ZXInfo cannot ([`zxdb`]), a client that stops reading let go of once the time is up (crux's
//!   `server::Peer`).

pub mod pass;
pub mod zxdb;

use std::path::Path;
use std::sync::Arc;

use server::header::CACHE_CONTROL;
use server::{Bytes, Dir, File, Site, Table};

const NOT_FOUND: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Not here</title></head>\
    <body><h1>Not here</h1><p><a href=\"/\">ZX Spectrum</a></p></body></html>";

/// How long a browser keeps the fonts: a week, as they are not named after their contents.
pub const FONTS: &str = "public, max-age=604800";

/// The page's view, as nerd counts its loads: `home` for a directory's `index.html`, else the page's name, lower case,
/// what is not a letter, a digit, a dot, a dash or an underscore made a dash (crux's `examples/dir.rs`).
pub fn view(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or("");
    let name = name.strip_suffix(".html").unwrap_or(name);
    let view: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| match c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
            true => c,
            false => '-',
        })
        .collect();
    match view.trim_start_matches(['.', '-', '_']) {
        "" | "index" => "home".into(),
        v => v.chars().take(48).collect(),
    }
}

/// A page of the build, with the load's tag at the end of its `<head>`; any other file as it is. The widget's tag is
/// the page's own (`web/index.html`), so that the dev server's page loads it too, and once.
fn page(f: File) -> File {
    if !f.content_type.starts_with("text/html") {
        return f;
    }
    let html = String::from_utf8_lossy(&f.body);
    let html = html.replacen("</head>", &format!("{}</head>", load::tag(&view(&f.path))), 1);
    f.with_body(html)
}

/// Every file the server hands out: the build's, and the widget's.
pub fn files(dist: &Path) -> std::io::Result<Vec<File>> {
    let built = Dir::new(dist).header("/fonts/", CACHE_CONTROL, FONTS).files()?;
    let mut files: Vec<File> = built.into_iter().map(page).collect();
    files.push(widget::file());
    Ok(files)
}

/// The server: its files, nerd's paths, and the pass-through in front of both.
pub fn app(dist: &Path, pass: Arc<pass::Pass>) -> std::io::Result<server::Router> {
    let not_found = File::new("", "text/html; charset=utf-8", Bytes::from_static(NOT_FOUND.as_bytes()));
    let site = Arc::new(Site::new(Table::build(files(dist)?, not_found)));
    Ok(pass::layer(server::router(site).merge(telemetry::routes()), pass))
}
