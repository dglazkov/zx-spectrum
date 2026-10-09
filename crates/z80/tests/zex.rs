//! ZEXDOC and ZEXALL, Frank D. Cringle's Z80 instruction exercisers (GPL; the CP/M binaries as yaze-ag 2.51.3
//! ships them, fetched through scripts/fixture). Each runs 67 groups of instructions over a great many
//! operand and flag combinations and compares a CRC of the results with one taken on a real Z80: ZEXDOC
//! masks the undocumented flags, ZEXALL checks them too. Every group must print OK.
//!
//! They run on a minimal CP/M: the program at 0100h, BDOS calls at 0005h (function 2 prints E, function 9
//! the string at DE up to a '$'), and a jump to 0000h ends it. They are slow (about 6 billion T-states each),
//! so they are the z80-suites layer; each also says how fast the CPU ran them.

mod common;

use std::time::Instant;
use z80::{Bus, Cpu};

/// 64K of RAM, as an array so that indexing by a u16 needs no bounds check.
struct Memory(Box<[u8; 0x10000]>);

impl Bus for Memory {
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
        self.0[addr as usize] = value;
    }
    #[inline(always)]
    fn internal(&mut self, _addr: u16, n: u32, t: &mut u32) {
        *t += n;
    }
    fn port_in(&mut self, _port: u16, t: &mut u32) -> u8 {
        *t += 4;
        0xff
    }
    fn port_out(&mut self, _port: u16, _value: u8, t: &mut u32) {
        *t += 4;
    }
    fn int_ack(&mut self, t: &mut u32) -> u8 {
        *t += 6;
        0xff
    }
}

/// Runs a CP/M .COM to its end, or for `limit` instructions: what it printed, the instructions and the
/// T-states it took.
fn run_cpm(program: &[u8], limit: u64) -> (String, u64, u64) {
    let mut mem = Box::new([0u8; 0x10000]);
    mem[0x100..0x100 + program.len()].copy_from_slice(program);
    // The BDOS entry: a JP whose target (the word at 0006h) is the top of the program's memory, where the
    // exercisers put their stack. Calls to 0005h are answered before that JP runs.
    mem[5..8].copy_from_slice(&[0xc3, 0x00, 0xf0]);
    let mut bus = Memory(mem);
    let mut cpu = Cpu::new();
    cpu.regs.pc = 0x100;
    cpu.regs.sp = 0xf000;
    let mut out = String::new();
    let (mut t, mut total, mut steps) = (0u32, 0u64, 0u64);
    while steps < limit {
        if cpu.regs.prefix == 0 {
            match cpu.regs.pc {
                0x0000 => break,
                0x0005 => {
                    match cpu.regs.c {
                        2 => out.push(cpu.regs.e as char),
                        9 => {
                            let mut a = cpu.regs.de();
                            while bus.0[a as usize] != b'$' {
                                out.push(bus.0[a as usize] as char);
                                a = a.wrapping_add(1);
                            }
                        }
                        _ => {}
                    }
                    // Return to the caller, as the BDOS's RET would.
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
        if t >= 1 << 30 {
            total += t as u64;
            t = 0;
        }
    }
    (out, steps, total + t as u64)
}

fn exerciser(name: &str, fixture: &str) {
    common::part(name, || {
        let path = common::fixture(fixture, name)?;
        let program = std::fs::read(path).unwrap();
        let start = Instant::now();
        let (out, steps, tstates) = run_cpm(&program, u64::MAX);
        let seconds = start.elapsed().as_secs_f64();
        let lines: Vec<&str> = out
            .split(['\r', '\n'])
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        let ok = lines.iter().filter(|l| l.ends_with("OK")).count();
        let mut failures: Vec<String> = lines
            .iter()
            .filter(|l| l.contains("ERROR"))
            .map(|l| l.to_string())
            .collect();
        if !out.contains("Tests complete") {
            failures.push(format!("did not finish: {out}"));
        }
        if ok != 67 {
            failures.push(format!("{ok} groups printed OK, of 67"));
        }
        // How fast, measured here and reported, never judged: the machine is shared.
        let summary = format!(
            "{ok} of 67 groups OK; {steps} instructions, {tstates} T-states in {seconds:.1} s: {:.0} million \
             instructions/s, {:.0}× a 3.5 MHz Z80",
            steps as f64 / seconds / 1e6,
            tstates as f64 / seconds / 3.5e6
        );
        Some((failures, summary))
    });
}

#[test]
#[ignore]
fn zexdoc() {
    exerciser("ZEXDOC", "zexdoc.com");
}

#[test]
#[ignore]
fn zexall() {
    exerciser("ZEXALL", "zexall.com");
}

/// How fast the CPU runs, in the default layer: ZEXDOC's first 200 million instructions, measured and
/// reported (to nerd and on stderr), never judged against a number, as the machine is shared.
#[test]
fn speed() {
    common::part("speed", || {
        let path = common::fixture("zexdoc.com", "speed")?;
        let program = std::fs::read(path).unwrap();
        let start = Instant::now();
        let (_, steps, tstates) = run_cpm(&program, 200_000_000);
        let seconds = start.elapsed().as_secs_f64();
        let summary = format!(
            "{steps} instructions of ZEXDOC, {tstates} T-states in {seconds:.2} s: {:.0} million instructions/s, \
             {:.0}× a 3.5 MHz Z80",
            steps as f64 / seconds / 1e6,
            tstates as f64 / seconds / 3.5e6
        );
        Some((Vec::new(), summary))
    });
}
