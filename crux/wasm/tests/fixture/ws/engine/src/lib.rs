//! An engine as small as one can be that still has in it each path a build compiles in: a step past the end of its
//! table panics, and so does each of what it calls, and each panic names its file.

mod generated {
    include!(concat!(env!("OUT_DIR"), "/generated.rs"));
}

const TABLE: [u32; 4] = [1, 2, 3, 5];

#[cfg(feature = "loud")]
const GAIN: u32 = 11;
#[cfg(not(feature = "loud"))]
const GAIN: u32 = 7;

/// The table's `i`th, times the gain, and what the others make of `i`.
#[no_mangle]
pub extern "C" fn step(i: usize) -> u32 {
    TABLE[i] * GAIN + kit::kit(i) + tune::tune(i) + generated::generated(i)
}
