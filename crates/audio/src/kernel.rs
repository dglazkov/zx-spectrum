//! The band-limited step: a table of how one step of height 1 spreads over the output samples around it, for
//! each of `PHASES` positions of the step between two samples.
//!
//! A level that jumps at an instant between two samples cannot be sampled as it is: the jump holds every
//! frequency, and those above half the sample rate fold back as aliases (the harsh, inharmonic fizz of a naive
//! square wave). What can be sampled is the jump passed through a low-pass filter first. The filter here is a
//! windowed sinc (a sinc cut off at `CUTOFF` of the sample rate, shaped by a Kaiser window of `BETA` and
//! half-width `SUPPORT` samples); its running integral is the band-limited step `H`, and a step at fractional
//! position `phi` puts `H(m - phi - LATENCY) - H(m - 1 - phi - LATENCY)` into sample `m`: the step's
//! *derivative*, which the reader integrates back. This is the technique of Shay Green's (blargg's) blip_buf.
//!
//! The table is integers, built from rounded values of the running integral, so that the taps of every phase
//! add up to exactly `1 << KERNEL_BITS`: a step of height `d` adds exactly `d << KERNEL_BITS` to the integral
//! once its last tap is read, and any number of steps that return a level to where it was return the output
//! there exactly, with no drift.
//!
//! The parameters were chosen by measuring the kernel's spectrum (docs/audio.md has the table): flat to 0.1 dB
//! up to 0.377 of the sample rate (16.6 kHz at 44.1 kHz), -3 dB at 0.428, and every frequency that would fold
//! back below 20 kHz at 44.1 kHz attenuated by 95 dB or more.

use std::sync::OnceLock;

/// Taps on each side of the step: a step touches `TAPS` consecutive output samples.
pub const HALF_WIDTH: usize = 16;
/// Output samples a step touches.
pub const TAPS: usize = 2 * HALF_WIDTH;
/// log2 of the number of tabulated step positions between two samples.
pub const PHASE_BITS: u32 = 8;
/// Tabulated step positions between two samples; positions between two of them are interpolated.
pub const PHASES: usize = 1 << PHASE_BITS;
/// Bits of the interpolation between two tabulated phases.
pub const INTERP_BITS: u32 = 16;
/// The taps of each phase sum to `1 << KERNEL_BITS`.
pub const KERNEL_BITS: u32 = 20;

/// Half-width of the windowed sinc, in output samples. It is half a sample less than `HALF_WIDTH`, which is
/// what lets every phase from 0 to 1 fit in `TAPS` taps (see `LATENCY`).
const SUPPORT: f64 = HALF_WIDTH as f64 - 0.5;
/// The sinc's cut-off, as a fraction of the output sample rate.
const CUTOFF: f64 = 0.445;
/// The Kaiser window's shape: higher trades a wider transition for a deeper stop band.
const BETA: f64 = 9.5;
/// How many output samples after the sample it lands in the middle of a step comes out. With the window's
/// support of `HALF_WIDTH - 0.5`, a latency of `HALF_WIDTH - 1.5` is the one that keeps every phase's taps
/// within the `TAPS` samples starting at the one the step lands in.
pub const LATENCY: f64 = HALF_WIDTH as f64 - 1.5;

/// One row of taps: what a step of height 1 at one phase adds to `TAPS` consecutive samples.
pub type Row = [i32; TAPS];

/// The table: `PHASES + 1` rows, the last being the first moved one sample on, so that every phase can be
/// interpolated with the one after it.
pub fn table() -> &'static [Row] {
    static TABLE: OnceLock<Vec<Row>> = OnceLock::new();
    TABLE.get_or_init(build)
}

/// The modified Bessel function of the first kind, order 0, by its power series (it converges quickly for the
/// arguments a Kaiser window needs).
fn bessel_i0(x: f64) -> f64 {
    let half = x / 2.0;
    let mut term = 1.0;
    let mut sum = 1.0;
    let mut k = 1.0;
    while term > sum * 1e-17 {
        term *= (half / k) * (half / k);
        sum += term;
        k += 1.0;
    }
    sum
}

/// The windowed sinc at `x` output samples from its centre (unnormalised: the integral is scaled to 1 later).
fn impulse(x: f64) -> f64 {
    let r = x / SUPPORT;
    if r.abs() >= 1.0 {
        return 0.0;
    }
    let arg = 2.0 * CUTOFF * x * std::f64::consts::PI;
    let sinc = if arg == 0.0 { 1.0 } else { arg.sin() / arg };
    sinc * bessel_i0(BETA * (1.0 - r * r).sqrt())
}

fn build() -> Vec<Row> {
    // The running integral H on a grid of PHASES points a sample across the support, from -SUPPORT (H = 0)
    // to +SUPPORT (H = 1), each interval integrated by Simpson's rule over SUB sub-intervals.
    const SUB: usize = 8;
    let grid = (2.0 * SUPPORT) as usize * PHASES;
    let dx = 1.0 / PHASES as f64;
    let mut integral = vec![0.0f64; grid + 1];
    let mut acc = 0.0;
    for (k, slot) in integral.iter_mut().enumerate().skip(1) {
        let a = -SUPPORT + (k - 1) as f64 * dx;
        let h = dx / SUB as f64;
        let mut s = impulse(a) + impulse(a + dx);
        for i in 1..SUB {
            s += impulse(a + i as f64 * h) * if i % 2 == 1 { 4.0 } else { 2.0 };
        }
        acc += s * h / 3.0;
        *slot = acc;
    }
    let total = acc;
    let unit = (1i64 << KERNEL_BITS) as f64;
    let quantised: Vec<i64> = integral
        .iter()
        .map(|v| (v / total * unit).round() as i64)
        .collect();
    let at = |k: isize| -> i64 {
        if k <= 0 {
            0
        } else if k as usize >= grid {
            1 << KERNEL_BITS
        } else {
            quantised[k as usize]
        }
    };
    (0..=PHASES)
        .map(|p| {
            let mut row = [0i32; TAPS];
            for (j, tap) in row.iter_mut().enumerate() {
                let hi = ((j + 1) * PHASES) as isize - p as isize;
                let lo = (j * PHASES) as isize - p as isize;
                *tap = (at(hi) - at(lo)) as i32;
            }
            row
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_phase_sums_to_exactly_one() {
        for (p, row) in table().iter().enumerate() {
            let sum: i64 = row.iter().map(|&v| v as i64).sum();
            assert_eq!(sum, 1 << KERNEL_BITS, "phase {p}");
        }
    }

    #[test]
    fn the_last_row_is_the_first_one_sample_on() {
        let t = table();
        assert_eq!(t[0][TAPS - 1], 0);
        assert_eq!(t[PHASES][0], 0);
        for j in 1..TAPS {
            assert_eq!(t[PHASES][j], t[0][j - 1]);
        }
    }

    #[test]
    fn the_step_is_centred_where_latency_says() {
        // At phase 0 the step's half-way point is LATENCY samples after the sample it lands in: the running
        // sum of the taps crosses one half between samples LATENCY - 0.5 and LATENCY + 0.5.
        let row = &table()[0];
        let mut sum = 0i64;
        let half = 1i64 << (KERNEL_BITS - 1);
        let mut crossing = None;
        for (j, &v) in row.iter().enumerate() {
            let before = sum;
            sum += v as i64;
            if before < half && sum >= half {
                crossing = Some(j as f64 - 1.0 + (half - before) as f64 / (sum - before) as f64);
            }
        }
        let c = crossing.expect("the step crosses one half");
        assert!((c - LATENCY).abs() < 0.01, "crossing at {c}");
    }
}
