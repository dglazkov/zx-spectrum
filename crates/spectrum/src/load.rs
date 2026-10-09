//! Loading anything: tapes (inserted, not started), snapshots (with the model they need), screens, and a .zip
//! of any of these; and the tape deck's controls.

use std::sync::Arc;

use tape::{Block, Tape};
use unzip::Kind;

use crate::deck::{self, Deck};
use crate::machine::Machine;
use crate::model::Model;

/// What `load` loaded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadedKind {
    Tape,
    Snapshot,
    Screen,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Loaded {
    pub kind: LoadedKind,
    /// The file's name (inside the zip, if it came in one).
    pub name: String,
    /// The model the file needs, where it says (a snapshot always does); the machine has been switched to it.
    pub model: Option<Model>,
    /// The other Spectrum files in the zip, not loaded (a tape's second side, say).
    pub others: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadError {
    /// Not a file the machine knows.
    Unrecognised(String),
    /// A kind of file it knows but cannot load (disk images).
    Unsupported(String),
    /// A file of a known kind, damaged.
    Damaged(String),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Unrecognised(s) => write!(f, "not a file the Spectrum knows: {s}"),
            LoadError::Unsupported(s) => write!(f, "cannot load {s}"),
            LoadError::Damaged(s) => write!(f, "damaged: {s}"),
        }
    }
}

impl std::error::Error for LoadError {}

/// A tape block as the page lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct TapeBlock {
    /// header, data, turbo, tone, pause, stop, group, info.
    pub kind: &'static str,
    pub label: String,
    pub bytes: Option<usize>,
    pub seconds: f64,
}

/// Where the tape is, for the page (cheap: read every frame).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TapeState {
    pub loaded: bool,
    pub playing: bool,
    /// The block under the head (`blocks().len()` at the end).
    pub block: usize,
    /// Seconds into the tape, and its length.
    pub position: f64,
    pub length: f64,
}

impl Machine {
    /// Loads a file: a tape (TAP, TZX, CSW, PZX) goes into the deck, stopped; a snapshot (.z80, .sna, .szx,
    /// .slt) switches the machine to its model and restores it; a screen (.scr) goes on the screen; a .zip
    /// gives the first of these it holds. `name` is used for its extension, where the content does not say.
    pub fn load(&mut self, bytes: &[u8], name: &str) -> Result<Loaded, LoadError> {
        if unzip::is_zip(bytes) {
            let files = unzip::spectrum_files(bytes)
                .map_err(|e| LoadError::Damaged(format!("{name}: {e}")))?;
            let pick = files
                .iter()
                .position(|f| f.kind.is_tape())
                .or_else(|| files.iter().position(|f| f.kind.is_snapshot()))
                .or_else(|| files.iter().position(|f| f.kind == Kind::Scr));
            let Some(i) = pick else {
                return Err(match files.first() {
                    Some(f) => LoadError::Unsupported(format!(
                        "{} ({} images: no disk drive here)",
                        f.name,
                        f.kind.extension()
                    )),
                    None => LoadError::Unrecognised(format!("{name}: no Spectrum file in the zip")),
                });
            };
            let mut loaded = self.load_kind(&files[i].data, &files[i].name, Some(files[i].kind))?;
            loaded.others = files
                .iter()
                .enumerate()
                .filter(|&(j, _)| j != i)
                .map(|(_, f)| f.name.clone())
                .collect();
            return Ok(loaded);
        }
        let kind = unzip::classify(name, bytes);
        self.load_kind(bytes, name, kind)
    }

    fn load_kind(
        &mut self,
        bytes: &[u8],
        name: &str,
        kind: Option<Kind>,
    ) -> Result<Loaded, LoadError> {
        let loaded = |kind, model| Loaded {
            kind,
            name: name.to_string(),
            model,
            others: Vec::new(),
        };
        match kind {
            Some(Kind::Tzx | Kind::Tap | Kind::Csw | Kind::Pzx) => {
                let tape =
                    Tape::parse(bytes).map_err(|e| LoadError::Damaged(format!("{name}: {e}")))?;
                playable(&tape, name)?;
                self.insert_tape(tape, deck::hash(bytes), name.to_string());
                Ok(loaded(LoadedKind::Tape, None))
            }
            Some(Kind::Z80 | Kind::Sna | Kind::Szx) => {
                let snap = snapshot::load(bytes)
                    .map_err(|e| LoadError::Damaged(format!("{name}: {e}")))?;
                self.restore(&snap);
                Ok(loaded(LoadedKind::Snapshot, Some(self.model())))
            }
            Some(Kind::Scr) => {
                let scr = snapshot::load_scr(bytes)
                    .map_err(|e| LoadError::Damaged(format!("{name}: {e}")))?;
                let bank = self.hw.mem.screen_bank as usize;
                self.hw.mem.bank_mut(bank)[..scr.len()].copy_from_slice(&scr[..]);
                Ok(loaded(LoadedKind::Screen, None))
            }
            Some(k @ (Kind::Dsk | Kind::Trd | Kind::Scl)) => Err(LoadError::Unsupported(format!(
                "{name} ({} disk images: no disk drive here)",
                k.extension()
            ))),
            None => {
                if let Ok(tape) = Tape::parse(bytes)
                    && playable(&tape, name).is_ok()
                {
                    self.insert_tape(tape, deck::hash(bytes), name.to_string());
                    return Ok(loaded(LoadedKind::Tape, None));
                }
                if let Ok(snap) = snapshot::load(bytes) {
                    self.restore(&snap);
                    return Ok(loaded(LoadedKind::Snapshot, Some(self.model())));
                }
                Err(LoadError::Unrecognised(name.to_string()))
            }
        }
    }

    /// Puts a tape in the deck, stopped at its start (the tape there before is taken out). `hash` says which
    /// tape it is to a saved state.
    pub(crate) fn insert_tape(&mut self, tape: impl Into<Arc<Tape>>, hash: u64, name: String) {
        let model = self.model();
        let deck = Deck::new(
            tape.into(),
            hash,
            name,
            model.clock_hz(),
            self.hw.timing.frame,
            matches!(model, Model::Spectrum16 | Model::Spectrum48),
        );
        self.hw.deck = Some(deck);
        self.update_hooks();
    }

    pub fn eject_tape(&mut self) {
        self.hw.deck = None;
        let t = self.t;
        self.hw.sound.tape_level(t, false);
        self.update_hooks();
    }

    pub fn has_tape(&self) -> bool {
        self.hw.deck.is_some()
    }

    /// The tape's name, if there is one in the deck.
    pub fn tape_name(&self) -> Option<&str> {
        self.hw.deck.as_ref().map(|d| d.name.as_str())
    }

    pub fn tape_play(&mut self) {
        let t = self.t;
        if let Some(d) = &mut self.hw.deck {
            d.play(t);
            d.auto_started = false;
        }
    }

    pub fn tape_stop(&mut self) {
        let t = self.t;
        if let Some(d) = &mut self.hw.deck {
            d.stop(t);
        }
    }

    pub fn tape_rewind(&mut self) {
        self.tape_seek(0);
    }

    pub fn tape_seek(&mut self, block: usize) {
        let t = self.t;
        if let Some(d) = &mut self.hw.deck {
            d.seek(block, t);
        }
    }

    /// Whether the tape is playing: the page runs flat out while it does (accelerated loading).
    pub fn tape_active(&self) -> bool {
        self.hw.deck.as_ref().is_some_and(|d| d.player.is_playing())
    }

    /// Where the tape is.
    pub fn tape_state(&self) -> TapeState {
        match &self.hw.deck {
            None => TapeState::default(),
            Some(d) => {
                let s = d.status();
                let n = d.tape().blocks.len();
                TapeState {
                    loaded: true,
                    playing: s.playing,
                    block: if s.at_end { n } else { s.block },
                    position: s.tape_elapsed,
                    length: s.tape_seconds,
                }
            }
        }
    }

    /// The deck's own account of where it is (block, time in the block, why it stopped).
    pub fn tape_status(&self) -> Option<tape::Status> {
        self.hw.deck.as_ref().map(|d| d.status())
    }

    /// What has been done to the tape since it went in, for the debugger: (frame since insertion, T-state, what).
    pub fn tape_log(&self) -> Vec<(u64, u32, String)> {
        self.hw
            .deck
            .as_ref()
            .map(|d| {
                d.log
                    .iter()
                    .map(|e| (e.frame, e.t, format!("{:?}", e.op)))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The tape's blocks, as the page lists them.
    pub fn tape_blocks(&self) -> Vec<TapeBlock> {
        let Some(d) = &self.hw.deck else {
            return Vec::new();
        };
        d.tape()
            .blocks
            .iter()
            .enumerate()
            .map(|(i, b)| TapeBlock {
                kind: block_kind(b),
                label: b.describe(),
                bytes: block_bytes(b),
                seconds: d.player.block_seconds(i),
            })
            .collect()
    }
}

/// A tape with something on it to play: a block of data, or of signal. One of nothing but text, pauses and
/// groups (a damaged file whose first real block could not be read, say) goes nowhere near the deck, so that the
/// machine is not started afresh to LOAD it.
fn playable(tape: &Tape, name: &str) -> Result<(), LoadError> {
    if tape
        .blocks
        .iter()
        .any(|b| matches!(block_kind(b), "header" | "data" | "turbo" | "tone"))
    {
        return Ok(());
    }
    let why = tape.warnings.first().map_or_else(
        || "it has no block that plays".to_string(),
        |w| format!("it has no block that plays ({w})"),
    );
    Err(LoadError::Damaged(format!("{name}: {why}")))
}

fn block_kind(b: &Block) -> &'static str {
    match b {
        Block::Standard { .. } => {
            if b.header().is_some() {
                "header"
            } else {
                "data"
            }
        }
        Block::Turbo(_)
        | Block::PureData(_)
        | Block::DirectRecording(_)
        | Block::Csw(_)
        | Block::Generalized(_)
        | Block::PzxData(_) => "turbo",
        Block::PureTone { .. } | Block::Pulses(_) | Block::PzxPulses(_) => "tone",
        Block::Pause { ms: 0 } => "stop",
        Block::Pause { .. } | Block::PzxPause { .. } => "pause",
        Block::StopIf48k => "stop",
        Block::GroupStart(_) | Block::GroupEnd => "group",
        _ => "info",
    }
}

fn block_bytes(b: &Block) -> Option<usize> {
    match b {
        Block::Standard { data, .. } => Some(data.len()),
        Block::Turbo(t) => Some(t.data.len()),
        Block::PureData(p) => Some(p.data.len()),
        _ => None,
    }
}
