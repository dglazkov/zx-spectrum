//! Patrik Rak's z80test 1.2a (github.com/raxoft/z80test, MIT; the release's tapes fetched through
//! scripts/fixture): programs that run every Z80 instruction over many operands and compare a CRC of the
//! results with one taken on a real 48K Spectrum with a Zilog Z80. Unlike the FUSE tests and SingleStepTests,
//! whose expected values come from emulators, every expected value here was measured on the chip:
//!
//! - z80full: all registers and all flags, X and Y included;
//! - z80ccf: each instruction followed by CCF, whose X and Y show Q (whether that instruction set the flags);
//! - z80memptr: each instruction followed by BIT 0,(HL), whose X and Y show MEMPTR's high byte;
//! - z80doc, z80flags, z80docflags: z80full's results with less of them compared (documented flags only, flags
//!   only, documented flags only); they can only fail where z80full does, so they are in the z80-suites layer,
//!   to tell what a z80full failure is.
//!
//! They are Spectrum programs: loaded at 8000h, they print through the ROM's RST 10h (after opening a channel
//! at 1601h) and check that IN from port FEh reads BFh. Here they run on the CPU alone, as zex.rs runs the CP/M
//! exercisers: ROM below 4000h (writes there are lost, as on the machine; nothing in the programs reads it, so
//! it is left empty), RAM above, the two ROM calls answered by the harness, port FEh reading BFh (no key
//! pressed, MIC low) and every other port FFh. Nothing raises an interrupt: the programs disable them.

mod common;

use z80::{Bus, Cpu};

/// The address space as the programs see it: the ROM below 4000h, which writes do not change.
struct Spectrum(Box<[u8; 0x10000]>);

impl Bus for Spectrum {
    #[inline(always)]
    fn fetch(&mut self, addr: u16, _ir: u16, t: &mut u32) -> u8 {
        *t += 4;
        self.0[addr as usize]
    }
    #[inline(always)]
    fn read(&mut self, addr: u16, t: &mut u32) -> u8 {
        *t += 3;
        self.0[addr as usize]
    }
    #[inline(always)]
    fn write(&mut self, addr: u16, value: u8, t: &mut u32) {
        *t += 3;
        if addr >= 0x4000 {
            self.0[addr as usize] = value;
        }
    }
    #[inline(always)]
    fn internal(&mut self, _addr: u16, n: u32, t: &mut u32) {
        *t += n;
    }
    fn port_in(&mut self, port: u16, t: &mut u32) -> u8 {
        *t += 4;
        if port & 1 == 0 { 0xbf } else { 0xff }
    }
    fn port_out(&mut self, _port: u16, _value: u8, t: &mut u32) {
        *t += 4;
    }
    fn int_ack(&mut self, t: &mut u32) -> u8 {
        *t += 6;
        0xff
    }
}

/// Where the program returns to when it is done (as USR returns to BASIC): an address in the ROM's character
/// set, which nothing jumps to.
const DONE: u16 = 0x3ff0;

/// Runs a z80test tape: what it printed, and how many instructions that took.
fn run_tape(tape: &[u8]) -> (String, u64) {
    // The tape is a BASIC loader and the code; the code is the last data block (flag FFh), loaded at 8000h.
    let mut blocks = Vec::new();
    let mut at = 0;
    while at + 2 <= tape.len() {
        let len = u16::from_le_bytes([tape[at], tape[at + 1]]) as usize;
        blocks.push(&tape[at + 2..at + 2 + len]);
        at += 2 + len;
    }
    let code = blocks
        .iter()
        .rev()
        .find(|b| b[0] == 0xff)
        .expect("a code block");
    let code = &code[1..code.len() - 1];

    let mut mem = Box::new([0u8; 0x10000]);
    mem[0x8000..0x8000 + code.len()].copy_from_slice(code);
    let mut bus = Spectrum(mem);
    let mut cpu = Cpu::new();
    // As RANDOMIZE USR 32768 leaves it: IY at the system variables, the stack under RAMTOP (CLEAR 32767).
    cpu.regs.pc = 0x8000;
    cpu.regs.iy = 0x5c3a;
    cpu.regs.sp = 0x7ffe;
    cpu.regs.i = 0x3f;
    cpu.regs.im = 1;
    [bus.0[0x7ffe], bus.0[0x7fff]] = DONE.to_le_bytes();

    let mut out = String::new();
    // A TAB (23) control code takes two bytes after it: the column, and one that is ignored.
    let mut tab = 0;
    let (mut t, mut steps) = (0u32, 0u64);
    loop {
        if cpu.regs.prefix == 0 {
            match cpu.regs.pc {
                DONE => break,
                // CHAN-OPEN and PRINT-A: the harness opens nothing and prints into `out`.
                0x1601 | 0x0010 => {
                    if cpu.regs.pc == 0x0010 {
                        let c = cpu.regs.a;
                        if tab > 0 {
                            tab -= 1;
                        } else {
                            match c {
                                23 => {
                                    tab = 2;
                                    out.push(' ');
                                }
                                13 => out.push('\n'),
                                127 => out.push_str("(C)"),
                                32..=126 => out.push(c as char),
                                _ => {}
                            }
                        }
                    }
                    let sp = cpu.regs.sp;
                    cpu.regs.pc = u16::from_le_bytes([
                        bus.0[sp as usize],
                        bus.0[sp.wrapping_add(1) as usize],
                    ]);
                    cpu.regs.sp = sp.wrapping_add(2);
                    continue;
                }
                _ => {}
            }
        }
        cpu.step(&mut bus, &mut t);
        steps += 1;
        t &= 0x3fff_ffff;
        assert!(steps < 2_000_000_000, "z80test did not finish:\n{out}");
    }
    (out, steps)
}

fn z80test(variant: &str) {
    let name = format!("z80test {variant}");
    common::part(&name, || {
        let tape = common::fixture(&format!("test-{variant}.tap"), &name)?;
        let (out, steps) = run_tape(&std::fs::read(tape).unwrap());
        let lines: Vec<&str> = out.lines().map(str::trim).collect();
        // Each test prints its number and name, then OK, FAILED (with the CRCs on the next line) or Skipped.
        // SCF and CCF are tested as each maker's chips do them, Zilog's first; the other makers' variants are
        // run only if Zilog's failed, and are otherwise skipped.
        let ok = lines.iter().filter(|l| l.ends_with(" OK")).count();
        let skipped = lines.iter().filter(|l| l.ends_with(" Skipped")).count();
        let mut failures: Vec<String> = Vec::new();
        for (k, l) in lines.iter().enumerate() {
            if l.ends_with("FAILED") {
                failures.push(format!("{l}: {}", lines.get(k + 1).unwrap_or(&"")));
            }
        }
        if !out.contains("Result: all tests passed.") {
            let result = lines.iter().find(|l| l.starts_with("Result:"));
            failures.push(result.unwrap_or(&"no result printed").to_string());
        }
        let summary = format!(
            "{ok} tests OK, {skipped} skipped (other makers' SCF/CCF), {} failed; {steps} instructions",
            failures.len()
        );
        Some((failures, summary))
    });
}

#[test]
fn z80test_full() {
    z80test("z80full");
}

#[test]
fn z80test_ccf() {
    z80test("z80ccf");
}

#[test]
fn z80test_memptr() {
    z80test("z80memptr");
}

#[test]
#[ignore]
fn z80test_doc() {
    z80test("z80doc");
}

#[test]
#[ignore]
fn z80test_flags() {
    z80test("z80flags");
}

#[test]
#[ignore]
fn z80test_docflags() {
    z80test("z80docflags");
}
