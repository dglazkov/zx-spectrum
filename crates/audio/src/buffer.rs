//! The buffer: steps in at T-states, samples out at the host's rate.

use crate::kernel::{self, INTERP_BITS, KERNEL_BITS, PHASES, TAPS};
use crate::output::{Output, Stage};

/// A level of 1.0, in the integer units steps are given in. Integers, so that steps that take a level away
/// and back return it exactly.
pub const UNIT: i32 = 1 << 20;

/// `level` (1.0 is `UNIT`) in units, rounded to the nearest.
pub fn units(level: f32) -> i32 {
    (level as f64 * UNIT as f64).round() as i32
}

/// What a sound source puts its steps into: the `Buffer`, or for a test, anything that records them.
pub trait Sink {
    /// Adds a step of `left` and `right` units, at T-state `t` of the CPU clock in the current frame.
    fn add_step(&mut self, t: u32, left: i32, right: i32);
}

/// A sink that drops every step: for running the machine with the sound off.
#[derive(Clone, Copy, Debug, Default)]
pub struct Discard;

impl Sink for Discard {
    fn add_step(&mut self, _t: u32, _left: i32, _right: i32) {}
}

/// A source that holds a level between changes, as the beeper and the tape heard through the speaker do: it
/// remembers the level it last set and adds only the difference. Plain data, so a machine can keep it in its
/// state.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Level {
    left: i32,
    right: i32,
}

impl Level {
    /// A source at level 0.
    pub const fn new() -> Level {
        Level { left: 0, right: 0 }
    }

    /// Sets the level on both sides to `level` (1.0 is full scale) at T-state `t`.
    pub fn set(&mut self, out: &mut impl Sink, t: u32, level: f32) {
        let u = units(level);
        self.set_units(out, t, u, u);
    }

    /// Sets the levels of the two sides separately.
    pub fn set_stereo(&mut self, out: &mut impl Sink, t: u32, left: f32, right: f32) {
        self.set_units(out, t, units(left), units(right));
    }

    /// Sets the levels in units: exact, for sources that keep their own tables.
    pub fn set_units(&mut self, out: &mut impl Sink, t: u32, left: i32, right: i32) {
        let (dl, dr) = (left - self.left, right - self.right);
        if dl != 0 || dr != 0 {
            out.add_step(t, dl, dr);
            self.left = left;
            self.right = right;
        }
    }

    /// The level now, in units, left and right.
    pub fn units(&self) -> (i32, i32) {
        (self.left, self.right)
    }
}

/// The scale from the integrated buffer (units times the kernel's unit) to a level of 1.0.
const TO_LEVEL: f64 = 1.0 / ((UNIT as i64) << KERNEL_BITS) as f64;

/// A band-limited sound buffer. Sources add steps at T-states of the CPU clock (`add_step`, or through a
/// `Level`); `end_frame` closes a video frame; `read_samples` hands out interleaved stereo f32 samples at the
/// host's rate, through the output stage.
///
/// Time is exact: T-state `t` of a frame falls at sample `(F + t) * rate / clock + 1/2`, where `F` is the
/// frame's start counted in T-states from when the buffer began, computed in integers so that over any number
/// of frames the samples handed out are the total time times the rate, rounded to the nearest (the half), and
/// never wander.
/// Steps come out `kernel::LATENCY` (14.5) samples later than they went in, the same for every step.
///
/// Read every frame: the buffer keeps at most a second of samples, dropping the oldest when it is not read.
#[derive(Clone, Debug)]
pub struct Buffer {
    clock: u64,
    rate: u64,
    /// Where T-state 0 of the current frame falls past sample `frame_start`, in units of 1/`clock` of a
    /// sample: always below `clock`.
    frac: u64,
    /// The sample T-state 0 of the current frame falls in; the samples before it are final.
    frame_start: usize,
    /// One past the last sample a step has touched.
    used: usize,
    /// Each sample's change of level (the band-limited steps' derivative), left and right, scaled by
    /// `UNIT << KERNEL_BITS`.
    deltas: Vec<[i64; 2]>,
    /// The running sum of what has been read: the level at the last sample out.
    level: [i64; 2],
    stage: Stage,
}

impl Buffer {
    /// A buffer for a CPU clock of `clock_hz` T-states a second, giving samples at `sample_rate`.
    pub fn new(clock_hz: u32, sample_rate: u32) -> Buffer {
        assert!(clock_hz > 0 && sample_rate > 0, "rates must be positive");
        let clock = clock_hz as u64;
        Buffer {
            clock,
            rate: sample_rate as u64,
            frac: clock / 2,
            frame_start: 0,
            used: 0,
            deltas: vec![[0; 2]; 4096],
            level: [0; 2],
            stage: Stage::new(Output::default(), sample_rate),
        }
    }

    /// The CPU clock, in T-states a second.
    pub fn clock_hz(&self) -> u32 {
        self.clock as u32
    }

    /// The output sample rate.
    pub fn sample_rate(&self) -> u32 {
        self.rate as u32
    }

    /// Changes the CPU clock (between frames). What is buffered stays, and where the next frame starts within a
    /// sample is kept to a T-state.
    pub fn set_clock(&mut self, clock_hz: u32) {
        assert!(clock_hz > 0, "the clock must be positive");
        let new = clock_hz as u64;
        self.frac = self.frac * new / self.clock;
        self.clock = new;
    }

    /// Changes the output sample rate. Samples not yet read are dropped (they were made for the old rate);
    /// the sources' levels are kept, so nothing thumps.
    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        assert!(sample_rate > 0, "the sample rate must be positive");
        self.settle();
        self.rate = sample_rate as u64;
        let (l, r) = self.raw_level();
        self.stage.rebuild(self.stage.output(), sample_rate, l, r);
    }

    /// How samples leave the buffer: the DC block, the tone, the volume.
    pub fn output(&self) -> Output {
        self.stage.output()
    }

    /// Changes how samples leave the buffer, from the next sample read.
    pub fn set_output(&mut self, output: Output) {
        let (l, r) = self.raw_level();
        self.stage.rebuild(output, self.rate as u32, l, r);
    }

    /// Drops what is buffered and not yet read, keeping the sources' levels: as after a reset or a rewind,
    /// when what was buffered no longer follows on from what comes next.
    pub fn clear(&mut self) {
        self.settle();
    }

    /// Adds a step of `left` and `right` units (`UNIT` is a level of 1.0) at T-state `t` of the current frame.
    /// `t` may lie past the frame's end; it is then in the next frame, where it belongs.
    pub fn add_step(&mut self, t: u32, left: i32, right: i32) {
        if left == 0 && right == 0 {
            return;
        }
        let pos = self.frac + t as u64 * self.rate;
        let whole = (pos / self.clock) as usize;
        let fine = (pos % self.clock) * ((PHASES as u64) << INTERP_BITS) / self.clock;
        let phase = (fine >> INTERP_BITS) as usize;
        let interp = (fine & ((1 << INTERP_BITS) - 1)) as i64;
        let start = self.frame_start + whole;
        self.reserve(start + TAPS);
        let table = kernel::table();
        let (k0, k1) = (&table[phase], &table[phase + 1]);
        let out = &mut self.deltas[start..start + TAPS];
        // Each delta splits between the two phases around it in proportion; the two parts add up to it
        // exactly, so the taps still sum to exactly the delta.
        let split = |d: i32| {
            let d = d as i64;
            let d2 = (d * interp) >> INTERP_BITS;
            (d - d2, d2)
        };
        if left == right {
            let (d1, d2) = split(left);
            for ((o, &a), &b) in out.iter_mut().zip(k0).zip(k1) {
                let v = a as i64 * d1 + b as i64 * d2;
                o[0] += v;
                o[1] += v;
            }
        } else {
            let (l1, l2) = split(left);
            let (r1, r2) = split(right);
            for ((o, &a), &b) in out.iter_mut().zip(k0).zip(k1) {
                o[0] += a as i64 * l1 + b as i64 * l2;
                o[1] += a as i64 * r1 + b as i64 * r2;
            }
        }
        self.used = self.used.max(start + TAPS);
    }

    /// How many samples `end_frame(frame_len)` would make ready now.
    pub fn samples_for(&self, frame_len: u32) -> usize {
        ((self.frac + frame_len as u64 * self.rate) / self.clock) as usize
    }

    /// Closes the frame: the samples up to T-state `frame_len` are ready, and T-state 0 of the next frame is
    /// what was `frame_len` in this one. Steps already added at or after `frame_len` stay where they are.
    pub fn end_frame(&mut self, frame_len: u32) {
        let pos = self.frac + frame_len as u64 * self.rate;
        self.frame_start += (pos / self.clock) as usize;
        self.frac = pos % self.clock;
        self.reserve(self.frame_start);
        self.used = self.used.max(self.frame_start);
        let limit = self.rate as usize;
        if self.frame_start > limit {
            self.drop_oldest(self.frame_start - limit);
        }
    }

    /// Stereo samples ready to read.
    pub fn samples_avail(&self) -> usize {
        self.frame_start
    }

    /// Reads up to `out.len() / 2` stereo samples, interleaved left then right, and returns how many it read.
    pub fn read_samples(&mut self, out: &mut [f32]) -> usize {
        let n = self.frame_start.min(out.len() / 2);
        let [mut l, mut r] = self.level;
        for (d, o) in self.deltas[..n].iter().zip(out.as_chunks_mut::<2>().0) {
            l += d[0];
            r += d[1];
            let (a, b) = self.stage.process(l as f64 * TO_LEVEL, r as f64 * TO_LEVEL);
            o[0] = a;
            o[1] = b;
        }
        self.level = [l, r];
        self.consume(n);
        n
    }

    /// Makes room for `len` samples.
    fn reserve(&mut self, len: usize) {
        if self.deltas.len() < len {
            self.deltas.resize(len.next_power_of_two(), [0; 2]);
        }
    }

    /// Removes the first `n` samples, whose deltas have been taken into `level`.
    fn consume(&mut self, n: usize) {
        if n == 0 {
            return;
        }
        self.deltas.copy_within(n..self.used, 0);
        self.deltas[self.used - n..self.used].fill([0; 2]);
        self.used -= n;
        self.frame_start -= n;
    }

    /// Takes the first `n` samples into the level without handing them out.
    fn drop_oldest(&mut self, n: usize) {
        for d in &self.deltas[..n] {
            self.level[0] += d[0];
            self.level[1] += d[1];
        }
        self.consume(n);
    }

    /// Takes everything buffered into the level at once, as if every step had already settled, and starts
    /// afresh at a sample boundary.
    fn settle(&mut self) {
        for d in &mut self.deltas[..self.used] {
            self.level[0] += d[0];
            self.level[1] += d[1];
            *d = [0; 2];
        }
        self.used = 0;
        self.frame_start = 0;
        self.frac = self.clock / 2;
    }

    /// The level after the last sample read, as a level of 1.0 = 1.0.
    fn raw_level(&self) -> (f64, f64) {
        (
            self.level[0] as f64 * TO_LEVEL,
            self.level[1] as f64 * TO_LEVEL,
        )
    }
}

impl Sink for Buffer {
    fn add_step(&mut self, t: u32, left: i32, right: i32) {
        Buffer::add_step(self, t, left, right);
    }
}
