//! The tape deck, as the machine uses it: a `tape::Player` on the machine's clock, what was done to it (so
//! that a saved state can put the tape back exactly where it was), and the automatic start and stop.
//!
//! A saved state holds the deck's log: every control (play, stop, seek, a block taken by the instant load)
//! with the frame and T-state it happened at. The player's position is a function of that log and the time,
//! so loading a state rebuilds the player from the tape and replays the log: the tape is exactly where it was,
//! level and loop counters and all. It costs time in proportion to how much tape has played (tens of
//! milliseconds for a whole game), and only on loading a state.

use std::sync::Arc;

use tape::{Player, RomBlock, Status, Tape};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Op {
    Play,
    Stop,
    Seek(u32),
    TakeRomBlock,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LogEntry {
    pub frame: u64,
    pub t: u32,
    pub op: Op,
}

/// Why the deck last started or stopped itself, for the automatic stop.
#[derive(Clone, Debug)]
pub(crate) struct Deck {
    /// The tape as inserted (the player is rebuilt from it to replay the log), and its file's hash. Shared with the
    /// player, and with every copy of the machine (a state loaded keeps one to fall back on).
    pristine: Arc<Tape>,
    pub hash: u64,
    pub name: String,
    pub player: Player,
    /// Frames since the tape went in, at the start of the current frame.
    pub frame: u64,
    pub log: Vec<LogEntry>,
    frame_len: u32,
    /// The automatic start and stop's watch of port FEh reads (as Fuse's loader detection): the T-state
    /// (absolute) and B of the last read, how many reads in a row looked like a loader's, or did not.
    last_read: Option<(u64, u8)>,
    pub loader_reads: u32,
    pub other_reads: u32,
    /// Whether the deck started itself (and so may stop itself), and the frames since port FEh was last read
    /// while it plays.
    pub auto_started: bool,
    pub idle_frames: u32,
    /// The level, and the T-state of this frame before which it holds (the player's next edge): a read before
    /// then needs no word with the player. None when it must be asked.
    cache: Option<(u32, bool)>,
    /// The T-state of this frame up to which the tape's edges have been handed to the sound (by `level`).
    /// A saved state keeps it: the player rebuilt from the log is brought up to it again, its edges not
    /// handed over a second time, or a state saved while a loader reads the tape would hear them twice.
    pub heard_to: u32,
}

impl Deck {
    pub fn new(
        tape: Arc<Tape>,
        hash: u64,
        name: String,
        clock: u32,
        frame_len: u32,
        is_48k: bool,
    ) -> Deck {
        let mut player = Player::new(tape.clone(), clock);
        player.set_48k(is_48k);
        Deck {
            pristine: tape,
            hash,
            name,
            player,
            frame: 0,
            log: Vec::new(),
            frame_len,
            last_read: None,
            loader_reads: 0,
            other_reads: 0,
            auto_started: false,
            idle_frames: 0,
            cache: None,
            heard_to: 0,
        }
    }

    /// The EAR level the tape gives at T-state `t` (low while it is not playing), every edge up to `t` handed
    /// to `edge` first (for the tape's sound).
    #[inline]
    pub fn level(&mut self, t: u32, edge: impl FnMut(u32, bool)) -> bool {
        if let Some((until, level)) = self.cache
            && t < until
        {
            // No edge before `until`: everything up to t is heard, as if the player had been asked.
            self.heard_to = self.heard_to.max(t);
            return level;
        }
        if !self.player.is_playing() {
            return false;
        }
        self.player.edges_until(t, edge);
        self.heard_to = self.heard_to.max(t);
        let level = self.player.level_at(t);
        // Until the next edge nothing changes (None: a stop comes first, or nothing more: ask every time).
        self.cache = self.player.next_edge(t).map(|n| (n, level));
        level
    }

    pub fn tape(&self) -> &Arc<Tape> {
        &self.pristine
    }

    fn log(&mut self, t: u32, op: Op) {
        self.log.push(LogEntry {
            frame: self.frame,
            t,
            op,
        });
    }

    pub fn play(&mut self, t: u32) {
        self.cache = None;
        if !self.player.is_playing() && !self.player.at_end() {
            self.player.play(t);
            self.log(t, Op::Play);
        }
        self.idle_frames = 0;
    }

    pub fn stop(&mut self, t: u32) {
        self.cache = None;
        if self.player.is_playing() {
            self.player.stop(t);
            self.log(t, Op::Stop);
        }
        self.auto_started = false;
    }

    pub fn seek(&mut self, block: usize, t: u32) {
        self.cache = None;
        self.player.seek(block, t);
        self.log(t, Op::Seek(block as u32));
    }

    /// The tape's next ROM block, taken only if `accept` says so of it; otherwise the tape is as it was.
    pub fn take_rom_block_if(
        &mut self,
        t: u32,
        accept: impl Fn(&RomBlock) -> bool,
    ) -> Option<RomBlock> {
        self.cache = None;
        // Looked at on a copy first, so that a block refused leaves the player (and the log, which a saved
        // state replays) exactly as they were.
        let mut probe = self.player.clone();
        if !probe.take_rom_block(t).is_some_and(|b| accept(&b)) {
            return None;
        }
        let b = self.player.take_rom_block(t);
        if b.is_some() {
            self.log(t, Op::TakeRomBlock);
        }
        b
    }

    pub fn end_frame(&mut self) {
        self.cache = None;
        self.heard_to = 0;
        self.player.end_frame(self.frame_len);
        self.frame += 1;
    }

    pub fn status(&self) -> Status {
        self.player.status()
    }

    /// A read of port FEh at absolute T-state `abs` with B as `b`: Fuse's loader detection, which starts a
    /// stopped tape when ten reads in a row come within 500 T-states of each other with B counting by one (an
    /// edge-timing loop), and stops one it started when ten in a row do not look like that (a keyboard scan).
    /// Returns Some(true) to start, Some(false) to stop.
    pub fn watch_read(&mut self, abs: u64, b: u8) -> Option<bool> {
        let (dt, db) = match self.last_read {
            Some((t0, b0)) => (abs.saturating_sub(t0), b.wrapping_sub(b0)),
            None => (u64::MAX, 0x80),
        };
        self.last_read = Some((abs, b));
        self.idle_frames = 0;
        if self.player.is_playing() {
            if dt <= 1000 && matches!(db, 0 | 1 | 0xFF) {
                self.other_reads = 0;
            } else {
                self.other_reads += 1;
                if self.other_reads >= 10 && self.auto_started {
                    self.other_reads = 0;
                    return Some(false);
                }
            }
            None
        } else {
            if dt <= 500 && matches!(db, 1 | 0xFF) {
                self.loader_reads += 1;
                if self.loader_reads >= 10 && !self.player.at_end() {
                    self.loader_reads = 0;
                    return Some(true);
                }
            } else {
                self.loader_reads = 0;
            }
            None
        }
    }

    /// The log and frame count, for a saved state.
    pub fn position(&self) -> (u64, &[LogEntry]) {
        (self.frame, &self.log)
    }

    /// The automatic start and stop's watch (for a saved state): the last read's absolute T-state and B, and
    /// the reads in a row that looked like a loader's and that did not.
    pub fn watch(&self) -> (Option<(u64, u8)>, u32, u32) {
        (self.last_read, self.loader_reads, self.other_reads)
    }

    pub fn set_watch(&mut self, (last, loader, other): (Option<(u64, u8)>, u32, u32)) {
        self.last_read = last;
        self.loader_reads = loader;
        self.other_reads = other;
    }

    /// Puts the tape where a saved state had it: a fresh player, the log replayed, frames ended up to `frame`,
    /// and the edges of this frame up to `heard_to` passed (they are in the sound already).
    pub fn restore(
        &mut self,
        frame: u64,
        log: Vec<LogEntry>,
        heard_to: u32,
        clock: u32,
        frame_len: u32,
        is_48k: bool,
    ) {
        self.frame_len = frame_len;
        let mut player = Player::new(self.pristine.clone(), clock);
        player.set_48k(is_48k);
        let mut now = 0u64;
        for e in &log {
            while now < e.frame {
                player.end_frame(self.frame_len);
                now += 1;
            }
            match e.op {
                Op::Play => player.play(e.t),
                Op::Stop => player.stop(e.t),
                Op::Seek(b) => player.seek(b as usize, e.t),
                Op::TakeRomBlock => {
                    player.take_rom_block(e.t);
                }
            }
        }
        while now < frame {
            player.end_frame(self.frame_len);
            now += 1;
        }
        if heard_to > 0 {
            player.edges_until(heard_to, |_, _| {});
        }
        self.heard_to = heard_to;
        self.player = player;
        self.frame = frame;
        self.log = log;
        self.cache = None;
        self.last_read = None;
        self.loader_reads = 0;
        self.other_reads = 0;
    }
}

/// FNV-1a, 64 bits: which tape a saved state's deck log belongs to.
pub(crate) fn hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}
