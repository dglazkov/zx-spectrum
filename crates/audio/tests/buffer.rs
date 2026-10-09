//! The buffer against what it promises: exact sample counts over any number of frames, steps at frame
//! boundaries kept, levels returned exactly, sub-sample timing, no aliasing above a floor, and no clipping
//! within the headroom.

use audio::{Buffer, HEADROOM, Level, Output, Sink, Tone, UNIT, kernel};

const CLOCKS: [u32; 2] = [3_500_000, 3_546_900];
const FRAMES: [u32; 3] = [69_888, 70_908, 71_680];
const RATES: [u32; 8] = [
    8_000, 11_025, 22_050, 31_250, 44_100, 48_000, 96_000, 192_000,
];

/// The raw level, times the headroom: no DC block, no tone.
fn raw() -> Output {
    Output {
        tone: Tone::Flat,
        dc_block: false,
        volume: 1.0,
    }
}

/// Every sample ready, left side only.
fn read_left(buffer: &mut Buffer) -> Vec<f32> {
    let mut out = vec![0.0f32; 2 * buffer.samples_avail()];
    let n = buffer.read_samples(&mut out);
    out.as_chunks::<2>()
        .0
        .iter()
        .take(n)
        .map(|s| s[0])
        .collect()
}

/// round(total * rate / clock), half up: what the buffer promises to have handed out after `total` T-states.
fn promised(total: u128, rate: u32, clock: u32) -> u128 {
    (total * rate as u128 + clock as u128 / 2) / clock as u128
}

#[test]
fn samples_out_are_the_time_times_the_rate_rounded_frame_after_frame() {
    let mut checked = 0;
    for clock in CLOCKS {
        for frame in FRAMES {
            for rate in RATES {
                let mut buffer = Buffer::new(clock, rate);
                let mut out = vec![0.0f32; 2 * 8192];
                let (mut total_t, mut total_samples) = (0u128, 0u128);
                for _ in 0..2_000 {
                    let ready = buffer.samples_for(frame);
                    buffer.end_frame(frame);
                    assert_eq!(buffer.samples_avail(), ready);
                    total_t += frame as u128;
                    total_samples += buffer.read_samples(&mut out) as u128;
                    assert_eq!(
                        total_samples,
                        promised(total_t, rate, clock),
                        "{clock} Hz, {frame} T, {rate} Hz"
                    );
                    checked += 1;
                }
            }
        }
    }
    println!("sample counts exact after each of {checked} frames");
}

#[test]
fn a_long_run_does_not_drift() {
    // A hundred thousand frames (33 minutes of a 48K), at a low rate so that it is quick to read out.
    for clock in CLOCKS {
        let mut buffer = Buffer::new(clock, 8_000);
        let mut out = vec![0.0f32; 2 * 512];
        let mut total = 0u128;
        for _ in 0..100_000 {
            buffer.end_frame(69_888);
            total += buffer.read_samples(&mut out) as u128;
        }
        assert_eq!(total, promised(100_000 * 69_888, 8_000, clock));
    }
}

#[test]
fn changing_the_clock_between_frames_keeps_the_count() {
    // A machine switched from 48K to 128K timing: the samples so far, and from then on, follow the time.
    let mut buffer = Buffer::new(3_500_000, 44_100);
    let mut out = vec![0.0f32; 2 * 4096];
    let mut got = 0u128;
    for _ in 0..500 {
        buffer.end_frame(69_888);
        got += buffer.read_samples(&mut out) as u128;
    }
    let before = 500u128 * 69_888 * 44_100;
    buffer.set_clock(3_546_900);
    for _ in 0..500 {
        buffer.end_frame(70_908);
        got += buffer.read_samples(&mut out) as u128;
    }
    // The second clock's time, in samples, with the first's exact fraction carried to a T-state of the second.
    let exact = before as f64 / 3_500_000.0 + 500.0 * 70_908.0 * 44_100.0 / 3_546_900.0;
    assert!((got as f64 - exact).abs() <= 1.0, "{got} against {exact}");
}

#[test]
fn steps_at_frame_boundaries_are_not_lost() {
    for clock in CLOCKS {
        for rate in [44_100, 48_000] {
            let frame = 70_908;
            let heights = [UNIT / 3, -UNIT / 7, UNIT / 5];
            // A: everything added before the frame ends, some of it at or past the end.
            let mut a = Buffer::new(clock, rate);
            a.set_output(raw());
            a.add_step(frame - 1, heights[0], heights[0]);
            a.add_step(frame, heights[1], heights[1]);
            a.add_step(frame + 100, heights[2], heights[2]);
            a.end_frame(frame);
            a.end_frame(frame);
            // B: the same steps, the later two added in the next frame, where they belong.
            let mut b = Buffer::new(clock, rate);
            b.set_output(raw());
            b.add_step(frame - 1, heights[0], heights[0]);
            b.end_frame(frame);
            b.add_step(0, heights[1], heights[1]);
            b.add_step(100, heights[2], heights[2]);
            b.end_frame(frame);
            let (sa, sb) = (read_left(&mut a), read_left(&mut b));
            assert_eq!(sa, sb);
            let sum: i32 = heights.iter().sum();
            let settled = (sum as f64 / UNIT as f64 * HEADROOM) as f32;
            assert_eq!(*sa.last().unwrap(), settled);
        }
    }
}

#[test]
fn a_square_wave_with_edges_on_every_frame_boundary_keeps_its_level() {
    let frame = 69_888;
    let mut buffer = Buffer::new(3_500_000, 44_100);
    buffer.set_output(raw());
    let mut beeper = Level::new();
    let mut high = false;
    let level = |high: bool| if high { 0.75 } else { 0.0 };
    for _ in 0..1_000 {
        // Each frame's edge is added before the frame ends, at the T-state the frame ends on: it is the next
        // frame's T-state 0. The last sample ready (14.5 samples before the end) shows the level the edge
        // added a frame ago left, exactly.
        let before = high;
        high = !high;
        beeper.set(&mut buffer, frame, level(high));
        buffer.end_frame(frame);
        assert_eq!(
            *read_left(&mut buffer).last().unwrap(),
            (level(before) as f64 * HEADROOM) as f32
        );
    }
    buffer.end_frame(frame);
    assert_eq!(
        *read_left(&mut buffer).last().unwrap(),
        (level(high) as f64 * HEADROOM) as f32
    );
}

#[test]
fn levels_return_exactly() {
    // Thousands of steps of odd sizes at odd times, then one that undoes their sum: the output comes back to
    // exactly zero, not to within a rounding error.
    let mut buffer = Buffer::new(3_546_900, 48_000);
    buffer.set_output(raw());
    let mut seed = 12_345u32;
    let mut rand = move || {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        seed >> 8
    };
    let mut sum = 0i64;
    let mut t = 0;
    while t < 70_000 {
        let h = (rand() % (UNIT as u32)) as i32 - UNIT / 2;
        buffer.add_step(t, h, -h);
        sum += h as i64;
        t += 1 + rand() % 97;
    }
    buffer.add_step(70_000, -sum as i32, sum as i32);
    buffer.end_frame(70_908);
    buffer.end_frame(70_908);
    let mut out = vec![0.0f32; 2 * buffer.samples_avail()];
    let n = buffer.read_samples(&mut out);
    assert_eq!(out[2 * n - 2], 0.0);
    assert_eq!(out[2 * n - 1], 0.0);
}

#[test]
fn a_step_lands_where_its_t_state_says_to_a_thousandth_of_a_sample() {
    // Sample m of a step at T-state t holds H(m - p - LATENCY), where p = 0.5 + t * rate / clock is where t
    // falls (the 0.5 is the rounding the buffer starts with) and H is the band-limited step. The differences
    // between successive samples are then H sampled through a one-sample box, a band-limited pulse whose
    // centroid is exactly p + LATENCY + 0.5: so the centroid measures where the buffer put the step.
    let mut worst: f64 = 0.0;
    for clock in CLOCKS {
        for rate in [44_100, 48_000, 96_000] {
            for k in 0..200u32 {
                let t = 1_000 + k * 7;
                let mut buffer = Buffer::new(clock, rate);
                buffer.set_output(raw());
                buffer.add_step(t, UNIT, UNIT);
                buffer.end_frame(20_000);
                let s = read_left(&mut buffer);
                let (mut moment, mut mass) = (0.0f64, 0.0f64);
                for m in 1..s.len() {
                    let d = (s[m] - s[m - 1]) as f64;
                    moment += m as f64 * d;
                    mass += d;
                }
                let expected = 0.5 + t as f64 * rate as f64 / clock as f64 + kernel::LATENCY + 0.5;
                worst = worst.max((moment / mass - expected).abs());
            }
        }
    }
    println!("worst step position error: {worst:.6} samples");
    assert!(worst < 0.001, "{worst}");
}

#[test]
fn level_adds_only_differences() {
    struct Count(Vec<(u32, i32, i32)>);
    impl Sink for Count {
        fn add_step(&mut self, t: u32, l: i32, r: i32) {
            self.0.push((t, l, r));
        }
    }
    let mut sink = Count(Vec::new());
    let mut level = Level::new();
    level.set(&mut sink, 10, 0.5);
    level.set(&mut sink, 20, 0.5);
    level.set_stereo(&mut sink, 30, 0.25, 0.75);
    level.set(&mut sink, 40, 0.0);
    assert_eq!(
        sink.0,
        vec![
            (10, UNIT / 2, UNIT / 2),
            (30, -UNIT / 4, UNIT / 4),
            (40, -UNIT / 4, -3 * UNIT / 4)
        ]
    );
    assert_eq!(level.units(), (0, 0));
}

#[test]
fn changing_the_rate_drops_what_was_buffered_but_keeps_the_level() {
    let mut buffer = Buffer::new(3_500_000, 44_100);
    buffer.set_output(raw());
    buffer.add_step(100, UNIT / 2, UNIT / 2);
    buffer.end_frame(69_888);
    buffer.set_sample_rate(96_000);
    assert_eq!(buffer.samples_avail(), 0);
    buffer.end_frame(69_888);
    let s = read_left(&mut buffer);
    assert_eq!(s.len(), 1917);
    assert!(s.iter().all(|&v| v == (0.5 * HEADROOM) as f32));
}

#[test]
fn an_unread_buffer_keeps_at_most_a_second() {
    let mut buffer = Buffer::new(3_500_000, 44_100);
    for _ in 0..200 {
        buffer.end_frame(69_888);
    }
    assert!(buffer.samples_avail() <= 44_100 + 1_000);
}

// --- The spectrum of a square wave ---

/// An in-place radix-2 FFT of `re`, `im` (length a power of two).
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f64::consts::PI / len as f64;
        for start in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (s, c) = (ang * k as f64).sin_cos();
                let (a, b) = (start + k, start + k + len / 2);
                let (xr, xi) = (re[b] * c - im[b] * s, re[b] * s + im[b] * c);
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
            }
        }
        len <<= 1;
    }
}

fn bessel_i0(x: f64) -> f64 {
    let (mut term, mut sum, mut k) = (1.0, 1.0, 1.0);
    while term > sum * 1e-17 {
        term *= (x / 2.0 / k) * (x / 2.0 / k);
        sum += term;
        k += 1.0;
    }
    sum
}

/// The magnitude spectrum of `x` in dB, Kaiser-windowed (β = 16, side lobes below -150 dB).
fn spectrum_db(x: &[f64]) -> Vec<f64> {
    let n = x.len();
    let beta = 16.0;
    let mut re: Vec<f64> = x
        .iter()
        .enumerate()
        .map(|(i, &v)| {
            let r = 2.0 * i as f64 / (n - 1) as f64 - 1.0;
            v * bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta)
        })
        .collect();
    let mean = re.iter().sum::<f64>() / n as f64;
    re.iter_mut().for_each(|v| *v -= mean);
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im);
    (0..n / 2)
        .map(|i| 20.0 * (re[i].hypot(im[i]) + 1e-300).log10())
        .collect()
}

/// The loudest component of a square wave's spectrum that is not one of its harmonics, below `top` Hz,
/// relative to the fundamental, in dB.
fn worst_alias(samples: &[f64], rate: u32, f0: f64, top: f64) -> f64 {
    let n = samples.len();
    let db = spectrum_db(samples);
    let bin = |f: f64| f * n as f64 / rate as f64;
    let fundamental = db[(bin(f0) - 8.0) as usize..(bin(f0) + 8.0) as usize]
        .iter()
        .cloned()
        .fold(f64::MIN, f64::max);
    let mut worst = f64::MIN;
    for (i, &v) in db.iter().enumerate().take(bin(top) as usize).skip(10) {
        let f = i as f64 * rate as f64 / n as f64;
        // Within ten bins of a harmonic below half the rate is the harmonic itself.
        let k = (f / f0).round();
        let near_harmonic =
            k >= 1.0 && (bin(k * f0) - i as f64).abs() < 10.0 && k * f0 < rate as f64 / 2.0;
        if !near_harmonic {
            worst = worst.max(v - fundamental);
        }
    }
    worst
}

/// A square wave of half-period `half` T-states, span 1.0, rendered through the buffer.
fn render_square(clock: u32, rate: u32, half: u32, n: usize) -> Vec<f64> {
    let mut buffer = Buffer::new(clock, rate);
    buffer.set_output(raw());
    let mut beeper = Level::new();
    let mut out = Vec::new();
    let (mut edge, mut high) = (0u32, false);
    let frame = 70_000;
    while out.len() < n + 2_000 {
        while edge < frame {
            high = !high;
            beeper.set(&mut buffer, edge, if high { 1.0 } else { 0.0 });
            edge += half;
        }
        edge -= frame;
        buffer.end_frame(frame);
        out.extend(read_left(&mut buffer).iter().map(|&v| v as f64));
    }
    out[2_000..2_000 + n].to_vec()
}

/// The same square wave sampled naively (the level at each sample's instant): what aliasing looks like.
fn naive_square(clock: u32, rate: u32, half: u32, n: usize) -> Vec<f64> {
    (2_000..2_000 + n)
        .map(|i| {
            let t = (i as u128 * clock as u128 / rate as u128) as u64;
            if (t / half as u64).is_multiple_of(2) {
                1.0
            } else {
                0.0
            }
        })
        .collect()
}

#[test]
fn a_high_square_wave_has_no_aliases_above_the_floor() {
    const FLOOR_DB: f64 = -90.0;
    let n = 1 << 15;
    let mut report = Vec::new();
    for (clock, rate) in [
        (3_500_000, 44_100),
        (3_546_900, 48_000),
        (3_500_000, 22_050),
    ] {
        // Beeper tones from 1.7 to 8.8 kHz: half-periods in T-states, as a beeper loop makes them.
        for half in [199u32, 333, 467, 1_031] {
            let f0 = clock as f64 / (2.0 * half as f64);
            let top = (rate as f64 * 0.4535).min(20_000.0);
            let band_limited = worst_alias(&render_square(clock, rate, half, n), rate, f0, top);
            let naive = worst_alias(&naive_square(clock, rate, half, n), rate, f0, top);
            report.push(format!("{rate} Hz, {f0:.0} Hz square: aliases at {band_limited:.1} dB (naive {naive:.1} dB)"));
            assert!(band_limited < FLOOR_DB, "{}", report.last().unwrap());
            // The measurement has teeth: the naive square's aliases are plainly above the floor.
            assert!(naive > -50.0, "{}", report.last().unwrap());
        }
    }
    println!("{}", report.join("\n"));
}

// --- Headroom ---

/// The loudest sample of square waves of span 1.0 from 20 Hz to 20 kHz (a sixth of an octave apart) through
/// `tone`, and of single steps after silence.
fn loudest(tone: Tone, clock: u32, rate: u32) -> f32 {
    let mut peak: f32 = 0.0;
    let mut f = 20.0f64;
    while f <= 20_000.0 {
        let half = (clock as f64 / (2.0 * f)).round() as u32;
        let mut buffer = Buffer::new(clock, rate);
        buffer.set_output(Output {
            tone,
            dc_block: true,
            volume: 1.0,
        });
        let mut beeper = Level::new();
        let (mut edge, mut high) = (0u32, false);
        let frame = 70_000;
        let mut out = vec![0.0f32; 2 * 8192];
        for _ in 0..15 {
            while edge < frame {
                high = !high;
                beeper.set(&mut buffer, edge, if high { 1.0 } else { 0.0 });
                edge += half;
            }
            edge -= frame;
            buffer.end_frame(frame);
            let n = buffer.read_samples(&mut out);
            peak = out[..2 * n].iter().fold(peak, |p, &v| p.max(v.abs()));
        }
        f *= 2f64.powf(1.0 / 6.0);
    }
    peak
}

#[test]
fn square_waves_of_full_span_never_reach_the_clamp() {
    let mut report = Vec::new();
    for tone in [Tone::Flat, Tone::Speaker, Tone::Television] {
        for (clock, rate) in [
            (3_500_000, 44_100),
            (3_546_900, 48_000),
            (3_500_000, 96_000),
        ] {
            let peak = loudest(tone, clock, rate);
            report.push(format!("{tone:?} at {rate} Hz: loudest sample {peak:.3}"));
            assert!(peak < 0.99, "{}", report.last().unwrap());
        }
    }
    println!("{}", report.join("\n"));
}

/// The total variation of the output's response to a step of 1.0, as a function of where the step falls:
/// every T-state across one sample for the first thousand samples (where the kernel and the tone ring), and
/// every sample after that, for half a second.
fn step_response_variation(tone: Tone, clock: u32, rate: u32) -> f64 {
    let t0 = 1_000;
    let across = (clock / rate) as usize + 2;
    let length = rate as usize / 2;
    let mut points: Vec<(f64, f64)> = Vec::new();
    let mut tail_end = 0.0f64;
    for j in 0..across {
        let t = t0 + j as u32;
        let mut buffer = Buffer::new(clock, rate);
        buffer.set_output(Output {
            tone,
            dc_block: true,
            volume: 1.0,
        });
        buffer.add_step(t, UNIT, UNIT);
        let mut s = Vec::new();
        while s.len() < length {
            buffer.end_frame(70_000);
            s.extend(read_left(&mut buffer));
        }
        let pos = (clock as f64 / 2.0 + t as f64 * rate as f64) / clock as f64;
        let fine = if j == 0 { s.len() } else { 1_000 };
        points.extend(
            s.iter()
                .take(fine)
                .enumerate()
                .map(|(m, &v)| (m as f64 - pos, v as f64)),
        );
        if j == 0 {
            tail_end = *s.last().unwrap() as f64;
        }
    }
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    let inside: f64 = points.windows(2).map(|w| (w[1].1 - w[0].1).abs()).sum();
    // What is left of the DC block's decay after half a second falls monotonically to zero.
    inside + tail_end.abs()
}

#[test]
fn no_input_within_a_span_of_one_can_reach_the_clamp() {
    // Any input whose level stays within a span of 1.0 is a sum of such steps, and the output it gives is
    // bounded by half the step response's total variation (the response settles to zero at both ends, the DC
    // block's high-pass taking away any level). This is the headroom's guarantee, for every input, not only
    // for the square waves above.
    let mut report = Vec::new();
    for tone in [Tone::Flat, Tone::Speaker, Tone::Television] {
        for (clock, rate) in [(3_500_000, 44_100), (3_546_900, 48_000)] {
            let bound = step_response_variation(tone, clock, rate) / 2.0;
            report.push(format!(
                "{tone:?} at {rate} Hz: no sample beyond {bound:.3}"
            ));
            assert!(bound < 0.99, "{}", report.last().unwrap());
        }
    }
    println!("{}", report.join("\n"));
}

#[test]
fn a_state_put_back_goes_on_to_the_bit() {
    // A machine's saved state carries the buffer's: a buffer set to it hands out, given the same steps, what
    // the buffer it was taken from handed out, sample for sample, through every tone's filters, with steps
    // left pending past the frame's end.
    for tone in [Tone::Flat, Tone::Speaker, Tone::Television] {
        let output = Output {
            tone,
            dc_block: true,
            volume: 0.8,
        };
        let mut a = Buffer::new(3_546_900, 44_100);
        a.set_output(output);
        let mut x: u32 = 12345;
        let mut next = || {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x
        };
        let mut steps = |buffer: &mut Buffer, frame: u32| {
            let _ = frame;
            for _ in 0..40 {
                let t = next() % 70_908;
                let d = (next() % 20_000) as i32 - 10_000;
                buffer.add_step(t, d, -d / 2);
            }
            // One past the frame's end, which stays pending.
            buffer.add_step(70_910, 5_000, 5_000);
        };
        let mut out = vec![0.0f32; 4096];
        for f in 0..10 {
            steps(&mut a, f);
            a.end_frame(70_908);
            a.read_samples(&mut out);
        }
        let saved = a.state();
        let mut b = Buffer::new(3_500_000, 48_000);
        b.set_state(&saved);
        assert_eq!(b.state(), saved);
        let seed = x;
        let run = |buffer: &mut Buffer, mut x: u32| {
            let mut all = Vec::new();
            for _ in 0..20 {
                for _ in 0..40 {
                    x ^= x << 13;
                    x ^= x >> 17;
                    x ^= x << 5;
                    let t = x % 70_908;
                    buffer.add_step(t, (x % 9_000) as i32 - 4_500, 300);
                }
                buffer.end_frame(70_908);
                let mut s = vec![0.0f32; 4096];
                let n = buffer.read_samples(&mut s);
                all.extend_from_slice(&s[..2 * n]);
            }
            all
        };
        let (sa, sb) = (run(&mut a, seed), run(&mut b, seed));
        assert_eq!(sa.len(), sb.len());
        assert!(
            sa.iter().zip(&sb).all(|(p, q)| p.to_bits() == q.to_bits()),
            "{tone:?}: the restored buffer differs"
        );
        // And a buffer that is not put back does differ: the test can tell.
        let mut c = Buffer::new(3_546_900, 44_100);
        c.set_output(output);
        assert_ne!(run(&mut c, seed), sa);
    }
}

#[test]
fn a_held_level_settles_to_zero_not_into_subnormals() {
    // After a level held for a while the filters' decay must reach zero. Subnormal values left in their state
    // (where rounding can hold a decay short of zero for ever) make every later sample tens of times slower.
    for tone in [Tone::Flat, Tone::Speaker, Tone::Television] {
        let mut b = Buffer::new(3_500_000, 48_000);
        b.set_output(Output {
            tone,
            dc_block: true,
            volume: 1.0,
        });
        Level::new().set(&mut b, 100, 0.5);
        let mut out = vec![0.0f32; 4096];
        for _ in 0..3000 {
            b.end_frame(69_888);
            b.read_samples(&mut out);
        }
        let s = b.state();
        for h in &s.filters {
            for &v in h {
                assert!(
                    v == 0.0 || v.abs() >= f64::MIN_POSITIVE,
                    "{tone:?}: a filter holds the subnormal {v:e}"
                );
            }
        }
    }
}
