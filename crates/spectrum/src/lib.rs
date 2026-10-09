//! A ZX Spectrum, faithful to the T-state: the 16K, 48K (Issue 2 or 3, early or late ULA timings), 128K, +2,
//! +2A, +3 (without disks) and Pentagon 128, with the CPU (`z80`), the AY (`ay`), the sound buffer (`audio`)
//! and the tape deck (`tape`) put together the way the real machines put them together. docs/machine.md is
//! this crate's record: what it does, where every timing comes from, and how it is tested.
//!
//! ```
//! use spectrum::{Machine, Model};
//!
//! let mut zx = Machine::new(Model::Spectrum48);
//! for _ in 0..150 {
//!     zx.run_frame();                      // one video frame: 69,888 T-states on a 48K
//! }
//! let picture: &[u8] = zx.frame();         // 352 × 296 colours, 0–7 and 8–15 bright
//! assert_eq!(picture.len(), 352 * 296);
//! let sound: &[f32] = zx.audio();          // the frame's samples, stereo interleaved, at 48 kHz
//! assert!(sound.len() / 2 >= 958);
//! assert!(zx.screen_text().rows[23].starts_with("© 1982 Sinclair Research Ltd"));
//! ```
//!
//! # The API
//!
//! - `Machine::new(Model)`, `Machine::with_options(Model, Options)`; `power_on(Model)` switches it on afresh
//!   (as another model, too), `reset()` is the RESET button, `nmi()` an NMI button.
//! - `run_frame()` runs a frame (`Stop::FrameEnd`), or to a breakpoint (`Stop::Breakpoint(pc)`); `run(steps)`
//!   and `step_instruction()` run less. `frame()` is the last frame's picture (`frame_width()` ×
//!   `frame_height()` = 352 × 296, the paper at (48, 48)), `audio()` its sound (interleaved stereo f32 at
//!   `sample_rate()`, set by `set_sample_rate`).
//! - Input: `key(code, down)` with code = half-row × 5 + bit (`input::keys`), `release_keys()`,
//!   `joystick(Joystick, bits)` (right 1, left 2, down 4, up 8, fire 16), `type_text(text)` and
//!   `type_chords(chords)` typed at the pace the ROM's KEYBOARD routine needs, `press(chord, frames)`.
//! - Files: `load(bytes, name) -> Result<Loaded, LoadError>` for TAP/TZX/CSW/PZX (inserted, not started),
//!   .z80/.sna/.szx/.slt (the machine switched to their model), .scr, and a .zip of any of them.
//! - The tape: `tape_play()`, `tape_stop()`, `tape_rewind()`, `tape_seek(block)`, `eject_tape()`,
//!   `tape_state()` (cheap), `tape_blocks()`, `tape_active()` (the tape is playing: the page can run flat
//!   out), `saved_tap()` (what a SAVE recorded).
//! - Options (`options()`, `set_options(Options)`): Issue 2, late timings, instant loading (the LD-BYTES
//!   trap), the automatic tape, the tape heard, snow, an AY on a 48K, AY stereo, the output tone and volume.
//! - State: `snapshot() -> snapshot::Snapshot`, `restore(&Snapshot)`; `save_state() -> Vec<u8>`,
//!   `load_state(&[u8])`: the whole machine, exactly, for rewinding.
//! - The debugger: `registers()`, `cpu()`/`cpu_mut()` (every register), `peek`, `poke`, `ram_bank`,
//!   `paging()`, `disassemble(addr)`, `add_breakpoint`/`remove_breakpoint`/`clear_breakpoints`.
//! - `screen_text()`: the screen read as characters against the ROM's font.

mod deck;
mod fdc;
pub mod input;
mod load;
mod machine;
mod memory;
mod model;
pub mod screen;
mod snap;
mod sound;
mod state;
mod video;

pub use input::{Joystick, Typist, char_chords, joy, key_code, key_name, keys};
pub use load::{LoadError, Loaded, LoadedKind, TapeBlock, TapeState};
pub use machine::{DEFAULT_SAMPLE_RATE, Machine, Options, Registers, Stop};
pub use model::Model;
pub use screen::ScreenText;
pub use sound::{AyStereo, default_tone};
pub use state::StateError;
pub use video::{FRAME_HEIGHT, FRAME_WIDTH, PAPER_X, PAPER_Y};

/// The default palette: Fuse's 0xC0 for the normal colours and 0xFF for the bright, by colour number (bits:
/// blue 0, red 1, green 2; 8–15 bright), as RGB. docs/test-corpus.md §4.3: no measurement of a real machine
/// has been published; the frame holds colour numbers, and the page chooses its own.
pub const PALETTE: [[u8; 3]; 16] = {
    let mut p = [[0u8; 3]; 16];
    let mut i = 0;
    while i < 16 {
        let v = if i >= 8 { 0xFF } else { 0xC0 };
        let c = i & 7;
        p[i] = [
            if c & 2 != 0 { v } else { 0 },
            if c & 4 != 0 { v } else { 0 },
            if c & 1 != 0 { v } else { 0 },
        ];
        i += 1;
    }
    p
};
