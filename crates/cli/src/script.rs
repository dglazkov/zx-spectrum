//! A machine run headless to a script: keys pressed at frames or when a text appears, text typed at the ROM's
//! pace, the tape played, stopping at a frame or when a text appears. What `zx run` does, and what the corpus
//! tests drive.

use spectrum::{Machine, Model, Options, ScreenText, keys};

/// What to do.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Chords pressed one after another, each held the given frames, as long again apart (a game's keys).
    Keys(Vec<Vec<u8>>, u64),
    /// Text typed at the ROM's pace.
    Type(String),
    /// Chords typed at the ROM's pace (keywords on a 48K: J is LOAD).
    TypeChords(Vec<Vec<u8>>),
    /// LOAD "" on a 48K or 16K, ENTER (Tape Loader) on a machine with the 128's menu.
    Load,
    Play,
    Stop,
    /// A picture of the frame, to a file.
    Png(String),
}

/// How long a pressed key is held and the gap between keys of a sequence (docs/test-corpus.md: "press K means
/// hold the key for 5 frames, then release it").
pub const PRESS_FRAMES: u64 = 5;

/// Parses keys to press: names joined by `+` (held together), chords separated by `,` or spaces, and a hold
/// in frames after a `/` (5 if not given): `ENTER`, `SS+P`, `CS+5,CS+5`, `1 0`, `1/30`.
pub fn parse_keys(s: &str) -> Result<Action, String> {
    let (keys, hold) = match s.rsplit_once('/') {
        Some((k, h)) if !h.is_empty() && h.chars().all(|c| c.is_ascii_digit()) => {
            (k, h.parse().unwrap())
        }
        _ => (s, PRESS_FRAMES),
    };
    Ok(Action::Keys(parse_chords(keys)?, hold))
}

/// Parses chords: names joined by `+` (held together), chords separated by `,` or spaces: `ENTER`, `SS+P`,
/// `CS+5,CS+5`, `1 0`.
pub fn parse_chords(s: &str) -> Result<Vec<Vec<u8>>, String> {
    let mut out = Vec::new();
    for chord in s.split([',', ' ']).filter(|c| !c.is_empty()) {
        let mut keys = Vec::new();
        for k in chord.split('+') {
            keys.push(spectrum::key_code(k).ok_or_else(|| format!("no Spectrum key '{k}'"))?);
        }
        out.push(keys);
    }
    if out.is_empty() {
        return Err(format!("no keys in '{s}'"));
    }
    Ok(out)
}

/// A rule: whenever the screen shows `text`, do `action` (once each time it appears: it must be gone, or 50
/// frames pass, before it fires again).
#[derive(Clone, Debug)]
pub struct When {
    pub text: String,
    pub action: Action,
    /// Look only at the bottom row (`scroll?` is BASIC's, on row 23).
    pub row: Option<usize>,
    armed: bool,
    since: u64,
    pub fired: u32,
}

impl When {
    pub fn new(text: &str, action: Action) -> When {
        When {
            text: text.to_string(),
            action,
            row: None,
            armed: true,
            since: 0,
            fired: 0,
        }
    }
}

/// A machine and its script.
pub struct Session {
    pub zx: Machine,
    /// Frames run since the session began.
    pub frame: u64,
    pub at: Vec<(u64, Action)>,
    pub when: Vec<When>,
    /// The audio of every frame, if kept.
    pub audio: Option<Vec<f32>>,
    /// Pictures written, and log lines.
    pub written: Vec<String>,
    pub log: Vec<String>,
    /// The frame at which the last LOAD was typed, and what the boot waited for.
    pub loaded_at: Option<u64>,
    /// The text, read at most once a frame.
    text_cache: Option<(u64, ScreenText)>,
    pending_load: bool,
    pub play_on_load: bool,
    /// Where the CPU is, sampled this many times a frame, when profiling: PC → samples.
    pub profile: Option<(u32, std::collections::BTreeMap<u16, u64>)>,
    /// Port writes kept when tracing (`mask`, `value`): frame, T-state, port, value.
    pub port_trace: Option<(u16, u16, Vec<PortWrite>)>,
}

/// A port write traced: the frame, the T-state, the port and the value.
pub type PortWrite = (u64, u32, u16, u8);

impl Session {
    pub fn new(model: Model, options: Options) -> Session {
        Session {
            zx: Machine::with_options(model, options),
            frame: 0,
            at: Vec::new(),
            when: Vec::new(),
            audio: None,
            written: Vec::new(),
            log: Vec::new(),
            loaded_at: None,
            text_cache: None,
            pending_load: false,
            play_on_load: false,
            profile: None,
            port_trace: None,
        }
    }

    /// The screen as text now.
    pub fn text(&mut self) -> ScreenText {
        if let Some((f, t)) = &self.text_cache
            && *f == self.frame
        {
            return t.clone();
        }
        let t = self.zx.screen_text();
        self.text_cache = Some((self.frame, t.clone()));
        t
    }

    fn act(&mut self, action: &Action) {
        match action {
            Action::Keys(chords, hold) => {
                let mut f = 0;
                for chord in chords {
                    self.zx.press_at(chord, f, *hold);
                    f += 2 * hold;
                }
            }
            Action::Type(text) => {
                self.zx.type_text(text);
            }
            Action::TypeChords(chords) => {
                self.zx.type_chords(chords);
            }
            Action::Load => self.pending_load = true,
            Action::Play => self.zx.tape_play(),
            Action::Stop => self.zx.tape_stop(),
            Action::Png(path) => {
                let png = crate::image::png_indexed(
                    self.zx.frame(),
                    self.zx.frame_width(),
                    self.zx.frame_height(),
                    &spectrum::PALETTE,
                    1,
                );
                match std::fs::write(path, png) {
                    Ok(()) => self.written.push(path.clone()),
                    Err(e) => self.log.push(format!("{path}: {e}")),
                }
            }
        }
    }

    /// Whether the machine has finished booting and its ROM reads the keys: the 48K's copyright on the
    /// bottom row, or the 128's menu.
    fn booted(&mut self) -> bool {
        let model = self.zx.model();
        let text = self.text();
        if model.has_menu() {
            text.contains("Loader") || text.contains("Tape Loader")
        } else {
            text.rows[23].contains("Sinclair Research") || text.rows[23].contains("Amstrad")
        }
    }

    /// Runs one frame, doing first what is due.
    pub fn step(&mut self) {
        let due: Vec<Action> = self
            .at
            .iter()
            .filter(|(f, _)| *f == self.frame)
            .map(|(_, a)| a.clone())
            .collect();
        for a in due {
            self.act(&a);
        }
        if self.pending_load && (self.booted() || self.frame >= 400) {
            self.pending_load = false;
            self.loaded_at = Some(self.frame);
            if self.zx.model().has_menu() {
                self.zx.type_chords(&[vec![keys::ENTER]]);
            } else {
                self.zx.type_chords(&[
                    vec![keys::J],
                    vec![keys::SYMBOL_SHIFT, keys::P],
                    vec![keys::SYMBOL_SHIFT, keys::P],
                    vec![keys::ENTER],
                ]);
            }
            if self.play_on_load {
                self.zx.tape_play();
            }
        }
        if !self.when.is_empty() {
            let text = self.text();
            let mut fire = Vec::new();
            for w in &mut self.when {
                let seen = match w.row {
                    Some(r) => text.rows.get(r).is_some_and(|row| row.contains(&w.text)),
                    None => text.contains(&w.text),
                };
                if seen && w.armed {
                    w.armed = false;
                    w.since = self.frame;
                    w.fired += 1;
                    fire.push(w.action.clone());
                } else if !seen || self.frame >= w.since + 50 {
                    w.armed = !seen || self.frame >= w.since + 50;
                    if seen {
                        w.since = self.frame;
                    }
                }
            }
            for a in fire {
                self.act(&a);
            }
        }
        if self.port_trace.is_some() {
            self.zx.trace_ports(true);
        }
        match &mut self.profile {
            Some((per_frame, counts)) => {
                // The frame in pieces, PC noted after each: where the program spends its time.
                let frame_len = self.zx.model().frame_tstates();
                let step = (frame_len / (*per_frame).max(1)).max(4) as u64 / 8;
                while let spectrum::Stop::Steps = self.zx.run(step.max(1)) {
                    *counts.entry(self.zx.registers().pc).or_insert(0) += 1
                }
            }
            None => {
                self.zx.run_frame();
            }
        }
        if let Some((mask, value, log)) = &mut self.port_trace {
            for (t, port, v) in self.zx.port_writes() {
                if port & *mask == *value {
                    log.push((self.frame, t, port, v));
                }
            }
        }
        self.frame += 1;
        if let Some(a) = &mut self.audio {
            a.extend_from_slice(self.zx.audio());
        }
    }

    pub fn run_frames(&mut self, n: u64) {
        for _ in 0..n {
            self.step();
        }
    }

    /// Runs until the screen shows `text` (looked at each frame), at most `max` frames more. Returns the frame
    /// it was seen at.
    pub fn run_until(&mut self, text: &str, max: u64) -> Option<u64> {
        for _ in 0..max {
            if self.text().contains(text) {
                return Some(self.frame);
            }
            self.step();
        }
        self.text().contains(text).then_some(self.frame)
    }

    /// Runs until `pred` holds of the session (looked at each frame), at most `max` frames more.
    pub fn run_until_with(
        &mut self,
        max: u64,
        mut pred: impl FnMut(&mut Session) -> bool,
    ) -> Option<u64> {
        for _ in 0..max {
            if pred(self) {
                return Some(self.frame);
            }
            self.step();
        }
        pred(self).then_some(self.frame)
    }

    /// Presses chords now, as a person would: each held 5 frames, 5 frames apart.
    pub fn press(&mut self, chords: &[Vec<u8>]) {
        self.act(&Action::Keys(chords.to_vec(), PRESS_FRAMES));
    }

    /// Presses chords now, each held `hold` frames, as long again apart.
    pub fn press_for(&mut self, chords: &[Vec<u8>], hold: u64) {
        self.act(&Action::Keys(chords.to_vec(), hold));
    }

    /// Runs `n` frames after pressing.
    pub fn press_and_run(&mut self, chords: &[Vec<u8>], n: u64) {
        self.press(chords);
        self.run_frames(n);
    }
}
