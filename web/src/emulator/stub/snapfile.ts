// Snapshots for the stand-in: enough of .z80 (v1–v3), .sna and .szx to put a snapshot's memory and registers in
// place, and to write a 48K one back out. The formats are as World of Spectrum's FAQ (.z80, .sna) and Spectaculator's
// ZX-State specification (.szx, v1.4) give them. The real core reads and writes them in full (crates/snapshot).

import type { Model, Registers } from '../emulator';
import { inflate } from './inflate';

export interface StubSnapshot {
  readonly model: Model;
  /** 0x4000–0xFFFF as the CPU saw it. */
  readonly ram: Uint8Array;
  readonly registers: Registers;
  readonly border: number;
}

export function blankRegisters(): Registers {
  return { af: 0xffff, bc: 0, de: 0, hl: 0, af_: 0xffff, bc_: 0, de_: 0, hl_: 0, ix: 0, iy: 0x5c3a, sp: 0xff4a, pc: 0x10b0, i: 0x3f, r: 0, im: 1, iff1: true, iff2: true, halted: false, t: 0 };
}

const Z80_MODELS: Readonly<Record<number, Model>> = { 0: '48k', 1: '48k', 3: '128k', 4: '128k', 5: '128k', 6: '128k', 7: 'plus3', 8: 'plus3', 9: 'pentagon', 12: 'plus2', 13: 'plus2a' };

/** A .z80's memory block: ED ED n b is n bytes of b. */
function unpackZ80(src: Uint8Array, out: Uint8Array, at: number, length: number): void {
  let i = 0;
  let o = at;
  const end = at + length;
  while (i < src.length && o < end) {
    if (src[i] === 0xed && src[i + 1] === 0xed) {
      out.fill(src[i + 3], o, Math.min(end, o + src[i + 2]));
      o += src[i + 2];
      i += 4;
    } else out[o++] = src[i++];
  }
}

export function readZ80(b: Uint8Array): StubSnapshot {
  if (b.length < 30) throw new Error('too short for a .z80');
  const w = (p: number) => b[p] | (b[p + 1] << 8);
  const flags = b[12] === 0xff ? 1 : b[12];
  const r: Registers = {
    ...blankRegisters(),
    af: (b[0] << 8) | b[1],
    bc: w(2),
    hl: w(4),
    pc: w(6),
    sp: w(8),
    i: b[10],
    r: (b[11] & 0x7f) | ((flags & 1) << 7),
    de: w(13),
    bc_: w(15),
    de_: w(17),
    hl_: w(19),
    af_: (b[21] << 8) | b[22],
    iy: w(23),
    ix: w(25),
    iff1: !!b[27],
    iff2: !!b[28],
    im: b[29] & 3,
  };
  const ram = new Uint8Array(0xc000);
  let model: Model = '48k';
  if (r.pc !== 0) {
    const data = b.subarray(30);
    if (flags & 0x20) unpackZ80(data, ram, 0, 0xc000);
    else ram.set(data.subarray(0, 0xc000));
  } else {
    const extra = w(30);
    r.pc = w(32);
    const hardware = b[34];
    const v3 = extra >= 54;
    model = v3 ? (Z80_MODELS[hardware] ?? '48k') : hardware === 3 || hardware === 4 ? '128k' : '48k';
    const banked = model !== '48k';
    const port7ffd = b[35];
    let p = 32 + extra;
    while (p + 3 <= b.length) {
      const len = w(p);
      const page = b[p + 2];
      const data = len === 0xffff ? b.subarray(p + 3, p + 3 + 16384) : b.subarray(p + 3, p + 3 + len);
      p += 3 + (len === 0xffff ? 16384 : len);
      // Where the page sits in 0x4000–0xFFFF: 48K pages 8, 4, 5; 128K banks 5, 2 and the one 7FFD pages in.
      const at = banked
        ? page === 8 ? 0x0000 : page === 5 ? 0x4000 : page === (port7ffd & 7) + 3 ? 0x8000 : -1
        : page === 8 ? 0x0000 : page === 4 ? 0x4000 : page === 5 ? 0x8000 : -1;
      if (at < 0) continue;
      if (len === 0xffff) ram.set(data, at);
      else unpackZ80(data, ram, at, 16384);
    }
  }
  return { model, ram, registers: r, border: (flags >> 1) & 7 };
}

export function readSna(b: Uint8Array): StubSnapshot {
  if (b.length < 49179) throw new Error('too short for a .sna');
  const w = (p: number) => b[p] | (b[p + 1] << 8);
  const ram = b.slice(27, 27 + 0xc000);
  const r: Registers = {
    ...blankRegisters(),
    i: b[0],
    hl_: w(1),
    de_: w(3),
    bc_: w(5),
    af_: w(7),
    hl: w(9),
    de: w(11),
    bc: w(13),
    iy: w(15),
    ix: w(17),
    iff2: !!(b[19] & 4),
    iff1: !!(b[19] & 4),
    r: b[20],
    af: w(21),
    sp: w(23),
    im: b[25] & 3,
  };
  let model: Model = '48k';
  if (b.length > 49179) {
    model = '128k';
    r.pc = w(49179);
  } else {
    const sp = r.sp - 0x4000;
    r.pc = sp >= 0 && sp < 0xbfff ? ram[sp] | (ram[sp + 1] << 8) : 0;
    r.sp = (r.sp + 2) & 0xffff;
  }
  return { model, ram, registers: r, border: b[26] & 7 };
}

const SZX_MODELS: Readonly<Record<number, Model>> = { 0: '16k', 1: '48k', 2: '128k', 3: 'plus2', 4: 'plus2a', 5: 'plus3', 6: 'plus3', 7: 'pentagon' };

export const isSzx = (b: Uint8Array): boolean => b.length >= 8 && b[0] === 0x5a && b[1] === 0x58 && b[2] === 0x53 && b[3] === 0x54;

export function readSzx(b: Uint8Array): StubSnapshot {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const model = SZX_MODELS[b[6]] ?? '48k';
  const ram = new Uint8Array(0xc000);
  const r = blankRegisters();
  let border = 7;
  let paged = 0;
  const pages = new Map<number, Uint8Array>();
  let p = 8;
  while (p + 8 <= b.length) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = view.getUint32(p + 4, true);
    const body = b.subarray(p + 8, p + 8 + size);
    p += 8 + size;
    if (id === 'RAMP') {
      const compressed = body[0] & 1;
      const data = compressed ? inflate(body.subarray(5), 16384) : body.subarray(3, 3 + 16384);
      pages.set(body[2], data);
    } else if (id === 'SPCR') {
      border = body[0] & 7;
      paged = body[1];
    } else if (id === 'Z80R' && size >= 37) {
      const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
      Object.assign(r, {
        af: v.getUint16(0, true), bc: v.getUint16(2, true), de: v.getUint16(4, true), hl: v.getUint16(6, true),
        af_: v.getUint16(8, true), bc_: v.getUint16(10, true), de_: v.getUint16(12, true), hl_: v.getUint16(14, true),
        ix: v.getUint16(16, true), iy: v.getUint16(18, true), sp: v.getUint16(20, true), pc: v.getUint16(22, true),
        i: body[24], r: body[25], iff1: !!body[26], iff2: !!body[27], im: body[28],
      });
    }
  }
  const place = (page: number, at: number) => {
    const d = pages.get(page);
    if (d) ram.set(d.subarray(0, 16384), at);
  };
  place(5, 0x0000);
  place(2, 0x4000);
  place(model === '48k' || model === '16k' ? 0 : paged & 7, 0x8000);
  return { model, ram, registers: r, border };
}

/** A .z80, version 1 (48K, uncompressed). */
export function writeZ80(s: StubSnapshot): Uint8Array {
  const out = new Uint8Array(30 + 0xc000);
  const r = s.registers;
  const put16 = (p: number, v: number) => {
    out[p] = v & 0xff;
    out[p + 1] = (v >> 8) & 0xff;
  };
  out[0] = r.af >> 8;
  out[1] = r.af & 0xff;
  put16(2, r.bc);
  put16(4, r.hl);
  put16(6, r.pc || 0x10b0);
  put16(8, r.sp);
  out[10] = r.i;
  out[11] = r.r & 0x7f;
  out[12] = ((r.r >> 7) & 1) | ((s.border & 7) << 1);
  put16(13, r.de);
  put16(15, r.bc_);
  put16(17, r.de_);
  put16(19, r.hl_);
  out[21] = r.af_ >> 8;
  out[22] = r.af_ & 0xff;
  put16(23, r.iy);
  put16(25, r.ix);
  out[27] = r.iff1 ? 1 : 0;
  out[28] = r.iff2 ? 1 : 0;
  out[29] = r.im & 3;
  out.set(s.ram, 30);
  return out;
}

/** A 48K .sna: the registers, then the RAM, the PC pushed on the stack as the format has it. */
export function writeSna(s: StubSnapshot): Uint8Array {
  const out = new Uint8Array(27 + 0xc000);
  const r = s.registers;
  const ram = s.ram.slice();
  const sp = (r.sp - 2) & 0xffff;
  if (sp >= 0x4000) {
    ram[sp - 0x4000] = r.pc & 0xff;
    ram[((sp + 1) & 0xffff) - 0x4000] = r.pc >> 8;
  }
  const put16 = (p: number, v: number) => {
    out[p] = v & 0xff;
    out[p + 1] = (v >> 8) & 0xff;
  };
  out[0] = r.i;
  put16(1, r.hl_);
  put16(3, r.de_);
  put16(5, r.bc_);
  put16(7, r.af_);
  put16(9, r.hl);
  put16(11, r.de);
  put16(13, r.bc);
  put16(15, r.iy);
  put16(17, r.ix);
  out[19] = r.iff2 ? 4 : 0;
  out[20] = r.r;
  put16(21, r.af);
  put16(23, sp);
  out[25] = r.im & 3;
  out[26] = s.border & 7;
  out.set(ram, 27);
  return out;
}

/** A 48K .szx (v1.4): its header, the registers (Z80R), the ports (SPCR), and three uncompressed RAM pages. */
export function writeSzx(s: StubSnapshot): Uint8Array {
  const chunks: Uint8Array[] = [];
  const chunk = (id: string, body: Uint8Array) => {
    const head = new Uint8Array(8);
    for (let i = 0; i < 4; i++) head[i] = id.charCodeAt(i);
    new DataView(head.buffer).setUint32(4, body.length, true);
    chunks.push(head, body);
  };
  chunks.push(new Uint8Array([0x5a, 0x58, 0x53, 0x54, 1, 4, 1, 0])); // ZXST 1.4, a 48K
  const z = new Uint8Array(37);
  const v = new DataView(z.buffer);
  const r = s.registers;
  [r.af, r.bc, r.de, r.hl, r.af_, r.bc_, r.de_, r.hl_, r.ix, r.iy, r.sp, r.pc].forEach((x, i) => v.setUint16(i * 2, x, true));
  z[24] = r.i;
  z[25] = r.r;
  z[26] = r.iff1 ? 1 : 0;
  z[27] = r.iff2 ? 1 : 0;
  z[28] = r.im;
  chunk('Z80R', z);
  chunk('SPCR', new Uint8Array([s.border & 7, 0, 0, 0, 0, 0, 0, 0]));
  for (const [page, at] of [
    [5, 0x0000],
    [2, 0x4000],
    [0, 0x8000],
  ]) {
    const body = new Uint8Array(3 + 16384);
    body[2] = page;
    body.set(s.ram.subarray(at, at + 16384), 3);
    chunk('RAMP', body);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
