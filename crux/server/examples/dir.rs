//! A product's main.rs that serves its built directory, `dist/`, as Vite or a hand-built page writes it, with the
//! parts a new product starts with (crux#33): what polivoks, synth-exp, zx-spectrum, stitch-watch-face and
//! reynolds-number each write in place of their Node server.
//!
//! - every file of `dist/` by [`Dir`], read once the server listens (crux#54): the build's own `.br` and `.gz` sent as
//!   they are, its hashed assets kept a year, and its `index.html` the page of every route of the app;
//! - nerd's feedback widget in the table (`widget`), loaded first in each page's `<head>`;
//! - each load of a page measured (`load`), its tag at the end of each page's `<head>`, its view the page's name;
//! - the paths the pages send their telemetry to (`telemetry`), merged into the router;
//! - the headers the product sends with every answer, here COOP and COEP, which make the page cross-origin isolated,
//!   as polivoks and synth-exp need for their shared memory, put over the whole router with [`server::headers`], so
//!   that the widget, telemetry's answers, a 404 and a 405 have them as the build's files do (crux#44).
//!
//! `cargo run -p server --example dir -- DIR`, `dist` where no directory is given; it says where it listens. A page
//! with a content security policy of its own allows the load's script by [`load::hash`], and the product's own
//! Feedback calls `nerdFeedback.open()`, as the parts `load` and `widget` say.

use std::path::Path;
use std::sync::Arc;

use server::header::HeaderName;
use server::{Bytes, Dir, File, Site, Table};

const NOT_FOUND: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Not here</title></head>\
    <body><h1>Not here</h1><p><a href=\"/\">Home</a></p></body></html>";

/// The page's view, as nerd counts its loads: `home` for a directory's `index.html`, else the page's name, lower case,
/// what is not a letter, a digit, a dot, a dash or an underscore made a dash.
fn view(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or("");
    let name = name.strip_suffix(".html").unwrap_or(name);
    let view: String = name
        .to_ascii_lowercase()
        .chars()
        .map(
            |c| match c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                true => c,
                false => '-',
            },
        )
        .collect();
    match view.trim_start_matches(['.', '-', '_']) {
        "" | "index" => "home".into(),
        v => v.chars().take(48).collect(),
    }
}

/// A page of the build, with the widget first in its `<head>` and the load's tag at its end; any other file as it is.
fn page(f: File) -> File {
    if !f.content_type.starts_with("text/html") {
        return f;
    }
    let html = String::from_utf8_lossy(&f.body);
    let html = html
        .replacen(
            "<head>",
            &format!("<head><script src=\"{}\"></script>", widget::PATH),
            1,
        )
        .replacen(
            "</head>",
            &format!("{}</head>", load::tag(&view(&f.path))),
            1,
        );
    f.with_body(html)
}

/// Every file the product serves: its build's, unread, each read and made a [`page`] when it is first asked for or by
/// the pass that compresses the table, so that the server listens at once, however large the build (crux#54); and the
/// widget's.
pub fn files(dist: &Path) -> std::io::Result<Vec<File>> {
    let mut files = Dir::new(dist).fallback("/index.html").map(page).unread()?;
    files.push(widget::file());
    Ok(files)
}

/// The product's server: its files, the paths its pages send their telemetry to, and its headers on every answer.
pub fn app(dist: &Path) -> std::io::Result<server::Router> {
    let not_found = File::new(
        "",
        "text/html; charset=utf-8",
        Bytes::from_static(NOT_FOUND.as_bytes()),
    );
    let site = Arc::new(Site::new(Table::build(files(dist)?, not_found)));
    let app = server::router(site).merge(telemetry::routes());
    // COOP and COEP, so that the pages are cross-origin isolated: on every answer, or they are not.
    Ok(server::headers(
        app,
        [
            ("cross-origin-opener-policy", "same-origin"),
            ("cross-origin-embedder-policy", "require-corp"),
        ]
        .map(|(n, v)| (HeaderName::from_static(n), v)),
    ))
}

#[tokio::main]
async fn main() {
    let dist = std::env::args().nth(1).unwrap_or_else(|| "dist".into());
    let app = match app(Path::new(&dist)) {
        Ok(app) => app,
        Err(err) => {
            eprintln!("{dist}: {err}");
            std::process::exit(1);
        }
    };
    if let Err(err) = server::serve(app).await {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
