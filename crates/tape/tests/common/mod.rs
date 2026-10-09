//! What the tape's tests share: a machine clock around the player, the ROM's LD-BYTES and SA-BYTES as the
//! T-states they spend, a TZX writer, and the fixtures.
//!
//! The two ROM routines are modelled from their disassembly (The Complete Spectrum ROM Disassembly, Logan and
//! O'Hara; https://skoolkid.github.io/rom/asm/0556.html, 05E3.html and 04C2.html), instruction by
//! instruction, each costing its T-states (uncontended: the ROM is, and port 0xFE's contention only moves a
//! sample by a few T-states). The port is read 7 T-states into an `IN A,(n)` and written 7 into an
//! `OUT (n),A`, where their I/O cycle begins. What LD-BYTES loads from the player's edges is what the real
//! routine would have.

#![allow(dead_code)]

use std::io::Write;
use tape::Player;

pub const FRAME_48K: u32 = 69_888;
pub const FRAME_128K: u32 = 70_908;

/// A machine's clock around a player: T-states run, frames ended as they pass.
pub struct Machine<'a> {
    pub player: &'a mut Player,
    pub frame_len: u32,
    /// T-state within the frame.
    pub t: u32,
    /// T-states run in all.
    pub total: u64,
}

impl<'a> Machine<'a> {
    pub fn new(player: &'a mut Player, frame_len: u32) -> Machine<'a> {
        Machine {
            player,
            frame_len,
            t: 0,
            total: 0,
        }
    }

    pub fn run(&mut self, n: u64) {
        self.total += n;
        let mut t = self.t as u64 + n;
        while t >= self.frame_len as u64 {
            self.player.end_frame(self.frame_len);
            t -= self.frame_len as u64;
        }
        self.t = t as u32;
    }

    pub fn ear(&mut self) -> bool {
        self.player.level_at(self.t)
    }

    /// Runs to the next edge; its time in all, or `None` if none comes.
    pub fn run_to_edge(&mut self) -> Option<u64> {
        let e = self.player.next_edge(self.t)?;
        self.run((e - self.t) as u64);
        Some(self.total)
    }
}

/// What LD-BYTES returned.
#[derive(Debug, PartialEq, Eq)]
pub struct Loaded {
    pub bytes: Vec<u8>,
    pub ok: bool,
}

/// The ROM's LD-BYTES at 0x0556, loading: from now, for a block of flag `flag` and `len` bytes. `None` if no
/// block has begun within `budget` T-states (the routine would still be waiting).
pub fn ld_bytes(m: &mut Machine, flag: u8, len: u16, budget: u64) -> Option<Loaded> {
    let deadline = m.total + budget;
    let mut b: u8 = 0;
    // INC D; EX AF,AF'; DEC D; DI; LD A,$0F; OUT ($FE),A; LD HL,$053F; PUSH HL
    m.run(4 + 4 + 4 + 4 + 7 + 11 + 10 + 11);
    // IN A,($FE); RRA; AND $20; OR $02; LD C,A; CP A
    m.run(7);
    let mut c = m.ear();
    m.run(4 + 4 + 7 + 7 + 4 + 4);
    // LD_BREAK: RET NZ, not taken
    m.run(5);
    'start: loop {
        if m.total > deadline {
            return None;
        }
        // LD_START: CALL LD_EDGE_1; JR NC,LD_BREAK
        m.run(17);
        if !edge1(m, &mut b, &mut c) {
            m.run(12 + 5);
            continue 'start;
        }
        m.run(7);
        // LD HL,$0415; LD_WAIT: DJNZ LD_WAIT; DEC HL; LD A,H; OR L; JR NZ,LD_WAIT
        m.run(10);
        for hl in (0..0x0415u32).rev() {
            let n = if b == 0 { 256 } else { b as u64 };
            m.run((n - 1) * 13 + 8);
            b = 0;
            m.run(6 + 4 + 4 + if hl != 0 { 12 } else { 7 });
        }
        // CALL LD_EDGE_2; JR NC,LD_BREAK
        m.run(17);
        if !edge2(m, &mut b, &mut c) {
            m.run(12 + 5);
            continue 'start;
        }
        m.run(7);
        // LD_LEADER: 256 pairs of edges, each pair inside the time allowed.
        let mut h: u8 = 0;
        loop {
            // LD B,$9C; CALL LD_EDGE_2; JR NC,LD_BREAK
            m.run(7 + 17);
            b = 0x9C;
            if !edge2(m, &mut b, &mut c) {
                m.run(12 + 5);
                continue 'start;
            }
            m.run(7);
            // LD A,$C6; CP B; JR NC,LD_START
            m.run(7 + 4);
            if b <= 0xC6 {
                m.run(12);
                continue 'start;
            }
            m.run(7);
            // INC H; JR NZ,LD_LEADER
            h = h.wrapping_add(1);
            m.run(4);
            if h != 0 {
                m.run(12);
                continue;
            }
            m.run(7);
            break;
        }
        // LD_SYNC: edges until two come close together.
        loop {
            // LD B,$C9; CALL LD_EDGE_1; JR NC,LD_BREAK
            m.run(7 + 17);
            b = 0xC9;
            if !edge1(m, &mut b, &mut c) {
                m.run(12 + 5);
                continue 'start;
            }
            m.run(7);
            // LD A,B; CP $D4; JR NC,LD_SYNC
            m.run(4 + 7);
            if b >= 0xD4 {
                m.run(12);
                continue;
            }
            m.run(7);
            break;
        }
        // CALL LD_EDGE_1; RET NC
        m.run(17);
        if !edge1(m, &mut b, &mut c) {
            m.run(11);
            return Some(Loaded {
                bytes: Vec::new(),
                ok: false,
            });
        }
        m.run(5);
        // LD A,C; XOR $03; LD C,A; LD H,$00; LD B,$B0; JR LD_MARKER
        m.run(4 + 7 + 4 + 7 + 7 + 12);
        b = 0xB0;
        break;
    }
    let mut parity = 0u8;
    let mut stored = Vec::new();
    let mut de = len as u32;
    let mut first = true;
    loop {
        // LD_MARKER: LD L,$01
        m.run(7);
        let mut l: u8 = 1;
        let byte = loop {
            // LD_8_BITS: CALL LD_EDGE_2; RET NC
            m.run(17);
            if !edge2(m, &mut b, &mut c) {
                m.run(11);
                return Some(Loaded {
                    bytes: stored,
                    ok: false,
                });
            }
            m.run(5);
            // LD A,$CB; CP B; RL L; LD B,$B0; JP NC,LD_8_BITS
            m.run(7 + 4 + 8 + 7 + 10);
            let marker_out = l & 0x80 != 0;
            l = l << 1 | (b > 0xCB) as u8;
            b = 0xB0;
            if marker_out {
                break l;
            }
        };
        // LD A,H; XOR L; LD H,A; LD A,D; OR E; JR NZ,LD_LOOP
        parity ^= byte;
        m.run(4 + 4 + 4 + 4 + 4);
        if de == 0 {
            // LD A,H; CP $01; RET
            m.run(7 + 4 + 7 + 10);
            return Some(Loaded {
                bytes: stored,
                ok: parity == 0,
            });
        }
        m.run(12);
        // LD_LOOP: EX AF,AF'
        m.run(4);
        if first {
            // JR NZ,LD_FLAG; RL C; XOR L; RET NZ
            m.run(12 + 8 + 4);
            if byte != flag {
                m.run(11);
                return Some(Loaded {
                    bytes: stored,
                    ok: false,
                });
            }
            // LD A,C; RRA; LD C,A; INC DE; JR LD_DEC
            m.run(5 + 4 + 4 + 4 + 6 + 12);
            de += 1;
            first = false;
        } else {
            // JR NZ (not taken); JR NC,LD_VERIFY (not taken); LD (IX+0),L; JR LD_NEXT; INC IX
            m.run(7 + 7 + 19 + 12 + 10);
            stored.push(byte);
        }
        // LD_DEC: DEC DE; EX AF,AF'; LD B,$B2
        de -= 1;
        m.run(6 + 4 + 7);
        b = 0xB2;
    }
}

/// LD-EDGE-1, after the CALL to it: waits 358 T-states, then samples until the EAR bit differs from the
/// last edge's, counting passes in B; false when B wraps to 0 (time up).
fn edge1(m: &mut Machine, b: &mut u8, c: &mut bool) -> bool {
    // LD A,$16; LD_DELAY: DEC A; JR NZ (22 times); AND A
    m.run(7 + 21 * 16 + 11 + 4);
    loop {
        // INC B; RET Z
        *b = b.wrapping_add(1);
        m.run(4);
        if *b == 0 {
            m.run(11);
            return false;
        }
        // LD A,$7F; IN A,($FE)
        m.run(5 + 7 + 7);
        let ear = m.ear();
        m.run(4);
        // RRA; RET NC; XOR C; AND $20; JR Z,LD_SAMPLE
        m.run(4 + 5 + 4 + 7);
        if ear != *c {
            m.run(7);
            break;
        }
        m.run(12);
    }
    // LD A,C; CPL; LD C,A; AND $07; OR $08; OUT ($FE),A; SCF; RET
    *c = !*c;
    m.run(4 + 4 + 4 + 7 + 7 + 11 + 4 + 10);
    true
}

/// LD-EDGE-2, after the CALL to it: two edges.
fn edge2(m: &mut Machine, b: &mut u8, c: &mut bool) -> bool {
    m.run(17);
    if !edge1(m, b, c) {
        m.run(11);
        return false;
    }
    m.run(5);
    edge1(m, b, c)
}

/// The ROM's SA-BYTES at 0x04C2 saving `data` with `flag`, and the return through SA/LD-RET that puts the
/// border back: the MIC line's changes, as (T-state from the call, level), and the T-state it ends at.
pub fn sa_bytes(flag: u8, data: &[u8]) -> (Vec<(u64, bool)>, u64) {
    let mut t = 0u64;
    let mut mic = false;
    let mut edges = Vec::new();
    let mut out = |t: &mut u64, value: u8| {
        let level = value & 0x08 != 0;
        if level != mic {
            edges.push((*t + 7, level));
            mic = level;
        }
        *t += 11;
    };
    let djnz = |b: u8| -> u64 { (if b == 0 { 256 } else { b as u64 } - 1) * 13 + 8 };
    // LD HL,$053F; PUSH HL; LD HL,$1F80; BIT 7,A; JR Z,SA_FLAG / LD HL,$0C98
    t += 10 + 11 + 10 + 8;
    let mut hl: u16 = if flag & 0x80 == 0 {
        t += 12;
        0x1F80
    } else {
        t += 7 + 10;
        0x0C98
    };
    // SA_FLAG: EX AF,AF'; INC DE; DEC IX; DI; LD A,$02; LD B,A
    t += 4 + 6 + 10 + 4 + 7 + 4;
    let mut a: u8 = 0x02;
    let mut b: u8 = 0x02;
    // SA_LEADER
    loop {
        t += djnz(b);
        out(&mut t, a);
        // XOR $0F; LD B,$A4; DEC L; JR NZ,SA_LEADER
        a ^= 0x0F;
        b = 0xA4;
        let l = (hl as u8).wrapping_sub(1);
        hl = hl & 0xFF00 | l as u16;
        t += 7 + 7 + 4;
        if l != 0 {
            t += 12;
            continue;
        }
        // DEC B; DEC H; JP P,SA_LEADER
        b -= 1;
        let h = ((hl >> 8) as u8).wrapping_sub(1);
        hl = (h as u16) << 8 | hl & 0xFF;
        t += 7 + 4 + 4 + 10;
        if h & 0x80 == 0 {
            continue;
        }
        break;
    }
    // LD B,$2F; SA_SYNC_1: DJNZ; OUT ($FE),A; LD A,$0D; LD B,$37; SA_SYNC_2: DJNZ; OUT ($FE),A
    t += 7 + djnz(0x2F);
    out(&mut t, a);
    t += 7 + 7 + djnz(0x37);
    out(&mut t, 0x0D);
    // LD BC,$3B0E; EX AF,AF'; LD L,A; JP SA_START; LD H,A; LD A,$01; SCF; JP SA_8_BITS
    t += 10 + 4 + 4 + 10 + 4 + 7 + 4 + 10;
    b = 0x3B;
    let parity = tape::tap::parity(&[&[flag][..], data].concat());
    let bytes: Vec<u8> = [&[flag][..], data, &[parity]].concat();
    let last = bytes.len() - 1;
    for (i, &byte) in bytes.iter().enumerate() {
        for bit in (0..8).rev() {
            let one = byte >> bit & 1 != 0;
            // RL L; JP NZ,SA_BIT_1; SA_BIT_1: DJNZ; JR NC,SA_OUT / LD B,$42; SA_SET: DJNZ
            t += 8 + 10 + djnz(b) + if one { 7 + 7 + djnz(0x42) } else { 12 };
            out(&mut t, 0x01);
            // LD B,$3E; JR NZ,SA_BIT_2; LD A,C; BIT 7,B; SA_BIT_1: DJNZ; JR NC / LD B,$42; DJNZ
            t += 7 + 12 + 4 + 8 + djnz(0x3E) + if one { 7 + 7 + djnz(0x42) } else { 12 };
            out(&mut t, 0x0E);
            // LD B,$3E; JR NZ (not taken); DEC B; XOR A; INC A
            t += 7 + 7 + 4 + 4 + 4;
            b = 0x3D;
        }
        // RL L; JP NZ (not taken); DEC DE; INC IX; LD B,$31; LD A,$7F; IN A,($FE); RRA; RET NC; LD A,D;
        // INC A; JP NZ,SA_LOOP
        t += 8 + 10 + 6 + 10 + 7 + 7 + 11 + 4 + 5 + 4 + 4 + 10;
        b = 0x31;
        if i == last {
            break;
        }
        // SA_LOOP: LD A,D; OR E; JR Z,SA_PARITY / LD L,(IX+0); (SA_PARITY: LD L,H; JR SA_LOOP_P)
        t += 4 + 4 + if i + 1 == last { 12 + 4 + 12 } else { 7 + 19 };
        // SA_LOOP_P: LD A,H; XOR L; SA_START: LD H,A; LD A,$01; SCF; JP SA_8_BITS
        t += 4 + 4 + 4 + 7 + 4 + 10;
    }
    // LD B,$3B; SA_DELAY: DJNZ; RET; SA_LD_RET: PUSH AF; LD A,(BORDCR); AND $38; RRCA x3; OUT ($FE),A
    t += 7 + djnz(0x3B) + 10 + 11 + 13 + 7 + 12;
    out(&mut t, 0x07);
    (edges, t)
}

/// Pulses read off the player from the next edge on, in the machine's T-states: what a loader's edge loop
/// measures.
pub fn pulses(m: &mut Machine, count: usize) -> Vec<u64> {
    let mut last = m.run_to_edge().expect("an edge");
    (0..count)
        .map(|_| {
            let e = m.run_to_edge().expect("an edge");
            let p = e - last;
            last = e;
            p
        })
        .collect()
}

/// A loader for any block of pilot, two syncs and two-pulse bits, as turbo loaders are (timings in 3.5 MHz
/// T-states; `hz` the machine's clock): finds a pilot of 256 pulses within a tenth of `pilot`, the syncs,
/// and reads `len` bytes, each bit a pair of pulses judged against the midpoint of a 0's and a 1's.
pub fn read_block(m: &mut Machine, hz: u32, timings: [u16; 5], len: usize) -> Vec<u8> {
    let scale = |t: u16| t as f64 * hz as f64 / 3_500_000.0;
    let near = |p: u64, t: u16| (p as f64 - scale(t)).abs() <= scale(t) / 10.0;
    let [pilot, sync1, sync2, zero, one] = timings;
    let mut last = m.run_to_edge().expect("an edge");
    let mut next = |m: &mut Machine| {
        let e = m.run_to_edge().expect("an edge");
        let p = e - last;
        last = e;
        p
    };
    let mut run = 0;
    loop {
        let p = next(m);
        if near(p, pilot) {
            run += 1;
        } else if run >= 256 && near(p, sync1) {
            break;
        } else {
            run = 0;
        }
    }
    assert!(near(next(m), sync2), "the second sync pulse");
    let threshold = scale(zero) + scale(one);
    (0..len)
        .map(|_| {
            (0..8).fold(0u8, |byte, _| {
                byte << 1 | ((next(m) + next(m)) as f64 > threshold) as u8
            })
        })
        .collect()
}

/// A TZX file of these blocks (each its ID and body).
pub fn tzx(blocks: &[Vec<u8>]) -> Vec<u8> {
    let mut out = b"ZXTape!\x1A\x01\x14".to_vec();
    for b in blocks {
        out.extend_from_slice(b);
    }
    out
}

fn le16(v: u16) -> [u8; 2] {
    v.to_le_bytes()
}
fn le24(v: usize) -> [u8; 3] {
    let b = (v as u32).to_le_bytes();
    [b[0], b[1], b[2]]
}
fn le32(v: usize) -> [u8; 4] {
    (v as u32).to_le_bytes()
}

pub fn b10(pause: u16, data: &[u8]) -> Vec<u8> {
    [&[0x10][..], &le16(pause), &le16(data.len() as u16), data].concat()
}
pub fn b11(t: [u16; 6], used: u8, pause: u16, data: &[u8]) -> Vec<u8> {
    let mut b = vec![0x11];
    for v in t {
        b.extend_from_slice(&le16(v));
    }
    [
        b,
        vec![used],
        le16(pause).to_vec(),
        le24(data.len()).to_vec(),
        data.to_vec(),
    ]
    .concat()
}
pub fn b12(pulse: u16, count: u16) -> Vec<u8> {
    [&[0x12][..], &le16(pulse), &le16(count)].concat()
}
pub fn b13(pulses: &[u16]) -> Vec<u8> {
    let mut b = vec![0x13, pulses.len() as u8];
    for &p in pulses {
        b.extend_from_slice(&le16(p));
    }
    b
}
pub fn b14(zero: u16, one: u16, used: u8, pause: u16, data: &[u8]) -> Vec<u8> {
    [
        &[0x14][..],
        &le16(zero),
        &le16(one),
        &[used],
        &le16(pause),
        &le24(data.len()),
        data,
    ]
    .concat()
}
pub fn b15(per_sample: u16, pause: u16, used: u8, data: &[u8]) -> Vec<u8> {
    [
        &[0x15][..],
        &le16(per_sample),
        &le16(pause),
        &[used],
        &le24(data.len()),
        data,
    ]
    .concat()
}
/// Block 0x18 of these pulses, RLE (1) or Z-RLE (2).
pub fn b18(pause: u16, rate: u32, compression: u8, pulses: &[u32]) -> Vec<u8> {
    let rle = tape::csw::encode_rle(pulses);
    let data = if compression == 2 {
        miniz_oxide::deflate::compress_to_vec_zlib(&rle, 9)
    } else {
        rle
    };
    let body = [
        &le16(pause)[..],
        &le24(rate as usize),
        &[compression],
        &le32(pulses.len()),
        &data,
    ]
    .concat();
    [&[0x18][..], &le32(body.len()), &body].concat()
}
/// A generalized data block: pilot symbols and runs, data symbols and stream (symbols given as values).
pub fn b19(
    pause: u16,
    pilot: &[(u8, &[u16])],
    prle: &[(u8, u16)],
    data: &[(u8, &[u16])],
    stream: &[u8],
) -> Vec<u8> {
    let npp = pilot.iter().map(|s| s.1.len()).max().unwrap_or(0);
    let npd = data.iter().map(|s| s.1.len()).max().unwrap_or(0);
    let nb = (0..).find(|&n| 1usize << n >= data.len()).unwrap();
    let mut body = le16(pause).to_vec();
    body.extend_from_slice(&le32(prle.len()));
    body.push(npp as u8);
    body.push(pilot.len() as u8);
    body.extend_from_slice(&le32(stream.len()));
    body.push(npd as u8);
    body.push(data.len() as u8);
    let table = |body: &mut Vec<u8>, symbols: &[(u8, &[u16])], max: usize| {
        for (flags, pulses) in symbols {
            body.push(*flags);
            for i in 0..max {
                body.extend_from_slice(&le16(pulses.get(i).copied().unwrap_or(0)));
            }
        }
    };
    if !prle.is_empty() {
        table(&mut body, pilot, npp);
        for &(s, n) in prle {
            body.push(s);
            body.extend_from_slice(&le16(n));
        }
    }
    if !stream.is_empty() {
        table(&mut body, data, npd);
        let mut bits = Vec::new();
        for &s in stream {
            for i in (0..nb).rev() {
                bits.push(s >> i & 1);
            }
        }
        for chunk in bits.chunks(8) {
            let mut byte = 0u8;
            for (i, &bit) in chunk.iter().enumerate() {
                byte |= bit << (7 - i);
            }
            body.push(byte);
        }
    }
    [&[0x19][..], &le32(body.len()), &body].concat()
}
pub fn b20(ms: u16) -> Vec<u8> {
    [&[0x20][..], &le16(ms)].concat()
}
pub fn b21(name: &str) -> Vec<u8> {
    [&[0x21, name.len() as u8][..], name.as_bytes()].concat()
}
pub fn b22() -> Vec<u8> {
    vec![0x22]
}
pub fn b23(offset: i16) -> Vec<u8> {
    [&[0x23][..], &le16(offset as u16)].concat()
}
pub fn b24(n: u16) -> Vec<u8> {
    [&[0x24][..], &le16(n)].concat()
}
pub fn b25() -> Vec<u8> {
    vec![0x25]
}
pub fn b26(calls: &[i16]) -> Vec<u8> {
    let mut b = vec![0x26];
    b.extend_from_slice(&le16(calls.len() as u16));
    for &c in calls {
        b.extend_from_slice(&le16(c as u16));
    }
    b
}
pub fn b27() -> Vec<u8> {
    vec![0x27]
}
pub fn b28(choices: &[(i16, &str)]) -> Vec<u8> {
    let mut body = vec![choices.len() as u8];
    for (o, t) in choices {
        body.extend_from_slice(&le16(*o as u16));
        body.push(t.len() as u8);
        body.extend_from_slice(t.as_bytes());
    }
    [&[0x28][..], &le16(body.len() as u16), &body].concat()
}
pub fn b2a() -> Vec<u8> {
    vec![0x2A, 0, 0, 0, 0]
}
pub fn b2b(high: bool) -> Vec<u8> {
    vec![0x2B, 1, 0, 0, 0, high as u8]
}
pub fn b30(text: &str) -> Vec<u8> {
    [&[0x30, text.len() as u8][..], text.as_bytes()].concat()
}
pub fn b31(seconds: u8, text: &str) -> Vec<u8> {
    [&[0x31, seconds, text.len() as u8][..], text.as_bytes()].concat()
}
pub fn b32(texts: &[(u8, &str)]) -> Vec<u8> {
    let mut body = vec![texts.len() as u8];
    for (id, t) in texts {
        body.push(*id);
        body.push(t.len() as u8);
        body.extend_from_slice(t.as_bytes());
    }
    [&[0x32][..], &le16(body.len() as u16), &body].concat()
}
pub fn b33(hw: &[[u8; 3]]) -> Vec<u8> {
    let mut b = vec![0x33, hw.len() as u8];
    for h in hw {
        b.extend_from_slice(h);
    }
    b
}
pub fn b35(id: &str, data: &[u8]) -> Vec<u8> {
    let mut name = [b' '; 16];
    name[..id.len()].copy_from_slice(id.as_bytes());
    [&[0x35][..], &name, &le32(data.len()), data].concat()
}
pub fn b5a() -> Vec<u8> {
    [&[0x5A][..], b"XTape!\x1A\x01\x14"].concat()
}

/// A Spectrum header block: flag 0, type, name, length, two parameters, parity.
pub fn header(kind: u8, name: &str, length: u16, p1: u16, p2: u16) -> Vec<u8> {
    let mut h = vec![kind];
    let mut n = [b' '; 10];
    n[..name.len()].copy_from_slice(name.as_bytes());
    h.extend_from_slice(&n);
    for v in [length, p1, p2] {
        h.extend_from_slice(&v.to_le_bytes());
    }
    tape::tap::block(0x00, &h)
}

/// Bytes from a seeded generator (xorshift), the same on every run.
pub fn noise(seed: u64, n: usize) -> Vec<u8> {
    let mut x = seed | 1;
    (0..n)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 24) as u8
        })
        .collect()
}

/// A fixture's bytes (`scripts/fixture NAME`), or `None` after saying on the terminal that the test is
/// skipped. Written straight to stderr, past the test harness's capture, so that a skip is seen.
pub fn fixture(name: &str, test: &str) -> Option<Vec<u8>> {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let out = std::process::Command::new(format!("{root}/scripts/fixture"))
        .arg(name)
        .output();
    let path = match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Ok(o) => {
            let why = String::from_utf8_lossy(&o.stderr).trim().to_string();
            let _ = writeln!(
                std::io::stderr(),
                "SKIPPED {test}: fixture {name} not available: {why}"
            );
            return None;
        }
        Err(e) => {
            let _ = writeln!(
                std::io::stderr(),
                "SKIPPED {test}: scripts/fixture did not run: {e}"
            );
            return None;
        }
    };
    match std::fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(e) => {
            let _ = writeln!(
                std::io::stderr(),
                "SKIPPED {test}: fixture {name} at {path} unreadable: {e}"
            );
            None
        }
    }
}
