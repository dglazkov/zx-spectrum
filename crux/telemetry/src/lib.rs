//! What a product's server records of its use, as nerd reads it (`nerd guide telemetry`): its key events, its
//! errors with their stacks, and the person's feedback, each one JSON line that Cloud Logging keeps and nerd reads.
//!
//! - An event, printed where it happens: `Event::new("song.made").kind("drums").n(4).print()`.
//! - The paths a product's pages send to, `/nerd/event` and `/nerd/feedback`: `app.merge(telemetry::routes())`.
//! - An error the server cannot mend: a handler returns `Result<_, telemetry::Error>`, and `?` keeps the error and
//!   its stack, logged once, at severity ERROR, as the request is answered 500; or `telemetry::error(&err)` where
//!   it is caught outside a request, as in a job.

mod error;
mod event;
mod routes;

pub use error::{error, Error};
pub use event::Event;
pub use routes::{routes, BURST, EVENTS, LIMIT, RATE};

use std::io::Write;

/// Writes a line whole, at once, so that no other line is written into the middle of it.
fn write(mut to: impl Write, line: &str) {
    let mut text = String::with_capacity(line.len() + 1);
    text.push_str(line);
    text.push('\n');
    let _ = to.write_all(text.as_bytes());
    let _ = to.flush();
}
