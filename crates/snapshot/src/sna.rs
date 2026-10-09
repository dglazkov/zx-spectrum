//! The .sna format, as World of Spectrum's page of formats documents it (worldofspectrum.org/faq/reference/
//! formats.htm): a 27-byte header and the 48K from 4000h, with the program counter pushed onto the stack (the
//! format came from snapshot hardware that restarted the program with RETN); and its 128K extension, which keeps
//! PC in the file instead, and adds port 7FFDh, whether the TR-DOS ROM was paged, and the other five or six banks.
//!
//! The 128K file's banks: 5, 2, then the one paged at C000h (so that the first 49,179 bytes are a 48K file's),
//! then PC, 7FFDh and the TR-DOS byte, then the rest in ascending order, leaving out 5, 2 and the paged one. When
//! the paged bank is 5 or 2 it is in the file twice, and six banks follow rather than five: so the file is 147,487
//! bytes rather than 131,103.

use crate::{BANK_SIZE, Error, Model, Registers, Snapshot, bank_from, le16};

const HEADER: usize = 27;
const SNA_48K: usize = HEADER + 3 * BANK_SIZE;
const SNA_128K_EXTRA: usize = 4;
const SNA_128K: usize = SNA_48K + SNA_128K_EXTRA + 5 * BANK_SIZE;
const SNA_128K_LONG: usize = SNA_128K + BANK_SIZE;

/// Whether `d` is the size of a .sna, with an interrupt mode that could be one.
pub(crate) fn plausible(d: &[u8]) -> bool {
    matches!(d.len(), SNA_48K | SNA_128K | SNA_128K_LONG) && d[25] <= 2
}

/// Reads a 48K or 128K .sna.
///
/// A 48K file's program counter is taken off the stack, and SP moved past it, as the RETN the format was made
/// for would. The two bytes it was pushed to keep the PC, as they do on the machine after that RETN (Rui Ribeiro
/// suggested zeroing them, which the documentation reports helped some snapshots; it is a guess about what was
/// there before, and is not made here). Neither file keeps IFF1, which RETN copies from IFF2; nor the T-state,
/// which is 0. A 128K file is taken as a Spectrum 128.
pub fn load_sna(d: &[u8]) -> Result<Snapshot, Error> {
    let model = match d.len() {
        SNA_48K => Model::Spectrum48,
        SNA_128K | SNA_128K_LONG => Model::Spectrum128,
        n if n < SNA_48K => return Err(Error::Truncated(format!("{n} bytes is less than a 48K .sna's 49,179"))),
        n => return Err(Error::Corrupt(format!("{n} bytes is the size of no .sna (49,179, 131,103 or 147,487)"))),
    };
    let im = d[25];
    if im > 2 {
        return Err(Error::Corrupt(format!("interrupt mode {im}")));
    }
    let iff = d[19] & 0x04 != 0;
    let mut s = Snapshot::new(model);
    s.regs = Registers {
        i: d[0],
        hl_alt: le16(d, 1),
        de_alt: le16(d, 3),
        bc_alt: le16(d, 5),
        af_alt: le16(d, 7),
        hl: le16(d, 9),
        de: le16(d, 11),
        bc: le16(d, 13),
        iy: le16(d, 15),
        ix: le16(d, 17),
        iff1: iff,
        iff2: iff,
        r: d[20],
        af: le16(d, 21),
        sp: le16(d, 23),
        im,
        ..Registers::default()
    };
    s.port_fe = d[26] & 7;
    let bank_at = |i: usize| bank_from(&d[HEADER + i * BANK_SIZE..HEADER + (i + 1) * BANK_SIZE]);
    s.ram[5] = Some(bank_at(0));
    s.ram[2] = Some(bank_at(1));

    if model == Model::Spectrum48 {
        s.ram[0] = Some(bank_at(2));
        let sp = s.regs.sp;
        let (Some(lo), Some(hi)) = (s.peek(sp), s.peek(sp.wrapping_add(1))) else {
            return Err(Error::Corrupt(format!(
                "the stack pointer {sp:04X}h is not in RAM, so the program counter cannot be taken from it"
            )));
        };
        s.regs.pc = u16::from_le_bytes([lo, hi]);
        s.regs.sp = sp.wrapping_add(2);
        return Ok(s);
    }

    s.regs.pc = le16(d, SNA_48K);
    s.port_7ffd = d[SNA_48K + 2];
    s.trdos_paged = d[SNA_48K + 3] == 1;
    let paged = (s.port_7ffd & 7) as usize;
    let doubled = paged == 5 || paged == 2;
    let expected = if doubled { SNA_128K_LONG } else { SNA_128K };
    if d.len() != expected {
        return Err(Error::Corrupt(format!(
            "a 128K .sna with bank {paged} paged is {expected} bytes long, and this one is {}",
            d.len()
        )));
    }
    // A doubled bank is the same memory twice; the first copy is kept.
    if !doubled {
        s.ram[paged] = Some(bank_at(2));
    }
    let rest = SNA_48K + SNA_128K_EXTRA;
    for (i, bank) in (0..8).filter(|&b| b != 5 && b != 2 && b != paged).enumerate() {
        s.ram[bank] = Some(bank_from(&d[rest + i * BANK_SIZE..rest + (i + 1) * BANK_SIZE]));
    }
    Ok(s)
}

/// Writes the snapshot as a .sna: a 48K file for a 16K or 48K, and a 128K file for the others. Lost in either:
/// the T-state, MEMPTR, the halted and suppressed-interrupt flags, IFF1 (RETN gives it IFF2's value), EAR and
/// MIC, the AY's registers; on a +2A or +3, port 1FFDh (and so a snapshot in their all-RAM paging cannot be
/// written).
///
/// A 48K file pushes the program counter onto the stack, as the format requires: the two bytes below SP are
/// overwritten with it, in the file's RAM (not in `s`), and SP is saved two lower. Where those two bytes are not
/// RAM (a stack at 4000h or 4001h, whose push would land in ROM; a 16K's above 8000h), the file cannot be written.
pub fn save_sna(s: &Snapshot) -> Result<Vec<u8>, Error> {
    let r = &s.regs;
    let mut out = vec![0u8; HEADER];
    let put16 = |out: &mut Vec<u8>, at: usize, v: u16| out[at..at + 2].copy_from_slice(&v.to_le_bytes());
    out[0] = r.i;
    put16(&mut out, 1, r.hl_alt);
    put16(&mut out, 3, r.de_alt);
    put16(&mut out, 5, r.bc_alt);
    put16(&mut out, 7, r.af_alt);
    put16(&mut out, 9, r.hl);
    put16(&mut out, 11, r.de);
    put16(&mut out, 13, r.bc);
    put16(&mut out, 15, r.iy);
    put16(&mut out, 17, r.ix);
    out[19] = if r.iff2 { 0x04 } else { 0 };
    out[20] = r.r;
    put16(&mut out, 21, r.af);
    out[25] = r.im;
    out[26] = s.port_fe & 7;

    if !s.model.is_128k() {
        let mut ram = s.clone();
        let sp = r.sp.wrapping_sub(2);
        let [lo, hi] = r.pc.to_le_bytes();
        if ram.peek(sp).is_none() || ram.peek(sp.wrapping_add(1)).is_none() {
            return Err(Error::CannotSave(format!(
                "a 48K .sna pushes PC onto the stack, and the two bytes below SP ({:04X}h) are not RAM",
                r.sp
            )));
        }
        ram.poke(sp, lo);
        ram.poke(sp.wrapping_add(1), hi);
        put16(&mut out, 23, sp);
        for bank in [5, 2, 0] {
            out.extend_from_slice(ram.bank_or_zero(bank));
        }
        return Ok(out);
    }

    if s.model.has_1ffd() && s.port_1ffd & 1 != 0 {
        return Err(Error::CannotSave(
            "the +2A/+3 is in its all-RAM paging, which a .sna (with no port 1FFDh) cannot hold".into(),
        ));
    }
    put16(&mut out, 23, r.sp);
    let paged = (s.port_7ffd & 7) as usize;
    for bank in [5, 2, paged] {
        out.extend_from_slice(s.bank_or_zero(bank));
    }
    out.extend_from_slice(&r.pc.to_le_bytes());
    out.push(s.port_7ffd);
    out.push(u8::from(s.trdos_paged));
    for bank in (0..8).filter(|&b| b != 5 && b != 2 && b != paged) {
        out.extend_from_slice(s.bank_or_zero(bank));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pattern(seed: u8) -> Box<crate::Bank> {
        let v: Vec<u8> = (0..BANK_SIZE).map(|i| (i as u8).wrapping_mul(seed).wrapping_add(seed)).collect();
        bank_from(&v)
    }

    fn snapshot_48k() -> Snapshot {
        let mut s = Snapshot::new(Model::Spectrum48);
        for b in [5, 2, 0] {
            s.ram[b] = Some(pattern(b as u8 + 1));
        }
        s.regs = Registers {
            af: 0x1234,
            bc: 0x5678,
            de: 0x9ABC,
            hl: 0xDEF0,
            af_alt: 0x0102,
            bc_alt: 0x0304,
            de_alt: 0x0506,
            hl_alt: 0x0708,
            ix: 0x090A,
            iy: 0x0B0C,
            sp: 0x8000,
            pc: 0xBEEF,
            i: 0x3F,
            r: 0xA5,
            iff1: true,
            iff2: true,
            im: 1,
            ..Registers::default()
        };
        s.port_fe = 3;
        s
    }

    #[test]
    fn the_48k_header_and_pc_on_the_stack() {
        let s = snapshot_48k();
        let f = save_sna(&s).unwrap();
        assert_eq!(f.len(), 49_179);
        // The header, field by field.
        assert_eq!(f[0], 0x3F);
        assert_eq!(&f[1..9], &[0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
        assert_eq!(&f[9..19], &[0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x0C, 0x0B, 0x0A, 0x09]);
        assert_eq!(f[19], 0x04);
        assert_eq!(f[20], 0xA5);
        assert_eq!(&f[21..25], &[0x34, 0x12, 0xFE, 0x7F]);
        assert_eq!(&f[25..27], &[1, 3]);
        // PC pushed at 7FFEh: offset 27 + 3FFEh.
        assert_eq!(&f[27 + 0x3FFE..27 + 0x4000], &[0xEF, 0xBE]);
        // Loaded back: PC off the stack, SP where it was, and the two bytes still hold the PC.
        let t = load_sna(&f).unwrap();
        assert_eq!(t.regs, s.regs);
        assert_eq!(t.peek(0x7FFE), Some(0xEF));
        assert_eq!(t.peek(0x7FFF), Some(0xBE));
        let mut expected = s.clone();
        expected.poke(0x7FFE, 0xEF);
        expected.poke(0x7FFF, 0xBE);
        assert_eq!(t, expected);
        // The snapshot itself is not changed by saving it.
        assert_eq!(s.peek(0x7FFE), Some(snapshot_48k().peek(0x7FFE).unwrap()));
    }

    #[test]
    fn the_48k_stack_at_the_edges_of_ram() {
        let mut s = snapshot_48k();
        // SP 0000h: the push wraps to FFFEh and FFFFh, RAM.
        s.regs.sp = 0x0000;
        let f = save_sna(&s).unwrap();
        assert_eq!(&f[27 + 0xBFFE..], &[0xEF, 0xBE]);
        let t = load_sna(&f).unwrap();
        assert_eq!((t.regs.pc, t.regs.sp), (0xBEEF, 0x0000));
        // SP 4002h: the push lands at 4000h and 4001h, the screen's first two bytes.
        s.regs.sp = 0x4002;
        let t = load_sna(&save_sna(&s).unwrap()).unwrap();
        assert_eq!((t.regs.pc, t.regs.sp, t.peek(0x4000), t.peek(0x4001)), (0xBEEF, 0x4002, Some(0xEF), Some(0xBE)));
        // SP 4001h and 4000h: the push would land in ROM.
        for sp in [0x4000, 0x4001, 0x0001, 0x2000] {
            s.regs.sp = sp;
            assert!(matches!(save_sna(&s), Err(Error::CannotSave(_))), "{sp:04x}");
        }
        // A file whose SP is in ROM, or FFFFh (PC's high byte would be in ROM at 0000h), cannot be read.
        s.regs.sp = 0x8000;
        let mut f = save_sna(&s).unwrap();
        for sp in [0x3FFFu16, 0xFFFF, 0x0000] {
            f[23..25].copy_from_slice(&sp.to_le_bytes());
            assert!(matches!(load_sna(&f), Err(Error::Corrupt(_))), "{sp:04x}");
        }
        f[23..25].copy_from_slice(&0xFFFEu16.to_le_bytes());
        assert_eq!(load_sna(&f).unwrap().regs.sp, 0x0000);
    }

    #[test]
    fn iff2_is_bit_2_and_both_flip_flops_take_it() {
        let mut s = snapshot_48k();
        s.regs.iff1 = false;
        s.regs.iff2 = true;
        let t = load_sna(&save_sna(&s).unwrap()).unwrap();
        assert!(t.regs.iff1 && t.regs.iff2);
        s.regs.iff2 = false;
        let t = load_sna(&save_sna(&s).unwrap()).unwrap();
        assert!(!t.regs.iff1 && !t.regs.iff2);
    }

    #[test]
    fn a_16k_is_written_as_a_48k() {
        let mut s = Snapshot::new(Model::Spectrum16);
        s.ram[5] = Some(pattern(9));
        s.regs.sp = 0x7F00;
        s.regs.pc = 0x6000;
        let t = load_sna(&save_sna(&s).unwrap()).unwrap();
        assert_eq!(t.model, Model::Spectrum48);
        assert_eq!((t.regs.pc, t.regs.sp), (0x6000, 0x7F00));
        assert_eq!(t.bank(0), Some(&[0u8; BANK_SIZE]));
        // A 16K's stack above its RAM has nowhere to push to.
        s.regs.sp = 0x9000;
        assert!(save_sna(&s).is_err());
    }

    #[test]
    fn the_128k_layout() {
        for paged in 0..8u8 {
            let mut s = Snapshot::new(Model::Spectrum128);
            for b in 0..8 {
                s.ram[b] = Some(pattern(b as u8 * 16 + 3));
            }
            s.port_7ffd = 0x10 | paged;
            s.regs.pc = 0x8123;
            s.regs.sp = 0x5FF0;
            s.trdos_paged = paged == 3;
            let f = save_sna(&s).unwrap();
            let doubled = paged == 5 || paged == 2;
            assert_eq!(f.len(), if doubled { 147_487 } else { 131_103 });
            assert_eq!(&f[27..27 + BANK_SIZE], &s.bank(5).unwrap()[..]);
            assert_eq!(&f[27 + 2 * BANK_SIZE..27 + 3 * BANK_SIZE], &s.bank(paged as usize).unwrap()[..]);
            assert_eq!(&f[49_179..49_183], &[0x23, 0x81, 0x10 | paged, u8::from(paged == 3)]);
            // The rest ascend: the first after the header is the lowest bank not yet written.
            let first = (0..8).find(|&b| b != 5 && b != 2 && b != paged as usize).unwrap();
            assert_eq!(&f[49_183..49_183 + BANK_SIZE], &s.bank(first).unwrap()[..]);
            let t = load_sna(&f).unwrap();
            assert_eq!(t, s, "bank {paged} paged");
        }
    }

    #[test]
    fn a_doubled_bank_is_read_from_its_own_place() {
        // Bank 2 paged: the file holds it at 8000h's place and again at C000h's. The two should be the same; where
        // a writer made them differ, the one at 8000h's place (its own) is the bank, and the six that follow are
        // 0, 1, 3, 4, 6 and 7.
        let mut s = Snapshot::new(Model::Spectrum128);
        for b in 0..8 {
            s.ram[b] = Some(pattern(b as u8 * 16 + 3));
        }
        s.port_7ffd = 2;
        let mut f = save_sna(&s).unwrap();
        assert_eq!(f.len(), SNA_128K_LONG);
        assert_eq!(&f[HEADER + BANK_SIZE..HEADER + 2 * BANK_SIZE], &f[HEADER + 2 * BANK_SIZE..SNA_48K]);
        f[HEADER + 2 * BANK_SIZE..SNA_48K].fill(0xAA);
        let t = load_sna(&f).unwrap();
        assert_eq!(t, s);
        let rest = SNA_48K + SNA_128K_EXTRA;
        for (i, bank) in [0, 1, 3, 4, 6, 7].into_iter().enumerate() {
            assert_eq!(&f[rest + i * BANK_SIZE..rest + (i + 1) * BANK_SIZE], &s.bank(bank).unwrap()[..]);
        }
    }

    #[test]
    fn a_128k_file_whose_length_does_not_fit_its_paging_is_refused() {
        let mut s = Snapshot::new(Model::Spectrum128);
        s.port_7ffd = 4;
        let mut f = save_sna(&s).unwrap();
        f[49_181] = 5; // Bank 5 paged: the file should have six more banks, and has five.
        assert!(matches!(load_sna(&f), Err(Error::Corrupt(_))));
        assert!(matches!(load_sna(&f[..1000]), Err(Error::Truncated(_))));
        assert!(matches!(load_sna(&[0; 50_000]), Err(Error::Corrupt(_))));
    }

    #[test]
    fn the_plus3_all_ram_paging_cannot_be_written() {
        let mut s = Snapshot::new(Model::Plus3);
        s.port_1ffd = 1;
        assert!(matches!(save_sna(&s), Err(Error::CannotSave(_))));
        s.port_1ffd = 4; // The motor on and the ROM chosen: ordinary paging, which can.
        assert_eq!(load_sna(&save_sna(&s).unwrap()).unwrap().model, Model::Spectrum128);
    }
}
