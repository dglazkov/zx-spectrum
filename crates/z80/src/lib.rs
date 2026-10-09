//! The Zilog Z80 CPU (NMOS), exact to the machine cycle.
//!
//! Every opcode is here, documented or not: the unprefixed, CB, ED, DD, FD, DDCB and FDCB tables, SLL, the
//! IXH/IXL/IYH/IYL halves, the DDCB/FDCB forms that also copy their result into a register, the ED duplicates
//! of NEG, RETN and IM, the ED opcodes that do nothing, and DD/FD prefixes in front of opcodes they do not
//! modify. The flags are exact, the undocumented bits 3 and 5 (X and Y) included; MEMPTR (WZ) and Q are kept
//! as the chip keeps them; R counts 7 bits and keeps bit 7. Interrupts (IM 0, 1, 2 and NMI), HALT and the EI
//! delay behave as measured on real chips. `docs/z80.md` says where each behaviour comes from and how it is
//! tested.
//!
//! The CPU knows nothing of the machine around it. It drives a [`Bus`] one machine cycle at a time, saying
//! what each cycle is (an opcode fetch, a memory read or write, internal T-states with an address on the bus,
//! an I/O read or write, an interrupt acknowledge) and handing over the T-state counter; the bus advances the
//! counter past the cycle, adding whatever wait states the machine would (on a Spectrum, the ULA's
//! contention). The CPU never decides a delay.
//!
//! # Driving it
//!
//! The machine owns the T-state counter and calls the CPU at each instruction boundary:
//!
//! ```
//! # use z80::{Bus, Cpu};
//! # struct Machine { mem: [u8; 65536] }
//! # impl Bus for Machine {
//! #     fn fetch(&mut self, a: u16, _ir: u16, t: &mut u32) -> u8 { *t += 4; self.mem[a as usize] }
//! #     fn read(&mut self, a: u16, t: &mut u32) -> u8 { *t += 3; self.mem[a as usize] }
//! #     fn write(&mut self, a: u16, v: u8, t: &mut u32) { *t += 3; self.mem[a as usize] = v }
//! #     fn internal(&mut self, _a: u16, n: u32, t: &mut u32) { *t += n }
//! #     fn port_in(&mut self, _p: u16, t: &mut u32) -> u8 { *t += 4; 0xff }
//! #     fn port_out(&mut self, _p: u16, _v: u8, t: &mut u32) { *t += 4 }
//! #     fn int_ack(&mut self, t: &mut u32) -> u8 { *t += 6; 0xff }
//! # }
//! # let mut machine = Machine { mem: [0; 65536] };
//! # let frame_len = 69_888;
//! # let int_line_at = |t: u32| t < 32;
//! # let mut nmi_pending = false;
//! let mut cpu = Cpu::new();
//! let mut t = 0u32;
//! while t < frame_len {
//!     // An NMI is taken at any boundary but between a DD/FD prefix and its opcode.
//!     if nmi_pending && cpu.nmi(&mut machine, &mut t) {
//!         nmi_pending = false;
//!     // INT is a level: offer it at every boundary while the line is held.
//!     } else if int_line_at(t) {
//!         cpu.interrupt(&mut machine, &mut t);
//!     }
//!     cpu.step(&mut machine, &mut t);
//! }
//! ```
//!
//! - [`Cpu::step`] runs one instruction, or one cycle of HALT, or one DD/FD prefix (see below).
//! - [`Cpu::interrupt`] is the INT line held low at this boundary. It returns whether the CPU took the
//!   interrupt: it does not while IFF1 is clear, directly after EI (and after a RETI/RETN that set IFF1 from
//!   IFF2), or between a DD/FD prefix and its opcode. A level-triggered line is offered again at the next
//!   boundary, as the chip samples it again. The chip samples INT in the last T-state of each instruction;
//!   which T-state of the machine's count that falls on is the machine's convention. FUSE, whose Spectrum
//!   timings are measured against the hardware, asks whether INT is held at the boundary `t` itself (on the
//!   48K, an interrupt is taken if an instruction ends before T-state 32 of the frame).
//! - [`Cpu::nmi`] is a falling edge on NMI, taken at the next boundary that is not between a prefix and its
//!   opcode (directly after EI too: EI holds off INT only). After it returns true, `step` before offering
//!   another NMI: the Z80 does not accept a second NMI during its NMI response.
//!
//! A DD or FD prefix is a step of its own: it is one M1 cycle (4 T-states), and `regs.prefix` then says
//! which index register the next opcode will use. Nothing is accepted between a prefix and its opcode, so a
//! machine that loops as above gets the chip's behaviour. Stepping prefix by prefix keeps each `step`
//! bounded: memory full of DD bytes runs (and can be interrupted by nothing) as it would on the chip, but
//! never inside a single call.
//!
//! [`Cpu::regs`] is the whole state: copying it out and back in (a snapshot, a rewind point) loses nothing.

mod alu;
pub mod disasm;
mod exec;

/// The flag bits of F.
pub mod flags {
    /// Carry.
    pub const C: u8 = 0x01;
    /// Add/subtract: set by the last operation if it was a subtraction (DAA reads it).
    pub const N: u8 = 0x02;
    /// Parity (logical operations) or overflow (arithmetic).
    pub const P: u8 = 0x04;
    /// Undocumented: usually bit 3 of a result.
    pub const X: u8 = 0x08;
    /// Half carry, out of bit 3 (bit 11 for 16-bit arithmetic).
    pub const H: u8 = 0x10;
    /// Undocumented: usually bit 5 of a result.
    pub const Y: u8 = 0x20;
    /// Zero.
    pub const Z: u8 = 0x40;
    /// Sign.
    pub const S: u8 = 0x80;
}

/// What the CPU is connected to: memory, I/O and whoever answers an interrupt.
///
/// Each method is one machine cycle (or, for [`Bus::internal`], some T-states inside one) that begins at
/// `*t` and must leave `*t` past its end: its T-states plus any wait states the machine inserts. The CPU
/// calls them in the order the chip performs its cycles, with `*t` at the cycle's first T-state, so a bus
/// that knows its machine's timing (a Spectrum's ULA contention, which depends on the T-state and the
/// address) can apply it exactly. The counts below are what each cycle takes with no wait states.
pub trait Bus {
    /// An M1 cycle, 4 T-states: the opcode at `addr` is read in T1–T2 and the refresh address `ir` (I in the
    /// high byte, R in the low, as they were before this fetch's increment of R) is on the address bus in
    /// T3–T4. Also used for the opcode fetches the CPU discards (HALT's, and the NMI response's).
    fn fetch(&mut self, addr: u16, ir: u16, t: &mut u32) -> u8;

    /// A memory read cycle, 3 T-states.
    fn read(&mut self, addr: u16, t: &mut u32) -> u8;

    /// A memory write cycle, 3 T-states.
    fn write(&mut self, addr: u16, value: u8, t: &mut u32);

    /// `n` T-states in which the CPU works inside while `addr` stays on the address bus, with neither MREQ
    /// nor IORQ: the extra T-states of an M1 cycle (`addr` is then the refresh address the fetch put out),
    /// or of a read or write (`addr` is that cycle's address). A Spectrum's ULA contends each of these
    /// T-states on its own, as it does on the 48K, so `n` is the number of T-states to look at one by one.
    fn internal(&mut self, addr: u16, n: u32, t: &mut u32);

    /// An I/O read cycle, 4 T-states (one of them the automatic wait state), from the 16-bit `port`.
    fn port_in(&mut self, port: u16, t: &mut u32) -> u8;

    /// An I/O write cycle, 4 T-states (one of them the automatic wait state), to the 16-bit `port`.
    fn port_out(&mut self, port: u16, value: u8, t: &mut u32);

    /// The interrupt acknowledge cycle, 6 T-states: an M1 cycle with IORQ in place of MREQ and two automatic
    /// wait states, ending with a refresh. Returns the byte the interrupting device puts on the data bus
    /// (on a Spectrum nothing does, and it is 0xFF). The address bus holds PC; the CPU follows this cycle
    /// with one [`Bus::internal`] T-state at the refresh address.
    fn int_ack(&mut self, t: &mut u32) -> u8;
}

/// The CPU's whole state, as plain values: copying it out and back loses nothing.
///
/// The main set is kept as bytes (with pair accessors), the alternate set as the pairs EX AF,AF' and EXX
/// swap with.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Regs {
    pub a: u8,
    pub f: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,
    /// AF' (A' in the high byte).
    pub af_: u16,
    /// BC'.
    pub bc_: u16,
    /// DE'.
    pub de_: u16,
    /// HL'.
    pub hl_: u16,
    pub ix: u16,
    pub iy: u16,
    pub sp: u16,
    pub pc: u16,
    /// The interrupt vector register (and the high byte of the refresh address).
    pub i: u8,
    /// The refresh register: its low 7 bits count M1 cycles; bit 7 changes only when LD R,A writes it.
    pub r: u8,
    pub iff1: bool,
    pub iff2: bool,
    /// The interrupt mode, 0, 1 or 2.
    pub im: u8,
    /// MEMPTR (also called WZ): the internal register that address computations go through. It shows in the
    /// X and Y flags of BIT n,(HL), and is set as `docs/z80.md` lists.
    pub memptr: u16,
    /// Q: the flags as the last instruction left them if it was one that sets flags, otherwise 0. SCF and
    /// CCF take X and Y from `(Q ^ F) | A` (Patrik Rak's discovery); a DD/FD prefix clears it.
    pub q: u8,
    /// HALT has been executed: each `step` is one 4 T-state M1 cycle at PC (the address after the HALT)
    /// whose opcode is discarded, until an interrupt or NMI is taken.
    pub halted: bool,
    /// No maskable interrupt is accepted at this boundary: the last instruction was EI, or a RETI/RETN that
    /// copied a set IFF2 into a clear IFF1 (the chip copies it during the next opcode fetch, too late for
    /// INT to be seen at the end of the RETN).
    pub int_blocked: bool,
    /// A DD or FD prefix has been fetched, and the next opcode is the instruction it modifies; 0 if not.
    /// Neither INT nor NMI is accepted until that instruction has run.
    pub prefix: u8,
    /// The last instruction was LD A,I or LD A,R. An interrupt taken now clears P/V: on the NMOS Z80, the
    /// acknowledge clears IFF2 while the instruction is still copying it into P/V.
    pub ld_a_ir: bool,
}

impl Regs {
    pub fn af(&self) -> u16 {
        u16::from_be_bytes([self.a, self.f])
    }
    pub fn bc(&self) -> u16 {
        u16::from_be_bytes([self.b, self.c])
    }
    pub fn de(&self) -> u16 {
        u16::from_be_bytes([self.d, self.e])
    }
    pub fn hl(&self) -> u16 {
        u16::from_be_bytes([self.h, self.l])
    }
    pub fn set_af(&mut self, v: u16) {
        [self.a, self.f] = v.to_be_bytes();
    }
    pub fn set_bc(&mut self, v: u16) {
        [self.b, self.c] = v.to_be_bytes();
    }
    pub fn set_de(&mut self, v: u16) {
        [self.d, self.e] = v.to_be_bytes();
    }
    pub fn set_hl(&mut self, v: u16) {
        [self.h, self.l] = v.to_be_bytes();
    }
    /// I and R as the refresh cycle puts them on the address bus.
    pub fn ir(&self) -> u16 {
        u16::from_be_bytes([self.i, self.r])
    }
}

/// A Z80. All of its state is in [`Cpu::regs`].
#[derive(Clone, Debug, Default)]
pub struct Cpu {
    pub regs: Regs,
    /// The refresh address of the last M1 cycle, which stays on the address bus through the cycle's extra
    /// T-states. Only meaningful within one call: every step begins with a fetch that sets it.
    rfsh: u16,
    /// Q as the previous instruction left it, for SCF and CCF. Only meaningful within one step.
    q_prev: u8,
}

impl Cpu {
    /// A Z80 just after power-on: PC, I and R 0, interrupts disabled, IM 0, and every other register FFFF,
    /// as Goran Devic measured on a Zilog NMOS chip ("Z80 undocumented behavior", where F is sometimes FD
    /// instead) and as Sean Young recommends emulating ("The Undocumented Z80 Documented", section 2.4).
    /// Nothing is known of MEMPTR and Q at power-on; they start at 0.
    pub fn new() -> Cpu {
        let mut cpu = Cpu::default();
        let r = &mut cpu.regs;
        (r.af_, r.bc_, r.de_, r.hl_, r.ix, r.iy, r.sp) =
            (0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff);
        r.set_af(0xffff);
        r.set_bc(0xffff);
        r.set_de(0xffff);
        r.set_hl(0xffff);
        cpu.reset();
        cpu
    }

    /// The RESET line: PC, I and R to 0, both interrupt flip-flops clear, IM 0 (Zilog's Z80 CPU User Manual,
    /// the RESET pin), and out of HALT. Every other register keeps its value, as Goran Devic measured
    /// ("Z80 undocumented behavior"); Q is cleared, as nothing is known of it.
    pub fn reset(&mut self) {
        let r = &mut self.regs;
        r.pc = 0;
        r.i = 0;
        r.r = 0;
        r.iff1 = false;
        r.iff2 = false;
        r.im = 0;
        r.halted = false;
        r.int_blocked = false;
        r.prefix = 0;
        r.ld_a_ir = false;
        r.q = 0;
    }

    /// Runs one instruction, or one 4 T-state cycle of HALT, or one DD/FD prefix, advancing `t` through the
    /// bus by every cycle it takes.
    #[inline]
    pub fn step(&mut self, bus: &mut impl Bus, t: &mut u32) {
        self.q_prev = self.regs.q;
        self.regs.q = 0;
        self.regs.int_blocked = false;
        self.regs.ld_a_ir = false;
        if self.regs.halted {
            // The chip keeps fetching (and discarding) the opcode after the HALT, without moving PC.
            let ir = self.regs.ir();
            bus.fetch(self.regs.pc, ir, t);
            self.inc_r();
            return;
        }
        let prefix = self.regs.prefix;
        let op = self.fetch_opcode(bus, t);
        match prefix {
            0 => self.exec::<0>(op, bus, t),
            0xdd => {
                self.regs.prefix = 0;
                self.exec::<1>(op, bus, t)
            }
            _ => {
                self.regs.prefix = 0;
                self.exec::<2>(op, bus, t)
            }
        }
    }

    /// Whether [`Cpu::interrupt`] would take an interrupt at this boundary.
    pub fn accepts_interrupt(&self) -> bool {
        self.regs.iff1 && !self.regs.int_blocked && self.regs.prefix == 0
    }

    /// The INT line is held at this boundary: takes the interrupt if the CPU will (see the crate's
    /// documentation), and returns whether it did. Taking it runs the whole response: the acknowledge cycle,
    /// then in IM 1 a call to 0038h (13 T-states); in IM 2 a call through the word at (I × 256 + the byte on
    /// the data bus) (19 T-states); in IM 0 the execution of the byte on the data bus as an opcode, which on a
    /// Spectrum is FFh, RST 38h (13 T-states).
    pub fn interrupt(&mut self, bus: &mut impl Bus, t: &mut u32) -> bool {
        if !self.accepts_interrupt() {
            return false;
        }
        if self.regs.ld_a_ir {
            self.regs.f &= !flags::P;
        }
        self.regs.ld_a_ir = false;
        self.regs.halted = false;
        self.regs.iff1 = false;
        self.regs.iff2 = false;
        self.q_prev = self.regs.q;
        self.regs.q = 0;
        self.rfsh = self.regs.ir();
        self.inc_r();
        let byte = bus.int_ack(t);
        match self.regs.im {
            0 => {
                // The byte is executed as if fetched, but PC was not advanced past it: an RST pushes the
                // address of the interrupted instruction, as it must.
                self.exec::<0>(byte, bus, t);
            }
            1 => {
                bus.internal(self.rfsh, 1, t);
                self.push(bus, t, self.regs.pc);
                self.regs.pc = 0x0038;
                self.regs.memptr = 0x0038;
            }
            _ => {
                bus.internal(self.rfsh, 1, t);
                self.push(bus, t, self.regs.pc);
                let vector = u16::from_be_bytes([self.regs.i, byte]);
                let lo = bus.read(vector, t);
                let hi = bus.read(vector.wrapping_add(1), t);
                self.regs.pc = u16::from_le_bytes([lo, hi]);
                self.regs.memptr = self.regs.pc;
            }
        }
        true
    }

    /// An NMI edge: takes it at this boundary unless a DD/FD prefix is waiting for its opcode, and returns
    /// whether it did. The response is an opcode fetch whose byte is discarded, one more T-state, and a call
    /// to 0066h: 11 T-states. IFF1 is cleared and IFF2 keeps the old IFF1, for RETN to restore.
    pub fn nmi(&mut self, bus: &mut impl Bus, t: &mut u32) -> bool {
        if self.regs.prefix != 0 {
            return false;
        }
        self.regs.halted = false;
        self.regs.iff1 = false;
        self.regs.int_blocked = false;
        self.regs.ld_a_ir = false;
        self.regs.q = 0;
        let ir = self.regs.ir();
        self.rfsh = ir;
        bus.fetch(self.regs.pc, ir, t);
        self.inc_r();
        bus.internal(ir, 1, t);
        self.push(bus, t, self.regs.pc);
        self.regs.pc = 0x0066;
        self.regs.memptr = 0x0066;
        true
    }

    /// Counts one M1 cycle in R: its low 7 bits, keeping bit 7.
    #[inline(always)]
    fn inc_r(&mut self) {
        let r = self.regs.r;
        self.regs.r = (r & 0x80) | (r.wrapping_add(1) & 0x7f);
    }

    /// An opcode fetch at PC: PC moves past it and R counts it.
    #[inline(always)]
    fn fetch_opcode(&mut self, bus: &mut impl Bus, t: &mut u32) -> u8 {
        let ir = self.regs.ir();
        self.rfsh = ir;
        let op = bus.fetch(self.regs.pc, ir, t);
        self.regs.pc = self.regs.pc.wrapping_add(1);
        self.inc_r();
        op
    }

    /// Pushes a word, high byte first, as CALL, RST, PUSH and the interrupt responses do.
    #[inline(always)]
    fn push(&mut self, bus: &mut impl Bus, t: &mut u32, v: u16) {
        let [hi, lo] = v.to_be_bytes();
        self.regs.sp = self.regs.sp.wrapping_sub(1);
        bus.write(self.regs.sp, hi, t);
        self.regs.sp = self.regs.sp.wrapping_sub(1);
        bus.write(self.regs.sp, lo, t);
    }

    /// Pops a word, low byte first.
    #[inline(always)]
    fn pop(&mut self, bus: &mut impl Bus, t: &mut u32) -> u16 {
        let lo = bus.read(self.regs.sp, t);
        self.regs.sp = self.regs.sp.wrapping_add(1);
        let hi = bus.read(self.regs.sp, t);
        self.regs.sp = self.regs.sp.wrapping_add(1);
        u16::from_le_bytes([lo, hi])
    }
}
