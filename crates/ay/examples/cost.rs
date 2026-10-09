//! What the AY and the sound buffer cost: one minute of 128K sound, AY into buffer, every sample read through
//! the output stage, for a few kinds of load, timed on this machine. A tool for looking into speed, not a test
//! (it judges the machine as well as the code).
//!
//!     cargo run --release -p ay --example cost [-- --json]

use std::time::Instant;

/// The loads: register values written at T-state 0.
const LOADS: [(&str, &[(u8, u8)]); 4] = [
    ("silent", &[(7, 0x3F)]),
    (
        "three tones near 440 Hz",
        &[
            (0, 0xFC),
            (2, 0xC8),
            (4, 0x96),
            (7, 0x38),
            (8, 15),
            (9, 12),
            (10, 10),
        ],
    ),
    (
        "noise and envelopes",
        &[
            (6, 5),
            (7, 0x07),
            (8, 0x10),
            (9, 0x10),
            (10, 0x10),
            (11, 0x20),
            (13, 0x0E),
        ],
    ),
    (
        "worst: every period 1",
        &[
            (0, 1),
            (2, 1),
            (4, 1),
            (6, 1),
            (7, 0),
            (8, 0x10),
            (9, 15),
            (10, 15),
            (13, 0x0E),
        ],
    ),
];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!(
            "cost [--json]: times one minute of 128K sound (AY into a 48 kHz buffer) for each of a few loads"
        );
        return;
    }
    let json = args.iter().any(|a| a == "--json");
    let mut results = Vec::new();
    for (name, writes) in LOADS {
        let mut ay = ay::Ay::new(ay::Chip::Ay8912, 1_773_450, 3_546_900);
        ay.set_mix(ay::Mix {
            stereo: ay::Stereo::Abc,
            separation: 0.7,
            gain: 0.6,
        });
        let mut sound = audio::Buffer::new(3_546_900, 48_000);
        for &(r, v) in writes {
            ay.select(r);
            ay.write(0, v, &mut sound);
        }
        let mut out = vec![0.0f32; 4096];
        let start = Instant::now();
        for _ in 0..50 * 60 {
            ay.end_frame(70_908, &mut sound);
            sound.end_frame(70_908);
            sound.read_samples(&mut out);
        }
        let seconds = start.elapsed().as_secs_f64();
        results.push((name, seconds));
    }
    if json {
        let items: Vec<String> = results
            .iter()
            .map(|(name, s)| {
                format!(
                    "{{\"load\":\"{name}\",\"seconds\":{s:.4},\"share_of_real_time\":{:.5}}}",
                    s / 60.0
                )
            })
            .collect();
        println!("[{}]", items.join(","));
    } else {
        for (name, s) in results {
            println!(
                "{name}: a minute in {:.1} ms, {:.2}% of real time",
                s * 1e3,
                s / 60.0 * 100.0
            );
        }
    }
}
