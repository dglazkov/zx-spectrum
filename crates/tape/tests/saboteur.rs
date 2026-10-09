//! Saboteur (Durell, 1985), the owner's game: its original tape as a TZX (a BASIC loader and a machine-code
//! loader at the ROM's speed, then four blocks for its own turbo loader, then two more at the ROM's), and a
//! cracked TAP of it. Both are fixtures fetched by scripts/fixture; without them these tests say they were
//! skipped.

mod common;

use common::*;
use tape::*;

const WAIT: u64 = 10 * 3_500_000;
/// Saboteur's turbo blocks' timings: pilot, sync, sync, 0, 1.
const TURBO: [u16; 5] = [2165, 714, 714, 424, 849];

fn tape(name: &str, test: &str) -> Option<Tape> {
    let tape = Tape::parse(&fixture(name, test)?).expect("Saboteur reads");
    assert!(tape.warnings.is_empty());
    Some(tape)
}

#[test]
fn the_tzx_lists_its_blocks() {
    let Some(tape) = tape("saboteur.tzx", "the_tzx_lists_its_blocks") else {
        return;
    };
    assert_eq!(
        tape.format,
        Format::Tzx {
            major: 1,
            minor: 10
        }
    );
    let list: Vec<String> = tape.blocks.iter().map(|b| b.describe()).collect();
    assert_eq!(
        list,
        [
            "Text: Created with Ramsoft MakeTZX",
            "Program: SABOTEUR LINE 1",
            "Data: 313 bytes",
            "Bytes: CODE 64036,1330",
            "Data: 1330 bytes",
            "Turbo: Bytes: CODE 40000,6912",
            "Turbo: Data: 6912 bytes",
            "Turbo: Bytes: CODE 25200,38500",
            "Turbo: Data: 38500 bytes",
            "Bytes: CODE 63700,1836",
            "Data: 1836 bytes",
        ]
    );
    // The program's name is "INK 2; SABOTEUR", the third header's an AT 0,0 and spaces that hide it.
    assert_eq!(
        tape.blocks[1].header().unwrap().raw_name,
        *b"\x10\x02SABOTEUR"
    );
    assert_eq!(
        tape.blocks[9].header().unwrap().raw_name,
        *b"\x16\x00\x00       "
    );
    let Block::Turbo(t) = &tape.blocks[6] else {
        panic!()
    };
    assert_eq!([t.pilot, t.sync1, t.sync2, t.zero, t.one], TURBO);
    assert_eq!((t.pilot_pulses, t.used_bits, t.pause_ms), (4921, 8, 688));
    // Every block's length: pilot, syncs, bits and pause, to the T-state.
    let p = Player::new(tape, CLOCK_48K);
    assert_eq!(
        p.durations(),
        [
            0,
            21_310_226,
            15_769_366,
            21_156_706,
            36_395_746,
            12_327_189,
            72_286_169,
            12_524_789,
            374_486_361,
            21_338_706,
            248_785_886
        ]
    );
    assert!((p.tape_seconds() - 238.966).abs() < 0.001);
}

#[test]
fn the_tap_lists_its_blocks() {
    let Some(tape) = tape("saboteur.tap", "the_tap_lists_its_blocks") else {
        return;
    };
    let list: Vec<String> = tape.blocks.iter().map(|b| b.describe()).collect();
    assert_eq!(
        list,
        [
            "Program: Sabot1.1 LINE 10",
            "Data: 127 bytes",
            "Bytes: Sabot1.2 CODE 36384,6912",
            "Data: 6912 bytes",
            "Bytes: Sabot1.3 CODE 25200,38500",
            "Data: 38500 bytes",
            "Bytes: Sabot1.4 CODE 63700,1836",
            "Data: 1836 bytes",
        ]
    );
}

/// The bytes LD-BYTES is asked for by a header: its length.
fn length_of(header: &Block) -> u16 {
    header.header().unwrap().length
}

/// Plays the TZX through as the machine would load it: LD-BYTES for the blocks at the ROM's speed (each
/// header asking for the data after it), Saboteur's loader for its four.
fn play_through(tape: &Tape, hz: u32, frame: u32) {
    let blocks = &tape.blocks;
    let mut p = Player::new(tape.clone(), hz);
    p.play(0);
    let mut m = Machine::new(&mut p, frame);
    let rom = |m: &mut Machine, i: usize, flag: u8, len: u16| {
        let Block::Standard { data, .. } = &blocks[i] else {
            panic!("block {i}")
        };
        let got = ld_bytes(m, flag, len, WAIT).unwrap_or_else(|| panic!("block {i} never began"));
        assert!(got.ok, "block {i} at {hz} Hz");
        assert_eq!(got.bytes, data[1..data.len() - 1], "block {i} at {hz} Hz");
    };
    rom(&mut m, 1, 0x00, 17);
    rom(&mut m, 2, 0xFF, length_of(&blocks[1]));
    rom(&mut m, 3, 0x00, 17);
    rom(&mut m, 4, 0xFF, length_of(&blocks[3]));
    for (i, block) in blocks.iter().enumerate().take(9).skip(5) {
        let Block::Turbo(t) = block else { panic!() };
        let got = read_block(&mut m, hz, TURBO, t.data.len());
        assert_eq!(got, t.data, "turbo block {i} at {hz} Hz");
        assert_eq!(tap::parity(&got), 0);
    }
    rom(&mut m, 9, 0x00, 17);
    rom(&mut m, 10, 0xFF, length_of(&blocks[9]));
}

#[test]
fn the_tzx_loads_at_the_48k_clock() {
    let Some(tape) = tape("saboteur.tzx", "the_tzx_loads_at_the_48k_clock") else {
        return;
    };
    play_through(&tape, CLOCK_48K, FRAME_48K);
}

#[test]
fn the_tzx_loads_at_the_128k_clock() {
    let Some(tape) = tape("saboteur.tzx", "the_tzx_loads_at_the_128k_clock") else {
        return;
    };
    play_through(&tape, CLOCK_128K, FRAME_128K);
}

#[test]
fn the_tap_loads_at_both_clocks() {
    let Some(tape) = tape("saboteur.tap", "the_tap_loads_at_both_clocks") else {
        return;
    };
    for (hz, frame) in [(CLOCK_48K, FRAME_48K), (CLOCK_128K, FRAME_128K)] {
        let mut p = Player::new(tape.clone(), hz);
        p.play(0);
        let mut m = Machine::new(&mut p, frame);
        for (i, b) in tape.blocks.iter().enumerate() {
            let Block::Standard { data, .. } = b else {
                panic!()
            };
            let len = if i % 2 == 0 {
                17
            } else {
                length_of(&tape.blocks[i - 1])
            };
            let got = ld_bytes(&mut m, data[0], len, WAIT).unwrap();
            assert!(got.ok, "block {i} at {hz} Hz");
            assert_eq!(got.bytes, data[1..data.len() - 1]);
        }
    }
}

/// Every edge of the tape, in the machine's T-states from its start.
fn all_edges(tape: &Tape, hz: u32, frame: u32) -> Vec<u64> {
    let mut p = Player::new(tape.clone(), hz);
    p.play(0);
    let mut m = Machine::new(&mut p, frame);
    let mut edges = Vec::new();
    while let Some(t) = m.run_to_edge() {
        edges.push(t);
    }
    edges
}

#[test]
fn every_edge_at_the_128k_clock_is_the_48k_s_scaled_exactly() {
    let Some(tape) = tape(
        "saboteur.tzx",
        "every_edge_at_the_128k_clock_is_the_48k_s_scaled_exactly",
    ) else {
        return;
    };
    let at_48k = all_edges(&tape, CLOCK_48K, FRAME_48K);
    let at_128k = all_edges(&tape, CLOCK_128K, FRAME_128K);
    // An edge ends each pulse; each block here has an odd count of them, so its pause begins high and
    // makes one more edge going low a millisecond in.
    let pulses = |pilot: usize, bytes: usize| pilot + 2 + 16 * bytes;
    let expected: usize = tape.blocks[1..]
        .iter()
        .map(|b| match b {
            Block::Standard { data, .. } => {
                pulses(if data[0] == 0 { 8063 } else { 3223 }, data.len())
            }
            Block::Turbo(t) => pulses(t.pilot_pulses as usize, t.data.len()),
            _ => unreachable!(),
        })
        .inspect(|n| assert_eq!(n % 2, 1))
        .map(|n| n + 1)
        .sum();
    assert_eq!(expected, 837_508);
    assert_eq!(at_48k.len(), expected);
    assert_eq!(at_128k.len(), expected);
    // 3,546,900 / 3,500,000 = 5067 / 5000: each edge the T-state its exact time falls in, after four minutes
    // of tape and some 3,400 frames as after the first.
    for (a, b) in at_48k.iter().zip(&at_128k) {
        assert_eq!(*b, a * 5067 / 5000);
    }
    // The last edge is the 1 ms after the last bit, before the 58-second pause.
    let total: u64 = Player::new(tape.clone(), CLOCK_48K)
        .durations()
        .iter()
        .sum();
    assert_eq!(*at_48k.last().unwrap(), total - (58_477 - 1) * 3500);
}

#[test]
fn instant_loading_takes_the_rom_s_blocks_and_leaves_the_turbo_ones_to_play() {
    let Some(tape) = tape(
        "saboteur.tzx",
        "instant_loading_takes_the_rom_s_blocks_and_leaves_the_turbo_ones_to_play",
    ) else {
        return;
    };
    let mut p = Player::new(tape.clone(), CLOCK_48K);
    // The LOAD "" trap: the tape is taken block by block, past the text, without playing.
    for i in 1..=4 {
        let b = p.take_rom_block(0).expect("a ROM block");
        assert_eq!(b.index, i);
        assert_eq!(Some(&b.bytes[..]), tape.blocks[i].rom_data());
        let ld = b.ld_bytes(b.bytes[0], (b.bytes.len() - 2) as u16);
        assert!(ld.ok);
    }
    // The turbo blocks are Saboteur's own loader's to read, from the tape as it plays. The tape stands
    // in block 4's pause, as LD-BYTES would have left the real one: the loader it brought in has the
    // same gap before the turbo pilot.
    assert_eq!(p.take_rom_block(0), None);
    assert_eq!(p.status().block, 4);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    for i in 5..=8 {
        let Block::Turbo(t) = &tape.blocks[i] else {
            panic!()
        };
        assert_eq!(read_block(&mut m, CLOCK_48K, TURBO, t.data.len()), t.data);
    }
    // Saboteur's loader reads the last two with the ROM's LD-BYTES, which the trap takes.
    let t = m.t;
    for i in [9, 10] {
        let b = m.player.take_rom_block(t).expect("a ROM block");
        assert_eq!(b.index, i);
    }
    assert_eq!(m.player.take_rom_block(t), None);
}
