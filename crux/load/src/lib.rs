//! Each load of a product's pages, measured in the browser and sent to `/nerd/event` (crux#8, lifted from blog#31),
//! as `nerd guide telemetry` says page loads: `load.ttfb`, `load.fcp`, `load.lcp`, `load.inp` and `load.ready` in
//! `ms`, `load.cls` in `n`, of the kind `VIEW.DEVICE`, all of a load in one beacon as the page is first hidden.
//!
//! `nerd-load.js`, beside this directory's `Cargo.toml`, is `load.ts` built and minified, committed so that a
//! product's build needs no Node: build it again where `load.ts` changes, as `load.ts` says, and `load.test.mts` fails
//! while it is not what `load.ts` builds to.
//!
//! A product takes it with `nerd crux add load`, beside the parts `server` and `telemetry`, and:
//!
//! - says where the part `server` is, in its workspace's `Cargo.toml`, as this crate depends on it, and `telemetry`
//!   too, for this crate's tests: `[workspace.dependencies] server = { path = "crux/server" }`; and adds `crux/load`
//!   to its members;
//! - merges the part `telemetry`'s routes into its router, where the events go: `app.merge(telemetry::routes())`;
//! - puts [`tag`] at the end of the `<head>` of each page rendered whole on the server, with its view (blog's `home`,
//!   `post`, `archive`): a few of the product's own, never anything of the reader's;
//! - where its pages are built by script, adds [`file`] to its table instead, loads it as early in their `<head>` as
//!   it can, `<script src="/nerd-load.js"></script>`, and calls `nerdLoad.ready(view)` once the page's first view is
//!   shown whole;
//! - where its pages have a content security policy, allows the script by its hash, `script-src '{hash()}'`, where
//!   it is inline, and lets it send home, `connect-src 'self'`.

use std::sync::LazyLock;

use base64::Engine;
use server::{Bytes, File};

/// Where the script is served, for a page that loads it as a file.
pub const PATH: &str = "/nerd-load.js";

/// What it is served as.
pub const CONTENT_TYPE: &str = "text/javascript; charset=utf-8";

const BUILT: &str = include_str!("../nerd-load.js");

/// The script, minified, as it goes inline in every page: one line, the same on each.
pub fn script() -> &'static str {
    BUILT.trim_end()
}

/// The script inline, for the end of a page's `<head>`, with the page's view on it: one of the product's own, short,
/// lower case, words joined by dots, dashes or underscores, as nerd reads an event's kind; any other panics, as it
/// is the product's own, and would not be counted.
pub fn tag(view: &str) -> String {
    assert!(
        shaped(view),
        "a page's view is not of nerd's shape: {view:?}"
    );
    format!("<script data-view=\"{view}\">{}</script>", script())
}

/// The hash a page's policy allows the script by, inline: `sha256-` and its digest in base64, in quotes in the
/// policy, as `script-src 'sha256-…'`.
pub fn hash() -> &'static str {
    static HASH: LazyLock<String> = LazyLock::new(|| hash_of(script()));
    &HASH
}

fn hash_of(script: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, script.as_bytes());
    format!(
        "sha256-{}",
        base64::engine::general_purpose::STANDARD.encode(digest)
    )
}

/// The script, for the product's table, for pages built by script: served at [`PATH`], with its type, and compressed
/// as the table compresses any text.
pub fn file() -> File {
    File::new(PATH, CONTENT_TYPE, Bytes::from_static(script().as_bytes()))
}

/// Whether a view is of the shape nerd keeps a kind of, with `.desktop` after it: `^[a-z0-9][a-z0-9._-]*$`, up to 56.
fn shaped(view: &str) -> bool {
    let word = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    match view.as_bytes() {
        [first, rest @ ..] => {
            view.len() + ".desktop".len() <= 64
                && word(*first)
                && rest
                    .iter()
                    .all(|&b| word(b) || matches!(b, b'.' | b'-' | b'_'))
        }
        [] => false,
    }
}

#[cfg(test)]
mod tests;
