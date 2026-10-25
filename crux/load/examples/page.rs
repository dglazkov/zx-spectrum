//! The pages load.test.mts loads in Chrome, served as a product would serve them: by the part `server`, on the port
//! in `PORT`, sending to the part `telemetry`, whose lines it prints on standard output, as nerd would read them.
//!
//! - `/` and `/post/`, rendered whole, each with [`load::tag`] at the end of its `<head>`, and a policy that lets no
//!   script run but by [`load::hash`];
//! - `/app/`, built by script: it loads [`load::file`], and its own `/app.js` shows its view a few frames later, and
//!   calls `nerdLoad.ready("app")`.
//!
//! `cargo run -p load --example page`, and it says where it listens.

use std::sync::Arc;

use server::{header, Bytes, File, Site, Table};

const HTML: &str = "text/html; charset=utf-8";

fn rendered(view: &str, title: &str) -> File {
    let page = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" \
         content=\"width=device-width, initial-scale=1\"><title>{title}</title>{}</head><body><h1>{title}</h1>\
         <p>A page rendered whole on the server: it is whole once its HTML is parsed.</p>\
         <button id=\"press\">Press</button></body></html>",
        load::tag(view)
    );
    let policy = format!(
        "default-src 'none'; script-src '{}'; connect-src 'self'; style-src 'unsafe-inline'",
        load::hash()
    );
    File::new(
        format!("/{}", if view == "home" { "" } else { "post/" }),
        HTML,
        page.into(),
    )
    .with(header::CONTENT_SECURITY_POLICY, policy)
}

const APP: &str =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" \
    content=\"width=device-width, initial-scale=1\"><script src=\"/nerd-load.js\"></script>\
    <script src=\"/app.js\" defer></script><title>App</title></head><body></body></html>";

/// The view, shown whole three frames after the page is parsed, as one that waited for what it shows; and ready. When
/// the frame it is shown in began is `framed`, which ready is no earlier than.
const APP_JS: &str = "let frames = 3;
const show = () => {
  if (--frames) return requestAnimationFrame(show);
  document.body.innerHTML = '<h1>App</h1><p>A view built by script, shown whole.</p><button id=\"press\">Press</button>';
  nerdLoad.ready('app');
  requestAnimationFrame((frame) => { window.framed = frame; });
  nerdLoad.ready('again');
};
requestAnimationFrame(show);
";

#[tokio::main]
async fn main() {
    let files = vec![
        rendered("home", "Home"),
        rendered("post", "A post"),
        File::new("/app/", HTML, Bytes::from_static(APP.as_bytes())).with(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; script-src 'self'; connect-src 'self'",
        ),
        File::new(
            "/app.js",
            load::CONTENT_TYPE,
            Bytes::from_static(APP_JS.as_bytes()),
        ),
        load::file(),
    ];
    let not_found = File::new("", "text/plain", Bytes::from_static(b"not here"));
    let site = Arc::new(Site::new(Table::build(files, not_found)));
    let app = server::router(site).merge(telemetry::routes());
    if let Err(err) = server::serve(app).await {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
