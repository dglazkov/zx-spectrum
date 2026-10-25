//! A crate of the workspace's directory that is not a member: cargo hands rustc its whole path.

pub fn tune(i: usize) -> u32 {
    assert!(i != 3, "tune: {i}");
    i as u32
}
