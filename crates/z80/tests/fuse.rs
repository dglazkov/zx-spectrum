//! The FUSE emulator's Z80 core tests (z80/tests/tests.in and tests.expected in the fuse-emulator repository,
//! GPL, fetched through scripts/fixture): 1356 tests of every opcode, each checked for its registers, its
//! memory, its T-states, and the order and T-state of every bus event FUSE's core test harness (coretest.c)
//! prints: MC (a memory contention point, at the start of every memory or internal cycle), MR, MW, PC (a port
//! contention point), PR, PW.
//!
//! The harness below is coretest.c's, as a `Bus`: memory starts as DE AD BE EF repeated, a port read returns
//! the port's high byte, and each test runs whole instructions until its T-state count is reached.
//!
//! Four things FUSE's tests encode differ from the chip as later research found it, and are compared as the
//! chip does them (each is stated where it is applied, and SingleStepTests checks them all):
//!
//! - FUSE keeps PC at a HALT while halted; the chip has moved past it, and fetches the next opcode while it
//!   waits (Tony Brewer, 2014).
//! - FUSE puts IR on the address bus for an M1 cycle's extra T-states after it has incremented R; the chip
//!   keeps the refresh address it put out (R before the increment). Only the low byte differs, which no
//!   Spectrum's contention looks at.
//! - FUSE does not perform the read of an untaken JR cc / DJNZ displacement (it adds the cycle's time and
//!   contention, but prints no MR); the chip reads it.
//! - Six tests stop in the middle of a repeating block instruction (CPIR, CPDR, INIR, INDR, OTIR, OTDR), and
//!   FUSE predates David Banks's 2018 findings on what those instructions do to the flags (and the I/O ones
//!   to MEMPTR) when they repeat. In five of them that changes F or MEMPTR, given here as the findings have
//!   them.

mod common;

use std::collections::HashMap;
use z80::{Bus, Cpu};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Event {
    t: u32,
    kind: &'static str,
    addr: u16,
    data: Option<u8>,
    /// For MC events: whether the cycle was an internal one at the refresh address of the M1 cycle before it,
    /// which FUSE prints with R one higher. (Only those: an internal T-state at any other address must match
    /// FUSE's exactly.)
    refresh: bool,
}

struct FuseBus {
    mem: Vec<u8>,
    events: Vec<Event>,
    /// The refresh address of the last M1 cycle.
    ir: u16,
}

impl FuseBus {
    fn mc(&mut self, t: u32, addr: u16, refresh: bool) {
        self.events.push(Event {
            t,
            kind: "MC",
            addr,
            data: None,
            refresh,
        });
    }
    fn ev(&mut self, t: u32, kind: &'static str, addr: u16, data: Option<u8>) {
        self.events.push(Event {
            t,
            kind,
            addr,
            data,
            refresh: false,
        });
    }
    /// coretest.c's contend_port_preio and postio around an I/O cycle (4 T-states in all).
    fn port(&mut self, kind: &'static str, port: u16, value: u8, t: &mut u32) {
        let contended = port & 0xc000 == 0x4000;
        if contended {
            self.ev(*t, "PC", port, None);
        }
        *t += 1;
        self.ev(*t, kind, port, Some(value));
        if port & 1 != 0 {
            if contended {
                for _ in 0..3 {
                    self.ev(*t, "PC", port, None);
                    *t += 1;
                }
            } else {
                *t += 3;
            }
        } else {
            self.ev(*t, "PC", port, None);
            *t += 3;
        }
    }
}

impl Bus for FuseBus {
    fn fetch(&mut self, addr: u16, ir: u16, t: &mut u32) -> u8 {
        self.ir = ir;
        self.mc(*t, addr, false);
        *t += 4;
        let v = self.mem[addr as usize];
        self.ev(*t, "MR", addr, Some(v));
        v
    }
    fn read(&mut self, addr: u16, t: &mut u32) -> u8 {
        self.mc(*t, addr, false);
        *t += 3;
        let v = self.mem[addr as usize];
        self.ev(*t, "MR", addr, Some(v));
        v
    }
    fn write(&mut self, addr: u16, value: u8, t: &mut u32) {
        self.mc(*t, addr, false);
        *t += 3;
        self.ev(*t, "MW", addr, Some(value));
        self.mem[addr as usize] = value;
    }
    fn internal(&mut self, addr: u16, n: u32, t: &mut u32) {
        for _ in 0..n {
            self.mc(*t, addr, addr == self.ir);
            *t += 1;
        }
    }
    fn port_in(&mut self, port: u16, t: &mut u32) -> u8 {
        let v = (port >> 8) as u8;
        self.port("PR", port, v, t);
        v
    }
    fn port_out(&mut self, port: u16, value: u8, t: &mut u32) {
        self.port("PW", port, value, t);
    }
    fn int_ack(&mut self, t: &mut u32) -> u8 {
        *t += 6;
        0xff
    }
}

struct Input {
    name: String,
    regs: Vec<u16>,
    i: u8,
    r: u8,
    iff1: bool,
    iff2: bool,
    im: u8,
    halted: bool,
    end: u32,
    blocks: Vec<(u16, Vec<u8>)>,
}

struct Expected {
    events: Vec<Event>,
    regs: Vec<u16>,
    state: Vec<u32>,
    blocks: Vec<(u16, Vec<u8>)>,
}

fn hex(s: &str) -> u32 {
    u32::from_str_radix(s, 16).unwrap_or_else(|_| panic!("not hex: {s}"))
}

/// Memory blocks: lines of "addr byte byte ... -1", ended by a line "-1" (tests.in) or a blank (expected).
fn blocks<'a>(lines: &mut impl Iterator<Item = &'a str>) -> Vec<(u16, Vec<u8>)> {
    let mut out = Vec::new();
    for line in lines {
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.is_empty() || words[0] == "-1" {
            break;
        }
        let bytes = words[1..]
            .iter()
            .take_while(|w| **w != "-1")
            .map(|w| hex(w) as u8)
            .collect();
        out.push((hex(words[0]) as u16, bytes));
    }
    out
}

fn parse_inputs(text: &str) -> Vec<Input> {
    let mut out = Vec::new();
    let mut lines = text.lines();
    while let Some(name) = lines.by_ref().find(|l| !l.trim().is_empty()) {
        let regs = lines
            .next()
            .unwrap()
            .split_whitespace()
            .map(|w| hex(w) as u16)
            .collect();
        let w: Vec<&str> = lines.next().unwrap().split_whitespace().collect();
        out.push(Input {
            name: name.trim().to_string(),
            regs,
            i: hex(w[0]) as u8,
            r: hex(w[1]) as u8,
            iff1: w[2] != "0",
            iff2: w[3] != "0",
            im: w[4].parse().unwrap(),
            halted: w[5] != "0",
            end: w[6].parse().unwrap(),
            blocks: blocks(&mut lines),
        });
    }
    out
}

fn parse_expected(text: &str) -> HashMap<String, Expected> {
    let mut out = HashMap::new();
    let mut lines = text.lines().peekable();
    while let Some(name) = lines.by_ref().find(|l| !l.trim().is_empty()) {
        let mut events = Vec::new();
        while let Some(line) = lines.peek() {
            let w: Vec<&str> = line.split_whitespace().collect();
            let kind = match w.get(1) {
                Some(&"MC") => "MC",
                Some(&"MR") => "MR",
                Some(&"MW") => "MW",
                Some(&"PC") => "PC",
                Some(&"PR") => "PR",
                Some(&"PW") => "PW",
                _ => break,
            };
            events.push(Event {
                t: w[0].parse().unwrap(),
                kind,
                addr: hex(w[2]) as u16,
                data: w.get(3).map(|d| hex(d) as u8),
                refresh: false,
            });
            lines.next();
        }
        let regs = lines
            .next()
            .unwrap()
            .split_whitespace()
            .map(|w| hex(w) as u16)
            .collect();
        let w: Vec<&str> = lines.next().unwrap().split_whitespace().collect();
        let state = vec![
            hex(w[0]),
            hex(w[1]),
            w[2].parse().unwrap(),
            w[3].parse().unwrap(),
            w[4].parse().unwrap(),
            w[5].parse().unwrap(),
            w[6].parse().unwrap(),
        ];
        out.insert(
            name.trim().to_string(),
            Expected {
                events,
                regs,
                state,
                blocks: blocks(&mut lines),
            },
        );
    }
    out
}

/// The tests that stop in a repeating block instruction where FUSE's expected result predates David Banks's
/// findings, with F and MEMPTR as the chip leaves them (Banks, "Undocumented Z80 Flags", 2018; MEMPTR = PC + 1
/// for INIR/INDR/OTIR/OTDR, rofl0r 2022 and Manuel Sainz de Baranda y Goñi 2023). On a repeat, Y and X are
/// bits 13 and 11 of PC (the instruction's own address); for the I/O instructions P/V and H are worked again
/// from B; the arithmetic is given with each. (FUSE's CPIR test edb1_2 stops mid-repeat too, but at
/// 8396h, whose bits 13 and 11 are clear as its expected X and Y already are.)
fn banks_override(name: &str) -> Option<(u8, u16)> {
    Some(match name {
        // CPDR at 7A45h: bits 13 and 11 of PC set Y and X: A7h becomes AFh. MEMPTR = PC + 1, as FUSE has.
        "edb9_2" => (0xaf, 0x7a46),
        // INIR at 0000h, in 0Ah with B 0Ah→09h: X and Y from PC (clear), no carry so P/V ^= odd(B & 7 = 1):
        // 0Ch becomes 00h.
        "edb2_1" => (0x00, 0x0001),
        // INDR at 0000h, in 06h with B 06h→05h: no carry, so P/V ^= odd(B & 7 = 5), which is 0: F stays 00h.
        "edba_1" => (0x00, 0x0001),
        // OTIR at 0000h, out 9Dh with B 03h→02h and L 7Dh: carry, and the byte's bit 7 set, so
        // P/V ^= odd((B - 1) & 7 = 1), which flips it clear, and H = ((B & 0Fh) == 0), clear: 17h becomes 03h.
        "edb3_1" => (0x03, 0x0001),
        // OTDR at 0000h, out B6h with B 04h→03h and L CFh: carry, and bit 7 set, so P/V ^= odd((B - 1) & 7 = 2),
        // which flips it clear, and H = ((B & 0Fh) == 0), clear: 17h becomes 03h.
        "edbb_1" => (0x03, 0x0001),
        _ => return None,
    })
}

#[test]
fn fuse_core_tests() {
    common::part("FUSE core tests", || {
        let input = common::fixture("fuse-z80-tests.in", "FUSE core tests")?;
        let expected = common::fixture("fuse-z80-tests.expected", "FUSE core tests")?;
        let inputs = parse_inputs(&std::fs::read_to_string(input).unwrap());
        let expected = parse_expected(&std::fs::read_to_string(expected).unwrap());
        let mut failures = Vec::new();
        let mut passed = 0;
        for test in &inputs {
            let exp = expected
                .get(&test.name)
                .unwrap_or_else(|| panic!("{} has no expected result", test.name));
            match run(test, exp) {
                Ok(()) => passed += 1,
                Err(e) => failures.push(format!("{}: {e}", test.name)),
            }
        }
        Some((failures, format!("{passed} of {} passed", inputs.len())))
    });
}

fn run(test: &Input, exp: &Expected) -> Result<(), String> {
    let mut mem: Vec<u8> = (0..0x10000)
        .map(|i| [0xde, 0xad, 0xbe, 0xef][i % 4])
        .collect();
    for (addr, bytes) in &test.blocks {
        for (k, b) in bytes.iter().enumerate() {
            mem[(*addr as usize + k) & 0xffff] = *b;
        }
    }
    let initial = mem.clone();
    let mut cpu = Cpu::new();
    {
        let r = &mut cpu.regs;
        let v = &test.regs;
        r.set_af(v[0]);
        r.set_bc(v[1]);
        r.set_de(v[2]);
        r.set_hl(v[3]);
        r.af_ = v[4];
        r.bc_ = v[5];
        r.de_ = v[6];
        r.hl_ = v[7];
        r.ix = v[8];
        r.iy = v[9];
        r.sp = v[10];
        r.pc = v[11];
        r.memptr = v[12];
        r.i = test.i;
        r.r = test.r;
        r.iff1 = test.iff1;
        r.iff2 = test.iff2;
        r.im = test.im;
        r.halted = test.halted;
    }
    let mut bus = FuseBus {
        mem,
        events: Vec::new(),
        ir: 0,
    };
    let mut t = 0u32;
    // FUSE runs whole instructions, a prefix and its opcode together.
    while t < test.end || cpu.regs.prefix != 0 {
        cpu.step(&mut bus, &mut t);
    }

    let r = &cpu.regs;
    // FUSE keeps PC at a HALT while halted; the chip has moved past it (see the crate's documentation).
    let pc = if r.halted { r.pc.wrapping_sub(1) } else { r.pc };
    let mut want_regs = exp.regs.clone();
    let mut want_state = exp.state.clone();
    if let Some((f, memptr)) = banks_override(&test.name) {
        want_regs[0] = (want_regs[0] & 0xff00) | f as u16;
        want_regs[12] = memptr;
    }
    let got_regs = vec![
        r.af(),
        r.bc(),
        r.de(),
        r.hl(),
        r.af_,
        r.bc_,
        r.de_,
        r.hl_,
        r.ix,
        r.iy,
        r.sp,
        pc,
        r.memptr,
    ];
    if got_regs != want_regs {
        return Err(format!(
            "registers {} want {}",
            words(&got_regs),
            words(&want_regs)
        ));
    }
    let got_state = vec![
        r.i as u32,
        r.r as u32,
        r.iff1 as u32,
        r.iff2 as u32,
        r.im as u32,
        r.halted as u32,
        t,
    ];
    want_state[6] = exp.state[6];
    if got_state != want_state {
        return Err(format!(
            "I R IFF1 IFF2 IM halted T {got_state:?} want {want_state:?}"
        ));
    }
    compare_events(&bus.events, &exp.events)?;
    let mut want_mem = initial.clone();
    for (addr, bytes) in &exp.blocks {
        for (k, b) in bytes.iter().enumerate() {
            want_mem[(*addr as usize + k) & 0xffff] = *b;
        }
    }
    if let Some(a) = (0..0x10000).find(|&a| bus.mem[a] != want_mem[a]) {
        return Err(format!(
            "memory at {a:04x} is {:02x}, want {:02x}",
            bus.mem[a], want_mem[a]
        ));
    }
    Ok(())
}

fn words(v: &[u16]) -> String {
    v.iter()
        .map(|w| format!("{w:04x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The bus events, in order and at their T-states, allowing the two differences in FUSE's model above.
fn compare_events(got: &[Event], want: &[Event]) -> Result<(), String> {
    let (mut g, mut w) = (0, 0);
    while g < got.len() || w < want.len() {
        let Some(a) = got.get(g) else {
            return Err(format!("events: got none, want {:?}", want.get(w)));
        };
        if let Some(b) = want.get(w) {
            let same = a.t == b.t && a.kind == b.kind && a.data == b.data;
            if same && a.addr == b.addr {
                g += 1;
                w += 1;
                continue;
            }
            // An internal T-state at the refresh address: FUSE prints it with R one higher.
            let r = a.addr as u8;
            if same
                && a.refresh
                && a.addr >> 8 == b.addr >> 8
                && b.addr as u8 == (r & 0x80) | (r.wrapping_add(1) & 0x7f)
            {
                g += 1;
                w += 1;
                continue;
            }
        }
        // The read of an untaken JR cc / DJNZ displacement, which FUSE does not print: a read cycle at the
        // address after the opcode fetch of a JR cc or DJNZ, with no more of its cycles after it.
        let read_cycle = g > 0
            && got[g - 1].kind == "MC"
            && got[g - 1].addr == a.addr
            && got[g - 1].t + 3 == a.t;
        let after_jr = got[..g.saturating_sub(1)]
            .iter()
            .rev()
            .find(|e| e.kind == "MR")
            .is_some_and(|e| {
                e.addr == a.addr.wrapping_sub(1)
                    && matches!(e.data, Some(0x10 | 0x20 | 0x28 | 0x30 | 0x38))
            });
        let taken = got
            .get(g + 1)
            .is_some_and(|e| e.kind == "MC" && e.addr == a.addr);
        if a.kind == "MR" && read_cycle && after_jr && !taken {
            g += 1;
            continue;
        }
        return Err(format!("event {g}: got {a:?}, want {:?}", want.get(w)));
    }
    Ok(())
}
