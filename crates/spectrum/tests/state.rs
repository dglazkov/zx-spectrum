//! The fast state (`save_state`/`load_state`) taken anywhere, not just between frames: in the middle of a
//! frame, with the picture half drawn, a tape playing and the sound going, and with a ROM that is not the
//! model's own. Run on from the state, a machine must give the same frames, sound and state, bit for bit.

use spectrum::{Machine, Model, Options, Stop};

/// A 48K loading a tape from its edges (LOAD "" typed), `frames` frames in.
fn loading(model: Model, frames: u64) -> Machine {
    let data: Vec<u8> = (0..2000u32).map(|i| (i * 13 + 7) as u8).collect();
    let header = {
        let mut h = vec![3u8];
        h.extend_from_slice(b"state     ");
        h.extend_from_slice(&(data.len() as u16).to_le_bytes());
        h.extend_from_slice(&0x8000u16.to_le_bytes());
        h.extend_from_slice(&0x8000u16.to_le_bytes());
        h
    };
    let tap = tape::tap::write(&[
        tape::tap::block(0x00, &header),
        tape::tap::block(0xFF, &data),
    ]);
    let mut zx = Machine::new(model);
    zx.load(&tap, "state.tap").unwrap();
    for _ in 0..120 {
        zx.run_frame();
    }
    if model.has_menu() {
        zx.type_chords(&[vec![spectrum::keys::ENTER]]);
    } else {
        zx.type_text("j\"\"\n");
    }
    for _ in 120..frames {
        zx.run_frame();
    }
    zx
}

/// The frames, the sound and the state after running `n` frames (from wherever the machine is).
fn run(zx: &mut Machine, n: usize) -> (Vec<u8>, Vec<u32>, Vec<u8>) {
    let (mut pictures, mut sound) = (Vec::new(), Vec::new());
    for _ in 0..n {
        while zx.run_frame() != Stop::FrameEnd {}
        pictures.extend_from_slice(zx.frame());
        sound.extend(zx.audio().iter().map(|s| s.to_bits()));
    }
    (pictures, sound, zx.save_state())
}

#[test]
fn a_state_taken_mid_frame_goes_on_bit_for_bit() {
    for model in [Model::Spectrum48, Model::Spectrum128, Model::Plus3] {
        let mut zx = loading(model, 400);
        assert!(zx.tape_active(), "{model:?}: the tape plays");
        // Into the frame, the beam in the paper: part of the picture drawn, the rest to come.
        while zx.tstate() < 30_000 {
            zx.run(1);
        }
        let state = zx.save_state();
        let a = run(&mut zx, 60);
        zx.load_state(&state).unwrap();
        let b = run(&mut zx, 60);
        let mut tape_only = loading(model, 130);
        tape_only.load_state(&state).unwrap();
        let c = run(&mut tape_only, 60);
        assert!(a.0 == b.0 && a.0 == c.0, "{model:?}: the pictures");
        assert!(a.1 == b.1 && a.1 == c.1, "{model:?}: the sound");
        assert!(
            a.1.iter().any(|&s| s != 0),
            "{model:?}: some sound to compare"
        );
        assert!(a.2 == b.2 && a.2 == c.2, "{model:?}: the state after");
    }
}

#[test]
fn a_state_keeps_a_rom_that_is_not_the_models() {
    // A .szx or .z80 can carry its own ROM; the state must carry it on, or a machine loaded from the state
    // runs the model's ROM in its place.
    let mut zx = Machine::with_options(
        Model::Spectrum48,
        Options {
            sound: false,
            ..Options::default()
        },
    );
    for _ in 0..100 {
        zx.run_frame();
    }
    let mut snap = zx.snapshot();
    // A ROM of its own: the 48K's, with the copyright message's first letter changed.
    let mut rom = spectrum_rom_48();
    let at = rom.windows(4).position(|w| w == b"1982").unwrap();
    rom[at] = b'2';
    snap.custom_rom = Some(rom.clone());
    zx.restore(&snap);
    assert_eq!(zx.peek(at as u16), b'2');
    let state = zx.save_state();
    let mut other = Machine::with_options(Model::Spectrum48, zx.options());
    other.load_state(&state).unwrap();
    assert_eq!(
        other.peek(at as u16),
        b'2',
        "the snapshot's ROM, carried by the state"
    );
    let a = run(&mut zx, 5);
    let b = run(&mut other, 5);
    assert!(a.2 == b.2, "the same state after");
    // And a model's own ROM costs a state nothing: back to it, the ROM is the model's.
    let mut plain = Machine::new(Model::Spectrum48);
    plain
        .load_state(&Machine::new(Model::Spectrum48).save_state())
        .unwrap();
    assert_eq!(plain.peek(at as u16), b'1');
}

fn spectrum_rom_48() -> Vec<u8> {
    let zx = Machine::new(Model::Spectrum48);
    (0..0x4000u16).map(|a| zx.peek(a)).collect()
}

#[test]
fn a_restored_machine_keeps_step_with_the_original() {
    // Taken while LD-BYTES reads the tape mid-frame: the machine put back from the state and the one it was
    // taken from, run side by side, have the same state all the way (the tape's sound included).
    for model in [Model::Plus3, Model::Spectrum48] {
        let mut zx = loading(model, 400);
        while zx.tstate() < 30_000 {
            zx.run(1);
        }
        let mut other = zx.clone();
        other.load_state(&zx.save_state()).unwrap();
        for i in 0..20 {
            assert!(
                zx.save_state() == other.save_state(),
                "{model:?}: after {} steps",
                i * 400
            );
            zx.run(400);
            other.run(400);
        }
    }
}
