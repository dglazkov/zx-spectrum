//! The chips' digital-to-analogue converters: the output level of each step of volume, as measured.
//!
//! Neither chip's levels are the datasheet's ideal 3 dB a step. These are measurements of real chips,
//! normalised so that step 0 is 0.0 and the loudest is 1.0.

/// The AY-3-8912 in a ZX Spectrum 128, measured by Matthew Westcott (comp.sys.sinclair, December 2001, placed in
/// the public domain): channel C held at a constant level (tone and noise off), its volume stepped from 0 to 15,
/// the voltage read between the channel's pin and ground, in the machine. Quoted in full in MAME's ay8910.cpp;
/// Fuse derives its levels from the same post. Volts, for volume 0 to 15.
pub const AY_8912_VOLTS: [f64; 16] = [
    1.147, 1.162, 1.169, 1.178, 1.192, 1.213, 1.238, 1.299, 1.336, 1.457, 1.573, 1.707, 1.882,
    2.06, 2.32, 2.58,
];

/// The YM2149's 32 envelope levels, as measured on a real Atari ST by the Hatari project (src/sound.c,
/// `ymout1c5bit`, level 0 being 310 before Hatari set it to zero). Arbitrary units, for levels 0 to 31.
pub const YM_2149_LEVELS: [f64; 32] = [
    310.0, 369.0, 438.0, 521.0, 619.0, 735.0, 874.0, 1039.0, 1234.0, 1467.0, 1744.0, 2072.0,
    2463.0, 2927.0, 3479.0, 4135.0, 4914.0, 5841.0, 6942.0, 8250.0, 9806.0, 11654.0, 13851.0,
    16462.0, 19565.0, 23253.0, 27636.0, 32845.0, 39037.0, 46395.0, 55141.0, 65535.0,
];

/// `measured` scaled so that its first entry is 0.0 and its last 1.0.
pub fn normalise(measured: &[f64]) -> Vec<f64> {
    let (lo, hi) = (measured[0], measured[measured.len() - 1]);
    measured.iter().map(|v| (v - lo) / (hi - lo)).collect()
}

/// The supply the joined-outputs model takes each channel's output to pull towards: the chip's 5 V.
pub const JOINED_SUPPLY_VOLTS: f64 = 5.0;

/// The level of three channels whose outputs are joined on one track, as on the Spectrum 128, for every
/// combination of their DAC levels: entry `a + n * b + n * n * c` for levels a, b, c of `n`, normalised so that
/// all three at 0 is 0.0 and all three at the top is 1.0.
///
/// Joined outputs do not add their voltages. The model takes each channel's output as a conductance g towards
/// `supply`, the three in parallel into one load G: V = supply × Σg ⁄ (Σg + G), the structure of MAME's resistor
/// model for the same chip in the same machine. It is calibrated to `volts`, measured on one channel with the
/// other two joined to it at level 0 (as Westcott's were): all three at 0 gives G ⁄ g₀ = 3 (supply − V₀) ⁄ V₀,
/// and each measured V then gives that level's g. With the 128K's measurements, one channel at full is 0.58 of
/// all three at full, not a third.
pub fn joined(volts: &[f64], supply: f64) -> Vec<f64> {
    let n = volts.len();
    let v0 = volts[0] / supply;
    let load = 3.0 * (1.0 - v0) / v0;
    let g: Vec<f64> = volts
        .iter()
        .map(|&v| {
            let v = v / supply;
            (v * (2.0 + load) - 2.0) / (1.0 - v)
        })
        .collect();
    let out = |sum: f64| sum / (sum + load);
    let (lo, hi) = (out(3.0 * g[0]), out(3.0 * g[n - 1]));
    let mut levels = vec![0.0; n * n * n];
    for c in 0..n {
        for b in 0..n {
            for a in 0..n {
                levels[a + n * b + n * n * c] = (out(g[a] + g[b] + g[c]) - lo) / (hi - lo);
            }
        }
    }
    levels
}
