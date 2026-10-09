// A miscompilation in rustc 1.98.1 (LLVM 22.1.8), found while building the machine's contention tables
// (docs/machine.md, crates/spectrum/src/model.rs `Timing::new`), kept here so it can be reported upstream.
//
//   rustc -A warnings -C opt-level=2 contention-miscompile.rs && ./contention-miscompile
//
// prints [6, 5, 4, 3, 2, 1, 0, 0, <8 bytes of stack>, 6, 5, ...]: `pattern[(i % 8) as usize]` reads past the
// eight-byte array for every other group of eight. At opt-level 1 it prints the pattern three times, as it should.
// The std::env::var call in `base` is what makes it happen; without it the loop compiles correctly. The machine
// fills its tables with `pattern.iter().cycle()`, which compiles correctly, and the corpus layer checks a release
// build's tables T-state by T-state (`machine › contention tables`).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind { None, Ula, Gate }

#[derive(Clone, Copy, Debug)]
struct Base { line: u32, lines: u32, start: u32, kind: Kind, latch: u32 }

#[derive(Clone, Copy, Debug)]
enum Model { A, B, C, D }

fn base(m: Model) -> Base {
    match m {
        Model::A => Base { line: 224, lines: 312, start: 14335, kind: Kind::Ula, latch: 3 },
        Model::B => Base { line: 228, lines: 311, start: 14361, kind: Kind::Ula,
            latch: std::env::var("ZX_LATCH128").ok().and_then(|v| v.parse().ok()).unwrap_or(2) },
        Model::C => Base { line: 228, lines: 311, start: 14361, kind: Kind::Gate, latch: 2 },
        Model::D => Base { line: 224, lines: 320, start: 0, kind: Kind::None, latch: 3 },
    }
}

fn table(m: Model) -> Vec<u8> {
    let b = base(m);
    let frame = b.line * b.lines;
    let mut delay = vec![0u8; frame as usize + 512];
    let pattern: [u8; 8] = match b.kind {
        Kind::None => [0; 8],
        Kind::Ula => [6, 5, 4, 3, 2, 1, 0, 0],
        Kind::Gate => [1, 0, 7, 6, 5, 4, 3, 2],
    };
    if b.kind != Kind::None {
        let span = if b.kind == Kind::Gate { 129 } else { 128 };
        for line in 0..192 {
            let from = b.start + line * b.line;
            for i in 0..span {
                delay[(from + i) as usize] = pattern[(i % 8) as usize];
            }
        }
    }
    delay
}

fn main() {
    let m = match std::env::args().nth(1).as_deref() { Some("b") => Model::B, Some("c") => Model::C, Some("d") => Model::D, _ => Model::A };
    let t = table(std::hint::black_box(m));
    let b = base(m);
    println!("{:?}", &t[b.start as usize..b.start as usize + 24]);
}
