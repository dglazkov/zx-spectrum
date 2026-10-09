//! The tape's signal: its blocks turned into the times at which the level changes.
//!
//! # The levels, and the TZX's rules for them
//!
//! A tape is a sequence of pulses, each a stretch of time at one level; an edge is where the level changes.
//! Two levels are kept as the blocks are played:
//!
//! - the *pulse level* (`level`), which is TZX's "current pulse level": the level the next pulse is played
//!   at. A pulse of a block 0x10 to 0x14 or 0x19, or of PZX's PULS, DATA and PAUS, is played at it, and the
//!   pulse level then flips, "so that a subsequent pulse will produce an edge";
//! - the *line* (`line`): the level the last pulse was played at, which is what a generalized data block's
//!   symbols begin relative to ("opposite to the current level (make an edge, as usual)").
//!
//! And the TZX specification's rules (section 2, "Rules and definitions"):
//!
//! - the pulse level is low when a tape starts to play, from its start or from any block;
//! - a pause (block 0x20, or the pause after a data block) holds the pulse level for its first millisecond
//!   ("at least 1 ms. pause of the opposite level", which finishes the last pulse with its edge) and is low
//!   for the rest; the pulse level after it is low, so a pulse that follows makes no edge as it begins. A
//!   pause of zero is nothing at all;
//! - after a direct recording (0x15) or a CSW recording (0x18), the pulse level is the last level played;
//! - block 0x2B sets both.
//!
//! When the tape stops (a block 0x20 of zero, 0x2A on a 48K, PZX STOP) or ends, the last pulse is ended as a
//! pause would end it: the line takes the pulse level (the last pulse's edge), holds it for a millisecond
//! if that is high, and is then low, as a tape that is not playing is silent. Played again, the tape goes on
//! from low, as TZX asks of a tape started "from a certain position".
//!
//! PZX states each block's first level (PULS low; DATA and PAUS as their top bit says), after which the
//! level changes after each pulse, zero-length ones included: the same pulse level, set at each block. A
//! PAUS is a level held (what follows it states its own), so a tape that stops or ends after one makes no
//! edge there.
//!
//! # Time
//!
//! Positions are T-states of a 3.5 MHz clock, as TZX and PZX count them, from wherever the tape was last
//! put (a rewind, a seek); a CSW's samples are turned into them exactly, each edge at the whole T-state its
//! exact time falls in, measured from the start of its block so that no rounding adds up. The player turns
//! them into the machine's clock.

use std::collections::VecDeque;

use crate::block::*;

/// T-states of a 3.5 MHz clock in a millisecond.
pub(crate) const MS: u32 = 3500;
/// The 3.5 MHz clock all of a tape's timings are in.
pub(crate) const TAPE_HZ: u64 = 3_500_000;

/// How many blocks may be entered one after another with no time passing before the tape is taken to be
/// looping forever (a jump to itself, a loop of nothing but information).
const ENDLESS: u32 = 1_000_000;

/// Why the tape stopped itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    /// A block said to stop the tape: TZX 0x20 with a pause of 0, or PZX STOP. The block's index.
    StopBlock(usize),
    /// TZX 0x2A (or PZX STOP for a 48K only), on a 48K. The block's index.
    StopIf48k(usize),
    /// The tape has played to its end.
    EndOfTape,
    /// The blocks jump or loop among themselves with no signal between, for ever; the block where it was
    /// seen.
    EndlessLoop(usize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EventKind {
    /// The level changes to this.
    Level(bool),
    /// The block of this index begins.
    Block(usize),
    /// The tape stops itself.
    Stop(StopReason),
}

/// Something that happens at a position on the tape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Event {
    pub pos: u64,
    pub kind: EventKind,
}

/// How a block's signal is made: a few pieces one after another, each a simple run of pulses.
#[derive(Clone, Copy)]
pub(crate) enum Piece<'a> {
    /// `count` pulses of `len`.
    Tone {
        len: u32,
        count: u32,
    },
    /// One pulse.
    Pulse(u32),
    /// Pulses of these lengths.
    Pulses(&'a [u16]),
    /// `bits` bits of `data`, most significant first, each the pulses of `zero` or `one`.
    Bits {
        data: &'a [u8],
        bits: u64,
        zero: Seq<'a>,
        one: Seq<'a>,
    },
    /// `count` samples of `len` each, a bit of `data` each, 1 high.
    Samples {
        data: &'a [u8],
        count: u64,
        len: u32,
    },
    /// Pulses measured in samples at `rate` per second.
    Csw {
        pulses: &'a [u32],
        rate: u32,
    },
    /// A generalized data block's pilot and sync, and its data.
    GdbPilot(&'a Generalized),
    GdbData(&'a Generalized),
    /// PZX pulses, each repeated.
    PzxPulses(&'a [PzxPulse]),
    /// A level held for `len`, which stays the pulse level after it (PZX's PAUS).
    Steady {
        len: u32,
        high: bool,
    },
    /// A TZX pause.
    Pause(u32),
    /// The pulse level for what follows.
    SetLevel(bool),
}

/// The pulses that make a bit.
#[derive(Clone, Copy)]
pub(crate) enum Seq<'a> {
    /// Two pulses of this length, as the ROM's encoding has.
    Twice(u16),
    List(&'a [u16]),
}

impl Seq<'_> {
    fn len(&self) -> usize {
        match self {
            Seq::Twice(_) => 2,
            Seq::List(l) => l.len(),
        }
    }
    fn get(&self, i: usize) -> u32 {
        match self {
            Seq::Twice(p) => *p as u32,
            Seq::List(l) => l[i] as u32,
        }
    }
    fn total(&self) -> u64 {
        match self {
            Seq::Twice(p) => 2 * *p as u64,
            Seq::List(l) => l.iter().map(|&p| p as u64).sum(),
        }
    }
}

/// The `n`th piece of a block's signal; `None` past its last.
pub(crate) fn piece(block: &Block, n: usize) -> Option<Piece<'_>> {
    use Piece::*;
    Some(match (block, n) {
        (Block::Standard { data, .. }, 0) => {
            let header = data.first().is_some_and(|&f| f < 0x80);
            let count = if header {
                rom::HEADER_PILOT_PULSES
            } else {
                rom::DATA_PILOT_PULSES
            };
            Tone {
                len: rom::PILOT as u32,
                count: count as u32,
            }
        }
        (Block::Standard { .. }, 1) => Pulse(rom::SYNC1 as u32),
        (Block::Standard { .. }, 2) => Pulse(rom::SYNC2 as u32),
        (Block::Standard { data, .. }, 3) => Bits {
            data,
            bits: data.len() as u64 * 8,
            zero: Seq::Twice(rom::ZERO),
            one: Seq::Twice(rom::ONE),
        },
        (Block::Standard { pause_ms, .. }, 4) => Pause(*pause_ms as u32),
        (Block::Turbo(t), 0) => Tone {
            len: t.pilot as u32,
            count: t.pilot_pulses as u32,
        },
        (Block::Turbo(t), 1) => Pulse(t.sync1 as u32),
        (Block::Turbo(t), 2) => Pulse(t.sync2 as u32),
        (Block::Turbo(t), 3) => Bits {
            data: &t.data,
            bits: bit_count(t.data.len(), t.used_bits),
            zero: Seq::Twice(t.zero),
            one: Seq::Twice(t.one),
        },
        (Block::Turbo(t), 4) => Pause(t.pause_ms as u32),
        (Block::PureTone { pulse, count }, 0) => Tone {
            len: *pulse as u32,
            count: *count as u32,
        },
        (Block::Pulses(list), 0) => Pulses(list),
        (Block::PureData(d), 0) => Bits {
            data: &d.data,
            bits: bit_count(d.data.len(), d.used_bits),
            zero: Seq::Twice(d.zero),
            one: Seq::Twice(d.one),
        },
        (Block::PureData(d), 1) => Pause(d.pause_ms as u32),
        (Block::DirectRecording(d), 0) => Samples {
            data: &d.data,
            count: bit_count(d.data.len(), d.used_bits),
            len: d.tstates_per_sample as u32,
        },
        (Block::DirectRecording(d), 1) => Pause(d.pause_ms as u32),
        (Block::Csw(c), 0) => match c.initial {
            Some(high) => SetLevel(high),
            // A CSW block in a TZX starts at the level the tape is at: nothing to do.
            None => Pulses(&[]),
        },
        (Block::Csw(c), 1) => Csw {
            pulses: &c.pulses,
            rate: c.sample_rate,
        },
        (Block::Csw(c), 2) => Pause(c.pause_ms as u32),
        (Block::Generalized(g), 0) => GdbPilot(g),
        (Block::Generalized(g), 1) => GdbData(g),
        (Block::Generalized(g), 2) => Pause(g.pause_ms as u32),
        (Block::Pause { ms }, 0) => Pause(*ms as u32),
        (Block::PzxPulses(_), 0) => SetLevel(false),
        (Block::PzxPulses(list), 1) => PzxPulses(list),
        (Block::PzxData(d), 0) => SetLevel(d.initial_high),
        (Block::PzxData(d), 1) => Bits {
            data: &d.data,
            bits: d.bits as u64,
            zero: Seq::List(&d.zero),
            one: Seq::List(&d.one),
        },
        (Block::PzxData(d), 2) => Pulse(d.tail as u32),
        (Block::PzxPause { duration, high }, 0) => Steady {
            len: *duration,
            high: *high,
        },
        _ => return None,
    })
}

/// What a piece does next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    /// A pulse at the pulse level, which then flips.
    Pulse(u64),
    /// A pulse at the pulse level, which stays (a recording's last pulse, a pause's first millisecond).
    Hold(u64),
    /// A sample at a level, which becomes the pulse level.
    Sample(u64, bool),
    /// Low, which becomes the pulse level (the rest of a pause).
    Low(u64),
    /// The pulse level from here.
    SetLevel(bool),
    /// A generalized block's symbol begins, with this polarity.
    Polarity(u8),
}

/// Where a piece has got to.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Cursor {
    a: u64,
    b: u32,
    c: u32,
    /// A CSW piece's samples so far, and the T-states its edges have been given.
    samples: u64,
    tstates: u64,
}

impl Piece<'_> {
    /// The piece's next step, or `None` when it is done.
    fn op(&self, c: &mut Cursor) -> Option<Op> {
        match *self {
            Piece::Tone { len, count } => (c.a < count as u64).then(|| {
                c.a += 1;
                Op::Pulse(len as u64)
            }),
            Piece::Pulse(d) => (c.a == 0).then(|| {
                c.a = 1;
                Op::Pulse(d as u64)
            }),
            Piece::SetLevel(l) => (c.a == 0).then(|| {
                c.a = 1;
                Op::SetLevel(l)
            }),
            Piece::Steady { len, high } => (c.a == 0).then(|| {
                c.a = 1;
                Op::Sample(len as u64, high)
            }),
            Piece::Pulses(list) => list.get(c.a as usize).map(|&p| {
                c.a += 1;
                Op::Pulse(p as u64)
            }),
            Piece::Bits {
                data,
                bits,
                zero,
                one,
            } => loop {
                if c.a >= bits {
                    return None;
                }
                let bit = data[(c.a / 8) as usize] >> (7 - c.a % 8) & 1 != 0;
                let seq = if bit { one } else { zero };
                if (c.b as usize) < seq.len() {
                    c.b += 1;
                    return Some(Op::Pulse(seq.get(c.b as usize - 1) as u64));
                }
                c.a += 1;
                c.b = 0;
            },
            Piece::Samples { data, count, len } => (c.a < count).then(|| {
                let high = data[(c.a / 8) as usize] >> (7 - c.a % 8) & 1 != 0;
                c.a += 1;
                Op::Sample(len as u64, high)
            }),
            Piece::Csw { pulses, rate } => pulses.get(c.a as usize).map(|&p| {
                c.a += 1;
                c.samples += p as u64;
                let end = (c.samples as u128 * TAPE_HZ as u128 / rate as u128) as u64;
                let d = end - c.tstates;
                c.tstates = end;
                if c.a as usize == pulses.len() {
                    Op::Hold(d)
                } else {
                    Op::Pulse(d)
                }
            }),
            Piece::GdbPilot(g) => loop {
                let &(symbol, reps) = g.pilot.get(c.a as usize)?;
                // A run of a symbol with no pulses makes nothing, however long.
                if c.b >= reps as u32 || symbol_length(g.pilot_symbols.get(symbol as usize)) == 0 {
                    c.a += 1;
                    c.b = 0;
                    c.c = 0;
                    continue;
                }
                match symbol_op(g.pilot_symbols.get(symbol as usize), &mut c.c) {
                    Some(op) => return Some(op),
                    None => c.b += 1,
                }
            },
            Piece::GdbData(g) => loop {
                // With one symbol, the stream holds no bits: if that symbol has no pulses, it is nothing.
                let silent = g.bits_per_symbol == 0 && symbol_length(g.data_symbols.first()) == 0;
                if c.a >= g.data_count as u64 || silent {
                    return None;
                }
                let symbol = g.data_symbol(c.a as u32);
                match symbol_op(g.data_symbols.get(symbol as usize), &mut c.c) {
                    Some(op) => return Some(op),
                    None => c.a += 1,
                }
            },
            Piece::PzxPulses(list) => loop {
                let p = list.get(c.a as usize)?;
                if c.b < p.count as u32 {
                    c.b += 1;
                    return Some(Op::Pulse(p.duration as u64));
                }
                c.a += 1;
                c.b = 0;
            },
            Piece::Pause(ms) => {
                let total = ms as u64 * MS as u64;
                let first = total.min(MS as u64);
                c.a += 1;
                match (ms, c.a) {
                    (0, _) => None,
                    (_, 1) => Some(Op::Hold(first)),
                    (_, 2) => Some(Op::Low(total - first)),
                    _ => None,
                }
            }
        }
    }

    /// How long the piece lasts, in 3.5 MHz T-states.
    pub(crate) fn duration(&self) -> u64 {
        match *self {
            Piece::Tone { len, count } => len as u64 * count as u64,
            Piece::Pulse(d) => d as u64,
            Piece::Pulses(list) => list.iter().map(|&p| p as u64).sum(),
            Piece::Bits {
                data,
                bits,
                zero,
                one,
            } => {
                let full = (bits / 8) as usize;
                let mut ones: u64 = data[..full].iter().map(|b| b.count_ones() as u64).sum();
                let rest = (bits % 8) as u32;
                if rest > 0 {
                    ones += (data[full] >> (8 - rest)).count_ones() as u64;
                }
                ones * one.total() + (bits - ones) * zero.total()
            }
            Piece::Samples { count, len, .. } => count * len as u64,
            Piece::Csw { pulses, rate } => {
                let samples: u64 = pulses.iter().map(|&p| p as u64).sum();
                (samples as u128 * TAPE_HZ as u128 / rate as u128) as u64
            }
            Piece::GdbPilot(g) => g
                .pilot
                .iter()
                .map(|&(s, reps)| reps as u64 * symbol_length(g.pilot_symbols.get(s as usize)))
                .sum(),
            Piece::GdbData(g) if g.bits_per_symbol == 0 => {
                g.data_count as u64 * symbol_length(g.data_symbols.first())
            }
            Piece::GdbData(g) => (0..g.data_count)
                .map(|i| symbol_length(g.data_symbols.get(g.data_symbol(i) as usize)))
                .sum(),
            Piece::PzxPulses(list) => list
                .iter()
                .map(|p| p.count as u64 * p.duration as u64)
                .sum(),
            Piece::Pause(ms) => ms as u64 * MS as u64,
            Piece::Steady { len, .. } => len as u64,
            Piece::SetLevel(_) => 0,
        }
    }
}

/// A generalized block's symbol, a step at a time: its polarity, then its pulses. `c` counts the steps.
fn symbol_op(symbol: Option<&Symbol>, c: &mut u32) -> Option<Op> {
    let symbol = symbol?;
    let step = *c;
    *c += 1;
    if step == 0 {
        return Some(Op::Polarity(symbol.polarity));
    }
    match symbol.pulses.get(step as usize - 1) {
        Some(&p) => Some(Op::Pulse(p as u64)),
        None => {
            *c = 0;
            None
        }
    }
}

fn symbol_length(symbol: Option<&Symbol>) -> u64 {
    symbol.map_or(0, |s| s.pulses.iter().map(|&p| p as u64).sum())
}

/// How long a block lasts as it plays, in 3.5 MHz T-states (a block that directs the tape lasts no time).
pub fn duration(block: &Block) -> u64 {
    (0..)
        .map_while(|n| piece(block, n))
        .map(|p| p.duration())
        .sum()
}

/// What entering a block did.
enum Entered {
    /// It has a signal to play.
    Sound,
    /// It moved the tape on (it directs the tape, or carries no signal).
    Moved,
    /// It stopped the tape.
    Stop(StopReason),
}

/// The tape's signal, made as it is asked for: where it has got to among the blocks and in time.
#[derive(Clone, Debug)]
pub(crate) struct Signal {
    /// The block being played.
    pub index: usize,
    /// Whether that block has been entered (its event given, what it does to the tape done).
    entered: bool,
    /// Which of its pieces is playing, and where in it.
    piece: usize,
    cursor: Cursor,
    /// The position up to which the signal has been made.
    pub pos: u64,
    /// The pulse level and the line (see the module's documentation).
    level: bool,
    line: bool,
    /// The level the last event gave, which only a change leaves.
    out: bool,
    /// Loops being played: the block after the loop's start, and the passes left.
    loops: Vec<(usize, u16)>,
    /// Calls being played: the call block, and which of its calls.
    calls: Vec<(usize, usize)>,
    /// Blocks entered since time last passed.
    idle: u32,
    /// Whether the tape has played to its end.
    pub ended: bool,
}

impl Signal {
    /// The signal from the start of block `index`, everything low.
    pub fn at(index: usize) -> Signal {
        Signal {
            index,
            entered: false,
            piece: 0,
            cursor: Cursor::default(),
            pos: 0,
            level: false,
            line: false,
            out: false,
            loops: Vec::new(),
            calls: Vec::new(),
            idle: 0,
            ended: false,
        }
    }

    /// Makes the signal on until it has given a level change or a stop, putting what happens on the way
    /// (blocks beginning) into `out` in order.
    pub fn fill(&mut self, blocks: &[Block], is_48k: bool, out: &mut VecDeque<Event>) {
        loop {
            if self.ended || self.index >= blocks.len() {
                self.finish(out);
                self.ended = true;
                out.push_back(Event {
                    pos: self.pos,
                    kind: EventKind::Stop(StopReason::EndOfTape),
                });
                return;
            }
            if !self.entered {
                self.entered = true;
                self.piece = 0;
                self.cursor = Cursor::default();
                self.announce(blocks, out);
                self.idle += 1;
                if self.idle > ENDLESS {
                    self.finish(out);
                    let reason = StopReason::EndlessLoop(self.index);
                    self.ended = true;
                    out.push_back(Event {
                        pos: self.pos,
                        kind: EventKind::Stop(reason),
                    });
                    return;
                }
                match self.enter(blocks, is_48k) {
                    Entered::Sound => {}
                    Entered::Moved => continue,
                    Entered::Stop(reason) => {
                        self.finish(out);
                        out.push_back(Event {
                            pos: self.pos,
                            kind: EventKind::Stop(reason),
                        });
                        return;
                    }
                }
            }
            let Some(piece) = piece(&blocks[self.index], self.piece) else {
                self.next();
                continue;
            };
            match piece.op(&mut self.cursor) {
                None => {
                    self.piece += 1;
                    self.cursor = Cursor::default();
                }
                Some(op) => {
                    if self.apply(op, out) {
                        return;
                    }
                }
            }
        }
    }

    /// Says that the current block begins. Blocks passed with no time between them say it once, as the last
    /// of them: the page shows the block that plays, and a tape that loops among blocks of no signal does
    /// not fill the queue. A message is kept, to be shown.
    fn announce(&self, blocks: &[Block], out: &mut VecDeque<Event>) {
        if let Some(last) = out.back_mut()
            && last.pos == self.pos
            && let EventKind::Block(i) = last.kind
            && !matches!(blocks[i], Block::Message { .. })
        {
            last.kind = EventKind::Block(self.index);
            return;
        }
        out.push_back(Event {
            pos: self.pos,
            kind: EventKind::Block(self.index),
        });
    }

    /// Does what a block does to the tape as it is entered.
    fn enter(&mut self, blocks: &[Block], is_48k: bool) -> Entered {
        let i = self.index;
        match &blocks[i] {
            Block::Pause { ms: 0 } => {
                self.next();
                Entered::Stop(StopReason::StopBlock(i))
            }
            Block::StopIf48k => {
                self.next();
                if is_48k {
                    Entered::Stop(StopReason::StopIf48k(i))
                } else {
                    Entered::Moved
                }
            }
            block if block.sounds() => Entered::Sound,
            _ => {
                self.direct(blocks);
                Entered::Moved
            }
        }
    }

    /// Moves on past a block that carries no signal, doing what it says about where to go.
    fn direct(&mut self, blocks: &[Block]) {
        let i = self.index;
        match &blocks[i] {
            Block::Jump(offset) => self.goto(i as i64 + *offset as i64, blocks.len()),
            Block::LoopStart(n) => {
                self.loops.push((i + 1, (*n).max(1)));
                self.next();
            }
            Block::LoopEnd => match self.loops.last_mut() {
                Some((start, left)) => {
                    *left -= 1;
                    if *left > 0 {
                        let start = *start;
                        self.goto(start as i64, blocks.len());
                    } else {
                        self.loops.pop();
                        self.next();
                    }
                }
                None => self.next(),
            },
            Block::Call(list) if !list.is_empty() => {
                self.calls.push((i, 0));
                self.goto(i as i64 + list[0] as i64, blocks.len());
            }
            Block::Return => match self.calls.pop() {
                Some((at, k)) => match &blocks[at] {
                    Block::Call(list) if k + 1 < list.len() => {
                        self.calls.push((at, k + 1));
                        self.goto(at as i64 + list[k + 1] as i64, blocks.len());
                    }
                    _ => self.goto(at as i64 + 1, blocks.len()),
                },
                None => self.next(),
            },
            Block::SetLevel(high) => {
                self.level = *high;
                self.line = *high;
                self.next();
            }
            _ => self.next(),
        }
    }

    /// On to the next block.
    pub fn next(&mut self) {
        self.index += 1;
        self.entered = false;
    }

    /// On to block `to`; anywhere off the tape is its end.
    fn goto(&mut self, to: i64, len: usize) {
        self.index = if (0..len as i64).contains(&to) {
            to as usize
        } else {
            len
        };
        self.entered = false;
    }

    /// The tape stops or ends: the last pulse is ended as a pause ends it. The line takes the pulse level
    /// (the last pulse's edge, which a loader reading the last bit waits for), holds it for a millisecond if
    /// it is high, and goes low: a tape at rest is silent, and starts low when it plays again.
    fn finish(&mut self, out: &mut VecDeque<Event>) {
        if self.level != self.out {
            self.out = self.level;
            out.push_back(Event {
                pos: self.pos,
                kind: EventKind::Level(self.level),
            });
        }
        if self.out {
            self.pos += MS as u64;
            self.out = false;
            out.push_back(Event {
                pos: self.pos,
                kind: EventKind::Level(false),
            });
        }
        self.level = false;
        self.line = false;
    }

    /// Plays one step; true if it gave a level change.
    fn apply(&mut self, op: Op, out: &mut VecDeque<Event>) -> bool {
        match op {
            Op::Pulse(d) => {
                let l = self.level;
                self.level = !l;
                self.segment(d, l, out)
            }
            Op::Hold(d) => self.segment(d, self.level, out),
            Op::Sample(d, l) => {
                self.level = l;
                self.segment(d, l, out)
            }
            Op::Low(d) => {
                self.level = false;
                self.segment(d, false, out)
            }
            Op::SetLevel(l) => {
                self.level = l;
                false
            }
            Op::Polarity(p) => {
                self.level = match p & 3 {
                    0 => !self.line,
                    1 => self.line,
                    2 => false,
                    _ => true,
                };
                false
            }
        }
    }

    /// `d` T-states at level `l`; true if that is a change.
    fn segment(&mut self, d: u64, l: bool, out: &mut VecDeque<Event>) -> bool {
        self.line = l;
        if d == 0 {
            return false;
        }
        self.idle = 0;
        let change = l != self.out;
        if change {
            self.out = l;
            out.push_back(Event {
                pos: self.pos,
                kind: EventKind::Level(l),
            });
        }
        self.pos += d;
        change
    }

    /// Whether the ROM, listening from now, would hear the whole of the current block's lead-in: the block
    /// is yet to begin, or is still in its first piece of signal.
    pub fn in_lead_in(&self, blocks: &[Block]) -> bool {
        if !self.entered {
            return true;
        }
        match blocks.get(self.index) {
            Some(Block::PzxPulses(_)) => self.piece <= 1,
            Some(_) => self.piece == 0,
            None => false,
        }
    }

    /// Moves on to the next block that sounds, passing pauses, stops and the blocks that carry no signal
    /// (doing what those say about where to go); false at the end of the tape.
    pub fn seek_sound(&mut self, blocks: &[Block]) -> bool {
        for _ in 0..ENDLESS {
            match blocks.get(self.index) {
                None => return false,
                Some(Block::Pause { .. } | Block::PzxPause { .. } | Block::StopIf48k) => {
                    self.next()
                }
                Some(b) if b.sounds() => return true,
                Some(_) => self.direct(blocks),
            }
        }
        false
    }

    /// Puts the signal at the start of the pause after block `index`'s signal, everything low, the
    /// position the time the block takes before its pause: where the tape is when LD-BYTES has read the
    /// block's last bit. False, and the signal unchanged, if the block has no pause.
    pub fn restart_at_pause(&mut self, blocks: &[Block], index: usize) -> bool {
        let Some(block) = blocks.get(index) else {
            return false;
        };
        let pieces = || (0..).map_while(|n| piece(block, n));
        let Some(n) = pieces().position(|p| matches!(p, Piece::Pause(ms) if ms > 0)) else {
            return false;
        };
        self.restart();
        self.index = index;
        self.entered = true;
        self.piece = n;
        self.pos = pieces().take(n).map(|p| p.duration()).sum();
        true
    }

    /// Puts the signal at the start of the block it is at, with everything low and time from 0: as a tape
    /// is when it starts to play from a block. Where it is in loops and calls is kept.
    pub fn restart(&mut self) {
        self.entered = false;
        self.piece = 0;
        self.cursor = Cursor::default();
        self.pos = 0;
        self.level = false;
        self.line = false;
        self.out = false;
        self.idle = 0;
        self.ended = false;
    }
}
