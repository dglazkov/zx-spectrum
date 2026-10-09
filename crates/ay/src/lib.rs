//! The General Instrument AY-3-8912 programmable sound generator of the Spectrum 128, +2, +3 and Pentagon,
//! and optionally its Yamaha twin, the YM2149, to the register.
//!
//! Three square-wave tone generators, one noise generator and one envelope generator, mixed per channel and
//! turned into a level by a non-linear DAC; sixteen registers selected and written at T-states of the CPU's
//! clock. The chip runs on its own clock (1,773,450 Hz on the 128K family, half the CPU's; 1,750,000 Hz on the
//! Pentagon): every 8 of its cycles is one *tick*, on which every counter moves, and this crate places each tick
//! at its exact T-state of the CPU clock (16 T-states apart on both machines, by exact fractions otherwise). It
//! puts its channels' levels into an `audio::Sink` as steps, only when an output changes, with the stereo
//! placement asked for (`Mix`).
//!
//! The behaviour, register by register, follows General Instrument's data manual (1979) where it speaks, and
//! where it does not, the measurements and die studies behind MAME's ay8910.cpp and Hatari's YM2149: docs/audio.md
//! says which, for each.
//!
//! ```
//! use ay::{Ay, Chip};
//!
//! let mut psg = Ay::new(Chip::Ay8912, 1_773_450, 3_546_900);
//! let mut sound = audio::Buffer::new(3_546_900, 48_000);
//! for (register, value) in [(0, 0xFE), (1, 0x00), (7, 0b0011_1110), (8, 15)] {
//!     psg.select(register); // OUT (0xFFFD), register
//!     psg.write(100, value, &mut sound); // OUT (0xBFFD), value, at T-state 100
//! }
//! psg.end_frame(70_908, &mut sound); // runs the chip to the frame's end, before the buffer closes it
//! sound.end_frame(70_908);
//! ```

pub mod dac;

use audio::{Sink, UNIT};

/// Which chip.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Chip {
    /// The AY-3-8912: 16-step envelope, unused register bits read back as 0, one I/O port.
    #[default]
    Ay8912,
    /// The YM2149: a 32-step envelope moving twice as fast, 32 DAC levels, registers read back as written.
    Ym2149,
}

impl Chip {
    /// The envelope's highest step: 15 or 31.
    fn env_top(self) -> u8 {
        match self {
            Chip::Ay8912 => 15,
            Chip::Ym2149 => 31,
        }
    }
}

/// Where the three channels sit between the speakers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Stereo {
    /// All three in the middle, added.
    #[default]
    Mono,
    /// All three in the middle as the Spectrum 128 has them, their outputs joined on one track, which
    /// compresses their sum: one channel at full volume is 0.58 of all three, not a third (`dac::joined`). On the
    /// YM2149, for which there is no such measurement, the same as `Mono`.
    Joined,
    /// A left, B centre, C right: the usual stereo arrangement, as on many Pentagons.
    Abc,
    /// A left, C centre, B right.
    Acb,
}

/// How the channels are mixed into the two sides.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mix {
    /// The placement.
    pub stereo: Stereo,
    /// How far the side channels are moved out: 0.0 is mono, 1.0 entirely to their side.
    pub separation: f32,
    /// The level, on either side, of all three channels at full volume (in `audio` levels, 1.0 being full
    /// scale). Added, each channel is a third of it; the centre channel gives each side a third, a side channel at
    /// full separation two thirds to its own side and none to the other.
    pub gain: f32,
}

impl Default for Mix {
    fn default() -> Self {
        Mix {
            stereo: Stereo::Mono,
            separation: 1.0,
            gain: 1.0,
        }
    }
}

/// The bits of each register that exist on the AY-3-8912; the others read back as 0.
pub const REGISTER_MASKS: [u8; 16] = [
    0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF,
];

/// The chip's whole state at an instant: plain data, for snapshots and rewinding. What it does not hold is the
/// mix and what has been put into the sound buffer, which belong to the listener: after `set_state` the chip
/// moves its outputs to the restored ones at its next tick.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct State {
    /// The registers, as stored (the AY's unused bits already 0).
    pub regs: [u8; 16],
    /// The latched register address.
    pub address: u8,
    /// Whether a valid address is latched: the chip ignores the data port and leaves the bus alone until one is.
    pub selected: bool,
    /// The tone counters.
    pub tone_count: [u16; 3],
    /// The tone outputs.
    pub tone_high: [bool; 3],
    /// The noise period counter.
    pub noise_count: u8,
    /// The noise prescaler: the shift register moves every second time the counter comes round.
    pub noise_half: bool,
    /// The 17-bit noise shift register; its bit 0 is the noise output.
    pub lfsr: u32,
    /// The envelope period counter.
    pub env_count: u32,
    /// The envelope's step, counting down from the top (15 or 31) to 0 in each cycle.
    pub env_step: u8,
    /// 0 or the top step: XORed with `env_step` it gives the envelope's volume, so it says whether the cycle
    /// counts up or down.
    pub env_attack: u8,
    /// The shape's hold: after this cycle, stop.
    pub env_hold: bool,
    /// The shape's alternate: after each cycle, turn round.
    pub env_alternate: bool,
    /// Whether the envelope has stopped.
    pub env_holding: bool,
    /// What the pins of I/O port A read as, from outside.
    pub port_a_pins: u8,
    /// The T-state, in the current frame, of the next tick.
    pub next_tick: u32,
    /// The fraction of a T-state past `next_tick` at which it falls, over the chip's clock.
    pub tick_frac: u32,
}

/// The sound chip.
#[derive(Clone, Debug)]
pub struct Ay {
    chip: Chip,
    s: State,
    /// T-states a tick: `tick_whole` and `tick_rem` over `ay_clock`.
    tick_whole: u32,
    tick_rem: u32,
    ay_clock: u32,
    cpu_clock: u32,
    dac: Vec<f64>,
    mix: Mix,
    /// Each channel's contribution, left and right, in units, for each DAC level.
    table: [Vec<(i32, i32)>; 3],
    /// With joined outputs, the level of each combination of the three channels' DAC levels instead, in units.
    joined: Option<Vec<i32>>,
    /// The channels' DAC levels the sink has last been given, and the level, left and right, they stand for.
    emitted_level: [u8; 3],
    emitted: (i32, i32),
}

/// A DAC level no channel can be at: forces the next tick to recompute every channel's contribution.
const STALE: u8 = 0xFF;

impl Ay {
    /// A chip clocked at `ay_clock_hz`, its writes timed in T-states of a CPU clocked at `cpu_clock_hz`. It
    /// starts as after a reset.
    pub fn new(chip: Chip, ay_clock_hz: u32, cpu_clock_hz: u32) -> Ay {
        let dac = match chip {
            Chip::Ay8912 => dac::normalise(&dac::AY_8912_VOLTS),
            Chip::Ym2149 => dac::normalise(&dac::YM_2149_LEVELS),
        };
        let mut ay = Ay {
            chip,
            s: State {
                port_a_pins: 0xFF,
                ..State::default()
            },
            tick_whole: 0,
            tick_rem: 0,
            ay_clock: 1,
            cpu_clock: 1,
            dac,
            mix: Mix::default(),
            table: [Vec::new(), Vec::new(), Vec::new()],
            joined: None,
            emitted_level: [0; 3],
            emitted: (0, 0),
        };
        ay.set_clocks(ay_clock_hz, cpu_clock_hz);
        ay.set_mix(Mix::default());
        ay.reset();
        ay
    }

    /// Which chip this is.
    pub fn chip(&self) -> Chip {
        self.chip
    }

    /// As the /RESET pin leaves it: every register 0, no address latched, the counters at rest. The ticks keep
    /// their place in time, and the port's pins what they read. The silence is heard from the next tick.
    pub fn reset(&mut self) {
        let old = self.s;
        self.s = State {
            lfsr: 1,
            port_a_pins: old.port_a_pins,
            next_tick: old.next_tick,
            tick_frac: old.tick_frac,
            ..State::default()
        };
        self.restart_envelope();
    }

    /// Sets the chip's clock and the CPU's (between frames).
    pub fn set_clocks(&mut self, ay_clock_hz: u32, cpu_clock_hz: u32) {
        assert!(
            ay_clock_hz > 0 && cpu_clock_hz > 0,
            "clocks must be positive"
        );
        let per_tick = 8 * cpu_clock_hz as u64;
        self.tick_whole = (per_tick / ay_clock_hz as u64) as u32;
        self.tick_rem = (per_tick % ay_clock_hz as u64) as u32;
        // Keep the fraction of a T-state the next tick falls at, on the new clock's scale.
        self.s.tick_frac =
            (self.s.tick_frac as u64 * ay_clock_hz as u64 / self.ay_clock as u64) as u32;
        self.ay_clock = ay_clock_hz;
        self.cpu_clock = cpu_clock_hz;
    }

    /// The chip's clock and the CPU's, in Hz.
    pub fn clocks(&self) -> (u32, u32) {
        (self.ay_clock, self.cpu_clock)
    }

    /// How the channels are mixed.
    pub fn mix(&self) -> Mix {
        self.mix
    }

    /// Changes how the channels are mixed; the sound moves to the new mix at the next tick.
    pub fn set_mix(&mut self, mix: Mix) {
        self.mix = mix;
        let s = mix.separation.clamp(0.0, 1.0) as f64;
        let pan = match mix.stereo {
            Stereo::Mono | Stereo::Joined => [0.0, 0.0, 0.0],
            Stereo::Abc => [-s, 0.0, s],
            Stereo::Acb => [-s, s, 0.0],
        };
        let gain = mix.gain as f64 * UNIT as f64 / 3.0;
        for (ch, &p) in pan.iter().enumerate() {
            let (wl, wr) = ((1.0 - p) * gain, (1.0 + p) * gain);
            self.table[ch] = self
                .dac
                .iter()
                .map(|&v| ((v * wl).round() as i32, (v * wr).round() as i32))
                .collect();
        }
        self.joined = (mix.stereo == Stereo::Joined && self.chip == Chip::Ay8912).then(|| {
            let full = mix.gain as f64 * UNIT as f64;
            dac::joined(&dac::AY_8912_VOLTS, dac::JOINED_SUPPLY_VOLTS)
                .iter()
                .map(|v| (v * full).round() as i32)
                .collect()
        });
        self.emitted_level = [STALE; 3];
    }

    /// Latches a register address (an OUT to 0xFFFD on the 128K). The high four bits must be 0, the chip's
    /// mask-programmed code; any other value leaves it unselected, ignoring writes and not driving the bus.
    pub fn select(&mut self, value: u8) {
        self.s.selected = value >> 4 == 0;
        if self.s.selected {
            self.s.address = value & 0x0F;
        }
    }

    /// The latched register address.
    pub fn address(&self) -> u8 {
        self.s.address
    }

    /// Writes `value` to the latched register at T-state `t` (an OUT to 0xBFFD on the 128K): the chip first
    /// runs up to `t`, then takes the write, and a change it makes to a channel's level (its volume, the mixer,
    /// an envelope restarted) is heard from `t`.
    pub fn write<S: Sink>(&mut self, t: u32, value: u8, out: &mut S) {
        if !self.s.selected {
            return;
        }
        self.run(t, out);
        self.set_register(self.s.address, value);
        self.emit(t, out);
    }

    /// Reads the latched register (an IN from 0xFFFD on the 128K), or `None` when no valid address is latched
    /// and the chip leaves the bus alone. Port A reads its pins, through what the chip drives on them when the
    /// port is an output; the 8912 has no port B pins, so register 15 reads 0xFF as an input and what was
    /// written as an output.
    pub fn read(&self) -> Option<u8> {
        if !self.s.selected {
            return None;
        }
        let r = &self.s.regs;
        Some(match self.s.address {
            14 if r[7] & 0x40 != 0 => r[14] & self.s.port_a_pins,
            14 => self.s.port_a_pins,
            15 if r[7] & 0x80 != 0 => r[15],
            15 => 0xFF,
            a => r[a as usize],
        })
    }

    /// A register as stored, whatever is latched: for snapshots and the debugger.
    pub fn register(&self, r: u8) -> u8 {
        self.s.regs[(r & 0x0F) as usize]
    }

    /// All sixteen registers as stored.
    pub fn registers(&self) -> [u8; 16] {
        self.s.regs
    }

    /// Stores a register now, without running the chip or touching the sink: for loading a snapshot. A write
    /// to register 13 restarts the envelope, as on the chip. What it changes is heard from the next tick.
    pub fn set_register(&mut self, r: u8, value: u8) {
        let r = (r & 0x0F) as usize;
        self.s.regs[r] = match self.chip {
            Chip::Ay8912 => value & REGISTER_MASKS[r],
            Chip::Ym2149 => value,
        };
        if r == 13 {
            self.restart_envelope();
        }
    }

    /// Sets what the pins of I/O port A read as from outside (on the 128K: the keypad, RS232 and MIDI lines).
    /// Pins nothing drives read high.
    pub fn set_port_a_input(&mut self, pins: u8) {
        self.s.port_a_pins = pins;
    }

    /// What the chip drives on port A, when the port is an output.
    pub fn port_a_output(&self) -> Option<u8> {
        (self.s.regs[7] & 0x40 != 0).then_some(self.s.regs[14])
    }

    /// Each channel's DAC level now: 0 to 15 (0 to 31 on the YM2149).
    pub fn outputs(&self) -> [u8; 3] {
        [0, 1, 2].map(|ch| self.level(ch))
    }

    /// The chip's state.
    pub fn state(&self) -> State {
        self.s
    }

    /// Puts the chip in a state saved before (by `state`). Its outputs move to the restored ones at its next
    /// tick, as differences from what it last put into the sink, so the sound carries on without a jump.
    ///
    /// A state this chip could not be in (one saved from the other chip, whose envelope has twice the steps, or a
    /// damaged one) is kept within what it can hold: the registers through this chip's masks, the address to four
    /// bits, the envelope's step to its steps, the counters to their widths (a count at or past its period comes
    /// round at the next tick) and the shift register to its 17 bits.
    pub fn set_state(&mut self, state: &State) {
        self.s = *state;
        if self.chip == Chip::Ay8912 {
            for (r, mask) in self.s.regs.iter_mut().zip(REGISTER_MASKS) {
                *r &= mask;
            }
        }
        self.s.address &= 0x0F;
        let top = self.chip.env_top();
        self.s.env_step &= top;
        self.s.env_attack &= top;
        for count in &mut self.s.tone_count {
            *count = (*count).min(0x0FFF);
        }
        self.s.noise_count = self.s.noise_count.min(0x1F);
        self.s.env_count = self.s.env_count.min(0x1_FFFF);
        self.s.lfsr &= 0x1_FFFF;
    }

    /// Runs the chip up to T-state `t` of the current frame: every tick before `t` happens, and every change of
    /// a channel's level goes into `out` at the T-state of its tick.
    pub fn run<S: Sink>(&mut self, t: u32, out: &mut S) {
        // A change made outside a write (a new mix, a restored state, a register stored for a snapshot, a reset)
        // has not been put out yet: it is heard from the next tick, which is then taken on its own.
        let mut changed = self.levels() != self.emitted_level;
        while self.s.next_tick < t {
            // The ticks that certainly fall before t, up to the next one on which a generator that can be
            // heard moves: all of them at once, since nothing heard changes before the last.
            let per_tick = 8 * self.cpu_clock as u64;
            let room = ((t - self.s.next_tick - 1) as u64 * self.ay_clock as u64 / per_tick).max(1);
            let n = if changed {
                1
            } else {
                room.min(self.ticks_to_heard_event() as u64) as u32
            };
            changed = false;
            self.advance(n);
            self.advance_time(n - 1);
            self.emit(self.s.next_tick, out);
            self.advance_time(1);
        }
    }

    /// Runs the chip to the frame's end and starts the next frame's T-states from 0. Call it before the sound
    /// buffer's `end_frame`, so that every change in the frame is in the buffer when it closes the frame.
    pub fn end_frame<S: Sink>(&mut self, frame_len: u32, out: &mut S) {
        self.run(frame_len, out);
        self.s.next_tick -= frame_len;
    }

    // --- The generators ---

    fn tone_period(&self, ch: usize) -> u32 {
        let r = &self.s.regs;
        (r[2 * ch] as u32 | ((r[2 * ch + 1] as u32 & 0x0F) << 8)).max(1)
    }

    fn noise_period(&self) -> u32 {
        (self.s.regs[6] as u32 & 0x1F).max(1)
    }

    /// Ticks from one envelope step to the next: the AY steps every 16 × EP of its clocks, two ticks a period,
    /// and a period of 0 steps every tick, twice as fast as 1 (MAME's finding); the YM2149 steps twice as often
    /// over twice the steps, one tick a period, 0 as 1 (Hatari's, measured).
    fn env_period(&self) -> u32 {
        let ep = self.s.regs[11] as u32 | (self.s.regs[12] as u32) << 8;
        match self.chip {
            Chip::Ay8912 => (2 * ep).max(1),
            Chip::Ym2149 => ep.max(1),
        }
    }

    /// Whether channel `ch` can make a sound at all: its volume is the envelope's, or a fixed one above 0.
    fn audible(&self, ch: usize) -> bool {
        self.s.regs[8 + ch] & 0x1F != 0
    }

    /// Ticks until the next one on which a generator moves that some channel's level depends on (at least 1).
    /// The others move too, but nothing can be heard of it.
    fn ticks_to_heard_event(&self) -> u32 {
        let r = &self.s.regs;
        let mut n = u32::MAX;
        let mut noise_heard = false;
        let mut env_heard = false;
        for ch in 0..3 {
            if !self.audible(ch) {
                continue;
            }
            if r[7] & (1 << ch) == 0 {
                n = n.min(
                    self.tone_period(ch)
                        .saturating_sub(self.s.tone_count[ch] as u32),
                );
            }
            noise_heard |= r[7] & (8 << ch) == 0;
            env_heard |= r[8 + ch] & 0x10 != 0;
        }
        if noise_heard {
            n = n.min(
                self.noise_period()
                    .saturating_sub(self.s.noise_count as u32),
            );
        }
        if env_heard && !self.s.env_holding {
            n = n.min(self.env_period().saturating_sub(self.s.env_count));
        }
        n.max(1)
    }

    /// Moves the time of the next tick on by `n` ticks.
    fn advance_time(&mut self, n: u32) {
        let frac = self.s.tick_frac as u64 + n as u64 * self.tick_rem as u64;
        self.s.next_tick += n * self.tick_whole + (frac / self.ay_clock as u64) as u32;
        self.s.tick_frac = (frac % self.ay_clock as u64) as u32;
    }

    /// `n` ticks. On each, every counter counts up, and one that has reached its period (or passed it, if the
    /// period was just lowered) starts again from 0 and moves its generator on: a tone turns, the noise
    /// prescaler turns (the shift register moving every second time), the envelope steps.
    fn advance(&mut self, n: u32) {
        if n == 1 {
            return self.tick();
        }
        for ch in 0..3 {
            let (turns, count) = come_round(self.s.tone_count[ch] as u32, self.tone_period(ch), n);
            self.s.tone_count[ch] = count as u16;
            self.s.tone_high[ch] ^= turns % 2 == 1;
        }
        let (turns, count) = come_round(self.s.noise_count as u32, self.noise_period(), n);
        self.s.noise_count = count as u8;
        let shifts = (turns + self.s.noise_half as u32) / 2;
        self.s.noise_half ^= turns % 2 == 1;
        for _ in 0..shifts {
            self.shift_noise();
        }
        if !self.s.env_holding {
            let (steps, count) = come_round(self.s.env_count, self.env_period(), n);
            self.s.env_count = count;
            for _ in 0..steps {
                self.step_envelope();
                if self.s.env_holding {
                    // It stopped on that step, its counter at 0, and counts no more.
                    self.s.env_count = 0;
                    break;
                }
            }
        }
    }

    /// One tick of `advance`, the common case when everything is heard, done the plain way.
    fn tick(&mut self) {
        for ch in 0..3 {
            self.s.tone_count[ch] += 1;
            if self.s.tone_count[ch] as u32 >= self.tone_period(ch) {
                self.s.tone_count[ch] = 0;
                self.s.tone_high[ch] = !self.s.tone_high[ch];
            }
        }
        self.s.noise_count += 1;
        if self.s.noise_count as u32 >= self.noise_period() {
            self.s.noise_count = 0;
            self.s.noise_half = !self.s.noise_half;
            if !self.s.noise_half {
                self.shift_noise();
            }
        }
        if !self.s.env_holding {
            self.s.env_count += 1;
            if self.s.env_count >= self.env_period() {
                self.s.env_count = 0;
                self.step_envelope();
            }
        }
    }

    /// One shift of the noise register. x^17 + x^14 + 1: the new bit 16 is bit 0 XOR bit 3 (MAME, verified on
    /// the AY-3-8910 and the YM2149).
    fn shift_noise(&mut self) {
        let l = self.s.lfsr;
        self.s.lfsr = (l >> 1) | (((l ^ (l >> 3)) & 1) << 16);
    }

    /// Register 13 written: the envelope starts its first cycle at its top step, counting down or (with Attack)
    /// up, its period counter from 0. A shape without Continue holds after one cycle, at 0: it is the shape with
    /// Continue and Hold, alternating exactly when it attacks (so that an attack falls back to 0).
    fn restart_envelope(&mut self) {
        let shape = self.s.regs[13];
        let top = self.chip.env_top();
        let attack = shape & 0x04 != 0;
        self.s.env_attack = if attack { top } else { 0 };
        if shape & 0x08 == 0 {
            self.s.env_hold = true;
            self.s.env_alternate = attack;
        } else {
            self.s.env_hold = shape & 0x01 != 0;
            self.s.env_alternate = shape & 0x02 != 0;
        }
        self.s.env_step = top;
        self.s.env_holding = false;
        self.s.env_count = 0;
    }

    /// One step of the envelope; at the end of a cycle, Hold stops it (Alternate turning it round first, so it
    /// stops where the cycle began) and otherwise it starts again, Alternate turning it round.
    fn step_envelope(&mut self) {
        let top = self.chip.env_top();
        if self.s.env_step > 0 {
            self.s.env_step -= 1;
            return;
        }
        if self.s.env_alternate {
            self.s.env_attack ^= top;
        }
        if self.s.env_hold {
            self.s.env_holding = true;
        } else {
            self.s.env_step = top;
        }
    }

    // --- The mixer and the DAC ---

    /// A channel's DAC level: its volume (fixed, or the envelope's with bit 4) when its mixer lets it through,
    /// else 0. The mixer's enables are active low, and a channel with both tone and noise disabled passes its
    /// volume constantly (the way samples are played on the AY).
    fn level(&self, ch: usize) -> u8 {
        let r = &self.s.regs;
        let tone = self.s.tone_high[ch] || r[7] & (1 << ch) != 0;
        let noise = self.s.lfsr & 1 != 0 || r[7] & (8 << ch) != 0;
        if !(tone && noise) {
            return 0;
        }
        let volume = r[8 + ch];
        let env = self.s.env_step ^ self.s.env_attack;
        match (self.chip, volume & 0x10 != 0) {
            (Chip::Ay8912, true) => env,
            (Chip::Ay8912, false) => volume & 0x0F,
            (Chip::Ym2149, true) => env,
            // The YM's 4-bit volumes sit on its odd envelope levels; 0 stays silent.
            (Chip::Ym2149, false) => match volume & 0x0F {
                0 => 0,
                v => 2 * v + 1,
            },
        }
    }

    /// The three channels' DAC levels now.
    fn levels(&self) -> [u8; 3] {
        [self.level(0), self.level(1), self.level(2)]
    }

    /// Puts any change of the channels' levels into `out` at T-state `t`.
    fn emit<S: Sink>(&mut self, t: u32, out: &mut S) {
        let levels = self.levels();
        if levels == self.emitted_level {
            return;
        }
        let now = match &self.joined {
            Some(table) => {
                let n = self.dac.len();
                let v =
                    table[levels[0] as usize + n * levels[1] as usize + n * n * levels[2] as usize];
                (v, v)
            }
            None => (0..3).fold((0, 0), |(l, r), ch| {
                let (cl, cr) = self.table[ch][levels[ch] as usize];
                (l + cl, r + cr)
            }),
        };
        let (dl, dr) = (now.0 - self.emitted.0, now.1 - self.emitted.1);
        if dl != 0 || dr != 0 {
            out.add_step(t, dl, dr);
        }
        self.emitted = now;
        self.emitted_level = levels;
    }
}

/// A counter at `count` that counts up once a tick and starts again from 0 on the tick it reaches `period`
/// (or at once, if it is already past it): how many times it comes round in `n` ticks, and where it ends.
fn come_round(count: u32, period: u32, n: u32) -> (u32, u32) {
    let first = if count >= period { 1 } else { period - count };
    if n < first {
        return (0, count + n);
    }
    let rest = n - first;
    (1 + rest / period, rest % period)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default, PartialEq, Debug)]
    struct Record(Vec<(u32, i32, i32)>);

    impl Sink for Record {
        fn add_step(&mut self, t: u32, l: i32, r: i32) {
            self.0.push((t, l, r));
        }
    }

    impl Ay {
        /// `run` the plain way: every tick on its own, its levels put out after it.
        fn run_one_by_one<S: Sink>(&mut self, t: u32, out: &mut S) {
            while self.s.next_tick < t {
                self.advance(1);
                self.emit(self.s.next_tick, out);
                self.advance_time(1);
            }
        }
    }

    #[test]
    fn come_round_counts_like_the_counter() {
        for period in 1..12 {
            for start in 0..15 {
                for n in 0..40 {
                    let (mut count, mut turns) = (start, 0);
                    for _ in 0..n {
                        count += 1;
                        if count >= period {
                            count = 0;
                            turns += 1;
                        }
                    }
                    assert_eq!(
                        come_round(start, period, n),
                        (turns, count),
                        "{start} {period} {n}"
                    );
                }
            }
        }
    }

    #[test]
    fn taking_unheard_ticks_at_once_changes_nothing() {
        // Random programs of register writes at random T-states, run both ways: every step, and the whole
        // state at each frame's end, the same.
        for chip in [Chip::Ay8912, Chip::Ym2149] {
            for (ay_clock, cpu) in [(1_773_450, 3_546_900), (2_000_000, 3_546_900)] {
                let mut seed = 0x2545_F491u32;
                let mut rand = move |m: u32| {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    seed % m
                };
                let mut fast = Ay::new(chip, ay_clock, cpu);
                let mut slow = Ay::new(chip, ay_clock, cpu);
                let (mut a, mut b) = (Record::default(), Record::default());
                for _ in 0..200 {
                    let mut t = 0;
                    for _ in 0..rand(12) {
                        t += rand(9_000);
                        let r = rand(14) as u8;
                        let v = match r {
                            0 | 2 | 4 => rand(8) as u8,
                            1 | 3 | 5 | 12 => rand(2) as u8,
                            6 => rand(4) as u8,
                            8..=10 => [0, 0, 5, 15, 0x10][rand(5) as usize],
                            11 => rand(6) as u8,
                            _ => rand(256) as u8,
                        };
                        fast.run(t, &mut a);
                        slow.run_one_by_one(t, &mut b);
                        for ay in [&mut fast, &mut slow] {
                            ay.select(r);
                            ay.set_register(r, v);
                        }
                        fast.emit(t, &mut a);
                        slow.emit(t, &mut b);
                    }
                    fast.end_frame(70_908, &mut a);
                    slow.run_one_by_one(70_908, &mut b);
                    slow.s.next_tick -= 70_908;
                    assert_eq!(fast.state(), slow.state());
                    assert_eq!(a, b);
                }
                assert!(
                    a.0.len() > 10_000,
                    "the programs made sound: {} steps",
                    a.0.len()
                );
            }
        }
    }

    #[test]
    fn changes_outside_a_write_are_taken_in_bulk_as_tick_by_tick() {
        // Random programs again, with changes that come with no T-state among the writes: a register stored for a
        // snapshot, a new mix, a state restored, a reset. Run in bulk and tick by tick, every step and the state at
        // each frame's end the same.
        for chip in [Chip::Ay8912, Chip::Ym2149] {
            let mut seed = 0x1357_9BDFu32;
            let mut rand = move |m: u32| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                seed % m
            };
            let mut fast = Ay::new(chip, 1_773_450, 3_546_900);
            let mut slow = Ay::new(chip, 1_773_450, 3_546_900);
            let (mut a, mut b) = (Record::default(), Record::default());
            let mut saved = fast.state();
            let mut untimed = 0;
            for _ in 0..300 {
                let mut t = 0;
                for _ in 0..rand(8) {
                    t += rand(12_000);
                    fast.run(t, &mut a);
                    slow.run_one_by_one(t, &mut b);
                    let r = rand(14) as u8;
                    let v = match r {
                        8..=10 => [0, 3, 15, 0x10][rand(4) as usize],
                        7 => [0x3F, 0x38, 0x3E, 0x36, 0x00][rand(5) as usize],
                        _ => rand(256) as u8,
                    };
                    let what = rand(10);
                    let stereo = [Stereo::Mono, Stereo::Joined, Stereo::Abc][rand(3) as usize];
                    for ay in [&mut fast, &mut slow] {
                        match what {
                            0..=4 => {
                                ay.select(r);
                                ay.set_register(r, v);
                            }
                            5 => ay.set_mix(Mix {
                                stereo,
                                separation: 1.0,
                                gain: 1.0,
                            }),
                            6 => ay.set_state(&saved),
                            7 => ay.reset(),
                            _ => {}
                        }
                    }
                    untimed += (what <= 7) as u32;
                    if what == 8 {
                        saved = fast.state();
                    }
                    if what == 9 {
                        // A timed write, put out at its T-state.
                        fast.select(r);
                        slow.select(r);
                        fast.write(t, v, &mut a);
                        slow.set_register(r, v);
                        slow.emit(t, &mut b);
                    }
                }
                fast.end_frame(70_908, &mut a);
                slow.run_one_by_one(70_908, &mut b);
                slow.s.next_tick -= 70_908;
                assert_eq!(fast.state(), slow.state());
                assert_eq!(a, b);
            }
            assert!(
                untimed > 500 && a.0.len() > 1_000,
                "{untimed} {}",
                a.0.len()
            );
        }
    }
}
