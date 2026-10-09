//! The tape deck: a tape played into the EAR line, on the machine's clock.
//!
//! The machine asks for the level at a T-state of its frame ([`Player::level_at`], at every IN from port
//! 0xFE), or when the level next changes ([`Player::next_edge`], to skip ahead or to hear the tape), and
//! tells the deck when a frame ends ([`Player::end_frame`]), as every part that keeps time is told. The
//! tape's own timings are T-states of 3.5 MHz; on a machine with another clock (the 128K family's 3,546,900
//! Hz) each edge is put at the machine's T-state its time falls in, worked out from the start of the tape
//! with nothing rounded on the way, so the tape keeps exact time however long it plays.

use std::collections::VecDeque;
use std::sync::Arc;

use crate::block::Block;
use crate::instant;
use crate::signal::{self, Event, EventKind, Signal, StopReason, TAPE_HZ};
use crate::{RomBlock, Tape};

/// A tape in the deck.
#[derive(Clone, Debug)]
pub struct Player {
    /// Shared, not copied: a deck keeps the tape as it went in beside the player, a probe of the instant load
    /// clones the player, and a recording can be tens of megabytes.
    tape: Arc<Tape>,
    /// Each block's length, in 3.5 MHz T-states.
    durations: Vec<u64>,
    /// The machine's clock, and whether it is a 48K (for the blocks that stop only a 48K).
    hz: u64,
    is_48k: bool,
    /// The signal, made a little ahead of where the tape is, and what it has made that has not happened yet.
    signal: Signal,
    queue: VecDeque<Event>,
    /// Turning the signal's positions into the deck's: position `t35_base` is deck time `mt_base`.
    t35_base: u64,
    mt_base: u64,
    /// The machine's T-state (counted from the deck's making) at the start of this frame.
    frame_start: u64,
    /// While playing, machine time `anchor_abs` is deck time `anchor_mt`, and the deck runs with the
    /// machine; when stopped, the deck stands at `anchor_mt`.
    playing: bool,
    anchor_abs: u64,
    anchor_mt: u64,
    /// The deck time up to which events have happened, the level then, and when the next event is due.
    now_mt: u64,
    level: bool,
    next_mt: u64,
    /// For the page: the block playing and its start, why the tape stopped itself, the last message.
    block: usize,
    block_start: u64,
    stopped_by: Option<StopReason>,
    message: Option<usize>,
}

/// Where the tape is, for the page.
#[derive(Clone, Debug, PartialEq)]
pub struct Status {
    pub playing: bool,
    /// The block playing, or the one the tape stands at.
    pub block: usize,
    /// How far into that block the tape is, and how long it lasts, in seconds.
    pub block_elapsed: f64,
    pub block_seconds: f64,
    /// How far through the tape, and how long it lasts, in seconds: the blocks before this one, and this one
    /// so far. (A loop plays blocks again, so this can go back.)
    pub tape_elapsed: f64,
    pub tape_seconds: f64,
    /// Why the tape stopped itself, if it did and has not been played since.
    pub stopped_by: Option<StopReason>,
    /// Whether the tape has played to its end.
    pub at_end: bool,
    /// The last message block (TZX 0x31) the tape has played past, to show.
    pub message: Option<usize>,
}

impl Player {
    /// A tape in the deck, stopped at its start, for a machine whose clock runs at `clock_hz`. The tape can be
    /// shared (an `Arc<Tape>`): nothing here changes it.
    pub fn new(tape: impl Into<Arc<Tape>>, clock_hz: u32) -> Player {
        let tape: Arc<Tape> = tape.into();
        let durations = tape.blocks.iter().map(signal::duration).collect();
        Player {
            tape,
            durations,
            hz: clock_hz as u64,
            is_48k: false,
            signal: Signal::at(0),
            queue: VecDeque::new(),
            t35_base: 0,
            mt_base: 0,
            frame_start: 0,
            playing: false,
            anchor_abs: 0,
            anchor_mt: 0,
            now_mt: 0,
            level: false,
            next_mt: 0,
            block: 0,
            block_start: 0,
            stopped_by: None,
            message: None,
        }
    }

    pub fn tape(&self) -> &Tape {
        &self.tape
    }

    /// Whether the machine is a 48K, for TZX's "stop the tape if in 48K mode" (0x2A) and PZX's STOP for a
    /// 48K: those stop the tape only if it is. The deck starts out taking the machine for a 128K.
    pub fn set_48k(&mut self, is_48k: bool) {
        self.is_48k = is_48k;
    }

    /// Puts the deck on a machine of another clock, where it stands.
    pub fn set_clock(&mut self, clock_hz: u32) {
        let pos = self.position_t35();
        self.t35_base = pos;
        self.mt_base = self.now_mt;
        self.hz = clock_hz as u64;
        self.next_mt = self.queue.front().map_or(0, |e| self.mt(e.pos));
    }

    /// The EAR level the tape gives at T-state `t` of this frame. Asked for at times that do not go back
    /// within a frame; asked for an earlier time, it says the level at the latest time asked. A tape that is
    /// not playing gives no signal: low, as the line is with no tape (played again, the pulse it stood in
    /// goes on).
    #[inline]
    pub fn level_at(&mut self, t: u32) -> bool {
        if !self.playing {
            return false;
        }
        let mt = self.deck_time(t);
        if mt >= self.next_mt {
            self.advance(mt);
        }
        self.level && self.playing
    }

    /// The T-state of this frame (it may lie in a later one, beyond the frame's length) at which the level
    /// next changes after `t`, or `None` if it will not before the tape stops or ends, or if it is stopped.
    pub fn next_edge(&mut self, t: u32) -> Option<u32> {
        self.level_at(t);
        if !self.playing {
            return None;
        }
        let mut i = 0;
        loop {
            if i == self.queue.len() {
                self.signal
                    .fill(&self.tape.blocks, self.is_48k, &mut self.queue);
            }
            let event = self.queue[i];
            match event.kind {
                EventKind::Level(_) => {
                    let abs = self.anchor_abs + (self.mt(event.pos) - self.anchor_mt);
                    return Some((abs - self.frame_start).min(u32::MAX as u64) as u32);
                }
                EventKind::Stop(_) => return None,
                EventKind::Block(_) => i += 1,
            }
        }
    }

    /// Every change of level from where the deck was last asked up to T-state `t` of this frame, in order,
    /// as `f(t, level)`; the deck is then at `t`. For the sound of the tape, put into the audio before each
    /// time the level is asked for and at the end of each frame, so that every edge is heard where it falls.
    pub fn edges_until(&mut self, t: u32, mut f: impl FnMut(u32, bool)) {
        while self.playing {
            let now = self.anchor_abs + (self.now_mt - self.anchor_mt);
            let from = now.saturating_sub(self.frame_start).min(t as u64) as u32;
            match self.next_edge(from) {
                Some(e) if e <= t => {
                    let level = self.level_at(e);
                    f(e, level);
                }
                _ => break,
            }
        }
        self.level_at(t);
    }

    /// The frame has ended after `frame_len` T-states: times from now on count from the next frame's start.
    pub fn end_frame(&mut self, frame_len: u32) {
        self.level_at(frame_len);
        self.frame_start += frame_len as u64;
    }

    /// Starts the tape at T-state `t`. At the end of the tape it stays stopped: rewind it first.
    pub fn play(&mut self, t: u32) {
        if self.playing || self.at_end() {
            return;
        }
        self.playing = true;
        self.anchor_abs = (self.frame_start + t as u64).max(self.anchor_abs);
        self.stopped_by = None;
        self.next_mt = self.queue.front().map_or(0, |e| self.mt(e.pos));
    }

    /// Stops the tape at T-state `t`. The line is silent (low) while it stands; no edge is handed over for
    /// that, as there is none on the tape.
    pub fn stop(&mut self, t: u32) {
        self.level_at(t);
        if self.playing {
            self.anchor_mt = self.deck_time(t).max(self.now_mt);
            self.now_mt = self.anchor_mt;
            self.playing = false;
        }
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    /// Whether the tape has played to its end.
    pub fn at_end(&self) -> bool {
        self.signal.ended && self.queue.is_empty()
    }

    /// Winds the tape back to its start, at T-state `t`; it plays on from there if it was playing.
    pub fn rewind(&mut self, t: u32) {
        self.seek(0, t);
    }

    /// Winds the tape to the start of block `block`, at T-state `t`; it plays on from there if it was
    /// playing, with the level low, as TZX asks of a tape started from any block.
    pub fn seek(&mut self, block: usize, t: u32) {
        let mut signal = Signal::at(block.min(self.tape.blocks.len()));
        signal.restart();
        self.put(signal, t);
    }

    /// The tape's next block, if it is one the ROM's LD-BYTES loads, for the machine that traps LD-BYTES
    /// (0x0556) to load it at once: the block LD-BYTES would hear the whole of from T-state `t`, past what
    /// carries no signal (texts, groups, pauses, and the blocks that stop the tape, which a person loading
    /// would have pressed PLAY past). It is taken when it is a TAP block or a TZX 0x10; a 0x11 within a
    /// tenth of the ROM's timings with all of its last byte; a TZX 0x12 pilot at the ROM's timing, a 0x13
    /// of the two sync pulses and a 0x14 at the ROM's bit timings; a 0x19 or a PZX PULS and DATA that are
    /// the same, every pulse ending with an edge; in each case with a pilot long enough for LD-BYTES to
    /// find ([`crate::rom::pilot_found`]). The tape is then moved past it, to the start of its pause (as
    /// the real tape is when LD-BYTES returns), or of the block after it when it has none: the next
    /// LD-BYTES passes the pause and can take that one. Anything else (a turbo loader's blocks, recordings)
    /// is left to be played, and the machine's LD-BYTES then runs on the tape as the real one would.
    pub fn take_rom_block(&mut self, t: u32) -> Option<RomBlock> {
        self.level_at(t);
        let blocks = &self.tape.blocks;
        let mut signal = self.signal.clone();
        if !signal.in_lead_in(blocks) {
            signal.next();
        }
        if !signal.seek_sound(blocks) {
            return None;
        }
        let index = signal.index;
        let bytes = instant::take(blocks, &mut signal)?;
        // LD-BYTES returns as the block's last bit ends: the tape goes on from the pause after it, as the
        // real one does, so that a loader the block brought in, reading the next block itself, has the gap
        // the tape gives it. (A block with no pause of its own: from the next block.) The next LD-BYTES
        // passes the pause.
        let last = signal.index - 1;
        if !signal.restart_at_pause(blocks, last) {
            signal.restart();
        }
        self.put(signal, t);
        Some(RomBlock { index, bytes })
    }

    /// Where the tape is, for the page.
    pub fn status(&self) -> Status {
        let to_s = |t: u64| t as f64 / TAPE_HZ as f64;
        let block_len = self.durations.get(self.block).copied().unwrap_or(0);
        let elapsed = self
            .position_t35()
            .saturating_sub(self.block_start)
            .min(block_len);
        let before: u64 = self.durations[..self.block.min(self.durations.len())]
            .iter()
            .sum();
        Status {
            playing: self.playing,
            block: self.block,
            block_elapsed: to_s(elapsed),
            block_seconds: to_s(block_len),
            tape_elapsed: to_s(before + elapsed),
            tape_seconds: self.tape_seconds(),
            stopped_by: self.stopped_by,
            at_end: self.at_end(),
            message: self.message,
        }
    }

    /// How long block `index` lasts as it plays, in seconds (0 for the blocks that direct the tape).
    pub fn block_seconds(&self, index: usize) -> f64 {
        self.durations
            .get(index)
            .map_or(0.0, |&d| d as f64 / TAPE_HZ as f64)
    }

    /// How long the whole tape lasts, each block once, in seconds.
    pub fn tape_seconds(&self) -> f64 {
        self.durations.iter().sum::<u64>() as f64 / TAPE_HZ as f64
    }

    /// Each block's length in 3.5 MHz T-states.
    pub fn durations(&self) -> &[u64] {
        &self.durations
    }

    /// The deck's time at T-state `t` of this frame, while it plays.
    #[inline]
    fn deck_time(&self, t: u32) -> u64 {
        self.anchor_mt + (self.frame_start + t as u64).saturating_sub(self.anchor_abs)
    }

    /// Deck time of a position on the tape: exact, from the base, so that nothing is rounded twice.
    fn mt(&self, pos: u64) -> u64 {
        self.mt_base + ((pos - self.t35_base) as u128 * self.hz as u128 / TAPE_HZ as u128) as u64
    }

    /// The position on the tape the deck stands at (to the T-state below).
    fn position_t35(&self) -> u64 {
        let now = if self.playing {
            self.now_mt
        } else {
            self.anchor_mt
        };
        self.t35_base
            + ((now - self.mt_base) as u128 * TAPE_HZ as u128 / self.hz.max(1) as u128) as u64
    }

    /// Lets everything due by deck time `mt` happen.
    fn advance(&mut self, mt: u64) {
        loop {
            if self.queue.is_empty() {
                self.signal
                    .fill(&self.tape.blocks, self.is_48k, &mut self.queue);
            }
            let event = self.queue[0];
            let due = self.mt(event.pos);
            if due > mt {
                self.next_mt = due;
                break;
            }
            self.queue.pop_front();
            match event.kind {
                EventKind::Level(l) => self.level = l,
                EventKind::Block(i) => {
                    self.block = i;
                    self.block_start = event.pos;
                    if matches!(self.tape.blocks.get(i), Some(Block::Message { .. })) {
                        self.message = Some(i);
                    }
                }
                EventKind::Stop(reason) => {
                    self.playing = false;
                    self.anchor_mt = due;
                    self.now_mt = due;
                    self.stopped_by = Some(reason);
                    self.next_mt = self.queue.front().map_or(0, |e| self.mt(e.pos));
                    return;
                }
            }
        }
        self.now_mt = mt;
    }

    /// Puts the tape where a restarted signal is (the start of a block, or the pause inside one, at its
    /// position into that block) from T-state `t`: the level low and the tape's time continuing.
    fn put(&mut self, signal: Signal, t: u32) {
        let now = if self.playing {
            self.deck_time(t).max(self.now_mt)
        } else {
            self.anchor_mt
        };
        self.block = signal.index;
        // The signal's position counts from its block's start, which is where the block began.
        self.t35_base = signal.pos;
        self.signal = signal;
        self.queue.clear();
        self.mt_base = now;
        self.now_mt = now;
        if self.playing {
            self.anchor_abs = self.frame_start + t as u64;
        }
        self.anchor_mt = now;
        self.level = false;
        self.next_mt = 0;
        self.block_start = 0;
        self.stopped_by = None;
    }
}
