//! The instant load against the ROM's own LD-BYTES: the same call, run once from the tape's edges and once
//! trapped, must leave every register the ROM's routine leaves (but C, which holds the border and the EAR
//! level and so depends on how many edges the pilot had), whether the load succeeds or fails.

use spectrum::{Machine, Model, Options};

fn booted() -> Machine {
    static CACHE: std::sync::Mutex<Option<Machine>> = std::sync::Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    if let Some(m) = &*cache {
        return m.clone();
    }
    let mut zx = Machine::with_options(
        Model::Spectrum48,
        Options {
            sound: false,
            ..Options::default()
        },
    );
    for _ in 0..300 {
        zx.run_frame();
    }
    *cache = Some(zx.clone());
    zx
}

#[derive(PartialEq, Eq)]
struct After {
    a: u8,
    f: u8,
    b: u8,
    de: u16,
    h: u8,
    l: u8,
    ix: u16,
    af_: u16,
    sp: u16,
    iff1: bool,
    border: u8,
    memory: Vec<u8>,
    /// The block under the tape's head, and where it is in the tape (ms; -1 after a load that failed).
    tape: (usize, i64),
}

/// LD-BYTES called with A = `flag`, carry = `load`, IX = A000h, DE = `de`, the memory at A000h filled with
/// `memory` first, and the tape `tap`; run until it returns (to a HALT at 800Dh).
impl std::fmt::Debug for After {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "A {:02X} F {:02X} B {:02X} DE {:04X} H {:02X} L {:02X} IX {:04X} AF' {:04X} SP {:04X} IFF1 {} \
             border {} memory {:016X} tape {:?}",
            self.a,
            self.f,
            self.b,
            self.de,
            self.h,
            self.l,
            self.ix,
            self.af_,
            self.sp,
            self.iff1,
            self.border,
            spectrum_hash(&self.memory),
            self.tape
        )
    }
}

fn spectrum_hash(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, &x| {
        (h ^ x as u64).wrapping_mul(0x100_0000_01b3)
    })
}

fn call(tap: &[u8], flag: u8, load: bool, de: u16, memory: &[u8], instant: bool) -> (After, u64) {
    let mut zx = booted();
    // SCF or AND A; LD A,flag; LD IX,A000h; LD DE,de; CALL 0556h; HALT
    let code = [
        if load { 0x37 } else { 0xA7 },
        0x3E,
        flag,
        0xDD,
        0x21,
        0x00,
        0xA0,
        0x11,
        de as u8,
        (de >> 8) as u8,
        0xCD,
        0x56,
        0x05,
        0x76,
    ];
    for (i, &b) in code.iter().enumerate() {
        zx.poke(0x8000 + i as u16, b);
    }
    for (i, &b) in memory.iter().enumerate() {
        zx.poke(0xA000 + i as u16, b);
    }
    {
        let r = zx.cpu_mut();
        r.pc = 0x8000;
        r.iff1 = false;
        r.iff2 = false;
        r.halted = false;
        r.prefix = 0;
        // Something to see in the registers LD-BYTES may leave alone.
        r.b = 0x5A;
        r.h = 0x6B;
        r.l = 0x7C;
        r.af_ = 0x1234;
    }
    zx.set_tstate(0);
    zx.set_options(Options {
        instant_load: instant,
        ..zx.options()
    });
    zx.load(tap, "t.tap").unwrap();
    let start = zx.frames();
    while zx.cpu().pc != 0x800D && zx.frames() - start < 2000 {
        zx.run(1);
    }
    let r = zx.cpu();
    // A' (with F') holds C as LD-SYNC left it, when the flag matched and nothing was verified: the border
    // bits and the EAR level complemented at each edge of the pilot, 01h, 21h, 7Eh or 5Eh after LD-FLAG's
    // RL C and RRA, with F' Z and P from the flag's XOR, Y and X from A', the carry LOAD's. Which of the four
    // depends on the pilot, so any of them stands for the trap's 01h.
    let mut af_ = r.af_;
    let (a_, f_) = ((af_ >> 8) as u8, af_ as u8);
    if matches!(a_, 0x01 | 0x21 | 0x7E | 0x5E)
        && f_ & 0xD7 == 0x44 | load as u8
        && f_ & 0x28 == a_ & 0x28
    {
        af_ = 0xC0DE;
    }
    let after = After {
        a: r.a,
        f: r.f,
        b: r.b,
        de: r.de(),
        h: r.h,
        l: r.l,
        ix: r.ix,
        af_,
        sp: r.sp,
        iff1: r.iff1,
        border: zx.port_fe() & 7,
        memory: (0..memory.len().max(400) as u16)
            .map(|i| zx.peek(0xA000 + i))
            .collect(),
        // A load that fails returns with the rest of its block still to play, where the instant load puts
        // the tape after it: only a load that succeeds must leave the tape exactly where the ROM leaves it.
        tape: {
            let s = zx.tape_state();
            let at = if r.f & 1 != 0 {
                (s.position * 1000.0) as i64
            } else {
                -1
            };
            (s.block, at)
        },
    };
    (after, zx.frames() - start)
}

fn block(flag: u8, data: &[u8]) -> Vec<u8> {
    tape::tap::block(flag, data)
}

/// The call run from the edges and with instant loading: the same registers, memory and tape position;
/// `taken`, whether instant loading takes the block at once (else it plays it from the edges).
fn same(name: &str, blocks: &[Vec<u8>], flag: u8, load: bool, de: u16, memory: &[u8], taken: bool) {
    let tap = tape::tap::write(blocks);
    let (rom, frames_rom) = call(&tap, flag, load, de, memory, false);
    let (trap, frames_trap) = call(&tap, flag, load, de, memory, true);
    assert!(
        frames_rom > 2,
        "{name}: the ROM ran from the edges ({frames_rom} frames)"
    );
    if taken {
        assert!(
            frames_trap < 2,
            "{name}: the trap took the block at once ({frames_trap} frames)"
        );
    } else {
        assert!(
            frames_trap > 2,
            "{name}: the block played from the edges ({frames_trap} frames)"
        );
    }
    assert_eq!(
        trap, rom,
        "{name}: trapped (left) against the ROM from the edges (right)"
    );
}

fn data(n: usize) -> Vec<u8> {
    (0..n as u32).map(|i| (i * 7 + 3) as u8).collect()
}

#[test]
fn a_load_that_succeeds_leaves_the_roms_registers() {
    same(
        "load",
        &[block(0xFF, &data(300))],
        0xFF,
        true,
        300,
        &[],
        true,
    );
}

#[test]
fn a_verify_that_succeeds_leaves_the_roms_registers() {
    same(
        "verify",
        &[block(0xFF, &data(300))],
        0xFF,
        false,
        300,
        &data(300),
        true,
    );
}

#[test]
fn a_verify_that_fails_leaves_the_roms_registers() {
    let mut memory = data(300);
    memory[100] ^= 0x10;
    same(
        "verify mismatch",
        &[block(0xFF, &data(300))],
        0xFF,
        false,
        300,
        &memory,
        true,
    );
}

#[test]
fn the_wrong_flag_leaves_the_roms_registers() {
    same("flag", &[block(0x00, &data(17))], 0xFF, true, 17, &[], true);
}

#[test]
fn a_parity_error_leaves_the_roms_registers() {
    let mut b = block(0xFF, &data(300));
    let n = b.len();
    b[n - 1] ^= 0x01;
    same("parity", &[b], 0xFF, true, 300, &[], true);
}

#[test]
fn a_block_shorter_than_asked_leaves_the_roms_registers() {
    same(
        "short",
        &[block(0xFF, &data(300))],
        0xFF,
        true,
        400,
        &[],
        true,
    );
}

#[test]
fn a_block_longer_than_asked_plays_from_the_edges() {
    // The ROM reads DE bytes and the one after, and the rest of the block plays on to whatever reads the
    // tape next: the instant load leaves such a block to the edges (as Fuse's trap does).
    same(
        "long",
        &[block(0xFF, &data(300))],
        0xFF,
        true,
        200,
        &[],
        false,
    );
    same(
        "zero, long",
        &[block(0xFF, &data(5))],
        0xFF,
        true,
        0,
        &[],
        false,
    );
}

#[test]
fn a_zero_length_load_leaves_the_roms_registers() {
    // DE = 0: the flag byte is read, compared with nothing, and taken as the parity byte; a block of more
    // than that byte plays on from the edges.
    same("zero", &[vec![0x00]], 0xFF, true, 0, &[], true);
    same("zero, failing", &[vec![0xFF]], 0xFF, true, 0, &[], true);
    same(
        "zero, two bytes",
        &[block(0x00, &[])],
        0xFF,
        true,
        0,
        &[],
        false,
    );
}

#[test]
fn the_wrong_flag_when_verifying_leaves_the_roms_registers() {
    same(
        "verify, flag",
        &[block(0xFF, &data(17))],
        0x00,
        false,
        17,
        &data(17),
        true,
    );
}

#[test]
fn a_flag_byte_alone_leaves_the_roms_registers() {
    // A block of its flag byte only, where bytes were asked for: the first data bit never comes.
    same("flag alone", &[vec![0xFF]], 0xFF, true, 10, &[], true);
}
