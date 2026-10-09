//! A disassembler: the instruction at an address, as text, with its length.
//!
//! It knows every opcode the CPU does, undocumented ones included, and says which those are. Mnemonics are
//! Zilog's, upper case; numbers are hexadecimal with a `$` (`LD HL,$5C00`, `LD A,(IX+$05)`, `LD (IY-$02),B`);
//! a relative jump shows its target address (`JR NZ,$8012`). The undocumented instructions are written as
//! they are usually known: `SLL`, `IXH`/`IXL`/`IYH`/`IYL`, `IN F,(C)`, `OUT (C),0`, and the DDCB/FDCB forms
//! that also load a register as `RLC (IX+$05),B` or `SET 3,(IY+$00),A`.
//!
//! An instruction is what [`crate::Cpu::step`] runs in one call, so a DD or FD prefix in front of an opcode it
//! does not modify (`DD 3E 05`, or a prefix followed by another prefix or by ED) is an instruction of its
//! own: one byte, `NOP`, marked undocumented. An ED opcode that has no instruction is a two-byte `NOP`,
//! marked likewise.

use std::fmt::Write;

/// One disassembled instruction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Instruction {
    /// Its length in bytes, 1 to 4.
    pub len: u8,
    /// The mnemonic and operands, e.g. `LD A,(IX+$05)`.
    pub text: String,
    /// Not in Zilog's documentation: SLL, the index register halves, the DDCB/FDCB register copies, the ED
    /// duplicates, ED no-ops, IN F,(C), OUT (C),0, and prefixes that change nothing.
    pub undocumented: bool,
}

const R: [&str; 8] = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];
const RP: [&str; 4] = ["BC", "DE", "HL", "SP"];
const RP2: [&str; 4] = ["BC", "DE", "HL", "AF"];
const CC: [&str; 8] = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
const ALU: [&str; 8] = [
    "ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP ",
];
const ROT: [&str; 8] = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"];

/// Disassembles the instruction at `addr`, reading its bytes through `read` (addresses wrap at 64K).
pub fn disassemble(read: impl Fn(u16) -> u8, addr: u16) -> Instruction {
    let mut d = Decoder {
        read: &read,
        addr,
        len: 0,
        text: String::new(),
        undocumented: false,
    };
    let op = d.byte();
    match op {
        0xcb => d.cb(),
        0xed => d.ed(),
        0xdd | 0xfd => {
            let ix = if op == 0xdd { "IX" } else { "IY" };
            let next = d.peek(1);
            if modified_by_prefix(next) {
                d.indexed(ix);
            } else {
                d.text.push_str("NOP");
                d.undocumented = true;
            }
        }
        _ => d.main(op, None),
    }
    Instruction {
        len: d.len,
        text: d.text,
        undocumented: d.undocumented,
    }
}

/// Whether a DD/FD prefix changes the unprefixed opcode `op` (which uses H, L, HL or (HL)); EX DE,HL and EXX
/// ignore the prefix, as do the prefixes DD, FD and ED themselves.
fn modified_by_prefix(op: u8) -> bool {
    let (x, y, z) = (op >> 6, (op >> 3) & 7, op & 7);
    match x {
        0 => match z {
            // ADD HL,rr always uses HL; of LD rr,nn only LD HL,nn does.
            1 => y & 1 == 1 || y >> 1 == 2,
            // LD (nn),HL, LD HL,(nn), INC HL, DEC HL.
            2 | 3 => y >> 1 == 2,
            // INC, DEC and LD n of H, L and (HL).
            4..=6 => (4..=6).contains(&y),
            _ => false,
        },
        1 => op != 0x76 && ((4..=6).contains(&y) || (4..=6).contains(&z)),
        2 => (4..=6).contains(&z),
        _ => matches!(op, 0xcb | 0xe1 | 0xe3 | 0xe5 | 0xe9 | 0xf9),
    }
}

struct Decoder<'a, F: Fn(u16) -> u8> {
    read: &'a F,
    addr: u16,
    len: u8,
    text: String,
    undocumented: bool,
}

impl<F: Fn(u16) -> u8> Decoder<'_, F> {
    fn byte(&mut self) -> u8 {
        let v = (self.read)(self.addr.wrapping_add(self.len as u16));
        self.len += 1;
        v
    }

    fn peek(&self, offset: u16) -> u8 {
        (self.read)(self.addr.wrapping_add(offset))
    }

    fn word(&mut self) -> u16 {
        let lo = self.byte();
        let hi = self.byte();
        u16::from_le_bytes([lo, hi])
    }

    fn n(&mut self) -> String {
        format!("${:02X}", self.byte())
    }

    fn nn(&mut self) -> String {
        format!("${:04X}", self.word())
    }

    /// A relative jump's target: the address after the 2-byte instruction plus the displacement.
    fn rel(&mut self) -> String {
        let d = self.byte() as i8;
        let target = self.addr.wrapping_add(2).wrapping_add(d as u16);
        format!("${target:04X}")
    }

    /// An unprefixed opcode, or (with `ix`) one under a DD/FD prefix that modifies it, the prefix already
    /// counted. Under a prefix, `(HL)` becomes `(IX+d)` and H/L the halves, except next to `(IX+d)`.
    fn main(&mut self, op: u8, ix: Option<&str>) {
        let (x, y, z) = (op >> 6, (op >> 3) & 7, op & 7);
        let (p, q) = (y >> 1, y & 1);
        let hl = ix.unwrap_or("HL");
        // A register operand by its code, in an instruction without a memory operand (with one, H and L are
        // the real ones and R names them).
        let reg = |code: u8| -> String {
            match (ix, code) {
                (Some(i), 4) => format!("{i}H"),
                (Some(i), 5) => format!("{i}L"),
                _ => R[code as usize].to_string(),
            }
        };
        let mut text = String::new();
        match x {
            0 => match z {
                0 => match y {
                    0 => text.push_str("NOP"),
                    1 => text.push_str("EX AF,AF'"),
                    2 => text = format!("DJNZ {}", self.rel()),
                    3 => text = format!("JR {}", self.rel()),
                    _ => text = format!("JR {},{}", CC[(y - 4) as usize], self.rel()),
                },
                1 => {
                    let rp = if p == 2 { hl } else { RP[p as usize] };
                    if q == 0 {
                        text = format!("LD {rp},{}", self.nn());
                    } else {
                        text = format!("ADD {hl},{rp}");
                    }
                }
                2 => {
                    text = match (p, q) {
                        (0, 0) => "LD (BC),A".into(),
                        (1, 0) => "LD (DE),A".into(),
                        (2, 0) => format!("LD ({}),{hl}", self.nn()),
                        (3, 0) => format!("LD ({}),A", self.nn()),
                        (0, _) => "LD A,(BC)".into(),
                        (1, _) => "LD A,(DE)".into(),
                        (2, _) => format!("LD {hl},({})", self.nn()),
                        _ => format!("LD A,({})", self.nn()),
                    }
                }
                3 => {
                    let rp = if p == 2 { hl } else { RP[p as usize] };
                    text = format!("{} {rp}", if q == 0 { "INC" } else { "DEC" });
                }
                4 | 5 => {
                    let operand = if y == 6 { self.mem(ix) } else { reg(y) };
                    text = format!("{} {operand}", if z == 4 { "INC" } else { "DEC" });
                }
                6 => {
                    let operand = if y == 6 { self.mem(ix) } else { reg(y) };
                    text = format!("LD {operand},{}", self.n());
                }
                _ => text.push_str(
                    ["RLCA", "RRCA", "RLA", "RRA", "DAA", "CPL", "SCF", "CCF"][y as usize],
                ),
            },
            1 => {
                if op == 0x76 {
                    text.push_str("HALT");
                } else if z == 6 {
                    let m = self.mem(ix);
                    text = format!("LD {},{m}", R[y as usize]);
                } else if y == 6 {
                    let m = self.mem(ix);
                    text = format!("LD {m},{}", R[z as usize]);
                } else {
                    text = format!("LD {},{}", reg(y), reg(z));
                }
            }
            2 => {
                let operand = if z == 6 { self.mem(ix) } else { reg(z) };
                text = format!("{}{operand}", ALU[y as usize]);
            }
            _ => match z {
                0 => text = format!("RET {}", CC[y as usize]),
                1 => {
                    text = match (q, p) {
                        (0, _) => format!("POP {}", if p == 2 { hl } else { RP2[p as usize] }),
                        (_, 0) => "RET".into(),
                        (_, 1) => "EXX".into(),
                        (_, 2) => format!("JP ({hl})"),
                        _ => format!("LD SP,{hl}"),
                    }
                }
                2 => text = format!("JP {},{}", CC[y as usize], self.nn()),
                3 => {
                    text = match y {
                        0 => format!("JP {}", self.nn()),
                        2 => format!("OUT ({}),A", self.n()),
                        3 => format!("IN A,({})", self.n()),
                        4 => format!("EX (SP),{hl}"),
                        5 => "EX DE,HL".into(),
                        6 => "DI".into(),
                        _ => "EI".into(),
                    }
                }
                4 => text = format!("CALL {},{}", CC[y as usize], self.nn()),
                5 => {
                    text = if q == 0 {
                        format!("PUSH {}", if p == 2 { hl } else { RP2[p as usize] })
                    } else {
                        format!("CALL {}", self.nn())
                    }
                }
                6 => text = format!("{}{}", ALU[y as usize], self.n()),
                _ => text = format!("RST ${:02X}", y * 8),
            },
        }
        if ix.is_some() {
            // The index register's halves are undocumented; everything else under a prefix is documented.
            if text.contains("IXH")
                || text.contains("IXL")
                || text.contains("IYH")
                || text.contains("IYL")
            {
                self.undocumented = true;
            }
        }
        self.text = text;
    }

    /// The memory operand: `(HL)`, or `(IX+d)` with its displacement read.
    fn mem(&mut self, ix: Option<&str>) -> String {
        match ix {
            None => "(HL)".into(),
            Some(i) => {
                let d = self.byte() as i8;
                displaced(i, d)
            }
        }
    }

    /// A DD/FD-prefixed instruction: DDCB/FDCB, or a main-table opcode with the index register.
    fn indexed(&mut self, ix: &str) {
        let op = self.byte();
        if op != 0xcb {
            return self.main(op, Some(ix));
        }
        let d = self.byte() as i8;
        let op = self.byte();
        let (x, y, z) = (op >> 6, (op >> 3) & 7, op & 7);
        let m = displaced(ix, d);
        let mut text = match x {
            0 => format!("{} {m}", ROT[y as usize]),
            1 => format!("BIT {y},{m}"),
            2 => format!("RES {y},{m}"),
            _ => format!("SET {y},{m}"),
        };
        if y == 6 && x == 0 {
            self.undocumented = true;
        }
        if z != 6 {
            // BIT ignores the register field; the others also copy their result into the register.
            self.undocumented = true;
            if x != 1 {
                let _ = write!(text, ",{}", R[z as usize]);
            }
        }
        self.text = text;
    }

    fn cb(&mut self) {
        let op = self.byte();
        let (x, y, z) = (op >> 6, (op >> 3) & 7, op & 7);
        let r = R[z as usize];
        self.text = match x {
            0 => {
                if y == 6 {
                    self.undocumented = true;
                }
                format!("{} {r}", ROT[y as usize])
            }
            1 => format!("BIT {y},{r}"),
            2 => format!("RES {y},{r}"),
            _ => format!("SET {y},{r}"),
        };
    }

    fn ed(&mut self) {
        let op = self.byte();
        let (x, y, z) = (op >> 6, (op >> 3) & 7, op & 7);
        let (p, q) = (y >> 1, y & 1);
        let text = match (x, z) {
            (1, 0) => {
                if y == 6 {
                    self.undocumented = true;
                    "IN F,(C)".to_string()
                } else {
                    format!("IN {},(C)", R[y as usize])
                }
            }
            (1, 1) => {
                if y == 6 {
                    self.undocumented = true;
                    "OUT (C),0".to_string()
                } else {
                    format!("OUT (C),{}", R[y as usize])
                }
            }
            (1, 2) => format!(
                "{} HL,{}",
                if q == 0 { "SBC" } else { "ADC" },
                RP[p as usize]
            ),
            // ED 63 and ED 6B are the longer, slower encodings of LD (nn),HL and LD HL,(nn): Zilog's manual
            // documents them as the HL case of LD (nn),dd and LD dd,(nn).
            (1, 3) => {
                let nn = self.nn();
                if q == 0 {
                    format!("LD ({nn}),{}", RP[p as usize])
                } else {
                    format!("LD {},({nn})", RP[p as usize])
                }
            }
            (1, 4) => {
                self.undocumented = y != 0;
                "NEG".to_string()
            }
            (1, 5) => {
                self.undocumented = y > 1;
                if y == 1 { "RETI" } else { "RETN" }.to_string()
            }
            (1, 6) => {
                self.undocumented = !matches!(y, 0 | 2 | 3);
                format!("IM {}", [0, 0, 1, 2, 0, 0, 1, 2][y as usize])
            }
            (1, 7) => match y {
                0 => "LD I,A".to_string(),
                1 => "LD R,A".to_string(),
                2 => "LD A,I".to_string(),
                3 => "LD A,R".to_string(),
                4 => "RRD".to_string(),
                5 => "RLD".to_string(),
                _ => {
                    self.undocumented = true;
                    "NOP".to_string()
                }
            },
            (2, 0..=3) if y >= 4 => {
                let names = [
                    ["LDI", "CPI", "INI", "OUTI"],
                    ["LDD", "CPD", "IND", "OUTD"],
                    ["LDIR", "CPIR", "INIR", "OTIR"],
                    ["LDDR", "CPDR", "INDR", "OTDR"],
                ];
                names[(y - 4) as usize][z as usize].to_string()
            }
            _ => {
                self.undocumented = true;
                "NOP".to_string()
            }
        };
        self.text = text;
    }
}

/// `(IX+$05)` or `(IY-$02)`.
fn displaced(ix: &str, d: i8) -> String {
    if d < 0 {
        format!("({ix}-${:02X})", d.unsigned_abs())
    } else {
        format!("({ix}+${d:02X})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dis(bytes: &[u8]) -> (String, u8, bool) {
        let mem = |a: u16| bytes.get(a as usize).copied().unwrap_or(0);
        let i = disassemble(mem, 0);
        (i.text, i.len, i.undocumented)
    }

    #[test]
    fn documented_instructions() {
        assert_eq!(dis(&[0x00]), ("NOP".into(), 1, false));
        assert_eq!(dis(&[0x21, 0x00, 0x5c]), ("LD HL,$5C00".into(), 3, false));
        assert_eq!(dis(&[0x20, 0xfe]), ("JR NZ,$0000".into(), 2, false));
        assert_eq!(dis(&[0x10, 0x05]), ("DJNZ $0007".into(), 2, false));
        assert_eq!(dis(&[0x36, 0x12]), ("LD (HL),$12".into(), 2, false));
        assert_eq!(dis(&[0x76]), ("HALT".into(), 1, false));
        assert_eq!(dis(&[0xdd, 0x7e, 0x05]), ("LD A,(IX+$05)".into(), 3, false));
        assert_eq!(dis(&[0xfd, 0x70, 0xfe]), ("LD (IY-$02),B".into(), 3, false));
        assert_eq!(
            dis(&[0xdd, 0x36, 0x01, 0x99]),
            ("LD (IX+$01),$99".into(), 4, false)
        );
        assert_eq!(dis(&[0xdd, 0x66, 0x01]), ("LD H,(IX+$01)".into(), 3, false));
        assert_eq!(
            dis(&[0xfd, 0xcb, 0x01, 0x4e]),
            ("BIT 1,(IY+$01)".into(), 4, false)
        );
        assert_eq!(dis(&[0xdd, 0xe9]), ("JP (IX)".into(), 2, false));
        assert_eq!(dis(&[0xdd, 0x09]), ("ADD IX,BC".into(), 2, false));
        assert_eq!(dis(&[0xdd, 0x29]), ("ADD IX,IX".into(), 2, false));
        assert_eq!(dis(&[0xed, 0xb0]), ("LDIR".into(), 2, false));
        assert_eq!(
            dis(&[0xed, 0x43, 0x34, 0x12]),
            ("LD ($1234),BC".into(), 4, false)
        );
        assert_eq!(dis(&[0xed, 0x5e]), ("IM 2".into(), 2, false));
        assert_eq!(dis(&[0xdb, 0xfe]), ("IN A,($FE)".into(), 2, false));
        assert_eq!(dis(&[0xff]), ("RST $38".into(), 1, false));
        assert_eq!(dis(&[0xcb, 0x7e]), ("BIT 7,(HL)".into(), 2, false));
        assert_eq!(dis(&[0xe3]), ("EX (SP),HL".into(), 1, false));
        assert_eq!(dis(&[0x08]), ("EX AF,AF'".into(), 1, false));
    }

    #[test]
    fn undocumented_instructions() {
        assert_eq!(dis(&[0xcb, 0x30]), ("SLL B".into(), 2, true));
        assert_eq!(dis(&[0xdd, 0x44]), ("LD B,IXH".into(), 2, true));
        assert_eq!(dis(&[0xfd, 0x6c]), ("LD IYL,IYH".into(), 2, true));
        assert_eq!(
            dis(&[0xdd, 0xcb, 0x05, 0x00]),
            ("RLC (IX+$05),B".into(), 4, true)
        );
        assert_eq!(
            dis(&[0xfd, 0xcb, 0xff, 0xdf]),
            ("SET 3,(IY-$01),A".into(), 4, true)
        );
        assert_eq!(
            dis(&[0xdd, 0xcb, 0x00, 0x40]),
            ("BIT 0,(IX+$00)".into(), 4, true)
        );
        assert_eq!(dis(&[0xed, 0x70]), ("IN F,(C)".into(), 2, true));
        assert_eq!(dis(&[0xed, 0x71]), ("OUT (C),0".into(), 2, true));
        assert_eq!(dis(&[0xed, 0x4c]), ("NEG".into(), 2, true));
        assert_eq!(dis(&[0xed, 0x00]), ("NOP".into(), 2, true));
        assert_eq!(dis(&[0xed, 0x4e]), ("IM 0".into(), 2, true));
        // A prefix that changes nothing is a one-byte instruction of its own.
        assert_eq!(dis(&[0xdd, 0x3e, 0x05]), ("NOP".into(), 1, true));
        assert_eq!(
            dis(&[0xdd, 0xfd, 0x21, 0x00, 0x00]),
            ("NOP".into(), 1, true)
        );
        assert_eq!(dis(&[0xdd, 0xeb]), ("NOP".into(), 1, true));
        assert_eq!(
            dis(&[0xdd, 0x21, 0x34, 0x12]),
            ("LD IX,$1234".into(), 4, false)
        );
    }
}
