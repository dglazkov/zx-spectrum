//! An error the server catches and cannot mend, logged once, at severity ERROR, with its stack, as one line:
//! `{"severity":"ERROR","message":"..."}`, the message its first line, then its chain, then its stack.

use std::backtrace::Backtrace;
use std::error::Error as StdError;
use std::fmt;
use std::panic::PanicHookInfo;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// The most frames of a stack that are logged: nerd keeps the first few kilobytes of an error.
const FRAMES: usize = 32;

/// An error a request cannot be answered without: a handler returns `Result<_, telemetry::Error>`, and `?` keeps the
/// error with the stack where it was met. Answering with it logs it, once, and answers 500, or the 5xx `status` says.
pub struct Error {
    error: Box<dyn StdError + Send + Sync + 'static>,
    stack: Backtrace,
    status: StatusCode,
}

impl<E: StdError + Send + Sync + 'static> From<E> for Error {
    fn from(error: E) -> Self {
        Self {
            error: Box::new(error),
            stack: Backtrace::force_capture(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

/// An error that is words alone.
#[derive(Debug)]
struct Words(String);

impl fmt::Display for Words {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl StdError for Words {}

impl Error {
    /// An error that is words alone, where there is no error of another type to keep: what changes from one time
    /// to the next goes in quotes or numbers, so that nerd tells it as one error.
    pub fn msg(words: impl fmt::Display) -> Self {
        Words(words.to_string()).into()
    }

    /// Answers with another 5xx, as 502 where what the server depends on failed. Anything not a 5xx is not an error
    /// the server failed at, and is not one of these: it answers 500.
    pub fn status(mut self, status: StatusCode) -> Self {
        if status.is_server_error() {
            self.status = status;
        }
        self
    }

    /// A panic, as the hook [`panics`] says it: its words, and where it was, then the stack of the panic.
    pub fn panicked(info: &PanicHookInfo) -> Self {
        let payload = info.payload();
        let words = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("a panic with no words");
        match info.location() {
            Some(at) => Self::msg(format!("{words} (panicked at {at})")),
            None => Self::msg(format!("{words} (panicked)")),
        }
    }

    /// The line it is logged as.
    pub fn line(&self) -> String {
        line(&*self.error, &self.stack)
    }

    /// Logs it, on standard error. Answering with it logs it: do not log it as well.
    pub fn log(&self) {
        crate::write(std::io::stderr().lock(), &self.line());
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        self.log();
        self.status.into_response()
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        fmt::Debug::fmt(&self.error, f)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        fmt::Display::fmt(&self.error, f)
    }
}

/// Logs an error caught outside a request, as a job's, where it is caught, with the stack of where it is logged.
pub fn error(error: &(dyn StdError + 'static)) {
    crate::write(
        std::io::stderr().lock(),
        &line(error, &Backtrace::force_capture()),
    );
}

/// Says each panic of the process once, on standard error, as an error's line, with the stack of the panic, in place
/// of Rust's own words for it, so that nerd files it as an error: in a request, where the part server answers it 500,
/// a job, or the process's end. The part server's `serve` calls it.
pub fn panics() {
    std::panic::set_hook(Box::new(|info| Error::panicked(info).log()));
}

fn line(error: &(dyn StdError + 'static), stack: &Backtrace) -> String {
    #[derive(Serialize)]
    struct Line<'a> {
        severity: &'static str,
        message: &'a str,
    }
    let mut message = error.to_string();
    let mut cause = error.source();
    while let Some(error) = cause {
        message.push_str(&format!("\ncaused by: {error}"));
        cause = error.source();
    }
    for frame in frames(&stack.to_string()) {
        message.push_str("\n    at ");
        message.push_str(&frame);
    }
    serde_json::to_string(&Line {
        severity: "ERROR",
        message: &message,
    })
    .expect("an error's line is JSON")
}

/// The frames of a stack as Rust writes it, each as `function (file:line:column)`, or the function alone where the
/// build keeps no lines, as nerd reads a frame (`    at ...`); from the first that is not of taking the stack itself,
/// the standard library's or this file's, so that the top frame is where the error was met.
fn frames(stack: &str) -> Vec<String> {
    let mut frames: Vec<(String, Option<String>)> = Vec::new();
    for line in stack.lines().map(str::trim_start) {
        if let Some((n, function)) = line.split_once(": ") {
            if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) {
                frames.push((function.to_string(), None));
                continue;
            }
        }
        if let (Some(at), Some((_, place @ None))) = (line.strip_prefix("at "), frames.last_mut()) {
            *place = Some(at.to_string());
        }
    }
    let taking = |function: &str| {
        let function = function.trim_start_matches('<');
        [
            "std::",
            "core::",
            "alloc::",
            "T as core::",
            "telemetry::error::Error",
            "telemetry::error::Words",
            "telemetry::error::error",
            "telemetry::error::panic",
            "__rustc::",
        ]
        .iter()
        .any(|of| function.starts_with(of))
    };
    frames
        .into_iter()
        .skip_while(|(function, _)| taking(function))
        .take(FRAMES)
        .map(|(function, at)| match at {
            Some(at) => format!("{function} ({at})"),
            None => function,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::Value;

    /// An error with words of its own, and what it was caused by.
    #[derive(Debug)]
    struct Failed(&'static str, Option<Box<Failed>>);

    impl fmt::Display for Failed {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str(self.0)
        }
    }

    impl StdError for Failed {
        fn source(&self) -> Option<&(dyn StdError + 'static)> {
            self.1.as_deref().map(|e| e as _)
        }
    }

    fn fetch_page() -> Result<(), Failed> {
        let reset = Failed(
            "the connection was reset",
            Some(Box::new(Failed("os error 104", None))),
        );
        Err(Failed(
            "the recipe's site answered 403",
            Some(Box::new(reset)),
        ))
    }

    fn handler() -> Result<(), Error> {
        fetch_page()?;
        Ok(())
    }

    /// The fields of a line, where it is a JSON object of them alone.
    fn fields(line: &str) -> (String, String) {
        assert!(!line.contains('\n'), "{line}");
        let Value::Object(fields) = serde_json::from_str(line).unwrap() else {
            panic!("{line}")
        };
        let mut keys: Vec<_> = fields.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["message", "severity"], "{line}");
        let text = |key: &str| fields[key].as_str().unwrap().to_string();
        (text("severity"), text("message"))
    }

    #[test]
    fn an_error_is_its_first_line_its_chain_and_its_stack() {
        let error = handler().unwrap_err();
        let (severity, message) = fields(&error.line());
        assert_eq!(severity, "ERROR");
        let lines: Vec<&str> = message.lines().collect();
        assert_eq!(
            lines[..3],
            [
                "the recipe's site answered 403",
                "caused by: the connection was reset",
                "caused by: os error 104",
            ],
            "{message}"
        );
        // The top frame is the handler where `?` met it, not the taking of the stack.
        assert!(
            lines[3].starts_with("    at telemetry::error::tests::handler (")
                && lines[3].contains("error.rs:"),
            "{message}"
        );
        assert!(
            lines[3..].iter().all(|line| line.starts_with("    at ")),
            "{message}"
        );
        assert!(lines.len() > 4 && lines.len() <= 3 + FRAMES, "{message}");
    }

    #[test]
    fn words_alone_are_an_error() {
        let (severity, message) = fields(&Error::msg("the store is \"gone\"").line());
        assert_eq!(severity, "ERROR");
        assert!(
            message.starts_with("the store is \"gone\"\n    at telemetry::error::tests::"),
            "{message}"
        );
    }

    #[test]
    fn an_error_is_answered_with_a_5xx() {
        let status = |error: Error| error.into_response().status();
        assert_eq!(
            status(handler().unwrap_err()),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status(Error::msg("upstream").status(StatusCode::BAD_GATEWAY)),
            StatusCode::BAD_GATEWAY
        );
        for not in [
            StatusCode::NOT_FOUND,
            StatusCode::BAD_REQUEST,
            StatusCode::OK,
        ] {
            assert_eq!(
                status(Error::msg("x").status(not)),
                StatusCode::INTERNAL_SERVER_ERROR
            );
        }
    }

    #[test]
    fn frames_are_read_from_where_the_error_was_met() {
        let stack = "   0: std::backtrace_rs::backtrace::libunwind::trace
             at /rustc/abc/library/std/src/../../backtrace/src/backtrace/libunwind.rs:116:5
   1: std::backtrace::Backtrace::create
             at /rustc/abc/library/std/src/backtrace.rs:331:13
   2: <telemetry::error::Error as core::convert::From<E>>::from
   2: <telemetry::error::Error>::msg::<&str>
   2: <telemetry::error::Words as core::convert::Into<telemetry::error::Error>>::into
             at ./src/error.rs:26:20
   3: <core::result::Result<T,F> as core::ops::try_trait::FromResidual<core::result::Result<core::convert::Infallible,E>>>::from_residual
             at /rustc/abc/library/core/src/result.rs:2009:27
   4: blog::recipes::fetch
             at ./crates/server/src/recipes.rs:40:9
             at ./crates/server/src/lib.rs:12:1
   5: <unknown>
   6: tokio::runtime::task::harness::poll
";
        assert_eq!(
            frames(stack),
            [
                "blog::recipes::fetch (./crates/server/src/recipes.rs:40:9)",
                "<unknown>",
                "tokio::runtime::task::harness::poll",
            ]
        );
        // A build with no lines kept, as a release's.
        assert_eq!(
            frames("   0: std::backtrace::Backtrace::create\n   1: blog::serve\n"),
            ["blog::serve"]
        );
        assert_eq!(frames("unsupported backtrace"), Vec::<String>::new());
        let long: String = (0..100).map(|n| format!("  {n}: blog::f{n}\n")).collect();
        assert_eq!(frames(&long).len(), FRAMES);
    }
}
