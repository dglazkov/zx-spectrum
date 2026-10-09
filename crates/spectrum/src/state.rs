//! The machine's whole state as bytes, for rewinding: compact, quick, versioned, and exact. A machine put back
//! from it runs on to the same frames, the same sound and the same state, bit for bit.
//!
//! The format: `ZXST`, a version (u16, little-endian), then a deflated body of fields in a fixed order
//! (little-endian integers). What it holds: the model and the options that make the machine what it is (Issue
//! 2, late timings, an AY on a 48K, snow); the CPU (every register, the EI delay, a pending prefix, Q); the
//! T-state, frames run and a pending NMI; RAM (the model's banks), the paging ports and lock; port FEh; the
//! ULA's picture (where it has got to in the frame, the border, FLASH's count, the frame so far) and the
//! +2A/+3's floating-bus latch; the AY's state and what it has put into the sound; the sound buffer (pending
//! samples and its filters' histories) and the beeper's and tape's levels; and the tape deck's log (whose tape
//! it is, by hash, and every control with its frame and T-state), from which the tape's position is rebuilt.
//!
//! Not in it, being the person's and not the machine's: the keys held and the joystick's bits, the typist,
//! breakpoints, the options that are preferences (instant loading, the automatic tape, the tape heard, stereo,
//! tone, volume, the sample rate), the tape itself (the deck keeps the tape it has: a state from another tape
//! leaves the deck stopped where it is), and a SAVE in progress.

use crate::deck::{LogEntry, Op};
use crate::input::Joystick;
use crate::machine::Machine;
use crate::memory::{BANK, ROM_BASE};
use crate::model::Model;
use crate::video::SnowEvent;

const MAGIC: &[u8; 4] = b"ZXST";
const VERSION: u16 = 1;
/// The tagged fields after the fixed ones (see `save_state`).
const TAG_END: u8 = 0;
const TAG_HEARD: u8 = 1;
const TAG_ROMS: u8 = 2;
/// How far past the frame's length an instruction can have run (a T-state kept in a state is held to it).
const TABLE_SLACK: u32 = 255;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StateError {
    NotAState,
    Version(u16),
    Damaged(String),
}

impl std::fmt::Display for StateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StateError::NotAState => write!(f, "not a saved state"),
            StateError::Version(v) => write!(f, "a saved state of version {v}, not {VERSION}"),
            StateError::Damaged(s) => write!(f, "damaged state: {s}"),
        }
    }
}

impl std::error::Error for StateError {}

#[derive(Default)]
struct W(Vec<u8>);

impl W {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn bool(&mut self, v: bool) {
        self.0.push(v as u8);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn i64(&mut self, v: i64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn f64(&mut self, v: f64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
}

struct R<'a> {
    b: &'a [u8],
    at: usize,
}

impl R<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], StateError> {
        if self.at + n > self.b.len() {
            return Err(StateError::Damaged("cut short".into()));
        }
        let s = &self.b[self.at..self.at + n];
        self.at += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, StateError> {
        Ok(self.take(1)?[0])
    }
    fn bool(&mut self) -> Result<bool, StateError> {
        Ok(self.u8()? != 0)
    }
    fn u16(&mut self) -> Result<u16, StateError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, StateError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, StateError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, StateError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Result<i64, StateError> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn f32(&mut self) -> Result<f32, StateError> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn f64(&mut self) -> Result<f64, StateError> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
}

fn model_code(m: Model) -> u8 {
    Model::ALL.iter().position(|&x| x == m).unwrap() as u8
}

fn tone_code(t: audio::Tone) -> u8 {
    match t {
        audio::Tone::Flat => 0,
        audio::Tone::Speaker => 1,
        audio::Tone::Television => 2,
    }
}

fn tone_from(c: u8) -> audio::Tone {
    match c {
        1 => audio::Tone::Speaker,
        2 => audio::Tone::Television,
        _ => audio::Tone::Flat,
    }
}

/// The pixels, four bits each.
fn pack_pixels(p: &[u8]) -> Vec<u8> {
    p.chunks(2)
        .map(|c| (c[0] & 15) | (c.get(1).copied().unwrap_or(0) << 4))
        .collect()
}

fn unpack_pixels(packed: &[u8], out: &mut [u8]) {
    for (i, o) in out.iter_mut().enumerate() {
        let b = packed.get(i / 2).copied().unwrap_or(0);
        *o = if i % 2 == 0 { b & 15 } else { b >> 4 };
    }
}

impl Machine {
    /// A tape from another machine (or another state) put in this one's deck, stopped at the block it stood at.
    fn keep_tape(&mut self, d: crate::deck::Deck) {
        let block = d.status().block;
        self.insert_tape(d.tape().clone(), d.hash, d.name.clone());
        if block > 0 {
            self.tape_seek(block);
        }
    }

    /// The machine's whole state, as bytes (see the module's documentation).
    pub fn save_state(&self) -> Vec<u8> {
        let mut w = W::default();
        let hw = &self.hw;
        let o = hw.options;
        w.u8(model_code(hw.model));
        w.bool(o.issue2);
        w.bool(o.late_timings);
        w.bool(o.ay_on_48k);
        w.bool(o.snow);
        // The CPU.
        let r = &self.cpu.regs;
        for v in [r.a, r.f, r.b, r.c, r.d, r.e, r.h, r.l] {
            w.u8(v);
        }
        for v in [r.af_, r.bc_, r.de_, r.hl_, r.ix, r.iy, r.sp, r.pc, r.memptr] {
            w.u16(v);
        }
        for v in [r.i, r.r, r.im, r.q, r.prefix] {
            w.u8(v);
        }
        for v in [r.iff1, r.iff2, r.halted, r.int_blocked, r.ld_a_ir] {
            w.bool(v);
        }
        w.u32(self.t);
        w.u64(self.frames);
        w.bool(self.nmi_pending);
        w.bool(self.frame_start);
        // Memory and paging.
        for &b in hw.model.banks() {
            w.0.extend_from_slice(hw.mem.bank(b));
        }
        w.u8(hw.mem.port_7ffd);
        w.u8(hw.mem.port_1ffd);
        w.bool(hw.mem.locked);
        w.u8(hw.port_fe);
        w.u8(match hw.input.joystick {
            Joystick::None => 0,
            Joystick::Kempston => 1,
            Joystick::Sinclair1 => 2,
            Joystick::Sinclair2 => 3,
            Joystick::Cursor => 4,
        });
        w.u64(hw.frame_abs);
        w.i64(hw.last_bus.0);
        w.u8(hw.last_bus.1);
        w.u32(hw.fe_reads);
        // The picture.
        let (row, unit) = hw.video.position();
        w.u32(row);
        w.u32(unit);
        w.u8(hw.video.border);
        w.u32(hw.video.flash_frames);
        w.0.extend_from_slice(&pack_pixels(&hw.video.pixels));
        w.u32(hw.video.snow.len() as u32);
        for e in &hw.video.snow {
            w.u8(e.line);
            w.u8(e.col);
            match e.kind {
                crate::video::SnowKind::Snow(r) => {
                    w.u8(0);
                    w.u8(r)
                }
                crate::video::SnowKind::Double => {
                    w.u8(1);
                    w.u8(0)
                }
            }
        }
        w.u32(hw.video.snow_next() as u32);
        w.u8(hw.video.latched().map_or(0, |_| 1));
        w.u8(hw.video.latched().unwrap_or(0));
        // The AY.
        w.bool(hw.ay.is_some());
        if let Some(chip) = &hw.ay {
            let s = chip.state();
            w.0.extend_from_slice(&s.regs);
            w.u8(s.address);
            w.bool(s.selected);
            for c in s.tone_count {
                w.u16(c);
            }
            for h in s.tone_high {
                w.bool(h);
            }
            w.u8(s.noise_count);
            w.bool(s.noise_half);
            w.u32(s.lfsr);
            w.u32(s.env_count);
            w.u8(s.env_step);
            w.u8(s.env_attack);
            w.bool(s.env_hold);
            w.bool(s.env_alternate);
            w.bool(s.env_holding);
            w.u8(s.port_a_pins);
            w.u32(s.next_tick);
            w.u32(s.tick_frac);
        }
        // The sound.
        let snd = &hw.sound;
        w.i32(snd.ay_total.0);
        w.i32(snd.ay_total.1);
        let (bl, br) = snd.beeper.units();
        w.i32(bl);
        w.i32(br);
        let (tl, tr) = snd.tape.units();
        w.i32(tl);
        w.i32(tr);
        let b = snd.buffer.state();
        w.u32(b.clock_hz);
        w.u32(b.sample_rate);
        w.u64(b.frac);
        w.u64(b.frame_start);
        w.u32(b.deltas.len() as u32);
        for d in &b.deltas {
            w.i64(d[0]);
            w.i64(d[1]);
        }
        w.i64(b.level[0]);
        w.i64(b.level[1]);
        w.u8(tone_code(b.output.tone));
        w.bool(b.output.dc_block);
        w.f32(b.output.volume);
        w.u32(b.filters.len() as u32);
        for f in &b.filters {
            for v in f {
                w.f64(*v);
            }
        }
        // The tape deck.
        w.bool(hw.deck.is_some());
        if let Some(d) = &hw.deck {
            w.u64(d.hash);
            let (frame, log) = d.position();
            w.u64(frame);
            w.u32(log.len() as u32);
            for e in log {
                w.u64(e.frame);
                w.u32(e.t);
                let (code, arg) = match e.op {
                    Op::Play => (0, 0),
                    Op::Stop => (1, 0),
                    Op::Seek(b) => (2, b),
                    Op::TakeRomBlock => (3, 0),
                };
                w.u8(code);
                w.u32(arg);
            }
            w.bool(d.auto_started);
            w.u32(d.idle_frames);
            let (last, loader, other) = d.watch();
            w.bool(last.is_some());
            let (lt, lb) = last.unwrap_or((0, 0));
            w.u64(lt);
            w.u8(lb);
            w.u32(loader);
            w.u32(other);
        }
        // The +3's disk controller.
        match &hw.fdc {
            Some(f) => {
                let b = f.save();
                w.u8(b.len() as u8);
                w.0.extend_from_slice(&b);
            }
            None => w.u8(0),
        }
        // Then tagged fields, each a tag byte and its data, ended by 0 (a state without them, written before
        // they were added, ends here and loads with their defaults; one with them loads in a reader that
        // stops before them):
        // 1: how far into this frame the tape's edges have been heard (u32), when a tape is in the deck;
        // 2: the ROMs, when they are not the model's own (a snapshot's custom ROM): u32 length, the bytes.
        if let Some(d) = &hw.deck {
            w.u8(TAG_HEARD);
            w.u32(d.heard_to);
        }
        let roms = hw.model.roms();
        let rom_area = &hw.mem.mem[ROM_BASE..ROM_BASE + roms.len() * BANK];
        if roms
            .iter()
            .enumerate()
            .any(|(i, r)| rom_area[i * BANK..(i + 1) * BANK] != r[..])
        {
            w.u8(TAG_ROMS);
            w.u32(rom_area.len() as u32);
            w.0.extend_from_slice(rom_area);
        }
        w.u8(TAG_END);
        let body = miniz_oxide::deflate::compress_to_vec(&w.0, 1);
        let mut out = Vec::with_capacity(body.len() + 6);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    /// Puts the machine back as `save_state` had it. The model changes if the state's is another; the frame
    /// counter (`frame_count`) goes on.
    pub fn load_state(&mut self, bytes: &[u8]) -> Result<(), StateError> {
        if bytes.len() < 6 || &bytes[..4] != MAGIC {
            return Err(StateError::NotAState);
        }
        let version = u16::from_le_bytes([bytes[4], bytes[5]]);
        if version != VERSION {
            return Err(StateError::Version(version));
        }
        let body = miniz_oxide::inflate::decompress_to_vec_with_limit(&bytes[6..], 16 << 20)
            .map_err(|e| StateError::Damaged(format!("{e:?}")))?;
        let mut r = R { b: &body, at: 0 };
        let model = *Model::ALL
            .get(r.u8()? as usize)
            .ok_or_else(|| StateError::Damaged("model".into()))?;
        let mut options = self.options();
        options.issue2 = r.bool()?;
        options.late_timings = r.bool()?;
        options.ay_on_48k = r.bool()?;
        options.snow = r.bool()?;
        // A machine of the state's model and options, keeping what is the person's.
        let keys = self.hw.input.clone();
        let typist = self.typist.clone();
        let breakpoints = self.breakpoints.clone();
        let slt = self.slt.clone();
        let deck = self.hw.deck.take();
        let frame_count = self.frame_count;
        let rate = self.sample_rate;
        let mut m = Machine::with_options(model, options);
        m.set_sample_rate(rate);
        m.hw.input = keys;
        m.typist = typist;
        m.breakpoints = breakpoints;
        m.slt = slt;
        m.frame_count = frame_count;
        // The CPU.
        {
            let c = &mut m.cpu.regs;
            c.a = r.u8()?;
            c.f = r.u8()?;
            c.b = r.u8()?;
            c.c = r.u8()?;
            c.d = r.u8()?;
            c.e = r.u8()?;
            c.h = r.u8()?;
            c.l = r.u8()?;
            c.af_ = r.u16()?;
            c.bc_ = r.u16()?;
            c.de_ = r.u16()?;
            c.hl_ = r.u16()?;
            c.ix = r.u16()?;
            c.iy = r.u16()?;
            c.sp = r.u16()?;
            c.pc = r.u16()?;
            c.memptr = r.u16()?;
            c.i = r.u8()?;
            c.r = r.u8()?;
            c.im = r.u8()?.min(2);
            c.q = r.u8()?;
            c.prefix = r.u8()?;
            c.iff1 = r.bool()?;
            c.iff2 = r.bool()?;
            c.halted = r.bool()?;
            c.int_blocked = r.bool()?;
            c.ld_a_ir = r.bool()?;
        }
        m.t = r.u32()?.min(m.hw.timing.frame + 255);
        m.frames = r.u64()?;
        m.nmi_pending = r.bool()?;
        m.frame_start = r.bool()?;
        for &b in model.banks() {
            let data = r.take(0x4000)?.to_vec();
            m.hw.mem.bank_mut(b).copy_from_slice(&data);
        }
        m.hw.mem.port_7ffd = r.u8()?;
        m.hw.mem.port_1ffd = r.u8()?;
        m.hw.mem.locked = r.bool()?;
        m.hw.mem.update();
        m.hw.port_fe = r.u8()?;
        let joystick = match r.u8()? {
            1 => Joystick::Kempston,
            2 => Joystick::Sinclair1,
            3 => Joystick::Sinclair2,
            4 => Joystick::Cursor,
            _ => Joystick::None,
        };
        let bits = m.hw.input.joy_bits;
        m.hw.input.set_joystick(joystick, bits);
        m.hw.frame_abs = r.u64()?;
        m.hw.last_bus = (r.i64()?, r.u8()?);
        m.hw.fe_reads = r.u32()?;
        let row = r.u32()?;
        let unit = r.u32()?;
        m.hw.video.set_position(row, unit);
        m.hw.video.border = r.u8()? & 7;
        m.hw.video.flash_frames = r.u32()?;
        let packed = r.take(m.hw.video.pixels.len().div_ceil(2))?.to_vec();
        unpack_pixels(&packed, &mut m.hw.video.pixels);
        let n = r.u32()? as usize;
        if n > 100_000 {
            return Err(StateError::Damaged("snow".into()));
        }
        for _ in 0..n {
            let (line, col, kind, v) = (r.u8()?, r.u8()?, r.u8()?, r.u8()?);
            m.hw.video.snow.push(SnowEvent {
                line,
                col,
                kind: if kind == 0 {
                    crate::video::SnowKind::Snow(v)
                } else {
                    crate::video::SnowKind::Double
                },
            });
        }
        let snow_next = r.u32()? as usize;
        let has_latch = r.u8()? != 0;
        let latch = r.u8()?;
        m.hw.video
            .restore_progress(snow_next, has_latch.then_some(latch));
        if r.bool()? {
            let mut s = ay::State::default();
            s.regs.copy_from_slice(r.take(16)?);
            s.address = r.u8()?;
            s.selected = r.bool()?;
            for c in &mut s.tone_count {
                *c = r.u16()?;
            }
            for h in &mut s.tone_high {
                *h = r.bool()?;
            }
            s.noise_count = r.u8()?;
            s.noise_half = r.bool()?;
            s.lfsr = r.u32()?;
            s.env_count = r.u32()?;
            s.env_step = r.u8()?;
            s.env_attack = r.u8()?;
            s.env_hold = r.bool()?;
            s.env_alternate = r.bool()?;
            s.env_holding = r.bool()?;
            s.port_a_pins = r.u8()?;
            s.next_tick = r.u32()?;
            s.tick_frac = r.u32()?;
            if let Some(chip) = &mut m.hw.ay {
                chip.set_state(&s);
            }
        }
        let ay_total = (r.i32()?, r.i32()?);
        let snd = &mut m.hw.sound;
        // The AY's next step makes up the difference between what it has put out, as it counts, and what
        // the restored buffer holds of it.
        snd.ay_offset = (
            snd.ay_raw.0.wrapping_sub(ay_total.0),
            snd.ay_raw.1.wrapping_sub(ay_total.1),
        );
        snd.ay_total = ay_total;
        let (bl, br) = (r.i32()?, r.i32()?);
        snd.beeper = audio::Level::new();
        snd.beeper.set_units(&mut audio::Discard, 0, bl, br);
        let (tl, tr) = (r.i32()?, r.i32()?);
        snd.tape = audio::Level::new();
        snd.tape.set_units(&mut audio::Discard, 0, tl, tr);
        let clock_hz = r.u32()?;
        let sample_rate = r.u32()?;
        let frac = r.u64()?;
        let frame_start = r.u64()?;
        let nd = r.u32()? as usize;
        if nd > 1 << 22 {
            return Err(StateError::Damaged("sound".into()));
        }
        let mut deltas = Vec::with_capacity(nd);
        for _ in 0..nd {
            deltas.push([r.i64()?, r.i64()?]);
        }
        let level = [r.i64()?, r.i64()?];
        let output = audio::Output {
            tone: tone_from(r.u8()?),
            dc_block: r.bool()?,
            volume: r.f32()?,
        };
        let nf = r.u32()? as usize;
        if nf > 64 {
            return Err(StateError::Damaged("filters".into()));
        }
        let mut filters = Vec::with_capacity(nf);
        for _ in 0..nf {
            filters.push([r.f64()?, r.f64()?, r.f64()?, r.f64()?]);
        }
        if clock_hz == 0 || sample_rate == 0 {
            return Err(StateError::Damaged("sound rates".into()));
        }
        let mut bs = audio::BufferState {
            clock_hz,
            sample_rate,
            frac,
            frame_start,
            deltas,
            level,
            output,
            filters,
        };
        if sample_rate != rate {
            // Made at another rate: the levels go on, what was buffered for the other rate does not.
            bs.deltas.clear();
            bs.frame_start = 0;
            snd.buffer.set_state(&bs);
            snd.buffer.set_sample_rate(rate);
        } else {
            snd.buffer.set_state(&bs);
        }
        let mut saved_deck = None;
        if r.bool()? {
            let hash = r.u64()?;
            let frame = r.u64()?;
            let n = r.u32()? as usize;
            // The deck counts the frames since its tape went in, which the machine's count (since it was
            // switched on, which puts the tape in afresh) can only exceed; the log runs in frame order up to
            // it. The replay costs a step a frame, so a damaged count must not stand.
            if n > 1 << 20 || frame > m.frames {
                return Err(StateError::Damaged("tape log".into()));
            }
            let mut log = Vec::with_capacity(n);
            for _ in 0..n {
                let (f, t, code, arg) = (r.u64()?, r.u32()?, r.u8()?, r.u32()?);
                let op = match code {
                    0 => Op::Play,
                    1 => Op::Stop,
                    2 => Op::Seek(arg),
                    3 => Op::TakeRomBlock,
                    _ => return Err(StateError::Damaged("tape op".into())),
                };
                if f > frame || log.last().is_some_and(|e: &LogEntry| e.frame > f) {
                    return Err(StateError::Damaged("tape log".into()));
                }
                log.push(LogEntry { frame: f, t, op });
            }
            let auto_started = r.bool()?;
            let idle = r.u32()?;
            let has_last = r.bool()?;
            let (lt, lb) = (r.u64()?, r.u8()?);
            let watch = (has_last.then_some((lt, lb)), r.u32()?, r.u32()?);
            saved_deck = Some((hash, frame, log, auto_started, idle, watch));
        }
        let n = r.u8()? as usize;
        if n > 0 {
            let b = r.take(n)?.to_vec();
            if m.hw.fdc.is_some() {
                m.hw.fdc = Some(
                    crate::fdc::Fdc::restore(&b)
                        .ok_or_else(|| StateError::Damaged("disk controller".into()))?,
                );
            }
        }
        // The tagged fields, if any (a state written before them has none).
        let mut heard_to = 0u32;
        while r.at < r.b.len() {
            match r.u8()? {
                TAG_END => break,
                TAG_HEARD => heard_to = r.u32()?.min(m.hw.timing.frame + TABLE_SLACK),
                TAG_ROMS => {
                    let n = r.u32()? as usize;
                    let len = model.roms().len() * BANK;
                    if n != len {
                        return Err(StateError::Damaged("ROMs".into()));
                    }
                    let roms = r.take(n)?.to_vec();
                    m.hw.mem.mem[ROM_BASE..ROM_BASE + len].copy_from_slice(&roms);
                }
                _ => return Err(StateError::Damaged("tag".into())),
            }
        }
        match (saved_deck, deck) {
            (Some((hash, frame, log, auto_started, idle, watch)), Some(mut d))
                if d.hash == hash =>
            {
                d.restore(
                    frame,
                    log,
                    heard_to,
                    model.clock_hz(),
                    m.hw.timing.frame,
                    matches!(model, Model::Spectrum16 | Model::Spectrum48),
                );
                d.auto_started = auto_started;
                d.idle_frames = idle;
                d.set_watch(watch);
                m.hw.deck = Some(d);
            }
            // Another tape, or a state with none: the tape stays in the deck, stopped at the block it
            // stands at.
            (_, Some(d)) => m.keep_tape(d),
            (_, None) => {}
        }
        m.hw.snow_on = options.snow && m.hw.timing.base.snow;
        let tone = options
            .tone
            .unwrap_or_else(|| crate::sound::default_tone(model));
        let want = audio::Output {
            tone,
            dc_block: true,
            volume: options.volume,
        };
        if m.hw.sound.buffer.output() != want {
            m.hw.sound.buffer.set_output(want);
        }
        m.update_hooks();
        *self = m;
        Ok(())
    }
}
