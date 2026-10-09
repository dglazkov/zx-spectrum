//! The arithmetic and logic unit: each operation's result and the flags it leaves, X and Y included.
//!
//! The formulas are the ones measured on NMOS Z80s and collected by Sean Young ("The Undocumented Z80
//! Documented"), with the block instructions' flags as David Banks deciphered them in 2018; `docs/z80.md` has
//! the sources.

use crate::flags::{C, H, N, P, S, X, Y, Z};

/// S, Z, Y and X as a result byte sets them.
pub(crate) const SZXY: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < 256 {
        t[i] = (i as u8) & (S | Y | X);
        if i == 0 {
            t[i] |= Z;
        }
        i += 1;
    }
    t
};

/// S, Z, Y, X and P (as parity: set when the byte has an even number of bits set).
pub(crate) const SZXYP: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < 256 {
        t[i] = SZXY[i] | parity(i as u8);
        i += 1;
    }
    t
};

/// P set when `v` has an even number of bits set.
#[inline(always)]
pub(crate) const fn parity(v: u8) -> u8 {
    if v.count_ones() & 1 == 0 { P } else { 0 }
}

/// ADD and ADC: the result and its flags. `carry` is 0 or 1.
#[inline(always)]
pub(crate) fn add8(a: u8, v: u8, carry: u8) -> (u8, u8) {
    let wide = a as u16 + v as u16 + carry as u16;
    let r = wide as u8;
    let f = SZXY[r as usize]
        | ((wide >> 8) as u8 & C)
        | ((a ^ v ^ r) & H)
        | ((((a ^ v ^ 0x80) & (v ^ r)) >> 5) & P);
    (r, f)
}

/// SUB, SBC and CP's arithmetic: the result and its flags (X and Y from the result). `carry` is 0 or 1.
#[inline(always)]
pub(crate) fn sub8(a: u8, v: u8, carry: u8) -> (u8, u8) {
    let wide = (a as u16).wrapping_sub(v as u16).wrapping_sub(carry as u16);
    let r = wide as u8;
    let f = SZXY[r as usize]
        | N
        | ((wide >> 8) as u8 & C)
        | ((a ^ v ^ r) & H)
        | ((((a ^ v) & (a ^ r)) >> 5) & P);
    (r, f)
}

/// The flags of CP: SUB's, but with X and Y from the operand rather than the result.
#[inline(always)]
pub(crate) fn cp8(a: u8, v: u8) -> u8 {
    let (_, f) = sub8(a, v, 0);
    (f & !(X | Y)) | (v & (X | Y))
}

/// INC r: the result and flags (C is kept from `f`).
#[inline(always)]
pub(crate) fn inc8(v: u8, f: u8) -> (u8, u8) {
    let r = v.wrapping_add(1);
    let mut nf = (f & C) | SZXY[r as usize];
    if r == 0x80 {
        nf |= P;
    }
    if r & 0x0f == 0 {
        nf |= H;
    }
    (r, nf)
}

/// DEC r: the result and flags (C is kept from `f`).
#[inline(always)]
pub(crate) fn dec8(v: u8, f: u8) -> (u8, u8) {
    let r = v.wrapping_sub(1);
    let mut nf = (f & C) | N | SZXY[r as usize];
    if r == 0x7f {
        nf |= P;
    }
    if v & 0x0f == 0 {
        nf |= H;
    }
    (r, nf)
}

/// The eight operations of the 80–BF block and their immediate forms (ADD, ADC, SUB, SBC, AND, XOR, OR, CP),
/// on A: the new A and the flags.
#[inline(always)]
pub(crate) fn alu(op: u8, a: u8, v: u8, f: u8) -> (u8, u8) {
    match op & 7 {
        0 => add8(a, v, 0),
        1 => add8(a, v, f & C),
        2 => sub8(a, v, 0),
        3 => sub8(a, v, f & C),
        4 => {
            let r = a & v;
            (r, SZXYP[r as usize] | H)
        }
        5 => {
            let r = a ^ v;
            (r, SZXYP[r as usize])
        }
        6 => {
            let r = a | v;
            (r, SZXYP[r as usize])
        }
        _ => (a, cp8(a, v)),
    }
}

/// The CB-prefixed rotates and shifts (RLC, RRC, RL, RR, SLA, SRA, SLL, SRL): the result and its flags.
#[inline(always)]
pub(crate) fn rot(op: u8, v: u8, f: u8) -> (u8, u8) {
    let (r, c) = match op & 7 {
        0 => (v.rotate_left(1), v >> 7),
        1 => (v.rotate_right(1), v & 1),
        2 => ((v << 1) | (f & C), v >> 7),
        3 => ((v >> 1) | (f << 7), v & 1),
        4 => (v << 1, v >> 7),
        5 => ((v >> 1) | (v & 0x80), v & 1),
        // SLL (undocumented): shifts left and sets bit 0.
        6 => ((v << 1) | 1, v >> 7),
        _ => (v >> 1, v & 1),
    };
    (r, SZXYP[r as usize] | c)
}

/// BIT n on `v`: the flags, with X and Y taken from `xy` (the operand itself for a register; MEMPTR's high
/// byte for (HL); the high byte of the address for (IX+d)).
#[inline(always)]
pub(crate) fn bit(n: u8, v: u8, xy: u8, f: u8) -> u8 {
    let m = v & (1 << n);
    let mut nf = (f & C) | H | (xy & (X | Y)) | (m & S);
    if m == 0 {
        nf |= Z | P;
    }
    nf
}

/// DAA: the adjusted A and its flags, from A and the flags of the addition or subtraction before it.
#[inline(always)]
pub(crate) fn daa(a: u8, f: u8) -> (u8, u8) {
    let mut diff = 0u8;
    let mut carry = f & C;
    if f & H != 0 || a & 0x0f > 9 {
        diff = 0x06;
    }
    if carry != 0 || a > 0x99 {
        diff |= 0x60;
        carry = C;
    }
    let r = if f & N != 0 {
        a.wrapping_sub(diff)
    } else {
        a.wrapping_add(diff)
    };
    (r, SZXYP[r as usize] | ((a ^ r) & H) | (f & N) | carry)
}

/// ADD HL,rr (and ADD IX/IY,rr): the sum and flags; S, Z and P/V are kept from `f`, H is the carry out of
/// bit 11, X and Y come from the sum's high byte.
#[inline(always)]
pub(crate) fn add16(a: u16, v: u16, f: u8) -> (u16, u8) {
    let wide = a as u32 + v as u32;
    let r = wide as u16;
    let hi = (r >> 8) as u8;
    let nf = (f & (S | Z | P))
        | (hi & (X | Y))
        | ((((a ^ v ^ r) >> 8) as u8) & H)
        | ((wide >> 16) as u8 & C);
    (r, nf)
}

/// ADC HL,rr: the sum and flags (all from the 16-bit result; X, Y and S from its high byte).
#[inline(always)]
pub(crate) fn adc16(a: u16, v: u16, carry: u8) -> (u16, u8) {
    let wide = a as u32 + v as u32 + carry as u32;
    let r = wide as u16;
    let hi = (r >> 8) as u8;
    let mut nf = (hi & (S | X | Y)) | ((((a ^ v ^ r) >> 8) as u8) & H) | ((wide >> 16) as u8 & C);
    if r == 0 {
        nf |= Z;
    }
    if (a ^ v ^ 0x8000) & (v ^ r) & 0x8000 != 0 {
        nf |= P;
    }
    (r, nf)
}

/// SBC HL,rr: the difference and flags.
#[inline(always)]
pub(crate) fn sbc16(a: u16, v: u16, carry: u8) -> (u16, u8) {
    let wide = (a as u32).wrapping_sub(v as u32).wrapping_sub(carry as u32);
    let r = wide as u16;
    let hi = (r >> 8) as u8;
    let mut nf =
        N | (hi & (S | X | Y)) | ((((a ^ v ^ r) >> 8) as u8) & H) | (((wide >> 16) as u8) & C);
    if r == 0 {
        nf |= Z;
    }
    if (a ^ v) & (a ^ r) & 0x8000 != 0 {
        nf |= P;
    }
    (r, nf)
}

/// The flags of INI, IND, OUTI and OUTD (and of the last iteration of their repeating forms). `data` is the
/// byte moved, `k` the sum it is added to (C ± 1 for input, L after the step for output), `b` is B after
/// its decrement.
#[inline(always)]
pub(crate) fn io_block(data: u8, k: u16, b: u8) -> u8 {
    let mut f = SZXY[b as usize] | parity((k as u8 & 7) ^ b);
    if data & 0x80 != 0 {
        f |= N;
    }
    if k > 0xff {
        f |= H | C;
    }
    f
}

/// The flags of INIR, INDR, OTIR and OTDR on an iteration that repeats (B is not 0), from those of the
/// single instruction (`f`): during the extra 5 T-states the chip copies bits 13 and 11 of PC (the
/// instruction's own address) to Y and X, and works P/V and H again from B (David Banks, 2018).
#[inline(always)]
pub(crate) fn io_block_repeat(f: u8, data: u8, b: u8, pc: u16) -> u8 {
    let mut nf = (f & !(X | Y | P | H)) | ((pc >> 8) as u8 & (X | Y));
    let p = f & P;
    if f & C != 0 {
        if data & 0x80 != 0 {
            nf |= p ^ parity(b.wrapping_sub(1) & 7) ^ P;
            if b & 0x0f == 0 {
                nf |= H;
            }
        } else {
            nf |= p ^ parity(b.wrapping_add(1) & 7) ^ P;
            if b & 0x0f == 0x0f {
                nf |= H;
            }
        }
    } else {
        nf |= p ^ parity(b & 7) ^ P;
    }
    nf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_match_their_definitions() {
        assert_eq!(SZXYP[0], Z | P);
        assert_eq!(SZXYP[0xff], S | Y | X | P);
        assert_eq!(SZXYP[0x01], 0);
        assert_eq!(SZXY[0x28], X | Y);
    }

    #[test]
    fn add_and_sub_flags() {
        // 0x7f + 1 overflows into the sign bit, with a half carry.
        assert_eq!(add8(0x7f, 0x01, 0), (0x80, S | H | P));
        // 0xff + 1 is 0 with carry and half carry, no overflow.
        assert_eq!(add8(0xff, 0x01, 0), (0x00, Z | H | C));
        // 0x80 - 1 overflows; borrow from bit 4.
        assert_eq!(sub8(0x80, 0x01, 0), (0x7f, N | H | P | Y | X));
        // CP takes X and Y from the operand.
        assert_eq!(cp8(0x00, 0x28) & (X | Y), X | Y);
    }

    #[test]
    fn daa_after_bcd_addition() {
        // 0x15 + 0x27 = 0x3c, adjusted to 0x42.
        let (a, f) = add8(0x15, 0x27, 0);
        assert_eq!(daa(a, f).0, 0x42);
        // 0x99 + 0x01 = 0x9a, adjusted to 0x00 with carry.
        let (a, f) = add8(0x99, 0x01, 0);
        let (r, nf) = daa(a, f);
        assert_eq!(r, 0x00);
        assert_eq!(nf & (C | Z), C | Z);
    }
}
