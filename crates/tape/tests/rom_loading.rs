//! TAP blocks played into the EAR line and loaded by the ROM's LD-BYTES, modelled T-state by T-state from
//! its disassembly (tests/common): what the real routine would load from the player's edges, for many byte
//! patterns, at the 48K's clock and the 128K's, across frame after frame.

mod common;

use common::*;
use tape::*;

/// Ten seconds of T-states: longer than any pilot LD-BYTES waits through.
const WAIT: u64 = 10 * 3_500_000;

/// Plays the blocks as a TAP file and loads each with LD-BYTES, asking for the flag and length it has.
fn load_all(blocks: &[Vec<u8>], hz: u32, frame: u32) {
    let mut p = Player::new(Tape::from_blocks(blocks), hz);
    p.play(0);
    let mut m = Machine::new(&mut p, frame);
    for (i, b) in blocks.iter().enumerate() {
        let len = (b.len() - 2) as u16;
        let got =
            ld_bytes(&mut m, b[0], len, WAIT).unwrap_or_else(|| panic!("block {i} never began"));
        assert!(
            got.ok,
            "block {i} at {hz} Hz: parity or timing failed after {} bytes",
            got.bytes.len()
        );
        assert_eq!(got.bytes, b[1..b.len() - 1], "block {i} at {hz} Hz");
    }
}

/// The byte patterns: every bit the same, alternating, every value, runs, and noise.
fn patterns() -> Vec<Vec<u8>> {
    vec![
        header(3, "patterns", 6912, 16384, 32768),
        tap::block(0xFF, &[0x00; 300]),
        tap::block(0xFF, &[0xFF; 300]),
        tap::block(0xFF, &[0x55, 0xAA].repeat(150)),
        tap::block(0xFF, &(0..=255).collect::<Vec<u8>>()),
        tap::block(0xFF, &(0..=255).rev().collect::<Vec<u8>>()),
        tap::block(0xFF, &[0x0F, 0xF0, 0x01, 0x80, 0x7F, 0xFE].repeat(40)),
        tap::block(0xFF, &noise(1, 2000)),
        tap::block(0xFF, &[0x42]),
        tap::block(0x7E, &noise(2, 64)),
    ]
}

#[test]
fn every_pattern_loads_at_the_48k_clock() {
    load_all(&patterns(), CLOCK_48K, FRAME_48K);
}

#[test]
fn every_pattern_loads_at_the_128k_clock() {
    load_all(&patterns(), CLOCK_128K, FRAME_128K);
}

#[test]
fn a_screen_and_more_load_without_drifting_over_many_frames() {
    // About 80 seconds of tape: thousands of frames ended under the player.
    let blocks: Vec<Vec<u8>> = (0..4)
        .map(|i| tap::block(0xFF, &noise(10 + i, 6912)))
        .collect();
    load_all(&blocks, CLOCK_128K, FRAME_128K);
    load_all(&blocks, CLOCK_48K, FRAME_48K);
}

#[test]
fn ld_bytes_started_in_the_middle_of_a_pilot_still_loads() {
    let blocks = vec![header(0, "late", 10, 0, 10)];
    let mut p = Player::new(Tape::from_blocks(&blocks), CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    // Two and a half seconds into the header's five-second pilot.
    m.run(8_750_000);
    let got = ld_bytes(&mut m, 0x00, 17, WAIT).unwrap();
    assert!(got.ok);
    assert_eq!(got.bytes, blocks[0][1..18]);
}

#[test]
fn a_flag_not_asked_for_is_refused_and_the_next_block_loads() {
    let blocks = vec![tap::block(0xFF, &[1, 2, 3]), header(3, "next", 3, 0, 0)];
    let mut p = Player::new(Tape::from_blocks(&blocks), CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let refused = ld_bytes(&mut m, 0x00, 17, WAIT).unwrap();
    assert_eq!(
        refused,
        Loaded {
            bytes: vec![],
            ok: false
        }
    );
    let got = ld_bytes(&mut m, 0x00, 17, WAIT).unwrap();
    assert!(got.ok);
    assert_eq!(got.bytes, blocks[1][1..18]);
}

/// A TZX block 0x11 of `data` with the ROM's timings scaled by `scale`.
fn scaled(scale: f64, data: &[u8]) -> Vec<u8> {
    let t = |v: f64| (v * scale).round() as u16;
    b11(
        [t(2168.0), t(667.0), t(735.0), t(855.0), t(1710.0), 3223],
        8,
        1000,
        data,
    )
}

#[test]
fn the_rom_loads_timings_a_tenth_off_its_own_and_not_a_turbo_loader_s() {
    let data = tap::block(0xFF, &noise(5, 500));
    for scale in [0.91, 0.95, 1.05, 1.09] {
        let tape = Tape::parse(&tzx(&[scaled(scale, &data)])).unwrap();
        let Block::Turbo(t) = &tape.blocks[0] else {
            panic!()
        };
        assert!(t.rom_timed(), "{scale}");
        for (hz, frame) in [(CLOCK_48K, FRAME_48K), (CLOCK_128K, FRAME_128K)] {
            let mut p = Player::new(tape.clone(), hz);
            p.play(0);
            let mut m = Machine::new(&mut p, frame);
            let got = ld_bytes(&mut m, 0xFF, 500, WAIT).unwrap();
            assert!(got.ok, "timings at {scale} of the ROM's, {hz} Hz");
            assert_eq!(got.bytes, data[1..501]);
        }
    }
    // At twice the speed, as Saboteur's own loader reads its blocks, the ROM reads nonsense.
    let tape = Tape::parse(&tzx(&[scaled(0.5, &data)])).unwrap();
    let Block::Turbo(t) = &tape.blocks[0] else {
        panic!()
    };
    assert!(!t.rom_timed());
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let got = ld_bytes(&mut m, 0xFF, 500, WAIT);
    assert!(!got.is_some_and(|g| g.ok && g.bytes == data[1..501]));
}

#[test]
fn a_block_cut_short_fails_as_the_rom_fails_it() {
    let full = tap::block(0xFF, &noise(9, 100));
    let cut = full[..60].to_vec();
    let mut p = Player::new(Tape::from_blocks(std::slice::from_ref(&cut)), CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let got = ld_bytes(&mut m, 0xFF, 100, WAIT).unwrap();
    // It stores every byte it reads (the 59 after the flag) and then times out waiting for the next.
    assert_eq!(
        got,
        Loaded {
            bytes: cut[1..].to_vec(),
            ok: false
        }
    );
    // RomBlock::ld_bytes says the same.
    let rom = RomBlock {
        index: 0,
        bytes: cut,
    };
    assert_eq!(
        rom.ld_bytes(0xFF, 100),
        LdBytes {
            loaded: got.bytes,
            ok: false
        }
    );
}

/// Loads a block of 300 bytes with one of its timings (pilot, sync1, sync2, zero, one) set to `value`.
fn loads_with(which: usize, value: u16) -> bool {
    let data = tap::block(0xFF, &noise(5, 300));
    let mut t = [2168, 667, 735, 855, 1710, 3223];
    t[which] = value;
    let tape = Tape::parse(&tzx(&[b11(t, 8, 1000, &data)])).unwrap();
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    ld_bytes(&mut m, 0xFF, 300, WAIT).is_some_and(|g| g.ok && g.bytes == data[1..301])
}

#[test]
fn the_rom_s_own_window_of_timings() {
    // What LD-BYTES accepts of each timing, the others at the ROM's (measured with the model, in steps of
    // 4 T-states, and recorded in docs/tape.md): inside, a little inside each end; outside, past it.
    let windows = [
        (0, 1800, 3360, 1650, 3450),
        (1, 170, 1070, 0, 1100),
        (2, 190, 3440, 0, 3500),
        (3, 490, 1236, 450, 1260),
        (4, 1272, 2772, 1240, 2850),
    ];
    for (which, lo, hi, below, above) in windows {
        assert!(loads_with(which, lo), "timing {which} at {lo}");
        assert!(loads_with(which, hi), "timing {which} at {hi}");
        if below > 0 {
            assert!(!loads_with(which, below), "timing {which} at {below}");
        }
        assert!(!loads_with(which, above), "timing {which} at {above}");
    }
}

#[test]
fn asked_for_no_bytes_ld_bytes_takes_the_flag_for_the_parity() {
    // With DE = 0 the ROM reads the flag byte, does not compare it, and returns with the carry set only if
    // it is 0: the model and RomBlock::ld_bytes agree.
    for (block, ok) in [
        (vec![0x00, 0x00], true),
        (vec![0xFF, 0xFF], false),
        (vec![0x00, 0x55, 0x55], true),
    ] {
        let mut p = Player::new(Tape::from_blocks(std::slice::from_ref(&block)), CLOCK_48K);
        p.play(0);
        let mut m = Machine::new(&mut p, FRAME_48K);
        let got = ld_bytes(&mut m, 0xFF, 0, WAIT).unwrap();
        assert_eq!(got, Loaded { bytes: vec![], ok });
        assert_eq!(
            RomBlock {
                index: 0,
                bytes: block
            }
            .ld_bytes(0xFF, 0),
            LdBytes { loaded: vec![], ok }
        );
    }
}

/// Whether LD-BYTES, listening from a second of silence, loads a ROM-timed block whose pilot is `pulses`
/// pulses of `length`.
fn loads_pilot(pulses: u16, length: u16, hz: u32, frame: u32) -> bool {
    let data = tap::block(0xFF, &[1, 2, 3]);
    let tape = Tape::parse(&tzx(&[
        b20(1000),
        b11([length, 667, 735, 855, 1710, pulses], 8, 1000, &data),
    ]))
    .unwrap();
    let mut p = Player::new(tape, hz);
    p.play(0);
    let mut m = Machine::new(&mut p, frame);
    ld_bytes(&mut m, 0xFF, 3, 2 * WAIT).is_some_and(|g| g.ok)
}

#[test]
fn the_rom_needs_a_second_of_pilot_and_instant_loading_asks_no_less() {
    // LD-BYTES waits a second from the pilot's first edge and then counts 256 pairs of pulses: with a pilot
    // of 2,168 the model needs 2,127 pulses at 3.5 MHz.
    assert!(!loads_pilot(2126, 2168, CLOCK_48K, FRAME_48K));
    assert!(loads_pilot(2127, 2168, CLOCK_48K, FRAME_48K));
    // Across the tenth either side of the ROM's pilot that instant loading takes, and at both clocks, the
    // shortest pilot it takes is one the ROM loads, and no more than ten pulses longer than the ROM needs.
    for length in [1952, 2168, 2384] {
        let least = (0..).find(|&n| rom::pilot_found(n, length as u32)).unwrap() as u16;
        for (hz, frame) in [(CLOCK_48K, FRAME_48K), (CLOCK_128K, FRAME_128K)] {
            assert!(loads_pilot(least, length, hz, frame), "{length} at {hz} Hz");
        }
        assert!(
            !loads_pilot(least - 10, length, CLOCK_48K, FRAME_48K),
            "{length}"
        );
        // And the deck takes such a block from that length, and not one pulse short of it.
        let data = tap::block(0xFF, &[1, 2, 3]);
        for (pulses, taken) in [(least - 1, false), (least, true)] {
            let tape = Tape::parse(&tzx(&[b11(
                [length, 667, 735, 855, 1710, pulses],
                8,
                1000,
                &data,
            )]))
            .unwrap();
            let mut p = Player::new(tape, CLOCK_48K);
            assert_eq!(p.take_rom_block(0).is_some(), taken, "{length} × {pulses}");
        }
    }
}

#[test]
fn a_block_with_no_pause_loads_when_the_tape_stops_or_ends_after_it() {
    // LD-BYTES's last bit ends with the edge that ends the block's last pulse: when nothing follows (the
    // tape stops, or ends) that edge is still made, and held long enough to be heard, before the stopped
    // tape is silent.
    let data = tap::block(0xFF, &noise(12, 50));
    for blocks in [vec![b10(0, &data), b20(0)], vec![b10(0, &data)]] {
        for (hz, frame) in [(CLOCK_48K, FRAME_48K), (CLOCK_128K, FRAME_128K)] {
            let mut p = Player::new(Tape::parse(&tzx(&blocks)).unwrap(), hz);
            p.play(0);
            let mut m = Machine::new(&mut p, frame);
            let got = ld_bytes(&mut m, 0xFF, 50, WAIT).unwrap();
            assert!(got.ok, "{} blocks at {hz} Hz", blocks.len());
            assert_eq!(got.bytes, data[1..51]);
            m.run(10_000);
            assert!(!m.ear(), "the stopped tape is silent");
            assert!(!m.player.is_playing());
        }
    }
}
