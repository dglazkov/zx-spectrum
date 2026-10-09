//! The machine's sound: the beeper (the ULA's sound pin), the tape heard through it, and the AY, into one
//! band-limited buffer at the host's rate (docs/audio.md has the levels and where they come from).

use audio::{Buffer, Level, Output, Sink, Tone, UNIT};

use crate::model::Model;

/// How the AY's three channels reach the two sides.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AyStereo {
    /// As the machine has them: the 128K family's three outputs are joined on one track (`ay::Stereo::Joined`).
    #[default]
    Mono,
    /// A left, B centre, C right (the usual stereo modification).
    Abc,
    /// A left, C centre, B right (the Pentagon's).
    Acb,
}

impl AyStereo {
    pub fn id(self) -> &'static str {
        match self {
            AyStereo::Mono => "mono",
            AyStereo::Abc => "abc",
            AyStereo::Acb => "acb",
        }
    }
    pub fn from_id(s: &str) -> Option<AyStereo> {
        Some(match s.to_ascii_lowercase().as_str() {
            "mono" => AyStereo::Mono,
            "abc" => AyStereo::Abc,
            "acb" => AyStereo::Acb,
            _ => return None,
        })
    }
}

/// The share of the span of 1.0 (docs/audio.md's convention) each source has, by model and whether an AY is
/// there: the beeper's full swing, the tape heard at its high level, and the AY's `gain`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Shares {
    pub beeper: f32,
    pub tape: f32,
    pub ay: f32,
}

pub(crate) fn shares(model: Model, has_ay: bool) -> Shares {
    // The 48K: the beeper the span, but a tenth for the tape heard (docs/audio.md: Fuse 4%, MAME about 10%).
    // With an AY (the 128K family, or one on a 48K): beeper 0.44 to the AY's 0.56, from the mixing resistors
    // (R112 68 kΩ, R132 39 kΩ), with 0.05 of the span kept for the tape.
    let _ = model;
    if has_ay {
        Shares {
            beeper: 0.44 * 0.95,
            tape: 0.05,
            ay: 0.56 * 0.95,
        }
    } else {
        Shares {
            beeper: 0.9,
            tape: 0.1,
            ay: 0.0,
        }
    }
}

/// The beeper's level for EAR (port FEh bit 4) and MIC (bit 3, 0 is on... as written), relative to both set.
/// The 16K/48K's speaker sits behind two junction drops, so MIC alone (0.66–0.73 V on pin 28) is silent and
/// EAR alone 0.94 of both (docs/audio.md, from the FAQ's pin 28 voltages); the 128K family's sound is the pin
/// heard linearly: MIC alone 0.095, EAR alone 0.958 (the 48K Issue 3's voltages, for want of the 128's).
pub(crate) fn beeper_level(model: Model, ear: bool, mic: bool) -> f32 {
    let speaker = matches!(model, Model::Spectrum16 | Model::Spectrum48);
    match (ear, mic, speaker) {
        (false, false, _) => 0.0,
        (false, true, true) => 0.0,
        (false, true, false) => 0.095,
        (true, false, true) => 0.94,
        (true, false, false) => 0.958,
        (true, true, _) => 1.0,
    }
}

/// The output tone a model is heard through by default: the 48K's own speaker, a television for the rest.
pub fn default_tone(model: Model) -> Tone {
    match model {
        Model::Spectrum16 | Model::Spectrum48 => Tone::Speaker,
        _ => Tone::Television,
    }
}

/// What the machine's sound keeps.
#[derive(Clone, Debug)]
pub(crate) struct Sound {
    pub buffer: Buffer,
    pub beeper: Level,
    pub tape: Level,
    pub shares: Shares,
    /// The AY's steps go through an adapter that keeps what the AY has put out (`ay_raw`, as the chip counts
    /// it) and what reached the buffer (`ay_total`); after a state is loaded they differ by `ay_offset`, which
    /// the AY's next step makes up, so that the buffer, restored exactly, goes on exactly.
    pub ay_raw: (i32, i32),
    pub ay_total: (i32, i32),
    pub ay_offset: (i32, i32),
    /// The last frame's samples, interleaved left and right.
    pub samples: Vec<f32>,
    pub model: Model,
}

impl Sound {
    pub fn new(
        model: Model,
        clock: u32,
        rate: u32,
        has_ay: bool,
        tone: Tone,
        volume: f32,
    ) -> Sound {
        let mut buffer = Buffer::new(clock, rate);
        buffer.set_output(Output {
            tone,
            dc_block: true,
            volume,
        });
        Sound {
            buffer,
            beeper: Level::new(),
            tape: Level::new(),
            shares: shares(model, has_ay),
            ay_raw: (0, 0),
            ay_total: (0, 0),
            ay_offset: (0, 0),
            samples: Vec::new(),
            model,
        }
    }

    /// The beeper's level after an OUT to port FEh at T-state `t`.
    #[inline]
    pub fn beeper_out(&mut self, t: u32, value: u8) {
        let level =
            beeper_level(self.model, value & 0x10 != 0, value & 0x08 != 0) * self.shares.beeper;
        self.beeper.set(&mut self.buffer, t, level);
    }

    /// The tape's level heard at T-state `t`.
    #[inline]
    pub fn tape_level(&mut self, t: u32, high: bool) {
        let u = if high {
            (self.shares.tape * UNIT as f32) as i32
        } else {
            0
        };
        self.tape.set_units(&mut self.buffer, t, u, u);
    }

    /// The sink the AY puts its steps into.
    pub fn ay_sink(&mut self) -> AySink<'_> {
        AySink { sound: self }
    }

    /// Closes the frame and keeps its samples.
    pub fn end_frame(&mut self, frame_len: u32) {
        self.buffer.end_frame(frame_len);
        let n = self.buffer.samples_avail();
        self.samples.resize(n * 2, 0.0);
        let got = self.buffer.read_samples(&mut self.samples);
        self.samples.truncate(got * 2);
    }
}

pub(crate) struct AySink<'a> {
    sound: &'a mut Sound,
}

impl Sink for AySink<'_> {
    #[inline]
    fn add_step(&mut self, t: u32, left: i32, right: i32) {
        let s = &mut *self.sound;
        s.ay_raw = (
            s.ay_raw.0.wrapping_add(left),
            s.ay_raw.1.wrapping_add(right),
        );
        let (l, r) = (left + s.ay_offset.0, right + s.ay_offset.1);
        s.ay_offset = (0, 0);
        s.ay_total = (s.ay_total.0.wrapping_add(l), s.ay_total.1.wrapping_add(r));
        if l != 0 || r != 0 {
            s.buffer.add_step(t, l, r);
        }
    }
}
