//! An event, as one line on standard output: `{"nerd":"event","name":...,"kind":...,"n":...,"ms":...}`.

use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Number, Value};

/// What happened, by its name, the thing and then what became of it (`song.made`, `take.kept`); of which kind, one
/// of the few the product names itself, never what a person typed; how many; and how long, in milliseconds.
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    name: String,
    kind: Option<String>,
    n: Option<Number>,
    ms: Option<Number>,
}

impl Event {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind: None,
            n: None,
            ms: None,
        }
    }

    pub fn kind(mut self, kind: impl Into<String>) -> Self {
        self.kind = Some(kind.into());
        self
    }

    pub fn n(mut self, n: u64) -> Self {
        self.n = Some(n.into());
        self
    }

    pub fn ms(mut self, ms: u64) -> Self {
        self.ms = Some(ms.into());
        self
    }

    /// What happened, by its name.
    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    /// How long, as `ms`.
    pub fn took(self, took: Duration) -> Self {
        self.ms(took.as_millis().try_into().unwrap_or(u64::MAX))
    }

    /// The event as the fields of a body sent to `/nerd/event`: those of another type are left out.
    pub(crate) fn from_body(body: &Map<String, Value>) -> Self {
        let text = |field| body.get(field).and_then(Value::as_str).map(str::to_string);
        let number = |field| match body.get(field) {
            Some(Value::Number(n)) => Some(n.clone()),
            _ => None,
        };
        Self {
            name: text("name").unwrap_or_default(),
            kind: text("kind"),
            n: number("n"),
            ms: number("ms"),
        }
    }

    /// The line it is printed as: none where its name is not of nerd's shape, which nerd would drop; and a kind not
    /// of it is left out, as nerd leaves it out.
    pub fn line(&self) -> Option<String> {
        #[derive(Serialize)]
        struct Line<'a> {
            nerd: &'static str,
            name: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            kind: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            n: Option<&'a Number>,
            #[serde(skip_serializing_if = "Option::is_none")]
            ms: Option<&'a Number>,
        }
        if !shaped(&self.name) {
            return None;
        }
        let line = Line {
            nerd: "event",
            name: &self.name,
            kind: self.kind.as_deref().filter(|kind| shaped(kind)),
            n: self.n.as_ref(),
            ms: self.ms.as_ref(),
        };
        Some(serde_json::to_string(&line).expect("an event's line is JSON"))
    }

    /// Prints its line on standard output, where it has one.
    pub fn print(&self) {
        if let Some(line) = self.line() {
            crate::write(std::io::stdout().lock(), &line);
        }
    }
}

/// Whether a name or a kind is of nerd's shape: short, lower case, words joined by dots, dashes or underscores, up to
/// 64; as nerd reads it, `^[a-z0-9][a-z0-9._-]{0,63}$`.
pub(crate) fn shaped(name: &str) -> bool {
    let word = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    match name.as_bytes() {
        [first, rest @ ..] => {
            name.len() <= 64
                && word(*first)
                && rest
                    .iter()
                    .all(|&b| word(b) || matches!(b, b'.' | b'-' | b'_'))
        }
        [] => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_is_its_fields_alone() {
        assert_eq!(
            Event::new("song.made")
                .kind("drums")
                .n(4)
                .ms(1830)
                .line()
                .as_deref(),
            Some(r#"{"nerd":"event","name":"song.made","kind":"drums","n":4,"ms":1830}"#)
        );
        assert_eq!(
            Event::new("take.kept").line().as_deref(),
            Some(r#"{"nerd":"event","name":"take.kept"}"#)
        );
        assert_eq!(
            Event::new("list.shopped").n(12).line().as_deref(),
            Some(r#"{"nerd":"event","name":"list.shopped","n":12}"#)
        );
        assert_eq!(
            Event::new("page.made")
                .took(Duration::from_micros(2_500_900))
                .line()
                .as_deref(),
            Some(r#"{"nerd":"event","name":"page.made","ms":2500}"#)
        );
    }

    #[test]
    fn a_name_not_of_the_shape_is_dropped() {
        let long = "a".repeat(65);
        for name in [
            "",
            "Song.made",
            "song made",
            ".song",
            "-song",
            "_song",
            "song/made",
            "chanté",
            "song\nmade",
            &long,
        ] {
            assert_eq!(Event::new(name).kind("drums").n(1).line(), None, "{name:?}");
        }
        for name in [
            "a",
            "song.made",
            "take_kept",
            "list-shopped",
            "2fa.passed",
            "a.",
            &"a".repeat(64),
        ] {
            assert!(Event::new(name).line().is_some(), "{name:?}");
        }
    }

    #[test]
    fn a_kind_not_of_the_shape_is_left_out() {
        for kind in [
            "",
            "Milk",
            "two words",
            "Anna",
            "x".repeat(65).as_str(),
            ".drums",
        ] {
            assert_eq!(
                Event::new("take.kept").kind(kind).n(2).line().as_deref(),
                Some(r#"{"nerd":"event","name":"take.kept","n":2}"#),
                "{kind:?}"
            );
        }
    }
}
