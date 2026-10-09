//! What the instruction suites do not test: the interrupt responses (IM 0, 1, 2 and NMI) cycle by cycle,
//! when an interrupt is and is not accepted (EI, DD/FD prefixes, RETN, LD A,I), HALT, R, RESET, and the
//! disassembler against the CPU.

use z80::{Bus, Cpu, disasm, flags};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ev {
    Fetch(u16, u16),
    Read(u16),
    Write(u16, u8),
    Internal(u16, u32),
    In(u16),
    Out(u16, u8),
    IntAck,
}

/// 64K of RAM that records every cycle, with the T-state it began at.
#[derive(Clone)]
struct Rec {
    mem: Box<[u8; 0x10000]>,
    events: Vec<(u32, Ev)>,
    /// What the interrupting device puts on the data bus.
    ack: u8,
}

impl Rec {
    fn new(program: &[(u16, &[u8])]) -> Rec {
        let mut mem = Box::new([0u8; 0x10000]);
        for (at, bytes) in program {
            for (k, b) in bytes.iter().enumerate() {
                mem[*at as usize + k] = *b;
            }
        }
        Rec {
            mem,
            events: Vec::new(),
            ack: 0xff,
        }
    }
}

impl Bus for Rec {
    fn fetch(&mut self, addr: u16, ir: u16, t: &mut u32) -> u8 {
        self.events.push((*t, Ev::Fetch(addr, ir)));
        *t += 4;
        self.mem[addr as usize]
    }
    fn read(&mut self, addr: u16, t: &mut u32) -> u8 {
        self.events.push((*t, Ev::Read(addr)));
        *t += 3;
        self.mem[addr as usize]
    }
    fn write(&mut self, addr: u16, value: u8, t: &mut u32) {
        self.events.push((*t, Ev::Write(addr, value)));
        *t += 3;
        self.mem[addr as usize] = value;
    }
    fn internal(&mut self, addr: u16, n: u32, t: &mut u32) {
        self.events.push((*t, Ev::Internal(addr, n)));
        *t += n;
    }
    fn port_in(&mut self, port: u16, t: &mut u32) -> u8 {
        self.events.push((*t, Ev::In(port)));
        *t += 4;
        0xff
    }
    fn port_out(&mut self, port: u16, value: u8, t: &mut u32) {
        self.events.push((*t, Ev::Out(port, value)));
        *t += 4;
    }
    fn int_ack(&mut self, t: &mut u32) -> u8 {
        self.events.push((*t, Ev::IntAck));
        *t += 6;
        self.ack
    }
}

/// A CPU with interrupts enabled, at `pc`, with the stack at 8000h.
fn cpu_at(pc: u16, im: u8) -> Cpu {
    let mut cpu = Cpu::new();
    cpu.regs.pc = pc;
    cpu.regs.sp = 0x8000;
    cpu.regs.iff1 = true;
    cpu.regs.iff2 = true;
    cpu.regs.im = im;
    cpu.regs.i = 0x3f;
    cpu.regs.r = 0x10;
    cpu
}

#[test]
fn im1_response_is_13_t_states_ending_at_0038h() {
    let mut cpu = cpu_at(0x1234, 1);
    let mut bus = Rec::new(&[]);
    let mut t = 100;
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(t, 113);
    assert_eq!(
        bus.events,
        vec![
            (100, Ev::IntAck),
            (106, Ev::Internal(0x3f10, 1)),
            (107, Ev::Write(0x7fff, 0x12)),
            (110, Ev::Write(0x7ffe, 0x34)),
        ]
    );
    let r = &cpu.regs;
    assert_eq!((r.pc, r.sp, r.memptr, r.r), (0x0038, 0x7ffe, 0x0038, 0x11));
    assert!(!r.iff1 && !r.iff2);
    // IFF1 is clear now: a second request is refused.
    assert!(!cpu.interrupt(&mut bus, &mut t));
}

#[test]
fn im2_response_is_19_t_states_through_the_vector() {
    let mut cpu = cpu_at(0x1234, 2);
    cpu.regs.i = 0x80;
    let mut bus = Rec::new(&[(0x80ff, &[0x00, 0x90]), (0x8020, &[0x00, 0xa0])]);
    let mut t = 0;
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(t, 19);
    assert_eq!(
        bus.events,
        vec![
            (0, Ev::IntAck),
            (6, Ev::Internal(0x8010, 1)),
            (7, Ev::Write(0x7fff, 0x12)),
            (10, Ev::Write(0x7ffe, 0x34)),
            (13, Ev::Read(0x80ff)),
            (16, Ev::Read(0x8100)),
        ]
    );
    assert_eq!((cpu.regs.pc, cpu.regs.memptr), (0x9000, 0x9000));

    // A device that puts another byte on the bus picks another vector (any byte: bit 0 is not ignored).
    let mut cpu = cpu_at(0x1234, 2);
    cpu.regs.i = 0x80;
    bus.ack = 0x20;
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(cpu.regs.pc, 0xa000);
}

#[test]
fn im0_executes_the_byte_on_the_bus() {
    // On a Spectrum the bus reads FFh: RST 38h, 13 T-states, pushing the interrupted PC.
    let mut cpu = cpu_at(0x1234, 0);
    let mut bus = Rec::new(&[]);
    let mut t = 0;
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(t, 13);
    assert_eq!(
        (cpu.regs.pc, bus.mem[0x7fff], bus.mem[0x7ffe]),
        (0x0038, 0x12, 0x34)
    );
    assert_eq!(bus.events[0], (0, Ev::IntAck));
    assert_eq!(bus.events[1], (6, Ev::Internal(0x3f10, 1)));

    // Another RST from the device goes where it says.
    let mut cpu = cpu_at(0x1234, 0);
    bus.ack = 0xd7;
    t = 0;
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!((cpu.regs.pc, t), (0x0010, 13));
}

#[test]
fn nmi_response_is_11_t_states_ending_at_0066h() {
    let mut cpu = cpu_at(0x1234, 1);
    cpu.regs.iff2 = true;
    let mut bus = Rec::new(&[]);
    let mut t = 0;
    assert!(cpu.nmi(&mut bus, &mut t));
    assert_eq!(t, 11);
    assert_eq!(
        bus.events,
        vec![
            (0, Ev::Fetch(0x1234, 0x3f10)),
            (4, Ev::Internal(0x3f10, 1)),
            (5, Ev::Write(0x7fff, 0x12)),
            (8, Ev::Write(0x7ffe, 0x34)),
        ]
    );
    let r = &cpu.regs;
    assert_eq!((r.pc, r.memptr, r.r), (0x0066, 0x0066, 0x11));
    // IFF1 is cleared; IFF2 keeps the state for RETN.
    assert!(!r.iff1 && r.iff2);
}

#[test]
fn retn_restores_iff1_and_holds_off_int_for_one_instruction() {
    // The NMI handler at 0066h is RETN; the interrupted code is NOPs.
    let mut cpu = cpu_at(0x1000, 1);
    let mut bus = Rec::new(&[(0x0066, &[0xed, 0x45])]);
    let mut t = 0;
    assert!(cpu.nmi(&mut bus, &mut t));
    assert!(!cpu.accepts_interrupt());
    cpu.step(&mut bus, &mut t);
    assert_eq!(cpu.regs.pc, 0x1000);
    assert!(cpu.regs.iff1);
    // IFF2 reaches IFF1 during the next opcode fetch: too late for INT at the end of the RETN.
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(cpu.interrupt(&mut bus, &mut t));
}

#[test]
fn ei_holds_off_int_until_after_the_next_instruction() {
    // EI; EI; NOP: no interrupt after either EI, one after the NOP.
    let mut cpu = cpu_at(0, 1);
    cpu.regs.iff1 = false;
    cpu.regs.iff2 = false;
    let mut bus = Rec::new(&[(0, &[0xfb, 0xfb, 0x00])]);
    let mut t = 0;
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(cpu.regs.iff1 && cpu.regs.int_blocked);
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(cpu.interrupt(&mut bus, &mut t));
    // An NMI is not held off by EI.
    let mut cpu = cpu_at(0, 1);
    cpu.step(&mut bus, &mut t);
    assert!(cpu.nmi(&mut bus, &mut t));
}

#[test]
fn di_disables() {
    let mut cpu = cpu_at(0, 1);
    let mut bus = Rec::new(&[(0, &[0xf3])]);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    assert!(!cpu.regs.iff1 && !cpu.regs.iff2);
    assert!(!cpu.interrupt(&mut bus, &mut t));
}

#[test]
fn nothing_is_accepted_between_a_prefix_and_its_opcode() {
    // DD FD 21 34 12: LD IY,1234h after two prefixes, each a step of 4 T-states.
    let mut cpu = cpu_at(0, 1);
    let mut bus = Rec::new(&[(0, &[0xdd, 0xfd, 0x21, 0x34, 0x12])]);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    assert_eq!((t, cpu.regs.prefix), (4, 0xdd));
    assert!(!cpu.interrupt(&mut bus, &mut t));
    assert!(!cpu.nmi(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert_eq!((t, cpu.regs.prefix), (8, 0xfd));
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert_eq!(
        (t, cpu.regs.prefix, cpu.regs.iy, cpu.regs.ix),
        (18, 0, 0x1234, 0xffff)
    );
    assert_eq!(cpu.regs.r, 0x13);
    assert!(cpu.interrupt(&mut bus, &mut t));
}

#[test]
fn memory_full_of_prefixes_runs_a_step_at_a_time() {
    let mut cpu = cpu_at(0, 1);
    let mut bus = Rec::new(&[]);
    bus.mem.fill(0xdd);
    let mut t = 0;
    for _ in 0..70_000 {
        cpu.step(&mut bus, &mut t);
        assert_eq!(cpu.regs.prefix, 0xdd);
        assert!(!cpu.accepts_interrupt());
    }
    assert_eq!(t, 280_000);
    assert_eq!(cpu.regs.pc, (70_000u32 % 65_536) as u16);
}

#[test]
fn interrupt_during_ld_a_i_clears_pv() {
    // LD A,I copies IFF2 into P/V; on the NMOS Z80 an interrupt taken right after it clears P/V.
    let mut cpu = cpu_at(0, 1);
    let mut bus = Rec::new(&[(0, &[0xed, 0x57, 0xed, 0x5f, 0x00])]);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    assert_ne!(cpu.regs.f & flags::P, 0);
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(cpu.regs.f & flags::P, 0);
    // Not when anything comes between.
    let mut cpu = cpu_at(2, 1);
    cpu.step(&mut bus, &mut t);
    cpu.step(&mut bus, &mut t);
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_ne!(cpu.regs.f & flags::P, 0);
}

#[test]
fn halt_fetches_the_next_opcode_until_an_interrupt() {
    let mut cpu = cpu_at(0x8000, 1);
    cpu.regs.sp = 0xc000;
    let mut bus = Rec::new(&[(0x8000, &[0x76, 0x3c])]);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    assert!(cpu.regs.halted);
    assert_eq!((cpu.regs.pc, t), (0x8001, 4));
    // Each step is one M1 cycle at the byte after the HALT, discarded (the INC A there does not run).
    for k in 0..3u32 {
        bus.events.clear();
        let r = cpu.regs.r;
        cpu.step(&mut bus, &mut t);
        assert_eq!(
            bus.events,
            vec![(4 + 4 * k, Ev::Fetch(0x8001, u16::from_be_bytes([0x3f, r])))]
        );
        assert_eq!(cpu.regs.pc, 0x8001);
    }
    assert_eq!((cpu.regs.a, cpu.regs.r), (0xff, 0x14));
    // The interrupt pushes the address after the HALT.
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert!(!cpu.regs.halted);
    assert_eq!(
        (bus.mem[0xbfff], bus.mem[0xbffe], cpu.regs.pc),
        (0x80, 0x01, 0x0038)
    );
}

#[test]
fn nmi_leaves_halt_too() {
    let mut cpu = cpu_at(0x8000, 1);
    let mut bus = Rec::new(&[(0x8000, &[0x76])]);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    cpu.step(&mut bus, &mut t);
    assert!(cpu.nmi(&mut bus, &mut t));
    assert!(!cpu.regs.halted);
    assert_eq!(
        (bus.mem[0x7fff], bus.mem[0x7ffe], cpu.regs.pc),
        (0x80, 0x01, 0x0066)
    );
}

#[test]
fn r_counts_m1_cycles_in_seven_bits() {
    let mut bus = Rec::new(&[(
        0,
        &[
            0x00, 0xcb, 0x00, 0xed, 0x44, 0xdd, 0x21, 0, 0, 0xfd, 0xcb, 0x00, 0x06,
        ],
    )]);
    let mut cpu = cpu_at(0, 1);
    cpu.regs.r = 0xfe;
    let mut t = 0;
    let mut seen = Vec::new();
    while cpu.regs.pc < 13 {
        cpu.step(&mut bus, &mut t);
        if cpu.regs.prefix == 0 {
            seen.push(cpu.regs.r);
        }
    }
    // NOP 1, CB 2, ED 2, DD-prefixed 2, FDCB 2 (its displacement and opcode are reads); bit 7 is kept.
    assert_eq!(seen, vec![0xff, 0x81, 0x83, 0x85, 0x87]);
}

#[test]
fn power_on_and_reset_state() {
    let cpu = Cpu::new();
    let r = &cpu.regs;
    assert_eq!(
        (r.pc, r.i, r.r, r.im, r.iff1, r.iff2),
        (0, 0, 0, 0, false, false)
    );
    assert_eq!(
        [r.af(), r.bc(), r.de(), r.hl(), r.sp, r.ix, r.iy],
        [0xffff; 7]
    );
    assert_eq!([r.af_, r.bc_, r.de_, r.hl_], [0xffff; 4]);

    // RESET clears PC, I, R, the flip-flops and IM, and leaves the other registers as they were.
    let mut cpu = cpu_at(0x1234, 2);
    (cpu.regs.b, cpu.regs.a, cpu.regs.sp, cpu.regs.halted) = (0x55, 0x12, 0x4000, true);
    cpu.reset();
    let r = &cpu.regs;
    assert_eq!((r.pc, r.i, r.r, r.im), (0, 0, 0, 0));
    assert!(!r.iff1 && !r.iff2 && !r.halted);
    assert_eq!((r.b, r.a, r.sp), (0x55, 0x12, 0x4000));
}

/// The disassembler's length for every opcode of every table is how far the CPU moves PC through it, and
/// a DD/FD prefix it calls a lone NOP is one the CPU treats as one.
#[test]
fn disassembler_lengths_match_the_cpu() {
    let mut prefixes: Vec<Vec<u8>> = vec![vec![], vec![0xcb], vec![0xed], vec![0xdd], vec![0xfd]];
    prefixes.push(vec![0xdd, 0xcb, 0x05]);
    prefixes.push(vec![0xfd, 0xcb, 0xfb]);
    let mut checked = 0;
    for prefix in &prefixes {
        for op in 0..=255u8 {
            let mut bytes = prefix.clone();
            bytes.push(op);
            bytes.extend([0x01, 0x02, 0x03]);
            let at = 0x4000u16;
            let mut bus = Rec::new(&[(at, &bytes)]);
            let ins = disasm::disassemble(|a| bus.mem[a as usize], at);
            if ["JR", "DJNZ", "JP", "CALL", "RET", "RST"]
                .iter()
                .any(|m| ins.text.starts_with(m))
            {
                continue;
            }
            let mut cpu = cpu_at(at, 1);
            // Block instructions that do not repeat: BC reaching 0, or B for the I/O ones.
            let counted_by_bc = ["LDIR", "LDDR", "CPIR", "CPDR"].contains(&ins.text.as_str());
            cpu.regs.set_bc(if counted_by_bc { 0x0001 } else { 0x0101 });
            let mut t = 0;
            cpu.step(&mut bus, &mut t);
            if ins.len > 1 {
                while cpu.regs.prefix != 0 {
                    cpu.step(&mut bus, &mut t);
                }
            }
            let moved = cpu.regs.pc.wrapping_sub(at);
            assert_eq!(
                moved, ins.len as u16,
                "{bytes:02x?}: {} is {} bytes, the CPU moved {moved}",
                ins.text, ins.len
            );
            checked += 1;
        }
    }
    assert!(checked > 1500);
}

/// A prefix the disassembler calls a lone NOP changes nothing about the opcode after it: the two run as the
/// opcode alone would, 4 T-states and one R later.
#[test]
fn ignored_prefixes_change_nothing() {
    // The opcode at 4001h, with or without the prefix at 4000h in front of it.
    let run = |prefix: Option<u8>, op: u8| {
        let mut bus = Rec::new(&[(0x4001, &[op, 0x12, 0x34, 0x56])]);
        let mut cpu = cpu_at(0x4001, 1);
        if let Some(p) = prefix {
            bus.mem[0x4000] = p;
            cpu.regs.pc = 0x4000;
        }
        (cpu.regs.b, cpu.regs.c, cpu.regs.h, cpu.regs.l) = (0x01, 0x02, 0x40, 0x10);
        (cpu.regs.ix, cpu.regs.iy, cpu.regs.f) = (0x9999, 0x7777, 0x00);
        let mut t = 0;
        cpu.step(&mut bus, &mut t);
        while cpu.regs.prefix != 0 {
            cpu.step(&mut bus, &mut t);
        }
        bus.mem[0x4000] = 0;
        (cpu.regs, t, bus.mem)
    };
    let mut checked = 0;
    for prefix in [0xddu8, 0xfd] {
        for op in 0..=255u8 {
            let bytes = [prefix, op, 0x12, 0x34, 0x56];
            let ins = disasm::disassemble(|a| bytes.get(a as usize).copied().unwrap_or(0), 0);
            // A prefix before a prefix (or ED) is also a lone NOP; what follows is another instruction.
            if ins.len != 1 || matches!(op, 0xdd | 0xfd | 0xed) {
                continue;
            }
            let (with, t_with, mem_with) = run(Some(prefix), op);
            let (alone, t_alone, mem_alone) = run(None, op);
            assert_eq!(with.r, alone.r.wrapping_add(1), "{prefix:02x} {op:02x}");
            assert_eq!(
                with,
                z80::Regs { r: with.r, ..alone },
                "{prefix:02x} {op:02x} ({})",
                ins.text
            );
            assert_eq!(t_with, t_alone + 4, "{prefix:02x} {op:02x}");
            assert!(mem_with == mem_alone, "{prefix:02x} {op:02x}");
            checked += 1;
        }
    }
    // Of the 256 opcodes, 86 use H, L, HL or (HL) (or are CB); less DD, FD and ED, 167 are left.
    assert_eq!(checked, 2 * 167);
}

/// A LDIR interrupted between two of its iterations: the interrupt pushes the LDIR's own address, the flags it
/// leaves are those of a repeating iteration (Y and X from bits 13 and 11 of that address, P/V set), and after
/// the handler returns the LDIR carries on where it stopped.
#[test]
fn an_interrupted_ldir_resumes_where_it_stopped() {
    // LDIR at 2800h (bits 13 and 11 set); the IM 1 handler is EI; RETI.
    let mut bus = Rec::new(&[
        (0x2800, &[0xed, 0xb0]),
        (0x9000, &[0x11, 0x22, 0x33]),
        (0x0038, &[0xfb, 0xed, 0x4d]),
    ]);
    let mut cpu = cpu_at(0x2800, 1);
    cpu.regs.set_hl(0x9000);
    cpu.regs.set_de(0xa000);
    cpu.regs.set_bc(3);
    cpu.regs.f = 0;
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    // One iteration that goes round again: 21 T-states, PC back on the LDIR.
    assert_eq!(
        (t, cpu.regs.pc, cpu.regs.bc(), cpu.regs.memptr),
        (21, 0x2800, 2, 0x2801)
    );
    assert_eq!(cpu.regs.f, flags::Y | flags::X | flags::P);
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!((bus.mem[0x7fff], bus.mem[0x7ffe]), (0x28, 0x00));
    // The handler: EI, then RETI back into the LDIR. IFF1 was already set again by EI, so INT is not held
    // off after the RETI.
    cpu.step(&mut bus, &mut t);
    cpu.step(&mut bus, &mut t);
    assert_eq!(cpu.regs.pc, 0x2800);
    assert!(cpu.accepts_interrupt());
    // The two iterations left.
    cpu.step(&mut bus, &mut t);
    assert_eq!((cpu.regs.pc, cpu.regs.bc()), (0x2800, 1));
    cpu.step(&mut bus, &mut t);
    assert_eq!(
        (cpu.regs.pc, cpu.regs.bc(), cpu.regs.hl(), cpu.regs.de()),
        (0x2802, 0, 0x9003, 0xa003)
    );
    assert_eq!(bus.mem[0xa000..0xa003], [0x11, 0x22, 0x33]);
    assert_eq!(cpu.regs.f & flags::P, 0);
}

/// EI; HALT, the usual way to wait for the frame: the interrupt is held off after the EI and taken at the end
/// of the HALT, pushing the address after it.
#[test]
fn ei_then_halt_takes_the_interrupt_after_the_halt() {
    let mut cpu = cpu_at(0x8000, 1);
    (cpu.regs.iff1, cpu.regs.iff2, cpu.regs.sp) = (false, false, 0xc000);
    let mut bus = Rec::new(&[(0x8000, &[0xfb, 0x76, 0x00])]);
    let mut t = 0;
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(cpu.regs.halted);
    assert_eq!((t, cpu.regs.pc), (8, 0x8002));
    bus.events.clear();
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(
        bus.events,
        vec![
            (8, Ev::IntAck),
            (14, Ev::Internal(0x3f12, 1)),
            (15, Ev::Write(0xbfff, 0x80)),
            (18, Ev::Write(0xbffe, 0x02)),
        ]
    );
    assert_eq!((t, cpu.regs.pc, cpu.regs.halted), (21, 0x0038, false));
}

/// IM 2 and IM 0 from HALT push the address after the HALT too.
#[test]
fn im2_and_im0_from_halt_push_the_address_after_it() {
    let mut cpu = cpu_at(0x8000, 2);
    cpu.regs.i = 0x80;
    let mut bus = Rec::new(&[(0x8000, &[0x76]), (0x80ff, &[0x34, 0x12])]);
    let mut t = 0;
    for _ in 0..3 {
        cpu.step(&mut bus, &mut t);
    }
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!((bus.mem[0x7fff], bus.mem[0x7ffe]), (0x80, 0x01));
    assert_eq!((cpu.regs.pc, cpu.regs.memptr, t), (0x1234, 0x1234, 12 + 19));

    let mut cpu = cpu_at(0x8000, 0);
    let mut bus = Rec::new(&[(0x8000, &[0x76])]);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    cpu.step(&mut bus, &mut t);
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!((bus.mem[0x7fff], bus.mem[0x7ffe]), (0x80, 0x01));
    assert_eq!((cpu.regs.pc, t, cpu.regs.halted), (0x0038, 8 + 13, false));
}

/// LD A,R as well as LD A,I loses P/V to an interrupt taken right after it; an NMI does not clear it, as it
/// leaves IFF2 alone.
#[test]
fn ld_a_r_loses_pv_to_int_but_not_to_nmi() {
    let mut bus = Rec::new(&[(0, &[0xed, 0x5f]), (0x10, &[0xed, 0x57])]);
    let mut cpu = cpu_at(0, 1);
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    assert!(cpu.regs.ld_a_ir && cpu.regs.f & flags::P != 0);
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(cpu.regs.f & flags::P, 0);

    let mut cpu = cpu_at(0x10, 1);
    cpu.step(&mut bus, &mut t);
    assert!(cpu.nmi(&mut bus, &mut t));
    assert_ne!(cpu.regs.f & flags::P, 0);
    assert!(!cpu.regs.ld_a_ir);
}

/// An NMI taken with interrupts disabled returns, through RETN, with them still disabled; one taken with them
/// enabled refuses INT throughout its handler.
#[test]
fn retn_restores_the_interrupt_state_from_before_the_nmi() {
    let mut bus = Rec::new(&[(0x0066, &[0x00, 0xed, 0x45])]);
    let mut cpu = cpu_at(0x1000, 1);
    (cpu.regs.iff1, cpu.regs.iff2) = (false, false);
    let mut t = 0;
    assert!(cpu.nmi(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    cpu.step(&mut bus, &mut t);
    assert_eq!(cpu.regs.pc, 0x1000);
    assert!(!cpu.regs.iff1 && !cpu.regs.iff2 && !cpu.regs.int_blocked);
    cpu.step(&mut bus, &mut t);
    assert!(!cpu.interrupt(&mut bus, &mut t));

    let mut cpu = cpu_at(0x1000, 1);
    assert!(cpu.nmi(&mut bus, &mut t));
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(!cpu.interrupt(&mut bus, &mut t));
    cpu.step(&mut bus, &mut t);
    assert!(cpu.regs.iff1 && cpu.regs.int_blocked);
}

/// An interrupt response sets no flags, so it leaves Q clear: SCF as the handler's first instruction takes X
/// and Y from F | A. Without the interrupt, the same SCF after CP 28h takes them from A alone.
#[test]
fn an_interrupt_clears_q() {
    // CP 28h with A = 0: X and Y come from the operand, so F has them and A does not. Then SCF.
    let program: &[(u16, &[u8])] = &[(0x8000, &[0xfe, 0x28, 0x37]), (0x0038, &[0x37])];
    let mut bus = Rec::new(program);
    let mut cpu = cpu_at(0x8000, 1);
    cpu.regs.a = 0;
    let mut t = 0;
    cpu.step(&mut bus, &mut t);
    assert_eq!(cpu.regs.f & (flags::X | flags::Y), flags::X | flags::Y);
    assert_eq!(cpu.regs.q, cpu.regs.f);
    cpu.step(&mut bus, &mut t);
    assert_eq!(cpu.regs.f & (flags::X | flags::Y), 0);

    let mut bus = Rec::new(program);
    let mut cpu = cpu_at(0x8000, 1);
    cpu.regs.a = 0;
    cpu.step(&mut bus, &mut t);
    assert!(cpu.interrupt(&mut bus, &mut t));
    assert_eq!(cpu.regs.q, 0);
    cpu.step(&mut bus, &mut t);
    assert_eq!(cpu.regs.pc, 0x0039);
    assert_eq!(cpu.regs.f & (flags::X | flags::Y), flags::X | flags::Y);
}

/// `Regs` is the whole state: a CPU rebuilt from a copy of another's registers at any boundary (between a
/// prefix and its opcode, in HALT, after EI or LD A,I, after an interrupt response, with Q set before an SCF or
/// CCF) does exactly what the original does next: the same cycles at the same T-states, the same registers and
/// memory. Checked over random programs, run from random places with interrupts and NMIs offered at random.
#[test]
fn the_registers_are_the_whole_state() {
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut kinds = std::collections::HashSet::new();
    let mut bus = Rec::new(&[]);
    for b in bus.mem.iter_mut() {
        // Many prefixes, HALTs, EIs, LD A,I/R, SCFs and CCFs among random bytes.
        *b = match random() % 32 {
            0 | 1 => 0xdd,
            2 | 3 => 0xfd,
            4 => 0x76,
            5 | 6 => 0xfb,
            7 | 8 => 0xed,
            9 | 10 => 0x57,
            11 => 0x37,
            12 => 0x3f,
            _ => random() as u8,
        };
    }
    // The copy runs on a bus of its own, which stays the same as the original's while the two CPUs do the
    // same: every write is among the events compared.
    let mut copy_bus = bus.clone();
    let mut cpu = Cpu::new();
    let mut t = 0u32;
    for k in 0..200_000 {
        // Every so often, somewhere else, in another interrupt state, so that the program does not settle
        // into a loop or a HALT.
        if k % 32 == 0 && cpu.regs.prefix == 0 {
            let r = random();
            cpu.regs.pc = r as u16;
            cpu.regs.halted = false;
            (cpu.regs.iff1, cpu.regs.iff2) = (r & 1 << 16 != 0, r & 1 << 17 != 0);
            cpu.regs.im = (r >> 18) as u8 % 3;
        }
        if cpu.regs.prefix != 0 {
            kinds.insert("prefix");
        }
        if cpu.regs.halted {
            kinds.insert("halt");
        }
        if cpu.regs.int_blocked {
            kinds.insert("ei");
        }
        if cpu.regs.ld_a_ir {
            kinds.insert("ld a,i");
        }
        let op = bus.mem[cpu.regs.pc as usize];
        if cpu.regs.q != 0 && !cpu.regs.halted && matches!(op, 0x37 | 0x3f) {
            kinds.insert("q before scf/ccf");
        }
        let mut copy_t = t;
        let mut copy = Cpu::new();
        copy.regs = cpu.regs;
        match random() % 64 {
            0 => {
                let a = cpu.nmi(&mut bus, &mut t);
                let b = copy.nmi(&mut copy_bus, &mut copy_t);
                assert_eq!(a, b);
            }
            1..=8 => {
                let a = cpu.interrupt(&mut bus, &mut t);
                let b = copy.interrupt(&mut copy_bus, &mut copy_t);
                assert_eq!(a, b);
                if a {
                    kinds.insert("interrupt");
                }
            }
            _ => {}
        }
        // And again between an interrupt response and the step after it.
        assert_eq!(cpu.regs, copy.regs);
        let mut copy = Cpu::new();
        copy.regs = cpu.regs;
        cpu.step(&mut bus, &mut t);
        copy.step(&mut copy_bus, &mut copy_t);
        assert_eq!(cpu.regs, copy.regs);
        assert_eq!(t, copy_t);
        assert_eq!(bus.events, copy_bus.events);
        bus.events.clear();
        copy_bus.events.clear();
    }
    assert!(bus.mem == copy_bus.mem);
    assert_eq!(kinds.len(), 6, "{kinds:?}");
}
