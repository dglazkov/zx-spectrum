//! A panic, said by `telemetry::panics()`: in a process of the test's own, which this same program is, started again
//! with `PANIC_CHILD` set, as the hook is the process's; what it writes on standard error read whole. Each panic is
//! one line, at severity ERROR, its words and where first, then its stack from where it panicked, and nothing of
//! Rust's own words; a panic in a thread and one in the main thread alike, and the process ends as a panic ends it.

use std::process::Command;

use serde_json::Value;

/// Where the page was not found: the top frame of the first panic's stack.
#[inline(never)]
fn find_page() {
    panic!("the {:?} was not there", "page");
}

fn child() {
    telemetry::panics();
    let _ = std::thread::spawn(find_page).join();
    let words = String::from("the job ended");
    std::panic::panic_any(words);
}

/// What the test runner asked, as nextest asks a harness of a program's own
/// (https://nexte.st/docs/design/custom-test-harnesses/): `--list` is answered with the one test, `panic`, and none
/// where only the ignored are asked for; and the check runs where no test is named, or `panic` is (`--exact` the name
/// whole, else a part of it), and not where it is skipped.
fn asked() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut list, mut ignored, mut exact) = (false, false, false);
    let (mut names, mut skips) = (vec![], vec![]);
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--list" => list = true,
            "--ignored" => ignored = true,
            "--exact" => exact = true,
            "--skip" => skips.extend(it.next().map(String::as_str)),
            "--format" | "--color" | "--test-threads" | "--logfile" | "-Z" => {
                it.next();
            }
            a if a.starts_with('-') => {}
            a => names.push(a),
        }
    }
    let is = |name: &str| {
        if exact {
            name == "panic"
        } else {
            "panic".contains(name)
        }
    };
    let run = (names.is_empty() || names.iter().any(|n| is(n))) && !skips.iter().any(|s| is(s));
    if list {
        if run && !ignored {
            println!("panic: test");
        }
        return false;
    }
    run
}

fn main() {
    if std::env::var_os("PANIC_CHILD").is_some() {
        return child();
    }
    if !asked() {
        return;
    }
    let out = Command::new(std::env::current_exe().unwrap())
        .env("PANIC_CHILD", "1")
        .env_remove("RUST_BACKTRACE")
        .output()
        .unwrap();
    assert!(
        !out.status.success(),
        "the process ended well after a panic"
    );
    let stderr = String::from_utf8(out.stderr).unwrap();
    let lines: Vec<&str> = stderr.lines().collect();
    assert_eq!(lines.len(), 2, "not a line a panic:\n{stderr}");
    let message = |line: &str| {
        let Value::Object(fields) = serde_json::from_str(line).expect(line) else {
            panic!("{line}")
        };
        let mut keys: Vec<_> = fields.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["message", "severity"], "{line}");
        assert_eq!(fields["severity"], "ERROR", "{line}");
        fields["message"].as_str().unwrap().to_string()
    };

    let first = message(lines[0]);
    let said: Vec<&str> = first.lines().collect();
    assert!(
        said[0].starts_with(r#"the "page" was not there (panicked at "#)
            && said[0].contains("tests/panic.rs:")
            && said[0].ends_with(')'),
        "{first}"
    );
    assert!(
        said[1].starts_with("    at panic::find_page (") && said[1].contains("panic.rs:"),
        "the top frame is not where it panicked: {first}"
    );
    assert!(
        said[1..].iter().all(|l| l.starts_with("    at ")),
        "{first}"
    );

    let second = message(lines[1]);
    assert!(
        second.starts_with("the job ended (panicked at ")
            && second.contains("\n    at panic::child"),
        "{second}"
    );
    println!("panic: each said once, as an error, with its stack");
}
