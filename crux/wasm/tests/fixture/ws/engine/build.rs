//! Writes code where cargo builds, as a build that generates its tables does, so that the path of where it builds is
//! in the module, in the panic of `generated`.

fn main() {
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(
        out.join("generated.rs"),
        "pub fn generated(i: usize) -> u32 { assert!(i != 1, \"generated: {i}\"); i as u32 }\n",
    )
    .unwrap();
}
