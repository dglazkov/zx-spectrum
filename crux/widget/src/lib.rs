//! nerd's feedback widget, served by the part `server` (crux#3).
//!
//! `nerd-feedback.js`, beside this directory's `Cargo.toml`, is the script `nerd telemetry widget`
//! prints, written out and committed under that name, so that nerd's look at each product's main
//! finds it, and files an issue to write it out again when nerd's widget changes. It is nerd's:
//! mend it in nerd, never here (`nerd guide telemetry`, The feedback widget). Write it out again
//! with `nerd telemetry widget > ts/widget/nerd-feedback.js` in crux, from where a product holds the
//! part, `crux/widget/nerd-feedback.js`, when nerd files that issue there; the test `the_copy_is_nerds`
//! fails while the copy is not the widget nerd prints.
//!
//! A product takes it with `nerd crux add widget`, beside the part `server`, and:
//!
//! - says where the part `server` is, in its workspace's `Cargo.toml`, as this crate depends on it:
//!   `[workspace.dependencies] server = { path = "crux/server" }`; and adds `crux/widget` to its members;
//! - adds [`file`] to the files its server's table is built from, which serves it at [`PATH`],
//!   compressed as any other text;
//! - loads it first in each page's `<head>`, before its own script, so that it hears the console
//!   from the start: `<script src="/nerd-feedback.js"></script>`;
//! - gives it its entry where the person would look for Feedback, a Feedback item in its menu, its
//!   settings or its help, which calls `nerdFeedback.open()`, and beside it
//!   `nerdFeedback.shortcut("Alt+Shift+F")`; the widget has no button of its own;
//! - tells it of each event the product emits, `nerdFeedback.event(name)`, so that the last few go
//!   with what the person sends to `/nerd/feedback`, which the part `telemetry` answers.

use server::{Bytes, File};

/// Where the widget is served.
pub const PATH: &str = "/nerd-feedback.js";

/// What it is served as.
pub const CONTENT_TYPE: &str = "text/javascript; charset=utf-8";

/// The widget, as `nerd telemetry widget` printed it.
pub const SCRIPT: &[u8] = include_bytes!("../nerd-feedback.js");

/// The widget, for the product's table: served at [`PATH`], with its type, and compressed as the
/// table compresses any text.
pub fn file() -> File {
    File::new(PATH, CONTENT_TYPE, Bytes::from_static(SCRIPT))
}

#[cfg(test)]
mod tests;
