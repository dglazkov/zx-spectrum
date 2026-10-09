//! What the corpus's parts share: fixtures, reference pictures, the report to nerd, and running parts side by
//! side.

use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use spectrum::{Machine, Model, Options};
use zx_cli::image;
use zx_cli::script::{Action, Session};

/// How a part ended. Its time is reported in emulated seconds, counted from the frames it ran: nothing here
/// reads the wall clock.
pub enum Outcome {
    Passed(String),
    Failed(String),
    Skipped(String),
}

pub type PartFn = fn(&mut Ctx) -> Result<String, String>;

pub struct Part {
    pub name: &'static str,
    pub run: PartFn,
}

/// What a part has to hand: the fixtures, and its emulated time so far.
pub struct Ctx {
    pub seconds: f64,
    pub skipped: Option<String>,
}

impl Ctx {
    /// A fixture's bytes, or Err after marking the part skipped when it cannot be fetched.
    pub fn fixture(&mut self, name: &str) -> Result<Vec<u8>, String> {
        match fixture_path(name) {
            Ok(Some(p)) => std::fs::read(&p).map_err(|e| format!("{name}: {e}")),
            Ok(None) => {
                self.skipped = Some(format!("fixture {name} could not be fetched"));
                Err(format!("SKIPPED: fixture {name} could not be fetched"))
            }
            Err(e) => Err(e),
        }
    }

    /// A session of `model` with `options` (sound off: the corpus looks at pictures and text), `file` loaded
    /// and LOAD "" typed for a tape.
    pub fn session(
        &mut self,
        model: Model,
        options: Options,
        file: &str,
    ) -> Result<Session, String> {
        self.session_sound(
            model,
            Options {
                sound: false,
                ..options
            },
            file,
        )
    }

    /// The same, with the options as given (sound on, if they say so).
    pub fn session_sound(
        &mut self,
        model: Model,
        options: Options,
        file: &str,
    ) -> Result<Session, String> {
        let bytes = self.fixture(file)?;
        let mut s = Session::new(model, options);
        let l =
            s.zx.load(&bytes, file)
                .map_err(|e| format!("{file}: {e}"))?;
        if l.kind == spectrum::LoadedKind::Tape {
            s.at.push((0, Action::Load));
        }
        Ok(s)
    }

    /// Counts a session's frames into the part's time.
    pub fn spent(&mut self, s: &Session) {
        self.seconds += s.frame as f64 / s.zx.model().frame_rate();
    }

    /// A reference picture as Spectrum colour numbers: (pixels, width, height).
    pub fn reference(&mut self, name: &str) -> Result<(Vec<u8>, usize, usize), String> {
        let bytes = self.fixture(name)?;
        let rgb = image::read_image(&bytes).map_err(|e| format!("{name}: {e}"))?;
        Ok((rgb.colour_numbers(), rgb.width, rgb.height))
    }

    /// A loading screen (.scr) as the paper's 768 cells: each cell's 8 bitmap bytes and its attribute.
    pub fn scr_cells(&mut self, name: &str) -> Result<Vec<[u8; 9]>, String> {
        let bytes = self.fixture(name)?;
        let scr = snapshot::load_scr(&bytes).map_err(|e| format!("{name}: {e}"))?;
        Ok(cells_of(&scr[..]))
    }
}

/// A screen's 768 cells: 8 bitmap bytes and the attribute each.
pub fn cells_of(screen: &[u8]) -> Vec<[u8; 9]> {
    let mut out = Vec::with_capacity(768);
    for cy in 0..24usize {
        for cx in 0..32usize {
            let mut c = [0u8; 9];
            for (y, b) in c.iter_mut().take(8).enumerate() {
                let line = cy * 8 + y;
                let addr = ((line & 0xC0) << 5) | ((line & 0x07) << 8) | ((line & 0x38) << 2) | cx;
                *b = screen[addr];
            }
            c[8] = screen[0x1800 + cy * 32 + cx];
            out.push(c);
        }
    }
    out
}

/// How many of the screen's cells (in rows `rows`, columns `cols`) equal the reference's.
pub fn cells_matching(
    zx: &Machine,
    reference: &[[u8; 9]],
    rows: std::ops::Range<usize>,
    cols: std::ops::Range<usize>,
) -> usize {
    let (p, _, _) = zx.paging();
    let bank = if zx.model().is_128k() && p & 8 != 0 {
        7
    } else {
        5
    };
    let ours = cells_of(zx.ram_bank(bank));
    let mut n = 0;
    for r in rows {
        for c in cols.clone() {
            if ours[r * 32 + c] == reference[r * 32 + c] {
                n += 1;
            }
        }
    }
    n
}

/// The frame compared with a reference: (differing, compared), the reference placed by its size.
pub fn frame_vs(zx: &Machine, (b, bw, bh): &(Vec<u8>, usize, usize)) -> (usize, usize) {
    let (ox, oy) = match (bw, bh) {
        (352, 240) => (0, 24),
        (256, 192) => (48, 48),
        _ => (0, 0),
    };
    let d = image::compare(zx.frame(), 352, ox, oy, b, *bw, *bh);
    (d.differing, d.compared)
}

/// The frame's cells (8 × 8 pixels of the paper) equal to a 256 × 192 reference's, in rows `rows`.
pub fn paper_cells_vs(
    zx: &Machine,
    (b, bw, _): &(Vec<u8>, usize, usize),
    rows: std::ops::Range<usize>,
) -> (usize, usize) {
    let f = zx.frame();
    let norm = |c: u8| if c == 8 { 0 } else { c };
    let (mut same, mut n) = (0, 0);
    for cy in rows {
        for cx in 0..32 {
            n += 1;
            let mut eq = true;
            'cell: for y in 0..8 {
                for x in 0..8 {
                    let (px, py) = (cx * 8 + x, cy * 8 + y);
                    if norm(f[(48 + py) * 352 + 48 + px]) != norm(b[py * bw + px]) {
                        eq = false;
                        break 'cell;
                    }
                }
            }
            same += eq as usize;
        }
    }
    (same, n)
}

/// The colours the border shows in a frame (rows 0–47 and 240–295, and the side borders of the rows between).
pub fn border_colours(zx: &Machine) -> Vec<u8> {
    let f = zx.frame();
    let mut seen = [false; 16];
    for y in 0..296 {
        for x in 0..352 {
            if (48..240).contains(&y) && (48..304).contains(&x) {
                continue;
            }
            seen[f[y * 352 + x] as usize] = true;
        }
    }
    (0..16u8).filter(|&c| seen[c as usize]).collect()
}

/// Rows of text with runs of spaces made one: for matching lines whose spacing does not matter.
pub fn squeeze(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn fixture_path(name: &str) -> Result<Option<PathBuf>, String> {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/fixture");
    let out = Command::new(script)
        .arg(name)
        .output()
        .map_err(|e| format!("scripts/fixture: {e}"))?;
    match out.status.code() {
        Some(0) => Ok(Some(PathBuf::from(
            String::from_utf8_lossy(&out.stdout).trim(),
        ))),
        Some(3) => Ok(None),
        _ => Err(format!(
            "scripts/fixture {name}: {}",
            String::from_utf8_lossy(&out.stderr)
        )),
    }
}

static REPORT: Mutex<()> = Mutex::new(());

fn report(part: &str, seconds: f64, outcome: &str, said: &str) {
    let Ok(path) = std::env::var("NERD_REPORT") else {
        return;
    };
    let line = serde_json::json!({ "part": format!("corpus › {part}"), "seconds": seconds,
                                   "outcome": outcome, "said": said });
    let _g = REPORT.lock();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{line}");
    }
}

/// Runs the parts whose names contain any of `filters` (all if none), side by side, the longest first by
/// nerd's record (NERD_USUAL); reports each; returns the failures.
pub fn run(parts: &[Part], filters: &[String]) -> Vec<String> {
    let mut chosen: Vec<&Part> = parts
        .iter()
        .filter(|p| filters.is_empty() || filters.iter().any(|f| p.name.contains(f.as_str())))
        .collect();
    let usual = usual_seconds();
    chosen.sort_by(|a, b| {
        let ua = usual.get(a.name).copied().unwrap_or(30.0);
        let ub = usual.get(b.name).copied().unwrap_or(30.0);
        ub.total_cmp(&ua)
    });
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .clamp(1, 8);
    let queue = Mutex::new(chosen.into_iter());
    let failures = Mutex::new(Vec::new());
    let counts = Mutex::new((0usize, 0usize, 0usize));
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let Some(part) = queue.lock().unwrap().next() else {
                        break;
                    };
                    let mut ctx = Ctx {
                        seconds: 0.0,
                        skipped: None,
                    };
                    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        (part.run)(&mut ctx)
                    }));
                    let outcome = match r {
                        Ok(Ok(s)) => Outcome::Passed(s),
                        Ok(Err(e)) if ctx.skipped.is_some() => Outcome::Skipped(e),
                        Ok(Err(e)) => Outcome::Failed(e),
                        Err(p) => Outcome::Failed(format!(
                            "panicked: {}",
                            p.downcast_ref::<String>()
                                .cloned()
                                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                                .unwrap_or_default()
                        )),
                    };
                    let mut c = counts.lock().unwrap();
                    match &outcome {
                        Outcome::Passed(s) => {
                            c.0 += 1;
                            eprintln!(
                                "passed   {} ({:.0} s emulated): {s}",
                                part.name, ctx.seconds
                            );
                            report(part.name, ctx.seconds, "passed", s);
                        }
                        Outcome::Failed(s) => {
                            c.1 += 1;
                            eprintln!(
                                "FAILED   {} ({:.0} s emulated): {s}",
                                part.name, ctx.seconds
                            );
                            report(part.name, ctx.seconds, "failed", s);
                            failures.lock().unwrap().push(format!("{}: {s}", part.name));
                        }
                        Outcome::Skipped(s) => {
                            c.2 += 1;
                            eprintln!("skipped  {}: {s}", part.name);
                            report(part.name, ctx.seconds, "skipped", s);
                        }
                    }
                }
            });
        }
    });
    let (p, f, s) = *counts.lock().unwrap();
    eprintln!("corpus: {p} passed, {f} failed, {s} skipped");
    failures.into_inner().unwrap()
}

fn usual_seconds() -> std::collections::HashMap<String, f64> {
    let mut m = std::collections::HashMap::new();
    if let Ok(path) = std::env::var("NERD_USUAL")
        && let Ok(text) = std::fs::read_to_string(path)
    {
        for line in text.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line)
                && let (Some(p), Some(s)) = (v["part"].as_str(), v["seconds"].as_f64())
            {
                m.insert(p.trim_start_matches("corpus › ").to_string(), s);
            }
        }
    }
    m
}
