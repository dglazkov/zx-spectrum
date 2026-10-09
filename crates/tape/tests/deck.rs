//! The deck: the machine's clock and frames, play and stop, winding, what it says for the page, and the
//! instant load's taking of ROM blocks.

mod common;

use common::*;
use tape::*;

fn tone(pulse: u16, count: u16) -> Tape {
    Tape::parse(&tzx(&[b12(pulse, count)])).unwrap()
}

#[test]
fn edges_at_the_128k_clock_fall_on_the_t_state_their_exact_time_does() {
    let mut p = Player::new(tone(2168, 10_000), CLOCK_128K);
    p.play(0);
    let mut frame_start = 0u64;
    let mut t = 0u32;
    for k in 1..=10_000u64 {
        let e = p.next_edge(t).unwrap();
        // 2168 T-states of 3.5 MHz, k times, at 3,546,900 Hz: nothing rounded until the end.
        assert_eq!(frame_start + e as u64, k * 2168 * 5067 / 5000, "edge {k}");
        t = e;
        assert_eq!(p.level_at(t), k % 2 == 1);
        while t >= FRAME_128K {
            p.end_frame(FRAME_128K);
            frame_start += FRAME_128K as u64;
            t -= FRAME_128K;
        }
    }
    assert_eq!(p.next_edge(t), None);
}

#[test]
fn stopped_the_tape_stands_still_and_plays_on_from_where_it_stood() {
    let mut p = Player::new(tone(1000, 10), CLOCK_48K);
    assert_eq!(p.next_edge(0), None, "a tape starts stopped");
    p.play(100);
    assert_eq!(p.next_edge(100), Some(1100));
    assert!(p.level_at(1100));
    p.stop(1600);
    assert!(!p.is_playing());
    assert_eq!(p.next_edge(1600), None);
    // A stopped tape gives no signal: the line is low, as with no tape, however it stood (here in a high
    // pulse), so that what the machine reads of the EAR bit is what it would read with the tape stopped.
    p.end_frame(FRAME_48K);
    assert!(!p.level_at(5000), "silent while stopped");
    assert!(!p.level_at(FRAME_48K + 10));
    // A frame and more later, it plays on: the pulse it stood in, of which 500 T-states were left.
    p.play(5000);
    assert!(p.level_at(5000));
    assert_eq!(p.next_edge(5000), Some(5500));
    assert!(!p.level_at(5500));
    assert!(p.status().playing);
}

#[test]
fn every_edge_can_be_heard_where_it_falls() {
    // A pulse every 1000 T-states; the machine reads the port now and then and hears every edge in between.
    let mut p = Player::new(tone(1000, 200), CLOCK_48K);
    p.play(0);
    let mut heard = Vec::new();
    let mut frame = 0u64;
    for _ in 0..3 {
        for read in [5_500u32, 5_500, 40_000, FRAME_48K] {
            p.edges_until(read, |t, level| heard.push((frame + t as u64, level)));
            p.level_at(read);
        }
        p.end_frame(FRAME_48K);
        frame += FRAME_48K as u64;
    }
    let want: Vec<(u64, bool)> = (1..=200)
        .map(|k| (k * 1000, k % 2 == 1))
        .take_while(|e| e.0 <= frame)
        .collect();
    assert_eq!(heard, want);
}

#[test]
fn a_time_asked_for_again_or_earlier_gives_the_latest_level() {
    let mut p = Player::new(tone(1000, 10), CLOCK_48K);
    p.play(0);
    assert!(p.level_at(1500));
    assert!(p.level_at(1500));
    assert!(p.level_at(200), "no going back");
    assert!(!p.level_at(2000));
}

#[test]
fn winding_puts_the_tape_at_a_block_with_the_level_low() {
    let tape = Tape::parse(&tzx(&[b12(1000, 3), b30("side"), b12(500, 4)])).unwrap();
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    assert_eq!(p.next_edge(0), Some(1000));
    p.seek(2, 1000);
    assert_eq!(p.status().block, 2);
    assert!(!p.level_at(1000));
    assert_eq!(
        p.next_edge(1000),
        Some(1500),
        "block 2's pulses, from the seek"
    );
    p.rewind(1500);
    assert_eq!(p.next_edge(1500), Some(2500), "block 0's again");
    // Played to its end, it stays there until rewound.
    let mut t = 2500;
    while let Some(e) = p.next_edge(t) {
        t = e;
    }
    p.level_at(t + 1);
    assert!(p.at_end());
    assert_eq!(p.status().stopped_by, Some(StopReason::EndOfTape));
    p.play(t + 2);
    assert!(!p.is_playing());
    p.rewind(t + 3);
    p.play(t + 3);
    assert_eq!(p.next_edge(t + 3), Some(t + 1003));
}

#[test]
fn the_status_says_where_the_tape_is() {
    let data = tap::block(0xFF, &[0; 100]);
    let tape = Tape::parse(&tzx(&[
        b30("start"),
        b10(1000, &data),
        b31(3, "Stop the tape"),
        b20(0),
        b12(2168, 100),
    ]))
    .unwrap();
    let mut p = Player::new(tape, CLOCK_48K);
    // The pilot, the syncs, 800 bits of 0 (the zeros), 16 of 1 (the flag and parity, both 0xFF), the pause.
    let len = 3223 * 2168 + 667 + 735 + 800 * 2 * 855 + 16 * 2 * 1710 + 1000 * 3500;
    assert_eq!(p.durations()[1], len as u64);
    assert_eq!(p.block_seconds(1), len as f64 / 3_500_000.0);
    let s = p.status();
    assert_eq!((s.block, s.playing, s.tape_elapsed), (0, false, 0.0));
    p.play(0);
    // Two seconds in: the block's pilot is done, it is in its data.
    for _ in 0..100 {
        p.end_frame(FRAME_48K);
    }
    let s = p.status();
    assert_eq!(s.block, 1);
    assert!((s.block_elapsed - 100.0 * 69_888.0 / 3_500_000.0).abs() < 0.01);
    assert!((s.tape_elapsed - s.block_elapsed).abs() < 1e-9);
    assert_eq!(s.block_seconds, p.block_seconds(1));
    assert!((s.tape_seconds - (len as f64 + 100.0 * 2168.0) / 3_500_000.0).abs() < 1e-9);
    // On, until the stop block: the message before it is there to show.
    for _ in 0..200 {
        p.end_frame(FRAME_48K);
    }
    let s = p.status();
    assert_eq!(
        (s.block, s.playing, s.stopped_by, s.message),
        (3, false, Some(StopReason::StopBlock(3)), Some(2))
    );
    assert!((s.tape_elapsed - len as f64 / 3_500_000.0).abs() < 1e-6);
}

#[test]
fn the_clock_can_change_under_a_playing_tape() {
    let mut p = Player::new(tone(5000, 100), CLOCK_48K);
    p.play(0);
    assert_eq!(p.next_edge(0), Some(5000));
    p.level_at(5000);
    p.set_clock(CLOCK_128K);
    // From here, 5000 T-states of 3.5 MHz are 5067 of the machine's.
    assert_eq!(p.next_edge(5000), Some(5000 + 5067));
}

#[test]
fn instant_loading_takes_tap_blocks_one_by_one() {
    let blocks = vec![
        header(3, "one", 3, 0, 0),
        tap::block(0xFF, &[1, 2, 3]),
        tap::block(0xFF, &[4]),
    ];
    let mut p = Player::new(Tape::from_blocks(&blocks), CLOCK_48K);
    for (i, b) in blocks.iter().enumerate() {
        let taken = p.take_rom_block(0).unwrap();
        assert_eq!(
            taken,
            RomBlock {
                index: i,
                bytes: b.clone()
            }
        );
        // The tape stands where LD-BYTES would have left it: at the start of the block's second of
        // pause, which the next take passes.
        let s = p.status();
        assert_eq!(s.block, i);
        assert!((s.block_seconds - s.block_elapsed - 1.0).abs() < 1e-9);
        assert!(!s.playing);
    }
    assert_eq!(p.take_rom_block(0), None);
    // What LD-BYTES would make of a block: the right flag and length; a wrong flag; too long a request;
    // too short a one, which judges the parity by a data byte.
    let rom = RomBlock {
        index: 1,
        bytes: blocks[1].clone(),
    };
    assert_eq!(rom.flag(), Some(0xFF));
    assert_eq!(
        rom.ld_bytes(0xFF, 3),
        LdBytes {
            loaded: vec![1, 2, 3],
            ok: true
        }
    );
    assert_eq!(
        rom.ld_bytes(0x00, 3),
        LdBytes {
            loaded: vec![],
            ok: false
        }
    );
    assert_eq!(
        rom.ld_bytes(0xFF, 5),
        LdBytes {
            loaded: vec![1, 2, 3, blocks[1][4]],
            ok: false
        }
    );
    assert_eq!(
        rom.ld_bytes(0xFF, 2),
        LdBytes {
            loaded: vec![1, 2],
            ok: 0xFF ^ 1 ^ 2 ^ 3 == 0
        }
    );
}

#[test]
fn instant_loading_passes_what_carries_no_signal_but_not_a_turbo_block() {
    let data = tap::block(0xFF, &[9; 10]);
    let bytes = tzx(&[
        b30("info"),
        b32(&[(0, "title")]),
        b20(0),
        b2a(),
        b21("group"),
        b11([2160, 670, 730, 850, 1720, 3223], 8, 1000, &data),
        b22(),
        b11([1500, 400, 400, 300, 600, 3223], 8, 1000, &data),
        b10(1000, &data),
    ]);
    let mut p = Player::new(Tape::parse(&bytes).unwrap(), CLOCK_48K);
    p.set_48k(true);
    assert_eq!(
        p.take_rom_block(0).map(|b| b.index),
        Some(5),
        "a 0x11 at the ROM's timings"
    );
    assert_eq!(p.take_rom_block(0), None, "a turbo block");
    // The tape stands in the taken block's pause, before the turbo block, as the real one would.
    assert_eq!(p.status().block, 5);
    p.seek(8, 0);
    assert_eq!(p.take_rom_block(0).map(|b| b.index), Some(8));
}

#[test]
fn instant_loading_takes_a_rom_block_built_of_tone_pulses_and_pure_data() {
    let data = tap::block(0x00, &[7; 17]);
    let rom = tzx(&[
        b12(2168, 8063),
        b30("sync"),
        b13(&[667, 735]),
        b14(855, 1710, 8, 1000, &data),
        b12(100, 1),
    ]);
    let mut p = Player::new(Tape::parse(&rom).unwrap(), CLOCK_48K);
    assert_eq!(
        p.take_rom_block(0),
        Some(RomBlock {
            index: 0,
            bytes: data.clone()
        })
    );
    // At the start of the pure data block's pause.
    assert_eq!(p.status().block, 3);
    assert!((p.status().block_elapsed - p.block_seconds(3) + 1.0).abs() < 1e-9);
    let turbo_bits = tzx(&[
        b12(2168, 8063),
        b13(&[667, 735]),
        b14(400, 800, 8, 1000, &data),
    ]);
    let mut p = Player::new(Tape::parse(&turbo_bits).unwrap(), CLOCK_48K);
    assert_eq!(p.take_rom_block(0), None);
}

#[test]
fn instant_loading_takes_a_generalized_block_or_pzx_that_is_the_rom_s() {
    let block = tap::block(0xFF, &[0x12, 0x34]);
    let stream: Vec<u8> = block
        .iter()
        .flat_map(|&b| (0..8).rev().map(move |i| b >> i & 1))
        .collect();
    let pilot: &[(u8, &[u16])] = &[(0, &[2168]), (0, &[667, 735])];
    let rom = b19(
        1000,
        pilot,
        &[(0, 3223), (1, 1)],
        &[(0, &[855, 855]), (0, &[1710, 1710])],
        &stream,
    );
    let mut p = Player::new(Tape::parse(&tzx(&[rom])).unwrap(), CLOCK_48K);
    assert_eq!(p.take_rom_block(0).unwrap().bytes, block);
    // The symbols the other way round: the bits read inverted.
    let inverted: Vec<u8> = stream.iter().map(|b| 1 - b).collect();
    let swapped = b19(
        1000,
        pilot,
        &[(0, 3223), (1, 1)],
        &[(0, &[1710, 1710]), (0, &[855, 855])],
        &inverted,
    );
    let mut p = Player::new(Tape::parse(&tzx(&[swapped])).unwrap(), CLOCK_48K);
    assert_eq!(p.take_rom_block(0).unwrap().bytes, block);
    // PZX: a pilot and sync, then data at the ROM's bits.
    let mut file = b"PZXT\x02\x00\x00\x00\x01\x00".to_vec();
    let puls: Vec<u8> = [0x8000u16 + 3223, 2168, 667, 735]
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .collect();
    file.extend_from_slice(b"PULS");
    file.extend_from_slice(&(puls.len() as u32).to_le_bytes());
    file.extend_from_slice(&puls);
    let mut data = (32u32 | 1 << 31).to_le_bytes().to_vec();
    data.extend_from_slice(&945u16.to_le_bytes());
    data.extend_from_slice(&[2, 2]);
    for w in [855u16, 855, 1710, 1710] {
        data.extend_from_slice(&w.to_le_bytes());
    }
    data.extend_from_slice(&block);
    file.extend_from_slice(b"DATA");
    file.extend_from_slice(&(data.len() as u32).to_le_bytes());
    file.extend_from_slice(&data);
    // A second block after a PAUS, as PZX tapes have them.
    let pzx_block =
        |tag: &[u8], body: &[u8]| [tag, &(body.len() as u32).to_le_bytes(), body].concat();
    let second = tap::block(0xFF, &[0x56]);
    let mut data2 = (24u32 | 1 << 31).to_le_bytes().to_vec();
    data2.extend_from_slice(&data[4..16]);
    data2.extend_from_slice(&second);
    file.extend(pzx_block(b"PAUS", &3_500_000u32.to_le_bytes()));
    file.extend(pzx_block(b"PULS", &puls));
    file.extend(pzx_block(b"DATA", &data2));
    let mut p = Player::new(Tape::parse(&file).unwrap(), CLOCK_48K);
    assert_eq!(
        p.take_rom_block(0),
        Some(RomBlock {
            index: 1,
            bytes: block
        })
    );
    assert_eq!(
        p.take_rom_block(0),
        Some(RomBlock {
            index: 4,
            bytes: second
        })
    );
    assert_eq!(p.take_rom_block(0), None);
}

#[test]
fn instant_loading_takes_the_block_whose_pilot_is_playing_and_not_one_already_in_its_data() {
    let blocks = vec![
        header(0, "first", 5, 0, 5),
        tap::block(0xFF, &[1, 2, 3, 4, 5]),
    ];
    let mut p = Player::new(Tape::from_blocks(&blocks), CLOCK_48K);
    p.play(0);
    // A second into the header's pilot: the ROM would hear the rest of it.
    for _ in 0..50 {
        p.end_frame(FRAME_48K);
    }
    assert_eq!(p.take_rom_block(0).map(|b| b.index), Some(0));
    // Into the data block's bytes: the ROM would miss its start; nothing after it.
    let mut p = Player::new(Tape::from_blocks(&blocks), CLOCK_48K);
    p.play(0);
    for _ in 0..(6 + 3) * 50 {
        p.end_frame(FRAME_48K);
    }
    assert_eq!(p.status().block, 1);
    assert_eq!(p.take_rom_block(0), None);
}

#[test]
fn after_a_block_is_taken_the_next_loads_from_the_tape_as_it_plays() {
    let blocks = vec![
        header(3, "code", 300, 32768, 0),
        tap::block(0xFF, &noise(6, 300)),
    ];
    let mut p = Player::new(Tape::from_blocks(&blocks), CLOCK_128K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_128K);
    m.run(12_345);
    let t = m.t;
    assert_eq!(m.player.take_rom_block(t).unwrap().bytes, blocks[0]);
    let got = ld_bytes(&mut m, 0xFF, 300, 35_000_000).unwrap();
    assert!(got.ok);
    assert_eq!(got.bytes, blocks[1][1..301]);
}

/// A PZX file: its header, then blocks of (tag, body).
fn pzx(blocks: &[(&[u8; 4], Vec<u8>)]) -> Tape {
    let mut file = b"PZXT\x02\x00\x00\x00\x01\x00".to_vec();
    for (tag, body) in blocks {
        file.extend_from_slice(*tag);
        file.extend_from_slice(&(body.len() as u32).to_le_bytes());
        file.extend_from_slice(body);
    }
    Tape::parse(&file).unwrap()
}

fn words(w: &[u16]) -> Vec<u8> {
    w.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// A PZX DATA block of a ROM block's bytes at the ROM's bits, from the level given, with the ROM's tail.
fn pzx_rom_data(high: bool, block: &[u8]) -> Vec<u8> {
    let mut d = ((block.len() as u32 * 8) | (high as u32) << 31)
        .to_le_bytes()
        .to_vec();
    d.extend_from_slice(&945u16.to_le_bytes());
    d.extend_from_slice(&[2, 2]);
    d.extend(words(&[855, 855, 1710, 1710]));
    d.extend_from_slice(block);
    d
}

/// Whether LD-BYTES, run on the tape's edges from its start, loads `block`.
fn rom_loads(tape: Tape, block: &[u8]) -> bool {
    let mut p = Player::new(tape, CLOCK_48K);
    p.play(0);
    let mut m = Machine::new(&mut p, FRAME_48K);
    let len = (block.len() - 2) as u16;
    ld_bytes(&mut m, block[0], len, 20 * 3_500_000)
        .is_some_and(|g| g.ok && g.bytes == block[1..block.len() - 1])
}

/// Whether the deck hands the tape's first block to the instant load.
fn taken(tape: Tape) -> bool {
    Player::new(tape, CLOCK_48K).take_rom_block(0).is_some()
}

#[test]
fn instant_loading_takes_only_what_ld_bytes_would_load() {
    // Each of these is a ROM block in all but one thing, which the ROM's LD-BYTES fails on, read from its
    // edges by the model: the instant load must not take it either (the machine's LD-BYTES then reads it
    // from the tape, and fails as the real one does).
    let block = tap::block(0xFF, &[0x12, 0x34]);
    let stream: Vec<u8> = block
        .iter()
        .flat_map(|&b| (0..8).rev().map(move |i| b >> i & 1))
        .collect();
    let pilot: &[(u8, &[u16])] = &[(0, &[2168]), (0, &[667, 735])];
    let bits: &[(u8, &[u16])] = &[(0, &[855, 855]), (0, &[1710, 1710])];
    let gdb = |pilot_symbols: &[(u8, &[u16])], pulses: u16, data: &[(u8, &[u16])]| {
        Tape::parse(&tzx(&[b19(
            1000,
            pilot_symbols,
            &[(0, pulses), (1, 1)],
            data,
            &stream,
        )]))
        .unwrap()
    };
    let unloadable = [
        // A pilot of one pulse, or of a hundred: over before LD-BYTES has waited its second.
        (
            "a generalized block of a one-pulse pilot",
            gdb(pilot, 1, bits),
        ),
        (
            "a generalized block of a short pilot",
            gdb(pilot, 100, bits),
        ),
        // Bits that prolong the pulse before them (polarity 1): no edge between them.
        (
            "a generalized block whose bits make no edges",
            gdb(pilot, 3223, &[(1, &[855, 855]), (1, &[1710, 1710])]),
        ),
        // A pilot that makes no edges between its pulses: one long pulse.
        (
            "a generalized block whose pilot makes no edges",
            gdb(&[(1, &[2168]), (0, &[667, 735])], 3223, bits),
        ),
        (
            "a ROM-timed 0x11 with a short pilot",
            Tape::parse(&tzx(&[b11([2168, 667, 735, 855, 1710, 300], 8, 0, &block)])).unwrap(),
        ),
        (
            "a short pure tone, the syncs and ROM bits",
            Tape::parse(&tzx(&[
                b12(2168, 500),
                b13(&[667, 735]),
                b14(855, 1710, 8, 0, &block),
            ]))
            .unwrap(),
        ),
        // PZX: DATA whose first level is the second sync pulse's (3,225 pulses from low end high: the
        // DATA must start high), so that the sync and the first bit's pulse are one.
        (
            "a PZX DATA that starts at the level the sync ended at",
            pzx(&[
                (b"PULS", words(&[0x8000 + 3223, 2168, 667, 735])),
                (b"DATA", pzx_rom_data(false, &block)),
            ]),
        ),
        // PZX: a pulse of no length between the sync pulses makes them one pulse of 1,402, which is no
        // sync (the first bit's pulse then starts low, with an edge).
        (
            "a PZX sync joined by a zero-length pulse",
            pzx(&[
                (b"PULS", words(&[0x8000 + 3223, 2168, 667, 0, 735])),
                (b"DATA", pzx_rom_data(false, &block)),
            ]),
        ),
    ];
    for (what, tape) in unloadable {
        assert!(!rom_loads(tape.clone(), &block), "the ROM loads {what}");
        assert!(!taken(tape), "the instant load takes {what}");
    }
    // While the same with the ROM's shape loads, and is taken.
    let loadable = [
        ("a generalized block", gdb(pilot, 3223, bits)),
        (
            "a PZX block",
            pzx(&[
                (b"PULS", words(&[0x8000 + 3223, 2168, 667, 735])),
                (b"DATA", pzx_rom_data(true, &block)),
            ]),
        ),
        // Two zero-length pulses are none: the pilot goes on as it was.
        (
            "a PZX pilot with a pair of zero-length pulses in it",
            pzx(&[
                (
                    b"PULS",
                    words(&[0x8000 + 3000, 2168, 0x8002, 0, 0x8000 + 223, 2168, 667, 735]),
                ),
                (b"DATA", pzx_rom_data(true, &block)),
            ]),
        ),
    ];
    for (what, tape) in loadable {
        assert!(rom_loads(tape.clone(), &block), "the ROM fails {what}");
        assert!(taken(tape), "the instant load leaves {what}");
    }
}

#[test]
fn a_loader_that_reads_the_next_block_itself_has_the_gap_the_tape_gives_it() {
    // A loader taken by the instant load that, before reading the next block with its own copy of
    // LD-BYTES (which no trap sees), spends a second on something else: on the real tape the block's
    // second of pause, and the next block's two seconds of pilot, are still to come, and it loads.
    let blocks = vec![
        header(3, "loader", 100, 32768, 0),
        tap::block(0xFF, &noise(31, 100)),
        tap::block(0xFF, &noise(32, 200)),
    ];
    for (hz, frame) in [(CLOCK_48K, FRAME_48K), (CLOCK_128K, FRAME_128K)] {
        let mut p = Player::new(Tape::from_blocks(&blocks), hz);
        p.play(0);
        let mut m = Machine::new(&mut p, frame);
        m.run(1000);
        for i in 0..2 {
            let t = m.t;
            assert_eq!(m.player.take_rom_block(t).unwrap().index, i);
        }
        m.run(3_500_000);
        let got = ld_bytes(&mut m, 0xFF, 200, 10 * 3_500_000).unwrap();
        assert!(got.ok, "at {hz} Hz");
        assert_eq!(got.bytes, blocks[2][1..201]);
    }
}
