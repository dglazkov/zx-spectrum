//! The output stage: what happens to the level between the machine's sound pin and the listener's ear.
//!
//! Three things, in order, on each side:
//!
//! 1. The DC block. The Spectrum's sound reaches anything outside it through a capacitor: on the 128K both
//!    sources enter the TV sound modulator through 1 µF (R112 68 kΩ / C123 from the ULA, R132 39 kΩ / C127 from
//!    the AY: corners of 2.3 and 4.1 Hz). A first-order high-pass at `DC_CORNER_HZ` stands for that, so that a
//!    beeper left high, or the AY's offset, settles to silence instead of sitting as a DC offset.
//! 2. Optionally, a model of what the sound was heard through (`Tone`): the 48K's own little speaker, or a
//!    television's sound. docs/audio.md says what each is built from and how sure that is.
//! 3. The volume, times `HEADROOM`, then a clamp to ±1 that the headroom keeps from ever acting. By
//!    convention the sources' levels together stay within a span of 1.0 on each side (the beeper and the AY
//!    share it), and for every such input, whatever it does, every tone stays inside ±0.98.

/// The DC block's corner, in Hz.
pub const DC_CORNER_HZ: f64 = 4.0;

/// The gain from level units to output samples. No input within a span of 1.0 can drive the output, before
/// this gain, beyond 1.40 with the flat tone or 1.06 with the others: half the total variation of the step
/// response, which the tests measure (a band-limited step overshoots by 8.7%, and a pulse train timed against
/// its ripples adds them up). Square waves reach 1.15. This keeps even the worst inside ±0.98.
pub const HEADROOM: f64 = 0.70;

/// What the sound is heard through, after the DC block.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tone {
    /// Nothing more: the signal as it leaves the machine, as through a line out to a hi-fi.
    #[default]
    Flat,
    /// The 16K/48K's internal speaker: a small 40 Ω speaker in the case, which gives little below a few hundred
    /// hertz and little above a few kilohertz. A model, not a measurement: see docs/audio.md.
    Speaker,
    /// A television's sound, as the 128K, +2 and +3 are heard: FM sound without pre-emphasis, so the set's
    /// 50 µs de-emphasis rolls off the treble above 3.2 kHz, through a TV's speaker with little bass.
    Television,
}

/// How samples leave the buffer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Output {
    /// What the sound is heard through.
    pub tone: Tone,
    /// Whether the DC block is on. Off is for tests that look at the raw level.
    pub dc_block: bool,
    /// The volume: 1.0 is full, 0.0 silence. Above 1.0 the headroom is spent and loud passages clip.
    pub volume: f32,
}

impl Default for Output {
    fn default() -> Self {
        Output {
            tone: Tone::Flat,
            dc_block: true,
            volume: 1.0,
        }
    }
}

/// One second-order section, in direct form I (f64, which keeps low corners at high sample rates accurate).
#[derive(Clone, Copy, Debug, Default)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    /// From the coefficients of H(z) = (b0 + b1/z + b2/z²) / (a0 + a1/z + a2/z²).
    fn new(b: [f64; 3], a: [f64; 3]) -> Biquad {
        Biquad {
            b0: b[0] / a[0],
            b1: b[1] / a[0],
            b2: b[2] / a[0],
            a1: a[1] / a[0],
            a2: a[2] / a[0],
            ..Biquad::default()
        }
    }

    /// A second-order low-pass at `fc` with quality `q` (R. Bristow-Johnson's Audio EQ Cookbook).
    fn low_pass(fc: f64, q: f64, rate: f64) -> Biquad {
        let w = 2.0 * std::f64::consts::PI * fc / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        Biquad::new(
            [(1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0],
            [1.0 + alpha, -2.0 * c, 1.0 - alpha],
        )
    }

    /// A second-order high-pass at `fc` with quality `q` (the same cookbook).
    fn high_pass(fc: f64, q: f64, rate: f64) -> Biquad {
        let w = 2.0 * std::f64::consts::PI * fc / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        Biquad::new(
            [(1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0],
            [1.0 + alpha, -2.0 * c, 1.0 - alpha],
        )
    }

    /// A first-order low-pass at `fc` (bilinear transform, pre-warped), as a biquad with no second-order terms.
    fn low_pass_1(fc: f64, rate: f64) -> Biquad {
        let k = (std::f64::consts::PI * fc / rate).tan();
        Biquad::new([k, k, 0.0], [1.0 + k, k - 1.0, 0.0])
    }

    /// A first-order high-pass at `fc` (the same transform).
    fn high_pass_1(fc: f64, rate: f64) -> Biquad {
        let k = (std::f64::consts::PI * fc / rate).tan();
        Biquad::new([1.0, -1.0, 0.0], [1.0 + k, k - 1.0, 0.0])
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    /// Sets the state as if the input had been `x` for ever: no thump when a stage starts on a level.
    fn settle(&mut self, x: f64) {
        let dc_gain = (self.b0 + self.b1 + self.b2) / (1.0 + self.a1 + self.a2);
        let y = x * dc_gain;
        self.x1 = x;
        self.x2 = x;
        self.y1 = y;
        self.y2 = y;
    }
}

/// The filters for one side.
#[derive(Clone, Debug, Default)]
struct Chain {
    sections: Vec<Biquad>,
}

impl Chain {
    fn new(output: &Output, rate: f64) -> Chain {
        let q = std::f64::consts::FRAC_1_SQRT_2;
        let mut sections = Vec::new();
        if output.dc_block {
            sections.push(Biquad::high_pass_1(DC_CORNER_HZ, rate));
        }
        // Corners above what the sample rate can carry are left out rather than folded.
        let below_nyquist = |f: f64| f < rate * 0.45;
        match output.tone {
            Tone::Flat => {}
            Tone::Speaker => {
                sections.push(Biquad::high_pass(SPEAKER_BASS_HZ, q, rate));
                if below_nyquist(SPEAKER_TREBLE_HZ) {
                    sections.push(Biquad::low_pass(SPEAKER_TREBLE_HZ, q, rate));
                }
            }
            Tone::Television => {
                sections.push(Biquad::high_pass(TV_BASS_HZ, q, rate));
                if below_nyquist(TV_DEEMPHASIS_HZ) {
                    sections.push(Biquad::low_pass_1(TV_DEEMPHASIS_HZ, rate));
                }
            }
        }
        Chain { sections }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        self.sections.iter_mut().fold(x, |v, s| s.process(v))
    }

    fn settle(&mut self, x: f64) {
        let mut v = x;
        for s in &mut self.sections {
            s.settle(v);
            v = s.y1;
        }
    }
}

/// The 48K speaker model's bass corner (second-order): a small speaker's resonance, below which it gives
/// little. Chosen, not measured (docs/audio.md).
pub const SPEAKER_BASS_HZ: f64 = 400.0;
/// The 48K speaker model's treble corner (second-order).
pub const SPEAKER_TREBLE_HZ: f64 = 5000.0;
/// The television model's bass corner (second-order): a TV's speaker in its cabinet.
pub const TV_BASS_HZ: f64 = 150.0;
/// The television model's treble corner: the 50 µs de-emphasis of PAL FM sound, 1 / (2π · 50 µs).
pub const TV_DEEMPHASIS_HZ: f64 = 3183.1;

/// The output stage for both sides.
#[derive(Clone, Debug)]
pub(crate) struct Stage {
    output: Output,
    left: Chain,
    right: Chain,
    gain: f64,
}

impl Stage {
    pub(crate) fn new(output: Output, rate: u32) -> Stage {
        let rate = rate as f64;
        Stage {
            output,
            left: Chain::new(&output, rate),
            right: Chain::new(&output, rate),
            gain: output.volume as f64 * HEADROOM,
        }
    }

    pub(crate) fn output(&self) -> Output {
        self.output
    }

    /// Rebuilds the filters for a new configuration or rate, started as if the levels had been `left` and
    /// `right` for ever (so that the change makes no thump).
    pub(crate) fn rebuild(&mut self, output: Output, rate: u32, left: f64, right: f64) {
        *self = Stage::new(output, rate);
        self.left.settle(left);
        self.right.settle(right);
    }

    /// One stereo sample: the raw levels in, the samples out.
    #[inline]
    pub(crate) fn process(&mut self, left: f64, right: f64) -> (f32, f32) {
        let l = self.left.process(left) * self.gain;
        let r = self.right.process(right) * self.gain;
        (l.clamp(-1.0, 1.0) as f32, r.clamp(-1.0, 1.0) as f32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The gain of a chain at frequency `f`, measured by running a sine through it until it settles.
    fn gain_at(output: Output, rate: u32, f: f64) -> f64 {
        let mut chain = Chain::new(&output, rate as f64);
        let n = rate as usize * 4;
        let mut peak: f64 = 0.0;
        for i in 0..n {
            let x = (2.0 * std::f64::consts::PI * f * i as f64 / rate as f64).sin();
            let y = chain.process(x);
            if i > n / 2 {
                peak = peak.max(y.abs());
            }
        }
        peak
    }

    fn db(g: f64) -> f64 {
        20.0 * g.log10()
    }

    #[test]
    fn dc_block_corner_is_where_it_says() {
        let out = Output::default();
        assert!((db(gain_at(out, 48000, DC_CORNER_HZ)) + 3.01).abs() < 0.05);
        assert!(db(gain_at(out, 48000, 100.0)).abs() < 0.01);
        assert!(db(gain_at(out, 48000, 1.0)) < -12.0);
    }

    #[test]
    fn dc_block_removes_a_held_level() {
        let mut stage = Stage::new(Output::default(), 44100);
        let mut last = 0.0;
        for _ in 0..44100 {
            last = stage.process(0.5, 0.5).0;
        }
        assert!(last.abs() < 1e-6, "{last}");
        // Off, the level comes through, times the headroom.
        let mut raw = Stage::new(
            Output {
                dc_block: false,
                ..Output::default()
            },
            44100,
        );
        let (l, _) = raw.process(0.5, 0.5);
        assert!((l as f64 - 0.5 * HEADROOM).abs() < 1e-7);
    }

    #[test]
    fn speaker_and_television_corners() {
        let speaker = Output {
            tone: Tone::Speaker,
            ..Output::default()
        };
        assert!((db(gain_at(speaker, 48000, SPEAKER_BASS_HZ)) + 3.0).abs() < 0.2);
        assert!((db(gain_at(speaker, 48000, SPEAKER_TREBLE_HZ)) + 3.0).abs() < 0.2);
        assert!(db(gain_at(speaker, 48000, 1400.0)).abs() < 0.5);
        let tv = Output {
            tone: Tone::Television,
            ..Output::default()
        };
        assert!((db(gain_at(tv, 48000, TV_DEEMPHASIS_HZ)) + 3.0).abs() < 0.3);
        assert!((db(gain_at(tv, 48000, TV_BASS_HZ)) + 3.0).abs() < 0.3);
        assert!(db(gain_at(tv, 48000, 12000.0)) < -11.0);
    }

    #[test]
    fn settling_makes_no_thump() {
        let mut stage = Stage::new(
            Output {
                tone: Tone::Television,
                ..Output::default()
            },
            48000,
        );
        stage.rebuild(
            Output {
                tone: Tone::Speaker,
                ..Output::default()
            },
            96000,
            0.7,
            -0.3,
        );
        let (l, r) = stage.process(0.7, -0.3);
        assert!(l.abs() < 1e-6 && r.abs() < 1e-6, "{l} {r}");
    }
}
