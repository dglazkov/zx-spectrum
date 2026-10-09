//! The AY-3-8912 (and the YM2149) against the data manual: tone and noise frequencies, the noise generator's
//! sequence, every envelope shape step by step against the manual's drawing of it, the mixer's truth table,
//! the registers' read-back, the I/O port, the clocks, the stereo placement, and saving and restoring.

use audio::{Sink, UNIT};
use ay::{Ay, Chip, Mix, REGISTER_MASKS, Stereo};

/// The 128K's clocks: the AY at half the CPU's, so a tick (8 AY cycles) is exactly 16 T-states.
const AY_128: u32 = 1_773_450;
const CPU_128: u32 = 3_546_900;
const TICK: u32 = 16;
const FRAME_128: u32 = 70_908;

/// Records every step, and the level it leaves on each side.
#[derive(Default)]
struct Record {
    steps: Vec<(u32, i32, i32)>,
}

impl Sink for Record {
    fn add_step(&mut self, t: u32, left: i32, right: i32) {
        self.steps.push((t, left, right));
    }
}

fn psg() -> Ay {
    Ay::new(Chip::Ay8912, AY_128, CPU_128)
}

fn set(ay: &mut Ay, out: &mut impl Sink, t: u32, register: u8, value: u8) {
    ay.select(register);
    ay.write(t, value, out);
}

/// Channel A alone, tone on, noise off, at full volume.
fn tone_a(ay: &mut Ay, out: &mut impl Sink, period: u16) {
    set(ay, out, 0, 0, period as u8);
    set(ay, out, 0, 1, (period >> 8) as u8);
    set(ay, out, 0, 7, 0b0011_1110);
    set(ay, out, 0, 8, 15);
}

/// The T-states between successive steps of a record.
fn gaps(steps: &[(u32, i32, i32)]) -> Vec<u32> {
    steps.windows(2).map(|w| w[1].0 - w[0].0).collect()
}

#[test]
fn tone_frequency_is_the_clock_over_16_times_the_period() {
    for period in [1u16, 2, 3, 10, 100, 0xFE, 0x3FF, 0xFFF] {
        let mut ay = psg();
        let mut rec = Record::default();
        tone_a(&mut ay, &mut rec, period);
        // Twenty half-periods, crossing frame boundaries for the long periods.
        let half = period as u32 * TICK;
        let mut frames = 0;
        while (frames * FRAME_128) < 21 * half + 1 {
            ay.end_frame(FRAME_128, &mut rec);
            frames += 1;
        }
        // Rebase the record's T-states onto one time line.
        let mut base = 0;
        let mut last = 0;
        let steps: Vec<u32> = rec
            .steps
            .iter()
            .map(|&(t, _, _)| {
                if t < last {
                    base += FRAME_128;
                }
                last = t;
                base + t
            })
            .collect();
        let edges: Vec<u32> = steps
            .windows(2)
            .map(|w| w[1] - w[0])
            .skip(1)
            .take(19)
            .collect();
        assert!(
            edges.iter().all(|&g| g == half),
            "period {period}: {edges:?}"
        );
        // f = clock / (16 × TP): half a period is 8 × TP of the AY's cycles.
        let f = AY_128 as f64 / (16.0 * period as f64);
        let measured = CPU_128 as f64 / (2.0 * half as f64);
        assert!((f - measured).abs() < 1e-9 * f);
    }
}

#[test]
fn tone_period_0_is_period_1() {
    let edges = |period| {
        let mut ay = psg();
        let mut rec = Record::default();
        tone_a(&mut ay, &mut rec, period);
        ay.run(1_000, &mut rec);
        rec.steps
    };
    assert_eq!(edges(0), edges(1));
    assert!(gaps(&edges(0)[1..]).iter().all(|&g| g == TICK));
}

#[test]
fn lowering_the_period_below_the_count_turns_the_tone_at_the_next_tick() {
    // The counter counts up and compares "greater or equal" (MAME): lowered under the count, it comes round at
    // once rather than counting on to 4,095.
    let mut ay = psg();
    let mut rec = Record::default();
    tone_a(&mut ay, &mut rec, 1000);
    ay.run(500 * TICK + 1, &mut rec); // the counter is at 500
    let before = rec.steps.len();
    set(&mut ay, &mut rec, 500 * TICK + 1, 1, 0);
    set(&mut ay, &mut rec, 500 * TICK + 1, 0, 10);
    ay.run(502 * TICK + 1, &mut rec);
    assert_eq!(rec.steps.len(), before + 1);
    assert_eq!(rec.steps.last().unwrap().0, 501 * TICK);
}

/// The noise generator as the data manual and MAME describe it: 17 bits, shifted right, the new bit 16 being
/// bit 0 XOR bit 3, bit 0 the output; it starts at 1.
fn reference_noise(n: usize) -> Vec<bool> {
    let mut r: u32 = 1;
    (0..n)
        .map(|_| {
            r = (r >> 1) | (((r ^ (r >> 3)) & 1) << 16);
            r & 1 != 0
        })
        .collect()
}

#[test]
fn the_noise_sequence_is_the_17_bit_lfsr_and_repeats_after_131071() {
    // Channel A: noise only, period 1, so the register shifts every second tick (32 T-states).
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 6, 1);
    set(&mut ay, &mut rec, 0, 7, 0b0011_0111);
    set(&mut ay, &mut rec, 0, 8, 15);
    let n = 2 * 131_071 + 100;
    let mut bits = Vec::with_capacity(n);
    let mut t = 0u32;
    for _ in 0..n {
        // The shift happens on every second tick; look just after it.
        t += 2 * TICK;
        let target = t - TICK + 1;
        if target > FRAME_128 {
            ay.end_frame(FRAME_128, &mut rec);
            t -= FRAME_128;
            ay.run(t - TICK + 1, &mut rec);
        } else {
            ay.run(target, &mut rec);
        }
        bits.push(ay.outputs()[0] == 15);
    }
    assert_eq!(bits, reference_noise(n));
    assert!((0..n - 131_071).all(|i| bits[i] == bits[i + 131_071]));
    // 131,071 is prime, so the period is that or 1, and the sequence is not constant.
    assert!(bits.iter().any(|&b| b) && bits.iter().any(|&b| !b));
}

#[test]
fn noise_shifts_at_the_clock_over_16_times_the_period() {
    for (period, expect) in [(0u8, 1u32), (1, 1), (2, 2), (5, 5), (31, 31)] {
        let mut ay = psg();
        let mut rec = Record::default();
        set(&mut ay, &mut rec, 0, 6, period);
        // Count the shifts over 2,000 ticks: one every 2 × period ticks, f = clock / (16 × NP).
        let mut shifts = 0;
        let mut last = ay.state().lfsr;
        for k in 1..=2_000 {
            ay.run(k * TICK + 1, &mut rec);
            if ay.state().lfsr != last {
                shifts += 1;
                last = ay.state().lfsr;
            }
        }
        assert_eq!(shifts, 2_001 / (2 * expect), "period {period}");
    }
}

/// The data manual's drawing of each envelope shape (Fig. 7, "Envelope shape/cycle control"), one character a
/// cycle: \ counts down, / counts up, _ holds at 0, ¯ holds at the top. The manual draws the first cycle and
/// what follows; the last character repeats.
const SHAPES: [&str; 16] = [
    "\\_", "\\_", "\\_", "\\_", // 0 0 x x
    "/_", "/_", "/_", "/_",     // 0 1 x x
    "\\\\",   // 1 0 0 0
    "\\_",    // 1 0 0 1
    "\\/\\/", // 1 0 1 0
    "\\¯",    // 1 0 1 1
    "//",     // 1 1 0 0
    "/¯",     // 1 1 0 1
    "/\\/\\", // 1 1 1 0
    "/_",     // 1 1 1 1
];

/// `cycles` cycles of a drawing, as volumes step by step, `top` being the highest step. A drawing of two
/// characters repeats its second; one of four (the triangles) repeats as a whole.
fn drawn(shape: &str, cycles: usize, top: u8) -> Vec<u8> {
    let chars: Vec<char> = shape.chars().collect();
    (0..cycles)
        .flat_map(|c| {
            let ch = if chars.len() == 4 {
                chars[c % 4]
            } else {
                chars[c.min(chars.len() - 1)]
            };
            match ch {
                '\\' => (0..=top).rev().collect::<Vec<u8>>(),
                '/' => (0..=top).collect(),
                '_' => vec![0; top as usize + 1],
                '¯' => vec![top; top as usize + 1],
                _ => unreachable!(),
            }
        })
        .collect()
}

/// The envelope's volume at the middle of each of its steps after register 13 is written, `ticks_per_step`
/// ticks a step, for `steps` steps.
fn envelope_steps(
    chip: Chip,
    shape: u8,
    period: u16,
    ticks_per_step: u32,
    steps: usize,
) -> Vec<u8> {
    let mut ay = Ay::new(chip, AY_128, CPU_128);
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 11, period as u8);
    set(&mut ay, &mut rec, 0, 12, (period >> 8) as u8);
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    set(&mut ay, &mut rec, 0, 8, 0x10);
    // Written between ticks 0 and 1: the steps then change on ticks 1 + k × ticks_per_step.
    set(&mut ay, &mut rec, 8, 13, shape);
    let mut out = Vec::new();
    let mut t = 8u32;
    for _ in 0..steps {
        let middle = t + ticks_per_step * TICK / 2;
        if middle >= FRAME_128 {
            ay.end_frame(FRAME_128, &mut rec);
            t -= FRAME_128;
            ay.run(t + ticks_per_step * TICK / 2, &mut rec);
        } else {
            ay.run(middle, &mut rec);
        }
        out.push(ay.outputs()[0]);
        t += ticks_per_step * TICK;
    }
    out
}

#[test]
fn every_envelope_shape_is_the_data_manuals_drawing_step_by_step() {
    for shape in 0..16u8 {
        // EP = 1: a step every 16 AY cycles, two ticks.
        let got = envelope_steps(Chip::Ay8912, shape, 1, 2, 16 * 5);
        assert_eq!(
            got,
            drawn(SHAPES[shape as usize], 5, 15),
            "shape {shape:04b}"
        );
    }
}

#[test]
fn an_envelope_step_lasts_16_times_the_period_in_ay_cycles() {
    // EP = 3: 48 AY cycles, six ticks a step; a full cycle of 16 steps is 256 × EP cycles, f = clock / (256 EP).
    let got = envelope_steps(Chip::Ay8912, 0b1100, 3, 6, 48);
    assert_eq!(got, drawn("//", 3, 15));
    // EP = 0 steps every tick on the AY: twice as fast as EP = 1 (MAME's finding).
    let got = envelope_steps(Chip::Ay8912, 0b1100, 0, 1, 48);
    assert_eq!(got, drawn("//", 3, 15));
}

#[test]
fn writing_register_13_restarts_the_envelope() {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 11, 1);
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    set(&mut ay, &mut rec, 0, 8, 0x10);
    set(&mut ay, &mut rec, 8, 13, 0b1000); // \\\\
    ay.run(8 + 10 * 2 * TICK, &mut rec);
    assert_eq!(ay.outputs()[0], 5);
    // The same shape written again starts it again from the top, at once.
    set(&mut ay, &mut rec, 8 + 10 * 2 * TICK, 13, 0b1000);
    assert_eq!(ay.outputs()[0], 15);
    assert_eq!(rec.steps.last().unwrap().0, 8 + 10 * 2 * TICK);
}

#[test]
fn the_ym2149_envelope_has_32_steps_twice_as_fast() {
    for shape in 0..16u8 {
        // EP = 1: a step every 8 YM cycles, one tick; the cycle takes as long as the AY's.
        let got = envelope_steps(Chip::Ym2149, shape, 1, 1, 32 * 4);
        assert_eq!(
            got,
            drawn(SHAPES[shape as usize], 4, 31),
            "shape {shape:04b}"
        );
    }
    // EP = 0 is EP = 1 on the YM2149 (Hatari, measured on an Atari ST).
    assert_eq!(
        envelope_steps(Chip::Ym2149, 0b1110, 0, 1, 96),
        drawn("/\\/\\", 3, 31)
    );
}

#[test]
fn the_mixer_follows_its_truth_table() {
    // For each channel and each of the four settings of its two active-low enables, against the generators'
    // own outputs, tick by tick: (tone or tone disabled) and (noise or noise disabled) lets the volume through.
    for enables in 0..64u8 {
        let mut ay = psg();
        let mut rec = Record::default();
        set(&mut ay, &mut rec, 0, 0, 3);
        set(&mut ay, &mut rec, 0, 2, 5);
        set(&mut ay, &mut rec, 0, 4, 7);
        set(&mut ay, &mut rec, 0, 6, 1);
        set(&mut ay, &mut rec, 0, 7, enables);
        for (ch, volume) in [(0, 15u8), (1, 9), (2, 4)] {
            set(&mut ay, &mut rec, 0, 8 + ch, volume);
        }
        let mut seen = [[false; 2]; 3];
        for k in 1..300 {
            ay.run(k * TICK + 1, &mut rec);
            let s = ay.state();
            for (ch, volume) in [(0usize, 15u8), (1, 9), (2, 4)] {
                let tone_disabled = enables & (1 << ch) != 0;
                let noise_disabled = enables & (8 << ch) != 0;
                let pass =
                    (s.tone_high[ch] || tone_disabled) && (s.lfsr & 1 != 0 || noise_disabled);
                assert_eq!(
                    ay.outputs()[ch],
                    if pass { volume } else { 0 },
                    "enables {enables:06b}, channel {ch}"
                );
                seen[ch][pass as usize] = true;
            }
        }
        // Both disabled: the volume, constantly (and nothing else ever is).
        for (ch, seen) in seen.iter().enumerate() {
            let both_off = enables & (1 << ch) != 0 && enables & (8 << ch) != 0;
            assert_eq!(!seen[0], both_off, "enables {enables:06b}, channel {ch}");
        }
    }
}

#[test]
fn volume_is_fixed_or_the_envelope_by_bit_4() {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    set(&mut ay, &mut rec, 0, 13, 0b1101); // /¯: the envelope climbs from 0
    set(&mut ay, &mut rec, 0, 8, 7);
    assert_eq!(ay.outputs()[0], 7);
    set(&mut ay, &mut rec, 0, 8, 0x17); // bit 4: the envelope, whatever the low bits say
    assert_eq!(ay.outputs()[0], 0);
    set(&mut ay, &mut rec, 0, 8, 0x0F);
    assert_eq!(ay.outputs()[0], 15);
}

#[test]
fn registers_read_back_through_their_masks() {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 7, 0xC0); // both ports outputs, so 14 and 15 read back what is written
    for r in 0..16u8 {
        if r == 7 {
            continue;
        }
        set(&mut ay, &mut rec, 0, r, 0xFF);
        ay.select(r);
        assert_eq!(ay.read(), Some(REGISTER_MASKS[r as usize]), "register {r}");
    }
    // The YM2149 keeps every bit.
    let mut ym = Ay::new(Chip::Ym2149, AY_128, CPU_128);
    for r in 0..14u8 {
        set(&mut ym, &mut rec, 0, r, 0xFF);
        ym.select(r);
        assert_eq!(ym.read(), Some(0xFF), "register {r}");
    }
}

#[test]
fn an_address_with_high_bits_set_deselects_the_chip() {
    let mut ay = psg();
    let mut rec = Record::default();
    assert_eq!(ay.read(), None, "nothing is latched after a reset");
    set(&mut ay, &mut rec, 0, 8, 9);
    ay.select(0x18);
    assert_eq!(ay.read(), None);
    ay.write(0, 3, &mut rec); // ignored
    ay.select(8);
    assert_eq!(ay.read(), Some(9));
}

#[test]
fn port_a_reads_its_pins_as_an_input_and_its_latch_through_them_as_an_output() {
    let mut ay = psg();
    let mut rec = Record::default();
    ay.set_port_a_input(0b1011_1111);
    set(&mut ay, &mut rec, 0, 14, 0x5A); // stored, not driven: the port is an input
    assert_eq!(ay.port_a_output(), None);
    ay.select(14);
    assert_eq!(ay.read(), Some(0b1011_1111));
    set(&mut ay, &mut rec, 0, 7, 0x40);
    assert_eq!(ay.port_a_output(), Some(0x5A));
    ay.select(14);
    assert_eq!(ay.read(), Some(0x5A & 0b1011_1111));
    // Port B has no pins on the 8912: an input reads high, an output its latch.
    set(&mut ay, &mut rec, 0, 15, 0x33);
    ay.select(15);
    assert_eq!(ay.read(), Some(0xFF));
    set(&mut ay, &mut rec, 0, 7, 0x80);
    ay.select(15);
    assert_eq!(ay.read(), Some(0x33));
}

#[test]
fn ticks_fall_at_exact_t_states_on_any_pair_of_clocks_without_drift() {
    for (ay_clock, cpu, frame) in [
        (AY_128, CPU_128, FRAME_128),
        (1_750_000, 3_500_000, 71_680), // the Pentagon
        (2_000_000, 3_546_900, FRAME_128),
        (1_000_000, 3_500_000, 69_888),
    ] {
        let mut ay = Ay::new(Chip::Ay8912, ay_clock, cpu);
        let mut rec = Record::default();
        tone_a(&mut ay, &mut rec, 1); // a step every tick
        let frames = 300u64;
        let mut times = Vec::new();
        for f in 0..frames {
            rec.steps.clear();
            ay.end_frame(frame, &mut rec);
            times.extend(
                rec.steps
                    .iter()
                    .map(|&(t, _, _)| f * frame as u64 + t as u64),
            );
        }
        // Tick k falls at floor(k × 8 × cpu / ay) T-states.
        for (k, &t) in times.iter().enumerate().skip(1) {
            assert_eq!(
                t,
                k as u64 * 8 * cpu as u64 / ay_clock as u64,
                "tick {k} at {ay_clock} / {cpu}"
            );
        }
        let total = frames * frame as u64;
        assert_eq!(
            times.len() as u64,
            (total * ay_clock as u64).div_ceil(8 * cpu as u64)
        );
    }
}

#[test]
fn a_volume_change_is_heard_at_the_t_state_of_its_write() {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    set(&mut ay, &mut rec, 1_234, 8, 15);
    set(&mut ay, &mut rec, 1_301, 8, 0);
    let times: Vec<u32> = rec.steps.iter().map(|s| s.0).collect();
    assert_eq!(times, vec![1_234, 1_301]);
}

#[test]
fn the_dac_levels_are_westcotts_measurements_in_mono() {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    let volts = ay::dac::AY_8912_VOLTS;
    let mut level = 0i32;
    for v in 0..16u8 {
        set(&mut ay, &mut rec, 0, 8, v);
        level += rec.steps.drain(..).map(|s| s.1).sum::<i32>();
        let expect = (volts[v as usize] - volts[0]) / (volts[15] - volts[0]) / 3.0 * UNIT as f64;
        assert!(
            (level as f64 - expect).abs() <= 0.5,
            "volume {v}: {level} against {expect}"
        );
    }
}

#[test]
fn stereo_places_the_channels() {
    let place = |stereo, separation| {
        let mut ay = psg();
        ay.set_mix(Mix {
            stereo,
            separation,
            gain: 1.0,
        });
        let mut rec = Record::default();
        set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
        [0u8, 1, 2].map(|ch| {
            rec.steps.clear();
            set(&mut ay, &mut rec, 0, 8 + ch, 15);
            let s = rec.steps[0];
            set(&mut ay, &mut rec, 0, 8 + ch, 0);
            (s.1, s.2)
        })
    };
    let third = UNIT / 3;
    let two_thirds = (2.0 * UNIT as f64 / 3.0).round() as i32;
    assert_eq!(place(Stereo::Mono, 1.0), [(third, third); 3]);
    assert_eq!(
        place(Stereo::Abc, 1.0),
        [(two_thirds, 0), (third, third), (0, two_thirds)]
    );
    assert_eq!(
        place(Stereo::Acb, 1.0),
        [(two_thirds, 0), (0, two_thirds), (third, third)]
    );
    assert_eq!(place(Stereo::Abc, 0.0), place(Stereo::Mono, 1.0));
    let half = place(Stereo::Abc, 0.5);
    assert_eq!(
        half[0],
        (
            (UNIT as f64 * 0.5).round() as i32,
            (UNIT as f64 / 6.0).round() as i32
        )
    );
}

#[test]
fn a_new_mix_moves_the_sound_at_the_next_tick() {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    set(&mut ay, &mut rec, 0, 8, 15);
    rec.steps.clear();
    ay.set_mix(Mix {
        stereo: Stereo::Abc,
        separation: 1.0,
        gain: 1.0,
    });
    ay.run(TICK + 1, &mut rec);
    let (l, r) = rec
        .steps
        .iter()
        .fold((UNIT / 3, UNIT / 3), |(l, r), s| (l + s.1, r + s.2));
    assert_eq!((l, r), ((2.0 * UNIT as f64 / 3.0).round() as i32, 0));
}

#[test]
fn a_saved_state_plays_on_exactly_as_before() {
    // A busy chip: tones, noise and a repeating envelope on all three channels.
    let mut ay = psg();
    let mut rec = Record::default();
    for (r, v) in [
        (0, 0x55),
        (1, 1),
        (2, 0x77),
        (4, 0x13),
        (5, 2),
        (6, 7),
        (7, 0b0010_0100),
        (8, 12),
        (9, 0x10),
    ] {
        set(&mut ay, &mut rec, 0, r, v);
    }
    set(&mut ay, &mut rec, 0, 10, 9);
    set(&mut ay, &mut rec, 0, 11, 0x40);
    set(&mut ay, &mut rec, 0, 13, 0b1110);
    for _ in 0..5 {
        ay.end_frame(FRAME_128, &mut rec);
    }
    let saved = ay.state();
    // The level each side is at, then every step of the next five frames, as absolute levels in time.
    let levels = |ay: &mut Ay| {
        let mut rec = Record::default();
        let mut out = Vec::new();
        for f in 0..5u32 {
            rec.steps.clear();
            ay.end_frame(FRAME_128, &mut rec);
            out.extend(rec.steps.iter().map(|&(t, l, r)| (f * FRAME_128 + t, l, r)));
        }
        out
    };
    let level_at_save: (i32, i32) = rec
        .steps
        .iter()
        .fold((0, 0), |(l, r), s| (l + s.1, r + s.2));
    let first = levels(&mut ay);
    let after_first: (i32, i32) = first
        .iter()
        .fold(level_at_save, |(l, r), s| (l + s.1, r + s.2));
    ay.set_state(&saved);
    assert_eq!(ay.state(), saved);
    let second = levels(&mut ay);
    // Played again from the saved state, the levels follow the same course at the same T-states; the first
    // step of the replay also brings the sound back from where the first run left it.
    let course = |start: (i32, i32), steps: &[(u32, i32, i32)]| {
        let mut level = start;
        let mut out: Vec<(u32, (i32, i32))> = Vec::new();
        for &(t, l, r) in steps {
            level = (level.0 + l, level.1 + r);
            match out.last_mut() {
                Some(last) if last.0 == t => last.1 = level,
                _ => out.push((t, level)),
            }
        }
        out
    };
    let a = course(level_at_save, &first);
    let b = course(after_first, &second);
    let tail =
        |c: &[(u32, (i32, i32))]| c.iter().filter(|e| e.0 > TICK).cloned().collect::<Vec<_>>();
    assert_eq!(tail(&a), tail(&b));
}

#[test]
fn joined_outputs_follow_westcotts_curve_alone_and_compress_together() {
    let level_of = |volumes: [u8; 3], stereo: Stereo, chip: Chip| {
        let mut ay = Ay::new(chip, AY_128, CPU_128);
        ay.set_mix(Mix {
            stereo,
            separation: 1.0,
            gain: 1.0,
        });
        let mut rec = Record::default();
        set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
        for (ch, v) in volumes.iter().enumerate() {
            set(&mut ay, &mut rec, 0, 8 + ch as u8, *v);
        }
        let (l, r) = rec
            .steps
            .iter()
            .fold((0, 0), |(l, r), s| (l + s.1, r + s.2));
        assert_eq!(l, r);
        l as f64 / UNIT as f64
    };
    let volts = ay::dac::AY_8912_VOLTS;
    let alone_full = level_of([15, 0, 0], Stereo::Joined, Chip::Ay8912);
    // Alone, a channel's levels are the measured curve (they were measured joined to the other two at 0).
    for v in 0..16u8 {
        let expect = (volts[v as usize] - volts[0]) / (volts[15] - volts[0]) * alone_full;
        let got = level_of([0, v, 0], Stereo::Joined, Chip::Ay8912);
        assert!(
            (got - expect).abs() < 2e-6,
            "volume {v}: {got} against {expect}"
        );
    }
    // Together they compress: one at full is 0.58 of all three, where added it would be a third.
    assert!((level_of([15, 15, 15], Stereo::Joined, Chip::Ay8912) - 1.0).abs() < 1e-6);
    assert!((alone_full - 0.5813).abs() < 1e-3, "{alone_full}");
    assert!((level_of([15, 0, 0], Stereo::Mono, Chip::Ay8912) - 1.0 / 3.0).abs() < 1e-6);
    let two = level_of([15, 15, 0], Stereo::Joined, Chip::Ay8912);
    assert!(two > alone_full && two < 2.0 * alone_full && two < 1.0);
    // Louder in every channel is never quieter.
    let mut last = -1.0;
    for v in 0..16u8 {
        let now = level_of([v, 7, 3], Stereo::Joined, Chip::Ay8912);
        assert!(now > last);
        last = now;
    }
    // The YM2149 has no such measurement: joined is mono.
    assert_eq!(
        level_of([15, 9, 0], Stereo::Joined, Chip::Ym2149),
        level_of([15, 9, 0], Stereo::Mono, Chip::Ym2149)
    );
}

// --- Changes made outside a write ---

/// Runs one frame of the 128K and gives the T-states at which the chip put out steps.
fn step_times(ay: &mut Ay) -> Vec<u32> {
    let mut rec = Record::default();
    ay.end_frame(FRAME_128, &mut rec);
    rec.steps.iter().map(|s| s.0).collect()
}

/// A chip holding a steady level (channel A at volume 15, tone and noise off) a frame on, so that nothing it does
/// would put out a step before the frame's end.
fn steady() -> Ay {
    let mut ay = psg();
    let mut rec = Record::default();
    set(&mut ay, &mut rec, 0, 7, 0b0011_1111);
    set(&mut ay, &mut rec, 0, 8, 15);
    ay.end_frame(FRAME_128, &mut rec);
    assert!(step_times(&mut ay).is_empty());
    ay
}

#[test]
fn changes_made_outside_a_write_are_heard_from_the_next_tick() {
    // A new mix, a restored state, a register stored for a snapshot, a reset: none comes with a T-state, and each
    // is heard from the chip's next tick, as when every tick is run on its own. A chip holding a steady level
    // takes the rest of the frame in one go; the change must not wait for the end of it.
    let names = [
        "a new mix",
        "a restored state",
        "a stored register",
        "a reset",
    ];
    for (change, name) in names.iter().enumerate() {
        let mut ay = steady();
        let mut rec = Record::default();
        match change {
            0 => ay.set_mix(Mix {
                stereo: Stereo::Abc,
                separation: 1.0,
                gain: 1.0,
            }),
            1 => {
                let saved = ay.state();
                set(&mut ay, &mut rec, 0, 8, 3);
                ay.end_frame(FRAME_128, &mut rec);
                ay.set_state(&saved);
            }
            2 => ay.set_register(9, 15),
            _ => ay.reset(),
        }
        let next = ay.state().next_tick;
        assert_eq!(step_times(&mut ay), vec![next], "{name}");
    }
}

#[test]
fn a_state_from_the_other_chip_cannot_reach_outside_the_dac() {
    // The YM2149's envelope has 32 steps, the AY-3-8912's DAC 16 levels: a state saved from the one and put into
    // the other (or a damaged one) is kept within what the chip has, rather than indexing past its tables.
    let mut ym = Ay::new(Chip::Ym2149, AY_128, CPU_128);
    let mut rec = Record::default();
    set(&mut ym, &mut rec, 0, 7, 0b0011_1111);
    for ch in 0..3 {
        set(&mut ym, &mut rec, 0, 8 + ch, 0x1F);
    }
    set(&mut ym, &mut rec, 0, 1, 0xFF);
    set(&mut ym, &mut rec, 0, 13, 0b1010);
    ym.end_frame(FRAME_128, &mut rec);
    let mut foreign = ym.state();
    foreign.env_step = 0xFF;
    foreign.env_attack = 0xA5;
    foreign.address = 0xEE;
    foreign.tone_count = [u16::MAX; 3];
    foreign.noise_count = u8::MAX;
    foreign.env_count = u32::MAX;
    foreign.lfsr = u32::MAX;
    for stereo in [Stereo::Mono, Stereo::Joined, Stereo::Abc] {
        let mut ay = psg();
        ay.set_mix(Mix {
            stereo,
            separation: 1.0,
            gain: 1.0,
        });
        for state in [ym.state(), foreign] {
            ay.set_state(&state);
            assert!(ay.outputs().iter().all(|&v| v <= 15), "{stereo:?}");
            assert_eq!(ay.register(1), 0x0F);
            assert!(ay.address() <= 15);
            for _ in 0..3 {
                ay.end_frame(FRAME_128, &mut rec);
            }
        }
    }
}

// --- Into the sound buffer ---

/// The AC left in channel A's tone of `period`, rendered through the band-limited buffer at `rate`, raw (no DC
/// block, no tone), after the first second: its RMS about its mean, in dB of the square's own RMS (half its span).
fn ultrasonic_residue_db(ay_clock: u32, cpu: u32, frame: u32, rate: u32, period: u16) -> f64 {
    let mut ay = Ay::new(Chip::Ay8912, ay_clock, cpu);
    let mut buffer = audio::Buffer::new(cpu, rate);
    buffer.set_output(audio::Output {
        tone: audio::Tone::Flat,
        dc_block: false,
        volume: 1.0,
    });
    tone_a(&mut ay, &mut buffer, period);
    let mut samples = Vec::new();
    let mut out = vec![0.0f32; 2 * 8192];
    for _ in 0..75 {
        ay.end_frame(frame, &mut buffer);
        buffer.end_frame(frame);
        let n = buffer.read_samples(&mut out);
        samples.extend(out[..2 * n].iter().step_by(2).map(|&v| v as f64));
    }
    let tail = &samples[rate as usize..];
    let mean = tail.iter().sum::<f64>() / tail.len() as f64;
    let rms = (tail.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / tail.len() as f64).sqrt();
    // Channel A at full in mono is a third of full scale, times the headroom: a square of that span has an RMS of
    // half of it.
    let square_rms = audio::HEADROOM / 3.0 / 2.0;
    20.0 * (rms / square_rms).log10()
}

#[test]
fn tones_above_what_the_rate_can_carry_leave_nothing_audible() {
    // A tone whose every harmonic lies in the kernel's stop band (above the rate less 20 kHz) must come out as a
    // steady level: anything left that moves is an alias folded back into the audible band. Periods 1 to 4 are
    // 111, 55, 37 and 28 kHz on the 128K, the carriers of sample players.
    let mut report = Vec::new();
    for (ay_clock, cpu, frame) in [(AY_128, CPU_128, FRAME_128), (1_750_000, 3_500_000, 71_680)] {
        for (rate, periods) in [(44_100, &[1u16, 2, 3, 4][..]), (48_000, &[1, 2, 3][..])] {
            for &period in periods {
                let db = ultrasonic_residue_db(ay_clock, cpu, frame, rate, period);
                report.push(format!(
                    "{ay_clock} Hz, period {period}, at {rate}: {db:.1} dB"
                ));
                assert!(db < -90.0, "{}", report.last().unwrap());
            }
        }
    }
    println!("{}", report.join("\n"));
}

/// A busy song rendered through the buffer, its time line cut into frames of `frame` T-states: the same writes at
/// the same absolute T-states whatever the cut, and every sample read.
fn render_song(ay_clock: u32, cpu: u32, frame: u32, total: u32) -> Vec<f32> {
    let mut ay = Ay::new(Chip::Ay8912, ay_clock, cpu);
    ay.set_mix(Mix {
        stereo: Stereo::Abc,
        separation: 0.7,
        gain: 1.0,
    });
    let mut buffer = audio::Buffer::new(cpu, 44_100);
    // Writes every 1,000 T-states or so: periods, volumes, the envelope restarted, noise switched in and out.
    let mut seed = 0x9E37_79B9u32;
    let mut writes = Vec::new();
    let mut t = 0u32;
    while t < total {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        let r = (seed % 14) as u8;
        let v = match r {
            7 => [0x38, 0x30, 0x20, 0x08][(seed >> 8) as usize % 4],
            8..=10 => [15, 9, 0x10, 4][(seed >> 8) as usize % 4],
            12 => 0,
            _ => (seed >> 8) as u8,
        };
        writes.push((t, r, v));
        t += 700 + (seed >> 20) % 900;
    }
    let mut out = Vec::new();
    let mut read = vec![0.0f32; 2 * 8192];
    let mut start = 0u32;
    let mut next = 0;
    while start < total {
        while next < writes.len() && writes[next].0 < start + frame {
            let (t, r, v) = writes[next];
            ay.select(r);
            ay.write(t - start, v, &mut buffer);
            next += 1;
        }
        ay.end_frame(frame, &mut buffer);
        buffer.end_frame(frame);
        let n = buffer.read_samples(&mut read);
        out.extend_from_slice(&read[..2 * n]);
        start += frame;
    }
    out
}

#[test]
fn where_the_frames_are_cut_changes_no_sample() {
    // Frame boundaries are only where the time line is cut: a song played in frames of one length, and of another,
    // gives the same samples to the bit, on the 128K's clocks and the Pentagon's.
    for (ay_clock, cpu, frame) in [(AY_128, CPU_128, FRAME_128), (1_750_000, 3_500_000, 71_680)] {
        let total = 40 * frame;
        let whole = render_song(ay_clock, cpu, frame, total);
        assert!(whole.iter().filter(|v| v.abs() > 0.01).count() > 10_000);
        for cut in [frame / 2, frame / 5, 1_237] {
            let pieces = render_song(ay_clock, cpu, cut, total);
            let n = whole.len().min(pieces.len());
            assert!(n > 2 * 30_000);
            assert!(
                whole[..n] == pieces[..n],
                "{ay_clock} Hz, frames of {frame} against {cut}"
            );
        }
    }
}
