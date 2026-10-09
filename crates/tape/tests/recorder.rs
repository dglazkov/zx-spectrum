//! Saving: the MIC line as the ROM's SA-BYTES drives it (modelled T-state by T-state in tests/common),
//! read back into TAP blocks by the Recorder.

mod common;

use common::*;
use tape::*;

#[test]
fn the_sa_bytes_model_makes_the_rom_s_pulses() {
    // PZX's specification measures the ROM's pulses: 2168 for the pilot, 667 and 735 for the syncs, 855 and
    // 1710 for the bits, but +1 for a bit's first pulse right after the sync, -3 for the first of each
    // byte after it, -1 for the parity byte's, and a tail of 945 before the line goes low.
    let (edges, _) = sa_bytes(0xFF, &[0x00, 0xFF]);
    let pulses: Vec<u64> = edges.windows(2).map(|w| w[1].0 - w[0].0).collect();
    assert_eq!(pulses.len(), 3222 + 2 + 4 * 16 + 1);
    assert!(pulses[..3222].iter().all(|&p| p == 2168));
    assert_eq!(&pulses[3222..3224], &[667, 735]);
    let bits = &pulses[3224..];
    // The flag 0xFF: 1s, the first pulse one long.
    assert_eq!(&bits[..4], &[1711, 1710, 1710, 1710]);
    // 0x00: 0s, the first pulse three short.
    assert_eq!(&bits[16..20], &[852, 855, 855, 855]);
    // 0xFF again, then the parity 0x00, its first pulse one short.
    assert_eq!(&bits[32..34], &[1707, 1710]);
    assert_eq!(&bits[48..50], &[854, 855]);
    assert_eq!(bits[64], 945);
    // The first sync pulse is high, the second low, each bit starting high; the tail ends low.
    let sync = edges.len() - 2 - 64 - 2;
    assert_eq!(
        (edges[sync].1, edges[sync + 1].1, edges[sync + 2].1),
        (true, false, true)
    );
    assert!(!edges.last().unwrap().1);
    // A header's pilot is longer: 8,064 OUTs, of which the first writes the low the line is already at, so
    // 8,063 edges each begin a pilot pulse, as TZX counts them.
    let (header, _) = sa_bytes(0x00, &[0; 17]);
    assert_eq!(header.len() - 2 - 19 * 16 - 1, 8063);
}

/// Feeds the MIC edges of SAVEs, one after another with a second between, to a recorder on a machine's
/// frames, with up to `jitter` T-states of contention on each edge. The blocks it records.
fn record(saves: &[(u8, Vec<u8>)], frame: u32, jitter: u64) -> Vec<Vec<u8>> {
    let mut r = Recorder::new();
    let mut frame_start = 0u64;
    let mut at = 12_345u64;
    let mut noise_at = 0;
    let wobble = noise(99, 1_000_000);
    let mut feed = |r: &mut Recorder, t: u64, level: bool| {
        while t >= frame_start + frame as u64 {
            r.end_frame(frame);
            frame_start += frame as u64;
        }
        r.mic((t - frame_start) as u32, level);
    };
    for (flag, data) in saves {
        let (edges, end) = sa_bytes(*flag, data);
        for (t, level) in edges {
            noise_at += 1;
            let j = if jitter > 0 {
                wobble[noise_at % wobble.len()] as u64 % (jitter + 1)
            } else {
                0
            };
            feed(&mut r, at + t + j, level);
        }
        at += end + 3_500_000;
    }
    assert!(r.is_recording() || saves.is_empty() || r.blocks().len() == saves.len());
    for _ in 0..3 {
        r.end_frame(frame);
    }
    assert!(!r.is_recording());
    r.take_blocks()
}

#[test]
fn a_save_is_recorded_as_its_tap_blocks() {
    let header = header(3, "screen", 6912, 16384, 32768)[1..18].to_vec();
    let screen = noise(4, 6912);
    let saves = vec![(0x00, header.clone()), (0xFF, screen.clone())];
    let want = vec![tap::block(0x00, &header), tap::block(0xFF, &screen)];
    assert_eq!(record(&saves, FRAME_48K, 0), want);
    // Port 0xFE's contention can delay each OUT by up to six T-states; the 128K frames differ.
    assert_eq!(record(&saves, FRAME_128K, 6), want);
}

#[test]
fn every_byte_value_is_recorded() {
    let saves: Vec<(u8, Vec<u8>)> = vec![
        (0xFF, (0..=255).collect()),
        (0xFF, vec![0x00; 100]),
        (0xFF, vec![0xFF; 100]),
        (0x42, vec![0x55, 0xAA, 0x0F]),
        (0xFF, vec![]),
    ];
    let want: Vec<Vec<u8>> = saves.iter().map(|(f, d)| tap::block(*f, d)).collect();
    assert_eq!(record(&saves, FRAME_48K, 3), want);
}

#[test]
fn what_is_recorded_loads_back_through_ld_bytes() {
    let program = noise(8, 900);
    let header = header(0, "saved", 900, 10, 900);
    let blocks = record(
        &[(0x00, header[1..18].to_vec()), (0xFF, program.clone())],
        FRAME_48K,
        6,
    );
    let mut r = Recorder::new();
    assert!(r.tap().is_empty());
    r = Recorder::default();
    assert!(r.blocks().is_empty());
    let file = tap::write(&blocks);
    let tape = Tape::parse(&file).unwrap();
    assert_eq!(tape.blocks[0].describe(), "Program: saved LINE 10");
    for (hz, frame) in [(CLOCK_48K, FRAME_48K), (CLOCK_128K, FRAME_128K)] {
        let mut p = Player::new(tape.clone(), hz);
        p.play(0);
        let mut m = Machine::new(&mut p, frame);
        let h = ld_bytes(&mut m, 0x00, 17, 35_000_000).unwrap();
        assert!(h.ok);
        assert_eq!(h.bytes, header[1..18]);
        let d = ld_bytes(&mut m, 0xFF, 900, 35_000_000).unwrap();
        assert!(d.ok);
        assert_eq!(d.bytes, program);
    }
}

#[test]
fn sound_on_the_mic_line_is_not_a_block() {
    // BEEP-like tones and noise: no pilot of hundreds of pulses at the ROM's length, so nothing.
    let mut r = Recorder::new();
    let mut t = 0u64;
    let mut level = false;
    for (i, &n) in noise(5, 20_000).iter().enumerate() {
        t += if i < 10_000 {
            1000
        } else {
            300 + n as u64 * 12
        };
        level = !level;
        while t >= 69_888 {
            r.end_frame(69_888);
            t -= 69_888;
        }
        r.mic(t as u32, level);
    }
    r.end_frame(69_888);
    r.end_frame(69_888);
    assert!(r.blocks().is_empty());
}

#[test]
fn saves_one_straight_after_another_are_recorded_apart() {
    // A program that calls SA-BYTES again as soon as it returns, with no second between: the next block's
    // pilot follows the last one's tail at once, and begins a block of its own.
    let header = header(3, "fast", 300, 32768, 0)[1..18].to_vec();
    let saves = [
        (0x00, header.clone()),
        (0xFF, noise(21, 300)),
        (0xFF, vec![0xFF; 8]),
    ];
    for (frame, jitter) in [(FRAME_48K, 0), (FRAME_128K, 6)] {
        let mut r = Recorder::new();
        let mut frame_start = 0u64;
        let mut at = 1_000u64;
        let wobble = noise(77, 100_000);
        let mut k = 0;
        for (flag, data) in &saves {
            let (edges, end) = sa_bytes(*flag, data);
            for (t, level) in edges {
                k += 1;
                let j = wobble[k % wobble.len()] as u64 % (jitter + 1);
                while at + t + j >= frame_start + frame as u64 {
                    r.end_frame(frame);
                    frame_start += frame as u64;
                }
                r.mic((at + t + j - frame_start) as u32, level);
            }
            // What is left of SA/LD-RET after its OUT, a RET, and a CALL to SA-BYTES again.
            at += end + 60;
        }
        for _ in 0..2 {
            r.end_frame(frame);
        }
        let want: Vec<Vec<u8>> = saves.iter().map(|(f, d)| tap::block(*f, d)).collect();
        assert_eq!(r.take_blocks(), want, "frames of {frame}");
    }
}
