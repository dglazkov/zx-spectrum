//! SingleStepTests/z80 (github.com/SingleStepTests/z80, MIT; fetched as a zip of the repository through
//! scripts/fixture): 1,604 files, one per opcode of every table, 1,000 random tests in each. Every test gives
//! the state before and after one instruction (registers, MEMPTR as wz, Q, IFF1/2, IM, R, and whether the
//! instruction was EI or LD A,I/R), the memory it touches, the I/O it does, and the bus T-state by T-state:
//! the address and data pins and which of RD, WR, MREQ and IORQ are active.
//!
//! The default layer runs the first 25 tests of every file; `singlestep_all` (the z80-suites layer) runs all
//! 1,604,000.
//!
//! The tests' bus is "simplified" (their README): MREQ and RD/WR pulse in one T-state of a memory cycle, and
//! IORQ in the third T-state of an I/O cycle. Each of our bus cycles is laid out that way here and compared
//! pin for pin, so the order, length and address of every cycle, internal ones included, is checked.

mod common;

use serde::Deserialize;
use z80::{Bus, Cpu};

#[derive(Deserialize)]
struct Test {
    name: String,
    initial: State,
    #[serde(rename = "final")]
    end: State,
    cycles: Vec<(Option<u16>, Option<u8>, String)>,
    #[serde(default)]
    ports: Vec<(u16, u8, String)>,
}

#[derive(Deserialize, Clone)]
struct State {
    pc: u16,
    sp: u16,
    a: u8,
    b: u8,
    c: u8,
    d: u8,
    e: u8,
    f: u8,
    h: u8,
    l: u8,
    i: u8,
    r: u8,
    ei: u8,
    wz: u16,
    ix: u16,
    iy: u16,
    af_: u16,
    bc_: u16,
    de_: u16,
    hl_: u16,
    im: u8,
    p: u8,
    q: u8,
    iff1: u8,
    iff2: u8,
    ram: Vec<(u16, u8)>,
}

/// One T-state of the bus as the tests write it: address, data (None when it does not matter), pins.
type Tick = (u16, Option<u8>, &'static str);

struct TestBus {
    mem: Vec<u8>,
    ticks: Vec<Tick>,
    /// The values the test's port reads return, in order, and what it saw written.
    port_reads: Vec<u8>,
    ports: Vec<(u16, u8, char)>,
}

impl TestBus {
    fn tick(&mut self, addr: u16, data: Option<u8>, pins: &'static str) {
        self.ticks.push((addr, data, pins));
    }
}

impl Bus for TestBus {
    fn fetch(&mut self, addr: u16, ir: u16, t: &mut u32) -> u8 {
        *t += 4;
        let v = self.mem[addr as usize];
        self.tick(addr, None, "----");
        self.tick(addr, None, "r-m-");
        self.tick(ir, Some(v), "----");
        self.tick(ir, None, "----");
        v
    }
    fn read(&mut self, addr: u16, t: &mut u32) -> u8 {
        *t += 3;
        let v = self.mem[addr as usize];
        self.tick(addr, None, "----");
        self.tick(addr, None, "r-m-");
        self.tick(addr, Some(v), "----");
        v
    }
    fn write(&mut self, addr: u16, value: u8, t: &mut u32) {
        *t += 3;
        self.mem[addr as usize] = value;
        self.tick(addr, None, "----");
        self.tick(addr, Some(value), "-wm-");
        self.tick(addr, None, "----");
    }
    fn internal(&mut self, addr: u16, n: u32, t: &mut u32) {
        *t += n;
        for _ in 0..n {
            self.tick(addr, None, "----");
        }
    }
    fn port_in(&mut self, port: u16, t: &mut u32) -> u8 {
        *t += 4;
        let v = if self.port_reads.is_empty() {
            0xff
        } else {
            self.port_reads.remove(0)
        };
        self.ports.push((port, v, 'r'));
        self.tick(port, None, "----");
        self.tick(port, None, "----");
        self.tick(port, None, "r--i");
        self.tick(port, Some(v), "----");
        v
    }
    fn port_out(&mut self, port: u16, value: u8, t: &mut u32) {
        *t += 4;
        self.ports.push((port, value, 'w'));
        self.tick(port, None, "----");
        self.tick(port, None, "----");
        self.tick(port, Some(value), "-w-i");
        self.tick(port, None, "----");
    }
    fn int_ack(&mut self, t: &mut u32) -> u8 {
        *t += 6;
        0xff
    }
}

fn run(test: &Test) -> Result<(), String> {
    let s = &test.initial;
    let mut cpu = Cpu::new();
    let r = &mut cpu.regs;
    (r.a, r.f, r.b, r.c, r.d, r.e, r.h, r.l) = (s.a, s.f, s.b, s.c, s.d, s.e, s.h, s.l);
    (r.af_, r.bc_, r.de_, r.hl_) = (s.af_, s.bc_, s.de_, s.hl_);
    (r.ix, r.iy, r.sp, r.pc, r.i, r.r, r.memptr) = (s.ix, s.iy, s.sp, s.pc, s.i, s.r, s.wz);
    (r.iff1, r.iff2, r.im, r.q) = (s.iff1 != 0, s.iff2 != 0, s.im, s.q);
    (r.int_blocked, r.ld_a_ir) = (s.ei != 0, s.p != 0);
    let mut bus = TestBus {
        mem: vec![0; 0x10000],
        ticks: Vec::with_capacity(32),
        port_reads: test
            .ports
            .iter()
            .filter(|p| p.2 == "r")
            .map(|p| p.1)
            .collect(),
        ports: Vec::new(),
    };
    for &(addr, v) in &s.ram {
        bus.mem[addr as usize] = v;
    }
    let mut t = 0;
    // One instruction: its prefixes are steps of their own.
    cpu.step(&mut bus, &mut t);
    while cpu.regs.prefix != 0 {
        cpu.step(&mut bus, &mut t);
    }

    let e = &test.end;
    let r = &cpu.regs;
    // RETI/RETN (and duplicates) that copy a set IFF2 into a clear IFF1 hold off INT for an instruction,
    // as EI does; the tests' "ei" says only whether the instruction was EI.
    let retn = test.name.starts_with("ED ")
        && matches!(
            &test.name[3..5],
            "45" | "4D" | "55" | "5D" | "65" | "6D" | "75" | "7D"
        );
    let blocked = e.ei != 0 || (retn && s.iff1 == 0 && s.iff2 != 0);
    let got = [
        r.a as u32,
        r.f as u32,
        r.b as u32,
        r.c as u32,
        r.d as u32,
        r.e as u32,
        r.h as u32,
        r.l as u32,
        r.i as u32,
        r.r as u32,
        r.af_ as u32,
        r.bc_ as u32,
        r.de_ as u32,
        r.hl_ as u32,
        r.ix as u32,
        r.iy as u32,
        r.pc as u32,
        r.sp as u32,
        r.memptr as u32,
        r.iff1 as u32,
        r.iff2 as u32,
        r.im as u32,
        r.int_blocked as u32,
        r.ld_a_ir as u32,
        r.q as u32,
    ];
    let want = [
        e.a as u32,
        e.f as u32,
        e.b as u32,
        e.c as u32,
        e.d as u32,
        e.e as u32,
        e.h as u32,
        e.l as u32,
        e.i as u32,
        e.r as u32,
        e.af_ as u32,
        e.bc_ as u32,
        e.de_ as u32,
        e.hl_ as u32,
        e.ix as u32,
        e.iy as u32,
        e.pc as u32,
        e.sp as u32,
        e.wz as u32,
        e.iff1 as u32,
        e.iff2 as u32,
        e.im as u32,
        blocked as u32,
        e.p as u32,
        e.q as u32,
    ];
    const NAMES: [&str; 25] = [
        "a", "f", "b", "c", "d", "e", "h", "l", "i", "r", "af_", "bc_", "de_", "hl_", "ix", "iy",
        "pc", "sp", "wz", "iff1", "iff2", "im", "ei", "p", "q",
    ];
    for k in 0..got.len() {
        if got[k] != want[k] {
            return Err(format!(
                "{} is {:#x}, want {:#x}",
                NAMES[k], got[k], want[k]
            ));
        }
    }
    for &(addr, v) in &e.ram {
        if bus.mem[addr as usize] != v {
            return Err(format!(
                "({addr:#06x}) is {:#04x}, want {v:#04x}",
                bus.mem[addr as usize]
            ));
        }
    }
    let want_ports: Vec<(u16, u8, char)> = test
        .ports
        .iter()
        .map(|p| (p.0, p.1, p.2.chars().next().unwrap_or('?')))
        .collect();
    if bus.ports != want_ports {
        return Err(format!("ports {:?}, want {want_ports:?}", bus.ports));
    }
    if bus.ticks.len() != test.cycles.len() {
        return Err(format!(
            "{} T-states, want {}",
            bus.ticks.len(),
            test.cycles.len()
        ));
    }
    for (k, (g, w)) in bus.ticks.iter().zip(&test.cycles).enumerate() {
        let addr_ok = w.0.is_none_or(|a| a == g.0);
        let data_ok = w.1.is_none_or(|d| g.1 == Some(d));
        if !addr_ok || !data_ok || g.2 != w.2 {
            return Err(format!("T-state {k}: {g:?}, want {w:?}"));
        }
    }
    Ok(())
}

/// The tests of one file (the first `per_file`, or all): how many ran, how many passed, the first failures.
fn run_file(
    zip: &mut common::Zip,
    k: usize,
    per_file: Option<usize>,
) -> (usize, usize, Vec<String>) {
    let text = match per_file {
        // A test is about 600 bytes of JSON: inflate only the start of the file.
        Some(n) => zip.read_prefix(k, n * 1200 + 4096),
        None => zip.read(k),
    };
    let (mut total, mut passed, mut failures) = (0, 0, Vec::new());
    for obj in common::json_array_objects(&text, per_file.unwrap_or(usize::MAX)) {
        let test: Test = serde_json::from_slice(obj).expect("SingleStepTests JSON");
        total += 1;
        match run(&test) {
            Ok(()) => passed += 1,
            Err(e) if failures.len() < 10 => failures.push(format!("{}: {e}", test.name)),
            Err(_) => {}
        }
    }
    (total, passed, failures)
}

/// Runs the first `per_file` tests of every file (all of them when None), the files shared among a few
/// threads (each with its own handle on the zip).
fn suite(name: &str, per_file: Option<usize>) {
    common::part(name, || {
        let path = common::fixture("singlestep-z80.zip", name)?;
        let zip = common::Zip::open(&path);
        let mut files: Vec<usize> = (0..zip.entries.len())
            .filter(|&k| {
                let n = &zip.entries[k].name;
                n.contains("/v1/") && n.ends_with(".json")
            })
            .collect();
        files.sort_by(|&a, &b| zip.entries[a].name.cmp(&zip.entries[b].name));
        let threads = std::thread::available_parallelism()
            .map_or(1, |n| n.get())
            .min(8);
        let results: Vec<(usize, usize, Vec<String>)> = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|w| {
                    let (path, files) = (&path, &files);
                    scope.spawn(move || {
                        let mut zip = common::Zip::open(path);
                        files
                            .iter()
                            .skip(w)
                            .step_by(threads)
                            .map(|&k| run_file(&mut zip, k, per_file))
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            workers
                .into_iter()
                .flat_map(|w| w.join().unwrap())
                .collect()
        });
        let total: usize = results.iter().map(|r| r.0).sum();
        let passed: usize = results.iter().map(|r| r.1).sum();
        let failed_files = results.iter().filter(|r| r.0 != r.1).count();
        let failures: Vec<String> = results.into_iter().flat_map(|r| r.2).collect();
        let summary = format!(
            "{passed} of {total} tests passed, in {} files ({failed_files} with failures)",
            files.len()
        );
        Some((failures, summary))
    });
}

#[test]
fn singlestep_sample() {
    suite("SingleStepTests, 25 of each opcode", Some(25));
}

/// Every test of every file: the z80-suites layer.
#[test]
#[ignore]
fn singlestep_all() {
    suite("SingleStepTests, all", None);
}
