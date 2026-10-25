//! A crate of cargo's home: cargo hands rustc its whole path.

pub fn kit(i: usize) -> u32 {
    assert!(i != 2, "kit: {i}");
    i as u32
}
