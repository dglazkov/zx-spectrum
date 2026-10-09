//! The emulator's sound: band-limited synthesis of levels that change at T-states, and the output stage.
//!
//! Every sound the Spectrum makes is a level that holds and then jumps: the beeper's pin, the tape heard
//! through it, each of the AY's three channels. A source says how far its level jumps and at which T-state of
//! the CPU clock (`Sink::add_step`, or `Level::set` for a source that only knows its level); the `Buffer` turns
//! each jump into a band-limited step at its exact position between two output samples, so that a square wave
//! of any pitch comes out without aliasing, and hands out interleaved stereo `f32` samples at whatever rate
//! the host plays. docs/audio.md is this part's record: how it works, what it was built from, how it is
//! tested, and the levels the Spectrum's own sound pin gives.
//!
//! ```
//! use audio::{Buffer, Level};
//!
//! let mut buffer = Buffer::new(3_500_000, 48_000);
//! let mut beeper = Level::new();
//! beeper.set(&mut buffer, 1000, 0.5); // the beeper goes up at T-state 1000 ...
//! beeper.set(&mut buffer, 1200, 0.0); // ... and down at 1200
//! buffer.end_frame(69_888);
//! let mut samples = vec![0.0f32; 2 * buffer.samples_avail()];
//! let n = buffer.read_samples(&mut samples);
//! assert_eq!(n, 958); // 69,888 T-states at 3.5 MHz, at 48 kHz, rounded
//! ```

mod buffer;
pub mod kernel;
mod output;

pub use buffer::{Buffer, Discard, Level, Sink, UNIT, units};
pub use output::{
    DC_CORNER_HZ, HEADROOM, Output, SPEAKER_BASS_HZ, SPEAKER_TREBLE_HZ, TV_BASS_HZ,
    TV_DEEMPHASIS_HZ, Tone,
};
