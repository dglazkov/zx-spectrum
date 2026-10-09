//! The instructions, opcode by opcode, cycle by cycle.
//!
//! One decoder serves the unprefixed table and the DD and FD tables: `exec::<IDX>` is compiled three times,
//! with `IDX` 0 for HL, 1 for IX and 2 for IY. Under a prefix, H and L become the halves of the index register,
//! HL becomes the index register, and (HL) becomes (IX+d) with its displacement read and 5 T-states added;
//! where an instruction has both (HL) and H or L (LD H,(IX+d), LD (IX+d),L), the register is the real one.
//! Opcodes that do not involve HL (and EX DE,HL and EXX, which ignore the prefix) run as they would without
//! it, the prefix having cost its 4 T-states.
//!
//! Each bus call below is one machine cycle of the chip, in its order; the comments give the T-states. The
//! timings, and the addresses left on the bus during internal T-states, follow the FUSE emulator's core
//! (which the Spectrum's contention was measured against) and the SingleStepTests' cycle-by-cycle bus.

use crate::alu::{self, SZXY, SZXYP};
use crate::flags::{C, H, N, P, S, X, Y, Z};
use crate::{Bus, Cpu};

impl Cpu {
    /// Sets F, and Q with it: every instruction that computes flags leaves them in Q too.
    #[inline(always)]
    fn setf(&mut self, f: u8) {
        self.regs.f = f;
        self.regs.q = f;
    }

    /// HL, IX or IY.
    #[inline(always)]
    fn hlx<const IDX: u8>(&self) -> u16 {
        match IDX {
            0 => self.regs.hl(),
            1 => self.regs.ix,
            _ => self.regs.iy,
        }
    }

    #[inline(always)]
    fn set_hlx<const IDX: u8>(&mut self, v: u16) {
        match IDX {
            0 => self.regs.set_hl(v),
            1 => self.regs.ix = v,
            _ => self.regs.iy = v,
        }
    }

    /// A register by its 3-bit code (B C D E H L - A; 6, the memory operand, is not one): under a prefix,
    /// H and L are the index register's halves.
    #[inline(always)]
    fn reg<const IDX: u8>(&self, code: u8) -> u8 {
        match code & 7 {
            0 => self.regs.b,
            1 => self.regs.c,
            2 => self.regs.d,
            3 => self.regs.e,
            4 => (self.hlx::<IDX>() >> 8) as u8,
            5 => self.hlx::<IDX>() as u8,
            _ => self.regs.a,
        }
    }

    #[inline(always)]
    fn set_reg<const IDX: u8>(&mut self, code: u8, v: u8) {
        match code & 7 {
            0 => self.regs.b = v,
            1 => self.regs.c = v,
            2 => self.regs.d = v,
            3 => self.regs.e = v,
            4 => {
                let w = self.hlx::<IDX>();
                self.set_hlx::<IDX>((w & 0x00ff) | ((v as u16) << 8));
            }
            5 => {
                let w = self.hlx::<IDX>();
                self.set_hlx::<IDX>((w & 0xff00) | v as u16);
            }
            _ => self.regs.a = v,
        }
    }

    /// A register pair by its 2-bit code: BC, DE, HL (or IX/IY), SP.
    #[inline(always)]
    fn rp<const IDX: u8>(&self, code: u8) -> u16 {
        match code & 3 {
            0 => self.regs.bc(),
            1 => self.regs.de(),
            2 => self.hlx::<IDX>(),
            _ => self.regs.sp,
        }
    }

    #[inline(always)]
    fn set_rp<const IDX: u8>(&mut self, code: u8, v: u16) {
        match code & 3 {
            0 => self.regs.set_bc(v),
            1 => self.regs.set_de(v),
            2 => self.set_hlx::<IDX>(v),
            _ => self.regs.sp = v,
        }
    }

    /// The condition of a conditional jump, call or return by its 3-bit code: NZ Z NC C PO PE P M.
    #[inline(always)]
    fn cond(&self, code: u8) -> bool {
        let f = self.regs.f;
        match code & 7 {
            0 => f & Z == 0,
            1 => f & Z != 0,
            2 => f & C == 0,
            3 => f & C != 0,
            4 => f & P == 0,
            5 => f & P != 0,
            6 => f & S == 0,
            _ => f & S != 0,
        }
    }

    /// The byte at PC (a memory read, 3 T-states); PC moves past it.
    #[inline(always)]
    fn imm8(&mut self, bus: &mut impl Bus, t: &mut u32) -> u8 {
        let v = bus.read(self.regs.pc, t);
        self.regs.pc = self.regs.pc.wrapping_add(1);
        v
    }

    /// The word at PC, low byte first (two reads, 6 T-states).
    #[inline(always)]
    fn imm16(&mut self, bus: &mut impl Bus, t: &mut u32) -> u16 {
        let lo = self.imm8(bus, t);
        let hi = self.imm8(bus, t);
        u16::from_le_bytes([lo, hi])
    }

    /// The address of the memory operand: HL, or under a prefix IX/IY plus the displacement at PC, which
    /// costs a read and 5 internal T-states at the displacement's address (and sets MEMPTR).
    #[inline(always)]
    fn mem_operand<const IDX: u8>(&mut self, bus: &mut impl Bus, t: &mut u32) -> u16 {
        if IDX == 0 {
            self.regs.hl()
        } else {
            let pc = self.regs.pc;
            let d = bus.read(pc, t) as i8;
            bus.internal(pc, 5, t);
            self.regs.pc = pc.wrapping_add(1);
            let addr = self.hlx::<IDX>().wrapping_add(d as u16);
            self.regs.memptr = addr;
            addr
        }
    }

    /// A relative jump's displacement has been read from `at`: 5 internal T-states there, then the jump.
    #[inline(always)]
    fn jr(&mut self, bus: &mut impl Bus, t: &mut u32, at: u16, d: u8) {
        bus.internal(at, 5, t);
        self.regs.pc = self.regs.pc.wrapping_add(d as i8 as u16);
        self.regs.memptr = self.regs.pc;
    }

    /// RETI and RETN (and their ED duplicates): pop PC and copy IFF2 into IFF1. The chip copies it during
    /// the next opcode fetch, so if that enables interrupts, INT is first seen an instruction later.
    fn retn(&mut self, bus: &mut impl Bus, t: &mut u32) {
        let pc = self.pop(bus, t);
        self.regs.pc = pc;
        self.regs.memptr = pc;
        if self.regs.iff2 && !self.regs.iff1 {
            self.regs.int_blocked = true;
        }
        self.regs.iff1 = self.regs.iff2;
    }

    /// One unprefixed opcode (`IDX` = 0), or one DD/FD-prefixed opcode (`IDX` = 1 or 2), its M1 cycle done.
    #[inline(always)]
    pub(crate) fn exec<const IDX: u8>(&mut self, op: u8, bus: &mut impl Bus, t: &mut u32) {
        match op {
            // NOP
            0x00 => {}
            // LD rr,nn: 4,3,3
            0x01 | 0x11 | 0x21 | 0x31 => {
                let v = self.imm16(bus, t);
                self.set_rp::<IDX>(op >> 4, v);
            }
            // LD (BC),A / LD (DE),A: 4,3. MEMPTR: A in the high byte, the address + 1 in the low.
            0x02 | 0x12 => {
                let addr = if op == 0x02 {
                    self.regs.bc()
                } else {
                    self.regs.de()
                };
                bus.write(addr, self.regs.a, t);
                self.regs.memptr = u16::from_be_bytes([self.regs.a, addr.wrapping_add(1) as u8]);
            }
            // INC rr / DEC rr: 6 (2 internal at IR)
            0x03 | 0x13 | 0x23 | 0x33 => {
                bus.internal(self.rfsh, 2, t);
                let v = self.rp::<IDX>(op >> 4).wrapping_add(1);
                self.set_rp::<IDX>(op >> 4, v);
            }
            0x0b | 0x1b | 0x2b | 0x3b => {
                bus.internal(self.rfsh, 2, t);
                let v = self.rp::<IDX>(op >> 4).wrapping_sub(1);
                self.set_rp::<IDX>(op >> 4, v);
            }
            // INC r / DEC r
            0x04 | 0x0c | 0x14 | 0x1c | 0x24 | 0x2c | 0x3c => {
                let code = op >> 3;
                let (r, f) = alu::inc8(self.reg::<IDX>(code), self.regs.f);
                self.set_reg::<IDX>(code, r);
                self.setf(f);
            }
            0x05 | 0x0d | 0x15 | 0x1d | 0x25 | 0x2d | 0x3d => {
                let code = op >> 3;
                let (r, f) = alu::dec8(self.reg::<IDX>(code), self.regs.f);
                self.set_reg::<IDX>(code, r);
                self.setf(f);
            }
            // INC (HL) / DEC (HL): 4,3,1,3 (+8 for (IX+d))
            0x34 | 0x35 => {
                let addr = self.mem_operand::<IDX>(bus, t);
                let v = bus.read(addr, t);
                bus.internal(addr, 1, t);
                let (r, f) = if op == 0x34 {
                    alu::inc8(v, self.regs.f)
                } else {
                    alu::dec8(v, self.regs.f)
                };
                self.setf(f);
                bus.write(addr, r, t);
            }
            // LD r,n: 4,3
            0x06 | 0x0e | 0x16 | 0x1e | 0x26 | 0x2e | 0x3e => {
                let v = self.imm8(bus, t);
                self.set_reg::<IDX>(op >> 3, v);
            }
            // LD (HL),n: 4,3,3. LD (IX+d),n: 4,4,3,5,3 — the displacement and the byte are read first, and
            // the 2 internal T-states sit at the byte's address.
            0x36 => {
                if IDX == 0 {
                    let v = self.imm8(bus, t);
                    bus.write(self.regs.hl(), v, t);
                } else {
                    let d = self.imm8(bus, t) as i8;
                    let pc = self.regs.pc;
                    let v = bus.read(pc, t);
                    bus.internal(pc, 2, t);
                    self.regs.pc = pc.wrapping_add(1);
                    let addr = self.hlx::<IDX>().wrapping_add(d as u16);
                    self.regs.memptr = addr;
                    bus.write(addr, v, t);
                }
            }
            // RLCA, RRCA, RLA, RRA: S, Z and P/V kept; X and Y from the new A.
            0x07 => {
                let a = self.regs.a.rotate_left(1);
                self.regs.a = a;
                self.setf((self.regs.f & (S | Z | P)) | (a & (X | Y | C)));
            }
            0x0f => {
                let old = self.regs.a;
                let a = old.rotate_right(1);
                self.regs.a = a;
                self.setf((self.regs.f & (S | Z | P)) | (a & (X | Y)) | (old & C));
            }
            0x17 => {
                let old = self.regs.a;
                let a = (old << 1) | (self.regs.f & C);
                self.regs.a = a;
                self.setf((self.regs.f & (S | Z | P)) | (a & (X | Y)) | (old >> 7));
            }
            0x1f => {
                let old = self.regs.a;
                let a = (old >> 1) | (self.regs.f << 7);
                self.regs.a = a;
                self.setf((self.regs.f & (S | Z | P)) | (a & (X | Y)) | (old & C));
            }
            // EX AF,AF' (not a flag operation: Q is left 0)
            0x08 => {
                let af = self.regs.af();
                self.regs.set_af(self.regs.af_);
                self.regs.af_ = af;
            }
            // ADD HL,rr: 4,4,3 (7 internal at IR). MEMPTR = HL + 1.
            0x09 | 0x19 | 0x29 | 0x39 => {
                bus.internal(self.rfsh, 7, t);
                let a = self.hlx::<IDX>();
                let (r, f) = alu::add16(a, self.rp::<IDX>(op >> 4), self.regs.f);
                self.regs.memptr = a.wrapping_add(1);
                self.set_hlx::<IDX>(r);
                self.setf(f);
            }
            // LD A,(BC) / LD A,(DE): 4,3. MEMPTR = address + 1.
            0x0a | 0x1a => {
                let addr = if op == 0x0a {
                    self.regs.bc()
                } else {
                    self.regs.de()
                };
                self.regs.a = bus.read(addr, t);
                self.regs.memptr = addr.wrapping_add(1);
            }
            // DJNZ e: 5,3 (+5 when it jumps)
            0x10 => {
                bus.internal(self.rfsh, 1, t);
                let at = self.regs.pc;
                let d = self.imm8(bus, t);
                self.regs.b = self.regs.b.wrapping_sub(1);
                if self.regs.b != 0 {
                    self.jr(bus, t, at, d);
                }
            }
            // JR e: 4,3,5
            0x18 => {
                let at = self.regs.pc;
                let d = self.imm8(bus, t);
                self.jr(bus, t, at, d);
            }
            // JR cc,e: 4,3 (+5 when it jumps)
            0x20 | 0x28 | 0x30 | 0x38 => {
                let at = self.regs.pc;
                let d = self.imm8(bus, t);
                if self.cond((op >> 3) & 3) {
                    self.jr(bus, t, at, d);
                }
            }
            // LD (nn),HL: 4,3,3,3,3. MEMPTR = nn + 1.
            0x22 => {
                let addr = self.imm16(bus, t);
                let [hi, lo] = self.hlx::<IDX>().to_be_bytes();
                bus.write(addr, lo, t);
                let addr1 = addr.wrapping_add(1);
                bus.write(addr1, hi, t);
                self.regs.memptr = addr1;
            }
            // LD HL,(nn): 4,3,3,3,3. MEMPTR = nn + 1.
            0x2a => {
                let addr = self.imm16(bus, t);
                let lo = bus.read(addr, t);
                let addr1 = addr.wrapping_add(1);
                let hi = bus.read(addr1, t);
                self.set_hlx::<IDX>(u16::from_le_bytes([lo, hi]));
                self.regs.memptr = addr1;
            }
            // LD (nn),A: 4,3,3,3. MEMPTR: A in the high byte, nn + 1 in the low.
            0x32 => {
                let addr = self.imm16(bus, t);
                bus.write(addr, self.regs.a, t);
                self.regs.memptr = u16::from_be_bytes([self.regs.a, addr.wrapping_add(1) as u8]);
            }
            // LD A,(nn): 4,3,3,3. MEMPTR = nn + 1.
            0x3a => {
                let addr = self.imm16(bus, t);
                self.regs.a = bus.read(addr, t);
                self.regs.memptr = addr.wrapping_add(1);
            }
            // DAA
            0x27 => {
                let (a, f) = alu::daa(self.regs.a, self.regs.f);
                self.regs.a = a;
                self.setf(f);
            }
            // CPL
            0x2f => {
                let a = !self.regs.a;
                self.regs.a = a;
                self.setf((self.regs.f & (S | Z | P | C)) | H | N | (a & (X | Y)));
            }
            // SCF and CCF: X and Y from (Q ^ F) | A, Q being what the previous instruction left (Patrik Rak).
            0x37 => {
                let f = self.regs.f;
                let xy = ((self.q_prev ^ f) | self.regs.a) & (X | Y);
                self.setf((f & (S | Z | P)) | xy | C);
            }
            0x3f => {
                let f = self.regs.f;
                let xy = ((self.q_prev ^ f) | self.regs.a) & (X | Y);
                let hc = if f & C != 0 { H } else { C };
                self.setf((f & (S | Z | P)) | xy | hc);
            }
            // HALT: PC stays past it; each later step is an M1 cycle there until an interrupt.
            0x76 => {
                self.regs.halted = true;
            }
            // LD r,r' / LD r,(HL) / LD (HL),r
            0x40..=0x7f => {
                let dst = (op >> 3) & 7;
                let src = op & 7;
                if src == 6 {
                    let addr = self.mem_operand::<IDX>(bus, t);
                    let v = bus.read(addr, t);
                    self.set_reg::<0>(dst, v);
                } else if dst == 6 {
                    let addr = self.mem_operand::<IDX>(bus, t);
                    bus.write(addr, self.reg::<0>(src), t);
                } else {
                    let v = self.reg::<IDX>(src);
                    self.set_reg::<IDX>(dst, v);
                }
            }
            // ADD/ADC/SUB/SBC/AND/XOR/OR/CP A,r / A,(HL)
            0x80..=0xbf => {
                let src = op & 7;
                let v = if src == 6 {
                    let addr = self.mem_operand::<IDX>(bus, t);
                    bus.read(addr, t)
                } else {
                    self.reg::<IDX>(src)
                };
                let (a, f) = alu::alu(op >> 3, self.regs.a, v, self.regs.f);
                self.regs.a = a;
                self.setf(f);
            }
            // RET cc: 5 (+3,3 when it returns)
            0xc0 | 0xc8 | 0xd0 | 0xd8 | 0xe0 | 0xe8 | 0xf0 | 0xf8 => {
                bus.internal(self.rfsh, 1, t);
                if self.cond(op >> 3) {
                    let pc = self.pop(bus, t);
                    self.regs.pc = pc;
                    self.regs.memptr = pc;
                }
            }
            // POP rr: 4,3,3 (POP AF is not a flag operation: Q is left 0)
            0xc1 | 0xd1 | 0xe1 => {
                let v = self.pop(bus, t);
                self.set_rp::<IDX>(op >> 4, v);
            }
            0xf1 => {
                let v = self.pop(bus, t);
                self.regs.set_af(v);
            }
            // JP cc,nn / JP nn: 4,3,3. MEMPTR = nn whether or not it jumps.
            0xc2 | 0xca | 0xd2 | 0xda | 0xe2 | 0xea | 0xf2 | 0xfa => {
                let addr = self.imm16(bus, t);
                self.regs.memptr = addr;
                if self.cond(op >> 3) {
                    self.regs.pc = addr;
                }
            }
            0xc3 => {
                let addr = self.imm16(bus, t);
                self.regs.memptr = addr;
                self.regs.pc = addr;
            }
            // CALL cc,nn: 4,3,3 (+1,3,3 when it calls, the extra T-state at nn's high byte). CALL nn: 4,3,4,3,3.
            0xc4 | 0xcc | 0xd4 | 0xdc | 0xe4 | 0xec | 0xf4 | 0xfc | 0xcd => {
                let lo = self.imm8(bus, t);
                let at = self.regs.pc;
                let hi = self.imm8(bus, t);
                let addr = u16::from_le_bytes([lo, hi]);
                self.regs.memptr = addr;
                if op == 0xcd || self.cond(op >> 3) {
                    bus.internal(at, 1, t);
                    self.push(bus, t, self.regs.pc);
                    self.regs.pc = addr;
                }
            }
            // PUSH rr: 5,3,3
            0xc5 | 0xd5 | 0xe5 | 0xf5 => {
                bus.internal(self.rfsh, 1, t);
                let v = if op == 0xf5 {
                    self.regs.af()
                } else {
                    self.rp::<IDX>(op >> 4)
                };
                self.push(bus, t, v);
            }
            // ALU A,n: 4,3
            0xc6 | 0xce | 0xd6 | 0xde | 0xe6 | 0xee | 0xf6 | 0xfe => {
                let v = self.imm8(bus, t);
                let (a, f) = alu::alu(op >> 3, self.regs.a, v, self.regs.f);
                self.regs.a = a;
                self.setf(f);
            }
            // RST p: 5,3,3
            0xc7 | 0xcf | 0xd7 | 0xdf | 0xe7 | 0xef | 0xf7 | 0xff => {
                bus.internal(self.rfsh, 1, t);
                self.push(bus, t, self.regs.pc);
                let addr = (op & 0x38) as u16;
                self.regs.pc = addr;
                self.regs.memptr = addr;
            }
            // RET: 4,3,3
            0xc9 => {
                let pc = self.pop(bus, t);
                self.regs.pc = pc;
                self.regs.memptr = pc;
            }
            // CB: the bit instructions, or DDCB/FDCB under a prefix.
            0xcb => {
                if IDX == 0 {
                    self.exec_cb(bus, t);
                } else {
                    self.exec_xycb::<IDX>(bus, t);
                }
            }
            // OUT (n),A: 4,3,4. The port is A:n; MEMPTR is A:(n + 1), the low byte wrapping alone.
            0xd3 => {
                let n = self.imm8(bus, t);
                let a = self.regs.a;
                bus.port_out(u16::from_be_bytes([a, n]), a, t);
                self.regs.memptr = u16::from_be_bytes([a, n.wrapping_add(1)]);
            }
            // IN A,(n): 4,3,4. The port is A:n; MEMPTR is the port + 1. Flags are not touched.
            0xdb => {
                let n = self.imm8(bus, t);
                let port = u16::from_be_bytes([self.regs.a, n]);
                self.regs.a = bus.port_in(port, t);
                self.regs.memptr = port.wrapping_add(1);
            }
            // EXX
            0xd9 => {
                let r = &mut self.regs;
                let (bc, de, hl) = (r.bc(), r.de(), r.hl());
                r.set_bc(r.bc_);
                r.set_de(r.de_);
                r.set_hl(r.hl_);
                r.bc_ = bc;
                r.de_ = de;
                r.hl_ = hl;
            }
            // DD, FD: a prefix for the next opcode (the last of a run of prefixes is the one that counts).
            // Fetching one clears Q (Tony Brewer).
            0xdd | 0xfd => {
                self.regs.prefix = op;
            }
            // EX (SP),HL: 4,3,4,3,5 — reads (SP) and (SP+1), 1 internal at SP+1, writes them high byte
            // first, 2 internal at SP. MEMPTR = the new HL.
            0xe3 => {
                let sp = self.regs.sp;
                let sp1 = sp.wrapping_add(1);
                let lo = bus.read(sp, t);
                let hi = bus.read(sp1, t);
                bus.internal(sp1, 1, t);
                let [oh, ol] = self.hlx::<IDX>().to_be_bytes();
                bus.write(sp1, oh, t);
                bus.write(sp, ol, t);
                bus.internal(sp, 2, t);
                let v = u16::from_le_bytes([lo, hi]);
                self.set_hlx::<IDX>(v);
                self.regs.memptr = v;
            }
            // JP (HL): 4. MEMPTR is not touched.
            0xe9 => {
                self.regs.pc = self.hlx::<IDX>();
            }
            // EX DE,HL: always HL, whatever the prefix.
            0xeb => {
                let r = &mut self.regs;
                let de = r.de();
                r.set_de(r.hl());
                r.set_hl(de);
            }
            // ED: the extended instructions; a DD/FD prefix before it is lost.
            0xed => self.exec_ed(bus, t),
            // DI / EI. EI holds off INT until after the next instruction.
            0xf3 => {
                self.regs.iff1 = false;
                self.regs.iff2 = false;
            }
            0xfb => {
                self.regs.iff1 = true;
                self.regs.iff2 = true;
                self.regs.int_blocked = true;
            }
            // LD SP,HL: 6 (2 internal at IR)
            0xf9 => {
                bus.internal(self.rfsh, 2, t);
                self.regs.sp = self.hlx::<IDX>();
            }
        }
    }

    /// A CB-prefixed opcode (the CB's M1 done): the rotates and shifts, BIT, RES and SET. On a register,
    /// 4,4; on (HL), 4,4,3,1 for BIT and 4,4,3,1,3 for the others.
    fn exec_cb(&mut self, bus: &mut impl Bus, t: &mut u32) {
        let op = self.fetch_opcode(bus, t);
        let code = op & 7;
        let n = (op >> 3) & 7;
        if code == 6 {
            let addr = self.regs.hl();
            let v = bus.read(addr, t);
            bus.internal(addr, 1, t);
            match op >> 6 {
                0 => {
                    let (r, f) = alu::rot(n, v, self.regs.f);
                    self.setf(f);
                    bus.write(addr, r, t);
                }
                // BIT n,(HL): X and Y come from MEMPTR's high byte.
                1 => {
                    let f = alu::bit(n, v, (self.regs.memptr >> 8) as u8, self.regs.f);
                    self.setf(f);
                }
                2 => bus.write(addr, v & !(1 << n), t),
                _ => bus.write(addr, v | (1 << n), t),
            }
        } else {
            let v = self.reg::<0>(code);
            match op >> 6 {
                0 => {
                    let (r, f) = alu::rot(n, v, self.regs.f);
                    self.set_reg::<0>(code, r);
                    self.setf(f);
                }
                1 => {
                    let f = alu::bit(n, v, v, self.regs.f);
                    self.setf(f);
                }
                2 => self.set_reg::<0>(code, v & !(1 << n)),
                _ => self.set_reg::<0>(code, v | (1 << n)),
            }
        }
    }

    /// A DDCB/FDCB instruction, the prefix's and the CB's M1 cycles done: the displacement and the opcode
    /// are read as data (3 T-states each, then 2 internal at the opcode's address), then the operand at
    /// IX+d is read (3, then 1 internal) and, for all but BIT, written back (3). The undocumented forms (the
    /// low 3 bits other than 6) also copy the result into a register: B, C, D, E, H, L or A, the real H and
    /// L, not the index register's halves.
    fn exec_xycb<const IDX: u8>(&mut self, bus: &mut impl Bus, t: &mut u32) {
        let d = self.imm8(bus, t) as i8;
        let at = self.regs.pc;
        let op = bus.read(at, t);
        bus.internal(at, 2, t);
        self.regs.pc = at.wrapping_add(1);
        let addr = self.hlx::<IDX>().wrapping_add(d as u16);
        self.regs.memptr = addr;
        let v = bus.read(addr, t);
        bus.internal(addr, 1, t);
        let n = (op >> 3) & 7;
        let r = match op >> 6 {
            0 => {
                let (r, f) = alu::rot(n, v, self.regs.f);
                self.setf(f);
                r
            }
            // BIT n,(IX+d): X and Y come from the high byte of IX+d.
            1 => {
                let f = alu::bit(n, v, (addr >> 8) as u8, self.regs.f);
                self.setf(f);
                return;
            }
            2 => v & !(1 << n),
            _ => v | (1 << n),
        };
        if op & 7 != 6 {
            self.set_reg::<0>(op, r);
        }
        bus.write(addr, r, t);
    }

    /// An ED-prefixed opcode (the ED's M1 done). Opcodes with no instruction are 8 T-state no-ops.
    fn exec_ed(&mut self, bus: &mut impl Bus, t: &mut u32) {
        let op = self.fetch_opcode(bus, t);
        match op {
            // IN r,(C): 4,4,4. IN F,(C) (ED 70, undocumented) sets the flags and discards the byte.
            // MEMPTR = BC + 1.
            0x40 | 0x48 | 0x50 | 0x58 | 0x60 | 0x68 | 0x70 | 0x78 => {
                let bc = self.regs.bc();
                let v = bus.port_in(bc, t);
                self.regs.memptr = bc.wrapping_add(1);
                if op != 0x70 {
                    self.set_reg::<0>(op >> 3, v);
                }
                self.setf((self.regs.f & C) | SZXYP[v as usize]);
            }
            // OUT (C),r: 4,4,4. OUT (C),0 (ED 71, undocumented) writes 0 on the NMOS Z80. MEMPTR = BC + 1.
            0x41 | 0x49 | 0x51 | 0x59 | 0x61 | 0x69 | 0x71 | 0x79 => {
                let bc = self.regs.bc();
                let v = if op == 0x71 {
                    0
                } else {
                    self.reg::<0>(op >> 3)
                };
                bus.port_out(bc, v, t);
                self.regs.memptr = bc.wrapping_add(1);
            }
            // SBC HL,rr / ADC HL,rr: 4,4,4,3 (7 internal at IR). MEMPTR = HL + 1.
            0x42 | 0x52 | 0x62 | 0x72 | 0x4a | 0x5a | 0x6a | 0x7a => {
                bus.internal(self.rfsh, 7, t);
                let hl = self.regs.hl();
                let v = self.rp::<0>(op >> 4);
                let carry = self.regs.f & C;
                let (r, f) = if op & 8 == 0 {
                    alu::sbc16(hl, v, carry)
                } else {
                    alu::adc16(hl, v, carry)
                };
                self.regs.memptr = hl.wrapping_add(1);
                self.regs.set_hl(r);
                self.setf(f);
            }
            // LD (nn),rr: 4,4,3,3,3,3. MEMPTR = nn + 1.
            0x43 | 0x53 | 0x63 | 0x73 => {
                let addr = self.imm16(bus, t);
                let [hi, lo] = self.rp::<0>(op >> 4).to_be_bytes();
                bus.write(addr, lo, t);
                let addr1 = addr.wrapping_add(1);
                bus.write(addr1, hi, t);
                self.regs.memptr = addr1;
            }
            // LD rr,(nn): 4,4,3,3,3,3. MEMPTR = nn + 1.
            0x4b | 0x5b | 0x6b | 0x7b => {
                let addr = self.imm16(bus, t);
                let lo = bus.read(addr, t);
                let addr1 = addr.wrapping_add(1);
                let hi = bus.read(addr1, t);
                self.set_rp::<0>(op >> 4, u16::from_le_bytes([lo, hi]));
                self.regs.memptr = addr1;
            }
            // NEG, and its seven undocumented duplicates.
            0x44 | 0x4c | 0x54 | 0x5c | 0x64 | 0x6c | 0x74 | 0x7c => {
                let (a, f) = alu::sub8(0, self.regs.a, 0);
                self.regs.a = a;
                self.setf(f);
            }
            // RETN (45) and RETI (4D), and their duplicates: all of them copy IFF2 to IFF1. 4,4,3,3.
            0x45 | 0x4d | 0x55 | 0x5d | 0x65 | 0x6d | 0x75 | 0x7d => self.retn(bus, t),
            // IM 0, 1, 2 and their duplicates (4E and 6E set the undefined "IM 0/1", which acts as IM 0).
            0x46 | 0x4e | 0x66 | 0x6e => self.regs.im = 0,
            0x56 | 0x76 => self.regs.im = 1,
            0x5e | 0x7e => self.regs.im = 2,
            // LD I,A / LD R,A: 4,5 (1 internal at IR, the old I and R)
            0x47 => {
                bus.internal(self.rfsh, 1, t);
                self.regs.i = self.regs.a;
            }
            0x4f => {
                bus.internal(self.rfsh, 1, t);
                self.regs.r = self.regs.a;
            }
            // LD A,I / LD A,R: 4,5. P/V is IFF2.
            0x57 | 0x5f => {
                bus.internal(self.rfsh, 1, t);
                let a = if op == 0x57 { self.regs.i } else { self.regs.r };
                self.regs.a = a;
                let pv = if self.regs.iff2 { P } else { 0 };
                self.setf((self.regs.f & C) | SZXY[a as usize] | pv);
                self.regs.ld_a_ir = true;
            }
            // RRD / RLD: 4,4,3,4,3 (4 internal at HL). MEMPTR = HL + 1.
            0x67 | 0x6f => {
                let hl = self.regs.hl();
                let v = bus.read(hl, t);
                bus.internal(hl, 4, t);
                let a = self.regs.a;
                let (m, na) = if op == 0x67 {
                    ((a << 4) | (v >> 4), (a & 0xf0) | (v & 0x0f))
                } else {
                    ((v << 4) | (a & 0x0f), (a & 0xf0) | (v >> 4))
                };
                self.regs.a = na;
                self.setf((self.regs.f & C) | SZXYP[na as usize]);
                self.regs.memptr = hl.wrapping_add(1);
                bus.write(hl, m, t);
            }
            // LDI, LDD, LDIR, LDDR: 4,4,3,5 (+5 when it repeats)
            0xa0 | 0xa8 | 0xb0 | 0xb8 => self.ld_block(op, bus, t),
            // CPI, CPD, CPIR, CPDR: 4,4,3,5 (+5 when it repeats)
            0xa1 | 0xa9 | 0xb1 | 0xb9 => self.cp_block(op, bus, t),
            // INI, IND, INIR, INDR: 4,5,4,3 (+5 when it repeats)
            0xa2 | 0xaa | 0xb2 | 0xba => self.in_block(op, bus, t),
            // OUTI, OUTD, OTIR, OTDR: 4,5,3,4 (+5 when it repeats)
            0xa3 | 0xab | 0xb3 | 0xbb => self.out_block(op, bus, t),
            // ED 77 and ED 7F, and every opcode outside 40–7F and the block instructions: no operation.
            _ => {}
        }
    }

    /// LDI/LDD/LDIR/LDDR. Bit 3 of the opcode is the direction, bit 4 the repeat.
    fn ld_block(&mut self, op: u8, bus: &mut impl Bus, t: &mut u32) {
        let step = if op & 8 == 0 { 1u16 } else { 0xffff };
        let hl = self.regs.hl();
        let de = self.regs.de();
        let v = bus.read(hl, t);
        bus.write(de, v, t);
        bus.internal(de, 2, t);
        self.regs.set_hl(hl.wrapping_add(step));
        self.regs.set_de(de.wrapping_add(step));
        let bc = self.regs.bc().wrapping_sub(1);
        self.regs.set_bc(bc);
        // X is bit 3 and Y bit 1 of A + the byte moved.
        let n = self.regs.a.wrapping_add(v);
        let mut f = (self.regs.f & (S | Z | C)) | (n & X) | ((n << 4) & Y);
        if bc != 0 {
            f |= P;
        }
        if op & 0x10 != 0 && bc != 0 {
            // The repeat: 5 internal T-states at DE, PC back to the instruction, and X and Y from PC's high
            // byte (bits 11 and 13 of the instruction's address).
            bus.internal(de, 5, t);
            let pc = self.regs.pc.wrapping_sub(2);
            self.regs.pc = pc;
            self.regs.memptr = pc.wrapping_add(1);
            f = (f & !(X | Y)) | ((pc >> 8) as u8 & (X | Y));
        }
        self.setf(f);
    }

    /// CPI/CPD/CPIR/CPDR.
    fn cp_block(&mut self, op: u8, bus: &mut impl Bus, t: &mut u32) {
        let step = if op & 8 == 0 { 1u16 } else { 0xffff };
        let hl = self.regs.hl();
        let v = bus.read(hl, t);
        bus.internal(hl, 5, t);
        self.regs.set_hl(hl.wrapping_add(step));
        let bc = self.regs.bc().wrapping_sub(1);
        self.regs.set_bc(bc);
        let a = self.regs.a;
        let r = a.wrapping_sub(v);
        let h = (a ^ v ^ r) & H;
        // X is bit 3 and Y bit 1 of A - the byte - H.
        let n = r.wrapping_sub(h >> 4);
        let mut f = (r & S) | h | N | (self.regs.f & C) | (n & X) | ((n << 4) & Y);
        if r == 0 {
            f |= Z;
        }
        if bc != 0 {
            f |= P;
        }
        if op & 0x10 != 0 && bc != 0 && r != 0 {
            bus.internal(hl, 5, t);
            let pc = self.regs.pc.wrapping_sub(2);
            self.regs.pc = pc;
            self.regs.memptr = pc.wrapping_add(1);
            f = (f & !(X | Y)) | ((pc >> 8) as u8 & (X | Y));
        } else {
            self.regs.memptr = self.regs.memptr.wrapping_add(step);
        }
        self.setf(f);
    }

    /// INI/IND/INIR/INDR: 1 internal at IR, the input from BC, the write to HL; then B is decremented.
    fn in_block(&mut self, op: u8, bus: &mut impl Bus, t: &mut u32) {
        let dec = op & 8 != 0;
        bus.internal(self.rfsh, 1, t);
        let bc = self.regs.bc();
        let v = bus.port_in(bc, t);
        let hl = self.regs.hl();
        bus.write(hl, v, t);
        self.regs.memptr = if dec {
            bc.wrapping_sub(1)
        } else {
            bc.wrapping_add(1)
        };
        let c = if dec {
            self.regs.c.wrapping_sub(1)
        } else {
            self.regs.c.wrapping_add(1)
        };
        let b = self.regs.b.wrapping_sub(1);
        self.regs.b = b;
        self.regs.set_hl(if dec {
            hl.wrapping_sub(1)
        } else {
            hl.wrapping_add(1)
        });
        let mut f = alu::io_block(v, v as u16 + c as u16, b);
        if op & 0x10 != 0 && b != 0 {
            bus.internal(hl, 5, t);
            let pc = self.regs.pc.wrapping_sub(2);
            self.regs.pc = pc;
            self.regs.memptr = pc.wrapping_add(1);
            f = alu::io_block_repeat(f, v, b, pc);
        }
        self.setf(f);
    }

    /// OUTI/OUTD/OTIR/OTDR: 1 internal at IR, the read from HL, then B is decremented before the output to
    /// BC (the port's high byte is the decremented B).
    fn out_block(&mut self, op: u8, bus: &mut impl Bus, t: &mut u32) {
        let dec = op & 8 != 0;
        bus.internal(self.rfsh, 1, t);
        let hl = self.regs.hl();
        let v = bus.read(hl, t);
        let b = self.regs.b.wrapping_sub(1);
        self.regs.b = b;
        let bc = self.regs.bc();
        bus.port_out(bc, v, t);
        self.regs.memptr = if dec {
            bc.wrapping_sub(1)
        } else {
            bc.wrapping_add(1)
        };
        let hl = if dec {
            hl.wrapping_sub(1)
        } else {
            hl.wrapping_add(1)
        };
        self.regs.set_hl(hl);
        let mut f = alu::io_block(v, v as u16 + (hl as u8) as u16, b);
        if op & 0x10 != 0 && b != 0 {
            bus.internal(bc, 5, t);
            let pc = self.regs.pc.wrapping_sub(2);
            self.regs.pc = pc;
            self.regs.memptr = pc.wrapping_add(1);
            f = alu::io_block_repeat(f, v, b, pc);
        }
        self.setf(f);
    }
}
