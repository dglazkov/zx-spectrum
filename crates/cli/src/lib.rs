//! `zx`, the emulator headless: what the binary does, as a library, so that the corpus tests drive the same
//! code. `image` reads and writes pictures, `script` runs a machine to a script, `wav` writes sound.

pub mod image;
pub mod script;
pub mod wav;
