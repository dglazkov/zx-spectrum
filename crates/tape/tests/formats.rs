//! Every block of every format, built to its specification, read back and played: the levels and the
//! T-state of every edge, against what the specification's rules make of it (see `src/signal.rs`).

mod common;

use common::*;
use tape::*;

/// The level at the start, and every edge after it (T-state from the start, new level), until the tape
/// stops or ends.
fn edges(tape: Tape) -> (bool, Vec<(u64, bool)>) {
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let first = m.ear();
    let mut out = Vec::new();
    while let Some(t) = m.run_to_edge() {
        out.push((t, m.ear()));
    }
    (first, out)
}

fn parse(bytes: &[u8]) -> Tape {
    let tape = Tape::parse(bytes).expect("a tape");
    assert!(tape.warnings.is_empty(), "{:?}", tape.warnings);
    tape
}

/// The pulses the ROM's SAVE makes of a block: pilot, syncs, two pulses a bit.
fn rom_pulses(data: &[u8]) -> Vec<u32> {
    let pilot = if data[0] < 0x80 { 8063 } else { 3223 };
    let mut p = vec![2168; pilot];
    p.extend([667, 735]);
    for &byte in data {
        for bit in (0..8).rev() {
            let len = if byte >> bit & 1 != 0 { 1710 } else { 855 };
            p.extend([len, len]);
        }
    }
    p
}

/// Edges of pulses that alternate from low, each pulse ended by its edge.
fn alternating(pulses: &[u32], from: u64) -> Vec<(u64, bool)> {
    let mut t = from;
    pulses
        .iter()
        .enumerate()
        .map(|(k, &p)| {
            t += p as u64;
            (t, k % 2 == 0)
        })
        .collect()
}

#[test]
fn a_standard_block_plays_as_the_rom_saves_it_then_its_pause() {
    let data = tap::block(0xFF, &[0x80, 0x7F, 0x00, 0xFF]);
    let (first, got) = edges(parse(&tzx(&[b10(1000, &data)])));
    let pulses = rom_pulses(&data);
    let mut want = alternating(&pulses, 0);
    // An odd count of pulses: the last is low, so the pause's first millisecond is high (the last pulse's
    // edge), and then it is low.
    assert_eq!(pulses.len() % 2, 1);
    let end = want.last().unwrap().0;
    want.push((end + 3500, false));
    assert!(!first, "a tape starts low");
    assert_eq!(got, want);
}

#[test]
fn the_pilot_is_longer_before_a_header_and_the_syncs_and_bits_have_the_rom_s_polarity() {
    let header = header(3, "x", 1, 2, 3);
    let (_, got) = edges(parse(&tzx(&[b10(0, &header)])));
    // 8,063 pilot pulses, then the first sync pulse is high and the second low, and each bit starts high
    // (as PZX's specification says the ROM's SAVE has it).
    assert_eq!(got[8062], (8063 * 2168, true));
    assert_eq!(got[8063], (8063 * 2168 + 667, false));
    assert_eq!(got[8064], (8063 * 2168 + 667 + 735, true));
    assert!(!got[8065].1);
    let (_, data) = edges(parse(&tzx(&[b10(0, &tap::block(0xFF, &[1]))])));
    assert_eq!(data[3222], (3223 * 2168, true));
}

#[test]
fn a_pause_after_a_block_with_none_finishes_its_last_pulse_and_then_goes_low() {
    let data = tap::block(0xFF, &[0xF0]);
    let n = rom_pulses(&data).len();
    // Followed by a pause block: the same as the block's own pause.
    let (_, a) = edges(parse(&tzx(&[b10(0, &data), b20(500)])));
    let (_, b) = edges(parse(&tzx(&[b10(500, &data)])));
    assert_eq!(a, b);
    assert_eq!(a.len(), n + 1);
    // Followed by another block straight away: its first pulse is the opposite of the last one, an edge
    // with no time between. The tape then ends: the edge that ends its last pulse is held a millisecond,
    // and the line is silent after.
    let (_, c) = edges(parse(&tzx(&[b10(0, &data), b12(1000, 2)])));
    let end = c[n - 1].0;
    assert_eq!(c[n - 1], (end, true));
    assert_eq!(
        &c[n..],
        &[(end + 1000, false), (end + 2000, true), (end + 5500, false)]
    );
}

#[test]
fn a_pause_holds_the_pulse_level_for_its_first_millisecond_even_when_that_is_low() {
    // Two pulses leave the pulse level low: the pause is low from its start, ending the high pulse.
    let (_, got) = edges(parse(&tzx(&[b12(1000, 2), b20(10), b12(500, 1)])));
    // 1000 low, 1000 high, then the pause low for 10 ms; the pulse after a pause is low too, and the tape
    // ends with that pulse's edge, held for a millisecond before the line falls silent.
    assert_eq!(
        got,
        vec![
            (1000, true),
            (2000, false),
            (37_500, true),
            (37_500 + 3500, false)
        ]
    );
}

#[test]
fn a_pause_of_zero_stops_the_tape_which_plays_on_from_low() {
    let tape = parse(&tzx(&[b12(1000, 3), b20(0), b12(1000, 2)]));
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let mut got = Vec::new();
    while let Some(t) = m.run_to_edge() {
        got.push((t, m.ear()));
    }
    // Three pulses: low, high, low; the stop ends the last with its edge, which a loader reading the last
    // bit waits for, held for a millisecond (as a pause would hold it), and the stopped tape is silent.
    assert_eq!(
        got,
        vec![(1000, true), (2000, false), (3000, true), (6500, false)]
    );
    m.run(10_000);
    let s = m.player.status();
    assert!(!s.playing);
    assert!(!m.ear());
    assert_eq!(s.stopped_by, Some(StopReason::StopBlock(1)));
    assert_eq!(s.block, 1);
    // Played again, it goes on from the next block, from low, as TZX asks of a tape started from a
    // position: low (no edge out of the silence), then high, then the edge that ends it as the tape ends.
    let t = m.t;
    m.player.play(t);
    let resumed = m.total;
    assert!(!m.ear());
    let mut more = Vec::new();
    while let Some(t) = m.run_to_edge() {
        more.push((t - resumed, m.ear()));
    }
    assert_eq!(more, vec![(1000, true), (2000, false)]);
    m.run(1);
    assert_eq!(m.player.status().stopped_by, Some(StopReason::EndOfTape));
    assert!(m.player.at_end());
}

#[test]
fn a_turbo_block_plays_its_timings_and_only_the_used_bits_of_its_last_byte() {
    let b = b11([1000, 300, 400, 250, 500, 4], 3, 0, &[0b1011_0000]);
    let tape = parse(&tzx(&[b]));
    let Block::Turbo(t) = &tape.blocks[0] else {
        panic!()
    };
    assert_eq!(
        (
            t.pilot,
            t.sync1,
            t.sync2,
            t.zero,
            t.one,
            t.pilot_pulses,
            t.used_bits
        ),
        (1000, 300, 400, 250, 500, 4, 3)
    );
    let (_, got) = edges(tape);
    let pulses = [
        1000, 1000, 1000, 1000, 300, 400, 500, 500, 250, 250, 500, 500,
    ];
    assert_eq!(got, alternating(&pulses, 0));
}

#[test]
fn pulses_of_zero_length_turn_the_level_with_no_time() {
    let tape = parse(&tzx(&[b13(&[500, 0, 700])]));
    assert_eq!(tape.blocks[0], Block::Pulses(vec![500, 0, 700]));
    // 500 low; a zero pulse (high, for no time); 700 low again; then the edge that ends it, held a
    // millisecond as the tape ends.
    assert_eq!(edges(tape).1, vec![(1200, true), (4700, false)]);
}

#[test]
fn pure_tone_and_pure_data() {
    let tape = parse(&tzx(&[b12(300, 3), b14(400, 800, 8, 1, &[0xA5])]));
    assert_eq!(
        tape.blocks[0],
        Block::PureTone {
            pulse: 300,
            count: 3
        }
    );
    let mut pulses = vec![300, 300, 300];
    for bit in (0..8).rev() {
        let len = if 0xA5u8 >> bit & 1 != 0 { 800 } else { 400 };
        pulses.extend([len, len]);
    }
    let mut want = alternating(&pulses, 0);
    // 19 pulses: the last is low, so the 1 ms pause starts with its edge; it lasts the whole pause, after
    // which the level is low.
    let end = want.last().unwrap().0;
    want.push((end + 3500, false));
    assert_eq!(edges(tape).1, want);
}

#[test]
fn a_direct_recording_plays_its_samples_as_levels() {
    let tape = parse(&tzx(&[b15(100, 0, 5, &[0b1100_1000, 0b0111_1000])]));
    let (first, got) = edges(tape);
    // 1 1 0 0 1 0 0 0 | 0 1 1 1 1, 100 T-states each; the level after is the last sample's, held for a
    // millisecond as a pause would hold it when the tape ends at 1300, and then silence.
    assert!(first);
    assert_eq!(
        got,
        vec![
            (200, false),
            (400, true),
            (500, false),
            (900, true),
            (1300 + 3500, false)
        ]
    );
}

#[test]
fn a_csw_block_in_rle_and_z_rle() {
    let pulses = [10, 20, 300, 5];
    for compression in [1, 2] {
        let tape = parse(&tzx(&[b18(0, 44_100, compression, &pulses)]));
        let Block::Csw(c) = &tape.blocks[0] else {
            panic!()
        };
        assert_eq!(
            (c.sample_rate, &c.pulses[..], c.initial),
            (44_100, &pulses[..], None)
        );
        // Each edge at the T-state its exact time falls in: 10 samples is 793.65 T-states. The last pulse
        // is held: after a recording the level is the last played; the tape ends with it (335 samples,
        // 26,587 T-states), and a millisecond later the line is silent.
        assert_eq!(
            edges(tape).1,
            vec![
                (793, true),
                (2380, false),
                (26_190, true),
                (26_587 + 3500, false)
            ]
        );
    }
}

#[test]
fn a_generalized_block_s_symbols_begin_as_their_polarity_says() {
    // Pilot: force low 1000; an edge, 500 and 500; no edge, 300; force high, 200.
    let pilot: &[(u8, &[u16])] = &[(2, &[1000]), (0, &[500, 500]), (1, &[300]), (3, &[200])];
    let tape = parse(&tzx(&[b19(
        0,
        pilot,
        &[(0, 1), (1, 1), (2, 1), (3, 1)],
        &[],
        &[],
    )]));
    let Block::Generalized(g) = &tape.blocks[0] else {
        panic!()
    };
    assert_eq!(
        g.pilot_symbols[1],
        Symbol {
            polarity: 0,
            pulses: vec![500, 500]
        }
    );
    assert_eq!(
        g.pilot_symbols[2],
        Symbol {
            polarity: 1,
            pulses: vec![300]
        }
    );
    assert_eq!(
        edges(tape).1,
        vec![(1000, true), (1500, false), (2300, true), (2500, false)]
    );
}

#[test]
fn a_generalized_block_s_data_can_take_several_bits_a_symbol() {
    let data: &[(u8, &[u16])] = &[(0, &[100]), (0, &[200]), (0, &[300]), (0, &[400, 400])];
    let tape = parse(&tzx(&[b19(0, &[], &[], data, &[3, 0, 2, 1])]));
    let Block::Generalized(g) = &tape.blocks[0] else {
        panic!()
    };
    assert_eq!(
        (g.bits_per_symbol, g.data_count, &g.data[..]),
        (2, 4, &[0b1100_1001][..])
    );
    let (first, got) = edges(tape);
    assert!(
        first,
        "the first symbol makes an edge from the low the tape starts at"
    );
    assert_eq!(
        got,
        vec![
            (400, false),
            (800, true),
            (900, false),
            (1200, true),
            (1400, false)
        ]
    );
}

#[test]
fn the_specification_s_generalized_header_loads_through_ld_bytes() {
    // The example in the TZX specification: a standard header as a generalized data block.
    let header = header(3, "JPSP", 0x1B00, 0x4000, 0x8000);
    assert_eq!(header[18], 0xC1, "the specification's checksum");
    let stream: Vec<u8> = header
        .iter()
        .flat_map(|&b| (0..8).rev().map(move |i| b >> i & 1))
        .collect();
    let b = b19(
        1000,
        &[(0, &[2168]), (0, &[667, 735])],
        &[(0, 8063), (1, 1)],
        &[(0, &[855, 855]), (0, &[1710, 1710])],
        &stream,
    );
    assert_eq!(b.len() - 5, 59, "the specification's block length");
    let tape = parse(&tzx(&[b]));
    assert_eq!(
        tape.blocks[0].describe(),
        "Generalized data: Bytes: JPSP CODE 16384,6912"
    );
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let got = ld_bytes(&mut m, 0x00, 17, 10 * 3_500_000).unwrap();
    assert!(got.ok);
    assert_eq!(got.bytes, header[1..18]);
}

#[test]
fn a_loop_plays_its_blocks_again() {
    let tape = parse(&tzx(&[b24(3), b12(1000, 1), b25(), b12(500, 1)]));
    assert_eq!(tape.blocks[0], Block::LoopStart(3));
    let (_, got) = edges(tape);
    assert_eq!(
        got,
        vec![(1000, true), (2000, false), (3000, true), (3500, false)]
    );
}

#[test]
fn a_jump_skips_blocks() {
    let tape = parse(&tzx(&[b12(100, 1), b23(2), b12(200, 1), b12(300, 1)]));
    assert_eq!(tape.blocks[1], Block::Jump(2));
    assert_eq!(edges(tape).1, vec![(100, true), (400, false)]);
    // A jump back, around a loop of signal, plays until the loop ends it. A jump to itself plays nothing,
    // for ever: the tape stops itself, the edge that ends its last pulse held for a millisecond.
    let tape = parse(&tzx(&[b12(100, 1), b23(0)]));
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    assert_eq!(m.run_to_edge(), Some(100));
    assert_eq!(m.run_to_edge(), Some(3600));
    assert!(!m.ear());
    assert_eq!(m.run_to_edge(), None);
    m.run(1);
    assert_eq!(
        m.player.status().stopped_by,
        Some(StopReason::EndlessLoop(1))
    );
}

#[test]
fn a_call_plays_each_sequence_then_returns() {
    // 0 calls 3 and 5; each returns; then block 1 plays and 2 jumps off the end.
    let tape = parse(&tzx(&[
        b26(&[3, 5]),
        b12(700, 1),
        b23(5),
        b12(100, 1),
        b27(),
        b12(200, 1),
        b27(),
    ]));
    assert_eq!(tape.blocks[0], Block::Call(vec![3, 5]));
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let mut blocks = Vec::new();
    let mut got = Vec::new();
    while let Some(t) = m.run_to_edge() {
        got.push((t, m.ear()));
        // The block whose signal the edge begins (the last, the jump that ends the tape).
        blocks.push(m.player.status().block);
    }
    assert_eq!(
        got,
        vec![(100, true), (300, false), (1000, true), (4500, false)]
    );
    assert_eq!(blocks, vec![5, 1, 2, 2]);
}

#[test]
fn stop_if_48k_stops_a_48k_only() {
    let bytes = tzx(&[b12(100, 1), b2a(), b12(200, 1)]);
    let (_, on_128k) = edges(parse(&bytes));
    assert_eq!(on_128k, vec![(100, true), (300, false)]);
    let mut p = Player::new(parse(&bytes), CLOCK_48K);
    p.set_48k(true);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    assert_eq!(m.run_to_edge(), Some(100));
    assert_eq!(m.run_to_edge(), Some(3600));
    assert_eq!(m.run_to_edge(), None);
    m.run(1);
    assert_eq!(m.player.status().stopped_by, Some(StopReason::StopIf48k(1)));
}

#[test]
fn set_signal_level_sets_the_level_of_what_follows() {
    let tape = parse(&tzx(&[b2b(true), b12(100, 2)]));
    assert_eq!(tape.blocks[0], Block::SetLevel(true));
    let (first, got) = edges(tape);
    assert!(first);
    assert_eq!(got, vec![(100, false), (200, true), (3700, false)]);
}

#[test]
fn the_blocks_that_say_things_are_read_and_take_no_time() {
    let tape = parse(&tzx(&[
        b30("Created with MakeTZX"),
        b31(5, "Side B\rnext"),
        b32(&[
            (0x00, "Saboteur"),
            (0x01, "Durell"),
            (0x03, "1985"),
            (0xFF, "Comment here"),
        ]),
        b33(&[[0, 1, 0], [3, 0, 1], [0x20, 1, 3]]),
        b35("POKEs", &[1, 2, 3]),
        b21("Level 1"),
        b28(&[(1, "Part 1"), (-1, "Back")]),
        b22(),
        b5a(),
        b12(100, 1),
    ]));
    assert_eq!(tape.blocks[0], Block::Text("Created with MakeTZX".into()));
    assert_eq!(
        tape.blocks[1],
        Block::Message {
            seconds: 5,
            text: "Side B\nnext".into()
        }
    );
    assert_eq!(
        tape.blocks[2],
        Block::ArchiveInfo(vec![
            (0, "Saboteur".into()),
            (1, "Durell".into()),
            (3, "1985".into()),
            (0xFF, "Comment here".into())
        ])
    );
    assert_eq!(
        tape.blocks[3].describe(),
        "Hardware: runs on ZX Spectrum 48K, Plus, uses Classic AY hardware (128K compatible), does not run on Hardware 0x20/0x01"
    );
    assert_eq!(
        tape.blocks[4],
        Block::CustomInfo {
            id: "POKEs".into(),
            data: vec![1, 2, 3]
        }
    );
    assert_eq!(tape.blocks[5], Block::GroupStart("Level 1".into()));
    assert_eq!(
        tape.blocks[6],
        Block::Select(vec![
            Selection {
                offset: 1,
                text: "Part 1".into()
            },
            Selection {
                offset: -1,
                text: "Back".into()
            }
        ])
    );
    assert_eq!(tape.blocks[7], Block::GroupEnd);
    assert_eq!(tape.blocks[8], Block::Glue);
    assert_eq!(
        tape.blocks[2].describe(),
        "Archive info: Saboteur, Durell, 1985"
    );
    assert_eq!(
        tape.info()[3],
        ("Comment".to_string(), "Comment here".to_string())
    );
    let mut p = Player::new(tape.clone(), CLOCK_48K);
    assert!((0..9).all(|i| p.block_seconds(i) == 0.0));
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    assert_eq!(m.run_to_edge(), Some(100));
    assert_eq!(m.player.status().message, Some(1));
    // The one pulse, ended by its edge at the end of the tape and held a millisecond.
    assert_eq!(edges(tape).1, vec![(100, true), (3600, false)]);
}

#[test]
fn deprecated_and_unknown_blocks_are_skipped_by_their_lengths() {
    // 0x16: 0x28 bytes (the four of its length among them) and the data, whose length is at 0x25.
    let mut c64rom = vec![0x16];
    c64rom.extend_from_slice(&(0x24u32 + 3).to_le_bytes());
    c64rom.extend_from_slice(&[0; 0x21]);
    c64rom.extend_from_slice(&[3, 0, 0]);
    c64rom.extend_from_slice(&[9, 9, 9]);
    // 0x17: 0x16 bytes and the data, its length at 0x13.
    let mut c64turbo = vec![0x17];
    c64turbo.extend_from_slice(&(0x16u32 + 2).to_le_bytes());
    c64turbo.extend_from_slice(&[0; 0x0F]);
    c64turbo.extend_from_slice(&[2, 0, 0]);
    c64turbo.extend_from_slice(&[7, 7]);
    let emulation = [&[0x34][..], &[0; 8]].concat();
    let snapshot = [&[0x40, 0, 4, 0, 0][..], &[1, 2, 3, 4]].concat();
    let unknown = [&[0x7E][..], &5u32.to_le_bytes(), &[1, 2, 3, 4, 5]].concat();
    let tape = parse(&tzx(&[
        c64rom,
        c64turbo,
        emulation,
        snapshot,
        unknown,
        b12(100, 1),
    ]));
    assert_eq!(
        tape.blocks[..5],
        [
            Block::Skipped {
                id: 0x16,
                len: 0x28 + 3
            },
            Block::Skipped {
                id: 0x17,
                len: 0x16 + 2
            },
            Block::Skipped { id: 0x34, len: 8 },
            Block::Skipped { id: 0x40, len: 8 },
            Block::Skipped { id: 0x7E, len: 9 },
        ]
    );
    assert_eq!(
        tape.blocks[5],
        Block::PureTone {
            pulse: 100,
            count: 1
        }
    );
    assert_eq!(
        tape.blocks[4].describe(),
        "Unknown block, ID 0x7E: 9 bytes skipped"
    );
    assert_eq!(edges(tape).1, vec![(100, true), (3600, false)]);
}

#[test]
fn a_tzx_cut_short_keeps_the_blocks_before() {
    let mut bytes = tzx(&[b12(100, 1), b10(1000, &[0xFF, 1, 2, 3])]);
    bytes.truncate(bytes.len() - 2);
    let tape = Tape::parse(&bytes).unwrap();
    assert_eq!(tape.blocks.len(), 1);
    assert_eq!(tape.warnings.len(), 1);
    assert!(
        Tape::parse(b"ZXTape!\x1A\x02\x00").is_err(),
        "a version 2 is not read"
    );
}

#[test]
fn tap_files_are_read_and_written() {
    let blocks = vec![header(0, "hello", 10, 10, 10), tap::block(0xFF, &[1; 10])];
    let bytes = tap::write(&blocks);
    let tape = parse(&bytes);
    assert_eq!(tape.format, Format::Tap);
    assert_eq!(tape, Tape::from_blocks(&blocks));
    assert_eq!(tape.blocks[0].describe(), "Program: hello LINE 10");
    assert_eq!(tape.blocks[1].describe(), "Data: 10 bytes");
    // A TAP block is a 0x10 with a second's pause: the same signal.
    let as_tzx = parse(&tzx(&[b10(1000, &blocks[0]), b10(1000, &blocks[1])]));
    assert_eq!(edges(tape).1, edges(as_tzx).1);
    let mut cut = bytes.clone();
    cut.truncate(cut.len() - 3);
    assert_eq!(Tape::parse(&cut).unwrap().warnings.len(), 1);
    assert_eq!(Tape::parse(&[5, 0, 1]), Err(Error::Unrecognised));
    assert_eq!(Tape::parse(&[]), Err(Error::Unrecognised));
}

/// A CSW file: version 1 (32-byte header) or 2 (52 bytes and an extension).
fn csw_file(major: u8, rate: u32, compression: u8, high: bool, pulses: &[u32]) -> Vec<u8> {
    let rle = csw::encode_rle(pulses);
    let data = if compression == 2 {
        miniz_oxide::deflate::compress_to_vec_zlib(&rle, 9)
    } else {
        rle
    };
    let mut f = csw::SIGNATURE.to_vec();
    if major == 1 {
        f.extend_from_slice(&[1, 1]);
        f.extend_from_slice(&(rate as u16).to_le_bytes());
        f.extend_from_slice(&[compression, high as u8, 0, 0, 0]);
    } else {
        f.extend_from_slice(&[2, 0]);
        f.extend_from_slice(&rate.to_le_bytes());
        f.extend_from_slice(&(pulses.len() as u32).to_le_bytes());
        f.extend_from_slice(&[compression, high as u8, 3]);
        f.extend_from_slice(b"tape tests\0\0\0\0\0\0");
        f.extend_from_slice(&[0xEE; 3]);
    }
    f.extend_from_slice(&data);
    f
}

#[test]
fn csw_files_version_1_and_2_start_at_the_level_they_say() {
    let pulses = [10, 20, 300, 5];
    for (major, compression, high) in [(1, 1, false), (2, 1, true), (2, 2, false), (2, 2, true)] {
        let tape = parse(&csw_file(major, 44_100, compression, high, &pulses));
        assert_eq!(
            tape.format,
            Format::Csw {
                major,
                minor: if major == 1 { 1 } else { 0 }
            }
        );
        let (first, got) = edges(tape);
        assert_eq!(first, high);
        let mut want: Vec<(u64, bool)> = [793, 2380, 26_190]
            .iter()
            .enumerate()
            .map(|(i, &t)| (t, (i % 2 == 0) != high))
            .collect();
        // The last pulse is held to the end of the recording, and a millisecond after it the line is
        // silent: an edge if that pulse was high.
        if !high {
            want.push((26_587 + 3500, false));
        }
        assert_eq!(
            got, want,
            "CSW {major}, compression {compression}, high {high}"
        );
    }
}

#[test]
fn a_csw_recording_of_a_rom_block_loads_through_ld_bytes() {
    // The ROM's pulses, sampled at 44.1 kHz as a recording would have them, with what follows the last
    // bit: SAVE's tail of 945 T-states, and silence (a recording keeps its last level, so without them the
    // last bit would never end).
    let block = tap::block(0xFF, &noise(7, 200));
    let mut t = 0u64;
    let mut last = 0u64;
    let mut rom = rom_pulses(&block);
    rom.extend([945, 3_500_000]);
    let pulses: Vec<u32> = rom
        .iter()
        .map(|&p| {
            t += p as u64;
            let s = t * 44_100 / 3_500_000;
            let n = (s - last) as u32;
            last = s;
            n
        })
        .collect();
    let tape = parse(&csw_file(2, 44_100, 2, false, &pulses));
    let mut p = Player::new(tape, CLOCK_128K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_128K);
    let got = ld_bytes(&mut m, 0xFF, 200, 10 * 3_500_000).unwrap();
    assert!(got.ok);
    assert_eq!(got.bytes, block[1..201]);
}

/// A PZX block: tag, size, body.
fn pzx_block(tag: &[u8; 4], body: &[u8]) -> Vec<u8> {
    [&tag[..], &(body.len() as u32).to_le_bytes(), body].concat()
}

fn words(w: &[u16]) -> Vec<u8> {
    w.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn pzx_data(high: bool, tail: u16, zero: &[u16], one: &[u16], bits: u32, data: &[u8]) -> Vec<u8> {
    let mut body = (bits | (high as u32) << 31).to_le_bytes().to_vec();
    body.extend_from_slice(&tail.to_le_bytes());
    body.extend_from_slice(&[zero.len() as u8, one.len() as u8]);
    body.extend(words(zero));
    body.extend(words(one));
    body.extend_from_slice(data);
    pzx_block(b"DATA", &body)
}

#[test]
fn pzx_blocks_are_read_as_the_specification_encodes_them() {
    let file = [
        pzx_block(
            b"PZXT",
            b"\x01\x00Saboteur\0Publisher\0Durell\0Author\0Clive Townsend",
        ),
        // A zero pulse first (to start high), 3 x 1000 with a count, a long pulse needing a count, and one
        // between 0x8000 and 0xFFFF needing none.
        pzx_block(
            b"PULS",
            &words(&[0, 0x8003, 1000, 0x8001, 0x8001, 0x2345, 0x8000, 0x9000]),
        ),
        pzx_data(true, 945, &[855, 855], &[1710, 1710], 12, &[0xAB, 0xC0]),
        pzx_block(b"PAUS", &(3500u32 | 1 << 31).to_le_bytes()),
        pzx_block(b"BRWS", "Level 2 ✓".as_bytes()),
        pzx_block(b"STOP", &[1, 0]),
        pzx_block(b"STOP", &[0, 0]),
        pzx_block(b"abcd", &[1, 2, 3]),
    ]
    .concat();
    let tape = parse(&file);
    assert_eq!(tape.format, Format::Pzx { major: 1, minor: 0 });
    assert_eq!(
        tape.blocks[0],
        Block::PzxHeader {
            major: 1,
            minor: 0,
            title: "Saboteur".into(),
            info: vec![
                ("Publisher".into(), "Durell".into()),
                ("Author".into(), "Clive Townsend".into())
            ],
        }
    );
    assert_eq!(
        tape.blocks[1],
        Block::PzxPulses(vec![
            PzxPulse {
                count: 1,
                duration: 0
            },
            PzxPulse {
                count: 3,
                duration: 1000
            },
            PzxPulse {
                count: 1,
                duration: 0x1_2345
            },
            PzxPulse {
                count: 1,
                duration: 0x9000
            },
        ])
    );
    assert_eq!(
        tape.blocks[2],
        Block::PzxData(PzxData {
            initial_high: true,
            bits: 12,
            tail: 945,
            zero: vec![855, 855],
            one: vec![1710, 1710],
            data: vec![0xAB, 0xC0]
        })
    );
    assert_eq!(
        tape.blocks[3],
        Block::PzxPause {
            duration: 3500,
            high: true
        }
    );
    assert_eq!(tape.blocks[4], Block::Browse("Level 2 ✓".into()));
    assert_eq!(tape.blocks[5], Block::StopIf48k);
    assert_eq!(tape.blocks[6], Block::Pause { ms: 0 });
    assert_eq!(tape.blocks.len(), 7, "the unknown block is skipped");
    assert_eq!(
        tape.info()[0],
        ("Title".to_string(), "Saboteur".to_string())
    );
}

#[test]
fn pzx_levels_are_each_block_s_own() {
    let file = [
        pzx_block(b"PZXT", &[1, 0]),
        pzx_block(b"PULS", &words(&[0x8003, 1000, 500])),
        pzx_block(b"PAUS", &(1000u32 | 1 << 31).to_le_bytes()),
        pzx_data(false, 0, &[100, 0], &[0, 100], 4, &[0b0110_0000]),
    ]
    .concat();
    let (first, got) = edges(parse(&file));
    assert!(!first);
    // PULS starts low: 1000 low, 1000 high, 1000 low, 500 high. PAUS starts high: 1000 more of high.
    // DATA starts low; its bits are direct-recording-like: 0 is 100 low, 1 is 100 high. Its tail of 0
    // turns the level, which the tape's end then shows for a millisecond before the line is silent.
    assert_eq!(
        got,
        vec![
            (1000, true),
            (2000, false),
            (3000, true),
            (4500, false),
            (4600, true),
            (4800, false),
            (4900, true),
            (4900 + 3500, false)
        ]
    );
}

#[test]
fn a_pzx_pause_holds_its_level_and_a_stop_after_it_makes_no_edge() {
    // A DATA block with the ROM's tail, a PAUS, then STOP. 0x0F from high: four 0s and four 1s, each bit
    // two pulses, then the tail of 945 high, 21,465 T-states in all.
    let mut pulses = vec![855; 8];
    pulses.extend([1710; 8]);
    pulses.push(945);
    let mut bits = Vec::new();
    let mut end = 0;
    for (k, &len) in pulses.iter().enumerate() {
        end += len;
        bits.push((end, k % 2 == 1));
    }
    assert_eq!(bits.last(), Some(&(21_465, false)));
    // A PAUS low: the tail's edge takes the line low, the pause holds it, and the stop finds it low: no
    // edge, as the PAUS's level is held and not turned after it. A PAUS high: the tail goes on into it with
    // no edge, and the stop ends it a millisecond on.
    let low = bits.clone();
    let mut high = bits[..bits.len() - 1].to_vec();
    high.push((21_465 + 35_000 + 3500, false));
    for (paus_high, want) in [(false, low), (true, high)] {
        let file = [
            pzx_block(b"PZXT", &[1, 0]),
            pzx_data(true, 945, &[855, 855], &[1710, 1710], 8, &[0x0F]),
            pzx_block(
                b"PAUS",
                &(35_000u32 | (paus_high as u32) << 31).to_le_bytes(),
            ),
            pzx_block(b"STOP", &[0, 0]),
        ]
        .concat();
        let mut p = Player::new(parse(&file), CLOCK_48K);
        p.play(0);
        let mut m = Machine::new(&mut p, FRAME_48K);
        let mut got = Vec::new();
        while let Some(t) = m.run_to_edge() {
            got.push((t, m.ear()));
        }
        assert_eq!(got, want, "PAUS high: {paus_high}");
        m.run(40_000);
        assert!(!m.ear(), "the stopped tape is silent");
        assert_eq!(m.player.status().stopped_by, Some(StopReason::StopBlock(3)));
    }
}

#[test]
fn a_pzx_rom_block_loads_through_ld_bytes() {
    let block = tap::block(0x00, &noise(3, 17));
    let file = [
        pzx_block(b"PZXT", &[1, 0]),
        pzx_block(b"PULS", &words(&[0x8000 + 8063, 2168, 667, 735])),
        pzx_data(true, 945, &[855, 855], &[1710, 1710], 19 * 8, &block),
        pzx_block(b"PAUS", &3_500_000u32.to_le_bytes()),
    ]
    .concat();
    let mut p = Player::new(parse(&file), CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let got = ld_bytes(&mut m, 0x00, 17, 10 * 3_500_000).unwrap();
    assert!(got.ok);
    assert_eq!(got.bytes, block[1..18]);
}

#[test]
fn every_kind_of_block_says_what_it_is() {
    let cases: Vec<(Vec<u8>, &str)> = vec![
        (
            b10(1000, &header(0, "SABOTEUR", 313, 1, 313)),
            "Program: SABOTEUR LINE 1",
        ),
        (
            b10(1000, &header(0, "auto", 313, 0x8000, 313)),
            "Program: auto",
        ),
        (
            b10(1000, &header(1, "nums", 50, 0x8200, 0)),
            "Number array: nums DATA b()",
        ),
        (
            b10(1000, &header(2, "strs", 50, 0xC300, 0)),
            "Character array: strs DATA c$()",
        ),
        (
            b10(1000, &header(3, "screen", 6912, 16384, 32768)),
            "Bytes: screen CODE 16384,6912",
        ),
        (b10(1000, &tap::block(0xFF, &[0; 6912])), "Data: 6912 bytes"),
        (
            b10(1000, &tap::block(0x42, &[0; 5])),
            "Data, flag 0x42: 5 bytes",
        ),
        (
            b11(
                [2168, 667, 735, 855, 1710, 3223],
                8,
                1000,
                &tap::block(0xFF, &[0; 3]),
            ),
            "Data: 3 bytes",
        ),
        (
            b11(
                [2000, 600, 600, 400, 800, 3000],
                8,
                1000,
                &tap::block(0xFF, &[0; 3]),
            ),
            "Turbo: Data: 3 bytes",
        ),
        (b12(2168, 3223), "Pure tone: 3223 pulses of 2168 T"),
        (b13(&[667, 735]), "Pulses: 667, 735 T"),
        (
            b14(855, 1710, 8, 1000, &[0xFF, 1, 2, 3]),
            "Pure data: Data: 2 bytes",
        ),
        (
            b15(79, 0, 8, &[0; 5538]),
            "Direct recording: 1 s, 44304 samples a second",
        ),
        (
            b18(0, 44_100, 1, &[44_100]),
            "CSW recording: 1 s at 44100 Hz",
        ),
        (b20(1000), "Pause: 1 s"),
        (b20(872), "Pause: 0.872 s"),
        (b20(0), "Stop the tape"),
        (b21("Level 1"), "Group: Level 1"),
        (b23(-2), "Jump to block -2"),
        (b24(5), "Loop: 5 times"),
        (b25(), "Loop end"),
        (b26(&[2, 5]), "Call blocks +2, +5"),
        (b27(), "Return from sequence"),
        (b2a(), "Stop the tape if 48K"),
        (b2b(false), "Signal level: low"),
        (b30("hello"), "Text: hello"),
        (b31(0, "Turn over"), "Message: Turn over"),
        (
            b35("Instructions", b"Run"),
            "Custom info: Instructions, 3 bytes",
        ),
    ];
    for (block, want) in cases {
        let tape = parse(&tzx(&[block]));
        assert_eq!(tape.blocks[0].describe(), want);
    }
}
