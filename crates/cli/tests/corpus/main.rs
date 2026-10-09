//! The test corpus (docs/test-corpus.md): real software run on the machine and held to what real hardware
//! shows. A part a program (or a model of it); each reported to nerd with its time in emulated seconds. Run
//! with words to run only the parts whose names contain them: `cargo test -p zx-cli --test corpus -- fusetest`.

mod harness;
mod parts;

fn main() {
    let filters: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();
    let failures = harness::run(parts::ALL, &filters);
    if !failures.is_empty() {
        eprintln!("\n{} parts failed:", failures.len());
        for f in &failures {
            eprintln!("  {f}");
        }
        std::process::exit(1);
    }
}
